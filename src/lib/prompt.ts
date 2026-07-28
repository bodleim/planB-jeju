/**
 * '직접 말하기' 자유 텍스트 → 구조화된 입력.
 *
 * **키워드 표 기반의 결정적 매핑이다 — LLM 이 아니다.** 도메인 규칙 1(LLM 은 사실을
 * 생성하지 않는다)에 따라, 문장 해석도 고정 표로만 한다. 못 알아들은 부분은 조용히
 * 채우지 않고 `understood` 에 잡힌 것만 보여준다 — 사용자가 무엇이 반영됐는지 안다.
 *
 * 축마다 첫 번째로 맞은 규칙 하나만 쓴다. 표의 순서가 우선순위다.
 */
import type { ActivityStyle, Cause, CompanionType } from './types.ts'

export type ParsedPrompt = {
  cause?: Cause
  companion?: CompanionType
  activity?: ActivityStyle
  /** '3시간' 같은 표현. 분 단위, 60~720 로 자른다. */
  remainingMinutes?: number
  /** 화면에 '이렇게 이해했습니다' 로 보여줄 조각. 비어 있으면 아무것도 못 알아들은 것. */
  understood: string[]
}

// '비행기' 의 '비' 가 강수로 잡히지 않게 항공 규칙이 먼저 온다.
const CAUSE_RULES: readonly [RegExp, Cause, string][] = [
  [/(비행기|항공).{0,6}(결항|취소|지연|못)/, 'flight_cancelled', '항공 결항'],
  [/결항|여객선|배.{0,4}(끊|안|못)/, 'ferry_cancelled', '배 결항'],
  [/비(?!행)|폭우|우천|장마/, 'rain', '비'],
  [/바람|강풍|풍랑|태풍/, 'wind', '강풍'],
  [/문.{0,3}닫|휴무|휴업/, 'closed', '휴무'],
  [/막히|정체|밀리/, 'traffic', '정체'],
]

const COMPANION_RULES: readonly [RegExp, CompanionType, string][] = [
  [/아이|애기|애들|애 |유아|아기|가족|부모님|식구/, 'family', '가족·아이 동반'],
  [/커플|연인|여자친구|남자친구|여친|남친|둘이서/, 'couple', '커플'],
  [/혼자|나홀로|솔로/, 'solo', '혼자'],
]

const ACTIVITY_RULES: readonly [RegExp, ActivityStyle, string][] = [
  [/먹|맛집|식사|점심|저녁|디저트|빙수|흑돼지|카페/, 'food', '먹거리'],
  [/실내|안 걷|걷기 싫|조용한/, 'indoor', '실내 위주'],
  [/액티비티|체험|레저|스포츠/, 'activity', '액티비티'],
]

function firstMatch<T>(text: string, rules: readonly [RegExp, T, string][]): [T, string] | null {
  for (const [re, value, label] of rules) if (re.test(text)) return [value, label]
  return null
}

export function parsePrompt(text: string): ParsedPrompt {
  const out: ParsedPrompt = { understood: [] }
  const cause = firstMatch(text, CAUSE_RULES)
  if (cause) {
    out.cause = cause[0]
    out.understood.push(cause[1])
  }
  const companion = firstMatch(text, COMPANION_RULES)
  if (companion) {
    out.companion = companion[0]
    out.understood.push(companion[1])
  }
  const activity = firstMatch(text, ACTIVITY_RULES)
  if (activity) {
    out.activity = activity[0]
    out.understood.push(activity[1])
  }

  const hours = /(\d+)\s*시간/.exec(text)
  if (hours) {
    out.remainingMinutes = Math.min(720, Math.max(60, Number(hours[1]) * 60))
    out.understood.push(`${Math.round(out.remainingMinutes / 60)}시간`)
  }
  return out
}
