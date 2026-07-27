/**
 * 기상청 단기예보 + 기상특보 — 이 프로젝트에서 유일한 실시간 외부 호출.
 *
 * CLAUDE.md 데이터 전략: 비짓제주·교통은 스냅샷 JSON, 기상청만 실시간.
 * `getWeather()` 는 절대 throw 하지 않는다. 실패하면 `isFallback: true` 로
 * 돌려주고 화면이 '확인 필요' 를 표시한다 — 시연 중 네트워크가 끊겨도 계획은 나와야 한다.
 *
 * F3 필터는 `risks` 만 보면 된다. 원본 시계열이 필요하면 `hourly`.
 */

const KMA = 'http://apis.data.go.kr/1360000'
// ponytail: http 그대로. 일부 공공기관 https 인증서 체인이 깨져 있어 apis.py 도 검증을 껐다.
//           공개 데이터 키라 위험은 낮지만, 운영 전환 시 https 로 올리고 실패 여부만 확인할 것.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const JEJU_STN_ID = '184' // 기상특보 지점코드: 제주

/** 성산항 근사 좌표 (시연 시나리오 출발지). 5km 격자 기준이라 이 정도 정밀도면 충분하다. */
export const SEONGSAN_PORT = { lat: 33.4746, lon: 126.9317 }

/** ponytail: 임계값은 다 튜닝 노브다. 실제 제주 데이터 보고 조정할 것. */
export const THRESHOLDS = {
  rainMm: 0.1, // 시간당 강수량
  popPct: 60, // 강수확률
  windMs: 9, // 평균 풍속 (강풍주의보 평균 14m/s 보다 보수적)
  heatC: 33, // 폭염주의보 기준
  waveM: 1.5, // 파고 — 해상 후보 판단
}

export type WeatherRisk = 'rain' | 'wind' | 'heat' | 'sea'

export type HourlyWeather = {
  /** '2026-07-27T12:00+09:00' */
  time: string
  tempC?: number
  rainMm: number
  popPct?: number
  windMs?: number
  waveM?: number
  /** 강수형태 0없음 1비 2비/눈 3눈 4소나기 */
  ptyCode?: number
  /** 하늘상태 1맑음 3구름많음 4흐림 */
  skyCode?: number
}

export type Weather = {
  /** 데이터 기준시각 (화면의 '데이터 기준시각' 에 그대로 쓴다) */
  at: string
  source: string
  isFallback: boolean
  grid: { nx: number; ny: number }
  hourly: HourlyWeather[]
  /** 기상특보 제목 목록 */
  warnings: string[]
  risks: WeatherRisk[]
}

// ------------------------------------------------------------------ 좌표 → 격자

const KMA_GRID = {
  RE: 6371.00877, // 지구 반경 (km)
  GRID: 5.0, // 격자 간격 (km)
  SLAT1: 30.0,
  SLAT2: 60.0,
  OLON: 126.0,
  OLAT: 38.0,
  XO: 43,
  YO: 136,
}

/** 위경도 → 기상청 5km 격자 (Lambert Conformal Conic, 기상청 공식 dfs_xy_conv). */
export function latLonToGrid(lat: number, lon: number): { nx: number; ny: number } {
  const { RE, GRID, SLAT1, SLAT2, OLON, OLAT, XO, YO } = KMA_GRID
  const DEGRAD = Math.PI / 180
  const re = RE / GRID
  const slat1 = SLAT1 * DEGRAD
  const slat2 = SLAT2 * DEGRAD
  const olon = OLON * DEGRAD
  const olat = OLAT * DEGRAD

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn)
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5)
  ro = (re * sf) / Math.pow(ro, sn)

  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5)
  ra = (re * sf) / Math.pow(ra, sn)
  let theta = lon * DEGRAD - olon
  if (theta > Math.PI) theta -= 2 * Math.PI
  if (theta < -Math.PI) theta += 2 * Math.PI
  theta *= sn

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  }
}

// ------------------------------------------------------------------ 발표시각

function kstShifted(now: Date, minusMinutes = 0): Date {
  return new Date(now.getTime() + KST_OFFSET_MS - minusMinutes * 60_000)
}

