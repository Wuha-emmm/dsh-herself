// test/audit-note.mjs —— 体检没过时贴给她看的那一句
//
// 她的原话（2026-10-30 00:01）：
//   「把话说到一半停了，你只看到半句，就知道它断在哪儿，是因为我在跟你说人话。
//     脚本要是也这么断，没人会替它接上。所以那条提示最好自己就短，一句话能说完，别留半截。」
//   「落成『你来处理』就是把决定压到你头上；『你提一句就行』是门虚掩着。」
import { auditNote } from '../lib/think.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const line = (st) => auditNote(st)

{
  ok(line({ warnings: [], problems: [] }) === '', '体检全过 → 一个字都不说')

  const a = line({ warnings: ['qq.mjs 没有断线重连，重启后不会自己接回来'] })
  ok(a.length > 0, '有一项没过就说一句', a)
  ok(!a.includes('…'), '不许留半截（没有省略号）', a)
  ok(/。$/.test(a), '整句收尾完整', a)
  ok(!a.includes('没有断线重连'), '第一条太长就不带进句子里（宁可不具体）', a)
  ok(a.includes('1 项'), '报条数')
  ok(!/logs\//.test(a), '不给她指她自己打不开的路径（sandbox 里读不到 logs/）')

  const b = line({ problems: ['事件流哈希链断了'] })
  ok(b.includes('事件流哈希链断了'), '第一条够短就带上，能指认到具体哪条', b)
  ok(/。$/.test(b) && !b.includes('…'), '带上具体项时也是完整一句', b)

  const c = line({ warnings: ['a 很长很长的警告内容超过十六个字的那种'], problems: ['b 另一条'] })
  ok(!c.includes('…'), '多条时更不乱截', c)
  ok(/你提一句就行。$/.test(c), '落成「你提一句就行」，不是「你来处理」', c)
  ok(!/你来处理|请处理|必须/.test(c), '不把决定压到她头上')

  const long = line({ warnings: Array.from({ length: 12 }, (_, i) => '第 ' + i + ' 条警告') })
  ok(long.length <= 60, '整句不超过 60 字（说得出、读得完）', String(long.length))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)