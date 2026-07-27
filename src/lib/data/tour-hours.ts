/**
 * 한국관광공사 TourAPI 의 운영시간·휴무일 자유 텍스트를 `WeeklyHours` 로 옮긴다.
 *
 * **확신할 수 있을 때만 값을 돌려주고, 애매하면 `null` 을 준다.** null 인 장소는
 * `verified: false` 가 되어 DEFAULT_POLICY 에서 자동 편성 대상에서 빠진다 —
 * 도메인 규칙 "운영 확인이 불가능한 장소는 자동 예약 대상에서 제외" 그대로다.
 * 애매한 문자열을 그럴듯하게 추측해 채우면 문 닫은 곳이 일정에 뜬다.
 *
 * LLM 을 쓰지 않는다. 전부 정규식이고, `places.check.ts` 가 실제 스냅샷 103건을
 * 통과시켜 파싱률과 개별 결과를 검증한다.
 */
import type { MinuteOfDay, OpenInterval, Weekday, WeeklyHours } from '../types.ts'

const MINUTES_PER_DAY = 1440

/** 'HH:MM' 또는 'H:MM'. 24:00 은 하루 끝. */
const HHMM = String.raw`(\d{1,2}):(\d{2})`
const RANGE = new RegExp(`${HHMM}\\s*[~〜–-]\\s*${HHMM}`, 'g')

/** 입장·주문 마감을 가리키는 말. */
const LAST_WORDS = '마지막\\s?주문|라스트\\s?오더|입장\\s?마감|매표\\s?마감|관람\\s?마감|주문\\s?마감'

/**
 * 이 표현이 있으면 요일·비정기 변수가 있어 주간 영업시간 하나로 못 줄인다.
 *
 * '※ 전화문의 요망' 같은 각주는 여기 넣지 않는다 — 시각이 명확히 적혀 있는데 각주 때문에
 * 버리면 멀쩡한 후보가 사라진다. 위험한 건 '통제'(출입 제한), '예약 필수'(현장 방문 불가),
 * '변동·상이·비정기'(적힌 시각을 신뢰할 수 없음), 요일별 블록(`[평일]`) 쪽이다.
 */
const UNRESOLVABLE = /\[|1일\s?\d회|비정기|점포\s?(마다|별)|상이|예약\s?필수|통제|변동/

const toMinutes = (h: string, m: string): MinuteOfDay => Number(h) * 60 + Number(m)

/** `<br>`·중복 공백 정리. 원문 비교를 쉽게 하려고 줄바꿈은 살린다. */
function normalize(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t ]+/g, ' ')
    .trim()
}

type Range = { open: MinuteOfDay; close: MinuteOfDay; index: number }

function findRanges(text: string): Range[] {
  const out: Range[] = []
  for (const m of text.matchAll(RANGE)) {
    const open = toMinutes(m[1], m[2])
    let close = toMinutes(m[3], m[4])
    if (close === 0) close = MINUTES_PER_DAY // '09:00~24:00' 을 00:00 으로 쓴 표기
    if (open >= close || close > MINUTES_PER_DAY) continue // 자정 넘김은 다루지 않는다
    out.push({ open, close, index: m.index })
  }
  return out
}

/** 마감 시각(자정 기준 분). 없으면 null. */
function findLastAdmission(text: string): MinuteOfDay | null {
  const before = new RegExp(`${HHMM}\\s*(?:쯤|경)?\\s*(?:${LAST_WORDS})`)
  const after = new RegExp(`(?:${LAST_WORDS})\\s*[:：]?\\s*(?:하계|동계|하절기|동절기)?\\s*${HHMM}`)
  for (const re of [after, before]) {
    const m = re.exec(text)
    if (m) return toMinutes(m[1], m[2])
  }
  return null
}

/**
 * 줄에서 달 구간을 뽑는다. `[[5, 8]]`, `[[1, 2], [11, 12]]` 형태.
 *
 * 표기가 세 가지다 — `3월~6월`, `1~2월`(단위가 뒤에만), `7월`. 넓은 형태부터 지워 나가야
 * 한다. `1~2월` 을 단순히 '월' 앞 숫자만 주워 읽으면 `[2]` 가 되어 구간이 뒤집힌다.
 */
export function monthRanges(line: string): [number, number][] {
  const out: [number, number][] = []
  const take = (a: string, b: string) => {
    out.push([Number(a), Number(b)])
    return ' '
  }
  const rest = line
    // '3월~6월', '11월 중순~3월 중순'
    .replace(/(\d{1,2})\s*월[^0-9]{0,4}?[~〜–-]\s*(\d{1,2})\s*월/g, (_, a, b) => take(a, b))
    // '1~2월', '5~8월' — 단위가 마지막 숫자에만 붙는다
    .replace(/(\d{1,2})\s*[~〜–-]\s*(\d{1,2})\s*월/g, (_, a, b) => take(a, b))
  // 남은 단일 표기 '7월'
  for (const m of rest.matchAll(/(\d{1,2})\s*월/g)) out.push([Number(m[1]), Number(m[1])])
  return out.filter(([a, b]) => a >= 1 && a <= 12 && b >= 1 && b <= 12)
}

/** 그 줄의 달 구간이 기준 달을 포함하는지. 겨울(11~3월)처럼 해를 넘기는 구간도 다룬다. */
function coversMonth(line: string, month: number): boolean {
  return monthRanges(line).some(([from, to]) =>
    from <= to ? month >= from && month <= to : month >= from || month <= to,
  )
}

