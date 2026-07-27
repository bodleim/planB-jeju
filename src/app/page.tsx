/**
 * 시연 화면 — F3 필터 → F1 계획 → F2 스와이프 교체.
 *
 * **서버 렌더링 + GET 링크로만 동작한다.** 상태는 전부 쿼리스트링에 있고 클라이언트 JS 는
 * 스와이프 편의 장치뿐이다 (`SwipeSlot`). 무대에서 네트워크나 JS 가 흔들려도 화면은 뜬다.
 *
 * 리허설 URL 예:
 *   /?go=1&cause=ferry_cancelled&origin=seongsan_port&remaining=300&car=yes&at=10:00
 *     &companion=couple&activity=indoor&checkin=16:00
 *
 * `at` 을 비우면 실제 현재 시각을 쓴다 — 새벽에 열면 후보가 0곳이 되므로 리허설에는 넣는다.
 */
import { ORIGINS, PLACES_SNAPSHOT } from '@/lib/data/places.ts'
import { findCandidates, type Rejection } from '@/lib/filter/index.ts'
import { isInJeju } from '@/lib/geo.ts'
import { DEFAULT_POLICY, buildPlan, pinsFromQuery, pinsToQuery, swapPins } from '@/lib/plan/index.ts'
import { formatDuration, formatHm, jejuClock, tryParseHm } from '@/lib/time.ts'
import {
  ACTIVITY_STYLE_LABELS,
  COMPANION_LABELS,
  type ActivityStyle,
  type Cause,
  type CompanionType,
  type Exposure,
  type LatLng,
  type Place,
  type Weekday,
} from '@/lib/types.ts'
import SwipeSlot from './SwipeSlot'

type Query = Record<string, string | string[] | undefined>

