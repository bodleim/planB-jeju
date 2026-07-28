import { WALK_LIMIT_KM, estimateTravelMinutes, haversineKm, travelModeFor } from '../geo.ts';
import { intervalsAt } from '../hours.ts';
import { createRng, pickIndex } from '../rng.ts';
import { categoryFitOf, scoreVisit, type ScoreContext } from './score.ts';
import type { Exposure, LatLng, MinuteOfDay, Place, TripCategory, Weekday } from '../types.ts';
import type {
  FeasibleVisit,
  Plan,
  PlanInput,
  PlanPolicy,
  PlanResult,
  PlanSlot,
  RejectReason,
  ScoredVisit,
  VisitAttempt,
} from './types.ts';

export const DEFAULT_POLICY: PlanPolicy = {
  allowUnverified: false,
  maxWaitMinutes: 20,
  minStayRatio: 0.6,
  walkLimitKm: WALK_LIMIT_KM,
  congestion: 1,
  maxTravelShare: 0.4,
  alternativesPerSlot: 3,
  minAlternativesPerSlot: 2,
  explorationPoolSize: 3,
  maxSlots: 8,
};

/**
 * 임시 데이터로 개발하는 동안만 쓴다. 비짓제주 실데이터로 교체하면 DEFAULT_POLICY로 되돌린다.
 * 이 정책으로 만든 계획은 화면에서 반드시 '운영시간 확인 필요'를 함께 보여줘야 한다.
 */
export const PLACEHOLDER_POLICY: PlanPolicy = { ...DEFAULT_POLICY, allowUnverified: true };

export interface VisitContext {
  readonly from: LatLng;
  readonly departMinutes: MinuteOfDay;
  readonly deadlineMinutes: MinuteOfDay;
  readonly weekday: Weekday;
  readonly hasCar: boolean;
  /** 생략하면 카테고리 축을 보지 않는다 — F3는 하드 제약만 판정하고 카테고리 narrowing은 그 다음이다. */
  readonly category?: TripCategory;
  readonly policy: PlanPolicy;
}

/** 여러 구간에서 탈락했을 때, 편성에 가장 가까웠던 이유를 보고한다. */
const REASON_RANK: Readonly<Record<RejectReason, number>> = {
  category_mismatch: 0,
  unverified: 1,
  transport_unavailable: 2,
  closed_that_day: 3,
  past_deadline: 4,
  closed_on_arrival: 5,
  wait_too_long: 6,
  stay_too_short: 7,
};

const closerToFeasible = (a: RejectReason | null, b: RejectReason): RejectReason =>
  a === null || REASON_RANK[b] > REASON_RANK[a] ? b : a;

/**
 * 한 후보를 지금 시간대에 넣어본다. 이 함수가 통과시킨 방문지는
 *
 * - **도착 시각에** 실제로 열려 있고 (출발 시각이 아니다)
 * - 마감 입장 시간을 넘기지 않고
 * - 남은 시간(또는 다음 예약) 안에서 최소 체류시간을 확보한다.
 *
 * F1의 완료 기준이 이 세 줄에 걸려 있다. 여기를 느슨하게 고치면 문 닫은 곳이 일정에 뜬다.
 */
export function tryVisit(place: Place, context: VisitContext): VisitAttempt {
  const { policy } = context;

  if (context.category !== undefined && categoryFitOf(place, context.category) <= 0) {
    return { ok: false, reason: 'category_mismatch' };
  }
  if (!policy.allowUnverified && !place.verified) return { ok: false, reason: 'unverified' };

  const distanceKm = haversineKm(context.from, place.coord);
  const mode = travelModeFor(context.hasCar, distanceKm, policy.walkLimitKm);
  const travelMinutes = estimateTravelMinutes(context.from, place.coord, mode, policy.congestion);
  const arriveMinutes = context.departMinutes + travelMinutes;
  if (arriveMinutes >= context.deadlineMinutes) return { ok: false, reason: 'past_deadline' };

  const intervals = intervalsAt(place.hours, context.weekday);
  if (intervals.length === 0) return { ok: false, reason: 'closed_that_day' };

  const stayFloor = Math.max(
    place.minStayMinutes,
    Math.round(place.stayMinutes * policy.minStayRatio),
  );

  let best: FeasibleVisit | null = null;
  let rejected: RejectReason | null = null;

  for (const interval of intervals) {
    const startMinutes = Math.max(arriveMinutes, interval.open);
    const latestEntry = interval.close - place.lastAdmissionBeforeClose;
    if (startMinutes >= latestEntry) {
      rejected = closerToFeasible(rejected, 'closed_on_arrival');
      continue;
    }

    const waitMinutes = startMinutes - arriveMinutes;
    if (waitMinutes > policy.maxWaitMinutes) {
      rejected = closerToFeasible(rejected, 'wait_too_long');
      continue;
    }

    const usableUntil = Math.min(interval.close, context.deadlineMinutes);
    const stayMinutes = Math.min(place.stayMinutes, usableUntil - startMinutes);
    if (stayMinutes < stayFloor) {
      rejected = closerToFeasible(rejected, 'stay_too_short');
      continue;
    }

    const visit: FeasibleVisit = {
      place,
      mode,
      distanceKm,
      travelMinutes,
      waitMinutes,
      departMinutes: context.departMinutes,
      arriveMinutes,
      startMinutes,
      endMinutes: startMinutes + stayMinutes,
      stayMinutes,
      closeMinutes: interval.close,
      costPerPerson: place.costPerPerson,
    };
    if (best === null || visit.startMinutes < best.startMinutes) best = visit;
  }

  if (best !== null) return { ok: true, visit: best };
  return { ok: false, reason: rejected ?? 'closed_on_arrival' };
}

