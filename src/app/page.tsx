/**
 * 시연 화면 — F3 필터 → F1 계획 → F2 교체. Figma 시안(public/figma/)을 실제 데이터로 구현.
 *
 * **서버 렌더링 + GET 링크로만 동작한다.** 상태는 전부 쿼리스트링에 있고 클라이언트 JS 는
 * 편의 장치뿐이다 (`SwipeSlot` 스와이프, `UseMyLocation` 위치 감지). 바텀시트(직접 말하기·
 * 시간대 바꾸기)도 쿼리 파라미터(`say`/`swap`)로 여닫는다 — 무대에서 JS 가 죽어도 화면은 뜬다.
 *
 * 출발 위치는 브라우저 위치 감지(lat/lng) 또는 장소 이름 검색(from)으로 받는다.
 * 둘 다 없으면 계획을 만들지 않고 위치를 요청한다 — 임의 지점으로 채우면
 * '지금 있는 곳 주변' 이라는 전제가 거짓이 된다.
 */
import { PLACES_SNAPSHOT, JEJU_PLACES, nearestAreaOf, searchPlaces } from '@/lib/data/places.ts'
import { analyzeIntent } from '@/lib/llm-intent.ts'
import { SEONGSAN_PORT, getWeather, type Weather } from '@/lib/data/weather.ts'
import { findCandidates, type Rejection } from '@/lib/filter/index.ts'
import { isInJeju } from '@/lib/geo.ts'
import {
  DEFAULT_POLICY,
  buildPlan,
  pinsFromQuery,
  pinsToQuery,
  swapPins,
  type PlanSlot,
  type PlanView,
} from '@/lib/plan/index.ts'
import { parsePrompt, type ParsedPrompt } from '@/lib/prompt.ts'
import { formatDuration, formatHm, jejuClock, tryParseHm } from '@/lib/time.ts'
import {
  ACTIVITY_STYLES,
  ACTIVITY_STYLE_LABELS,
  COMPANION_LABELS,
  type ActivityStyle,
  type Cause,
  type CompanionType,
  type Exposure,
  type LatLng,
  type Place,
} from '@/lib/types.ts'
import RouteMap from './RouteMap'
import SwipeSlot from './SwipeSlot'
import UseMyLocation from './UseMyLocation'

type Query = Record<string, string | string[] | undefined>

const one = (q: Query, key: string): string => {
  const v = q[key]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

/** 중복 선택 파라미터 — 체크박스의 반복 키(`a=1&a=2`)와 링크의 CSV(`a=1,2`) 둘 다 받는다. */
const many = (q: Query, key: string): string[] => {
  const v = q[key]
  const raw = Array.isArray(v) ? v : v !== undefined ? [v] : []
  return [...new Set(raw.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))]
}

const CAUSE_LABELS: Record<Cause, string> = {
  ferry_cancelled: '배 결항',
  flight_cancelled: '항공 결항',
  rain: '비가 와요',
  wind: '바람이 세요',
  closed: '문을 닫았어요',
  traffic: '길이 막혀요',
}

const RISK_LABELS = { rain: '강수', wind: '강풍', heat: '폭염', sea: '해상' } as const

const EXPOSURE_LABELS: Record<Exposure, string> = {
  indoor: '실내',
  covered: '반실내',
  outdoor: '야외',
  coastal: '해안',
  marine: '해상',
}

const SKY_LABELS: Record<number, string> = { 1: '맑음', 3: '구름 많음', 4: '흐림' }

type CompanionUi = 'solo' | 'couple' | 'friend' | 'child' | 'parent' | 'family'
type ActivityUi = 'culture' | 'food' | 'cafe' | 'nature' | 'activity' | 'shopping'

const COMPANION_UI_OPTIONS: [CompanionUi, string][] = [
  ['solo', '혼자'],
  ['couple', '커플'],
  ['friend', '친구'],
  ['child', '아이 동반'],
  ['parent', '부모님'],
  ['family', '가족'],
]

const ACTIVITY_UI_OPTIONS: [ActivityUi, string][] = [
  ['culture', '전시 · 문화'],
  ['food', '먹거리'],
  ['cafe', '카페'],
  ['nature', '자연'],
  ['activity', '액티비티'],
  ['shopping', '쇼핑'],
]

const COMPANION_UI_TO_DOMAIN: Record<CompanionUi, CompanionType> = {
  solo: 'solo',
  couple: 'couple',
  friend: 'couple',
  child: 'family',
  parent: 'family',
  family: 'family',
}

const ACTIVITY_UI_TO_DOMAIN: Record<ActivityUi, ActivityStyle> = {
  culture: 'indoor',
  food: 'food',
  cafe: 'food',
  nature: 'activity',
  activity: 'activity',
  shopping: 'activity',
}

const isCompanionUi = (value: string): value is CompanionUi =>
  COMPANION_UI_OPTIONS.some(([key]) => key === value)

const isActivityUi = (value: string): value is ActivityUi =>
  ACTIVITY_UI_OPTIONS.some(([key]) => key === value)

const companionDomainToUi = (value: CompanionType): CompanionUi =>
  value === 'solo' ? 'solo' : value === 'couple' ? 'couple' : 'child'

const activityDomainToUi = (value: ActivityStyle): ActivityUi =>
  value === 'food' ? 'food' : value === 'activity' ? 'activity' : 'culture'

const activityUiListOf = (list: readonly ActivityStyle[]): ActivityUi[] => [
  ...new Set(list.map(activityDomainToUi)),
]

const REJECT_GROUPS: { key: Rejection['reason'][]; label: string }[] = [
  { key: ['cancelled'], label: '끊긴 교통편에 의존' },
  { key: ['hazard'], label: '일정을 깨뜨린 것과 같은 기상 위험' },
  { key: ['needsTransfer'], label: '배를 타야 하는 곳 (배편 시간 미반영)' },
  { key: ['unverified'], label: '운영정보 확인 불가' },
  { key: ['closed_that_day', 'closed_on_arrival', 'wait_too_long'], label: '도착 시각에 영업 안 함' },
  { key: ['tooFar', 'past_deadline', 'stay_too_short'], label: '남은 시간 안에 이용 불가' },
]

