/**
 * F3 필터 검증 — 제약 하나하나를 합성 후보로 찔러 본다. 키 없이 돈다. `npm run check:filter`
 *
 * 여기는 **제약 단위** 검증이다. 합성 후보를 써서 '이 조건이면 이 이유로 빠진다' 만 본다.
 * 실데이터로 발표 시나리오를 끝까지 돌리는 건 `npm run check:plan` 이 한다 — 갈라 둔 이유는
 * 여기서 실데이터 장소 id 를 박아 두면 스냅샷을 다시 받을 때마다 깨지기 때문이다.
 */
import assert from 'node:assert/strict'
import type { Weather } from '../data/weather.ts'
import { ORIGINS, SEONGSAN_PLACES } from '../data/places.ts'
import { estimateTravelMinutes, haversineKm, travelModeFor } from '../geo.ts'
import { alwaysOpen, weeklyHours } from '../hours.ts'
import { DEFAULT_POLICY, PLACEHOLDER_POLICY } from '../plan/index.ts'
import { formatHm, jejuClock, parseHm } from '../time.ts'
import type { Place } from '../types.ts'
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
// 결항이 아니어도 배를 타야 하는 곳은 제외한다 — 이동시간 추정이 배편을 모른다.
// 성산항 좌표에서 판정하므로 우도 권역 밖이다.
assert.equal(reasonOf(ferryPlace, { cause: 'rain' }), 'needsTransfer', '비 때문이어도 배는 못 탄다')
assert.equal(
  only(ferryPlace, { cause: 'rain', origin: { lat: 33.505, lng: 126.952 } }).candidates.length,
  1,
  '이미 우도 안에 있으면 우도 후보를 쓸 수 있다',
)

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

// ------------------------------------------------------------------ 실데이터 연결 확인

// 스냅샷을 다시 받아도 깨지지 않을 성질만 본다 (개별 장소 id 는 check:plan 쪽에서도 안 박는다).
// 실데이터에는 운영정보가 확인된 장소가 있으므로 여기서는 DEFAULT_POLICY 를 쓴다
// (위 개별 제약 블록은 미확인 허용 동작을 보려고 PLACEHOLDER_POLICY 를 쓴다).
const real = filterCandidates(SEONGSAN_PLACES, { ...base, policy: DEFAULT_POLICY })
assert.ok(real.candidates.length > 0, '실데이터로 후보가 하나도 안 남았다')
assert.equal(
  real.candidates.length + real.rejected.length,
  SEONGSAN_PLACES.length,
  '모든 장소가 통과 또는 제외로 분류된다',
)
assert.ok(
  real.candidates.every((p) => p.verified),
  'DEFAULT_POLICY 인데 운영 미확인 장소가 후보에 남았다',
)
assert.ok(
  real.candidates.every((p) => p.dependsOn !== 'ferry'),
  '여객선 결항인데 배로만 가는 후보가 남았다',
)
assert.ok(
  real.candidates.every((p) => EXPOSURE_RISKS[p.exposure].every((h) => !real.risks.includes(h))),
  '같은 기상 위험을 가진 후보가 남았다',
)
assert.ok(
  real.rejected.every((r) => r.detail.length > 0),
  '제외 이유 문구가 빈 항목이 있다 — 화면이 왜 빠졌는지 설명할 수 없다',
)

// 진입점 — 기상 API 가 폴백이어도 후보는 나와야 한다 (시연 중 네트워크 단절 대비)
const live = await findCandidates({
  origin: SEONGSAN_PORT,
  remainingMinutes: 300,
  hasCar: true,
  cause: 'ferry_cancelled',
  startMinutes: base.startMinutes,
  weekday: MONDAY,
})
assert.ok(live.candidates.length > 0, '진입점에서 후보가 안 나온다')
assert.ok(live.risks.includes('sea'), '폴백이어도 결항 원인으로 해상 위험은 확정된다')

const counts = new Map<string, number>()
for (const r of real.rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1)
console.log(
  `F3 필터 검증 ok — 제약 단위 assert 통과, 실데이터 후보 ${real.candidates.length}곳 / 제외 ${real.rejected.length}곳`,
)
console.log(`  제외 이유별: ${[...counts].map(([k, v]) => `${k} ${v}`).join(' / ')}`)
console.log(
  `  진입점 findCandidates: 후보 ${live.candidates.length}곳, 기상 ${live.weatherFallback ? '폴백(확인 필요)' : '실시간'}, 위험 ${JSON.stringify(live.risks)}`,
)
