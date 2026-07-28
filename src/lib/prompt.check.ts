/** `npm run check:prompt` — 직접 말하기 예시 문장이 의도한 입력으로 매핑되는지. */
import { strict as assert } from 'node:assert'
import { parsePrompt } from './prompt.ts'

// 시연 예시 세 문장 (page.tsx 의 직접 말하기 시트와 같은 문장)
const ex1 = parsePrompt('우도 가려다 결항됐어. 애 둘이랑 갈 만한 실내로 오후까지 채워줘')
assert.equal(ex1.cause, 'ferry_cancelled')
assert.equal(ex1.companion, 'family') // '애 둘이랑' 의 '둘이' 가 커플로 잡히면 안 된다
assert.equal(ex1.activity, 'indoor')

const ex2 = parsePrompt('점심은 흑돼지 먹고 나머지는 조용한 데로')
assert.equal(ex2.activity, 'food')

const ex3 = parsePrompt('비행기 결항돼서 5시간 비어. 혼자 액티비티 하고 싶어')
assert.equal(ex3.cause, 'flight_cancelled') // '비행기' 의 '비' 가 강수로 잡히면 안 된다
assert.equal(ex3.companion, 'solo')
assert.equal(ex3.activity, 'activity')
assert.equal(ex3.remainingMinutes, 300)

assert.deepEqual(parsePrompt('아무 관련 없는 문장').understood, [])

console.log('check:prompt OK')