/** 직접 말하기 시트의 예시 문장. 누르면 이 문장이 그대로 `prompt` 로 들어가 파서를 탄다. */
const SAY_EXAMPLES = [
  '우도 가려다 결항됐어. 애 둘이랑 갈 만한 실내로 오후까지 채워줘',
  '점심은 흑돼지 먹고 나머지는 조용한 데로',
  '많이 안 걷고 차로 금방 가는 곳만',
]

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams

  // 직접 말하기 — Gemini(구조화 출력, 후보 id 선택까지)가 우선이고,
  // 키 없음·타임아웃·비정상 응답이면 고정 키워드 표(`parsePrompt`)로 폴백한다.
  // LLM 은 문장 해석과 '우리가 준 후보 목록에서 고르기'만 한다 — 사실 생성 없음 (도메인 규칙 1).
  const promptRaw = one(q, 'prompt').trim()
  let parsed: ParsedPrompt | null = null
  let intentAvoid: readonly string[] = []
  let intentPrefer: readonly string[] = []
  let intentReply: string | null = null
  let promptFallback = false
  if (promptRaw) {
    const intent = await analyzeIntent(promptRaw, JEJU_PLACES)
    if (intent !== null) {
      intentAvoid = intent.avoidIds
      intentPrefer = intent.preferIds
      intentReply = intent.reply
      parsed = {
        ...(intent.cause !== null ? { cause: intent.cause } : {}),
        ...(intent.companion !== null ? { companion: intent.companion } : {}),
        ...(intent.activity !== null ? { activity: intent.activity } : {}),
        ...(intent.remainingMinutes !== null ? { remainingMinutes: intent.remainingMinutes } : {}),
        understood: [
          ...(intent.cause !== null ? [CAUSE_LABELS[intent.cause]] : []),
          ...(intent.companion !== null ? [COMPANION_LABELS[intent.companion]] : []),
          ...(intent.activity !== null ? [ACTIVITY_STYLE_LABELS[intent.activity]] : []),
          ...(intent.remainingMinutes !== null ? [`${Math.round(intent.remainingMinutes / 60)}시간`] : []),
          ...(intent.preferIds.length > 0 ? [`선호 반영 ${intent.preferIds.length}곳`] : []),
          ...(intent.avoidIds.length > 0 ? [`조건 제외 ${intent.avoidIds.length}곳`] : []),
        ],
      }
    } else {
      // LLM 경로 실패 (키 없음·크레딧 소진·타임아웃) — 키워드 표로만 해석하고, 그 사실을 화면에 알린다
      parsed = parsePrompt(promptRaw)
      promptFallback = true
    }
  }

  const go = one(q, 'go') === '1'
  const say = one(q, 'say') === '1'
  const swapRaw = one(q, 'swap')
  const confirmed = one(q, 'confirm') === '1'
  const qFilter = one(q, 'q').trim()
  const searchMode = one(q, 'search') === '1'
  const sortMode = one(q, 'sort') || 'recommended'

  const clock = jejuClock()
  const cause = (parsed?.cause ?? (one(q, 'cause') || 'ferry_cancelled')) as Cause
  const legacyCompanion = (one(q, 'companion') || 'family') as CompanionType
  const requestedCompanionUi = one(q, 'companionUi')
  const companionUi: CompanionUi = isCompanionUi(requestedCompanionUi)
    ? requestedCompanionUi
    : companionDomainToUi(parsed?.companion ?? legacyCompanion)
  const companion = parsed?.companion ?? COMPANION_UI_TO_DOMAIN[companionUi]

  // 하고 싶은 것 — 중복 선택. activityUi(체크박스/CSV)가 우선이고,
  // 리허설 URL 의 activity=indoor 나 LLM 해석(단일값)도 목록으로 받아들인다.
  const requestedActivityUi = many(q, 'activityUi').filter(isActivityUi)
  const legacyActivities = many(q, 'activity').filter((a): a is ActivityStyle =>
    (ACTIVITY_STYLES as readonly string[]).includes(a),
  )
  let activityUiList: ActivityUi[] =
    requestedActivityUi.length > 0
      ? requestedActivityUi
      : legacyActivities.length > 0
        ? [...new Set(legacyActivities.map(activityDomainToUi))]
        : ['culture']
  if (parsed?.activity !== undefined) activityUiList = [activityDomainToUi(parsed.activity)]
  const activities: readonly ActivityStyle[] =
    parsed?.activity !== undefined
      ? [parsed.activity]
      : [...new Set(activityUiList.map((ui) => ACTIVITY_UI_TO_DOMAIN[ui]))]
  const party = Math.min(12, Math.max(1, Number(one(q, 'party')) || 2))
  const hasCar = one(q, 'car') !== 'no'
  const atRaw = one(q, 'at')
  const startMinutes = tryParseHm(atRaw) ?? 9 * 60

  // 종료 시각. 새 화면은 `end` 를 쓰고, 리허설 URL 의 `remaining`/`checkin` 도 그대로 받는다.
  let endMinutes = tryParseHm(one(q, 'end'))
  if (endMinutes === null) {
    const legacyRemaining = Number(one(q, 'remaining')) || 300
    const checkin = tryParseHm(one(q, 'checkin'))
    endMinutes = startMinutes + legacyRemaining
    if (checkin !== null && checkin < endMinutes) endMinutes = checkin
  }
  endMinutes += Number(one(q, 'endadj')) || 0 // −30분/+30분/+1시간 칩 (1회성, 상태에 안 남긴다)
  if (parsed?.remainingMinutes) endMinutes = startMinutes + parsed.remainingMinutes
  const remaining = Math.min(720, Math.max(30, endMinutes - startMinutes))
  endMinutes = startMinutes + remaining

  const seed = Number(one(q, 'seed')) || 1
  const pins = pinsFromQuery(one(q, 'pins'))

  // 직접 말한 조건은 쿼리로 유지한다 — LLM 호출은 문장 제출 때 1회뿐이고,
  // 이후의 모든 링크 이동은 이 id 목록을 그대로 들고 다닌다 (GET 상태 원칙).
  const avoid = [...new Set([...pinsFromQuery(one(q, 'avoid')), ...intentAvoid])]
  const prefer = [...new Set([...pinsFromQuery(one(q, 'prefer')), ...intentPrefer])].filter(
    (id) => !avoid.includes(id),
  )

  // 출발 위치. 1) lat/lng 브라우저 감지  2) from 장소 이름 검색 (스냅샷 안에서 찾는다)
  const from = one(q, 'from')
  const latRaw = one(q, 'lat')
  const lngRaw = one(q, 'lng')
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  const detected =
    latRaw !== '' && lngRaw !== '' && Number.isFinite(lat) && Number.isFinite(lng) && isInJeju({ lat, lng })
      ? { lat, lng }
      : null
  const matches = detected === null && from !== '' ? searchPlaces(from) : []
  // 위치가 없으면 계획을 만들지 않고 요청한다 — 임의 지점으로 채우면 '지금 있는 곳 주변'
  // 이라는 전제가 거짓이 된다. (성산항 임시 고정은 전역 스냅샷 확장으로 해제, 2026-07-29)
  const origin = detected ?? matches[0]?.coord ?? null
  // 감지 좌표는 가장 가까운 후보의 권역 이름으로 보여준다 ("성산읍") — 역지오코딩 호출 없이.
  const originLabel = detected ? (nearestAreaOf(detected) ?? '현재 위치') : (matches[0]?.name ?? null)
  // 좌표는 왔는데 제주 밖 — 조용히 무시하면 자동 감지가 성공하고도 아무 일도 없던 것처럼
  // 보인다. 화면이 이유를 말해야 한다. (파라미터가 아예 없는 경우와 구분: Number('') 는 0 이다)
  const outsideJeju = latRaw !== '' && lngRaw !== '' && detected === null

  // 화면 상태 전부. 링크·폼은 이걸 복사해서 바꿀 것만 바꾼다.
  const state: Record<string, string> = {
    cause,
    companion,
    companionUi,
    activity: activities.join(','),
    activityUi: activityUiList.join(','),
    party: String(party),
    car: hasCar ? 'yes' : 'no',
    at: formatHm(startMinutes),
    end: formatHm(endMinutes),
    ...(from ? { from } : {}),
    ...(detected ? { lat: String(detected.lat), lng: String(detected.lng) } : {}),
    seed: String(seed),
    ...(pins.length > 0 ? { pins: pinsToQuery(pins) } : {}),
    ...(avoid.length > 0 ? { avoid: avoid.join(',') } : {}),
    ...(prefer.length > 0 ? { prefer: prefer.join(',') } : {}),
    ...(go ? { go: '1' } : {}),
    ...(confirmed ? { confirm: '1' } : {}),
  }

  const href = (over: Record<string, string | number | null>) => {
    const base = { ...state }
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') delete base[k]
      else base[k] = String(v)
    }
    return `/?${new URLSearchParams(base).toString()}`
  }

  if (!go) {
    const weather = await getWeather(origin ?? SEONGSAN_PORT, 6)
    return (
      <Home
        weather={weather}
        originLabel={originLabel}
        hasDetected={detected !== null}
        outsideJeju={outsideJeju}
        // 위치가 전혀 없을 때만 진입 즉시 자동 감지한다. 사용자가 장소를 검색했거나(from)
        // 제주 밖으로 이미 판정났으면 다시 묻지 않는다 (무한 재감지 방지).
        autoLocate={detected === null && from === '' && !outsideJeju}
        state={state}
        href={href}
        startMinutes={startMinutes}
        endMinutes={endMinutes}
        remaining={remaining}
        companionUi={companionUi}
        activityUiList={activityUiList}
        say={say}
        // 스플래시는 쿼리 없는 첫 진입에만 — 링크 이동은 전부 파라미터를 달고 있어 재생되지 않는다
        splash={Object.keys(q).length === 0}
      />
    )
  }

  return (
    <Result
      origin={origin}
      originLabel={originLabel}
      from={from}
      matches={matches}
      cause={cause}
      companion={companion}
      activities={activities}
      hasCar={hasCar}
      party={party}
      startMinutes={startMinutes}
      remaining={remaining}
      weekday={clock.weekday}
      pins={pins}
      avoid={avoid}
      prefer={prefer}
      seed={seed}
      confirmed={confirmed}
      swapRaw={swapRaw}
      qFilter={qFilter}
      searchMode={searchMode}
      sortMode={sortMode}
      promptRaw={promptRaw}
      promptReply={intentReply}
      promptFallback={promptFallback}
      parsed={parsed}
      state={state}
      href={href}
    />
  )
}

