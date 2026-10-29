// tools/backfill-thread.mjs —— 给老事件补"它属于哪条线"
//
// 背景：她的早期回复没有 meta.thread，refs 也追不回去，于是面板里多出一个叫 qq 的
// 幽灵会话（2026-10-29 主人看到私聊被挤没时顺带发现的）。
//
// 事件流不能改（只追加 + 哈希链），所以补丁写在**派生层**：
//   life/thread-overrides.json  { "<eventId>": { "thread": "...", "via": "prev:<id>", "at": "..." } }
// 谁没有线索、靠什么推出来的，都记在 via 里，能复核、能删。
//
// 用法：
//   node tools/backfill-thread.mjs --dry    # 只看会补哪些，不写文件
//   node tools/backfill-thread.mjs          # 写 life/thread-overrides.json
import fs from 'node:fs'
import path from 'node:path'
import { readEvents } from '../lib/store.mjs'
import { liveEvents } from '../lib/derive.mjs'

const ROOT = 'E:/DSH-herself/life'
const OUT = path.join(ROOT, 'thread-overrides.json')
const DRY = process.argv.includes('--dry')
const WINDOW_MS = 6 * 60 * 1000      // 前后 6 分钟之内算"同一段对话"

const ev = liveEvents(readEvents(ROOT))
const byId = new Map(ev.map((e) => [e.id, e]))

/** 和 lib/live.mjs 同一个口径 */
function knownThread(e, seen = new Set()) {
  if (e.meta?.thread) return e.meta.thread
  const q = e.meta?.qq
  if (q) return q.groupId ? 'qq:group:' + q.groupId : 'qq:private:' + (q.senderId ?? 'owner')
  if (Array.isArray(e.refs) && !seen.has(e.id)) {
    seen.add(e.id)
    for (const r of e.refs) {
      const src = byId.get(r)
      if (src) {
        const t = knownThread(src, seen)
        if (t) return t
      }
    }
  }
  return ''
}

const overrides = {}
let patched = 0
let skipped = 0
for (let i = 0; i < ev.length; i += 1) {
  const e = ev[i]
  if (knownThread(e)) continue
  const surface = String(e.surface ?? '')
  if (surface !== 'qq') { skipped += 1; continue }
  const at = Date.parse(e.ts) || 0
  // 往前找最近一条能认出线的同类事件（再往后找一次，取更近的那条）
  let best = null
  for (let d = 1; d <= 40 && !best; d += 1) {
    for (const j of [i - d, i + d]) {
      const o = ev[j]
      if (!o || String(o.surface ?? '') !== 'qq') continue
      const t = knownThread(o)
      if (!t) continue
      const gap = Math.abs((Date.parse(o.ts) || 0) - at)
      if (gap <= WINDOW_MS) best = { thread: t, via: 'prev:' + o.id, gap }
    }
  }
  if (best) {
    overrides[e.id] = { thread: best.thread, via: best.via, at: e.ts }
    patched += 1
  } else {
    skipped += 1
  }
}

console.log(`事件总数 ${ev.length}；能补 ${patched} 条；补不了 ${skipped} 条`)
const byThread = {}
for (const v of Object.values(overrides)) byThread[v.thread] = (byThread[v.thread] || 0) + 1
for (const [t, n] of Object.entries(byThread).sort((a, b) => b[1] - a[1])) console.log(`  ${t}  ${n}`)

if (DRY) { console.log('（--dry，没有写文件）'); process.exit(0) }
fs.writeFileSync(OUT, JSON.stringify(overrides, null, 2), 'utf8')
console.log('写入', OUT)