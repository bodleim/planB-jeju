/**
 * 후보 장소 — **한국관광공사 TourAPI(KorService2) 실데이터.**
 *
 * `npm run snapshot` 이 받아 둔 `snapshots/tour-seongsan.json`(성산항 반경 15km)을
 * `Place[]` 로 옮긴다. 앱은 이 JSON 만 읽는다 — 관광공사 API 가 죽어도 후보 목록은 나온다.
 * 수집 시각은 `PLACES_SNAPSHOT.fetchedAt` 이고 화면의 '데이터 기준시각' 에 그대로 쓴다.
 *
 * **범위는 성산·우도권이다** (MVP 스코프). 제주 전역으로 넓히려면 `scripts/snapshot.py` 의
 * `tour-jeju` 를 돌리면 되고, 이 파일의 import 한 줄만 바꾸면 된다. 넓힐 때 드는 비용은
 * 상세 호출이 장소당 1회라는 것뿐이다 (전역 약 1,016곳 = 개발계정 이틀).
 *
 * **사실과 추정을 구분한다.**
 * - 사실(관광공사 응답): 이름·좌표·전화·영업시간·휴무일. 영업시간이 확신 있게
 *   파싱된 곳만 `verified: true` 다.
 * - 추정(이 파일의 표): `exposure`, 적합도 두 축, 체류시간, 예상 지출.
 *   카테고리 코드에서 기계적으로 매긴 값이고 관광공사가 준 사실이 아니다.
 *   심사에서 근거를 물으면 "운영정보는 관광공사, 성향 가중치는 카테고리 기반 추정"
 *   으로 답한다.
 */
import snapshot from './snapshots/tour-seongsan.json' with { type: 'json' }
import { applyClosedDays, parseClosedDays, parseOpenHours } from './tour-hours.ts'
import type {
  ActivityStyle,
  CompanionType,
  Exposure,
  LatLng,
  Place,
} from '../types.ts'

// ------------------------------------------------------------------ 추정 표

/**
 * 카테고리 코드(cat3) → 기상 노출도.
 *
 * **이 표가 틀리면 기상 필터가 그대로 틀린다.** 강풍으로 배가 끊겼는데 해변을
 * 추천하는 사고가 여기서 난다. 스냅샷을 다시 받아 새 코드가 생기면
 * `places.check.ts` 가 '미분류' 로 잡아낸다.
 */
const EXPOSURE_BY_CAT3: Readonly<Record<string, Exposure>> = {
  A01010400: 'outdoor', // 산·오름
  A01010500: 'outdoor', // 해안도로·꽃길·생태공원
  A01011100: 'coastal', // 곶 (섭지코지)
  A01011200: 'coastal', // 해수욕장
  A01011300: 'coastal', // 섬
  A01011400: 'coastal', // 항구·포구
  A01011600: 'coastal', // 등대
  A01020100: 'outdoor', // 자생지
  A02010200: 'outdoor', // 성터·유적
  A02020200: 'indoor', // 휴양시설
  A02020500: 'indoor', // 온천·족욕
  A02020600: 'indoor', // 수족관·테마파크
  A02020700: 'outdoor', // 공원
  A02020800: 'marine', // 유람선·여객터미널
  A02030100: 'outdoor', // 마을·어촌체험
  A02040800: 'outdoor', // 체험농장
  A02050200: 'outdoor', // 기념탑·조형물
  A02050600: 'outdoor', // 전망대
  A02060100: 'indoor', // 박물관
  A02060300: 'indoor', // 전시관
  A02060500: 'indoor', // 미술관·갤러리
  A02060600: 'indoor', // 공연장
  A02061000: 'indoor', // 도서관·서점
  A03022700: 'outdoor', // 걷기·올레
  A03050100: 'indoor', // 실내 레포츠
  A04010100: 'covered', // 오일장
  A04010600: 'outdoor', // 농원 직판
  A05020100: 'indoor', // 한식
  A05020200: 'indoor', // 서양식
  A05020300: 'indoor', // 일식
  A05020400: 'indoor', // 중식·기타
  A05020900: 'indoor', // 카페
}

/** cat3 에 없을 때 유형(contenttypeid)으로 떨어지는 기본값. 보수적으로 야외로 본다. */
const EXPOSURE_BY_TYPE: Readonly<Record<string, Exposure>> = {
  '12': 'outdoor',
  '14': 'indoor',
  '28': 'outdoor',
  '38': 'covered',
  '39': 'indoor',
}

