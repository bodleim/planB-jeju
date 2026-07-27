/**
 * F3 필터 + F1 파이프라인 검증. 키 없이 돈다 — `npm run check:filter`
 *
 * 마지막 두 블록이 발표 시나리오(성산항 여객선 결항)를 그대로 재현한다.
 * F3 → F1 을 이어서 돌려 '통과한 후보로 만든 계획이 불변식을 지키는지'까지 본다.
 * 이 assert 가 깨지면 시연이 깨진 것이다.
 */
import assert from 'node:assert/strict'
import type { Weather } from '../data/weather.ts'
import { ORIGINS, SEONGSAN_PLACES } from '../data/places-seongsan.ts'
import { estimateTravelMinutes, haversineKm, travelModeFor } from '../geo.ts'
import { alwaysOpen, weeklyHours } from '../hours.ts'
import { DEFAULT_POLICY, PLACEHOLDER_POLICY, generatePlan, isSingleCategory } from '../plan/index.ts'
import { formatHm, jejuClock, parseHm } from '../time.ts'
import type { Place, TripCategory } from '../types.ts'
import {
  EXPOSURE_RISKS,
  activeRisks,
  filterCandidates,
  findCandidates,
  type FilterContext,
} from './index.ts'

const SEONGSAN_PORT = ORIGINS.seongsan_port.coord
const ILCHULBONG = ORIGINS.seongsan_ilchulbong.coord
const MONDAY = 1 as const

const weather = (risks: Weather['risks'], isFallback = false): Weather => ({
  at: '2026-07-27T01:00:00.000Z',
  source: isFallback ? '폴백' : '기상청 단기예보',
  isFallback,
  grid: { nx: 60, ny: 37 },
  hourly: [],
  warnings: [],
  risks,
})

// ------------------------------------------------------------------ geo / 시각

assert.equal(haversineKm(SEONGSAN_PORT, SEONGSAN_PORT), 0)
const portToIlchulbong = haversineKm(SEONGSAN_PORT, ILCHULBONG)
assert.ok(portToIlchulbong > 1.5 && portToIlchulbong < 2.5, `성산항→일출봉 2km 대: ${portToIlchulbong}`)
assert.ok(estimateTravelMinutes(SEONGSAN_PORT, ILCHULBONG, 'car') < 15, '차로 2km 는 15분 미만')
assert.ok(
  estimateTravelMinutes(SEONGSAN_PORT, ILCHULBONG, 'walk') >
    estimateTravelMinutes(SEONGSAN_PORT, ILCHULBONG, 'car'),
  '도보가 차보다 오래 걸린다',
)
assert.equal(travelModeFor(true, 40), 'car')
assert.equal(travelModeFor(false, 0.5), 'walk', '도보권은 걷는다')
assert.equal(travelModeFor(false, 40), 'transit', '도보 한도를 넘으면 대중교통')
// 서버가 UTC 로 돌아도 제주 기준으로 판단한다 (01:30Z = 10:30 KST)
assert.equal(formatHm(jejuClock(new Date('2026-07-27T01:30:00Z')).minuteOfDay), '10:30')
assert.equal(jejuClock(new Date('2026-07-27T01:30:00Z')).weekday, MONDAY, '2026-07-27 = 월요일')

// ------------------------------------------------------------------ 위험 합집합

assert.deepEqual(activeRisks(weather([]), 'ferry_cancelled').sort(), ['sea', 'wind'], '기상 폴백이어도 원인만으로 위험 확정')
assert.deepEqual(activeRisks(weather(['rain']), 'ferry_cancelled').sort(), ['rain', 'sea', 'wind'], '합집합')
assert.deepEqual(activeRisks(weather(['rain']), 'closed'), ['rain'], '휴무 원인은 기상 위험을 더하지 않는다')
assert.deepEqual(EXPOSURE_RISKS.indoor, [], '실내는 기상 위험을 받지 않는다')
assert.ok(EXPOSURE_RISKS.marine.includes('sea') && EXPOSURE_RISKS.coastal.includes('sea'))

// ------------------------------------------------------------------ 개별 제약

const base: FilterContext = {
  origin: SEONGSAN_PORT,
  startMinutes: parseHm('10:00'),
  weekday: MONDAY,
  remainingMinutes: 300,
  hasCar: true,
  cause: 'ferry_cancelled',
  weather: weather([]),
  policy: PLACEHOLDER_POLICY,
}

const indoorNearby: Place = {
  id: 't-indoor',
  name: '테스트 실내',
  area: '성산',
  coord: { lat: 33.4746, lng: 126.932 },
  exposure: 'indoor',
  companionFit: { family: 1, couple: 1, solo: 1 },
  activityFit: { indoor: 1 },
  stayMinutes: 60,
  minStayMinutes: 30,
  costPerPerson: 0,
  hours: weeklyHours('09:00', '18:00'),
  lastAdmissionBeforeClose: 0,
  verified: true,
  source: 'test',
}
const only = (p: Place, ctx: Partial<FilterContext> = {}) => filterCandidates([p], { ...base, ...ctx })
const reasonOf = (p: Place, ctx: Partial<FilterContext> = {}) => only(p, ctx).rejected[0]?.reason

