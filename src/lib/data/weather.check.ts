/**
 * weather.ts 자체 검증. 키 없이 돈다.
 *   npm run check:weather          로직만
 *   npm run check:weather -- live  DATA_GO_KR_KEY 있으면 실제 호출까지
 *
 * 예보 시각·격자 변환·파싱을 건드렸으면 여기 assert 부터 확인할 것.
 */
import assert from 'node:assert/strict'
import {
  deriveRisks,
  getWeather,
  kmaBaseTime,
  latLonToGrid,
  parseVilageFcst,
  parseWarnings,
  SEONGSAN_PORT,
  withinHours,
} from './weather.ts'

const kst = (s: string) => new Date(`${s}+09:00`)

// 발표시각 — apis.py _self_test 와 같은 케이스
assert.deepEqual(kmaBaseTime(kst('2026-07-27T13:00')), { baseDate: '20260727', baseTime: '1100' })
assert.deepEqual(kmaBaseTime(kst('2026-07-27T11:30')), { baseDate: '20260727', baseTime: '0800' }) // 45분 지연 미달
assert.deepEqual(kmaBaseTime(kst('2026-07-27T00:30')), { baseDate: '20260726', baseTime: '2300' }) // 자정 전날 롤백
assert.deepEqual(kmaBaseTime(kst('2026-07-27T02:00')), { baseDate: '20260726', baseTime: '2300' }) // 02시 발표 전
assert.deepEqual(kmaBaseTime(kst('2026-01-01T00:10')), { baseDate: '20251231', baseTime: '2300' }) // 연말 롤백

// 격자 변환 — 기상청 dfs_xy_conv 표준 검증값
assert.deepEqual(latLonToGrid(37.5665, 126.978), { nx: 60, ny: 127 }, '서울시청')
const seongsan = latLonToGrid(SEONGSAN_PORT.lat, SEONGSAN_PORT.lon)
assert.ok(seongsan.nx > 52 && seongsan.ny < 40, `성산은 제주시(52,38) 동쪽/남쪽: ${JSON.stringify(seongsan)}`)

// 응답 파싱
const fcst = {
  response: {
    header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
    body: {
      items: {
        item: [
          { fcstDate: '20260727', fcstTime: '1200', category: 'TMP', fcstValue: '29' },
          { fcstDate: '20260727', fcstTime: '1200', category: 'PCP', fcstValue: '강수없음' },
          { fcstDate: '20260727', fcstTime: '1200', category: 'WSD', fcstValue: '11.2' },
          { fcstDate: '20260727', fcstTime: '1200', category: 'WAV', fcstValue: '2.0' },
          { fcstDate: '20260727', fcstTime: '1300', category: 'PCP', fcstValue: '1mm 미만' },
          { fcstDate: '20260727', fcstTime: '1300', category: 'POP', fcstValue: '80' },
          { fcstDate: '20260727', fcstTime: '1300', category: 'WSD', fcstValue: '3.0' },
        ],
      },
    },
  },
}
const hourly = parseVilageFcst(fcst)
assert.equal(hourly.length, 2, '같은 시각은 한 행으로 합친다')
assert.deepEqual(hourly[0], {
  time: '2026-07-27T12:00+09:00',
  rainMm: 0,
  tempC: 29,
  windMs: 11.2,
  waveM: 2,
})
assert.equal(hourly[1].rainMm, 0.05, "'1mm 미만' → 0.05")

// 에러 응답은 던진다 (data.go.kr 은 키 오류도 200 으로 준다)
assert.throws(() => parseVilageFcst({ response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } }))
assert.throws(() => parseVilageFcst('<OpenAPI_ServiceResponse>...'))

// 단일 item 도 배열로
assert.deepEqual(
  parseWarnings({ response: { header: { resultCode: '00' }, body: { items: { item: { title: '[제주도] 강풍주의보 발효' } } } } }),
  ['[제주도] 강풍주의보 발효'],
)

// 위험 판정
assert.deepEqual(deriveRisks([hourly[0]]).sort(), ['sea', 'wind'], '풍속 11.2 + 파고 2.0')
assert.deepEqual(deriveRisks([hourly[1]]), ['rain'], '강수확률 80')
assert.deepEqual(deriveRisks([], ['[제주도] 풍랑주의보 발효']), ['sea'], '특보 단독으로도 태그가 뜬다')
assert.deepEqual(deriveRisks([], ['특보 없음']), [])
assert.deepEqual(deriveRisks([{ time: 'x', rainMm: 0, tempC: 34 }]), ['heat'])

// 구간 필터
const base = kst('2026-07-27T12:00')
assert.equal(withinHours(hourly, 1, base).length, 2)
assert.equal(withinHours(hourly, 0, base).length, 1)
assert.equal(withinHours(hourly, 12, kst('2026-07-28T00:00')).length, 0, '지난 예보는 버린다')

console.log('weather 로직 검증 ok')

// 실제 호출 — 키 없으면 폴백이 나오는지만 본다
if (process.argv.includes('live')) {
  const w = await getWeather()
  console.log(`source=${w.source} fallback=${w.isFallback} grid=${w.grid.nx},${w.grid.ny}`)
  console.log(`hourly=${w.hourly.length} warnings=${JSON.stringify(w.warnings)} risks=${JSON.stringify(w.risks)}`)
  assert.ok(w.isFallback || w.hourly.length > 0, '성공했다면 예보가 비어 있을 수 없다')
  if (w.isFallback) console.log('  (폴백 — DATA_GO_KR_KEY 미설정이거나 호출 실패)')
}
