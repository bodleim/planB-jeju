/**
 * '직접 말하기' 자유 텍스트 → 구조화된 입력 (Gemini 경로).
 *
 * **LLM 은 사실을 생성하지 않는다** (도메인 규칙 1)를 지키는 방법:
 * - 출력은 responseSchema(구조화 출력)로 강제한다 — 자유 문장을 못 뱉는다.
 * - 장소는 **우리가 준 후보 목록의 id 로만** 답한다. 목록 밖 id 는 `validateIntent` 가
 *   버린다. LLM 이 장소를 지어내거나 운영시간·날씨를 판단할 통로가 없다.
 * - 뽑힌 id 도 결국 F3 필터·F1 `tryVisit` 을 그대로 통과해야 편성된다.
 *
 * **호출이 실패하면 null** — 호출부(page.tsx)가 키워드 표(`prompt.ts`)로 폴백한다.
 * 키 없음·타임아웃·비정상 응답 전부 같은 폴백. 무대에서 Gemini 가 죽어도 시연은 돈다.
 */
import type { ActivityStyle, Cause, CompanionType, Place } from './types.ts'

export type LlmIntent = {
  cause: Cause | null
  companion: CompanionType | null
  activity: ActivityStyle | null
  /** 분. 60~720 로 잘린다. */
  remainingMinutes: number | null
  /** 사용자가 피하겠다고 말한 후보 id (못 먹는 음식, 싫다는 유형 등). */
  avoidIds: string[]
  /** 사용자가 좋아한다고 말한 것과 맞는 후보 id. */
  preferIds: string[]
  /**
   * 화면에 보여줄 한 줄 응답. **후보 목록에서 확인되는 사실만** 말하게 프롬프트로 묶는다 —
   * "승마장은 후보에 없습니다", "빵집은 1곳뿐이라 그곳만 반영했습니다" 같은 답.
   * 요구가 후보와 안 맞을 때 조용히 실패하지 않기 위한 채널이다.
   */
  reply: string | null
}

const CAUSES: readonly Cause[] = ['ferry_cancelled', 'flight_cancelled', 'rain', 'wind', 'closed', 'traffic']
const COMPANIONS: readonly CompanionType[] = ['family', 'couple', 'solo']
const ACTIVITIES: readonly ActivityStyle[] = ['indoor', 'food', 'activity']

const EXPOSURE_KO: Record<string, string> = {
  indoor: '실내',
  covered: '반실내',
  outdoor: '야외',
  coastal: '해안',
  marine: '해상',
}

const SYSTEM = `너는 제주 여행 복구 서비스의 입력 해석기다. 사용자 문장에서 아래만 추출해 JSON 으로 답한다.

1. cause(중단 원인)·companion(동반)·activity(활동)·remainingMinutes(남은 분): 문장에 명확히 드러날 때만. 아니면 null.
2. avoidIds: 사용자가 피하고 싶어하는 조건(못 먹는 음식, 싫다는 유형, 알레르기 등)에 걸리는 후보의 id.
3. preferIds: 사용자의 요구에 가장 맞는 후보의 id. **네가 고른 곳이 그대로 일정에 들어간다.**
   - 개수를 말하면 그 개수를 지켜라 ("빵집 2곳" → 빵집을 최대 2곳만).
   - 요구가 구체적이면 가장 맞는 1~3곳만, 막연하면 맞는 곳을 넉넉히.
4. reply: 사용자에게 보여줄 한 문장. 무엇을 반영했는지, 또는 왜 반영할 수 없는지.
   - 요구에 맞는 후보가 목록에 없거나 부족하면 반드시 여기서 말해라
     (예: "승마장은 성산권 후보에 없어요", "빵집은 서귀피안 베이커리 1곳뿐이라 그곳만 넣었어요").
   - **목록에서 확인되는 사실만** 말한다. 목록 밖 장소 추천, 영업시간·날씨 언급 금지.

규칙:
- 되묻지 않는다. 주어진 문장만으로 즉시 정한다.
- id 는 반드시 함께 주어진 후보 목록에 있는 것만 쓴다. 목록 밖 장소를 만들지 마라.
- 이름·유형만으로 확신할 수 없는 후보는 avoidIds/preferIds 에 넣지 않는다. 추측 금지.
- 영업시간·날씨·결항 같은 사실 판단은 하지 마라. 그건 다른 시스템이 한다.`

// Gemini responseSchema (OpenAPI 스타일 — nullable 은 type 배열이 아니라 플래그다)
const SCHEMA = {
  type: 'OBJECT',
  required: ['avoidIds', 'preferIds'],
  properties: {
    cause: { type: 'STRING', enum: [...CAUSES], nullable: true },
    companion: { type: 'STRING', enum: [...COMPANIONS], nullable: true },
    activity: { type: 'STRING', enum: [...ACTIVITIES], nullable: true },
    remainingMinutes: { type: 'INTEGER', nullable: true },
    avoidIds: { type: 'ARRAY', items: { type: 'STRING' } },
    preferIds: { type: 'ARRAY', items: { type: 'STRING' } },
    reply: { type: 'STRING', nullable: true },
  },
} as const

/** LLM 응답 검증 — 신뢰 경계. enum 밖 값과 목록 밖 id 는 조용히 버린다. 순수 함수 (check 대상). */
export function validateIntent(raw: unknown, knownIds: ReadonlySet<string>): LlmIntent {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const pickEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
  const pickIds = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && knownIds.has(v)))] : []

  const minutes =
    typeof o.remainingMinutes === 'number' && Number.isFinite(o.remainingMinutes)
      ? Math.min(720, Math.max(60, Math.round(o.remainingMinutes)))
      : null

  const reply =
    typeof o.reply === 'string' && o.reply.trim() !== ''
      ? o.reply.replace(/\s+/g, ' ').trim().slice(0, 200)
      : null

  return {
    cause: pickEnum(o.cause, CAUSES),
    companion: pickEnum(o.companion, COMPANIONS),
    activity: pickEnum(o.activity, ACTIVITIES),
    remainingMinutes: minutes,
    avoidIds: pickIds(o.avoidIds),
    preferIds: pickIds(o.preferIds),
    reply,
  }
}

export async function analyzeIntent(text: string, places: readonly Place[]): Promise<LlmIntent | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null

  const list = places
    .map(
      (p) =>
        `${p.id} | ${p.name} | ${p.kind ?? '장소'} | ${EXPOSURE_KO[p.exposure]}` +
        (p.costPerPerson > 0 ? ` | 1인 ${p.costPerPerson}원` : ''),
    )
    .join('\n')

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [
            {
              role: 'user',
              parts: [{ text: `사용자 문장: ${text}\n\n후보 목록 (id | 이름 | 유형 | 노출도 | 비용):\n${list}` }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: SCHEMA,
            // 2.5 계열의 사고 토큰을 끈다 — 입력 해석에 사고가 필요 없고 지연·토큰만 늘린다.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        // 시연 허용선. 넘기면 키워드 폴백이 즉시 답한다.
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!res.ok) return null
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const content = body.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) return null
    return validateIntent(JSON.parse(content), new Set(places.map((p) => p.id)))
  } catch {
    return null // 타임아웃·네트워크·JSON 오류 전부 폴백으로
  }
}
