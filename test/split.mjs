// test/split.mjs —— 出门前切段：只切在句子边界，切完每段都能自己确认
//
// 她的原话（2026-10-30 00:10）：
//   「在输出前先按长度切段，每段发完自己确认一下，哪段没到就当场补，不指望你替我盯。」
import { splitMessage, needsSplit, SEGMENT_MAX } from '../lib/split.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

{
  ok(JSON.stringify(splitMessage('在。')) === '["在。"]', '短消息不切，原样一条')
  ok(splitMessage('').length === 0, '空串不产生段')
  ok(!needsSplit('短句'), '短句不需要切')
  ok(needsSplit('x'.repeat(SEGMENT_MAX + 1)), '超过上限才切')
}

{
  const long = '第一句说的是这个。第二句接着讲那个，里面还有逗号。第三句收尾。'.repeat(30)
  const parts = splitMessage(long, { max: 300 })
  ok(parts.length > 1, '长文切成了多段', String(parts.length))
  ok(Math.max(...parts.map((p) => p.length)) <= 300, '每段都不超上限', String(Math.max(...parts.map((p) => p.length))))
  ok(parts.every((p) => /[。！？…；]$/.test(p.trim())), '每段都以标点收尾（不留半句）', JSON.stringify(parts.map((p) => p.slice(-1))))
  ok(parts.join('') === long, '拼回去和原文一字不差（没有丢字）')
}

{
  // 一整句超长：只能硬切，但要切在逗号上
  const one = '很长的一句话' + '，还在继续说'.repeat(120) + '。'
  const parts = splitMessage(one, { max: 200 })
  ok(parts.every((p) => p.length <= 200), '单句超长也守住上限')
  ok(parts.join('') === one, '硬切也不丢字')
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)