function ymd(shifted: Date): string {
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}${m}${d}`
}

const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]

/**
 * 단기예보 발표시각. 하루 8회 발표 + 45분 지연을 감안하고, 자정 직후엔 전날 23시로 돌아간다.
 * 이 파일에서 유일하게 비자명한 로직 — 고칠 땐 weather.check.ts 의 assert 부터 볼 것.
 */
export function kmaBaseTime(now: Date = new Date()): { baseDate: string; baseTime: string } {
  const t = kstShifted(now, 45)
  const h = BASE_HOURS.filter((x) => x <= t.getUTCHours()).pop()
  if (h === undefined) {
    t.setUTCDate(t.getUTCDate() - 1)
    return { baseDate: ymd(t), baseTime: '2300' }
  }
  return { baseDate: ymd(t), baseTime: `${String(h).padStart(2, '0')}00` }
}

// ------------------------------------------------------------------ 응답 파싱

type KmaItem = Record<string, unknown>

type KmaEnvelope = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: { items?: { item?: KmaItem | KmaItem[] } }
  }
}

/** data.go.kr 은 에러도 200 + XML 로 준다. resultCode 확인이 유일한 성공 판정. */
function kmaItems(body: unknown): KmaItem[] {
  const res = (body as KmaEnvelope)?.response
  const { resultCode, resultMsg } = res?.header ?? {}
  if (resultCode !== '00') {
    throw new Error(`기상청 응답 오류: ${resultCode ?? '알 수 없음'} ${resultMsg ?? ''}`.trim())
  }
  const item = res?.body?.items?.item
  return Array.isArray(item) ? item : item ? [item] : []
}

/** '강수없음' / '1mm 미만' / '30.0~50.0mm' 같은 문자열을 mm 수치로. */
function parseAmount(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string' || v.includes('없음')) return 0
  if (v.includes('미만')) return 0.05
  const n = Number.parseFloat(v)
  return Number.isNaN(n) ? 0 : n
}

function num(v: unknown): number | undefined {
  const n = Number.parseFloat(String(v))
  return Number.isNaN(n) ? undefined : n
}

export function parseVilageFcst(body: unknown): HourlyWeather[] {
  const byTime = new Map<string, HourlyWeather>()
  for (const it of kmaItems(body)) {
    const d = String(it.fcstDate ?? '')
    const t = String(it.fcstTime ?? '')
    if (d.length !== 8 || t.length !== 4) continue
    const time = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}+09:00`
    const row = byTime.get(time) ?? { time, rainMm: 0 }
    const v = it.fcstValue
    switch (it.category) {
      case 'TMP':
        row.tempC = num(v)
        break
      case 'PCP':
        row.rainMm = parseAmount(v)
        break
      case 'POP':
        row.popPct = num(v)
        break
      case 'WSD':
        row.windMs = num(v)
        break
      case 'WAV':
        row.waveM = num(v)
        break
      case 'PTY':
        row.ptyCode = num(v)
        break
      case 'SKY':
        row.skyCode = num(v)
        break
    }
    byTime.set(time, row)
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time))
}

export function parseWarnings(body: unknown): string[] {
  return kmaItems(body)
    .map((it) => String(it.title ?? '').trim())
    .filter(Boolean)
}

// ------------------------------------------------------------------ 위험 판정

const WARNING_RISKS: [RegExp, WeatherRisk][] = [
  [/강풍|태풍/, 'wind'],
  [/풍랑|해일|태풍/, 'sea'],
  [/호우|대설|폭우/, 'rain'],
  [/폭염/, 'heat'],
]

/**
 * F3 의 '같은 위험의 후보 제거' 가 쓰는 태그.
 * hourly 는 판단 대상 구간만 넘긴다 (남은 시간 안의 시각들).
 */
