/**
 * TourAPI 실데이터 로더 검증. 키 없이 돈다 (커밋된 스냅샷만 읽는다) — `npm run check:places`
 *
 * 운영시간 파서가 이 프로젝트에서 제일 조용히 틀릴 수 있는 코드다. 틀리면 문 닫은 곳이
 * 일정에 뜨는데, 화면만 봐서는 알 수 없다. 그래서 스냅샷 103건을 전부 통과시키고
 * 손으로 확인한 몇 건을 고정 assert 로 박아 둔다.
 */
import assert from 'node:assert/strict'
import { PLACES_SNAPSHOT, PLACE_LOAD, JEJU_PLACES, islandOf, parseFeeWon, parseSpendMinutes } from './places.ts'
import { parseClosedDays, parseOpenHours } from './tour-hours.ts'
import { formatHm } from '../time.ts'
import type { Weekday } from '../types.ts'

const JULY = 7
const hhmm = (parsed: ReturnType<typeof parseOpenHours>, day: Weekday = 1) =>
  parsed === null ? null : parsed.hours[day].map((i) => `${formatHm(i.open)}-${formatHm(i.close)}`).join(',')

// ------------------------------------------------------------------ 영업시간 파서

assert.equal(hhmm(parseOpenHours('09:00~18:00', JULY)), '09:00-18:00')
assert.equal(hhmm(parseOpenHours('9:30~18:00 (입장 마감 17:30)', JULY)), '09:30-18:00', '한 자리 시각')
assert.equal(parseOpenHours('9:30~18:00 (입장 마감 17:30)', JULY)?.lastAdmissionBeforeClose, 30)
assert.equal(parseOpenHours('08:00~22:00 (라스트오더 21:30)', JULY)?.lastAdmissionBeforeClose, 30)
assert.equal(parseOpenHours('08:00~20:00 (19:15 라스트오더)', JULY)?.lastAdmissionBeforeClose, 45, '시각이 앞에 오는 표기')
assert.equal(parseOpenHours('- 10:00~20:30<br>- 마지막 주문 19:50', JULY)?.lastAdmissionBeforeClose, 40)
assert.equal(parseOpenHours('상시 개방', JULY)?.lastAdmissionBeforeClose, 0)
assert.equal(hhmm(parseOpenHours('상시 개방', JULY)), '00:00-24:00')
assert.equal(hhmm(parseOpenHours('상시 개방<br>※ 여객선 이용 시 배 운항시간 확인 요망', JULY)), '00:00-24:00')

// 브레이크타임은 두 구간으로 쪼갠다 — 이걸 놓치면 쉬는 시간에 방문 일정이 잡힌다
assert.equal(
  hhmm(parseOpenHours('11:00~20:30 (16:00~17:00 브레이크타임)<br>19:30 라스트오더', JULY)),
  '11:00-16:00,17:00-20:30',
)
assert.equal(
  hhmm(parseOpenHours('10:30~21:00 (준비시간 15:30~17:00)', JULY)),
  '10:30-15:30,17:00-21:00',
)
assert.equal(
  hhmm(parseOpenHours('- 07:30~17:00<br>- 준비시간 15:00~15:30<br>- 마지막 주문 16:30', JULY)),
  '07:30-15:00,15:30-17:00',
)

// 계절별 — 기준 달의 줄만 고른다
const ilchulbong =
  '- 1~2월, 11~12월 06:00~18:00 (매표마감 17:00)<br>- 3~4월, 9~10월 05:00~19:00 (매표마감 18:00)<br>- 5~8월 04:30~20:00 (매표마감 19:00)'
