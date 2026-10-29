// lib/live.mjs —— 侧栏面板要的两样东西：对话流，和一回合的思考过程
//
// 拆成两次请求是有意的：
//   · /live 每 3 秒轮询，只带「这一轮有没有记录、多长、调了几只手」这种摘要；
//   · /turn 只在你点开某一轮时拉全文（她看到的事实 / 检索命中 / reasoning）。
// 否则 reasoning 会跟着轮询一起反复传，几百 KB 一次。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEvents } from './store.mjs'
import { liveEvents } from './derive.mjs'
import { readTrace, traceFile } from './trace.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const KEY_FILE = path.join(here, '..', 'secrets', 'deepseek.key')
const API = 'https://api.deepseek.com/chat/completions'
/** 译文的缓存：和 trace 放同一个目录，测试用 env 换路径时它跟着走 */
const ZH_FILE = path.join(path.dirname(traceFile), 'trace-zh.json')

const CONV = new Set(['encounter', 'utterance'])

/**
 * 和 think.mjs 的 threadOf 同一口径（这里不 import think，免得把整条 LLM 依赖拖进服务端）。
 * 2026-10-29 补：她自己的回复没有 qq 元信息，光看 surface 会全落到 'qq' 那一桶，
 * 面板上就变成「她的旧回复」自成一栏。顺着 refs 找回她当时在回谁，老事件才能归位。
 */
let OVER = null
function loadOverrides(root) {
  try { OVER = JSON.parse(fs.readFileSync(path.join(root, 'thread-overrides.json'), 'utf8')) } catch { OVER = null }
}

function threadOf(e, byId) {
  // 派生层补丁：老事件靠 tools/backfill-thread.mjs 推出来的线（事件流不动）
  if (OVER && OVER[e.id]) return OVER[e.id].thread
  if (e.meta?.thread) return e.meta.thread
  const q = e.meta?.qq
  if (q) return q.groupId ? 'qq:group:' + q.groupId : 'qq:private:' + (q.senderId ?? 'owner')
  if (byId && Array.isArray(e.refs)) {
    for (const r of e.refs) {
      const src = byId.get(r)
      if (src) return threadOf(src, byId)
    }
  }
  return e.surface ?? 'dsh'
}

function who(e) {
  const q = e.meta?.qq
  if (e.type === 'utterance') return '她'
  if (q?.senderId) return String(q.senderId)
  return String(e.actor ?? '').replace(/^other:/, '')
}

/**
 * 对话流 + 每条她那句话的思考摘要。
 * @param {string} root life 根
 * @param {{limit?:number}} opts
 */
export function buildLive(root, { limit = 60 } = {}) {
  loadOverrides(root)   // 老事件的线补丁（tools/backfill-thread.mjs 生成）
  const ev = liveEvents(readEvents(root))
  const traces = readTrace({ limit: 400 })
  const byId = new Map()
  for (const t of traces) if (t.utteranceId) byId.set(t.utteranceId, t)
  // 认线用：事件 id → 事件。她自己的回复要顺着 refs 找回它在哪条线上，
  // 否则面板上「她的旧回复」会单独成一栏（2026-10-29 主人看到的就是这个）。
  const evById = new Map()
  for (const e of ev) evById.set(e.id, e)

  // 以前是全局 .slice(-limit)：一个群刷屏，私聊就被挤出窗口（2026-10-29 主人发现私聊空了）。
  // 现在先按线分组，每条线各留 limit 条，再按时间合回去。
  const conv = ev.filter((e) => CONV.has(e.type) && e.text)
  const byThread = new Map()
  for (const e of conv) {
    const th = threadOf(e, evById) || '__no_thread'
    if (!byThread.has(th)) byThread.set(th, [])
    byThread.get(th).push(e)
  }
  const picked = []
  for (const arr of byThread.values()) picked.push(...arr.slice(-limit))
  picked.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0))
  const turns = picked
    .map((e) => {
      const t = byId.get(e.id)
      const gid = e.meta?.qq?.groupId
      return {
        id: e.id,
        ts: e.ts,
        type: e.type,
        who: who(e),
        group: gid ? String(gid) : '',
        thread: threadOf(e, evById),
        text: String(e.text).slice(0, 400),
    // 面板按 QQ 的样子显示：引用/转发/图/表情/语音 都靠这行结构
    segs: Array.isArray(e.meta?.qq?.segs) ? e.meta.qq.segs : [],
        // 摘要：有记录才给，没记录的就是老回合（面板上线前的）
        trace: t
          ? {
              ms: t.ms ?? null,
              tools: (t.tools ?? []).length,
              reasoning: String(t.reasoning ?? '').length,
              tokens: t.usage?.completion_tokens ?? null,
              reasoningTokens: t.usage?.reasoning_tokens ?? null,
            }
          : null,
      }
    })
  return { ok: true, at: new Date().toISOString(), turns, traced: byId.size }
}

/** 这一段是不是「主人读不懂的英文」（中文占比太低） */
export function needsZh(text) {
  const s = String(text ?? '')
  if (s.length < 40) return false          // 太短的不值得翻
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) ?? []).length
  return cjk / s.length < 0.35
}

function loadZh() {
  try { return JSON.parse(fs.readFileSync(ZH_FILE, 'utf8')) } catch { return {} }
}
function saveZh(obj) {
  try {
    // 只留最近 200 条，文件不会无限长
    const keys = Object.keys(obj)
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete obj[k]
    fs.mkdirSync(path.dirname(ZH_FILE), { recursive: true })
    fs.writeFileSync(ZH_FILE, JSON.stringify(obj), 'utf8')
  } catch { /* ignore */ }
}

async function translate(text) {
  let key = ''
  try { key = fs.readFileSync(KEY_FILE, 'utf8').trim() } catch { return '' }
  if (!key) return ''
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-flash',
        thinking: { type: 'disabled' },
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: 'system', content: '把下面这段英文的思考过程译成简体中文。只输出译文，不要解释，不要保留英文原文，不要加引号。' },
          { role: 'user', content: String(text).slice(0, 4000) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return ''
    const j = await r.json().catch(() => ({}))
    return String(j?.choices?.[0]?.message?.content ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * 按需翻译：只有主人真的点开这一轮才翻，翻过的写进 trace-zh.json。
 * 命中缓存就不再花钱。
 */
export async function ensureZh(utteranceId, reasoning) {
  if (!utteranceId || !needsZh(reasoning)) return ''
  const cache = loadZh()
  if (cache[utteranceId]) return cache[utteranceId]
  const zh = await translate(reasoning)
  if (!zh) return ''
  cache[utteranceId] = zh
  saveZh(cache)
  return zh
}

/**
 * 某一轮的全部思考过程。
 * @param {string} root
 * @param {string} utteranceId
 * @param {{translate?:boolean}} opts translate=false 时只查缓存，不花钱
 */
export async function readTurn(root, utteranceId, { translate: doTranslate = true } = {}) {
  if (!utteranceId) return null
  const t = readTrace({ limit: 400 }).find((x) => x.utteranceId === utteranceId)
  if (!t) return null
  const zh = doTranslate
    ? await ensureZh(utteranceId, t.reasoning)
    : (loadZh()[utteranceId] ?? '')
  return zh ? { ...t, reasoningZh: zh } : t
}
