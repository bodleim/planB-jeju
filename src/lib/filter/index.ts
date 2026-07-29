/**
 * F3 — 기상·결항·영업·거리 하드 제약 필터.
 *
 * 통과한 후보 집합이 있어야 F1 이 계획을 만들 수 있다. 점수보다 **제약 위반 0** 이 우선이다.
 * 제외된 후보는 버리지 않고 `rejected` 로 이유와 함께 돌려준다 — 화면에 '왜 빠졌는지'
 * 보여주는 것이 이 서비스의 차별점이고, 심사 답변의 근거다.
 *
 * 영업시간·도착시각 판정은 직접 하지 않고 F1 의 `tryVisit` 에 넘긴다. 두 기능이 다른
 * 판정을 쓰면 '모든 방문지는 도착 시각에 실제로 열려 있다' 불변식이 깨진다.
 * 여기서 추가로 보는 건 F1 이 모르는 두 가지 — 기상 위험과 끊긴 교통편이다.
 */
import { getWeather, type Weather, type WeatherRisk } from '../data/weather.ts'
import { JEJU_PLACES, needsBoatFrom } from '../data/places.ts'
import { estimateTravelMinutes, haversineKm, travelModeFor } from '../geo.ts'
import { DEFAULT_POLICY, tryVisit, type VisitContext } from '../plan/generate.ts'
import type { PlanPolicy, RejectReason as PlanRejectReason } from '../plan/types.ts'
import { formatHm, jejuClock } from '../time.ts'
import type {
  Cause,
  Exposure,
  LatLng,
  MinuteOfDay,
  Place,
  TransportDependency,
  Weekday,
} from '../types.ts'

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
const CAUSE_BLOCKS: Partial<Record<Cause, TransportDependency>> = {
  ferry_cancelled: 'ferry',
  flight_cancelled: 'flight',
}

/**
 * 노출도별로 어떤 기상 위험을 받는지. `Place.exposure` 하나로 기상 판정이 끝나므로
 * 장소마다 위험 목록을 손으로 적지 않는다 — 실데이터로 교체할 때 틀릴 여지를 줄인다.
 */
export const EXPOSURE_RISKS: Record<Exposure, WeatherRisk[]> = {
  indoor: [],
  covered: ['heat'],
  outdoor: ['rain', 'wind', 'heat'],
  coastal: ['rain', 'wind', 'heat', 'sea'],
  // 유람선·여객터미널. 비도 위험으로 본다 — 우천에 유람선을 대안으로 내놓으면
  // '일정을 깨뜨린 것과 같은 위험은 피한다' 는 이 서비스의 약속이 무너진다.
  marine: ['rain', 'wind', 'sea'],
}

export type FilterContext = {
  origin: LatLng
  /** 판단 기준 시각 (자정 기준 분, KST) */
  startMinutes: MinuteOfDay
  weekday: Weekday
  /** 남은 시간(분) */
  remainingMinutes: number
  hasCar: boolean
  /** 중단 원인 (사용자 입력) */
  cause: Cause
  weather: Weather
  policy: PlanPolicy
}

export type RejectReason = 'hazard' | 'cancelled' | 'needsTransfer' | 'tooFar' | PlanRejectReason

export type Rejection = {
  place: Place
  reason: RejectReason
  /** 화면에 그대로 쓸 수 있는 한 줄 설명 (고정 템플릿 — LLM 이 만들지 않는다) */
  detail: string
}

export type FilterResult = {
  /** F1 `generatePlan()` 에 그대로 넘길 후보 집합. */
  candidates: Place[]
  rejected: Rejection[]
  /** 이 판정에 쓰인 위험 태그 (기상 API + 중단 원인의 합집합) */
  risks: WeatherRisk[]
  /** 기상 정보가 폴백이었는지 — 화면에 '확인 필요' 를 띄우는 근거 */
  weatherFallback: boolean
  /**
   * 위험 판정에 **실제로** 쓴 기상 출처. 화면이 이걸 그대로 적는다 —
   * 특보 API 가 막혀 있는데 '특보 실시간' 이라고 쓰면 근거를 물었을 때 답이 없다.
   */
  weatherSource: string
  /** 기상특보 조회가 성공했는지. false 면 특보는 판정에 안 들어갔다. */
  warningsOk: boolean
  /** 조회된 특보 제목. 화면에 근거로 그대로 보여준다. */
  warnings: string[]
}

