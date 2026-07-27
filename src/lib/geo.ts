/** 거리·이동시간 추정. F3 필터와 F1 일정 생성이 같은 값을 쓴다. */
import type { Coord, TravelMode } from './types.ts'

const EARTH_R_KM = 6371

export function haversineKm(a: Coord, b: Coord): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(s))
}

/**
 * 튜닝 노브. 직선거리 → 실제 소요시간으로 바꾸는 계수들이며
 * 제주 실시간 교통정보 스냅샷을 보고 조정한다.
 */
export const TRAVEL = {
  /** 직선거리 대비 실제 도로 거리 배수 (제주 해안도로·우회) */
  roadFactor: { car: 1.3, walk: 1.25 },
  /** 평균 속도 km/h. 제주 국도는 신호·관광차량 때문에 시내 주행에 가깝다 */
  speedKmh: { car: 38, walk: 4.2 },
  /** 주차·출발·도착 오버헤드(분) */
  overheadMinutes: { car: 5, walk: 1 },
  /**
   * 정체 배수. 1.0 = 정체 없음.
   * ponytail: 제주 ITS 스냅샷(jeju-traffic.json)의 구간 평균속도로 대체할 지점.
   *           지금은 전 구간 균일값이라 실제 정체 구간을 구분하지 못한다.
   */
  trafficFactor: 1.0,
}

/**
 * 두 좌표 사이 이동시간(분). 이 함수만 바꾸면 필터와 일정 생성 양쪽에 반영된다.
 *
 * 실측이 아니라 추정값이다 — 화면에 '예상' 으로 표시하고 확정 표현을 쓰지 말 것.
 */
export function estimateTravelMinutes(from: Coord, to: Coord, mode: TravelMode = 'car'): number {
  const km = haversineKm(from, to) * TRAVEL.roadFactor[mode]
  const minutes = (km / TRAVEL.speedKmh[mode]) * 60 * (mode === 'car' ? TRAVEL.trafficFactor : 1)
  return Math.round(minutes + TRAVEL.overheadMinutes[mode])
}
