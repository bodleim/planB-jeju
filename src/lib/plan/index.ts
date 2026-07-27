export {
  DEFAULT_POLICY,
  PLACEHOLDER_POLICY,
  generatePlan,
  isSingleCategory,
  tryVisit,
} from './generate.ts';
export type { VisitContext } from './generate.ts';
export {
  buildPlan,
  pinsFromQuery,
  pinsToQuery,
  reshuffle,
  setKey,
  swapPins,
  swapSlot,
} from './replace.ts';
export type { Pins, PlanView } from './replace.ts';
export { SCORE_WEIGHTS, categoryFitOf, scoreVisit } from './score.ts';
export type { ScoreContext } from './score.ts';
export type {
  FeasibleVisit,
  Plan,
  PlanDiagnostics,
  PlanInput,
  PlanPolicy,
  PlanResult,
  PlanSlot,
  PlanTotals,
  RejectReason,
  ScoreBreakdown,
  ScoredVisit,
  VisitAttempt,
} from './types.ts';
