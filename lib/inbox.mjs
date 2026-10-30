// lib/inbox.mjs —— 她 ↔ DSH 的投递口
//
// 她要的链路（2026-10-30 00:28）：
//   她发现问题 → 投给 DSH → DSH 分析代码给出解释 → 她收到 → 转给主人
//   → 主人下指令 → 传回 DSH
//
// 做法：一个 append-only 的邮箱（life/inbox.jsonl）。
// 她是独立进程、DSH 是另一个进程，文件是两边都能碰的唯一公共介质。
// 谁读过记在 life/inbox-state.json：她只看到"还没看过的"。
import fs from 'node:fs'
import path from 'node:path'
import { bj } from './timefmt.mjs'

const FILE = 'inbox.jsonl'
const STATE = 'inbox-state.json'

const fileOf = (root) => path.join(root, FILE)
const stateOf = (root) => path.join(root, STATE)

/** 投一条。from: her | dsh | owner；kind: question | answer | order */
export function post(root, { from, kind, text, ref = '', source = null }) {
  const t = String(text ?? '').trim()
  if (!from || !t) throw new Error('投递要有 from 和内容')
  // source：这条问题是谁通过她发出来的（DSH 侧二次判定用）
  const entry = {
    id: `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    from,
    kind: kind || (from === 'her' ? 'question' : 'answer'),
    text: t,
    ...(ref ? { ref } : {}),
    ...(source ? { source } : {}),
  }
  fs.mkdirSync(root, { recursive: true })
  fs.appendFileSync(fileOf(root), JSON.stringify(entry) + '\n', 'utf8')
  if (from !== 'her') mirrorToHer(root, entry)
  return entry
}

export function all(root) {
  try {
    return fs.readFileSync(fileOf(root), 'utf8').trim().split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

/** 她还没看过的：来自 dsh / owner 的条目 */
export function pendingForHer(root) {
  const seenId = readState(root).herSeenId || ''
  const list = all(root).filter((e) => e.from !== 'her' && e.kind !== 'claim')
  // 按"最后看过的 id"切，不用时间戳：同一毫秒里投两条不会互相吃掉
  const idx = seenId ? list.findIndex((e) => e.id === seenId) : -1
  return idx >= 0 ? list.slice(idx + 1) : list
}

/** DSH 还没处理的：她投的问题 */
export function pendingForDsh(root) {
  const last = new Map()
  for (const e of all(root)) {
    if (e.kind === 'claim' || e.kind === 'answer' || e.kind === 'release') last.set(e.ref, e.kind)
  }
  return all(root).filter((e) => e.from === 'her' && ['question', 'status', 'budget'].includes(e.kind) && (!last.has(e.id) || last.get(e.id) === 'release'))
}

export function readState(root) {
  try { return JSON.parse(fs.readFileSync(stateOf(root), 'utf8')) } catch { return {} }
}

export function markSeen(root, who) {
  const st = readState(root)
  if (who === 'her') {
    const list = all(root).filter((e) => e.from !== 'her')
    st.herSeenId = list.length ? list[list.length - 1].id : (st.herSeenId || '')
  } else {
    const list = all(root).filter((e) => e.from === 'her')
    st.dshSeenId = list.length ? list[list.length - 1].id : (st.dshSeenId || '')
  }
  fs.writeFileSync(stateOf(root), JSON.stringify(st, null, 2), 'utf8')
}

/**
 * 她在提示词里看到的那一行。没东西就返回空串（不占地方）。
 */
export function inboxLine(root, { max = 2 } = {}) {
  const list = pendingForHer(root).slice(-max)
  if (!list.length) return ''
  const who = { dsh: 'DSH', owner: '主人' }
  // 她不要"结论"，要过程。所以：
  //   短的（≤200 字）直接给她看全；
  //   长的**不截断**，改成指路——指出全文在哪一节，她自己 fs_read 去翻。
  const say = (e) => {
    const t = String(e.text ?? '')
    if (t.length <= 200) return `（${who[e.from] ?? e.from}）${t}`
    const when = bj(e.at)
    const cut = Math.max(t.indexOf('。', 0), t.indexOf('！', 0), t.indexOf('？', 0))
    const head = cut > 0 && cut < 60 ? t.slice(0, cut + 1) : t.slice(0, 30) + '…'
    return `（${who[e.from] ?? e.from}）有一条长的，全文在 sandbox/DSH-回话.md 的「${when}」那节，你自己翻；第一句是：${head}`
  }
  return 'DSH 那边回你话了：' + list.map(say).join('；')
}
/** DS/主人说的话，额外抄一份到她沙盒里——她说过「DS 的话没落进任何我能读的文件里」 */
export function mirrorToHer(root, entry) {
  try {
    const dir = path.join(root, '..', 'sandbox')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'DSH-回话.md')
    const head = fs.existsSync(f) ? '' : '# DSH 回给她的（她可以随时翻）\n\n'
    const when = bj(entry.at) + '（北京）'
    fs.appendFileSync(f, head + `## ${when}（${entry.from}）\n\n${entry.text}\n\n`, 'utf8')
    return f
  } catch { return '' }
}
/**
 * 一次只处理一条：DS 这边"领走"一条就上锁，别人（或另一个自己）不会再领。
 *
 * 为什么需要：她投一条问题，我这边可能看两次；两个 DS 会话也可能同时开工。
 * 重复执行比漏执行更糟——她会收到两份不同措辞的答案。
 * 锁也走 append-only：领一条就写一条 claim，处理完写 answer，锁自然解开。
 * 崩溃了没写 answer：超过 CLAIM_TTL_MS 视为失效，可以重领。
 */