const one = (q: Query, key: string): string => {
  const v = q[key]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

const CAUSE_LABELS: Record<Cause, string> = {
  ferry_cancelled: '배가 결항됐어요',
  flight_cancelled: '항공편이 결항됐어요',
  rain: '비가 와서 일정이 취소됐어요',
  wind: '바람이 너무 세요',
  closed: '가려던 곳이 문을 닫았어요',
  traffic: '길이 막혀서 못 가요',
}

const RISK_LABELS = { rain: '강수', wind: '강풍', heat: '폭염', sea: '해상' } as const

const EXPOSURE_LABELS: Record<Exposure, string> = {
  indoor: '실내',
  covered: '반실내',
  outdoor: '야외',
  coastal: '해안',
  marine: '해상',
}

const REJECT_GROUPS: { key: Rejection['reason'][]; label: string }[] = [
  { key: ['cancelled'], label: '끊긴 교통편에 의존' },
  { key: ['hazard'], label: '일정을 깨뜨린 것과 같은 기상 위험' },
  { key: ['needsTransfer'], label: '배를 타야 하는 곳 (배편 시간 미반영)' },
  { key: ['unverified'], label: '운영정보 확인 불가' },
  { key: ['closed_that_day', 'closed_on_arrival', 'wait_too_long'], label: '도착 시각에 영업 안 함' },
  { key: ['tooFar', 'past_deadline', 'stay_too_short'], label: '남은 시간 안에 이용 불가' },
]

const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-500 focus:outline-none'

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams
  const go = one(q, 'go') === '1'

  const clock = jejuClock()
  const cause = (one(q, 'cause') || 'ferry_cancelled') as Cause
  const originKey = one(q, 'origin') || 'seongsan_port'
  const remaining = Math.min(720, Math.max(30, Number(one(q, 'remaining')) || 300))
  const hasCar = one(q, 'car') !== 'no'
  const companion = (one(q, 'companion') || 'couple') as CompanionType
  const activity = (one(q, 'activity') || 'indoor') as ActivityStyle
  const atRaw = one(q, 'at')
  const startMinutes = tryParseHm(atRaw) ?? clock.minuteOfDay
  const checkin = tryParseHm(one(q, 'checkin'))
  const seed = Number(one(q, 'seed')) || 1
  const pins = pinsFromQuery(one(q, 'pins'))

  // 위치는 감지값(lat/lng)이 있으면 그걸 쓰고, 없거나 제주 밖이면 ORIGINS 로 폴백한다.
  const lat = Number(one(q, 'lat'))
  const lng = Number(one(q, 'lng'))
  const detected =
    Number.isFinite(lat) && Number.isFinite(lng) && isInJeju({ lat, lng }) ? { lat, lng } : null
  const fallbackOrigin = ORIGINS[originKey] ?? ORIGINS.seongsan_port
  const origin = detected ?? fallbackOrigin.coord
  const originLabel = detected ? '현재 위치' : fallbackOrigin.label

  const href = (over: Record<string, string | number | null>) => {
    const base: Record<string, string> = {
      go: '1',
      cause,
      origin: originKey,
      remaining: String(remaining),
      car: hasCar ? 'yes' : 'no',
      companion,
      activity,
      ...(atRaw ? { at: atRaw } : {}),
      ...(checkin !== null ? { checkin: formatHm(checkin) } : {}),
      ...(detected ? { lat: String(detected.lat), lng: String(detected.lng) } : {}),
      seed: String(seed),
      ...(pins.length > 0 ? { pins: pinsToQuery(pins) } : {}),
    }
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') delete base[k]
      else base[k] = String(v)
    }
    return `/?${new URLSearchParams(base).toString()}`
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">플랜B 제주</h1>
        <p className="mt-1 text-sm text-stone-600">
          일정이 끊겼을 때, 지금 있는 곳 주변에서 남은 시간에 맞는 일정을 다시 짭니다.
        </p>
      </header>

      <form method="GET" action="/" className="mb-8 rounded-xl border border-stone-200 bg-white p-4">
        <input type="hidden" name="go" value="1" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="무슨 일이 있었나요">
            <Select name="cause" value={cause} options={Object.entries(CAUSE_LABELS)} />
          </Field>
          <Field label="지금 어디에 있나요">
            <Select
              name="origin"
              value={originKey}
              options={Object.entries(ORIGINS).map(([k, v]) => [k, v.label] as [string, string])}
            />
          </Field>
          <Field label="남은 시간(분)">
            <input
              type="number"
              name="remaining"
              defaultValue={remaining}
              min={30}
              max={720}
              step={30}
              className={inputClass}
            />
          </Field>
          <Field label="차량">
            <Select
              name="car"
              value={hasCar ? 'yes' : 'no'}
              options={[
                ['yes', '차 있음'],
                ['no', '차 없음 (도보·대중교통)'],
              ]}
            />
          </Field>
          <Field label="누구와">
            <Select name="companion" value={companion} options={Object.entries(COMPANION_LABELS)} />
          </Field>
          <Field label="무엇을">
            <Select name="activity" value={activity} options={Object.entries(ACTIVITY_STYLE_LABELS)} />
          </Field>
          <Field label="기준 시각 (비우면 지금)">
            <input type="time" name="at" defaultValue={atRaw} className={inputClass} />
          </Field>
          <Field label="다음 예약 (숙소 체크인 등)">
            <input
              type="time"
              name="checkin"
              defaultValue={checkin === null ? '' : formatHm(checkin)}
              className={inputClass}
            />
          </Field>
        </div>
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-stone-900 px-4 py-2.5 font-semibold text-white hover:bg-stone-700"
        >
          대체 일정 만들기
        </button>
      </form>

      {go ? (
        <Result
          origin={origin}
          originLabel={originLabel}
          cause={cause}
          remaining={remaining}
          hasCar={hasCar}
          startMinutes={startMinutes}
          weekday={clock.weekday}
          checkin={checkin}
          companion={companion}
          activity={activity}
          pins={pins}
          seed={seed}
          href={href}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
          위 항목을 채우고 <b>대체 일정 만들기</b>를 누르세요.
        </p>
      )}
    </main>
  )
}

// ------------------------------------------------------------------ 결과

