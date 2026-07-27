/**
 * F3 — 기상·결항·영업·거리 하드 제약 필터.
 *
 * 통과한 후보 집합이 있어야 F1 이 계획을 만들 수 있다. 점수보다 **제약 위반 0** 이 우선이다.
 * 제외된 후보는 버리지 않고 `rejected` 로 이유와 함께 돌려준다 — 화면에 '왜 빠졌는지'
 * 보여주는 것이 이 서비스의 차별점이고, 심사 답변의 근거다.
 */
import { getWeather, type Weather, type WeatherRisk } from '../data/weather.ts'
import { SEONGSAN_PLACES } from '../data/places-seongsan.ts'
import { estimateTravelMinutes, haversineKm } from '../geo.ts'
import { PLACEHOLDER_POLICY, type Cause, type Coord, type OpeningHours, type Place, type Policy, type TravelMode } from '../types.ts'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * 중단 원인이 함의하는 기상 위험.
 *
 * 이게 '같은 위험의 후보 제거' 의 핵심이다. 기상 API 가 폴백이어도
 * 사용자가 고른 원인만으로 위험이 확정된다 — 배가 강풍으로 끊겼으면
 * 다른 해상 일정을 넣으면 안 된다.
 */
export const CAUSE_RISKS: Record<Cause, WeatherRisk[]> = {
  ferry_cancelled: ['sea', 'wind'],
  flight_cancelled: ['wind'],
  rain: ['rain'],
  wind: ['wind', 'sea'],
  closed: [],
  traffic: [],
}

/** 원인이 끊어버린 교통편. */
const CAUSE_BLOCKS: Partial<Record<Cause, NonNullable<Place['requires']>>> = {
  ferry_cancelled: 'ferry',
  flight_cancelled: 'flight',
}

export type FilterContext = {
  origin: Coord
  /** 판단 기준 시각 */
  now: Date
  /** 남은 시간(분) */
  remainingMinutes: number
  hasCar: boolean
  /** 중단 원인 (사용자 입력) */
  cause: Cause
  weather: Weather
  policy: Policy
}

export type RejectReason = 'cancelled' | 'hazard' | 'unverified' | 'closed' | 'tooFar' | 'noTime'

export type Rejection = {
  place: Place
  reason: RejectReason
  /** 화면에 그대로 쓸 수 있는 한 줄 설명 (고정 템플릿 — LLM 이 만들지 않는다) */
  detail: string
}

export type Candidate = {
  place: Place
  distanceKm: number
  travelMinutes: number
  mode: TravelMode
  arriveAt: Date
  /** 도착 후 실제로 쓸 수 있는 시간(분). 마감시간과 남은 시간을 모두 반영한 값 */
  usableMinutes: number
}

export type FilterResult = {
  candidates: Candidate[]
  rejected: Rejection[]
  /** 이 판정에 쓰인 위험 태그 (기상 API + 중단 원인의 합집합) */
  risks: WeatherRisk[]
  /** 기상 정보가 폴백이었는지 — 화면에 '확인 필요' 를 띄우는 근거 */
  weatherFallback: boolean
}

// ------------------------------------------------------------------ 시각 (KST)

/** UTC 서버(Vercel)에서도 제주 기준으로 판단하도록 KST 로 환산한다. */
function kstParts(at: Date): { weekday: number; minutes: number } {
  const s = new Date(at.getTime() + KST_OFFSET_MS)
  return { weekday: s.getUTCDay(), minutes: s.getUTCHours() * 60 + s.getUTCMinutes() }
}

/** 'HH:MM' → 자정 기준 분. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`시각 형식 오류: ${hhmm}`)
  return h * 60 + m
}

/**
 * 도착 시각에 이 장소에서 쓸 수 있는 시간(분). 닫혀 있으면 null.
 *
 * F1 의 `tryVisit` 이 '모든 방문지는 도착 시각에 실제로 열려 있다' 를 보장할 때
 * 쓰는 원시 함수다. 두 기능이 같은 판정을 쓰도록 여기 한 곳에만 둔다.
 */
export function visitWindow(hours: OpeningHours, arriveAt: Date): number | null {
  const { weekday, minutes } = kstParts(arriveAt)
  if (hours.closedWeekdays?.includes(weekday)) return null

  const open = hhmmToMinutes(hours.open)
  let close = hhmmToMinutes(hours.close)
  if (close <= open) close += 24 * 60 // 자정 넘겨 닫는 곳

  if (minutes < open) return null // 아직 열지 않았다 (F1 이 대기를 넣을 수는 있다)
  const lastEntry = close - (hours.lastEntryMinutes ?? 0)
  if (minutes >= lastEntry) return null // 입장 마감

  return close - minutes
}

// ------------------------------------------------------------------ 필터

/** 기상 API 의 위험 + 중단 원인이 함의하는 위험. */
export function activeRisks(weather: Weather, cause: Cause): WeatherRisk[] {
  return [...new Set([...weather.risks, ...CAUSE_RISKS[cause]])]
}

