// test/batch.mjs —— 「等她说完再回」的策略
//
// 两个真问题（2026-10-29 主人反馈）：秒回像脚本（风控），而且他话没说完她就插嘴。
// 这里只测策略本身——给定第一条什么时候到、现在几点，该再等多久；几句怎么拼。
// 定时器在 hands/qq.mjs，那里只有 IO，不在这里测。
import { nextWait, composeUserText, DEBOUNCE_MS, MAX_WAIT_MS, MIN_GAP_MS } from '../lib/batch.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 还要等多久
{
  const firstAt = 1_000_000
  // 刚说完第一句：等满 debounce（+抖动）
  const a = nextWait({ firstAt, now: firstAt + 100, jitter: 0 })
  ok(a === DEBOUNCE_MS, '他刚说完一句：等满 debounce', String(a))

  // 他还在连着说：每来一句都要重新等
  const b = nextWait({ firstAt, now: firstAt + 3000, jitter: 0 })
  ok(b === DEBOUNCE_MS, '他还在说：重新计时，不是从第一次算', String(b))

  // 快到上限了：不能超过 MAX_WAIT
  const c = nextWait({ firstAt, now: firstAt + MAX_WAIT_MS - 1000, jitter: 0 })
  ok(c === 1000, '快到上限时只等剩下的那点', String(c))

  // 已经超过上限：立刻回，不能无限等
  const d = nextWait({ firstAt, now: firstAt + MAX_WAIT_MS + 5000, jitter: 0 })
  ok(d === 0, '他连着说不停：到点上就得回', String(d))

  // 抖动只会加，不会把等待推到上限之外
  const e = nextWait({ firstAt, now: firstAt + 100, jitter: 1500 })
  ok(e > DEBOUNCE_MS && e <= MAX_WAIT_MS, '抖动在 debounce 和上限之间', String(e))
}

// ---------------------------------------------------------------- 几句怎么拼
{
  ok(composeUserText(['在吗']) === '在吗', '只有一句：原样')
  const multi = composeUserText(['在吗', '刚才那个图你看了吗', '说句话'])
  ok(multi.startsWith('（他连着发了几条）'), '多句：标出来是连着说的')
  ok(multi.includes('刚才那个图你看了吗') && multi.split('\n').length === 4, '多句：一条一行，不粘连', JSON.stringify(multi))
  ok(composeUserText([]) === '' && composeUserText(['', '  ']) === '', '空的一律返回空串')
  ok(composeUserText(['  有空格  ']) === '有空格', '两头空格去掉')
}

// ---------------------------------------------------------------- 参数本身要合理
ok(DEBOUNCE_MS >= 3000 && DEBOUNCE_MS <= 8000, 'debounce 在 3~8 秒（太短像秒回，太长像掉线）', String(DEBOUNCE_MS))
ok(MAX_WAIT_MS > DEBOUNCE_MS && MAX_WAIT_MS <= 30000, '上限比 debounce 大，且不超过 30 秒', String(MAX_WAIT_MS))
ok(MIN_GAP_MS >= 5000, '同一条线两次回复至少隔 5 秒（风控）', String(MIN_GAP_MS))

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
