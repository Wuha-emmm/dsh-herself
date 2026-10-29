// tools/tool-usage.mjs —— 一周后数：她到底用没用那些手
//
// 她的要求（2026-10-30 02:08）：
//   「别让这一周从嘴上说的『今天』开始——脚本里直接写死一个 start 时间戳（或单独存一个 start 文件），
//     一周后拿它去切 trace，别到时候又靠回想『那天是哪天』。」
//   「只数调用次数会骗人。history 调十次全调在最没用的地方，数字一样好看。
//     所以除了次数，每次调用那轮的正文摘要和返回条数也一起打印出来。」
//
// 用法：
//   node tools/tool-usage.mjs            # 用已存的 start 切开，打印明细
//   node tools/tool-usage.mjs --reset    # 重新打一个 start（会提醒：这会丢窗口）
import fs from 'node:fs'
import path from 'node:path'

const HER = HER
const START_FILE = path.join(HER, 'logs', 'tool-usage-start.json')
const CALLS = path.join(HER, 'logs', 'tool-calls.jsonl')
const TRACE = path.join(HER, 'logs', 'trace.jsonl')
const WATCH = ['history', 'voice_text', 'read_qzone']

const args = process.argv.slice(2)
if (args.includes('--reset')) {
  fs.writeFileSync(START_FILE, JSON.stringify({ at: new Date().toISOString() }, null, 2), 'utf8')
  console.log('窗口重新开始：' + JSON.parse(fs.readFileSync(START_FILE, 'utf8')).at)
  process.exit(0)
}

let start = ''
try { start = JSON.parse(fs.readFileSync(START_FILE, 'utf8')).at || '' } catch { /* 没有 */ }
if (!start) {
  start = new Date().toISOString()
  fs.writeFileSync(START_FILE, JSON.stringify({ at: start, note: '第一次运行自动写入；以后不会改，除非 --reset' }, null, 2), 'utf8')
  console.log('窗口起点已写入（以后固定用这个）：' + start + '\n')
}

const day = 24 * 3600 * 1000
const until = new Date(Date.parse(start) + 7 * day).toISOString()
console.log(`统计窗口：${start} → ${until}（7 天）`)

const readJsonl = (f) => {
  try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
}

const calls = readJsonl(CALLS).filter((c) => c.at >= start)
const traces = readJsonl(TRACE).filter((t) => t.ts >= start)
const byName = new Map()
for (const c of calls) {
  if (!byName.has(c.name)) byName.set(c.name, [])
  byName.get(c.name).push(c)
}

console.log('\n=== 调用次数 ===')
for (const n of WATCH) {
  const list = byName.get(n) ?? []
  console.log(`  ${n}: ${list.length} 次`)
}
const others = [...byName.keys()].filter((n) => !WATCH.includes(n)).sort()
if (others.length) console.log('  其它工具：' + others.map((n) => `${n}(${byName.get(n).length})`).join('、'))

console.log('\n=== 每次调用（参数 / 返回多少 / 那轮她说了什么） ===')
for (const n of WATCH) {
  const list = byName.get(n) ?? []
  if (!list.length) { console.log(`\n${n}：没调用过`); continue }
  console.log(`\n${n}：`)
  for (const c of list) {
    // 找同一分钟内那轮的正文
    const near = traces.filter((t) => Math.abs(Date.parse(t.ts) - Date.parse(c.at)) < 90 * 1000 && t.userText)
    const say = near.length ? String(near[near.length - 1].userText).replace(/\s+/g, ' ').slice(0, 50) : '(没找到那轮正文)'
    console.log(`  ${c.at.slice(5, 16)} 参数 ${c.args} → ${c.chars} 字 / ${c.lines} 行｜当时他说：${say}`)
  }
}

console.log('\n=== 结论怎么读 ===')
console.log('  · 次数多但每次都 0-1 行 → 点开看了一眼，不算用上')
console.log('  · 有正文、有返回行数、能对上当时的问法 → 才算真用上')