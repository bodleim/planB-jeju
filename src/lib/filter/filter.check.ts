/**
 * F3 필터 검증. 키 없이 돈다 — `npm run check:filter`
 *
 * 마지막 블록이 발표 시나리오(성산항 여객선 결항)를 그대로 재현한다.
 * 이 assert 가 깨지면 시연이 깨진 것이다.
 */
import assert from 'node:assert/strict'
import type { Weather } from '../data/weather.ts'
import { SEONGSAN_PLACES, SEONGSAN_PORT } from '../data/places-seongsan.ts'
import { DEFAULT_POLICY, PLACEHOLDER_POLICY, type Place } from '../types.ts'
import { estimateTravelMinutes, haversineKm } from '../geo.ts'
import { activeRisks, filterCandidates, findCandidates, fmtKst, visitWindow, type FilterContext } from './index.ts'

const kst = (s: string) => new Date(`${s}+09:00`)

const weather = (risks: Weather['risks'], isFallback = false): Weather => ({
  at: '2026-07-27T01:00:00.000Z',
  source: isFallback ? '폴백' : '기상청 단기예보',
  isFallback,
  grid: { nx: 60, ny: 37 },
  hourly: [],
  warnings: [],
  risks,
})

// ------------------------------------------------------------------ geo

assert.equal(Math.round(haversineKm(SEONGSAN_PORT, { lat: 33.458, lon: 126.9425 }) * 10) / 10, 2.1, '성산항→일출봉 직선 2.1km')
assert.equal(haversineKm(SEONGSAN_PORT, SEONGSAN_PORT), 0)
assert.ok(estimateTravelMinutes(SEONGSAN_PORT, { lat: 33.458, lon: 126.9425 }) < 12, '차로 2km 는 12분 미만')
assert.ok(
  estimateTravelMinutes(SEONGSAN_PORT, { lat: 33.3208, lon: 126.8607 }, 'walk') >
    estimateTravelMinutes(SEONGSAN_PORT, { lat: 33.3208, lon: 126.8607 }, 'car'),
  '도보가 차보다 오래 걸린다',
)

// ------------------------------------------------------------------ 영업시간

assert.equal(visitWindow({ open: '10:00', close: '19:00' }, kst('2026-07-27T14:00')), 300, '14시 도착 → 19시까지 300분')
assert.equal(visitWindow({ open: '10:00', close: '19:00' }, kst('2026-07-27T09:00')), null, '개장 전')
assert.equal(visitWindow({ open: '10:00', close: '19:00' }, kst('2026-07-27T19:00')), null, '마감 시각 도착')
assert.equal(
  visitWindow({ open: '10:00', close: '19:00', lastEntryMinutes: 60 }, kst('2026-07-27T18:30')),
  null,
  '입장 마감 60분 전 규칙',
)
assert.equal(
  visitWindow({ open: '10:00', close: '19:00', lastEntryMinutes: 60 }, kst('2026-07-27T17:30')),
  90,
  '마감 90분 전은 입장 가능',
)
// 2026-07-27 은 월요일 — 아래 휴무일 케이스가 이 전제에 기댄다
assert.equal(new Date('2026-07-27T12:00+09:00').getUTCDay(), 1, '2026-07-27 = 월요일')
assert.equal(visitWindow({ open: '10:00', close: '19:00', closedWeekdays: [1] }, kst('2026-07-27T14:00')), null, '월요일 휴무')
assert.equal(visitWindow({ open: '10:00', close: '19:00', closedWeekdays: [2] }, kst('2026-07-27T14:00')), 300, '화요일 휴무는 월요일에 영향 없음')
assert.equal(visitWindow({ open: '18:00', close: '02:00' }, kst('2026-07-27T23:00')), 180, '자정 넘겨 닫는 곳')
// UTC 서버에서도 KST 로 판단 (18:00 UTC = 다음날 03:00 KST → 영업 전)
assert.equal(visitWindow({ open: '10:00', close: '19:00' }, new Date('2026-07-27T18:00:00Z')), null, 'UTC 를 KST 로 환산한다')
assert.equal(fmtKst(new Date('2026-07-27T01:30:00Z')), '10:30')

// ------------------------------------------------------------------ 위험 합집합

