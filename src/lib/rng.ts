/**
 * 시드 기반 난수. Math.random을 쓰지 않는 이유는 두 가지다.
 * - 같은 URL이면 같은 계획이 나와야 리허설 URL을 북마크할 수 있다.
 * - F2의 '새로고침 = 전체 재생성'을 쿼리의 seed 값 변경으로 표현할 수 있다.
 */
export type Rng = () => number;

/** mulberry32. */
export function createRng(seed: number): Rng {
  let state = (seed | 0) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 문자열을 시드로. 쿼리에 문자열 seed가 와도 받을 수 있게 둔다. */
export function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 가중치에 비례해 인덱스를 고른다. 가중치 합이 0이면 0을 돌려준다. */
export function pickIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return 0;
  let threshold = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    threshold -= Math.max(0, weights[i]);
    if (threshold <= 0) return i;
  }
  return weights.length - 1;
}