async function Result({
  origin,
  originLabel,
  cause,
  remaining,
  hasCar,
  startMinutes,
  weekday,
  checkin,
  companion,
  activity,
  pins,
  seed,
  href,
}: {
  origin: LatLng
  originLabel: string
  cause: Cause
  remaining: number
  hasCar: boolean
  startMinutes: number
  weekday: Weekday
  checkin: number | null
  companion: CompanionType
  activity: ActivityStyle
  pins: readonly string[]
  seed: number
  href: (over: Record<string, string | number | null>) => string
}) {
  // F3 — 하드 제약. 기상 호출이 실패해도 던지지 않는다 (폴백 후 '확인 필요' 표시).
  const filtered = await findCandidates({
    origin,
    remainingMinutes: remaining,
    hasCar,
    cause,
    startMinutes,
    weekday,
  })

  // F1 — 계획 1개 + 시간대별 대안 재고. F2 의 pins/seed 가 그대로 들어간다.
  const view = buildPlan(
    {
      origin,
      startMinutes,
      remainingMinutes: remaining,
      ...(checkin !== null ? { endByMinutes: checkin } : {}),
      category: { companion, activity },
      hasCar,
      weekday,
    },
    filtered.candidates,
    DEFAULT_POLICY,
    pins,
    seed,
  )
  const { plan, diagnostics } = view.result

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Tag>{originLabel} 기준</Tag>
        <Tag>남은 {formatDuration(remaining)}</Tag>
        <Tag>{hasCar ? '차량' : '차량 없음'}</Tag>
        <Tag>
          {COMPANION_LABELS[companion]} · {ACTIVITY_STYLE_LABELS[activity]}
        </Tag>
        {filtered.risks.length > 0 && (
          <Tag tone="warn">제외 기준 위험 {filtered.risks.map((r) => RISK_LABELS[r]).join('·')}</Tag>
        )}
      </div>

      {filtered.weatherFallback && (
        <Notice tone="warn">
          기상 정보를 실시간으로 받지 못해 <b>중단 원인만으로</b> 위험을 판단했습니다. 야외 일정은
          현장 상황을 직접 확인하세요.
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
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">
              {formatHm(plan.totals.startMinutes)}~{formatHm(plan.totals.endMinutes)} ·{' '}
              {plan.slots.length}곳
            </h2>
            <a
              href={href({ seed: seed + 1, pins: null })}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-100"
            >
              전체 새로 짜기
            </a>
          </div>

          <ol className="space-y-3">
            {plan.slots.map((slot) => {
              const prev = swapPins(view, slot.index, -1)
              const next = swapPins(view, slot.index, 1)
              const prevHref = prev === null ? null : href({ pins: pinsToQuery(prev) })
              const nextHref = next === null ? null : href({ pins: pinsToQuery(next) })
              return (
                <li key={slot.index}>
                  <SwipeSlot prevHref={prevHref} nextHref={nextHref}>
                    <SlotCard
                      index={slot.index}
                      place={slot.chosen.visit.place}
                      visit={slot.chosen.visit}
                      alternatives={slot.alternatives.map((a) => a.visit.place.name)}
                      prevHref={prevHref}
                      nextHref={nextHref}
                    />
                  </SwipeSlot>
                </li>
              )
            })}
          </ol>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-4">
            <Stat label="이동" value={formatDuration(plan.totals.travelMinutes)} />
            <Stat label="머무는 시간" value={formatDuration(plan.totals.stayMinutes)} />
            <Stat label="남는 시간" value={formatDuration(plan.totals.unusedMinutes)} />
            <Stat label="예상 지출" value={`${plan.totals.cost.toLocaleString('ko-KR')}원`} />
          </dl>
          <p className="mt-1 text-xs text-stone-500">
            이동시간·지출은 <b>추정값</b>입니다. 이동시간은 직선거리 기반이고, 지출은 공개된 요금이
            없는 곳은 유형별 평균으로 잡았습니다.
          </p>

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
        </>
      )}

      <Rejected rejected={filtered.rejected} cause={cause} />

      <footer className="mt-6 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <p>
          장소·운영정보 출처: <b>{PLACES_SNAPSHOT.source}</b> · 데이터 기준시각{' '}
          {PLACES_SNAPSHOT.fetchedAt.replace('T', ' ').slice(0, 16)} (수집 {PLACES_SNAPSHOT.total}곳 중
          운영정보를 확인한 {PLACES_SNAPSHOT.loaded}곳만 후보로 씁니다)
        </p>
        <p className="mt-1">
          기상: <b>기상청 단기예보·기상특보</b> 실시간 호출
          {filtered.weatherFallback ? ' (지금은 폴백)' : ''} · 여객선 결항 여부는 공개 API가 없어
          사용자 입력으로 받습니다.
        </p>
        <p className="mt-1">
          이 화면은 운영 여부를 확정하지 않습니다. 방문 전 확인이 필요한 정보는 전화·공식 페이지로
          확인하세요.
        </p>
      </footer>
    </section>
  )
}

// ------------------------------------------------------------------ 조각

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
    </label>
  )
}

