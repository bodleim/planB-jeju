import type { TravelMode } from '../geo';
import type {
  LatLng,
  MinuteOfDay,
  Place,
  TransportDependency,
  TripCategory,
  Weekday,
} from '../types';

/** 한 후보를 그 시간대에 넣어본 결과. 여기까지 온 방문지는 제약을 모두 통과한 것이다. */
export interface FeasibleVisit {
  readonly place: Place;
  readonly mode: TravelMode;
  readonly distanceKm: number;
  readonly travelMinutes: number;
  /** 문 열기를 기다리는 시간. 0이 정상이고, 정책상 상한을 넘으면 아예 후보에서 빠진다. */
  readonly waitMinutes: number;
  readonly departMinutes: MinuteOfDay;
  readonly arriveMinutes: MinuteOfDay;
  /** 실제 이용 시작 시각. 도착 후 기다렸다면 arriveMinutes보다 늦다. */
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: MinuteOfDay;
  readonly stayMinutes: number;
  /** 그 시각에 적용된 영업 종료 시각. 화면에서 '몇 시까지'를 보여줄 때 쓴다. */
  readonly closeMinutes: MinuteOfDay;
  readonly costPerPerson: number;
}

/** 후보가 탈락한 이유. /dev 페이지에서 '후보 0곳'의 원인을 설명하는 데 쓴다. */
export type RejectReason =
  | 'category_mismatch'
  | 'unverified'
  | 'transport_unavailable'
  | 'closed_that_day'
  | 'closed_on_arrival'
  | 'wait_too_long'
  | 'stay_too_short'
  | 'past_deadline';

export type VisitAttempt =
  | { readonly ok: true; readonly visit: FeasibleVisit }
  | { readonly ok: false; readonly reason: RejectReason };

export interface ScoreBreakdown {
  readonly feasibility: number;
  readonly timeEfficiency: number;
  readonly categoryFit: number;
  readonly cost: number;
  readonly travel: number;
  readonly diversity: number;
  readonly total: number;
}

export interface ScoredVisit {
  readonly visit: FeasibleVisit;
  readonly score: ScoreBreakdown;
}

export interface PlanSlot {
  readonly index: number;
  readonly chosen: ScoredVisit;
  /**
   * 같은 출발지·같은 출발시각에서 검증된 대안. F2의 스와이프 재고다.
   * 대안으로 바꾸면 뒤 시간대의 출발시각이 밀리므로, 교체 시점에 그 뒤를 다시 생성해야 한다.
   */
  readonly alternatives: readonly ScoredVisit[];
}

export interface PlanTotals {
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: MinuteOfDay;
  readonly travelMinutes: number;
  readonly stayMinutes: number;
  readonly waitMinutes: number;
  /** 남은 시간 중 쓰지 못한 시간. */
  readonly unusedMinutes: number;
  /** 인원수를 곱한 총 예상 지출(원). */
  readonly cost: number;
}

export interface Plan {
  readonly category: TripCategory;
  readonly slots: readonly PlanSlot[];
  readonly totals: PlanTotals;
  /** 운영정보가 확인되지 않아 화면에서 '확인 필요'로 표시해야 하는 방문지. */
  readonly needsConfirmation: readonly Place[];
}

export interface PlanInput {
  readonly origin: LatLng;
  /** 계획 시작 시각. 지금 시각을 쓰려면 jejuClock()을 통과시킨 값을 넣는다. */
  readonly startMinutes: MinuteOfDay;
  readonly remainingMinutes: number;
  /** 다음 예약(숙소 체크인 등). 남은 시간보다 이르면 이쪽이 마감이 된다. */
  readonly endByMinutes?: MinuteOfDay;
  /** 동반 유형 + 활동 성격. 사용자가 축마다 하나씩 고른 값. */
  readonly category: TripCategory;
  readonly hasCar: boolean;
  readonly weekday: Weekday;
  readonly partySize?: number;
  /**
   * 끊긴 교통편. 여객선 결항은 공개 API가 없어 사용자 입력으로 받는다.
   * F3가 붙으면 후보 필터가 이 판정을 가져가므로 여기서는 빠질 예정이다.
   */
  readonly blockedTransport?: readonly TransportDependency[];
  /** 같은 seed면 같은 계획. F2의 새로고침은 이 값만 바꾼다. */
  readonly seed?: number;
}

export interface PlanPolicy {
  /**
   * 운영정보 미확인 장소를 편성할지. F3의 '확인 불가 장소는 자동 편성 대상에서 제외'가
   * 원칙이지만, 임시 데이터는 전부 미확인이라 개발 중에만 켠다.
   */
  readonly allowUnverified: boolean;
  /** 문 열기를 기다려도 되는 상한(분). */
  readonly maxWaitMinutes: number;
  /** 권장 체류시간의 몇 할은 확보돼야 편성하는지. */
  readonly minStayRatio: number;
  readonly walkLimitKm: number;
  /** 1보다 크면 정체. 실시간 교통정보를 붙이면 여기로 넘긴다. */
  readonly congestion: number;
  /** 시간대별로 보관할 대안 개수. F2 완료 기준이 2개 이상이므로 그보다 넉넉하게. */
  readonly alternativesPerSlot: number;
  /**
   * 시간대를 편성하려면 최소 이만큼의 대안이 있어야 한다 — F2의 '대안 2개 이상'을
   * 계획 생성 단계에서 지킨다. 남은 시간 끝의 짧은 창에 대안 없는 방문지를 욱여넣는 대신
   * 그 시간을 비워 둔다. **첫 시간대는 예외**로, 대안이 없어도 하나는 제안한다.
   */
  readonly minAlternativesPerSlot: number;
  /** 상위 몇 개 중에서 seed로 채택안을 고를지. 1이면 항상 최고점만 뽑는다. */
  readonly explorationPoolSize: number;
  readonly maxSlots: number;
}

export interface PlanDiagnostics {
  /** 카테고리로 좁힌 뒤 남은 후보 수. */
  readonly candidateCount: number;
  /** 출발 위치에서 가장 가까운 후보까지의 직선거리(km). 후보가 없으면 null. */
  readonly nearestCandidateKm: number | null;
  readonly rejections: Readonly<Partial<Record<RejectReason, number>>>;
  /** 계획을 못 만들었거나 대안이 부족할 때 화면에 그대로 보여줄 문구. */
  readonly notes: readonly string[];
  readonly elapsedMs: number;
}

export interface PlanResult {
  readonly plan: Plan | null;
  readonly diagnostics: PlanDiagnostics;
}