/**
 * 유형별 기본 체류시간(분)·예상 지출(원). `spendtime`·`usefee` 가 있으면 그쪽이 이긴다.
 *
 * ponytail: 지출은 관광공사가 음식점 가격을 주지 않아 유형 평균으로 때운 **추정치**다.
 *           화면에 '예상' 으로 표시하고, 실제 가격 데이터가 생기면 이 표를 지울 것.
 */
const DEFAULTS: Readonly<Record<string, { stay: number; cost: number }>> = {
  '12': { stay: 60, cost: 0 },
  '14': { stay: 70, cost: 8000 },
  '28': { stay: 90, cost: 10000 },
  '38': { stay: 40, cost: 10000 },
  '39': { stay: 60, cost: 15000 },
}
const CAFE_CAT3 = 'A05020900'
/** 카페는 음식점 평균(15,000원)을 쓰면 과대추정이라 따로 둔다. 체류도 짧다. */
const CAFE_DEFAULTS = { stay: 45, cost: 7000 }

/**
 * 동반 유형별 적합도. 관광공사가 주지 않는 값이라 카테고리에서 추정한다.
 * 근거 없는 정밀도를 주지 않으려고 0.4~1.0 사이 굵은 눈금만 쓴다.
 */
const COMPANION_BY_CAT3: Readonly<Record<string, Partial<Record<CompanionType, number>>>> = {
  A02020600: { family: 1, couple: 0.7, solo: 0.5 }, // 수족관 — 아이 동반에 강하다
  A02060100: { family: 0.9, couple: 0.7, solo: 0.7 }, // 박물관
  A02060300: { family: 0.8, couple: 0.9, solo: 0.7 }, // 전시관
  A02060500: { family: 0.5, couple: 0.9, solo: 1 }, // 미술관
  A02061000: { family: 0.5, couple: 0.8, solo: 1 }, // 서점
  A02050600: { family: 0.6, couple: 1, solo: 0.7 }, // 전망대
  A01011200: { family: 0.8, couple: 0.9, solo: 0.6 }, // 해수욕장
  A01010400: { family: 0.5, couple: 0.7, solo: 0.8 }, // 오름
  A03022700: { family: 0.4, couple: 0.7, solo: 1 }, // 올레
  A04010100: { family: 0.8, couple: 0.6, solo: 0.6 }, // 오일장
  [CAFE_CAT3]: { family: 0.5, couple: 1, solo: 0.9 }, // 카페
}
const COMPANION_BY_TYPE: Readonly<Record<string, Partial<Record<CompanionType, number>>>> = {
  '12': { family: 0.7, couple: 0.7, solo: 0.6 },
  '14': { family: 0.7, couple: 0.8, solo: 0.8 },
  '28': { family: 0.7, couple: 0.7, solo: 0.6 },
  '38': { family: 0.7, couple: 0.6, solo: 0.6 },
  '39': { family: 0.8, couple: 0.8, solo: 0.7 },
}

/**
 * 활동 성격별 적합도. **노출도와 유형에서 기계적으로 나온다** — 실내 위주 일정에
 * 야외 오름이 섞이지 않게 하는 것이 목적이다.
 */
function activityFitOf(contentType: string, cat3: string, exposure: Exposure): Partial<Record<ActivityStyle, number>> {
  const fit: Partial<Record<ActivityStyle, number>> = {}
  if (exposure === 'indoor') {
    // 카페·식당은 '실내 위주' 일정의 주역이 아니라 곁들이다. 박물관·전시관과 같은 1.0 을
    // 주면 음식점 비중이 큰 관광공사 데이터에서 카페만 연달아 나오는 일정이 만들어진다.
    fit.indoor = contentType === '39' ? 0.55 : 1
  } else if (exposure === 'covered') fit.indoor = 0.6

  if (contentType === '39') fit.food = cat3 === CAFE_CAT3 ? 0.9 : 1
  else if (contentType === '38') fit.food = 0.5

  if (contentType === '12' || contentType === '28') fit.activity = 0.9
  else if (contentType === '14') fit.activity = 0.5
  return fit
}

// ------------------------------------------------------------------ 필드 추출

type RawItem = (typeof snapshot.data)[number]

