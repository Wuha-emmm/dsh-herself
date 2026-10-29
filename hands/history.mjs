// hands/history.mjs —— 断线补录：把错过的对话按 messageId 补回事件流
//
// 原则：
//   · 只补「别人说的」，不补她自己的（她的回复已经在事件流里）
//   · 只补最近 maxAgeMs 内的，不翻旧账
//   · 补录不触发回复：错过的话只进记忆，不当场回
//   · 去重两条线：messageId 已经见过；或者同一句话在 ±2 分钟内已经记过
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appendEvent, readEvents } from '../lib/store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const TOKEN = path.join(HER, 'secrets', 'onebot.token')
const QQCFG = path.join(HER, 'secrets', 'qq.json')

const SYSTEM_NOTICE_RE = /(撤回了一条消息|加入了群聊|退出了群聊|被管理员禁言|被解除禁言|群公告：|该消息已被撤回|消息已过期)/

function token() {
  try { return fs.readFileSync(TOKEN, 'utf8').trim() } catch { return '' }
}
function owner() {
  try { return String(JSON.parse(fs.readFileSync(QQCFG, 'utf8')).owner ?? '') } catch { return '' }
}
function textOf(message) {
  if (typeof message === 'string') return message
  if (!Array.isArray(message)) return ''
  return message.map((s) => (s.type === 'text' ? (s.data?.text ?? '') : (s.type === 'image' ? '[图片]' : ''))).join('').trim()
}

function connect() {
  const t = token()
  return new WebSocket(`ws://127.0.0.1:3001/?access_token=${encodeURIComponent(t)}`)
}

function call(ws, action, params, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const echo = `bf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const timer = setTimeout(() => { ws.removeEventListener('message', on); resolve(null) }, timeoutMs)
    const on = (e) => {
      try {
        const j = JSON.parse(String(e.data))
        if (j.echo === echo) { clearTimeout(timer); ws.removeEventListener('message', on); resolve(j) }
      } catch { /* ignore */ }
    }
    ws.addEventListener('message', on)
    try { ws.send(JSON.stringify({ action, params, echo })) } catch { clearTimeout(timer); resolve(null) }
  })
}

/** 已经记过的话：messageId 集合 + 文本指纹 */
function known(root) {
  const ids = new Set()
  const texts = []
  for (const e of readEvents(root)) {
    const mid = e.meta?.qq?.messageId
    if (mid) ids.add(String(mid))
    if (e.text) texts.push({ t: e.ts, s: String(e.text) })
  }
  return { ids, texts }
}

function alreadyHave(k, msg) {
  if (msg.message_id && k.ids.has(String(msg.message_id))) return true
  const raw = String(msg.raw_message ?? textOf(msg.message)).trim()
  if (!raw) return true
  const t = Number(msg.time) * 1000
  return k.texts.some((x) => x.s.includes(raw) && Math.abs(Date.parse(x.t) - t) < 120000)
}

/**
 * 补录一个会话
 * @returns {Promise<number>} 新增条数
 */
async function fill(ws, root, { kind, id, name, k, maxAgeMs, count = 30 }) {
  const action = kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history'
  const params = kind === 'group' ? { group_id: Number(id), count } : { user_id: Number(id), count }
  const res = await call(ws, action, params)
  const msgs = res?.data?.messages
  if (!Array.isArray(msgs) || !msgs.length) return 0

  const cutoff = Date.now() - maxAgeMs
  const selfId = String(msgs[0]?.self_id ?? '')
  const fresh = []

  for (const m of msgs) {
    const from = String(m.sender?.user_id ?? m.user_id ?? '')
    if (!from || from === selfId) continue
    if (m.post_type === 'message_sent') continue
    if (alreadyHave(k, m)) continue
    const text = textOf(m.message) || String(m.raw_message ?? '')
    if (!text || SYSTEM_NOTICE_RE.test(text)) continue
    const at = Number(m.time) * 1000
    if (!Number.isFinite(at) || at < cutoff) continue
    fresh.push({ m, from, text, at })
  }

  fresh.sort((a, b) => a.at - b.at)   // 按时间补，事件顺序才对
  let added = 0
  for (const { m, from, text, at } of fresh) {
    const who = m.sender?.card || m.sender?.nickname || from
    appendEvent(root, {
      type: 'encounter',
      actor: `other:qq_${from}`,
      surface: 'qq',
      ts: new Date(at).toISOString(),
      text: kind === 'group' ? `[群 ${id}] ${who}：${text}` : `${who}：${text}`,
      acl: { visibility: 'private', surfaces: ['qq', 'dsh'] },
      meta: {
        backfill: true,
        qq: { selfId, senderId: from, groupId: kind === 'group' ? String(id) : '', messageId: m.message_id, private: kind !== 'group' },
      },
    })
    k.ids.add(String(m.message_id))
    k.texts.push({ t: new Date(at).toISOString(), s: text })
    added += 1
  }
  if (added) console.log(`[backfill] ${kind} ${id}(${name ?? ''}) 补了 ${added} 条`)
  return added
}

/**
 * 补录所有会话
 * @param {object} opts { root, maxAgeMs, groups }
 */
export async function backfill({ root, maxAgeMs = 6 * 3600 * 1000 } = {}) {
  const own = owner()
  if (!own) return { added: 0, error: '还没有 owner' }

  // 群里只补最近出现过的群，不主动扫描全部
  const groups = new Set()
  for (const e of readEvents(root)) {
    const g = e.meta?.qq?.groupId
    if (g) groups.add(String(g))
  }

  const k = known(root)
  const ws = connect()
  const opened = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 4000)
    ws.addEventListener('open', () => { clearTimeout(t); resolve(true) }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(t); resolve(false) }, { once: true })
  })
  if (!opened) { try { ws.close() } catch { /* ignore */ } return { added: 0, error: '连不上 NapCat' } }

  let added = 0
  try {
    added += await fill(ws, root, { kind: 'private', id: own, name: '主人', k, maxAgeMs })
    for (const g of groups) added += await fill(ws, root, { kind: 'group', id: g, name: '', k, maxAgeMs })
  } finally {
    try { ws.close() } catch { /* ignore */ }
  }
  return { added }
}

// CLI: node hands/history.mjs [--hours 24]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--hours')
  const hours = i > 0 ? Number(process.argv[i + 1]) || 6 : 6
  const root = path.join(HER, 'life')
  const r = await backfill({ root, maxAgeMs: hours * 3600 * 1000 })
  console.log(JSON.stringify(r))
}