export function deriveRisks(hourly: HourlyWeather[], warnings: string[] = []): WeatherRisk[] {
  const risks = new Set<WeatherRisk>()
  for (const h of hourly) {
    if (h.rainMm >= THRESHOLDS.rainMm || (h.popPct ?? 0) >= THRESHOLDS.popPct) risks.add('rain')
    if (h.ptyCode !== undefined && h.ptyCode > 0) risks.add('rain')
    if ((h.windMs ?? 0) >= THRESHOLDS.windMs) risks.add('wind')
    if ((h.tempC ?? 0) >= THRESHOLDS.heatC) risks.add('heat')
    if ((h.waveM ?? 0) >= THRESHOLDS.waveM) risks.add('sea')
  }
  for (const w of warnings) {
    for (const [re, risk] of WARNING_RISKS) if (re.test(w)) risks.add(risk)
  }
  return [...risks]
}

/** 예보 시각 중 [지금, 지금+hours] 안에 드는 것만. */
export function withinHours(hourly: HourlyWeather[], hours: number, now: Date = new Date()): HourlyWeather[] {
  const from = now.getTime()
  const to = from + hours * 3_600_000
  return hourly.filter((h) => {
    const t = Date.parse(h.time)
    return t >= from && t <= to
  })
}

// ------------------------------------------------------------------ 호출

async function getJson(path: string, params: Record<string, string | number>): Promise<unknown> {
  const key = process.env.DATA_GO_KR_KEY
  if (!key) throw new Error('DATA_GO_KR_KEY 미설정 (.env.local 확인)')
  const q = new URLSearchParams({ serviceKey: key, dataType: 'JSON', pageNo: '1' })
  for (const [k, v] of Object.entries(params)) q.set(k, String(v))
  const r = await fetch(`${KMA}/${path}?${q}`, {
    signal: AbortSignal.timeout(8_000),
    next: { revalidate: 600 }, // 단기예보는 3시간마다 갱신. 10분 캐시로 일일 호출량을 아낀다
  })
  if (!r.ok) throw new Error(`기상청 HTTP ${r.status}`)
  return JSON.parse(await r.text())
}

export function fetchVilageFcst(nx: number, ny: number, rows = 300): Promise<unknown> {
  const { baseDate, baseTime } = kmaBaseTime()
  return getJson('VilageFcstInfoService_2.0/getVilageFcst', {
    numOfRows: rows,
    base_date: baseDate,
    base_time: baseTime,
    nx,
    ny,
  })
}

export function fetchWarnings(stnId = JEJU_STN_ID): Promise<unknown> {
  const today = kstShifted(new Date())
  const from = new Date(today.getTime() - 2 * 86_400_000)
  return getJson('WthrWrnInfoService/getWthrWrnList', {
    numOfRows: 20,
    stnId,
    fromTmFc: ymd(from),
    toTmFc: ymd(today),
  })
}

/**
 * 좌표 기준 기상 상태. **throw 하지 않는다.**
 *
 * 실패하면 위험 태그가 빈 폴백을 준다 — 앱이 안전판단을 대신하지 않고
 * 화면의 '기상 임시 선택' 과 '확인 필요' 표시로 넘긴다 (CLAUDE.md 규칙).
 */
export async function getWeather(
  at: { lat: number; lon: number } = SEONGSAN_PORT,
  hours = 12,
): Promise<Weather> {
  const grid = latLonToGrid(at.lat, at.lon)
  const now = new Date()
  try {
    const [fcst, warn] = await Promise.all([
      fetchVilageFcst(grid.nx, grid.ny),
      // 특보는 없어도 예보만으로 판단 가능 → 실패를 전체 실패로 만들지 않는다
      fetchWarnings().catch(() => null),
    ])
    const hourly = withinHours(parseVilageFcst(fcst), hours, now)
    const warnings = warn ? parseWarnings(warn) : []
    return {
      at: now.toISOString(),
      source: '기상청 단기예보',
      isFallback: false,
      grid,
      hourly,
      warnings,
      risks: deriveRisks(hourly, warnings),
    }
  } catch {
    // ponytail: 실데이터 스냅샷이 없어 빈 폴백. 키 나오면 마지막 응답을 JSON 으로 커밋해 여기서 읽을 것.
    return {
      at: now.toISOString(),
      source: '폴백 — 기상 정보 확인 필요',
      isFallback: true,
      grid,
      hourly: [],
      warnings: [],
      risks: [],
    }
  }
}