/**
 * 계절별로 갈린 텍스트에서 기준 달에 해당하는 줄만 남긴다.
 *
 * 줄에 달 표시가 없으면 계절 구분이 아니므로 텍스트 전체를 그대로 넘긴다 — 준비시간이나
 * 마감 시각이 다음 줄에 따로 적히는 경우가 흔하다
 * ('- 07:30~17:00 / - 준비시간 15:00~15:30 / - 마지막 주문 16:30').
 * 달 표시가 있는데 기준 달을 담은 줄이 정확히 하나가 아니면 null — 애매하면 추측하지 않는다.
 */
function lineForMonth(text: string, month: number): string | null {
  const lines = text.split('\n').filter((line) => findRanges(line).length > 0)
  if (lines.length === 0) return null
  if (!lines.some((line) => /\d{1,2}\s*월/.test(line))) return text

  const matched = lines.filter((line) => coversMonth(line, month))
  return matched.length === 1 ? matched[0] : null
}

export type ParsedHours = {
  hours: WeeklyHours
  lastAdmissionBeforeClose: number
  /** 화면에 그대로 보여줄 근거 문구 (파싱에 실제로 쓴 부분) */
  basis: string
}

/**
 * `usetime` / `opentime` 자유 텍스트 → 하루치 영업 구간.
 * 확신할 수 없으면 null (호출한 쪽이 `verified: false` 로 내린다).
 *
 * @param month 계절별 영업시간을 고를 기준 달 (1~12).
 */
export function parseOpenHours(raw: string, month: number): ParsedHours | null {
  const text = normalize(raw)
  if (text === '') return null

  const allRanges = findRanges(text)

  // 시각이 아예 없으면 '상시 개방' 만 인정한다
  if (allRanges.length === 0) {
    if (UNRESOLVABLE.test(text)) return null
    if (/상시\s?개방|연중\s?무휴|24시간/.test(text)) {
      return { hours: everyDay([{ open: 0, close: MINUTES_PER_DAY }]), lastAdmissionBeforeClose: 0, basis: '상시 개방' }
    }
    return null
  }

  if (UNRESOLVABLE.test(text)) return null

  // 계절별로 갈린 경우 지금 달의 줄만 남긴다
  const line = lineForMonth(text, month)
  if (line === null) return null

  // 가장 넓은 구간이 영업시간이고, 그 안에 들어 있는 구간은 준비시간·브레이크타임이다.
  // 키워드 위치로 판정하면 '10:30~21:00 (준비시간 15:30~17:00)' 처럼 키워드가 두 구간
  // 사이에 끼일 때 앞 구간까지 휴게로 잡힌다. 포함 관계는 그런 실수를 하지 않는다.
  const ranges = findRanges(line)
  const widest = ranges.reduce((a, b) => (b.close - b.open > a.close - a.open ? b : a))
  const inner = ranges.filter((r) => r !== widest)
  // 넓은 구간 밖으로 삐져나온 구간이 있으면 영업시간이 하나로 안 좁혀진다 — 포기한다
  if (inner.some((r) => r.open < widest.open || r.close > widest.close)) return null

  const intervals = subtract(widest, inner)
  if (intervals.length === 0) return null

  const lastAdmission = findLastAdmission(line)
  const close = intervals[intervals.length - 1].close
  const lastAdmissionBeforeClose =
    lastAdmission !== null && lastAdmission > 0 && lastAdmission < close ? close - lastAdmission : 0

  return { hours: everyDay(intervals), lastAdmissionBeforeClose, basis: line.split('\n')[0].trim() }
}

/** 영업 구간에서 휴게 구간을 도려낸다. */
function subtract(base: Range, breaks: Range[]): OpenInterval[] {
  let parts: OpenInterval[] = [{ open: base.open, close: base.close }]
  for (const br of breaks) {
    const next: OpenInterval[] = []
    for (const part of parts) {
      if (br.close <= part.open || br.open >= part.close) {
        next.push(part)
        continue
      }
      if (br.open > part.open) next.push({ open: part.open, close: br.open })
      if (br.close < part.close) next.push({ open: br.close, close: part.close })
    }
    parts = next
  }
  return parts.filter((p) => p.close - p.open >= 30) // 30분도 안 되는 조각은 버린다
}

function everyDay(intervals: readonly OpenInterval[]): WeeklyHours {
  return Array.from({ length: 7 }, () => intervals)
}

const WEEKDAY_OF: Readonly<Record<string, Weekday>> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
}

/**
 * `restdate` 자유 텍스트 → 정기 휴무 요일.
 *
 * '연중무휴' → `[]`, '매주 수요일' → `[3]`. 격주·월 단위·비정기 휴무는 주간 표에
 * 담을 수 없으므로 null 을 주고, 호출한 쪽이 `verified: false` 로 내린다.
 */
export function parseClosedDays(raw: string): Weekday[] | null {
  const text = normalize(raw)
  if (text === '') return null
  // 월 단위·비정기·기간 휴무는 주간 표로 표현할 수 없다
  if (/매월|매달|첫째|둘째|셋째|넷째|마지막\s?주|격주|비정기|상이|매년/.test(text)) return null

  const weekly = text.match(/매주\s?([월화수목금토일요일,·\s및and과와]+)/)
  if (weekly) {
    const days = [...weekly[1].matchAll(/([월화수목금토일])요일/g)].map((m) => WEEKDAY_OF[m[1]])
    if (days.length > 0) return [...new Set(days)]
  }
  if (/연중\s?무휴|휴무\s?없음|없음/.test(text)) return []
  return null
}

/** 정기 휴무를 주간 영업시간에 반영한다. */
export function applyClosedDays(hours: WeeklyHours, closed: readonly Weekday[]): WeeklyHours {
  return hours.map((day, index) => (closed.includes(index as Weekday) ? [] : day))
}