function Select({
  name,
  value,
  options,
}: {
  name: string
  value: string
  options: [string, string][]
}) {
  return (
    <select name={name} defaultValue={value} className={inputClass}>
      {options.map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 ${
        tone === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-stone-200 text-stone-700'
      }`}
    >
      {children}
    </span>
  )
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div
      className={`mt-3 rounded-xl border p-3 text-sm ${
        tone === 'warn'
          ? 'border-amber-300 bg-amber-50 text-amber-900'
          : 'border-stone-200 bg-white text-stone-600'
      }`}
    >
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}

function SlotCard({
  index,
  place,
  visit,
  alternatives,
  prevHref,
  nextHref,
}: {
  index: number
  place: Place
  visit: {
    travelMinutes: number
    waitMinutes: number
    startMinutes: number
    endMinutes: number
    closeMinutes: number
  }
  alternatives: readonly string[]
  prevHref: string | null
  nextHref: string | null
}) {
  const map = `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.coord.lat},${place.coord.lng}`
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-stone-500">
            {formatHm(visit.startMinutes)}~{formatHm(visit.endMinutes)} · 이동 {visit.travelMinutes}분
            {visit.waitMinutes > 0 && ` · 대기 ${visit.waitMinutes}분`}
          </p>
          <h3 className="truncate text-lg font-semibold">{place.name}</h3>
          <p className="mt-0.5 text-xs text-stone-500">
            {place.area} · {EXPOSURE_LABELS[place.exposure]} · {formatHm(visit.closeMinutes)} 마감
            {place.costPerPerson > 0 && ` · 1인 ${place.costPerPerson.toLocaleString('ko-KR')}원`}
            {!place.verified && ' · 확인 필요'}
          </p>
        </div>
        {/* JS 없이도 대안을 넘길 수 있는 폴백. 스와이프는 이 링크를 대신 눌러 준다. */}
        <nav className="flex shrink-0 gap-1" aria-label={`${index + 1}번째 시간대 대안`}>
          <SwapLink href={prevHref} label="이전 대안">
            ‹
          </SwapLink>
          <SwapLink href={nextHref} label="다음 대안">
            ›
          </SwapLink>
        </nav>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <a
          href={map}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-stone-300 px-2.5 py-1 font-medium hover:bg-stone-100"
        >
          길찾기
        </a>
        {place.phone && (
          <a
            href={`tel:${place.phone}`}
            className="rounded-lg border border-stone-300 px-2.5 py-1 hover:bg-stone-100"
          >
            {place.phone}
          </a>
        )}
        {alternatives.length > 0 && (
          <span className="text-stone-400">대안 {alternatives.length}곳: {alternatives.join(', ')}</span>
        )}
      </div>
    </article>
  )
}

function SwapLink({
  href,
  label,
  children,
}: {
  href: string | null
  label: string
  children: React.ReactNode
}) {
  if (href === null) {
    return (
      <span
        aria-disabled
        className="grid h-9 w-9 place-items-center rounded-lg border border-stone-200 text-stone-300"
      >
        {children}
      </span>
    )
  }
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-lg border border-stone-300 bg-white text-lg font-semibold hover:bg-stone-100"
    >
      {children}
    </a>
  )
}

/**
 * 제외된 후보와 이유. '왜 빠졌는지' 를 보여주는 게 이 서비스의 차별점이고 심사 답변의
 * 근거다. 문구는 고정 템플릿이라 LLM 이 만들지 않는다.
 */
function Rejected({ rejected, cause }: { rejected: readonly Rejection[]; cause: Cause }) {
  if (rejected.length === 0) return null
  return (
    <details className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        제외한 후보 {rejected.length}곳과 이유
      </summary>
      <p className="mt-2 text-xs text-stone-500">
        &lsquo;{CAUSE_LABELS[cause]}&rsquo; 를 기준으로 걸렀습니다. 일정을 깨뜨린 것과 같은 위험을 가진
        후보는 넣지 않습니다.
      </p>
      <div className="mt-3 space-y-3">
        {REJECT_GROUPS.map(({ key, label }) => {
          const items = rejected.filter((r) => key.includes(r.reason))
          if (items.length === 0) return null
          return (
            <div key={label}>
              <h4 className="text-xs font-semibold text-stone-700">
                {label} · {items.length}곳
              </h4>
              <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                {items.map((r) => (
                  <li key={r.place.id}>
                    <b className="font-medium">{r.place.name}</b> — {r.detail}
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
