import type { Exposure, MinuteOfDay, Place, TripCategory } from '../types.ts';
import type { FeasibleVisit, ScoreBreakdown } from './types.ts';

/**
 * 점수식. 합이 1이 되게 유지한다.
 *
 * 이 점수는 **제약을 이미 통과한 후보들** 사이의 순위만 정한다.
 * 제약 위반 0이 점수보다 우선하므로, 점수를 올려서 탈락 후보를 되살리는 식으로 쓰지 말 것.
 *
 * 카테고리 적합도는 기획서의 20%에서 30%로 올렸다 — 20%에서는 실행가능성·시간효율이 지배해서
 * 가족·커플·혼자를 바꿔도 액티비티 일정이 같은 결과로 수렴했다.
 *
 * 늘린 10%p는 실행가능성과 비용에서 5%p씩 뺐다. 처음에는 남은시간 효율에서 10%p를 뺐는데,
 * 효율 가중치가 낮아지자 남은 시간을 끝까지 욱여넣어 마지막 시간대가 30분대로 짧아지고
 * 거기에 넣을 대안이 말라버렸다(F2의 '대안 2개 이상'이 깨짐). 효율은 꼬리 시간대를 억제하는
 * 역할을 하므로 25%로 유지한다.
 */
export const SCORE_WEIGHTS = {
  feasibility: 0.25,
  timeEfficiency: 0.25,
  categoryFit: 0.3,
  cost: 0.05,
  travel: 0.1,
  diversity: 0.05,
} as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 두 축의 적합도를 하나로 합친다. 어느 한 축이라도 0이면 0 — '가족 + 먹거리'는
 * 가족에게 맞으면서 먹거리이기도 해야 한다.
 *
 * 산술평균이 아니라 기하평균을 쓰는 이유는, 한 축만 뛰어나고 다른 축이 간신히 걸치는 곳
 * (예: 먹거리 1.0 / 가족 0.2)을 양쪽이 고른 곳보다 낮게 두기 위해서다.
 */
export function categoryFitOf(place: Place, category: TripCategory): number {
  const companion = clamp01(place.companionFit[category.companion] ?? 0);
  // 활동은 중복 선택(OR) — 고른 것 중 가장 잘 맞는 축으로 평가한다.
  const activity = category.activity.reduce(
    (best, a) => Math.max(best, clamp01(place.activityFit[a] ?? 0)),
    0,
  );
  if (companion <= 0 || activity <= 0) return 0;
  return Math.sqrt(companion * activity);
}

export interface ScoreContext {
  readonly category: TripCategory;
  /** 이미 계획에 들어간 권역·노출도. 같은 것만 반복되는 일정을 막는다. */
  readonly usedAreas: ReadonlySet<string>;
  readonly usedExposures: ReadonlySet<Exposure>;
  /** 비용 정규화 기준(원). 후보 풀의 최대 지출. */
  readonly costCeiling: number;
  /** 이동시간 정규화 기준(분). */
  readonly travelCeiling: number;
  readonly deadlineMinutes: MinuteOfDay;
  /**
   * 사용자가 직접 말한 선호 장소 ('직접 말하기' → LLM 이 후보 목록에서 고른 id).
   * 제약을 통과한 후보 사이의 순위만 끌어올린다 — 탈락 후보를 되살리지 못한다.
   */
  readonly preferredIds?: ReadonlySet<string>;
}

export function scoreVisit(visit: FeasibleVisit, context: ScoreContext): ScoreBreakdown {
  const { place } = visit;

  // 실행가능성: 권장 체류시간을 얼마나 확보했는지 + 마감·다음 일정까지 여유가 있는지.
  // 문 닫기 직전에 겨우 들어가는 일정은 통과는 해도 낮은 점수를 받아야 한다.
  const stayRatio = place.stayMinutes > 0 ? clamp01(visit.stayMinutes / place.stayMinutes) : 1;
  const closingSlack = clamp01((visit.closeMinutes - visit.endMinutes) / 30);
  const deadlineSlack = clamp01((context.deadlineMinutes - visit.endMinutes) / 60);
  const feasibility = 0.5 * stayRatio + 0.25 * closingSlack + 0.25 * deadlineSlack;

  // 남은시간 효율: 쓴 시간 중 실제로 머문 비율. 이동·대기가 길면 떨어진다.
  const spent = visit.travelMinutes + visit.waitMinutes + visit.stayMinutes;
  const timeEfficiency = spent > 0 ? clamp01(visit.stayMinutes / spent) : 0;

  const categoryFit = categoryFitOf(place, context.category);

  const cost =
    context.costCeiling > 0 ? 1 - clamp01(visit.costPerPerson / context.costCeiling) : 1;

  const travel =
    context.travelCeiling > 0 ? 1 - clamp01(visit.travelMinutes / context.travelCeiling) : 1;

  const diversity =
    (context.usedAreas.has(place.area) ? 0 : 0.6) +
    (context.usedExposures.has(place.exposure) ? 0 : 0.4);

  // 사용자가 직접 말한 선호는 가중치 합(1.0) 바깥의 추가 보너스다. 0.35 는 통과 후보들의
  // 점수 격차(보통 0.1~0.2)보다 확실히 커서, **제약을 통과했다면 그 시간대를 차지한다** —
  // '직접 말하기'는 추천 힌트가 아니라 사용자의 결정이다. 선호끼리는 여전히 기본 점수로 겨룬다.
  // 제약(영업·기상·남은시간)은 tryVisit 이 먼저 자르므로 이 보너스로는 못 되살린다.
  const preferred = context.preferredIds?.has(place.id) ? 0.35 : 0;

  const total =
    SCORE_WEIGHTS.feasibility * feasibility +
    SCORE_WEIGHTS.timeEfficiency * timeEfficiency +
    SCORE_WEIGHTS.categoryFit * categoryFit +
    SCORE_WEIGHTS.cost * cost +
    SCORE_WEIGHTS.travel * travel +
    SCORE_WEIGHTS.diversity * diversity +
    preferred;

  return { feasibility, timeEfficiency, categoryFit, cost, travel, diversity, total };
}
