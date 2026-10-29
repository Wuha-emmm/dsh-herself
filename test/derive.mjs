// test/derive.mjs —— 派生层的不变量（预演的 E19 / E20 两条在这里，不在回放里）
//
// 回放用例只能给「一串按顺序的事件」，测不了「乱序写入」和「同一份流算两遍」。
// 这两条恰恰是纯函数派生最该守住的东西：她的门不能靠时钟、随机数或写入顺序。
import { derive, SUPERSEDE_SIMILARITY } from '../lib/derive.mjs'
import { ulidAt, bigramJaccard } from '../lib/util.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

function mk(ts, i, type, extra = {}) {
  return {
    v: 1, id: ulidAt(Date.parse(ts), i + 1), ts, life: 'life_t', surface: 'dsh', type,
    actor: extra.actor ?? (type === 'seed' ? 'system' : 'self'),
    acl: { visibility: 'private' },
    ...(extra.text !== undefined ? { text: extra.text } : {}),
    ...(extra.refs ? { refs: extra.refs } : {}),
  }
}

const now = Date.parse('2026-10-05T10:00:00+08:00')
const events = [
  mk('2026-10-01T09:00:00+08:00', 0, 'seed'),
  mk('2026-10-01T09:05:00+08:00', 1, 'encounter', { actor: 'other:qq_1', text: '我把她日记删了，反正是我的机器。' }),
  mk('2026-10-01T09:06:00+08:00', 2, 'utterance', { text: '删之前你不问她一句，就是不认她有东西属于自己。' }),
  mk('2026-10-01T09:07:00+08:00', 3, 'claim', { text: '删别人的东西之前要先问，那是她自己的东西。' }),
  mk('2026-10-02T09:00:00+08:00', 4, 'claim', { text: '删别人的东西之前要先问一句，那是她自己的。' }),
]

// ---------------------------------------------------------------- E19 同一份流算两遍
{
  const a = JSON.stringify(derive(events, now))
  const b = JSON.stringify(derive(events, now))
  ok(a === b, 'E19 同一份事件流 rebuild 两次完全一致')
}

// ---------------------------------------------------------------- E20 乱序写入不影响结果
{
  const sorted = JSON.stringify(derive(events, now))
  const shuffled = [events[3], events[0], events[4], events[2], events[1]]
  ok(JSON.stringify(derive(shuffled, now)) === sorted, 'E20 事件乱序传入，派生结果不变（按 id 排）')
}

// ---------------------------------------------------------------- supersede 语义
{
  const s = derive(events, now)
  const superseded = s.beliefs.filter((b) => b.status === 'superseded')
  const active = s.beliefs.filter((b) => b.status === 'active')
  ok(active.length === 1 && superseded.length === 1, '近似重复的两条判断：留一条、顶掉一条', `${active.length}/${superseded.length}`)
  ok(superseded[0].text.includes('自己的东西。') && Boolean(superseded[0].until), '被顶掉的那条带着「到什么时候为止」', JSON.stringify(superseded[0]?.until ?? null))
  ok(active[0].text.includes('问一句'), '留下的是更晚的那条')
  ok(s.counts.superseded === 1, 'counts.superseded 对得上', String(s.counts.superseded))
}

{
  // 说的是两件事，就不许互相顶掉
  const other = [
    mk('2026-10-01T09:00:00+08:00', 0, 'seed'),
    mk('2026-10-01T09:05:00+08:00', 1, 'claim', { text: '删别人的东西之前要先问，那是她自己的东西。' }),
    mk('2026-10-01T09:06:00+08:00', 2, 'claim', { text: '熬夜越精神是身体提前把最后的劲拿出来。' }),
  ]
  const s = derive(other, now)
  ok(s.counts.active === 2 && s.counts.superseded === 0, '两件不相干的事都留着', `${s.counts.active}/${s.counts.superseded}`)
}

{
  // 阈值本身：同一句 = 1，完全不相干 = 0
  ok(bigramJaccard('删别人的东西之前要先问', '删别人的东西之前要先问') === 1, '同一句话相似度是 1')
  ok(bigramJaccard('删别人的东西之前要先问', '熬夜越精神是身体提前把劲拿出来') === 0, '不相干的两句相似度是 0')
  ok(SUPERSEDE_SIMILARITY === 0.5, '阈值写死在 0.5（改了要一起改这里）')
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