assert.deepEqual(activeRisks(weather([]), 'ferry_cancelled').sort(), ['sea', 'wind'], '기상 폴백이어도 원인만으로 위험 확정')
assert.deepEqual(activeRisks(weather(['rain']), 'ferry_cancelled').sort(), ['rain', 'sea', 'wind'], '합집합')
assert.deepEqual(activeRisks(weather(['rain']), 'closed'), ['rain'], '휴무 원인은 기상 위험을 더하지 않는다')

// ------------------------------------------------------------------ 개별 제약

const base: FilterContext = {
  origin: SEONGSAN_PORT,
  now: kst('2026-07-27T10:00'),
  remainingMinutes: 300,
  hasCar: true,
  cause: 'ferry_cancelled',
  weather: weather([]),
  policy: PLACEHOLDER_POLICY,
}

const indoorNearby: Place = {
  id: 't-indoor',
  name: '테스트 실내',
  category: 'culture',
  lat: 33.4746,
  lon: 126.932,
  indoor: true,
  hazards: [],
  stayMinutes: 60,
  hours: { open: '09:00', close: '18:00' },
  verified: true,
  source: 'test',
}
const only = (p: Place, ctx: Partial<FilterContext> = {}) => filterCandidates([p], { ...base, ...ctx })

assert.equal(only(indoorNearby).candidates.length, 1, '실내·근거리·영업중 → 통과')

// 결항: 끊긴 교통편에 의존하는 후보
const ferryPlace = { ...indoorNearby, id: 't-ferry', requires: 'ferry' as const }
assert.equal(only(ferryPlace).rejected[0].reason, 'cancelled')
assert.equal(only(ferryPlace, { cause: 'rain' }).candidates.length, 1, '비 때문이면 배는 상관없다')

// 기상: 같은 위험
const seaPlace = { ...indoorNearby, id: 't-sea', indoor: false, hazards: ['sea' as const] }
assert.equal(only(seaPlace).rejected[0].reason, 'hazard', '여객선 결항 → 해상 후보 제외')
assert.equal(only(seaPlace, { cause: 'closed' }).candidates.length, 1, '휴무 원인이면 해상 위험 없음')
assert.equal(only({ ...seaPlace, indoor: true }).candidates.length, 1, '실내는 기상 위험을 받지 않는다')
const rainPlace = { ...indoorNearby, id: 't-rain', indoor: false, hazards: ['rain' as const] }
assert.equal(only(rainPlace, { cause: 'rain' }).rejected[0].reason, 'hazard', '우천 → 야외 제외')
assert.equal(only(rainPlace).candidates.length, 1, '결항 원인에 강수 위험은 없다')

// 영업 확인 불가
const unverified = { ...indoorNearby, id: 't-null', hours: null }
assert.equal(only(unverified).candidates.length, 1, 'PLACEHOLDER_POLICY 는 미확인도 허용')
assert.equal(only(unverified, { policy: DEFAULT_POLICY }).rejected[0].reason, 'unverified', 'DEFAULT_POLICY 는 자동 편성 제외')

// 거리·시간
const far: Place = { ...indoorNearby, id: 't-far', lat: 33.24, lon: 126.55 } // 서귀포 ~40km
assert.equal(only(far, { hasCar: false }).rejected[0].reason, 'tooFar', '차 없으면 도보 한도 초과')
assert.equal(only(far, { remainingMinutes: 60 }).rejected[0].reason, 'tooFar', '남은 시간에 비해 이동 과다')
assert.equal(only(indoorNearby, { now: kst('2026-07-27T17:45') }).rejected[0].reason, 'noTime', '도착 후 머물 시간 부족')
assert.equal(only(indoorNearby, { now: kst('2026-07-27T19:00') }).rejected[0].reason, 'closed', '영업 종료 후 도착')

// usableMinutes 는 체류시간·남은시간·영업잔여 중 최솟값
const c = only(indoorNearby, { now: kst('2026-07-27T16:30') }).candidates[0]
assert.ok(c.usableMinutes <= 60 && c.usableMinutes >= 30, `체류 상한 60분 안: ${c.usableMinutes}`)
assert.equal(only(indoorNearby, { remainingMinutes: 45 }).candidates[0].usableMinutes, 45 - 5, '남은 시간이 상한일 때')