assert.equal(hhmm(parseOpenHours(ilchulbong, JULY)), '04:30-20:00', '7월은 5~8월 구간')
assert.equal(hhmm(parseOpenHours(ilchulbong, 1)), '06:00-18:00', '1월은 1~2월 구간')
assert.equal(hhmm(parseOpenHours(ilchulbong, 10)), '05:00-19:00', '10월은 9~10월 구간')
assert.equal(parseOpenHours(ilchulbong, JULY)?.lastAdmissionBeforeClose, 60)
assert.equal(
  hhmm(parseOpenHours('- 봄 (3월~6월) / 가을 (9월~10월) 09:30~18:00<br>- 여름 (7월~8월) 09:30~18:30<br>- 겨울 (11월~2월) 09:30~17:00', JULY)),
  '09:30-18:30',
)
assert.equal(parseOpenHours('11월 중순~3월 중순 09:00~18:00', JULY), null, '7월이 어느 구간에도 없으면 포기')

// 확신할 수 없는 것은 전부 null — 추측해서 채우지 않는다
assert.equal(parseOpenHours('', JULY), null)
assert.equal(parseOpenHours('※ 통제될 수 있으므로 방문 시 전화문의 요망', JULY), null)
assert.equal(parseOpenHours('1일 1회 14:00<br>※ 기상상황에 따라 변동되므로 전화문의 요망', JULY), null)
assert.equal(parseOpenHours('[평일]<br>- 07:00~20:30<br>[토요일]<br>- 07:00~15:00', JULY), null, '요일별은 못 다룬다')
assert.equal(parseOpenHours('10:00~17:00<br>※ 전화 예약 필수', JULY), null, '예약 필수는 자동 편성 대상이 아니다')
assert.equal(parseOpenHours('08:00~14:00<br>※ 점포별 상이함', JULY), null)

// ------------------------------------------------------------------ 휴무일 파서

assert.deepEqual(parseClosedDays('연중무휴'), [])
assert.deepEqual(parseClosedDays('연중무휴 (기상 악화 시 휴항)'), [])
assert.deepEqual(parseClosedDays('매주 수요일'), [3])
assert.deepEqual(parseClosedDays('매주 화요일, 수요일'), [2, 3])
assert.deepEqual(parseClosedDays('매주 월요일 / 1월 1일 / 설·추석 당일'), [1], '주간 휴무만 읽는다')
assert.equal(parseClosedDays('매월 첫째 화요일'), null, '월 단위는 주간 표에 못 담는다')
assert.equal(parseClosedDays('매달 첫째 주 월요일<br>※ 공휴일인 경우 다음날 휴무'), null)
assert.equal(parseClosedDays('비정기 휴무 <br>※ 공식 인스타그램 참고 바람'), null)
assert.equal(parseClosedDays(''), null)

// ------------------------------------------------------------------ 부가 필드

assert.equal(parseSpendMinutes('약 2시간'), 120)
assert.equal(parseSpendMinutes('1시간 이내'), 60)
assert.equal(parseSpendMinutes('1시간 30분'), 90)
assert.equal(parseSpendMinutes(''), null)
assert.equal(parseFeeWon('- 대인 9,900원<br>- 소인 6,000원<br>※ 무료 유아'), 9900)
assert.equal(parseFeeWon('무료'), 0)
assert.equal(parseFeeWon('무료 (모카포트 체험 18,000원)'), 0, '무료가 먼저면 무료')
assert.equal(parseFeeWon(''), null)

// ------------------------------------------------------------------ 스냅샷 전체

assert.ok(PLACES_SNAPSHOT.total >= 100, `스냅샷이 비었다: ${PLACES_SNAPSHOT.total}`)
assert.ok(
  PLACES_SNAPSHOT.loaded / PLACES_SNAPSHOT.total >= 0.7,
  `파싱률이 70% 미만: ${PLACES_SNAPSHOT.loaded}/${PLACES_SNAPSHOT.total}`,
)
assert.deepEqual(PLACE_LOAD.unmappedCat3, [], `EXPOSURE_BY_CAT3 에 없는 코드: ${PLACE_LOAD.unmappedCat3}`)

