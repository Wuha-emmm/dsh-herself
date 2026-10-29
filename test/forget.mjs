// test/forget.mjs —— 遗忘的三层（热 / 温 / 冷）
//
// 这个项目的「遗忘」不是删数据，是**派生时决定进不进她眼前**：
//   热（3 天内）原话；温（3~30 天）优先用摘要顶替；冷（30 天以上）只在很像时才说一句。
// 守两件事：别把该记得的原话丢太快；也别让一个月前的玩笑当现在的证据。
import { coolHits, recallLine, COOL_AFTER_MS, FORGET_AFTER_MS, COLD_KEEP_SCORE } from '../lib/forget.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const now = Date.parse('2026-10-29T12:00:00+08:00')
const hit = (days, score, text, thread = 'qq:private:1') => ({
  id: 'h' + days + Math.random().toString(36).slice(2, 6),
  at: new Date(now - days * 86400000).toISOString(),
  text, score, thread,
})
const sum = (days, text, thread = 'qq:private:1') => ({ id: 's' + days, ts: new Date(now - days * 86400000).toISOString(), text, meta: { thread } })

// ---------------------------------------------------------------- 热
{
  const r = coolHits([hit(0.1, 0.9, '刚说的')], [], now)
  ok(r.keep.length === 1 && r.folded.length === 0, '当天的话原话给')
  ok(!/好多天前/.test(recallLine(r, now)), '不加"好几天前"的标注')
}
{
  const r = coolHits([hit(2, 0.8, '两天前')], [], now)
  ok(r.keep.length === 1 && r.keep[0].age === 'hot', '3 天内都算热', String(r.keep[0]?.age))
}

// ---------------------------------------------------------------- 温
{
  const r = coolHits([hit(10, 0.7, '十天前原话')], [sum(9, '那阵子在聊项目')], now)
  ok(r.folded.length === 1 && r.keep.length === 0, '有过摘要就用摘要顶替原话', JSON.stringify({ k: r.keep.length, f: r.folded.length }))
  ok(/那次聊过/.test(recallLine(r, now)), '而且标明是"那次聊过"', recallLine(r, now))
}
{
  const r = coolHits([hit(10, 0.7, '十天前原话', 'qq:group:2')], [sum(9, '私聊的摘要')], now)
  ok(r.keep.length === 1, '摘要不属于这条线，就还是给原话（不能张冠李戴）')
  ok(/好几天前/.test(recallLine(r, now)), '给原话时明说是好几天前的', recallLine(r, now))
}

// ---------------------------------------------------------------- 冷
{
  const strong = coolHits([hit(40, 0.9, '四十天前很像的一句')], [], now)
  ok(strong.folded.length === 1, `30 天以上但分数 ≥ ${COLD_KEEP_SCORE}：还说一句`, JSON.stringify({ k: strong.keep.length, d: strong.dropped.length }))
  ok(/很久以前/.test(recallLine(strong, now)), '而且标明很久以前', recallLine(strong, now))

  const weak = coolHits([hit(40, 0.3, '四十天前的弱命中')], [], now)
  ok(weak.dropped.length === 1 && weak.keep.length === 0, '分数不够就忘掉（不给她看）')
  ok(recallLine(weak, now) === '', '忘掉之后那一行是空的')
}

// ---------------------------------------------------------------- 边界
{
  ok(COOL_AFTER_MS === 3 * 86400000 && FORGET_AFTER_MS === 30 * 86400000, '阈值就是 3 天 / 30 天')
  const future = coolHits([{ id: 'x', at: new Date(now + 86400000).toISOString(), text: '未来的', score: 0.9 }], [], now)
  ok(future.keep.length === 1, '时间在未来也不会被当成"很久以前"')
  const broken = coolHits([{ id: 'y', at: '看不懂', text: '时间坏了', score: 0.9 }], [], now)
  ok(broken.keep.length === 1, '时间读不出来就别乱丢')
  const many = coolHits([hit(0.1, 0.9, 'a'), hit(1, 0.9, 'b'), hit(2, 0.9, 'c')], [], now)
  ok(recallLine(many, now).split('；').length === 3, '多条热记忆都保留', recallLine(many, now))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)