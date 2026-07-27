/**
 * 성산권 후보 장소 — **임시 데이터.**
 *
 * ⚠️ 운영시간은 확인된 사실이 아니라 자리표시자다. 전부 `verified: false` 이고
 *    필터는 PLACEHOLDER_POLICY 로만 이 데이터를 통과시킨다.
 *    화면에는 반드시 '확인 필요' 와 전화·공식 페이지 링크를 함께 표시할 것.
 *
 * 좌표도 근사값이다 (기상청 5km 격자와 이동시간 추정에는 충분하지만 길찾기 정확도는 아니다).
 *
 * 교체 방법:
 *   1. `npm run snapshot` 으로 관광공사/비짓제주 응답을 받는다
 *   2. 이 배열을 스냅샷 로더로 바꾸고 `verified` 를 실제 확인 여부로 채운다
 *   3. 필터 정책을 PLACEHOLDER_POLICY → DEFAULT_POLICY 로 되돌린다
 *
 * 발표 시나리오에 나오는 5~6곳은 공식 홈페이지로 직접 확인해 `verified: true` 로
 * 올려두는 게 안전하다 — API 가 빈 값을 주더라도 시연 경로는 돌아야 한다.
 */
import type { Place } from '../types.ts'

const PLACEHOLDER = '임시 데이터 (미확인)'

export const SEONGSAN_PLACES: Place[] = [
  {
    id: 'seongsan-ilchulbong',
    name: '성산일출봉',
    category: 'nature',
    lat: 33.458,
    lon: 126.9425,
    indoor: false,
    hazards: ['rain', 'wind', 'heat'],
    stayMinutes: 90,
    hours: { open: '07:00', close: '20:00', lastEntryMinutes: 60 },
    verified: false,
    source: PLACEHOLDER,
    url: 'https://www.jeju.go.kr/seongsan/index.htm',
  },
  {
    id: 'aquaplanet-jeju',
    name: '아쿠아플라넷 제주',
    category: 'activity',
    lat: 33.4348,
    lon: 126.9276,
    indoor: true,
    hazards: [],
    stayMinutes: 120,
    hours: { open: '10:00', close: '19:00', lastEntryMinutes: 60 },
    verified: false,
    source: PLACEHOLDER,
    url: 'https://www.aquaplanet.co.kr/jeju',
  },
  {
    id: 'seopjikoji',
    name: '섭지코지',
    category: 'nature',
    lat: 33.4239,
    lon: 126.9294,
    indoor: false,
    // 바닷가 곶이라 강풍·풍랑에 직접 노출된다
    hazards: ['wind', 'sea', 'rain'],
    stayMinutes: 60,
    hours: null, // 상시 개방이지만 확인 불가로 둔다
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'gwangchigi-beach',
    name: '광치기해변',
    category: 'nature',
    lat: 33.4477,
    lon: 126.9296,
    indoor: false,
    hazards: ['wind', 'sea', 'rain'],
    stayMinutes: 40,
    hours: null,
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'udo',
    name: '우도',
    category: 'nature',
    lat: 33.5064,
    lon: 126.9525,
    indoor: false,
    hazards: ['wind', 'sea', 'rain'],
    stayMinutes: 240,
    hours: null,
    verified: false,
    source: PLACEHOLDER,
    // 여객선이 끊기면 갈 수 없다 — F3 결항 검사가 이 필드를 본다
    requires: 'ferry',
  },
  {
    id: 'seongsan-fish-market',
    name: '성산포수산시장',
    category: 'food',
    lat: 33.4746,
    lon: 126.9317,
    indoor: true,
    hazards: [],
    stayMinutes: 60,
    hours: { open: '08:00', close: '21:00' },
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'kim-younggap-gallery',
    name: '김영갑갤러리 두모악',
    category: 'culture',
    lat: 33.3689,
    lon: 126.83,
    indoor: true,
    hazards: [],
    stayMinutes: 60,
    hours: { open: '09:30', close: '18:00', closedWeekdays: [3], lastEntryMinutes: 30 },
    verified: false,
    source: PLACEHOLDER,
    url: 'http://www.dumoak.co.kr',
  },
  {
    id: 'jeju-folk-village',
    name: '제주민속촌',
    category: 'culture',
    lat: 33.3208,
    lon: 126.8607,
    indoor: false,
    hazards: ['rain', 'heat'],
    stayMinutes: 90,
    hours: { open: '08:30', close: '18:00', lastEntryMinutes: 60 },
    verified: false,
    source: PLACEHOLDER,
    url: 'https://www.jejufolk.com',
  },
  {
    id: 'honinji',
    name: '혼인지',
    category: 'culture',
    lat: 33.4306,
    lon: 126.9012,
    indoor: false,
    hazards: ['rain', 'heat'],
    stayMinutes: 40,
    hours: null,
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'pyoseon-beach',
    name: '표선해수욕장',
    category: 'nature',
    lat: 33.3253,
    lon: 126.8383,
    indoor: false,
    hazards: ['wind', 'sea', 'rain'],
    stayMinutes: 60,
    hours: null,
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'coffee-museum-baum',
    name: '커피박물관 바움',
    category: 'cafe',
    lat: 33.354,
    lon: 126.85,
    indoor: true,
    hazards: [],
    stayMinutes: 60,
    hours: { open: '09:00', close: '19:00' },
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'seongsan-canola-square',
    name: '성산 유채꽃광장',
    category: 'nature',
    lat: 33.4499,
    lon: 126.931,
    indoor: false,
    hazards: ['wind', 'rain', 'heat'],
    stayMinutes: 30,
    hours: null,
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'jeju-herb-dongne',
    name: '제주허브동네',
    category: 'activity',
    lat: 33.4103,
    lon: 126.858,
    indoor: false,
    hazards: ['rain', 'heat'],
    stayMinutes: 70,
    hours: { open: '09:00', close: '22:00', lastEntryMinutes: 30 },
    verified: false,
    source: PLACEHOLDER,
  },
  {
    id: 'ojo-haenyeo-house',
    name: '오조리 해녀의집',
    category: 'food',
    lat: 33.4682,
    lon: 126.9218,
    indoor: true,
    hazards: [],
    stayMinutes: 60,
    hours: { open: '10:00', close: '18:00', closedWeekdays: [2] },
    verified: false,
    source: PLACEHOLDER,
  },
]

/** 시연 시나리오 출발지 — 성산항. */
export const SEONGSAN_PORT = { lat: 33.4746, lon: 126.9317 }