// ------------------------------------------------------------------ 발표 시나리오

const demo = filterCandidates(SEONGSAN_PLACES, base)
const ids = (xs: { place: Place }[]) => new Set(xs.map((x) => x.place.id))
const kept = ids(demo.candidates)
const cut = new Map(demo.rejected.map((r) => [r.place.id, r.reason]))

assert.deepEqual(demo.risks.sort(), ['sea', 'wind'], '기상 키 없이도 원인으로 위험 확정')
assert.equal(cut.get('udo'), 'cancelled', '우도 — 배가 끊겼다')
for (const id of ['seopjikoji', 'gwangchigi-beach', 'pyoseon-beach', 'seongsan-canola-square', 'seongsan-ilchulbong']) {
  assert.equal(cut.get(id), 'hazard', `${id} — 강풍·해상 위험이 같아 제외돼야 한다`)
}
for (const id of ['aquaplanet-jeju', 'kim-younggap-gallery', 'seongsan-fish-market', 'coffee-museum-baum']) {
  assert.ok(kept.has(id), `${id} — 실내 후보는 남아야 한다`)
}
assert.ok(kept.size >= 5, `후보가 5곳 이상 남아야 F1 이 계획을 만들 수 있다: ${kept.size}`)
assert.equal(kept.size + demo.rejected.length, SEONGSAN_PLACES.length, '모든 장소가 통과 또는 제외로 분류된다')

// 통과한 후보는 전부 불변식을 만족한다
for (const c of demo.candidates) {
  assert.ok(c.usableMinutes >= PLACEHOLDER_POLICY.minStayMinutes, `${c.place.name}: 최소 체류 미달`)
  assert.ok(c.travelMinutes + c.usableMinutes <= base.remainingMinutes, `${c.place.name}: 남은 시간 초과`)
  if (c.place.hours) assert.notEqual(visitWindow(c.place.hours, c.arriveAt), null, `${c.place.name}: 도착 시각에 닫혀 있다`)
  assert.ok(!c.place.indoor ? !c.place.hazards.some((h) => demo.risks.includes(h)) : true, `${c.place.name}: 같은 위험 잔존`)
}

// 실데이터가 오면 DEFAULT_POLICY 로 돌아가야 한다 — 지금은 미확인이 대부분이라 후보가 준다
const strict = filterCandidates(SEONGSAN_PLACES, { ...base, policy: DEFAULT_POLICY })
assert.ok(strict.candidates.length < demo.candidates.length, 'DEFAULT_POLICY 는 미확인 장소를 걷어낸다')
assert.ok(strict.candidates.length > 0, 'DEFAULT_POLICY 로도 후보가 남는다 (운영시간 있는 실내 장소들)')

// 진입점 — 기상 API 를 붙여도 (키가 없어 폴백이어도) 후보가 나온다
const live = await findCandidates({
  origin: SEONGSAN_PORT,
  remainingMinutes: 300,
  hasCar: true,
  cause: 'ferry_cancelled',
  now: base.now,
})
assert.ok(live.candidates.length > 0, '기상 폴백이어도 후보는 나와야 한다 (시연 중 네트워크 단절 대비)')
assert.ok(live.risks.includes('sea'), '폴백이어도 결항 원인으로 해상 위험은 확정된다')
assert.equal(ids(live.rejected).has('udo'), true, '진입점에서도 우도는 제외된다')

console.log(`F3 필터 검증 ok — 후보 ${demo.candidates.length}곳 / 제외 ${demo.rejected.length}곳 (엄격 정책: ${strict.candidates.length}곳)`)
console.log(`  진입점 findCandidates: 후보 ${live.candidates.length}곳, 기상 ${live.weatherFallback ? '폴백(확인 필요)' : '실시간'}, 위험 ${JSON.stringify(live.risks)}`)
for (const c of demo.candidates) {
  console.log(`  후보  ${c.place.name.padEnd(14)} 이동 ${String(c.travelMinutes).padStart(3)}분  도착 ${fmtKst(c.arriveAt)}  체류 ${c.usableMinutes}분`)
}
for (const r of demo.rejected) {
  console.log(`  제외  ${r.place.name.padEnd(14)} ${r.detail}`)
}
