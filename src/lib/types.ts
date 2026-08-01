/**
 * PlanB jeju 도메인 타입.
 *
 * F1(계획 생성)이 지금 읽는 필드와, F3(후보 필터)가 곧 읽을 필드를 함께 정의한다.
 * F3를 붙일 때 Place 타입을 다시 흔들지 않으려는 것이므로, 아직 아무도 읽지 않는
 * 필드(exposure, dependsOn)가 섞여 있는 것은 의도된 것이다.
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Date.prototype.getDay()와 같은 기준. 0 = 일요일. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 자정 기준 분. 09:30 = 570. 영업 종료 24:00은 1440으로 표현한다. */
export type MinuteOfDay = number;

export interface OpenInterval {
  readonly open: MinuteOfDay;
  readonly close: MinuteOfDay;
}

/** 요일별 영업 구간. 길이 7이고 인덱스는 Weekday. 빈 배열은 휴무. */
export type WeeklyHours = readonly (readonly OpenInterval[])[];

/**
 * 추천 카테고리는 두 축으로 이루어진다. 사용자는 축마다 하나씩 고른다.
 *
 * - 동반 유형(`CompanionType`) — 누구와 가는지
 * - 활동 성격(`ActivityStyle`) — 무엇을 하는지
 *
 * 계획 **전체**가 이 조합 하나를 따른다 — 장소 종류 필터가 아니다.
 * 한 일정 안에 서로 다른 성격이 섞이면 F1의 의도가 깨진다.
 */
export type CompanionType = 'family' | 'couple' | 'solo';

export type ActivityStyle = 'indoor' | 'food' | 'activity';

/**
 * 사용자가 고른 카테고리. 동반 유형은 하나, 활동 성격은 **하나 이상**(중복 선택, OR 매칭).
 * 활동을 여러 개 고르면 그중 하나라도 맞는 후보가 편성 대상이고, 적합도는 가장 잘 맞는
 * 축으로 계산한다 (`categoryFitOf`). 빈 배열은 만들지 말 것 — 모든 후보가 탈락한다.
 */
export interface TripCategory {
  readonly companion: CompanionType;
  readonly activity: readonly ActivityStyle[];
}

export const COMPANION_TYPES: readonly CompanionType[] = ['family', 'couple', 'solo'];

export const ACTIVITY_STYLES: readonly ActivityStyle[] = ['indoor', 'food', 'activity'];

export const COMPANION_LABELS: Readonly<Record<CompanionType, string>> = {
  family: '가족',
  couple: '커플',
  solo: '혼자',
};

export const ACTIVITY_STYLE_LABELS: Readonly<Record<ActivityStyle, string>> = {
  indoor: '실내 위주',
  food: '먹거리',
  activity: '액티비티',
};

/**
 * 기상 노출도. F3의 '같은 위험의 후보 제거'가 이 값으로 판정한다.
 * 강풍으로 배가 끊긴 상황에서 marine/coastal을 함께 걷어내는 것이 이 서비스의 차별점이다.
 */
export type Exposure = 'indoor' | 'covered' | 'outdoor' | 'coastal' | 'marine';

/** 이 후보에 가려면 필요한 교통편. F3 결항 필터가 읽는다. */
export type TransportDependency = 'ferry' | 'flight';

export interface Place {
  readonly id: string;
  readonly name: string;
  /** 권역 이름. 다양성 점수에서 같은 권역 반복을 눌러주는 데 쓴다. */
  readonly area: string;
  readonly coord: LatLng;
  readonly exposure: Exposure;
  readonly dependsOn?: TransportDependency;
  /**
   * 동반 유형별 적합도 0~1. 키가 없거나 0이면 그 동반 유형의 일정에는 편성하지 않는다.
   */
  readonly companionFit: Readonly<Partial<Record<CompanionType, number>>>;
  /**
   * 활동 성격별 적합도 0~1. 키가 없거나 0이면 그 활동 성격의 일정에는 편성하지 않는다.
   * 두 축 모두 0보다 커야 후보로 들어간다 — '가족 + 먹거리'는 두 조건을 함께 만족해야 한다.
   */
  readonly activityFit: Readonly<Partial<Record<ActivityStyle, number>>>;
  /** 권장 체류시간(분). */
  readonly stayMinutes: number;
  /** 이보다 짧게 머물 수밖에 없다면 편성하지 않는다. */
  readonly minStayMinutes: number;
  /** 1인 기준 예상 지출(원). 0은 무료. */
  readonly costPerPerson: number;
  readonly hours: WeeklyHours;
  /** 마감 몇 분 전까지 입장 가능한지. 0이면 마감 직전 입장 가능. */
  readonly lastAdmissionBeforeClose: number;
  /** 운영정보가 공공데이터로 확인된 값인지. 임시 데이터는 전부 false. */
  readonly verified: boolean;
  /** 이 레코드의 출처. 심사에서 근거를 물으면 이 값으로 답한다. */
  readonly source: string;
  readonly infoUrl?: string;
  readonly phone?: string;
  /** 관광공사 대표 이미지. 없는 곳(103곳 중 4곳)은 화면이 색 블록으로 대신한다. */
  readonly imageUrl?: string;
  /** 유형 라벨 (관광지·문화시설·음식점·카페…). LLM 이 후보를 고를 때 이름과 함께 본다. */
  readonly kind?: string;
}

/**
 * 여행이 중단된 원인. 사용자 입력이며, 기상 API가 폴백이어도 이 값만으로 위험이 확정된다.
 * F3의 `CAUSE_RISKS`가 이걸 `WeatherRisk[]`로 옮긴다.
 */
export type Cause =
  | 'ferry_cancelled'
  | 'flight_cancelled'
  | 'rain'
  | 'wind'
  | 'closed'
  | 'traffic';

/** URL·폼 입력을 검증할 때 쓰는 허용 중단 원인 목록. */
export const CAUSES: readonly Cause[] = [
  'ferry_cancelled',
  'flight_cancelled',
  'rain',
  'wind',
  'closed',
  'traffic',
];