/** 유형마다 필드 이름이 달라서(usetime / usetimeculture / opentimefood …) 순서대로 훑는다. */
function fromIntro(item: RawItem, keys: readonly string[]): string {
  const intro = (item.intro ?? {}) as Record<string, unknown>
  for (const key of keys) {
    const value = intro[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

const TIME_KEYS = ['usetime', 'usetimeculture', 'opentime', 'opentimefood'] as const
const REST_KEYS = ['restdate', 'restdateculture', 'restdateshopping', 'restdatefood'] as const
const FEE_KEYS = ['usefee', 'usefeeculture'] as const

/** '약 2시간', '1시간 이내', '30분' → 분. 못 읽으면 null. */
export function parseSpendMinutes(raw: string): number | null {
  const hours = /(\d+(?:\.\d+)?)\s*시간/.exec(raw)
  const minutes = /(\d+)\s*분/.exec(raw)
  if (!hours && !minutes) return null
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
  return total > 0 && total <= 480 ? Math.round(total) : null
}

/** '- 대인 9,900원<br>- 소인 6,000원' → 9900. 첫 금액을 성인 요금으로 본다. 없으면 null. */
export function parseFeeWon(raw: string): number | null {
  if (/무료/.test(raw) && !/\d/.test(raw.split('무료')[0])) return 0
  const m = /([\d,]{3,})\s*원/.exec(raw)
  if (!m) return null
  const won = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(won) && won >= 0 && won <= 300_000 ? won : null
}

/**
 * 배로만 갈 수 있는 부속섬. **좌표 상자로 판정한다.**
 *
 * 주소나 제목으로 하면 '마라도 가파도 정기여객선'(대정읍 최남단해안로 = 육지 항구)까지
 * 섬으로 잡힌다. 좌표는 관광공사가 주는 사실이고 흔들리지 않는다.
 * 상자는 섬 전체를 감싸되 육지에 닿지 않는 크기다 — `places.check.ts` 가 육지 항구·해변이
 * 여기 들어오지 않는지 확인한다.
 */
const FERRY_ISLANDS: readonly {
  readonly name: string
  readonly minLat: number
  readonly maxLat: number
  readonly minLng: number
  readonly maxLng: number
}[] = [
  { name: '우도', minLat: 33.485, maxLat: 33.535, minLng: 126.935, maxLng: 126.975 },
  { name: '추자도', minLat: 33.93, maxLat: 33.985, minLng: 126.265, maxLng: 126.34 },
  { name: '마라도', minLat: 33.108, maxLat: 33.125, minLng: 126.26, maxLng: 126.278 },
  { name: '가파도', minLat: 33.16, maxLat: 33.185, minLng: 126.258, maxLng: 126.285 },
  { name: '비양도', minLat: 33.4, maxLat: 33.418, minLng: 126.215, maxLng: 126.238 },
]

/** 이 좌표가 어느 부속섬인지. 육지면 null. */
export function islandOf(at: LatLng): string | null {
  const found = FERRY_ISLANDS.find(
    (i) => at.lat >= i.minLat && at.lat <= i.maxLat && at.lng >= i.minLng && at.lng <= i.maxLng,
  )
  return found ? found.name : null
}

/**
 * 이 후보에 가려면 `origin` 에서 배를 타야 하는가.
 *
 * F3 가 이 값으로 후보를 자른다. `estimateTravelMinutes` 는 육로 거리 기반이라 배편
 * 시간표·대기시간을 모른다 — 성산항에서 우도 후보까지 '차로 10분' 으로 계산해 버린다.
 * **같은 섬 안에 있으면 배를 안 타므로 허용한다** (우도에서 우도 후보를 짜는 건 정상이다).
 */
export function needsBoatFrom(place: Place, origin: LatLng): boolean {
  const island = islandOf(place.coord)
  if (island === null) return false
  return islandOf(origin) !== island
}

/** 읍·면·리 단위 권역. 다양성 점수에서 같은 권역 반복을 눌러주는 데 쓴다. */
function areaOf(item: RawItem): string {
  const m = /제주특별자치도\s+\S+\s+(\S+?(?:읍|면|동|리))/.exec(item.addr1 ?? '')
  return m ? m[1] : '제주'
}

// ------------------------------------------------------------------ 변환

export type PlaceLoadResult = {
  places: Place[]
  /** 운영시간을 확신 있게 읽지 못해 후보에서 뺀 곳. 화면이 '왜 없는지' 설명할 수 있어야 한다. */
  unparsed: { title: string; raw: string }[]
  /** `EXPOSURE_BY_CAT3` 에 없어 유형 기본값으로 떨어진 코드. 스냅샷을 다시 받으면 늘 수 있다. */
  unmappedCat3: string[]
}

/**
 * 스냅샷 → `Place[]`.
 *
 * @param month 계절별 영업시간을 고를 기준 달. 생략하면 수집 시각의 달을 쓴다 —
 *   실행 시각이 아니라 스냅샷 기준이라야 같은 입력에 같은 결과가 나온다.
 */
export function loadPlaces(month = new Date(snapshot.fetchedAt).getMonth() + 1): PlaceLoadResult {
  const places: Place[] = []
  const unparsed: PlaceLoadResult['unparsed'] = []
  const unmappedCat3 = new Set<string>()

  for (const item of snapshot.data) {
    const lat = Number(item.mapy)
    const lng = Number(item.mapx)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const contentType = String(item.contenttypeid)
    const cat3 = item.cat3 ?? ''
    if (cat3 !== '' && !(cat3 in EXPOSURE_BY_CAT3)) unmappedCat3.add(cat3)
    const exposure = EXPOSURE_BY_CAT3[cat3] ?? EXPOSURE_BY_TYPE[contentType] ?? 'outdoor'

    const rawTime = fromIntro(item, TIME_KEYS)
    const parsed = parseOpenHours(rawTime, month)
    if (parsed === null) {
      unparsed.push({ title: item.title, raw: rawTime })
      continue // 운영 확인 불가 — 자동 편성 대상에서 제외 (도메인 규칙 4)
    }

    const closed = parseClosedDays(fromIntro(item, REST_KEYS))
    const defaults =
      cat3 === CAFE_CAT3 ? CAFE_DEFAULTS : (DEFAULTS[contentType] ?? { stay: 60, cost: 0 })
    const stayMinutes = parseSpendMinutes(fromIntro(item, ['spendtime'])) ?? defaults.stay
    const fee = parseFeeWon(fromIntro(item, FEE_KEYS))

    places.push({
      id: `tour-${item.contentid}`,
      name: item.title,
      area: areaOf(item),
      coord: { lat, lng },
      exposure,
      ...(islandOf({ lat, lng }) !== null ? { dependsOn: 'ferry' as const } : {}),
      companionFit: COMPANION_BY_CAT3[cat3] ?? COMPANION_BY_TYPE[contentType] ?? { family: 0.6, couple: 0.6, solo: 0.6 },
      activityFit: activityFitOf(contentType, cat3, exposure),
      stayMinutes,
      minStayMinutes: Math.max(20, Math.round(stayMinutes * 0.5)),
      costPerPerson: fee ?? defaults.cost,
      hours: closed === null ? parsed.hours : applyClosedDays(parsed.hours, closed),
      lastAdmissionBeforeClose: parsed.lastAdmissionBeforeClose,
      // 휴무일을 못 읽었으면 영업시간을 읽었더라도 확정하지 않는다 — 휴무일에 문 닫은 곳을
      // 열려 있다고 판단하는 게 이 서비스에서 제일 나쁜 실패다.
      verified: closed !== null,
      source: '한국관광공사 국문 관광정보(TourAPI)',
      ...(item.tel ? { phone: item.tel } : {}),
    })
  }

  return { places, unparsed, unmappedCat3: [...unmappedCat3] }
}

const loaded = loadPlaces()

/** F3 가 거를 후보 집합 — 성산·우도권. */
export const SEONGSAN_PLACES: readonly Place[] = loaded.places

/**
 * 이름·권역으로 후보를 찾는다. **출발 위치 입력의 폴백**이다.
 *
 * 위치 감지가 거부되거나 JS 가 없을 때 사용자가 '성산항' 처럼 쳐서 시작점을 정할 수 있어야
 * 한다. 카카오 지오코딩을 쓰지 않는 이유는 외부 호출이 하나 늘면 그만큼 화면이 죽을 확률이
 * 늘기 때문이다 — 우리가 이미 가진 1,000여 곳 안에서 찾으면 오프라인에서도 된다.
 *
 * 공백으로 나눈 토큰이 **전부** 이름이나 권역에 들어 있어야 맞는 것으로 본다.
 */
export function searchPlaces(query: string, limit = 8): Place[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const scored: { place: Place; score: number }[] = []
  for (const place of loaded.places) {
    const haystack = `${place.name} ${place.area}`.toLowerCase()
    if (!tokens.every((t) => haystack.includes(t))) continue
    // 이름이 검색어로 시작하면 위로. 짧은 이름이 대개 더 대표적인 지명이다.
    const starts = place.name.toLowerCase().startsWith(tokens[0]) ? 0 : 1
    scored.push({ place, score: starts * 1000 + place.name.length })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, limit).map((s) => s.place)
}

export const PLACES_SNAPSHOT = {
  source: snapshot.source,
  /** 화면의 '데이터 기준시각' 에 그대로 쓴다. */
  fetchedAt: snapshot.fetchedAt,
  total: snapshot.data.length,
  loaded: loaded.places.length,
  /** 운영시간을 확신 있게 읽지 못해 뺀 곳의 수. */
  skipped: loaded.unparsed.length,
} as const

export const PLACE_LOAD = loaded