for (const place of JEJU_PLACES) {
  assert.ok(place.name.length > 0 && place.id.startsWith('tour-'), `id/name: ${place.id}`)
  assert.ok(place.coord.lat > 33 && place.coord.lat < 34, `${place.name}: 위도 이상 ${place.coord.lat}`)
  assert.ok(place.coord.lng > 126 && place.coord.lng < 127.5, `${place.name}: 경도 이상 ${place.coord.lng}`)
  assert.equal(place.hours.length, 7, `${place.name}: 요일 7개`)
  assert.ok(place.stayMinutes >= place.minStayMinutes, `${place.name}: 체류시간 역전`)
  assert.ok(
    Object.values(place.activityFit).some((v) => v > 0),
    `${place.name}: 활동 성격 적합도가 전부 0이면 어떤 일정에도 못 들어간다`,
  )
  for (const day of place.hours) {
    for (const interval of day) {
      assert.ok(interval.open < interval.close, `${place.name}: 영업 구간 역전`)
      assert.ok(interval.close <= 1440, `${place.name}: 자정 초과`)
    }
  }
}

// 부속섬은 배로만 간다 — 결항 시나리오의 핵심이라 실데이터에서도 확인한다
const ferry = JEJU_PLACES.filter((p) => p.dependsOn === 'ferry')
assert.ok(ferry.length >= 5, `여객선 의존 후보가 ${ferry.length}곳뿐 — 결항 시연이 약해진다`)
// 여객선 의존으로 분류된 곳은 반드시 부속섬 좌표 상자(islandOf) 안이어야 한다 —
// 육지 명소가 섬으로 잘못 잡히면 결항 때 멀쩡한 후보가 사라진다.
for (const place of ferry) {
  assert.ok(
    islandOf(place.coord) !== null,
    `${place.name}: 여객선 의존으로 분류됐는데 좌표가 부속섬 밖이다 (${place.coord.lat}, ${place.coord.lng})`,
  )
}
// 결항 시연의 무대인 우도 후보가 실제로 있어야 한다
assert.ok(
  ferry.some((p) => islandOf(p.coord) === '우도'),
  '우도 후보가 없다 — 성산항 결항 시나리오가 성립하지 않는다',
)
assert.ok(
  !JEJU_PLACES.some((p) => p.dependsOn === 'ferry' && /성산일출봉|섭지코지|광치기/.test(p.name)),
  '육지 명소가 여객선 의존으로 잘못 분류됐다',
)

// 노출도 — 기상 필터가 이 값에 통째로 걸려 있다
const byName = (needle: string) => JEJU_PLACES.find((p) => p.name.includes(needle))
assert.equal(byName('광치기해변')?.exposure, 'coastal')
assert.equal(byName('아쿠아플라넷')?.exposure, 'indoor')
assert.equal(byName('성산항')?.exposure, 'coastal')
assert.equal(byName('커피박물관')?.exposure, 'indoor')

console.log(
  `TourAPI 로더 검증 ok — ${PLACES_SNAPSHOT.loaded}/${PLACES_SNAPSHOT.total}곳 적재` +
    ` (운영정보 확인 불가 ${PLACES_SNAPSHOT.skipped}곳 제외), 기준시각 ${PLACES_SNAPSHOT.fetchedAt}`,
)
const verified = JEJU_PLACES.filter((p) => p.verified).length
console.log(`  운영정보 확정 ${verified}곳 / 휴무일 미확인 ${PLACES_SNAPSHOT.loaded - verified}곳, 여객선 의존 ${ferry.length}곳`)
const byExposure = new Map<string, number>()
for (const p of JEJU_PLACES) byExposure.set(p.exposure, (byExposure.get(p.exposure) ?? 0) + 1)
console.log(`  노출도 ${[...byExposure].map(([k, v]) => `${k} ${v}`).join(' / ')}`)
for (const skipped of PLACE_LOAD.unparsed) {
  console.log(`  제외  ${skipped.title.slice(0, 20).padEnd(22)} ${skipped.raw.replace(/\s+/g, ' ').slice(0, 60) || '(운영시간 없음)'}`)
}
