// hands/inbox-worker.mjs —— 常驻的"邮箱值班"：不靠会话，也不靠记性
//
// 为什么要有它（2026-10-30 08:47）：
//   她 00:18 替主人转的那条问题，从 00:18 一直躺到 08:45 —— 8 个半小时没人取。
//   根因不是锁，是**通道是拉式的**：DSH 不在会话里，就没人去看邮箱。
//   当时的临时办法是"我这个会话里每 30 分钟的定时器"——会话一关就没了。
//   所以做成常驻进程：跟 hands/qq.mjs 一样是她的一个手，boot.ps1 负责拉起。
//
// 它只做三件不需要"想"的事：
//   1. status / budget 类指令：用本地数据当场答（体检摘要、预算用量）；
//   2. 超过 30 分钟没人接的 question：直接发 QQ 告诉主人（报一次，不重复刷）；
//   3. 心跳 + 单飞锁：撞车的第二个进程安静退出。
//
// 它**不替 DSH 回答需要分析和改代码的问题**——那种只能等真人在。它只保证"不会无声堆着"。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pendingForDsh, answer } from '../lib/inbox.mjs'
import { claimSlot } from '../lib/singleton.mjs'
import { httpCreds, readOwner } from '../lib/owner.mjs'
import { splitMessage } from '../lib/split.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const ROOT = path.join(HER, 'life')
const LOG_DIR = process.env.DSH_HERSELF_LOG_DIR || path.join(HER, 'logs')
const STATE = path.join(LOG_DIR, 'inbox-worker.json')
const TICK_MS = Math.max(15_000, Number(process.env.DSH_INBOX_TICK_MS || 60_000))
const STALE_MS = Math.max(60_000, Number(process.env.DSH_INBOX_STALE_MS || 30 * 60_000))

const log = (msg, extra) => {
  const line = JSON.stringify({ at: new Date().toISOString(), msg, ...(extra ? { extra } : {}) })
  try { fs.appendFileSync(path.join(LOG_DIR, 'inbox-worker.log'), line + '\n') } catch { /* ignore */ }
}

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return { escalated: {} } } }
const writeState = (s) => { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)) } catch { /* ignore */ } }

const slot = claimSlot('inbox-worker')
if (!slot.ok) { console.log('已有一个 inbox-worker 在跑，退出'); process.exit(0) }
try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(path.join(LOG_DIR, 'heartbeat-inbox.txt'), new Date().toISOString()) } catch { /* ignore */ }
log('start', { pid: process.pid, tickMs: TICK_MS })