/**
 * F1. 남은 시간과 여행 성격만으로 시간대별 계획 1개를 만든다.
 *
 * 후보 집합을 인자로 받는 이유는 F3 필터를 앞에 끼울 자리를 비워두기 위해서다.
 * 기상·결항으로 걸러낸 후보를 넘기면 이 함수는 그대로 동작한다.
 *
 * 각 시간대에는 채택안과 함께 **같은 조건에서 검증된 대안**을 보관한다 — F2 스와이프 재고다.
 */
export function generatePlan(
  input: PlanInput,
  candidates: readonly Place[],
  policy: PlanPolicy = DEFAULT_POLICY,
): PlanResult {
  const startedAt = performance.now();
  const partySize = Math.max(1, input.partySize ?? 1);
  const deadlineMinutes = Math.min(
    input.startMinutes + Math.max(0, input.remainingMinutes),
    input.endByMinutes ?? Number.POSITIVE_INFINITY,
  );

  const rejections: Partial<Record<RejectReason, number>> = {};
  const countRejection = (reason: RejectReason): void => {
    rejections[reason] = (rejections[reason] ?? 0) + 1;
  };
  const notes: string[] = [];

  const blockedTransport = new Set(input.blockedTransport ?? []);
  const pool = candidates.filter((place) => {
    if (categoryFitOf(place, input.category) <= 0) {
      countRejection('category_mismatch');
      return false;
    }
    if (!policy.allowUnverified && !place.verified) {
      countRejection('unverified');
      return false;
    }
    if (place.dependsOn !== undefined && blockedTransport.has(place.dependsOn)) {
      countRejection('transport_unavailable');
      return false;
    }
    return true;
  });

  // 위치 감지 결과가 스냅샷 범위(성산권) 밖이면 이동시간만 커지고 계획이 얇아진다.
  // 조용히 빈 결과를 주지 않고 거리를 남겨 화면이 이유를 설명할 수 있게 한다.
  const nearestCandidateKm =
    pool.length === 0
      ? null
      : Math.round(
          Math.min(...pool.map((place) => haversineKm(input.origin, place.coord))) * 10,
        ) / 10;
  if (nearestCandidateKm !== null && nearestCandidateKm > 25) {
    notes.push(
      `현재 위치에서 가장 가까운 후보가 ${nearestCandidateKm}km 떨어져 있습니다. ` +
        '후보 데이터가 성산권 기준이라 이동시간이 큽니다.',
    );
  }

  const costCeiling = pool.reduce((max, place) => Math.max(max, place.costPerPerson), 0);
  // 이동시간 정규화 기준. 남은 시간의 1/3을 이동에 쓰면 사실상 최악이라고 보고,
  // 아주 짧거나 아주 긴 입력에서 기준이 무너지지 않게 20~90분으로 묶는다.
  const travelCeiling = Math.max(20, Math.min(90, Math.round(input.remainingMinutes / 3)));

  const rng = createRng(input.seed ?? 1);
  const preferredIds =
    input.preferredIds !== undefined && input.preferredIds.length > 0
      ? new Set(input.preferredIds)
      : undefined;
  const usedIds = new Set<string>();
  const usedAreas = new Set<string>();
  const usedExposures = new Set<Exposure>();
  const slots: PlanSlot[] = [];

  let cursor = input.origin;
  let clock = input.startMinutes;

  while (slots.length < policy.maxSlots) {
    const visitContext: VisitContext = {
      from: cursor,
      departMinutes: clock,
      deadlineMinutes,
      weekday: input.weekday,
      hasCar: input.hasCar,
      category: input.category,
      policy,
    };
    const scoreContext: ScoreContext = {
      category: input.category,
      usedAreas,
      usedExposures,
      costCeiling,
      travelCeiling,
      deadlineMinutes,
      ...(preferredIds !== undefined ? { preferredIds } : {}),
    };

    const scored: ScoredVisit[] = [];
    for (const place of pool) {
      if (usedIds.has(place.id)) continue;
      const attempt = tryVisit(place, visitContext);
      if (!attempt.ok) {
        countRejection(attempt.reason);
        continue;
      }
      scored.push({ visit: attempt.visit, score: scoreVisit(attempt.visit, scoreContext) });
    }
    if (scored.length === 0) break;

    scored.sort((a, b) => b.score.total - a.score.total);

    // F2 스와이프가 이 시간대를 고정했으면 그 장소를 쓴다. 단 위 루프를 통과한
    // 후보 안에서만 찾는다 — 고정으로 제약을 우회할 수는 없다 (문 닫은 곳이 들어오면
    // F1의 완료 기준이 깨진다). 못 찾으면 점수로 고르고 이유를 notes에 남긴다.
    const pinnedId = input.pins?.[slots.length];
    const pinnedIndex = pinnedId === undefined ? -1 : scored.findIndex((e) => e.visit.place.id === pinnedId);
    if (pinnedId !== undefined && pinnedIndex < 0) {
      notes.push(`선택한 대안을 이 시간대에 넣을 수 없어 다른 곳으로 채웠습니다 (영업시간·남은 시간 제약).`);
    }

    // 상위 몇 개 중에서 seed로 고른다. 항상 최고점만 뽑으면 새로고침해도 같은 계획이 나온다.
    const explorationSize = Math.min(policy.explorationPoolSize, scored.length);
    const weights = scored.slice(0, explorationSize).map((entry) => entry.score.total ** 4);
    const pickedIndex = pinnedIndex >= 0 ? pinnedIndex : pickIndex(rng, weights);
    const chosen = scored[pickedIndex];
    const alternatives = scored
      .filter((_, index) => index !== pickedIndex)
      .slice(0, policy.alternativesPerSlot);

    // 남은 시간 끝에 남는 짧은 창에는 들어갈 후보가 하나뿐인 경우가 많다.
    // 그런 시간대를 편성하면 스와이프할 대안이 없으므로, 채우지 않고 남겨 둔다.
    // 사용자가 직접 고른(고정한) 시간대는 예외다 — 대안이 없다고 빼면 선택이 사라진다.
    if (slots.length > 0 && pinnedIndex < 0 && alternatives.length < policy.minAlternativesPerSlot) break;

    slots.push({ index: slots.length, chosen, alternatives });
    usedIds.add(chosen.visit.place.id);
    usedAreas.add(chosen.visit.place.area);
    usedExposures.add(chosen.visit.place.exposure);
    cursor = chosen.visit.place.coord;
    clock = chosen.visit.endMinutes;
  }

  const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;

  if (slots.length === 0) {
    notes.push(
      pool.length === 0
        ? '고른 카테고리 조합에 맞는 후보가 없습니다. 활동 성격을 바꿔보세요.'
        : '남은 시간과 영업시간을 모두 만족하는 후보가 없습니다. 시간대나 남은 시간을 조정해보세요.',
    );
    return {
      plan: null,
      diagnostics: { candidateCount: pool.length, nearestCandidateKm, rejections, notes, elapsedMs },
    };
  }

  const totals = {
    startMinutes: slots[0].chosen.visit.departMinutes,
    endMinutes: slots[slots.length - 1].chosen.visit.endMinutes,
    travelMinutes: slots.reduce((sum, slot) => sum + slot.chosen.visit.travelMinutes, 0),
    stayMinutes: slots.reduce((sum, slot) => sum + slot.chosen.visit.stayMinutes, 0),
    waitMinutes: slots.reduce((sum, slot) => sum + slot.chosen.visit.waitMinutes, 0),
    unusedMinutes: Math.max(
      0,
      deadlineMinutes - slots[slots.length - 1].chosen.visit.endMinutes,
    ),
    cost: slots.reduce((sum, slot) => sum + slot.chosen.visit.costPerPerson, 0) * partySize,
  };

  const needsConfirmation = slots
    .map((slot) => slot.chosen.visit.place)
    .filter((place) => !place.verified);

  if (needsConfirmation.length > 0) {
    notes.push('운영시간이 확인되지 않은 방문지가 있습니다. 방문 전에 전화나 공식 페이지로 확인하세요.');
  }
  const thinSlots = slots.filter((slot) => slot.alternatives.length < policy.minAlternativesPerSlot);
  if (thinSlots.length > 0) {
    notes.push(
      `대안이 ${policy.minAlternativesPerSlot}개 미만인 시간대가 ${thinSlots.length}곳 있습니다.` +
        ' 후보가 부족한 시간대입니다.',
    );
  }
  if (totals.unusedMinutes >= 30) {
    notes.push(
      `${totals.unusedMinutes}분이 남습니다. 이 시간에 넣을 만한 후보가 없거나, 대안이 부족해 편성하지 않았습니다.`,
    );
  }

  return {
    plan: { category: input.category, slots, totals, needsConfirmation },
    diagnostics: { candidateCount: pool.length, nearestCandidateKm, rejections, notes, elapsedMs },
  };
}

/** 계획 전체가 하나의 카테고리 조합을 따르는지. 불변식 확인용 — 화면·테스트에서 함께 쓴다. */
export function isSingleCategory(plan: Plan): boolean {
  return plan.slots.every((slot) => categoryFitOf(slot.chosen.visit.place, plan.category) > 0);
}