function reject(place: Place, reason: RejectReason, detail: string): Rejection {
  return { place, reason, detail }
}

/**
 * 후보를 4가지 하드 제약으로 거른다. 검사 순서는 싼 것부터:
 * 결항 → 기상 → 영업확인 → 거리 → 영업시간.
 */
export function filterCandidates(places: Place[], ctx: FilterContext): FilterResult {
  const { origin, now, remainingMinutes, hasCar, cause, weather, policy } = ctx
  const risks = activeRisks(weather, cause)
  const blocked = CAUSE_BLOCKS[cause]
  const mode: TravelMode = hasCar ? 'car' : 'walk'
  const travelBudget = Math.floor(remainingMinutes * policy.maxTravelShare)

  const candidates: Candidate[] = []
  const rejected: Rejection[] = []

  for (const place of places) {
    // 1. 결항 — 끊긴 교통편에 의존하는 후보
    if (blocked && place.requires === blocked) {
      rejected.push(reject(place, 'cancelled', `${blocked === 'ferry' ? '여객선' : '항공편'} 운항 중단으로 접근 불가`))
      continue
    }

    // 2. 기상 — 일정을 깨뜨린 것과 같은 위험을 가진 후보
    const shared = place.indoor ? [] : place.hazards.filter((h) => risks.includes(h))
    if (shared.length > 0) {
      rejected.push(reject(place, 'hazard', `${RISK_LABEL[shared[0]]} 위험이 같아 제외`))
      continue
    }

    // 3. 영업 확인 — 확인 불가 장소는 자동 편성 대상에서 제외
    if (!place.hours) {
      if (!policy.allowUnverified) {
        rejected.push(reject(place, 'unverified', '운영정보를 확인할 수 없어 자동 편성에서 제외'))
        continue
      }
    }

    // 4. 거리 — 남은 시간·도보 한도
    const distanceKm = haversineKm(origin, place)
    const travelMinutes = estimateTravelMinutes(origin, place, mode)
    if (mode === 'walk' && travelMinutes > policy.maxWalkMinutes) {
      rejected.push(reject(place, 'tooFar', `차량 없이 도보 ${travelMinutes}분 — 한도 초과`))
      continue
    }
    if (travelMinutes > travelBudget) {
      rejected.push(reject(place, 'tooFar', `이동 ${travelMinutes}분이 남은 시간에 비해 과다`))
      continue
    }

    const arriveAt = new Date(now.getTime() + travelMinutes * 60_000)
    const budgetLeft = remainingMinutes - travelMinutes

    // 5. 영업시간 — 도착 후 이용시간이 부족하면 제외
    const openWindow = place.hours ? visitWindow(place.hours, arriveAt) : budgetLeft
    if (openWindow === null) {
      rejected.push(reject(place, 'closed', `도착 예상 ${fmtKst(arriveAt)} 에 영업 종료·휴무`))
      continue
    }

    const usableMinutes = Math.min(openWindow, budgetLeft, place.stayMinutes)
    if (usableMinutes < policy.minStayMinutes) {
      rejected.push(reject(place, 'noTime', `도착 후 머물 수 있는 시간이 ${usableMinutes}분뿐`))
      continue
    }

    candidates.push({ place, distanceKm, travelMinutes, mode, arriveAt, usableMinutes })
  }

  candidates.sort((a, b) => a.travelMinutes - b.travelMinutes)
  return { candidates, rejected, risks, weatherFallback: weather.isFallback }
}

/**
 * F3 진입점 — 기상 API 를 붙여 후보 집합을 만든다. F1 이 부르는 함수.
 *
 * 기상 호출이 실패해도 던지지 않는다 (`getWeather` 가 폴백을 준다). 그때는
 * 중단 원인이 함의하는 위험만으로 판정하고 `weatherFallback: true` 를 올려 보낸다.
 */
export async function findCandidates(input: {
  origin: Coord
  remainingMinutes: number
  hasCar: boolean
  cause: Cause
  /** 기준 시각. 생략하면 실제 현재 시각 */
  now?: Date
  /** 실데이터로 교체되면 DEFAULT_POLICY 로 되돌릴 것 */
  policy?: Policy
  places?: Place[]
}): Promise<FilterResult> {
  const now = input.now ?? new Date()
  const weather = await getWeather(input.origin, Math.ceil(input.remainingMinutes / 60))
  return filterCandidates(input.places ?? SEONGSAN_PLACES, {
    origin: input.origin,
    now,
    remainingMinutes: input.remainingMinutes,
    hasCar: input.hasCar,
    cause: input.cause,
    weather,
    policy: input.policy ?? PLACEHOLDER_POLICY,
  })
}

const RISK_LABEL: Record<WeatherRisk, string> = {
  rain: '강수',
  wind: '강풍',
  heat: '폭염',
  sea: '해상',
}

/** 'HH:MM' (KST) — 화면 표시용. */
export function fmtKst(at: Date): string {
  const { minutes } = kstParts(at)
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