/** 기상 API 의 위험 + 중단 원인이 함의하는 위험. */
export function activeRisks(weather: Weather, cause: Cause): WeatherRisk[] {
  return [...new Set([...weather.risks, ...CAUSE_RISKS[cause]])]
}

/**
 * 후보를 하드 제약으로 거른다. 검사 순서는 싼 것부터:
 * 결항 → 기상 → 거리 → (`tryVisit`) 영업확인·영업시간·체류시간.
 */
export function filterCandidates(places: readonly Place[], ctx: FilterContext): FilterResult {
  const { origin, startMinutes, weekday, remainingMinutes, hasCar, cause, weather, policy } = ctx
  const risks = activeRisks(weather, cause)
  const blocked = CAUSE_BLOCKS[cause]
  const travelBudget = Math.floor(remainingMinutes * policy.maxTravelShare)

  const visitContext: VisitContext = {
    from: origin,
    departMinutes: startMinutes,
    deadlineMinutes: startMinutes + remainingMinutes,
    weekday,
    hasCar,
    // category 없음 — F3 는 하드 제약만 보고, 카테고리 narrowing 은 F1 이 한다.
    //
    // maxWaitMinutes 를 남은 시간 전체로 늘린다. `tryVisit` 은 '지금 출발해서 바로 간다' 는
    // 한 칸 판정이라 그대로 쓰면 11시에 여는 곳이 10시 기준으로 '대기 과다' 로 잘려나가고,
    // F1 이 두 번째 시간대에 쓸 수 있었던 후보가 사라진다. F3 는 필요조건만 봐야 한다 —
    // '남은 시간 안에 열려 있는 구간이 있고 최소 체류가 되는가'.
    policy: { ...policy, maxWaitMinutes: remainingMinutes },
  }

  const candidates: Place[] = []
  const rejected: Rejection[] = []
  const reject = (place: Place, reason: RejectReason, detail: string) =>
    rejected.push({ place, reason, detail })

  for (const place of places) {
    // 1. 결항 — 끊긴 교통편에 의존하는 후보
    if (blocked && place.dependsOn === blocked) {
      reject(place, 'cancelled', `${blocked === 'ferry' ? '여객선' : '항공편'} 운항 중단으로 접근 불가`)
      continue
    }

    // 1-2. 결항이 아니어도, 배·비행기를 타야 하는 곳은 제외한다 (같은 섬 안이면 통과).
    //
    // 판정은 `needsBoatFrom` 한 곳에서 한다 — 부속섬이 우도·추자도·마라도·가파도·비양도
    // 다섯 곳이라 '섬 안인가' 를 F3 가 직접 계산하면 섬이 늘 때마다 여기가 틀린다.
    if (place.dependsOn === 'flight' || needsBoatFrom(place, origin)) {
      const vehicle = place.dependsOn === 'flight' ? '항공편' : '배'
      reject(place, 'needsTransfer', `${vehicle}를 타야 하는 곳 — 배편 시간을 반영할 수 없어 제외`)
      continue
    }

    // 2. 기상 — 일정을 깨뜨린 것과 같은 위험을 가진 후보
    const shared = EXPOSURE_RISKS[place.exposure].filter((h) => risks.includes(h))
    if (shared.length > 0) {
      reject(place, 'hazard', `${RISK_LABEL[shared[0]]} 위험이 같아 제외`)
      continue
    }

    // 3. 거리 — 편도 이동이 남은 시간을 잡아먹으면 제외
    const distanceKm = haversineKm(origin, place.coord)
    const mode = travelModeFor(hasCar, distanceKm, policy.walkLimitKm)
    const travelMinutes = estimateTravelMinutes(origin, place.coord, mode, policy.congestion)
    if (travelMinutes > travelBudget) {
      reject(place, 'tooFar', `${MODE_LABEL[mode]} ${travelMinutes}분 — 남은 시간에 비해 이동이 과다`)
      continue
    }

    // 4. 영업확인·영업시간·체류시간 — F1 과 같은 판정을 쓴다
    const attempt = tryVisit(place, visitContext)
    if (!attempt.ok) {
      reject(place, attempt.reason, PLAN_REJECT_DETAIL[attempt.reason](startMinutes + travelMinutes))
      continue
    }

    candidates.push(place)
  }

  return {
    candidates,
    rejected,
    risks,
    weatherFallback: weather.isFallback,
    weatherSource: weather.source,
    warningsOk: weather.warningsOk,
    warnings: weather.warnings,
  }
}

