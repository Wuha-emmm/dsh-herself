// lib/trace.mjs —— 她的「思考过程」旁路日志
//
// 为什么不进事件流：
//   · 事件流是**经历**（她看见了什么、说了什么），提示词和推理是**计算过程**；
//   · 写进去她会读到自己的草稿（derive 会把 utterance 当判断）；
//   · 预演 §四 明写 meta 不存派生量。
//
// 所以：logs/trace.jsonl，一回合一行，坏了不影响她说话。
// 只保留最近的一段（默认 8MB，滚一个 .1 档）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// 默认落在项目的 logs/；测试和搬家可以指到别处
const FILE = process.env.DSH_HERSELF_TRACE || path.join(here, '..', 'logs', 'trace.jsonl')
const MAX_BYTES = 8 * 1024 * 1024

/** 超过上限就滚一档：trace.jsonl → trace.jsonl.1（旧的 .1 直接丢） */
function rotate() {
  try {
    const st = fs.statSync(FILE)
    if (st.size <= MAX_BYTES) return
    const bak = FILE + '.1'
    try { fs.rmSync(bak, { force: true }) } catch { /* ignore */ }
    fs.renameSync(FILE, bak)
  } catch { /* 文件还不存在 */ }
}

/**
 * 记一回合。
 * @param {object} rec { ts, thread, causeId, utteranceId, model, ms, userText,
 *                       facts, hits, tools, reasoning, text, usage, error }
 */
export function appendTrace(rec) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    rotate()
    fs.appendFileSync(FILE, JSON.stringify({ v: 1, ...rec }) + '\n', 'utf8')
    return true
  } catch {
    return false   // 旁路失败绝不打断她说话
  }
}

/** 读最近 n 条（文件最大 8MB，整读可接受） */
export function readTrace({ limit = 200 } = {}) {
  try {
    const text = fs.readFileSync(FILE, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim())
    const out = []
    for (let i = Math.max(0, lines.length - limit); i < lines.length; i += 1) {
      try { out.push(JSON.parse(lines[i])) } catch { /* 坏行跳过 */ }
    }
    return out
  } catch {
    return []
  }
}

export const traceFile = FILE