assert.equal(only(indoorNearby).candidates.length, 1, '실내·근거리·영업중 → 통과')

// 결항: 끊긴 교통편에 의존하는 후보
const ferryPlace: Place = { ...indoorNearby, id: 't-ferry', dependsOn: 'ferry' }
assert.equal(reasonOf(ferryPlace), 'cancelled')
assert.equal(only(ferryPlace, { cause: 'rain' }).candidates.length, 1, '비 때문이면 배는 상관없다')

// 기상: 같은 위험
const coastal: Place = { ...indoorNearby, id: 't-sea', exposure: 'coastal' }
assert.equal(reasonOf(coastal), 'hazard', '여객선 결항 → 해상 후보 제외')
assert.equal(only(coastal, { cause: 'closed' }).candidates.length, 1, '휴무 원인이면 해상 위험 없음')
const outdoor: Place = { ...indoorNearby, id: 't-rain', exposure: 'outdoor' }
assert.equal(reasonOf(outdoor, { cause: 'rain' }), 'hazard', '우천 → 야외 제외')
assert.equal(only(outdoor, { cause: 'closed' }).candidates.length, 1)

// 영업 확인 불가
const unverified: Place = { ...indoorNearby, id: 't-unverified', verified: false }
assert.equal(only(unverified).candidates.length, 1, 'PLACEHOLDER_POLICY 는 미확인도 허용')
assert.equal(reasonOf(unverified, { policy: DEFAULT_POLICY }), 'unverified', 'DEFAULT_POLICY 는 자동 편성 제외')

// 영업시간·휴무·체류시간
assert.equal(reasonOf({ ...indoorNearby, hours: weeklyHours('09:00', '18:00', { closedOn: [MONDAY] }) }), 'closed_that_day')
assert.equal(reasonOf(indoorNearby, { startMinutes: parseHm('17:50') }), 'stay_too_short', '도착 후 머물 시간 부족')
assert.equal(reasonOf(indoorNearby, { startMinutes: parseHm('19:00') }), 'closed_on_arrival', '영업 종료 후 도착')
assert.equal(
  reasonOf({ ...indoorNearby, hours: weeklyHours('09:00', '18:00'), lastAdmissionBeforeClose: 120 }, { startMinutes: parseHm('16:30') }),
  'closed_on_arrival',
  '입장 마감 규칙',
)

// 거리 — 편도 이동이 남은 시간의 maxTravelShare 를 넘으면 제외
const far: Place = { ...indoorNearby, id: 't-far', coord: { lat: 33.24, lng: 126.55 }, hours: alwaysOpen() } // 서귀포 ~40km
assert.equal(reasonOf(far, { remainingMinutes: 60 }), 'tooFar', '남은 시간에 비해 이동 과다')
assert.equal(reasonOf(far, { hasCar: false }), 'tooFar', '차 없이 대중교통으로도 과다')

// ------------------------------------------------------------------ 발표 시나리오: F3

const demo = filterCandidates(SEONGSAN_PLACES, base)
const kept = new Set(demo.candidates.map((p) => p.id))
const cut = new Map(demo.rejected.map((r) => [r.place.id, r.reason]))

assert.deepEqual(demo.risks.sort(), ['sea', 'wind'], '기상 키 없이도 원인으로 위험 확정')
assert.equal(cut.get('udo-seobin-baeksa'), 'cancelled', '우도 — 배가 끊겼다')
for (const id of ['seopjikoji', 'gwangchigi-beach', 'pyoseon-beach', 'seongsan-ilchulbong', 'honinji']) {
  assert.equal(cut.get(id), 'hazard', `${id} — 강풍·해상 위험이 같아 제외돼야 한다`)
}
for (const id of ['aquaplanet-jeju', 'kimyounggap-gallery', 'seongsanpo-fish-market']) {
  assert.ok(kept.has(id), `${id} — 실내·차양 후보는 남아야 한다`)
}
assert.ok(kept.size >= 5, `후보가 5곳 이상 남아야 F1 이 계획을 만들 수 있다: ${kept.size}`)
assert.equal(kept.size + demo.rejected.length, SEONGSAN_PLACES.length, '모든 장소가 통과 또는 제외로 분류된다')

// 통과한 후보는 전부 불변식을 만족한다
for (const place of demo.candidates) {
  assert.equal(
    EXPOSURE_RISKS[place.exposure].filter((h) => demo.risks.includes(h)).length,
    0,
    `${place.name}: 같은 위험 잔존`,
  )
  assert.notEqual(place.dependsOn, 'ferry', `${place.name}: 끊긴 여객선에 의존`)
}

