/** 후보 장소와 필터 정책 타입. 데이터 레이어와 F3 필터가 공유한다. */
import type { WeatherRisk } from './data/weather.ts'

export type Coord = { lat: number; lon: number }

export type TravelMode = 'car' | 'walk'

/** 여행 성격. F1 이 이 값으로 일정 전체의 톤을 맞춘다 (단순 필터가 아니다). */
export type PlaceCategory = 'nature' | 'culture' | 'activity' | 'food' | 'cafe' | 'shopping'

export type OpeningHours = {
  /** 'HH:MM' */
  open: string
  close: string
  /** 정기 휴무 요일 (0=일 … 6=토) */
  closedWeekdays?: number[]
  /** 마감 몇 분 전까지 입장 가능 */
  lastEntryMinutes?: number
}

export type Place = {
  id: string
  name: string
  category: PlaceCategory
  lat: number
  lon: number
  /** 실내면 기상 위험을 받지 않는다 (F3 기상 검사에서 통과) */
  indoor: boolean
  /** 이 장소가 노출된 기상 위험. '같은 위험의 후보 제거' 판정 대상 */
  hazards: WeatherRisk[]
  /** 권장 체류시간(분) */
  stayMinutes: number
  /** null = 운영 확인 불가. 원칙적으로 자동 편성 제외 대상 */
  hours: OpeningHours | null
  /** 운영정보가 확인된 사실인지. false 면 화면에 '확인 필요' 를 표시한다 */
  verified: boolean
  /** 출처 문구 — 심사에서 '근거가 뭐냐' 에 답하는 값 */
  source: string
  /** 이 교통편이 끊기면 갈 수 없다 (우도 = ferry) */
  requires?: 'ferry' | 'flight'
  tel?: string
  url?: string
}

/** 여행이 중단된 원인. 사용자 입력이며 기상 API 가 폴백이어도 이걸로 위험을 확정한다. */
export type Cause =
  | 'ferry_cancelled'
  | 'flight_cancelled'
  | 'rain'
  | 'wind'
  | 'closed'
  | 'traffic'

export type Policy = {
  /**
   * 운영 확인이 불가능한 장소를 후보로 허용할지.
   * 원칙은 false (자동 편성 제외). 실데이터가 오기 전 임시 데이터로 시연할 때만 true.
   */
  allowUnverified: boolean
  /** 도착 후 최소 이만큼은 머물 수 있어야 후보로 인정 */
  minStayMinutes: number
  /** 차가 없을 때 도보 허용 한도(분) */
  maxWalkMinutes: number
  /** 편도 이동이 남은 시간의 이 비율을 넘으면 제외 */
  maxTravelShare: number
}

export const DEFAULT_POLICY: Policy = {
  allowUnverified: false,
  minStayMinutes: 30,
  maxWalkMinutes: 25,
  maxTravelShare: 0.4,
}

/**
 * 임시 데이터 시연용. `allowUnverified: true` 라서 미확인 장소도 후보에 남는다.
 * 화면에 반드시 출처·기준시각·'확인 필요' 를 함께 표시할 것 — 앱이 운영 여부를 확정하지 않는다.
 *
 * ponytail: 실데이터(운영시간 확인)로 교체되면 DEFAULT_POLICY 로 되돌릴 것.
 */
export const PLACEHOLDER_POLICY: Policy = { ...DEFAULT_POLICY, allowUnverified: true }
