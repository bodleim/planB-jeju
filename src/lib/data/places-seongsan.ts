/**
 * 성산권 후보 장소 — **임시 데이터**.
 *
 * 이 파일의 운영시간·요금·좌표는 확인된 사실이 아니라 자리표시자다. 전부 `verified: false`이고
 * `source`는 'placeholder'다. 비짓제주 관광정보(data.go.kr 15076361) 스냅샷으로 교체하고,
 * 그때 `PLACEHOLDER_POLICY` 대신 `DEFAULT_POLICY`를 쓰면 미확인 장소는 자동으로 편성에서 빠진다.
 *
 * 화면에서 이 값을 사실처럼 보여주면 안 된다 — '확인 필요' 표시와 함께 내보내야 한다.
 * 음식점·카페는 특정 업소의 영업시간을 단정하지 않으려고 일반 명칭을 썼다.
 *
 * 적합도는 두 축으로 매긴다. `companionFit`(가족·커플·혼자)과 `activityFit`(실내 위주·먹거리·
 * 액티비티) **양쪽이 모두 0보다 커야** 후보가 된다.
 */
import { alwaysOpen, weeklyHours } from '../hours';
import type { LatLng, Place } from '../types';

const PLACEHOLDER_SOURCE = 'placeholder';

export const PLACES_SNAPSHOT = {
  source: PLACEHOLDER_SOURCE,
  /** 임시 데이터라 수집 시각이 없다. 실데이터로 교체할 때 스냅샷 수집 시각을 넣는다. */
  collectedAt: null,
  authoredOn: '2026-07-27',
  note: '비짓제주 스냅샷 교체 전까지 쓰는 자리표시자. 운영시간은 확인되지 않았다.',
} as const;

type PlaceholderInput = Omit<
  Place,
  'verified' | 'source' | 'minStayMinutes' | 'lastAdmissionBeforeClose'
> &
  Partial<Pick<Place, 'minStayMinutes' | 'lastAdmissionBeforeClose'>>;

function placeholder(input: PlaceholderInput): Place {
  return {
    ...input,
    minStayMinutes: input.minStayMinutes ?? Math.round(input.stayMinutes * 0.5),
    lastAdmissionBeforeClose: input.lastAdmissionBeforeClose ?? 0,
    verified: false,
    source: PLACEHOLDER_SOURCE,
  };
}

/**
 * 시작 지점 후보. 기본 경로는 브라우저 위치 감지이고, 이 목록은 위치 권한이 거부됐을 때의
 * 폴백과 리허설 URL용이다. 키는 쿼리의 origin 값과 맞춘다.
 */
export const ORIGINS: Readonly<Record<string, { readonly label: string; readonly coord: LatLng }>> =
  {
    seongsan_port: { label: '성산항', coord: { lat: 33.4744, lng: 126.9319 } },
    seongsan_ilchulbong: { label: '성산일출봉 주차장', coord: { lat: 33.4587, lng: 126.9425 } },
    pyoseon: { label: '표선', coord: { lat: 33.3247, lng: 126.832 } },
  };