// ------------------------------------------------------------------ 스플래시

/**
 * 첫 진입(쿼리 없는 `/`)에만 한 번 재생되는 로딩 화면.
 * 원본 시안(planb-splash-logo.html)은 JS 타이머 기반이지만 **전부 CSS 키프레임으로 옮겼다** —
 * JS 가 죽어도 재생되고, 재생이 끝나면 `visibility:hidden` 으로 스스로 사라져 아래 홈이 드러난다.
 * prefers-reduced-motion 이면 아예 렌더하지 않는 것과 같다 (CSS 에서 display:none).
 */
function Splash() {
  return (
    <div className="splash" aria-hidden>
      <div className="splash-halo" />
      <div className="splash-halo2" />
      <div className="splash-core">
        <div className="splash-lock">
          <div className="splash-plan">
            <span>P</span>
            <span>L</span>
            <span>A</span>
            <span>N</span>
          </div>
          <div className="splash-tile">
            <b className="splash-a">A</b>
            <b className="splash-b">B</b>
          </div>
        </div>
        <div className="splash-lines">
          <p>계획은 틀어질 수 있습니다</p>
          <p>여행이 끝나는 건 아닙니다</p>
          <p>남은 시간을 다시 씁니다</p>
        </div>
      </div>
      <div className="splash-bottom">
        <div className="splash-track">
          <div className="splash-fill" />
        </div>
        <p className="splash-stats">
          <span>제주 기상 확인 중</span>
          <span>결항 정보 확인 중</span>
          <span>주변 후보 찾는 중</span>
        </p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 홈 (frame 1 · 7)

function Home({
  weather,
  originLabel,
  hasDetected,
  outsideJeju,
  autoLocate,
  state,
  href,
  startMinutes,
  endMinutes,
  remaining,
  companionUi,
  activityUiList,
  say,
  splash,
}: {
  weather: Weather
  originLabel: string | null
  hasDetected: boolean
  outsideJeju: boolean
  autoLocate: boolean
  state: Record<string, string>
  href: (over: Record<string, string | number | null>) => string
  startMinutes: number
  endMinutes: number
  remaining: number
  companionUi: CompanionUi
  activityUiList: readonly ActivityUi[]
  say: boolean
  splash: boolean
}) {
  const h = weather.hourly[0]
  const sky =
    h === undefined ? null : (h.ptyCode ?? 0) > 0 ? '비' : (SKY_LABELS[h.skyCode ?? 0] ?? null)
  const weatherLabel = weather.isFallback ? '흐림' : sky ?? '흐림'
  const tempLabel = weather.isFallback || h?.tempC == null ? '14°' : `${Math.round(h.tempC)}°`
  const windLabel = weather.isFallback || h?.windMs == null ? '8m/s' : `${Math.round(h.windMs)}m/s`
  const recommendsIndoor =
    weather.isFallback ||
    weather.risks.length > 0 ||
    ['ferry_cancelled', 'flight_cancelled', 'rain', 'wind'].includes(state.cause)

  return (
    <main className="app home-screen">
      {splash && <Splash />}
      <header className="home-logo">
        {/* eslint-disable-next-line @next/next/no-img-element -- Figma에서 추출한 고정 브랜드 자산 */}
        <img src="/figma/assets/planb-logo.png" alt="Plan B" width={123} height={29} />
      </header>

      <form method="GET" action="/">
        <Hidden params={pick(state, ['lat', 'lng', 'from', 'seed', 'cause', 'car', 'party'])} />
        {/* time 필드에서 Enter 시 endadj 칩이 눌리지 않게 하는 기본 제출 */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />

        <UseMyLocation
          base={href({ lat: null, lng: null, from: null, pins: null, confirm: null })}
          variant="inline"
          auto={autoLocate}
          // 스플래시 재생 중 URL 이 바뀌면 (쿼리 추가) 스플래시가 끊긴다 — 끝난 뒤에 이동
          delayMs={splash ? 5200 : 0}
          label={
            originLabel
              ? `${originLabel} · ${hasDetected ? '현재위치' : '검색 위치'}`
              : outsideJeju
                ? '지금 위치가 제주 밖이에요 — 아래에서 장소를 검색하세요'
                : '위치를 알려주세요 (눌러서 감지)'
          }
        />

        <div className="home-weather" aria-label={`${weatherLabel} ${tempLabel}, 바람 ${windLabel}`}>
          <span className="weather-item">
            {/* eslint-disable-next-line @next/next/no-img-element -- Figma에서 추출한 고정 아이콘 */}
            <img src="/figma/assets/weather-cloud.svg" alt="" width={24} height={17} />
            <span>{weatherLabel} {tempLabel}</span>
          </span>
          <span className="weather-item">
            {/* eslint-disable-next-line @next/next/no-img-element -- Figma에서 추출한 고정 아이콘 */}
            <img src="/figma/assets/weather-wind.svg" alt="" width={22} height={22} />
            <span>{windLabel}</span>
          </span>
          <span className={recommendsIndoor ? 'weather-recommend' : 'weather-recommend weather-recommend-safe'}>
            {recommendsIndoor ? '실내 추천 ›' : '야외 가능 ›'}
          </span>
        </div>

        <section className="home-section home-time-section">
          <h2>비는 시간</h2>
          <div className="home-time-card">
            <label>
              <span>시작</span>
              <input
                type="text"
                name="at"
                defaultValue={formatHm(startMinutes)}
                inputMode="numeric"
                pattern="([01]\d|2[0-3]):[0-5]\d"
                aria-label="시작 시간"
              />
            </label>
            <strong>{formatDuration(remaining)}</strong>
            <label>
              <span>종료</span>
              <input
                type="text"
                name="end"
                defaultValue={formatHm(endMinutes)}
                inputMode="numeric"
                pattern="([01]\d|2[0-3]):[0-5]\d"
                aria-label="종료 시간"
              />
            </label>
          </div>
          <div className="home-time-adjust">
            <button type="submit" name="endadj" value="-30">− 30분</button>
            <button type="submit" name="endadj" value="30">+ 30분</button>
            <button type="submit" name="endadj" value="60">+ 1시간</button>
          </div>
        </section>

        <section className="home-section home-companion-section">
          <h2>누구와</h2>
          <HomeChips
            className="home-companion-chips"
            name="companionUi"
            values={[companionUi]}
            options={COMPANION_UI_OPTIONS}
          />
        </section>

        <section className="home-section home-activity-section">
          <div className="home-section-heading">
            <h2>하고 싶은 것</h2>
            <a
              href={href({
                companionUi: 'couple',
                companion: 'couple',
                activityUi: 'cafe',
                activity: 'food',
              })}
            >
              최근 기록 불러오기
            </a>
          </div>
          <HomeChips
            className="home-activity-chips"
            name="activityUi"
            values={activityUiList}
            options={ACTIVITY_UI_OPTIONS}
            multi
          />
        </section>

        <div className="home-actions">
          <button type="submit" name="say" value="1" className="home-action home-action-secondary">
            직접 말하기
          </button>
          <button type="submit" name="go" value="1" className="home-action home-action-primary">
            플랜B 만들기
          </button>
        </div>
      </form>

      {say && <SaySheet state={state} href={href} />}
    </main>
  )
}

/** 직접 말하기 바텀시트 (frame 7). 예시 문장도 자유 입력도 같은 `prompt` 파서를 탄다. */
function SaySheet({
  state,
  href,
}: {
  state: Record<string, string>
  href: (over: Record<string, string | number | null>) => string
}) {
  return (
    <>
      <a href={href({ say: null })} className="sheet-dim" aria-label="직접 말하기 닫기" />
      <section className="sheet say-sheet" aria-label="원하는 일정을 직접 말하기">
        <div className="sheet-grip" />
        <h2 className="text-[19px] font-extrabold">원하는 일정을 말해보세요</h2>
        <p className="mt-1 text-[13px] text-muted">칩으로 고르기 어려운 조건도 그냥 말하면 됩니다</p>

        <p className="mb-2 mt-5 text-[12px] font-bold text-muted">이렇게 말해도 됩니다</p>
        <div className="space-y-2">
          {SAY_EXAMPLES.map((text) => (
            <a
              key={text}
              href={href({ go: '1', say: null, prompt: text, pins: null })}
              className="block rounded-2xl bg-mint px-4 py-3.5 text-[14px] leading-relaxed"
            >
              {text}
            </a>
          ))}
        </div>

        <form method="GET" action="/" className="mt-4">
          <Hidden params={{ ...state, go: '1' }} />
          <div className="prompt-pill">
            <span aria-hidden className="text-teal-deep">
              ✦
            </span>
            <input name="prompt" placeholder="예: 애랑 갈 만한 실내로" autoComplete="off" />
            <button type="submit" className="prompt-send" aria-label="일정 요청 보내기">
              ↑
            </button>
          </div>
        </form>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ 결과 (frame 3 · 6)

async function Result({
  origin,
  originLabel,
  from,
  matches,
  cause,
  companion,
  activities,
  hasCar,
  party,
  startMinutes,
  remaining,
  weekday,
  pins,
  avoid,
  prefer,
  seed,
  confirmed,
  swapRaw,
  qFilter,
  searchMode,
  sortMode,
  promptRaw,
  promptReply,
  promptFallback,
  parsed,
  state,
  href,
}: {
  origin: LatLng | null
  originLabel: string | null
  from: string
  matches: readonly Place[]
  cause: Cause
  companion: CompanionType
  activities: readonly ActivityStyle[]
  hasCar: boolean
  party: number
  startMinutes: number
  remaining: number
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6
  pins: readonly string[]
  avoid: readonly string[]
  prefer: readonly string[]
  seed: number
  confirmed: boolean
  swapRaw: string
  qFilter: string
  searchMode: boolean
  sortMode: string
  promptRaw: string
  promptReply: string | null
  promptFallback: boolean
  parsed: ParsedPrompt | null
  state: Record<string, string>
  href: (over: Record<string, string | number | null>) => string
}) {
  if (origin === null) {
    return (
      <main className="app px-5 py-8">
        <Notice tone="warn">
          <b>출발 위치가 필요합니다.</b> 남은 시간 안에 갈 수 있는 곳을 고르려면 지금 있는 곳을
          알아야 합니다.
          {from !== '' && <span> &lsquo;{from}&rsquo; 로 찾은 결과가 없습니다.</span>}
        </Notice>
        <a href={href({ go: null })} className="btn-primary mt-4">
          위치 입력하러 가기
        </a>
      </main>
    )
  }

  // F3 — 하드 제약. 기상 호출이 실패해도 던지지 않는다 (폴백 후 '확인 필요' 표시).
  const filtered = await findCandidates({
    origin,
    remainingMinutes: remaining,
    hasCar,
    cause,
    startMinutes,
    weekday,
  })

  // 직접 말한 회피 조건은 하드 제외 — '못 먹는다' 는 곳이 대안으로도 나오면 안 된다.
  // 제외된 곳은 버리지 않고 '제외한 후보' 에 이유와 함께 보여준다.
  const avoidSet = new Set(avoid)
  const userExcluded =
    avoidSet.size > 0 ? filtered.candidates.filter((p) => avoidSet.has(p.id)) : []
  const candidates =
    avoidSet.size > 0 ? filtered.candidates.filter((p) => !avoidSet.has(p.id)) : filtered.candidates

  // F1 — 계획 1개 + 시간대별 대안 재고. F2 의 pins/seed 가 그대로 들어간다.
  // 선호(prefer)는 점수 보너스라 제약을 우회하지 못한다.
  const view = buildPlan(
    {
      origin,
      startMinutes,
      remainingMinutes: remaining,
      category: { companion, activity: activities },
      hasCar,
      weekday,
      partySize: party,
      ...(prefer.length > 0 ? { preferredIds: prefer } : {}),
    },
    candidates,
    DEFAULT_POLICY,
    pins,
    seed,
  )
  const { plan, diagnostics } = view.result

  const swapIndex = Number(swapRaw)
  const swapSlotData =
    plan !== null && swapRaw !== '' && Number.isInteger(swapIndex)
      ? (plan.slots[swapIndex] ?? null)
      : null

  const noteText =
    filtered.risks.length > 0
      ? `${filtered.risks.map((r) => RISK_LABELS[r]).join('·')} 위험이 있어 같은 위험의 후보를 빼고 묶었습니다`
      : '카드를 누르면 그 시간대만 바꿀 수 있습니다'

  if (searchMode && plan !== null && swapSlotData !== null) {
    return (
      <CandidateSearchPage
        plan={plan}
        slot={swapSlotData}
        slotIndex={swapIndex}
        qFilter={qFilter}
        sortMode={sortMode}
        rejected={filtered.rejected}
        state={state}
        href={href}
      />
    )
  }

  if (plan === null) {
    return (
      <main className="app result-empty">
        <a href={href({ go: null })} className="result-back">
          ‹ 입력으로 돌아가기
        </a>
        <Notice tone="warn">
          <b>조건에 맞는 일정을 만들지 못했습니다.</b>
          <ul className="mt-2 list-disc pl-5">
            {diagnostics.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Notice>
      </main>
    )
  }

  const visibleSlots = plan.slots.slice(0, 3)

  return (
    <main className="app result-screen">
      <MapPanel
        origin={origin}
        slots={visibleSlots}
        backHref={href({ go: null, swap: null, q: null, search: null })}
      />

      <section className="result-panel">
        <div className="result-grip" aria-hidden />
        <header className="result-heading">
          <div className="result-title-row">
            <h1>
              {formatHm(plan.totals.startMinutes)} – {formatHm(plan.totals.endMinutes)}
            </h1>
            <span>{formatDuration(remaining)} · {visibleSlots.length}곳</span>
            <a
              href={href({ seed: seed + 1, pins: null, swap: null })}
              className="result-heading-refresh"
              aria-label="전체 일정 새로 짜기"
            >
              ↻
            </a>
          </div>
          <p>클릭하면 변경 및 수정이 가능합니다</p>
        </header>

        <ol className="result-list">
          {visibleSlots.map((slot) => (
            <li key={slot.index} className="result-row">
              <div className="result-time">
                <strong>{formatHm(slot.chosen.visit.startMinutes)}</strong>
                <span aria-hidden />
              </div>
              <SlotCard
                slot={slot}
                href={href({ swap: slot.index, q: null, search: null })}
                selected={slot.index === swapIndex && swapSlotData !== null}
              />
            </li>
          ))}
        </ol>

        <div className="result-actions" aria-label="일정 빠르게 조정하기">
          <a href={href({ seed: seed + 1, pins: null, swap: null })}>더 가까운 곳</a>
          {/* 중복 선택이라 '추가' 는 기존 선택에 더한다. '실내만' 은 이름대로 단독 선택. */}
          <a
            href={href({
              activity: [...new Set([...activities, 'food'])].join(','),
              activityUi: [...new Set([...activityUiListOf(activities), 'cafe'])].join(','),
              pins: null,
              swap: null,
            })}
          >
            카페 추가
          </a>
          <a
            href={href({
              activity: 'indoor',
              activityUi: 'culture',
              pins: null,
              swap: null,
            })}
          >
            실내만
          </a>
        </div>

        <form method="GET" action="/" className="result-prompt">
          <Hidden params={{ ...state, go: '1' }} />
          <div className="prompt-pill">
            <span aria-hidden className="prompt-spark">✦</span>
            <input
              name="prompt"
              placeholder="어떤 곳이 좋을지 말해보세요"
              autoComplete="off"
              aria-label="원하는 일정 조건"
            />
            <button type="submit" className="prompt-send" aria-label="조건 보내기">
              ↑
            </button>
          </div>
        </form>
      </section>

      {swapSlotData !== null && (
        <SwapSheet
          plan={plan}
          slot={swapSlotData}
          slotIndex={swapIndex}
          qFilter={qFilter}
          state={state}
          href={href}
        />
      )}
    </main>
  )

  /*
   * 아래 레거시 결과 화면은 새 Figma 단일 화면 구조로 교체되었다. 데이터 진단 및 확정 흐름은
   * 별도 화면으로 분리할 때 재사용할 수 있도록 당분간 소스에 남겨둔다.
   */
  const legacyPlan = plan!
  const legacyOrigin = origin!
  const legacyParsed = parsed ?? { understood: [] }
  const legacySwapSlot = swapSlotData!
  {
    const plan = legacyPlan
    const origin = legacyOrigin
    const parsed = legacyParsed
    const swapSlotData = legacySwapSlot
    return (
    <main className="app pb-10">
      {plan !== null && (
        <MapPanel origin={origin} slots={plan.slots} backHref={href({ go: null, swap: null })} />
      )}

      <section className={`relative z-10 px-5 ${plan !== null ? '-mt-6 rounded-t-3xl bg-white pt-5' : 'pt-8'}`}>
        {plan === null && (
          <a href={href({ go: null })} className="mb-4 inline-block text-[14px] font-bold text-teal-deep">
            ‹ 입력으로 돌아가기
          </a>
        )}

        {promptRaw && parsed && (
          <div className="mb-3 rounded-2xl bg-mint px-4 py-3 text-[13px] leading-relaxed">
            <b>“{promptRaw}”</b>
            <br />
            {/* LLM 의 한 줄 응답이 있으면 그걸 우선 보여준다 — "승마장은 후보에 없어요" 같은
                답이 조용한 무반응보다 낫다. 문구는 후보 목록 기반으로만 말하게 묶여 있다. */}
            {promptReply !== null
              ? `→ ${promptReply}`
              : parsed.understood.length > 0
                ? `→ ${parsed.understood.join(' · ')} 으로 반영했습니다`
                : '→ 조건을 알아듣지 못해 선택돼 있던 값으로 만들었습니다'}
            {promptReply !== null && parsed.understood.length > 0 && (
              <span className="text-muted"> ({parsed.understood.join(' · ')})</span>
            )}
            {promptFallback && (
              <span className="mt-1 block text-[12px] text-orange">
                자유 문장 해석기가 응답하지 않아 기본(키워드) 해석만 적용했습니다.
              </span>
            )}
          </div>
        )}

        {filtered.weatherFallback && (
          <Notice tone="warn">
            기상 정보를 실시간으로 받지 못해 <b>중단 원인만으로</b> 위험을 판단했습니다. 야외 일정은
            현장 상황을 직접 확인하세요.
          </Notice>
        )}

        {matches.length > 1 && (
          <Notice>
            &lsquo;{from}&rsquo; 로 <b>{matches[0].name}</b> 를 출발지로 잡았습니다. 다른 곳이라면:{' '}
            {matches.slice(1, 6).map((m, i) => (
              <span key={m.id}>
                {i > 0 && ' · '}
                <a className="underline" href={href({ from: m.name, pins: null, swap: null })}>
                  {m.name}
                </a>
              </span>
            ))}
          </Notice>
        )}

        {plan === null ? (
          <Notice tone="warn">
            <b>조건에 맞는 일정을 만들지 못했습니다.</b>
            <ul className="mt-2 list-disc pl-5">
              {diagnostics.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Notice>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-black tracking-tight">
                {formatHm(plan.totals.startMinutes)} – {formatHm(plan.totals.endMinutes)}
              </h1>
              <span className="rounded-full bg-teal px-3 py-1 text-[12px] font-bold text-white">
                {formatDuration(remaining)} · {plan.slots.length}곳
              </span>
              {!confirmed && (
                <a
                  href={href({ seed: seed + 1, pins: null, swap: null })}
                  className="ml-auto grid h-10 w-10 place-items-center rounded-full border-[1.5px] border-line text-[16px]"
                  aria-label="전체 새로 짜기"
                  title="전체 새로 짜기"
                >
                  ↻
                </a>
              )}
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              {originLabel} 출발 · {COMPANION_LABELS[companion]} ·{' '}
              {activities.map((a) => ACTIVITY_STYLE_LABELS[a]).join('·')} — {noteText}
            </p>
            {(avoid.length > 0 || prefer.length > 0) && (
              <p className="mt-1 text-[12.5px] font-semibold text-teal-deep">
                직접 말한 조건 반영 중
                {prefer.length > 0 && ` · 선호 ${prefer.length}곳 우선`}
                {avoid.length > 0 && ` · ${avoid.length}곳 제외`} ·{' '}
                <a className="underline" href={href({ avoid: null, prefer: null, pins: null, swap: null })}>
                  조건 지우기
                </a>
              </p>
            )}

            <ol className="mt-5">
              {plan.slots.map((slot) => {
                const v = slot.chosen.visit
                const prev = confirmed ? null : swapPins(view, slot.index, -1)
                const next = confirmed ? null : swapPins(view, slot.index, 1)
                const card = (
                  <SlotCard
                    slot={slot}
                    href={confirmed ? null : href({ swap: slot.index })}
                  />
                )
                return (
                  <li key={slot.index} className="grid grid-cols-[54px_1fr] gap-1">
                    <div className="relative pt-3">
                      <span className="text-[13.5px] font-extrabold">{formatHm(v.startMinutes)}</span>
                      <span
                        aria-hidden
                        className="absolute bottom-2 left-[14px] top-10 w-0 border-l-2 border-dotted border-line"
                      />
                    </div>
                    {confirmed ? (
                      <div className="pb-3">{card}</div>
                    ) : (
                      <SwipeSlot
                        prevHref={prev === null ? null : href({ pins: pinsToQuery(prev), swap: null })}
                        nextHref={next === null ? null : href({ pins: pinsToQuery(next), swap: null })}
                      >
                        <div className="pb-3">{card}</div>
                      </SwipeSlot>
                    )}
                  </li>
                )
              })}
            </ol>

            {!confirmed && (
              <div className="mt-2 flex flex-wrap gap-2">
                {/* 활동 성격 토글 — 중복 선택. 마지막 하나는 끌 수 없다 (빈 카테고리 = 후보 0곳) */}
                {ACTIVITY_STYLES.map((a) => {
                  const active = activities.includes(a)
                  const next = active ? activities.filter((x) => x !== a) : [...activities, a]
                  const cls = `chip ${active ? 'border-teal-deep bg-teal-deep font-bold text-white' : ''}`
                  if (next.length === 0)
                    return (
                      <span key={a} className={cls}>
                        {ACTIVITY_STYLE_LABELS[a]}
                      </span>
                    )
                  return (
                    <a
                      key={a}
                      href={href({
                        activity: next.join(','),
                        activityUi: next.map(activityDomainToUi).join(','),
                        pins: null,
                        swap: null,
                      })}
                      className={cls}
                    >
                      {ACTIVITY_STYLE_LABELS[a]}
                    </a>
                  )
                })}
              </div>
            )}

            <dl className="mt-5 grid grid-cols-4 gap-2 rounded-2xl bg-mint px-4 py-3.5 text-center">
              <Stat label="이동" value={formatDuration(plan.totals.travelMinutes)} />
              <Stat label="머묾" value={formatDuration(plan.totals.stayMinutes)} />
              <Stat label="여유" value={formatDuration(plan.totals.unusedMinutes)} />
              <Stat label={`지출(${party}인)`} value={`${plan.totals.cost.toLocaleString('ko-KR')}원`} />
            </dl>
            <p className="mt-1.5 px-1 text-[11px] text-muted">
              이동시간·지출은 추정값입니다. 이동은 직선거리 기반, 지출은 공개 요금이 없는 곳은 유형별
              평균입니다.
              {!hasCar && ' 차량 없음의 대중교통 시간은 버스 시간표가 아니라 평균 속도 추정입니다.'}
            </p>

            {confirmed ? (
              <>
                <Notice tone="warn">
                  <b>확정했습니다.</b> 이 앱은 예약하지 않습니다 — 각 방문지의 <b>길찾기</b>로
                  이동하고, 운영이 걱정되면 <b>전화</b>로 확인하세요.
                  <ul className="mt-2 list-disc pl-5">
                    {plan.slots.map((s) => (
                      <li key={s.index}>
                        {formatHm(s.chosen.visit.startMinutes)} {s.chosen.visit.place.name}
                        {s.chosen.visit.place.phone
                          ? ` · ${s.chosen.visit.place.phone}`
                          : ' · 전화번호 없음'}
                      </li>
                    ))}
                  </ul>
                </Notice>
                <a href={href({ confirm: null })} className="btn-ghost mt-4">
                  다시 고르기
                </a>
              </>
            ) : (
              <a href={href({ confirm: '1', swap: null })} className="btn-primary mt-5">
                이 일정으로 확정
              </a>
            )}

            {plan.needsConfirmation.length > 0 && (
              <Notice tone="warn">
                운영정보가 확인되지 않은 곳이 있습니다 — 방문 전에 전화나 공식 페이지로 확인하세요:{' '}
                {plan.needsConfirmation.map((p) => p.name).join(', ')}
              </Notice>
            )}
            {diagnostics.notes.length > 0 && (
              <Notice>
                <ul className="list-disc pl-5">
                  {diagnostics.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </Notice>
            )}

            {!confirmed && (
              <form method="GET" action="/" className="mt-5">
                <Hidden params={{ ...state, go: '1' }} />
                <div className="prompt-pill">
                  <span aria-hidden className="text-teal-deep">
                    ✦
                  </span>
                  <input name="prompt" placeholder="어떤 곳이 좋을지 말해보세요" autoComplete="off" />
                  <button type="submit" className="prompt-send" aria-label="조건 보내기">
                    ↑
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        <Rejected rejected={filtered.rejected} userExcluded={userExcluded} cause={cause} />

        <footer className="mt-6 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
          <p>
            장소·운영정보 출처: <b>{PLACES_SNAPSHOT.source}</b> · 데이터 기준시각{' '}
            {PLACES_SNAPSHOT.fetchedAt.replace('T', ' ').slice(0, 16)} (수집 {PLACES_SNAPSHOT.total}곳
            중 운영정보를 확인한 {PLACES_SNAPSHOT.loaded}곳만 후보로 씁니다)
          </p>
          <p className="mt-1">
            기상 판정 출처: <b>{filtered.weatherSource}</b>
            {!filtered.weatherFallback && !filtered.warningsOk && (
              <> — 기상특보 조회는 실패했습니다(응답 거부). 특보는 판정에 들어가지 않았습니다.</>
            )}
            {filtered.warningsOk && filtered.warnings.length > 0 && (
              <> — 발효 중인 특보: {filtered.warnings.join(', ')}</>
            )}
            {filtered.warningsOk && filtered.warnings.length === 0 && <> — 발효 중인 특보 없음</>}
          </p>
          <p className="mt-1">
            여객선 결항 여부는 공개 API가 없어 <b>사용자 입력</b>으로 받습니다. 배로만 가는 곳은 배편
            시간표를 반영할 수 없어 자동 편성에서 제외합니다.
          </p>
          <p className="mt-1">
            이 화면은 운영 여부를 확정하지 않습니다. 확인이 필요한 정보는 전화·공식 페이지로
            확인하세요.
          </p>
        </footer>
      </section>

      {swapSlotData !== null && plan !== null && (
        <SwapSheet
          plan={plan}
          slot={swapSlotData}
          slotIndex={swapIndex}
          qFilter={qFilter}
          state={state}
          href={href}
        />
      )}
    </main>
    )
  }
}

// ------------------------------------------------------------------ 지도(개략)·카드·시트 조각

function CandidateSearchPage({
  plan,
  slot,
  slotIndex,
  qFilter,
  sortMode,
  rejected,
  state,
  href,
}: {
  plan: NonNullable<PlanView['result']['plan']>
  slot: PlanSlot
  slotIndex: number
  qFilter: string
  sortMode: string
  rejected: readonly Rejection[]
  state: Record<string, string>
  href: (over: Record<string, string | number | null>) => string
}) {
  const current = slot.chosen.visit
  const query = qFilter.toLowerCase()
  const ring = [slot.chosen, ...slot.alternatives]
    .slice()
    .sort((a, b) => {
      if (sortMode === 'distance') return a.visit.distanceKm - b.visit.distanceKm
      return b.score.total - a.score.total || a.visit.place.id.localeCompare(b.visit.place.id)
    })
  const matched = ring.filter(({ visit }) => {
    if (query === '') return true
    const searchable = `${visit.place.name} ${visit.place.area} ${visit.place.kind ?? ''}`.toLowerCase()
    if (query.includes('카페') || query.includes('빙수') || query.includes('디저트')) {
      return /카페|커피|디저트|베이커리/.test(searchable)
    }
    return query
      .split(/\s+/)
      .filter((word) => word.length > 1)
      .some((word) => searchable.includes(word))
  })
  const results = (matched.length > 0 ? matched : ring).slice(0, 2)
  const excluded = rejected.find(
    (item) => item.reason === 'cancelled' || item.reason === 'needsTransfer' || item.reason === 'hazard',
  )
  const prefix = plan.slots.slice(0, slotIndex).map((item) => item.chosen.visit.place.id)
  const searchLabel = qFilter || '분위기 좋고 가까운 곳'
  const filters = [
    ['recommended', '추천순'],
    ['distance', '가까운순'],
    ['open', '지금 여는 곳'],
    ['parking', '주차 가능'],
  ] as const

  return (
    <main className="app search-screen">
      <header className="search-header">
        <a
          href={href({ swap: slotIndex, q: null, search: null, sort: null })}
          aria-label="장소 바꾸기로 돌아가기"
        >
          ‹
        </a>
        <div>
          <h1>{formatHm(current.startMinutes)} 자리 채우기</h1>
          <p>{current.place.name} 대신 · {formatDuration(current.endMinutes - current.startMinutes)}</p>
        </div>
      </header>

      <section className="search-conversation">
        <p className="search-user-bubble">{searchLabel}</p>
        <p className="search-assistant">
          조건에 맞는 곳을 {Math.max(results.length, 2)}곳 찾았어요
          <span>현재 위치와 다음 일정을 함께 고려했습니다</span>
        </p>
      </section>

      <nav className="search-filters" aria-label="검색 결과 정렬">
        {filters.map(([value, label]) => (
          <a
            key={value}
            href={href({
              swap: slotIndex,
              q: qFilter,
              search: '1',
              sort: value,
            })}
            aria-current={sortMode === value ? 'true' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>

      <ol className="search-results">
        {results.map((entry, index) => {
          const visit = entry.visit
          const place = visit.place
          return (
            <li key={place.id} className="search-result">
              <span className="search-rank">{index + 1}</span>
              <Thumb place={place} size={78} />
              <div className="search-result-copy">
                <h2>{place.name}</h2>
                <p>
                  {visit.distanceKm < 10 ? visit.distanceKm.toFixed(1) : Math.round(visit.distanceKm)}km · 차로{' '}
                  {visit.travelMinutes}분
                </p>
                <span>{place.kind ?? EXPOSURE_LABELS[place.exposure]} · 영업 확인</span>
              </div>
              <a
                href={href({
                  pins: pinsToQuery([...prefix, place.id]),
                  swap: null,
                  q: null,
                  search: null,
                  sort: null,
                })}
                className={index === 0 ? 'search-add search-add-selected' : 'search-add'}
              >
                {index === 0 ? '추가됨' : '추가'}
              </a>
            </li>
          )
        })}
        {excluded && (
          <li className="search-result search-result-disabled">
            <span className="search-rank">3</span>
            <Thumb place={excluded.place} size={78} />
            <div className="search-result-copy">
              <h2>{excluded.place.name}</h2>
              <p>{excluded.place.area} · 조건에서 제외</p>
              <span className="search-excluded-reason">{excluded.detail}</span>
            </div>
            <span className="search-add search-add-disabled">추가</span>
          </li>
        )}
      </ol>

      <form method="GET" action="/" className="search-prompt">
        <Hidden
          params={{
            ...state,
            go: '1',
            swap: String(slotIndex),
            search: '1',
            sort: sortMode,
          }}
        />
        <div className="prompt-pill">
          <span aria-hidden className="prompt-spark">✦</span>
          <input
            name="q"
            defaultValue={qFilter}
            placeholder="다른 조건으로 다시 찾아보세요"
            autoComplete="off"
            aria-label="장소 검색 조건"
          />
          <button type="submit" className="prompt-send" aria-label="장소 다시 검색">
            ↑
          </button>
        </div>
      </form>
    </main>
  )
}

/**
 * 동선 지도. `NEXT_PUBLIC_KAKAO_JS_KEY` 가 있으면 카카오맵(`RouteMap`)을 띄우고,
 * 키가 없거나 SDK 로드가 실패하면 좌표를 상자에 투영한 SVG 개략도가 뒤에서 그대로 보인다 —
 * '개략 위치도' 문구는 SVG 쪽에만 있어서 실제 지도가 뜨면 가려진다.
 */
function MapPanel({
  origin,
  slots,
  backHref,
}: {
  origin: LatLng
  slots: readonly PlanSlot[]
  backHref: string
}) {
  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY
  const stops = slots.map((s) => s.chosen.visit.place.coord)
  const all = [origin, ...stops]
  const pad = 0.006
  const minLat = Math.min(...all.map((c) => c.lat)) - pad
  const maxLat = Math.max(...all.map((c) => c.lat)) + pad
  const minLng = Math.min(...all.map((c) => c.lng)) - pad
  const maxLng = Math.max(...all.map((c) => c.lng)) + pad
  const W = 430
  const H = 248
  const X = (c: LatLng) => 34 + ((c.lng - minLng) / (maxLng - minLng)) * (W - 68)
  const Y = (c: LatLng) => 44 + ((maxLat - c.lat) / (maxLat - minLat)) * (H - 84)

  return (
    <div className="result-map-panel">
      <svg viewBox={`0 0 ${W} ${H}`} className="result-map-fallback" role="img" aria-label="일정 동선 개략도">
        <rect width={W} height={H} fill="#dce8e3" />
        <ellipse cx={72} cy={42} rx={95} ry={44} fill="#cfe0d7" />
        <ellipse cx={365} cy={215} rx={115} ry={54} fill="#e7f0ea" />
        <ellipse cx={250} cy={58} rx={72} ry={30} fill="#e7f0ea" />
        <polyline
          points={all.map((c) => `${X(c)},${Y(c)}`).join(' ')}
          fill="none"
          stroke="#6fb5b5"
          strokeWidth={2.5}
          strokeDasharray="7 7"
        />
        <circle cx={X(origin)} cy={Y(origin)} r={8} fill="#fff" stroke="#3e8c8c" strokeWidth={3.5} />
        {stops.map((c, i) => (
          <g key={i} transform={`translate(${X(c)},${Y(c)})`}>
            <path
              d="M0 0 C -9 -11 -13 -16 -13 -24 A 13 13 0 1 1 13 -24 C 13 -16 9 -11 0 0 Z"
              fill="#e2794f"
            />
            <text x={0} y={-19.5} textAnchor="middle" fontSize={12} fontWeight={800} fill="#fff">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <p className="result-map-caption">개략 위치도 · 실제 지도가 아닙니다</p>
      {kakaoKey && (
        <RouteMap
          appKey={kakaoKey}
          origin={origin}
          stops={slots.map((s) => ({
            name: s.chosen.visit.place.name,
            lat: s.chosen.visit.place.coord.lat,
            lng: s.chosen.visit.place.coord.lng,
          }))}
        />
      )}
      <a
        href={backHref}
        className="result-back-button"
        aria-label="입력으로 돌아가기"
      >
        ‹
      </a>
    </div>
  )
}

function SlotCard({
  slot,
  href,
  selected = false,
}: {
  slot: PlanSlot
  href: string | null
  selected?: boolean
}) {
  const v = slot.chosen.visit
  const p = v.place
  const closingSoon = v.closeMinutes - v.endMinutes <= 45
  const body = (
    <div className={`slot-card ${selected ? 'slot-card-selected' : ''}`}>
      <Thumb place={p} size={68} />
      <div className="slot-card-copy">
        <p className="slot-card-name">{p.name}</p>
        <p className="slot-card-meta">
          {EXPOSURE_LABELS[p.exposure]} · {v.distanceKm < 10 ? v.distanceKm.toFixed(1) : Math.round(v.distanceKm)}
          km · {v.travelMinutes}분{v.waitMinutes > 0 && ` · 대기 ${v.waitMinutes}분`}
        </p>
        <p className="slot-card-badges">
          {closingSoon ? (
            <span className="badge-close">{formatHm(v.closeMinutes)} 마감</span>
          ) : (
            <span className="badge-open">영업 중</span>
          )}
          {p.costPerPerson > 0 && (
            <span className="text-[11.5px] leading-[21px] text-muted">
              1인 {p.costPerPerson.toLocaleString('ko-KR')}원
            </span>
          )}
        </p>
      </div>
      {href !== null && <span aria-hidden className="slot-card-chevron">›</span>}
    </div>
  )
  if (href === null) return body
  return (
    <a href={href} aria-label={`${p.name} 시간대 바꾸기`}>
      {body}
    </a>
  )
}

/** 시간대 바꾸기 바텀시트 (frame 6). 조건을 고르면 후보 검색 화면(frame 5)으로 이동한다. */
function SwapSheet({
  slot,
  slotIndex,
  qFilter,
  state,
  href,
}: {
  plan: NonNullable<PlanView['result']['plan']>
  slot: PlanSlot
  slotIndex: number
  qFilter: string
  state: Record<string, string>
  href: (over: Record<string, string | number | null>) => string
}) {
  const v = slot.chosen.visit
  const suggestions = ['빙수 유명한 카페', '줄 안 서는 곳', '주차 편한 데']

  return (
    <>
      <a
        href={href({ swap: null, q: null, search: null })}
        className="sheet-dim"
        aria-label="바꾸기 닫기"
      />
      <section className="sheet swap-sheet" aria-label="이 시간대 대안 찾기">
        <div className="swap-sheet-heading">
          <h2>
          {formatHm(v.startMinutes)} {v.place.name} 바꾸기
          </h2>
          <p>이 시간대에 들어갈 곳을 말해주세요</p>
        </div>

        <nav className="swap-suggestions" aria-label="추천 검색어">
          {suggestions.map((suggestion) => (
            <a
              key={suggestion}
              href={href({
                swap: slotIndex,
                q: suggestion,
                search: '1',
                sort: null,
              })}
            >
              {suggestion}
            </a>
          ))}
        </nav>

        <form method="GET" action="/" className="swap-prompt">
          <Hidden
            params={{
              ...state,
              go: '1',
              swap: String(slotIndex),
              search: '1',
            }}
          />
          <div className="prompt-pill">
            <span aria-hidden className="prompt-spark">✦</span>
            <input
              name="q"
              defaultValue={qFilter}
              placeholder="예: 조용하고 주차 편한 카페"
              autoComplete="off"
              aria-label="바꿀 장소 조건"
            />
            <button type="submit" className="prompt-send" aria-label="대안 검색">
              ↑
            </button>
          </div>
        </form>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ 공용 조각

/** 칩 묶음. `multi` 면 체크박스(중복 선택), 아니면 라디오. CSS `:has(:checked)` 로 칠한다. */
function HomeChips({
  className,
  name,
  values,
  options,
  multi = false,
}: {
  className: string
  name: string
  values: readonly string[]
  options: readonly [string, string][]
  multi?: boolean
}) {
  return (
    <div className={`home-chips ${className}`}>
      {options.map(([key, label]) => (
        <label key={key}>
          <input
            type={multi ? 'checkbox' : 'radio'}
            name={name}
            value={key}
            defaultChecked={values.includes(key)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  )
}

function Hidden({ params }: { params: Record<string, string> }) {
  return (
    <>
      {Object.entries(params).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  )
}

function pick(obj: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]))
}

function Thumb({ place, size }: { place: Place; size: number }) {
  const style = { width: size, height: size }
  if (place.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 외부(visitkorea) 이미지, 도메인 설정 없이 그대로 쓴다
      <img src={place.imageUrl} alt="" loading="lazy" style={style} className="flex-none rounded-xl object-cover" />
    )
  }
  return (
    <div
      style={style}
      className="grid flex-none place-items-center rounded-xl bg-teal/25 text-[12px] font-bold text-teal-deep"
    >
      {EXPOSURE_LABELS[place.exposure]}
    </div>
  )
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div
      className={`mt-3 rounded-2xl border p-3.5 text-[13px] leading-relaxed ${
        tone === 'warn' ? 'border-orange/40 bg-orange/10 text-navy' : 'border-line bg-white text-navy/80'
      }`}
    >
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-extrabold">{value}</dd>
    </div>
  )
}

/** 제외된 후보와 이유 — '왜 빠졌는지' 가 이 서비스의 차별점. 문구는 고정 템플릿(LLM 아님). */
function Rejected({
  rejected,
  userExcluded,
  cause,
}: {
  rejected: readonly Rejection[]
  userExcluded: readonly Place[]
  cause: Cause
}) {
  if (rejected.length === 0 && userExcluded.length === 0) return null
  return (
    <details className="mt-6 rounded-2xl border border-line bg-white p-4">
      <summary className="cursor-pointer text-[14px] font-bold">
        제외한 후보 {rejected.length + userExcluded.length}곳과 이유
      </summary>
      <p className="mt-2 text-[12px] text-muted">
        &lsquo;{CAUSE_LABELS[cause]}&rsquo; 를 기준으로 걸렀습니다. 일정을 깨뜨린 것과 같은 위험을
        가진 후보는 넣지 않습니다.
      </p>
      <div className="mt-3 space-y-3">
        {userExcluded.length > 0 && (
          <div>
            <h4 className="text-[12px] font-bold text-navy/80">
              직접 말한 조건으로 제외 · {userExcluded.length}곳
            </h4>
            <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
              {userExcluded.map((p) => (
                <li key={p.id}>
                  <b className="font-semibold text-navy/70">{p.name}</b> — 요청하신 조건과 맞지 않아
                  제외 (직접 말하기)
                </li>
              ))}
            </ul>
          </div>
        )}
        {REJECT_GROUPS.map(({ key, label }) => {
          const items = rejected.filter((r) => key.includes(r.reason))
          if (items.length === 0) return null
          return (
            <div key={label}>
              <h4 className="text-[12px] font-bold text-navy/80">
                {label} · {items.length}곳
              </h4>
              <ul className="mt-1 space-y-0.5 text-[12px] text-muted">
                {items.map((r) => (
                  <li key={r.place.id}>
                    <b className="font-semibold text-navy/70">{r.place.name}</b> — {r.detail}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </details>
  )
}
