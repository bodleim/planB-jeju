/**
 * F2 검증 — 실데이터로 발표 시나리오를 돌린다. 키 없이 돈다. `npm run check:plan`
 *
 * F2 의 완료 기준 세 줄을 그대로 assert 한다.
 *   1. 각 시간대에 대안이 2개 이상
 *   2. 스와이프하면 **그 시간대만** 바뀐다
 *   3. 새로고침할 때마다 조합이 달라진다
 * 여기에 F1 의 불변식(도착 시각에 열려 있다 / 남은 시간 안에 완주)이 교체 후에도
 * 유지되는지를 함께 본다 — 대안이라는 이유로 문 닫은 곳이 들어오면 시연이 무너진다.
 */
import assert from 'node:assert/strict'
import { SEONGSAN_PLACES, ORIGINS } from '../data/places.ts'
import { EXPOSURE_RISKS, filterCandidates, type FilterContext } from '../filter/index.ts'
import { DEFAULT_POLICY, buildPlan, isSingleCategory, reshuffle, setKey, swapSlot } from './index.ts'
import { pinsFromQuery, pinsToQuery } from './replace.ts'
import { formatHm, parseHm } from '../time.ts'
import type { PlanView } from './replace.ts'
import type { Plan, PlanInput } from './types.ts'
import type { TripCategory, Weekday } from '../types.ts'

const MONDAY: Weekday = 1
const START = parseHm('10:00')
const REMAINING = 300

// ------------------------------------------------------------------ F3: 실데이터 + 결항

const ctx: FilterContext = {
  origin: ORIGINS.seongsan_port.coord,
  startMinutes: START,
  weekday: MONDAY,
  remainingMinutes: REMAINING,
  hasCar: true,
  cause: 'ferry_cancelled',
  weather: {
    at: '2026-07-27T01:00:00.000Z',
    source: '폴백',
    isFallback: true,
    grid: { nx: 60, ny: 37 },
    hourly: [],
    warnings: [],
    risks: [],
  },
  policy: DEFAULT_POLICY,
}

const filtered = filterCandidates(SEONGSAN_PLACES, ctx)
assert.ok(filtered.candidates.length >= 10, `실데이터 후보가 ${filtered.candidates.length}곳뿐`)
assert.ok(
  filtered.rejected.some((r) => r.reason === 'cancelled'),
  '여객선 결항으로 제외된 우도 후보가 있어야 한다',
)
assert.ok(
  filtered.rejected.some((r) => r.reason === 'hazard'),
  '강풍·해상 위험으로 제외된 후보가 있어야 한다',
)
assert.ok(
  filtered.candidates.every((p) => p.dependsOn !== 'ferry'),
  '끊긴 여객선에 의존하는 후보가 남았다',
)

// ------------------------------------------------------------------ F1: 계획 1개

const category: TripCategory = { companion: 'couple', activity: 'indoor' }
const input: PlanInput = {
  origin: ctx.origin,
  startMinutes: START,
  remainingMinutes: REMAINING,
  category,
  hasCar: true,
  weekday: MONDAY,
}
const plan = (view: PlanView): Plan => {
  assert.ok(view.result.plan !== null, `계획이 비었다: ${view.result.diagnostics.notes.join(' / ')}`)
  return view.result.plan
}

/** F1 불변식 — 이 함수가 통과하지 못하는 계획은 화면에 띄우면 안 된다. */
function assertInvariants(p: Plan, label: string): void {
  assert.ok(isSingleCategory(p), `${label}: 일정 안에 다른 성격이 섞였다`)
  assert.ok(p.totals.endMinutes <= START + REMAINING, `${label}: 남은 시간 초과`)
  const ids = p.slots.map((s) => s.chosen.visit.place.id)
  assert.equal(new Set(ids).size, ids.length, `${label}: 같은 장소가 두 번 들어갔다`)
  for (const slot of p.slots) {
    const { visit } = slot.chosen
    assert.ok(
      visit.place.hours[MONDAY].some((i) => visit.startMinutes >= i.open && visit.startMinutes < i.close),
      `${label}: ${visit.place.name} — 이용 시작 ${formatHm(visit.startMinutes)}에 열려 있지 않다`,
    )
    assert.ok(visit.place.verified, `${label}: ${visit.place.name} — 운영 미확인인데 편성됐다`)
    assert.equal(
      EXPOSURE_RISKS[visit.place.exposure].filter((h) => filtered.risks.includes(h)).length,
      0,
      `${label}: ${visit.place.name} — 일정을 깨뜨린 것과 같은 위험이 다시 들어왔다`,
    )
  }
  // 시간대가 서로 겹치지 않고 순서대로 이어진다
  for (let i = 1; i < p.slots.length; i += 1) {
    assert.ok(
      p.slots[i].chosen.visit.departMinutes >= p.slots[i - 1].chosen.visit.endMinutes,
      `${label}: ${i}번째 시간대가 앞 시간대와 겹친다`,
    )
  }
}

const base = buildPlan(input, filtered.candidates, DEFAULT_POLICY)
const basePlan = plan(base)
assertInvariants(basePlan, '기본')
assert.ok(basePlan.slots.length >= 3, `시간대가 ${basePlan.slots.length}개뿐`)

// 완료 기준 1 — 각 시간대에 대안이 2개 이상
for (const slot of basePlan.slots) {
  assert.ok(
    slot.alternatives.length >= 2,
    `${slot.chosen.visit.place.name}: 대안이 ${slot.alternatives.length}개 — 스와이프할 게 없다`,
  )
}

// ------------------------------------------------------------------ F2: 스와이프

