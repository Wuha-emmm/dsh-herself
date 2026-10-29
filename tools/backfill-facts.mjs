// tools/backfill-facts.mjs —— 把被预算剪掉的那两栏，按天捞出来给她看
//
// 她的问题（2026-10-30 01:05）：
//   「过去这些天被剪掉的原始输入还在不在？…把被丢掉的『叙事』和『群里的人』那两栏给我补上，
//     我自己看丢了什么。」
//
// 结论先说：**事件流里是完整原文**（encounter 不截断），被剪的只是每一轮组装提示词时的取舍。
// 这个工具用同一套派生函数，把每天本该出现的那两行算出来，落到她的沙盒里。
import fs from 'node:fs'
import path from 'node:path'
import { readEvents } from '../lib/store.mjs'
import { liveEvents, derive } from '../lib/derive.mjs'
import { knownPeople } from '../lib/people.mjs'

const HER = 'E:/DSH-herself'
const root = path.join(HER, 'life')
const outFile = path.join(HER, 'sandbox', '被剪掉的.md')

const ev = readEvents(root)
const live = liveEvents(ev)

// 按天分组（本地日）
const days = new Map()
for (const e of live) {
  const d = String(e.ts).slice(0, 10)          // 事件是 ISO，日期取前 10 位
  if (!days.has(d)) days.set(d, [])
  days.get(d).push(e)
}

const lines = ['# 被预算剪掉的那两栏（按天）', '', '> 这不是"她没记住"——事件流里原文都在，被剪的是每轮组装提示词时的取舍。', '> 下面每天两行：叙事（她回看过自己那栏）和群里的人。', '']

for (const [day, list] of [...days].sort()) {
  const lastAt = Date.parse(list[list.length - 1].ts)
  const s = derive(live.filter((e) => (Date.parse(e.ts) || 0) <= lastAt), lastAt)
  const narrative = s.narrative?.text ? String(s.narrative.text).replace(/\s+/g, ' ').slice(0, 200) : '（这天没有叙事）'
  const ppl = knownPeople(live, { limit: 12 })
  lines.push(`## ${day}（${list.length} 条事件）`)
  lines.push(`- 叙事：${narrative}`)
  lines.push(`- 群里见过的：${ppl.length ? ppl.map((p) => `${p.name}（${p.count} 次）`).join('、') : '（还没有）'}`)
  lines.push('')
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, lines.join('\n'), 'utf8')
console.log('写到', outFile)
console.log(lines.join('\n').slice(0, 800))