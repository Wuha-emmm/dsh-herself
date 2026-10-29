// tools/budget-breakdown.mjs —— 905/1000 到底花在哪：按段列出来
//
// 她的要求（2026-10-30 01:10）：
//   「你要是能给我 905 的构成明细（各段各占多少），我按那个定，不按拍脑袋的顺序。」
import fs from 'node:fs'
import path from 'node:path'
import { readEvents } from '../lib/store.mjs'
import { factsOf } from '../lib/think.mjs'
import { estimateTokens } from '../lib/budget.mjs'

const HER = HER
const root = path.join(HER, 'life')
const out = path.join(HER, 'sandbox', '预算明细.md')
// 默认线程从事件里推断（私聊最多的那个），不要把某个人的号写死在公开仓库里
function guessThread(events) {
  const count = new Map()
  for (const e of events) {
    const t = String(e.meta?.qq?.groupId ? 'qq:group:' + e.meta.qq.groupId : 'qq:private:' + (e.meta?.qq?.senderId || ''))
    if (/qq:private:$/.test(t)) continue
    count.set(t, (count.get(t) ?? 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}
const thread = process.argv[2] || guessThread(ev)

const ev = readEvents(root)
const r = factsOf(ev, Date.now(), '', thread, { budgetWatch: false })

// 每段开头的那几个字就是分段标记（核心/时间/判断/改过口/最近…）
const label = (t) => {
  const s = String(t)
  if (s.startsWith('这是你存在的第')) return '核心（第几天+现在几点）'
  if (s.startsWith('时间按北京时间算')) return '作息刻度'
  if (s.startsWith('你说过、现在仍然算数的判断')) return '判断（claims）'
  if (s.startsWith('你改过口')) return '改过口（老判断+理由）'
  if (s.startsWith('你拒绝过')) return '拒绝过的'
  if (s.startsWith('你回看过自己')) return '叙事（她回看过自己）'
  if (s.startsWith('这个群里你见过的')) return '群里的人'
  if (s.startsWith('你们上次聊到')) return '摘要'
  if (s.startsWith('你还没了的事')) return '承诺'
  if (s.startsWith('最近：')) return '最近（对话窗口）'
  if (s.startsWith('你想起')) return '回忆（检索命中）'
  if (s.startsWith('DSH 那边回你话了')) return 'DSH 回话'
  if (s.startsWith('系统体检没过')) return '体检提醒'
  return '其它'
}

const rows = []
let total = 0
for (const line of r.out) {
  const tok = estimateTokens(line)
  total += tok
  rows.push({ label: label(line), tok, chars: String(line).length, head: String(line).slice(0, 40) })
}

// 同一类合并
const merged = new Map()
for (const x of rows) {
  const cur = merged.get(x.label) ?? { label: x.label, tok: 0, count: 0 }
  cur.tok += x.tok
  cur.count += 1
  merged.set(x.label, cur)
}
const list = [...merged.values()].sort((a, b) => b.tok - a.tok)

const lines = [
  '# 预算明细（每一段花多少）',
  '',
  `线程：${thread}`,
  `总量：${total} / ${r.budget.cap}（${((total / r.budget.cap) * 100).toFixed(0)}%）`,
  '',
  '| 段 | token | 占总量 | 行数 |',
  '|---|---|---|---|',
  ...list.map((x) => `| ${x.label} | ${x.tok} | ${((x.tok / total) * 100).toFixed(0)}% | ${x.count} |`),
  '',
  '## 每行开头（方便你对上原话）',
  '',
  ...rows.map((x) => `- ${x.tok} tok｜${x.label}｜${x.head}`),
  '',
]
fs.writeFileSync(out, lines.join('\n'), 'utf8')
console.log(lines.slice(0, 24).join('\n'))
console.log('\n写到', out)