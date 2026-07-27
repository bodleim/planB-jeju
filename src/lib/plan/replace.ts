/**
 * F2 — 시간대별 대안 교체.
 *
 * 스와이프의 실체는 '그 시간대에 다른 장소를 고정하고 계획을 다시 만드는 것' 이다.
 * 새 계획을 만드는 이유는 **교체하면 뒤 시간대의 출발 시각이 밀리기 때문**이다.
 * `PlanSlot.alternatives` 를 그 자리에 그냥 끼워 넣으면 뒤 시간대가 실제 도착 시각과
 * 어긋나고, '모든 방문지는 도착 시각에 열려 있다' 는 F1 의 완료 기준이 깨진다.
 *
 * 그래서 교체도 재생성도 전부 `generatePlan()` 을 다시 부른다 — 제약 검사가 한 곳에만
 * 있으니 대안이라는 이유로 문 닫은 곳이 끼어들 수 없다.
 *
 * 상태는 **고정된 장소 id 목록(`pins`)** 하나뿐이다. 쿼리스트링에 그대로 실을 수 있어서
 * 서버 렌더링 + GET 링크만으로 스와이프가 되고, JS 가 죽어도 동작한다.
 */
import { generatePlan } from './generate.ts'
import type { Plan, PlanInput, PlanPolicy, PlanResult } from './types.ts'
import type { Place } from '../types.ts'

/** 각 시간대에 고정된 장소 id. 인덱스가 시간대 순서다. 빈 칸은 점수로 고른다. */
export type Pins = readonly string[]

/** 계획을 그대로 재현할 수 있는 최소 상태. 화면이 쿼리로 주고받는 값이다. */
export type PlanView = {
  result: PlanResult
  pins: Pins
  seed: number
}

function build(
  input: PlanInput,
  candidates: readonly Place[],
  policy: PlanPolicy,
  pins: Pins,
  seed: number,
): PlanView {
  return { result: generatePlan({ ...input, seed, pins }, candidates, policy), pins, seed }
}

/** 지금 계획을 그대로 만든다 (첫 진입·새로고침 아님). */
export function buildPlan(
  input: PlanInput,
  candidates: readonly Place[],
  policy: PlanPolicy,
  pins: Pins = [],
  seed = 1,
): PlanView {
  return build(input, candidates, policy, pins, seed)
}

/**
 * 한 시간대만 대안으로 바꾼다 (좌우 스와이프).
 *
 * `direction` 은 그 시간대 대안 목록에서 몇 칸 옮길지다 (+1 다음, -1 이전).
 * **그 앞 시간대는 지금 채택안으로 고정**하고 그 뒤는 다시 채운다 — 앞을 고정하지 않으면
 * 한 칸 넘길 때마다 앞 시간대까지 흔들려서 "해당 시간대만 교체" 가 성립하지 않는다.
 *
 * 넘길 대안이 없으면(그 시간대 후보가 하나뿐) 같은 계획을 그대로 돌려준다.
 */
export function swapSlot(
  view: PlanView,
  slotIndex: number,
  direction: 1 | -1,
  input: PlanInput,
  candidates: readonly Place[],
  policy: PlanPolicy,
): PlanView {
  const pins = swapPins(view, slotIndex, direction)
  return pins === null ? view : build(input, candidates, policy, pins, view.seed)
}

/**
 * 교체 결과의 `pins` 만 계산한다. 계획을 다시 만들지 않는다.
 *
 * 화면이 시간대마다 이전·다음 링크를 뿌릴 때 쓴다 — 링크는 목적지 URL 만 필요하고,
 * 그 URL 을 열면 그때 계획이 만들어진다. 링크 개수만큼 계획을 미리 만들 이유가 없다.
 * 넘길 대안이 없으면 null.
 */
export function swapPins(view: PlanView, slotIndex: number, direction: 1 | -1): Pins | null {
  const plan = view.result.plan
  const slot = plan?.slots[slotIndex]
  if (!plan || !slot) return null

  // 그 시간대에 들어갈 수 있는 장소들 — 채택안 + 대안을 한 줄로 세운 게 스와이프 축이다.
  //
  // **채택 여부와 무관한 순서로 정렬한다.** `[chosen, ...alternatives]` 를 그대로 쓰면
  // 채택안이 늘 맨 앞이라 한 칸 넘긴 뒤 또 넘길 때 제자리로 돌아와 두 곳만 왕복한다.
  //
  // 점수만으로 정렬해도 부족하다 — 동점이 흔하고(카페 두 곳이 0.8961로 같았다) 안정 정렬이
  // 동점 구간에서 채택안을 앞에 그대로 두기 때문에 같은 왕복이 남는다. id 로 동점을 깨면
  // 어느 곳이 채택돼 있든 순서가 같아서 계속 넘길 때 실제로 순회한다.
  const ring = [slot.chosen, ...slot.alternatives]
    .slice()
    .sort(
      (a, b) =>
        b.score.total - a.score.total || a.visit.place.id.localeCompare(b.visit.place.id),
    )
    .map((entry) => entry.visit.place.id)
  if (ring.length < 2) return null

  const current = ring.indexOf(slot.chosen.visit.place.id)
  const next = ring[(current + direction + ring.length) % ring.length]

  return [...plan.slots.slice(0, slotIndex).map((s) => s.chosen.visit.place.id), next]
}

/**
 * 전체 일정을 다시 만든다 (새로고침). 고정을 모두 풀고 seed 만 바꾼다.
 * seed 가 같으면 같은 계획이 나오므로 리허설 URL 을 북마크할 수 있다.
 */
export function reshuffle(
  view: PlanView,
  input: PlanInput,
  candidates: readonly Place[],
  policy: PlanPolicy,
): PlanView {
  return build(input, candidates, policy, [], view.seed + 1)
}

/** 계획의 장소 조합. 두 계획이 실제로 다른지 판정한다 (F2 완료 기준: 조합이 달라진다). */
export function setKey(plan: Plan | null): string {
  return plan === null ? '' : plan.slots.map((s) => s.chosen.visit.place.id).join('>')
}

// ------------------------------------------------------------------ 쿼리 직렬화

/**
 * `pins` 를 쿼리 값으로. 장소 id 를 그대로 쓴다 — 대안 목록의 순서는 출발 시각에 따라
 * 달라지므로 '2번째 대안' 같은 인덱스로 저장하면 링크가 가리키는 곳이 바뀐다.
 */
export function pinsToQuery(pins: Pins): string {
  return pins.join(',')
}

export function pinsFromQuery(raw: string | null | undefined): Pins {
  if (!raw) return []
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '' && /^[\w-]+$/.test(id))
}
