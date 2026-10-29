// tools/pick-review.mjs —— 挑判断这件事，错了要留痕
//
// 她的要求（2026-10-30 01:26）：
//   1) why 是模型自己写的旁白，不是打分依据——只能当线索，不能当证据；
//   2) 误配了别悄悄换掉：把"它挑的"和"该挑的"两条都留着，让她看它当时在看什么。
//
// 用法：
//   node tools/pick-review.mjs                  # 看所有挑过的记录（含误配）
//   node tools/pick-review.mjs mark <序号> <该挑的 claim id> [一句说明]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const FILE = path.join(HER, 'logs/pick.jsonl')
const evFile = path.join(HER, 'life/events.jsonl')

const readLog = () => {
  try {
    return fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch { return [] }
}
const textOf = (() => {
  const map = new Map()
  try {
    for (const line of fs.readFileSync(evFile, 'utf8').trim().split('\n')) {
      try { const e = JSON.parse(line); map.set(e.id, String(e.text ?? '')) } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return (id) => map.get(id) ?? '(找不到这条)'
})()

const [cmd, idx, expected, ...rest] = process.argv.slice(2)
const log = readLog()

if (cmd === 'mark') {
  const rec = log.filter((x) => x.method).at(Number(idx) - 1)
  if (!rec) { console.error('没有第 ' + idx + ' 条挑判断记录'); process.exit(1) }
  if (!expected) { console.error('要给它该挑的那条 id'); process.exit(1) }
  const entry = {
    at: new Date().toISOString(),
    kind: 'pick-mismatch',
    ref: rec.at,
    query: rec.query,
    picked: rec.picked,
    pickedText: textOf(rec.picked),
    expected,
    expectedText: textOf(expected),
    candidates: (rec.candidates ?? []).map((id) => ({ id, text: textOf(id) })),
    note: rest.join(' ') || '',
    why_model: rec.why,
    whyNote: 'why 是模型旁白，不是打分依据',
  }
  fs.appendFileSync(FILE, JSON.stringify(entry) + '\n', 'utf8')
  console.log('已记下误配（原记录保留，没删）：')
  console.log('  它挑的:', entry.pickedText.slice(0, 60))
  console.log('  该挑的:', entry.expectedText.slice(0, 60))
  process.exit(0)
}

if (cmd === 'nomatch') {
  // 抽查：她说的「3 条不算验收」——样本少时随机 3 条抓不到误判。
  // 默认抽一半（最少 5 条）；total<10 时明确警告"样本太少"。
  const picksAll = readLog().filter((x) => x.method === 'no_match')
  const total = picksAll.length
  if (!total) { console.log('还没有 no_match 记录'); process.exit(0) }
  const arg = String(idx ?? '').trim()
  let n
  if (arg === 'all') n = total
  else if (arg && Number(arg) > 0) n = Math.min(total, Number(arg))
  else n = Math.max(5, Math.ceil(total / 2))
  if (total < 10) {
    console.log(`⚠ 现在只有 ${total} 条 no_match：**样本太少，不能当验收**。`)
    console.log('  建议攒到十几条再抽查（默认会抽一半，最少 5 条）。\n')
  }
  const shuffled = [...picksAll].sort(() => Math.random() - 0.5).slice(0, n)
  console.log(`抽查 ${shuffled.length} / ${total} 条（覆盖 ${Math.round((shuffled.length / total) * 100)}%）\n`)
  for (const p of shuffled) {
    console.log('问：' + p.query + '（' + String(p.at).slice(5, 16) + '）')
    console.log('  模型旁白：' + String(p.why ?? '').slice(0, 60) + '（线索，非证据）')
    for (const c of p.candidates ?? []) console.log('  · ' + String(c.text ?? c).slice(0, 60))
    console.log('')
  }
  process.exit(0)
}

// 列表
const picks = log.filter((x) => x.method)
const mismatches = log.filter((x) => x.kind === 'pick-mismatch')
console.log(`挑判断记录：${picks.length} 条｜已标注误配：${mismatches.length} 条`)
for (const [i, p] of picks.entries()) {
  const bad = mismatches.find((m) => m.ref === p.at)
  console.log(`\n${i + 1}. ${String(p.at).slice(5, 16)} [${p.method}] 问：${p.query}`)
  console.log(`   挑中：${textOf(p.picked).slice(0, 60)}`)
  console.log(`   旁白：${String(p.why ?? '').slice(0, 60)}（线索，非证据）`)
  if (bad) console.log(`   ⚠ 误配：该挑的是「${bad.expectedText.slice(0, 50)}」${bad.note ? '｜' + bad.note : ''}`)
}