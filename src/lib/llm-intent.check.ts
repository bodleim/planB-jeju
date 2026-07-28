/** `npm run check:intent` — LLM 응답 검증(신뢰 경계)이 이상값을 전부 걸러내는지. 네트워크 불필요. */
import { strict as assert } from 'node:assert'
import { validateIntent } from './llm-intent.ts'

const known = new Set(['tour-1', 'tour-2'])

// 정상 응답은 그대로 통과
const ok = validateIntent(
  { cause: 'rain', companion: 'family', activity: 'food', remainingMinutes: 240, avoidIds: ['tour-1'], preferIds: ['tour-2'] },
  known,
)
assert.equal(ok.cause, 'rain')
assert.deepEqual(ok.avoidIds, ['tour-1'])
assert.deepEqual(ok.preferIds, ['tour-2'])

// 목록 밖 id·중복·비문자열은 버린다 — LLM 이 장소를 지어내는 통로 차단
const ids = validateIntent({ avoidIds: ['tour-9', 'tour-1', 'tour-1', 42], preferIds: 'not-array' }, known)
assert.deepEqual(ids.avoidIds, ['tour-1'])
assert.deepEqual(ids.preferIds, [])

// enum 밖 값은 null, 시간은 60~720 으로 클램프
const junk = validateIntent({ cause: 'alien_attack', companion: 7, remainingMinutes: 9999 }, known)
assert.equal(junk.cause, null)
assert.equal(junk.companion, null)
assert.equal(junk.remainingMinutes, 720)
assert.equal(validateIntent({ remainingMinutes: 10 }, known).remainingMinutes, 60)

// 완전 쓰레기 입력도 던지지 않는다
assert.deepEqual(validateIntent(null, known).avoidIds, [])



// reply — 공백 정리·200자 컷, 빈 문자열은 null
assert.equal(validateIntent({ reply: '  승마장은  후보에\n없어요  ' }, known).reply, '승마장은 후보에 없어요')
assert.equal(validateIntent({ reply: '' }, known).reply, null)
assert.equal(validateIntent({ reply: 'x'.repeat(500) }, known).reply?.length, 200)
console.log('check:intent OK')
