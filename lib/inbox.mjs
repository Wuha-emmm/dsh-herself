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

const FILE = 'inbox.jsonl'
const STATE = 'inbox-state.json'

const fileOf = (root) => path.join(root, FILE)
const stateOf = (root) => path.join(root, STATE)

/** 投一条。from: her | dsh | owner；kind: question | answer | order */
export function post(root, { from, kind, text, ref = '' }) {
  const t = String(text ?? '').trim()
  if (!from || !t) throw new Error('投递要有 from 和内容')
  const entry = {
    id: `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    from,
    kind: kind || (from === 'her' ? 'question' : 'answer'),
    text: t,
    ...(ref ? { ref } : {}),
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
  const list = all(root).filter((e) => e.from !== 'her')
  // 按"最后看过的 id"切，不用时间戳：同一毫秒里投两条不会互相吃掉
  const idx = seenId ? list.findIndex((e) => e.id === seenId) : -1
  return idx >= 0 ? list.slice(idx + 1) : list
}

/** DSH 还没处理的：她投的问题 */
export function pendingForDsh(root) {
  const seen = readState(root).dshSeenAt || ''
  return all(root).filter((e) => e.from === 'her' && e.at > seen)
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
  const clip = (t) => {
    const s = String(t ?? '')
    if (s.length <= 200) return s
    // 不许切在半句：找最后一个句末标点
    const cut = Math.max(s.lastIndexOf('。', 200), s.lastIndexOf('！', 200), s.lastIndexOf('？', 200))
    return cut > 40 ? s.slice(0, cut + 1) : s.slice(0, 200) + '。'
  }
  return 'DSH 那边回你话了：' + list.map((e) => `（${who[e.from] ?? e.from}）${clip(e.text)}`).join('；')
}
/** DS/主人说的话，额外抄一份到她沙盒里——她说过「DS 的话没落进任何我能读的文件里」 */
export function mirrorToHer(root, entry) {
  try {
    const dir = path.join(root, '..', 'sandbox')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'DSH-回话.md')
    const head = fs.existsSync(f) ? '' : '# DSH 回给她的（她可以随时翻）\n\n'
    const when = String(entry.at ?? '').slice(5, 16).replace('T', ' ')
    fs.appendFileSync(f, head + `## ${when}（${entry.from}）\n\n${entry.text}\n\n`, 'utf8')
    return f
  } catch { return '' }
}