// 완료 기준 2 — 그 시간대만 바뀐다
const target = 1
const swapped = swapSlot(base, target, 1, input, filtered.candidates, DEFAULT_POLICY)
const swappedPlan = plan(swapped)
assertInvariants(swappedPlan, '스와이프 후')

const before = basePlan.slots.map((s) => s.chosen.visit.place.id)
const after = swappedPlan.slots.map((s) => s.chosen.visit.place.id)
assert.notEqual(after[target], before[target], '스와이프했는데 그 시간대가 그대로다')
assert.deepEqual(
  after.slice(0, target),
  before.slice(0, target),
  '앞 시간대가 흔들렸다 — "해당 시간대만 교체" 가 깨졌다',
)
assert.equal(
  swapped.pins[target],
  after[target],
  'pins 가 실제 채택안과 어긋난다 — 링크를 다시 열면 다른 계획이 나온다',
)

// 뒤 시간대는 출발 시각이 밀리므로 다시 채워진다 (그대로 유지되는 게 아니다)
assert.ok(
  swappedPlan.slots[target].chosen.visit.departMinutes ===
    basePlan.slots[target].chosen.visit.departMinutes,
  '교체한 시간대의 출발 시각은 앞이 고정됐으므로 같아야 한다',
)

// 계속 넘기면 두 곳을 왕복하지 않고 순회한다
let cursor = base
const visited = new Set<string>([before[target]])
for (let i = 0; i < 4; i += 1) {
  cursor = swapSlot(cursor, target, 1, input, filtered.candidates, DEFAULT_POLICY)
  const p = plan(cursor)
  assertInvariants(p, `스와이프 ${i + 2}회`)
  visited.add(p.slots[target].chosen.visit.place.id)
}
assert.ok(visited.size >= 3, `계속 넘겼는데 ${visited.size}곳만 나온다 — 두 곳 왕복이다`)

// 반대 방향으로 넘기면 되돌아온다
const forward = swapSlot(base, target, 1, input, filtered.candidates, DEFAULT_POLICY)
const backAgain = swapSlot(forward, target, -1, input, filtered.candidates, DEFAULT_POLICY)
assert.equal(
  plan(backAgain).slots[target].chosen.visit.place.id,
  before[target],
  '앞으로 넘긴 뒤 뒤로 넘기면 원래 곳으로 돌아와야 한다',
)

// 완료 기준 3 — 새로고침할 때마다 조합이 달라진다
const keys = new Set<string>([setKey(basePlan)])
let shuffling = base
for (let i = 0; i < 6; i += 1) {
  shuffling = reshuffle(shuffling, input, filtered.candidates, DEFAULT_POLICY)
  const p = plan(shuffling)
  assertInvariants(p, `새로고침 ${i + 1}회`)
  assert.deepEqual(shuffling.pins, [], '새로고침은 고정을 모두 풀어야 한다')
  keys.add(setKey(p))
}
assert.ok(keys.size >= 3, `새로고침 6회에 조합이 ${keys.size}종뿐`)

// 고정은 제약을 우회하지 못한다 — 갈 수 없는 곳을 고정해도 편성되지 않는다
const unreachable = SEONGSAN_PLACES.find((p) => p.dependsOn === 'ferry')
assert.ok(unreachable, '우도 후보를 못 찾았다')
const forced = buildPlan(input, filtered.candidates, DEFAULT_POLICY, [unreachable.id])
assert.ok(
  !plan(forced).slots.some((s) => s.chosen.visit.place.id === unreachable.id),
  '결항으로 갈 수 없는 곳이 고정 때문에 편성됐다',
)
assert.ok(
  forced.result.diagnostics.notes.some((n) => n.includes('넣을 수 없어')),
  '고정을 못 지켰으면 화면에 이유를 남겨야 한다',
)

// 쿼리 왕복 — 링크를 다시 열면 같은 계획이 나와야 한다
assert.deepEqual(pinsFromQuery(pinsToQuery(swapped.pins)), swapped.pins)
assert.deepEqual(pinsFromQuery(''), [])
assert.deepEqual(pinsFromQuery(null), [])
assert.deepEqual(pinsFromQuery('a b,../etc,ok-1'), ['ok-1'], '이상한 값은 버린다')
const reopened = buildPlan(input, filtered.candidates, DEFAULT_POLICY, pinsFromQuery(pinsToQuery(swapped.pins)), swapped.seed)
assert.equal(setKey(plan(reopened)), setKey(swappedPlan), '같은 URL 인데 다른 계획이 나온다')

// ------------------------------------------------------------------ 출력

console.log(
  `F2 검증 ok — 실데이터 후보 ${filtered.candidates.length}곳 / 제외 ${filtered.rejected.length}곳` +
    ` (결항 ${filtered.rejected.filter((r) => r.reason === 'cancelled').length}, 기상 ${filtered.rejected.filter((r) => r.reason === 'hazard').length})`,
)
console.log(`  기본 계획 ${basePlan.slots.length}개 시간대, 새로고침 ${keys.size}종 조합, ${target}번 시간대 순회 ${visited.size}곳`)
for (const slot of basePlan.slots) {
  const { visit } = slot.chosen
  const alt = slot.alternatives.map((a) => a.visit.place.name.slice(0, 10)).join(' / ')
  console.log(
    `  ${formatHm(visit.startMinutes)}~${formatHm(visit.endMinutes)} ${visit.place.name.slice(0, 16).padEnd(18)}` +
      ` 이동 ${String(visit.travelMinutes).padStart(3)}분  대안 ${slot.alternatives.length}개 (${alt})`,
  )
}
console.log(`  스와이프: ${target}번 시간대 ${basePlan.slots[target].chosen.visit.place.name} → ${swappedPlan.slots[target].chosen.visit.place.name}`)