/** 秒答：这几类不需要人，本地数据就够（async 是因为要读事件流） */
async function quickAnswer(item) {
  try {
    if (item.kind === 'status') {
      const st = JSON.parse(fs.readFileSync(path.join(LOG_DIR, 'audit-status.json'), 'utf8'))
      return `体检 ${st.ok} 通过 / ${(st.warnings ?? []).length} 警告 / ${(st.problems ?? []).length} 问题`
    }
    if (item.kind === 'tools') {
      const tc = fs.readFileSync(path.join(HER, 'lib', 'toolcall.mjs'), 'utf8')
      const names = [...tc.matchAll(/name: '(\w+)',\s*\n\s*description:/g)].map((m) => m[1])
      return `我现在有 ${names.length} 只手：${names.join('、')}（详见 docs/SKILLS.md）`
    }
    if (item.kind === 'memory') {
      const { readEvents } = await import('../lib/store.mjs')
      const { derive } = await import('../lib/derive.mjs')
      const ev = readEvents(ROOT)
      const st2 = derive(ev, Date.now())
      return `事件 ${ev.length} 条｜第 ${st2.day} 天｜判断 ${st2.beliefs.filter((b) => b.status === 'active').length} 条活跃`
    }
    if (item.kind === 'changelog') {
      const doc = fs.readFileSync(path.join(HER, 'docs', 'CHANGES.md'), 'utf8')
      const heads = doc.split('\n').filter((l) => /^## \d{4}-/.test(l)).slice(-3)
      return `最近三条改动单：\n${heads.map((h) => '- ' + h.replace(/^## /, '')).join('\n')}`
    }
    if (item.kind === 'budget') {
      // 只报上限和当前会话的规则，不现算（现算要读全量事件，值班进程不该干这个）
      const rule = JSON.parse(fs.readFileSync(path.join(HER, 'sandbox', '预算规则.json'), 'utf8'))
      return `预算上限按 sandbox/预算规则.json：先砍 ${(rule.cutOrder ?? []).slice(0, 2).join(' → ') || '未设置'}；askBeforeCut=${rule.askBeforeCut}`
    }
  } catch (err) { return null }
  return null
}

async function notifyOwner(text) {
  const c = httpCreds(HER)
  const owner = readOwner(HER)
  if (!c || !owner) return false
  let ok = true
  for (const part of splitMessage(text)) {
    try {
      const r = await fetch(`${c.base}/send_private_msg`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
        body: JSON.stringify({ user_id: Number(owner), message: part }),
        signal: AbortSignal.timeout(20000),
      })
      const j = await r.json().catch(() => ({}))
      if (j.retcode !== 0) ok = false
    } catch { ok = false }
    await new Promise((res) => setTimeout(res, 800))
  }
  return ok
}

async function tick() {
  try { fs.writeFileSync(path.join(LOG_DIR, 'heartbeat-inbox.txt'), new Date().toISOString()) } catch { /* ignore */ }
  const pend = pendingForDsh(ROOT)
  const state = readState()

  for (const item of pend) {
    // 秒答类：答完就走（status/budget/tools/memory/changelog 都是本地能查的）
    if (['status', 'budget', 'tools', 'memory', 'changelog'].includes(item.kind)) {
      const body = await quickAnswer(item)
      if (body) { answer(ROOT, item.id, body); log('quick-answer', { id: item.id, kind: item.kind, body }); continue }
    }
    // 需要人答的：**立刻**报一次，之后每 30 分钟再提醒，最多 3 次
    // （2026-10-30 11:40：原来是等 30 分钟才报，主人说"我发的指令为什么没接"——
    //   等半小时才告诉他，等于没接。现在第一 tick 就报。）
    const ageMs = Date.now() - Date.parse(item.at)
    const prev = state.escalated[item.id]
    const prevAt = prev ? Date.parse(prev.at ?? prev) : 0
    const count = prev?.count ?? (prev ? 1 : 0)
    const due = !prev || (count < 3 && Date.now() - prevAt > 30 * 60_000)
    if (due) {
      const mins = Math.max(0, Math.round(ageMs / 60000))
      const ok = await notifyOwner(`【她投了一条，我这边还没人处理】${mins > 0 ? `挂了 ${mins} 分钟` : '刚到'}\n${String(item.text).slice(0, 300)}\n（要处理就开 DSH 说一句；id ${item.id}）`)
      if (ok) { state.escalated[item.id] = { at: new Date().toISOString(), count: count + 1 }; log('escalated', { id: item.id, mins, count: count + 1 }) }
    }
  }

  // 已答掉的从提醒记录里清掉，别让状态文件无限长
  const live = new Set(pend.map((x) => x.id))
  for (const id of Object.keys(state.escalated)) if (!live.has(id)) delete state.escalated[id]
  writeState(state)
}

await tick()
setInterval(() => { tick().catch((err) => log('tick-error', { err: String(err?.message ?? err) })) }, TICK_MS).unref?.()
// 保持进程活着：unref 之后 setInterval 不再撑住事件循环，用一次长 sleep 兜住
setInterval(() => { try { fs.writeFileSync(path.join(LOG_DIR, 'heartbeat-inbox.txt'), new Date().toISOString()) } catch { /* ignore */ } }, 60_000)