export const SEONGSAN_PLACES: readonly Place[] = [
  placeholder({
    id: 'seongsan-ilchulbong',
    name: '성산일출봉',
    area: '성산',
    coord: { lat: 33.4587, lng: 126.9425 },
    exposure: 'outdoor',
    companionFit: { family: 0.6, couple: 0.7, solo: 0.5 },
    activityFit: { activity: 1 },
    stayMinutes: 90,
    minStayMinutes: 60,
    costPerPerson: 5000,
    hours: weeklyHours('07:00', '20:00'),
    lastAdmissionBeforeClose: 60,
  }),
  placeholder({
    id: 'seopjikoji',
    name: '섭지코지',
    area: '성산',
    coord: { lat: 33.4237, lng: 126.931 },
    exposure: 'coastal',
    companionFit: { family: 0.6, couple: 1, solo: 0.6 },
    activityFit: { activity: 0.9 },
    stayMinutes: 70,
    costPerPerson: 0,
    hours: weeklyHours('06:00', '19:00'),
  }),
  placeholder({
    id: 'gwangchigi-beach',
    name: '광치기해변',
    area: '성산',
    coord: { lat: 33.4478, lng: 126.927 },
    exposure: 'coastal',
    companionFit: { family: 0.5, couple: 0.8, solo: 0.7 },
    activityFit: { activity: 0.7 },
    stayMinutes: 45,
    costPerPerson: 0,
    hours: alwaysOpen(),
  }),
  placeholder({
    id: 'aquaplanet-jeju',
    name: '아쿠아플라넷 제주',
    area: '성산',
    coord: { lat: 33.4335, lng: 126.927 },
    exposure: 'indoor',
    companionFit: { family: 1, couple: 0.6, solo: 0.3 },
    activityFit: { indoor: 1, activity: 0.4 },
    stayMinutes: 120,
    minStayMinutes: 70,
    costPerPerson: 40000,
    hours: weeklyHours('09:30', '19:00'),
    lastAdmissionBeforeClose: 60,
  }),
  placeholder({
    id: 'kimyounggap-gallery',
    name: '김영갑갤러리 두모악',
    area: '삼달·신천',
    coord: { lat: 33.3897, lng: 126.859 },
    exposure: 'indoor',
    companionFit: { family: 0.3, couple: 0.6, solo: 1 },
    activityFit: { indoor: 0.9 },
    stayMinutes: 60,
    costPerPerson: 4500,
    // 수요일 휴무는 자리표시자다. 실데이터로 확인해야 한다.
    hours: weeklyHours('09:00', '18:00', { closedOn: [3] }),
    lastAdmissionBeforeClose: 30,
  }),
  placeholder({
    id: 'seongsan-craft-workshop',
    name: '성산 공예 체험공방',
    area: '고성·오조',
    coord: { lat: 33.4585, lng: 126.9285 },
    exposure: 'indoor',
    companionFit: { family: 0.9, couple: 0.8, solo: 0.4 },
    activityFit: { indoor: 0.8, activity: 0.5 },
    stayMinutes: 70,
    costPerPerson: 25000,
    hours: weeklyHours('10:00', '18:00'),
    lastAdmissionBeforeClose: 60,
  }),
  placeholder({
    id: 'honinji',
    name: '혼인지',
    area: '고성·오조',
    coord: { lat: 33.4188, lng: 126.8975 },
    exposure: 'outdoor',
    companionFit: { family: 0.4, couple: 0.9, solo: 0.5 },
    activityFit: { activity: 0.4 },
    stayMinutes: 40,
    costPerPerson: 0,
    hours: weeklyHours('08:00', '18:00'),
  }),
  // 짧게 들를 수 있는 후보. 마지막 시간대에 넣을 카드가 없으면 F2의 대안이 말라버린다.
  placeholder({
    id: 'seongsan-culture-center',
    name: '성산 생활문화센터 전시실',
    area: '성산',
    coord: { lat: 33.46, lng: 126.93 },
    exposure: 'indoor',
    companionFit: { family: 0.4, couple: 0.4, solo: 0.6 },
    activityFit: { indoor: 0.7 },
    stayMinutes: 35,
    minStayMinutes: 25,
    costPerPerson: 0,
    hours: weeklyHours('09:00', '18:00', { closedOn: [0] }),
  }),
  placeholder({
    id: 'nansan-craft-shop',
    name: '난산리 소품샵',
    area: '난산·신산',
    coord: { lat: 33.416, lng: 126.907 },
    exposure: 'indoor',
    companionFit: { family: 0.3, couple: 0.7, solo: 0.7 },
    activityFit: { indoor: 0.6 },
    stayMinutes: 30,
    minStayMinutes: 20,
    costPerPerson: 5000,
    hours: weeklyHours('11:00', '19:00', { closedOn: [2] }),
  }),
  placeholder({
    id: 'seongsanpo-fish-market',
    name: '성산포 수산시장',
    area: '성산',
    coord: { lat: 33.47, lng: 126.931 },
    exposure: 'covered',
    companionFit: { family: 0.7, couple: 0.5, solo: 0.5 },
    activityFit: { food: 1 },
    stayMinutes: 50,
    costPerPerson: 15000,
    hours: weeklyHours('06:00', '18:00'),
  }),
  placeholder({
    id: 'seongsan-haenyeo-house',
    name: '성산 해녀의집',
    area: '성산',
    coord: { lat: 33.464, lng: 126.927 },
    exposure: 'indoor',
    companionFit: { family: 0.8, couple: 0.7, solo: 0.5 },
    activityFit: { food: 1, indoor: 0.6 },
    stayMinutes: 60,
    costPerPerson: 18000,
    hours: weeklyHours('10:00', '19:00', { closedOn: [2] }),
    lastAdmissionBeforeClose: 30,
  }),
  placeholder({
    id: 'goseong-noodle',
    name: '고성리 국수집',
    area: '고성·오조',
    coord: { lat: 33.447, lng: 126.913 },
    exposure: 'indoor',
    companionFit: { family: 0.6, couple: 0.5, solo: 0.8 },
    activityFit: { food: 0.9, indoor: 0.6 },
    stayMinutes: 45,
    costPerPerson: 9000,
    hours: weeklyHours('10:00', '16:00'),
    lastAdmissionBeforeClose: 30,
  }),
  // 저녁 시간대 후보. 임시 데이터가 낮에만 열려 있으면 해가 지고 나서 계획이 비어버린다.
  placeholder({
    id: 'seongsan-pork-house',
    name: '성산 흑돼지 구잇집',
    area: '성산',
    coord: { lat: 33.4665, lng: 126.9295 },
    exposure: 'indoor',
    companionFit: { family: 0.8, couple: 0.7, solo: 0.4 },
    activityFit: { food: 0.9, indoor: 0.6 },
    stayMinutes: 70,
    costPerPerson: 22000,
    hours: weeklyHours('17:00', '22:00'),
    lastAdmissionBeforeClose: 30,
  }),
  placeholder({
    id: 'onpyeong-seafood',
    name: '온평리 해산물 식당',
    area: '온평·신산',
    coord: { lat: 33.402, lng: 126.896 },
    exposure: 'indoor',
    companionFit: { family: 0.7, couple: 0.6, solo: 0.4 },
    activityFit: { food: 1, indoor: 0.6 },
    stayMinutes: 60,
    costPerPerson: 25000,
    hours: weeklyHours('11:00', '21:00'),
    lastAdmissionBeforeClose: 30,
  }),
  placeholder({
    id: 'samdal-bakery-cafe',
    name: '삼달리 베이커리 카페',
    area: '삼달·신천',
    coord: { lat: 33.386, lng: 126.873 },
    exposure: 'indoor',
    companionFit: { family: 0.5, couple: 0.9, solo: 0.8 },
    activityFit: { food: 0.8, indoor: 0.7 },
    stayMinutes: 50,
    costPerPerson: 8000,
    hours: weeklyHours('10:00', '20:00'),
  }),
  placeholder({
    id: 'ojo-village-cafe',
    name: '오조리 마을 카페',
    area: '고성·오조',
    coord: { lat: 33.461, lng: 126.92 },
    exposure: 'indoor',
    companionFit: { family: 0.4, couple: 0.8, solo: 0.9 },
    activityFit: { food: 0.7, indoor: 0.7 },
    stayMinutes: 45,
    costPerPerson: 7000,
    hours: weeklyHours('09:00', '18:00'),
  }),
  placeholder({
    id: 'jeju-folk-village',
    name: '제주민속촌',
    area: '표선',
    coord: { lat: 33.3226, lng: 126.842 },
    exposure: 'outdoor',
    companionFit: { family: 1, couple: 0.5, solo: 0.4 },
    activityFit: { activity: 0.5, indoor: 0.3 },
    stayMinutes: 100,
    minStayMinutes: 60,
    costPerPerson: 15000,
    hours: weeklyHours('08:30', '18:00'),
    lastAdmissionBeforeClose: 60,
  }),
  placeholder({
    id: 'seongeup-folk-village',
    name: '성읍민속마을',
    area: '성읍',
    coord: { lat: 33.3862, lng: 126.797 },
    exposure: 'outdoor',
    companionFit: { family: 0.7, couple: 0.4, solo: 0.5 },
    activityFit: { activity: 0.4 },
    stayMinutes: 60,
    costPerPerson: 0,
    hours: weeklyHours('09:00', '18:00'),
  }),
  placeholder({
    id: 'pyoseon-beach',
    name: '표선해수욕장',
    area: '표선',
    coord: { lat: 33.3247, lng: 126.832 },
    exposure: 'coastal',
    companionFit: { family: 0.8, couple: 0.7, solo: 0.5 },
    activityFit: { activity: 0.8 },
    stayMinutes: 50,
    costPerPerson: 0,
    hours: alwaysOpen(),
  }),
  placeholder({
    id: 'udo-seobin-baeksa',
    name: '우도 서빈백사',
    area: '우도',
    coord: { lat: 33.5093, lng: 126.954 },
    exposure: 'coastal',
    // 배로만 갈 수 있다. 결항이면 F3(또는 PlanInput.blockedTransport)가 걷어낸다.
    dependsOn: 'ferry',
    companionFit: { family: 0.7, couple: 0.9, solo: 0.6 },
    activityFit: { activity: 1 },
    stayMinutes: 120,
    minStayMinutes: 90,
    costPerPerson: 12000,
    hours: alwaysOpen(),
  }),
];