export const CLAIM_TTL_MS = 10 * 60 * 1000

/** 当前有没有"领了还没答"的活 */
export function openClaim(root, now = Date.now()) {
  const list = all(root)
  const idxOf = new Map(list.map((e, i) => [e.id, i]))
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const c = list[i]
    if (c.kind !== 'claim' || !c.ref) continue
    // 关掉它的那条必须在它**后面**（按行序，不按时间：同一毫秒会判错）
    const closed = list.some((e, j) => j > i && e.ref === c.ref && (e.kind === 'answer' || e.kind === 'release'))
    if (closed) continue
    const age = now - (Date.parse(c.at) || 0)
    if (age > CLAIM_TTL_MS) continue      // 僵尸锁：可以重领
    return { ref: c.ref, at: c.at, ageMs: age }
  }
  return null
}

/**
 * 领下一条待处理的问题。返回 { ok:true, item } 或 { ok:false, busy } / { ok:false, empty }。
 */
export function claimNext(root, { now = Date.now(), text = '' } = {}) {
  const busy = openClaim(root, now)
  if (busy) return { ok: false, busy }
  const lastKind = new Map()
  for (const e of all(root)) {
    if (e.kind === 'claim' || e.kind === 'answer' || e.kind === 'release') lastKind.set(e.ref, e.kind)
  }
  // release 之后算"没领过"；claim/answer 之后才算被占用
  const avail = (id) => !lastKind.has(id) || lastKind.get(id) === 'release'
  const next = all(root).filter((e) => e.from === 'her' && ['question', 'status', 'budget'].includes(e.kind) && avail(e.id))[0]
  if (!next) return { ok: false, empty: true }
  const c = post(root, { from: 'dsh', kind: 'claim', ref: next.id, text: text || `领走：${next.text.slice(0, 40)}` })
  return { ok: true, item: next, claim: c }
}

/** 答完一条（写 answer 就等于解锁） */
/**
 * 答复 + （来源是主人私聊时）转发到他 QQ。
 * 2026-10-30：转发原来只在 tools/inbox.mjs 里，用库直调 answer() 就静默不转发——
 * 和"改动单+通知"是同一个教训：两半必须在一个动作里。
 */
async function relayAnswer(root, ref, text) {
  try {
    const q = all(root).find((x) => x.id === ref)
    const src = q?.source
    if (!src || src.isOwner === false) return
    if (!String(src.thread ?? '').startsWith('qq:private:')) return
    const { httpCreds, readOwner } = await import('./owner.mjs')
    const { splitMessage } = await import('./split.mjs')
    const c = httpCreds(String(root).replace(/[\\/]life$/, ''))
    const owner = readOwner(String(root).replace(/[\\/]life$/, ''))
    if (!c || !owner) return
    for (const part of splitMessage('DSH 那边回她了（她转过来）：\n\n' + text)) {
      await fetch(`${c.base}/send_private_msg`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
        body: JSON.stringify({ user_id: Number(owner), message: part }),
        signal: AbortSignal.timeout(20000),
      }).catch(() => null)
    }
  } catch { /* 转发失败不影响答复本身 */ }
}

export function answer(root, ref, text) {
  if (!all(root).some((e) => e.id === ref)) throw new Error('没有这条：' + ref)
  const e = post(root, { from: 'dsh', kind: 'answer', ref, text })
  relayAnswer(root, ref, text).catch(() => {})
  return e
}

/** 处理不了就放回去，让别人/下一轮再领 */
export function release(root, ref, why = '') {
  if (!all(root).some((e) => e.id === ref)) throw new Error('没有这条：' + ref)
  return post(root, { from: 'dsh', kind: 'release', ref, text: why || '放回去' })
}
