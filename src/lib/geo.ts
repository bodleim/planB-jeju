import type { LatLng } from './types';

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function haversineKm(from: LatLng, to: LatLng): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 제주도 대략 경계. 위치 감지 결과가 이 밖이면 이 서비스의 후보 범위를 벗어난 것이다. */
export const JEJU_BOUNDS = {
  minLat: 33.1,
  maxLat: 33.65,
  minLng: 126.1,
  maxLng: 127.0,
} as const;

export function isInJeju(coord: LatLng): boolean {
  return (
    coord.lat >= JEJU_BOUNDS.minLat &&
    coord.lat <= JEJU_BOUNDS.maxLat &&
    coord.lng >= JEJU_BOUNDS.minLng &&
    coord.lng <= JEJU_BOUNDS.maxLng
  );
}

/**
 * 위치 감지 결과(또는 쿼리 문자열)를 좌표로 바꾼다. 숫자가 아니거나 제주 밖이면 null이다.
 * 호출한 쪽은 null일 때 ORIGINS의 폴백 지점을 쓰고 화면에 그 사실을 표시해야 한다.
 */
export function parseJejuCoord(lat: unknown, lng: unknown): LatLng | null {
  const parsedLat = typeof lat === 'number' ? lat : Number(lat);
  const parsedLng = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  const coord: LatLng = { lat: parsedLat, lng: parsedLng };
  return isInJeju(coord) ? coord : null;
}

export type TravelMode = 'car' | 'transit' | 'walk';

/** 도보로 감당할 거리 상한(km). 넘으면 차 없는 사용자는 대중교통으로 계산한다. */
export const WALK_LIMIT_KM = 1.2;

const SPEED_KMH: Readonly<Record<TravelMode, number>> = {
  car: 35,
  transit: 18,
  walk: 4.5,
};

/** 주차·정류장 접근·환승처럼 거리와 무관하게 붙는 시간(분). */
const FIXED_OVERHEAD_MINUTES: Readonly<Record<TravelMode, number>> = {
  car: 6,
  transit: 15,
  walk: 2,
};

/** 직선거리를 실제 경로 길이로 보정하는 계수. 제주 해안도로 우회를 감안한 값. */
const DETOUR_FACTOR = 1.3;

export function travelModeFor(
  hasCar: boolean,
  distanceKm: number,
  walkLimitKm: number = WALK_LIMIT_KM,
): TravelMode {
  if (hasCar) return 'car';
  return distanceKm <= walkLimitKm ? 'walk' : 'transit';
}

/**
 * 이동시간 추정의 **단일 진입점**.
 *
 * 제주 실시간 교통정보(data.go.kr 15093660)로 보정할 때 이 함수만 바꾸면
 * F3 필터와 F1 계획 생성 양쪽에 반영된다. 다른 곳에서 거리를 시간으로 바꾸지 말 것.
 *
 * 지금은 직선거리 × 우회계수 ÷ 평균속도 + 고정 오버헤드다. 실측이 아니라 추정치이므로
 * 화면에서는 '예상'으로 표시해야 한다.
 *
 * @param congestion 1보다 크면 정체. 실시간 교통정보를 붙이면 이 인자로 넘긴다.
 */
export function estimateTravelMinutes(
  from: LatLng,
  to: LatLng,
  mode: TravelMode,
  congestion = 1,
): number {
  const distanceKm = haversineKm(from, to) * DETOUR_FACTOR;
  if (distanceKm < 0.05) return 0;
  const minutes = (distanceKm / SPEED_KMH[mode]) * 60 * Math.max(1, congestion);
  return Math.max(1, Math.round(minutes + FIXED_OVERHEAD_MINUTES[mode]));
}