// 실데이터가 오면 DEFAULT_POLICY 로 돌아가야 한다 — 지금은 전부 미확인이라 후보가 0곳이다
const strict = filterCandidates(SEONGSAN_PLACES, { ...base, policy: DEFAULT_POLICY })
assert.ok(strict.candidates.length < demo.candidates.length, 'DEFAULT_POLICY 는 미확인 장소를 걷어낸다')
assert.ok(
  strict.rejected.every((r) => r.reason !== 'unverified' || !r.place.verified),
  'unverified 로 걸린 건 실제로 미확인인 장소뿐',
)

// ------------------------------------------------------------------ 발표 시나리오: F3 → F1

const category: TripCategory = { companion: 'couple', activity: 'indoor' }
const plan = generatePlan(
  {
    origin: SEONGSAN_PORT,
    startMinutes: base.startMinutes,
    remainingMinutes: base.remainingMinutes,
    category,
    hasCar: true,
    weekday: MONDAY,
    seed: 7,
  },
  demo.candidates,
  PLACEHOLDER_POLICY,
).plan

assert.ok(plan !== null, `F3 후보로 계획이 나와야 한다: ${JSON.stringify(demo.candidates.map((p) => p.id))}`)
assert.ok(plan.slots.length >= 2, `시간대가 2개 이상: ${plan.slots.length}`)
assert.ok(isSingleCategory(plan), '일정 전체가 한 카테고리 조합을 따른다')
assert.ok(plan.totals.endMinutes <= base.startMinutes + base.remainingMinutes, '남은 시간 안에 완주')
for (const slot of plan.slots) {
  const { visit } = slot.chosen
  const open = visit.place.hours[MONDAY]
  assert.ok(
    open.some((i) => visit.startMinutes >= i.open && visit.startMinutes < i.close),
    `${visit.place.name}: 도착 시각(${formatHm(visit.startMinutes)})에 열려 있지 않다`,
  )
  assert.equal(
    EXPOSURE_RISKS[visit.place.exposure].filter((h) => demo.risks.includes(h)).length,
    0,
    `${visit.place.name}: F3 가 걸러야 할 위험이 계획에 들어왔다`,
  )
  assert.ok(slot.alternatives.length >= 1, `${visit.place.name}: 스와이프할 대안이 없다`)
}
// 새로고침(seed 변경)은 다른 조합을 준다
const setKey = (p: NonNullable<typeof plan>) => p.slots.map((s) => s.chosen.visit.place.id).join('>')
const seeds = new Set(
  [1, 2, 3, 4, 5].map((seed) => {
    const p = generatePlan(
      { origin: SEONGSAN_PORT, startMinutes: base.startMinutes, remainingMinutes: base.remainingMinutes, category, hasCar: true, weekday: MONDAY, seed },
      demo.candidates,
      PLACEHOLDER_POLICY,
    ).plan
    return p ? setKey(p) : 'null'
  }),
)
assert.ok(seeds.size >= 2, `새로고침마다 조합이 달라져야 한다: ${JSON.stringify([...seeds])}`)

// 진입점 — 기상 API 를 붙여도 (키가 없어 폴백이어도) 후보가 나온다
const live = await findCandidates({
  origin: SEONGSAN_PORT,
  remainingMinutes: 300,
  hasCar: true,
  cause: 'ferry_cancelled',
  startMinutes: base.startMinutes,
  weekday: MONDAY,
})
assert.ok(live.candidates.length > 0, '기상 폴백이어도 후보는 나와야 한다 (시연 중 네트워크 단절 대비)')
assert.ok(live.risks.includes('sea'), '폴백이어도 결항 원인으로 해상 위험은 확정된다')
assert.ok(live.rejected.some((r) => r.place.dependsOn === 'ferry'), '진입점에서도 우도는 제외된다')

// ------------------------------------------------------------------ 출력

console.log(`F3 필터 검증 ok — 후보 ${demo.candidates.length}곳 / 제외 ${demo.rejected.length}곳 (엄격 정책: ${strict.candidates.length}곳)`)
console.log(`  진입점 findCandidates: 후보 ${live.candidates.length}곳, 기상 ${live.weatherFallback ? '폴백(확인 필요)' : '실시간'}, 위험 ${JSON.stringify(live.risks)}`)
for (const place of demo.candidates) {
  const km = Math.round(haversineKm(SEONGSAN_PORT, place.coord) * 10) / 10
  console.log(`  후보  ${place.name.padEnd(16)} ${place.exposure.padEnd(8)} ${String(km).padStart(5)}km`)
}
for (const r of demo.rejected) {
  console.log(`  제외  ${r.place.name.padEnd(16)} ${r.detail}`)
}
console.log(`F1 계획 검증 ok — ${plan.slots.length}개 시간대, ${formatHm(plan.totals.startMinutes)}~${formatHm(plan.totals.endMinutes)}, 조합 ${seeds.size}종`)
for (const slot of plan.slots) {
  const { visit } = slot.chosen
  console.log(
    `  ${formatHm(visit.startMinutes)}~${formatHm(visit.endMinutes)}  ${visit.place.name.padEnd(16)}` +
      ` 이동 ${String(visit.travelMinutes).padStart(3)}분  대안 ${slot.alternatives.length}개`,
  )
}