/**
 * F3 진입점 — 기상 API 를 붙여 후보 집합을 만든다. F1 이 부르는 함수.
 *
 * 기상 호출이 실패해도 던지지 않는다 (`getWeather` 가 폴백을 준다). 그때는
 * 중단 원인이 함의하는 위험만으로 판정하고 `weatherFallback: true` 를 올려 보낸다.
 */
export async function findCandidates(input: {
  origin: LatLng
  remainingMinutes: number
  hasCar: boolean
  cause: Cause
  /** 기준 시각. 생략하면 제주 현재 시각 */
  startMinutes?: MinuteOfDay
  weekday?: Weekday
  /** 기본값은 DEFAULT_POLICY — 운영정보 미확인 장소를 자동 편성에서 뺀다 (도메인 규칙 4). */
  policy?: PlanPolicy
  places?: readonly Place[]
}): Promise<FilterResult> {
  const clock = jejuClock()
  const weather = await getWeather(input.origin, Math.ceil(input.remainingMinutes / 60))
  return filterCandidates(input.places ?? JEJU_PLACES, {
    origin: input.origin,
    startMinutes: input.startMinutes ?? clock.minuteOfDay,
    weekday: input.weekday ?? clock.weekday,
    remainingMinutes: input.remainingMinutes,
    hasCar: input.hasCar,
    cause: input.cause,
    weather,
    policy: input.policy ?? DEFAULT_POLICY,
  })
}

const RISK_LABEL: Record<WeatherRisk, string> = {
  rain: '강수',
  wind: '강풍',
  heat: '폭염',
  sea: '해상',
}

const MODE_LABEL = { car: '차량', transit: '대중교통', walk: '도보' } as const

/**
 * `tryVisit` 의 탈락 이유를 화면 문구로. 고정 템플릿이며 LLM 이 만들지 않는다.
 * `Record` 로 두면 `RejectReason` 에 항목이 추가될 때 타입체크가 잡아준다.
 */
const PLAN_REJECT_DETAIL: Record<PlanRejectReason, (arriveMinutes: MinuteOfDay) => string> = {
  unverified: () => '운영정보를 확인할 수 없어 자동 편성에서 제외',
  // F3 는 이 경우를 'cancelled' 로 먼저 잡으므로 여기까지 오지 않는다 (타입 완결성용)
  transport_unavailable: () => '끊긴 교통편에 의존해 접근 불가',
  closed_that_day: () => '그 요일은 휴무',
  closed_on_arrival: (at) => `도착 예상 ${formatHm(at)} 에 입장 마감·영업 종료`,
  // F3 는 maxWaitMinutes 를 남은 시간으로 두므로, 이 이유는 '남은 시간 안에 안 연다' 뿐이다
  wait_too_long: () => '남은 시간 안에 문을 열지 않음',
  stay_too_short: () => '도착 후 머물 수 있는 시간이 부족',
  past_deadline: () => '남은 시간 안에 도착할 수 없음',
  category_mismatch: () => '여행 성격에 맞지 않음',
}
