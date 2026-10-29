// wake.mjs —— 她自己的时间：到点醒一次，说一句；可选发给你
//
// 节奏不是写死的：默认值在 lib/prefs.mjs 的 DEFAULTS，
// 她自己说过的偏好（preference 事件）会覆盖它，只有 HARD 护栏不可越过。
//
// 用法：
//   node wake.mjs --once            # 立刻醒一次（不发 QQ）
//   node wake.mjs --once --send     # 立刻醒一次并发给主人
//   node wake.mjs                   # 常驻：每 10 分钟检查一次
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { thinkAloud } from './lib/think.mjs'
import { effectivePrefs, DEFAULTS } from './lib/prefs.mjs'
import { readEvents, appendEvent } from './lib/store.mjs'
import { maybeClose } from './lib/summary.mjs'
import { claimSlot } from './lib/singleton.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(process.env.DSH_HERSELF_ROOT || path.join(here, 'life'))
const STATE = path.join(ROOT, 'wake-state.json')
const LOG = path.join(here, 'logs', 'wake.log')
const HEARTBEAT = path.join(here, 'logs', 'heartbeat-wake.txt')

function beat() {
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true })
    fs.writeFileSync(HEARTBEAT, new Date().toISOString())
  } catch { /* ignore */ }
}

function log(line) {
  const s = `[${new Date().toISOString().slice(0, 19)}] ${line}`
  console.log(s)
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, s + '\n') } catch { /* ignore */ }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return {} }
}
function writeState(s) {
  try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2)) } catch { /* ignore */ }
}

function ownerQQ() {
  try { return String(JSON.parse(fs.readFileSync(path.join(here, 'secrets', 'qq.json'), 'utf8')).owner ?? '') } catch { return '' }
}

// 本地日期（不能用 toISOString：那是 UTC 日，和面板/用户感知差 8 小时）
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 她现在的作息：默认 + 她自己定的（夹在护栏里） */
function prefsNow() {
  try {
    const { prefs, sources } = effectivePrefs(readEvents(ROOT))
    return { prefs, sources }
  } catch {
    return { prefs: { ...DEFAULTS }, sources: [] }
  }
}

function due(now = new Date()) {
  const { prefs, sources } = prefsNow()
  const st = readState()
  const day = today()
  const count = st.day === day ? Number(st.count || 0) : 0
  const sent = st.day === day ? Number(st.sent || 0) : 0
  const lastAt = st.lastAt ? Date.parse(st.lastAt) : 0
  const h = now.getHours()
  const who = sources.length ? `她定的 ${prefs.fromHour}-${prefs.toHour} 点` : `默认 ${prefs.fromHour}-${prefs.toHour} 点`
  if (h < prefs.fromHour || h >= prefs.toHour) return { ok: false, why: `不在她的时间窗口（${who}）` }
  if (count >= prefs.maxPerDay) return { ok: false, why: `今天已经 ${count} 次（她定 ${prefs.maxPerDay}）` }
  if (lastAt && now.getTime() - lastAt < prefs.minGapMin * 60000) return { ok: false, why: `离上次不到 ${prefs.minGapMin} 分钟` }
  return { ok: true, count, sent, day, prefs, sources }
}

export async function wakeOnce({ send: doSend = false } = {}) {
  const gate = due()
  if (!gate.ok) { log(`跳过：${gate.why}`); return null }

  const r = await thinkAloud({ root: ROOT, toOwner: doSend })
  log(`她说：${r.text}`)

  const st = readState()
  const day = today()
  const count = st.day === day ? Number(st.count || 0) : 0
  const sent = st.day === day ? Number(st.sent || 0) : 0
  const next = { day, count: count + 1, sent, lastAt: new Date().toISOString() }

  // 主动发几条由她定（默认 1），但每天最多 HARD.sendPerDay 条
  if (doSend && sent < gate.prefs.sendPerDay) {
    const owner = ownerQQ()
    if (owner) {
      const { send } = await import('./hands/qq.mjs')
      try {
        await send('private', owner, r.text)
        next.sent = sent + 1
        log(`已发给主人 ${owner}`)
      } catch (err) {
        log(`发送失败：${err?.message ?? err}`)
      }
    }
  }
  writeState(next)
  beat()
  return r
}

/**
 * 她自己决定要不要发空间说说。
 * 每天最多问一次；她说「不想发」就记下来，不再打扰。
 */
export async function maybePost({ dry = false, force = false } = {}) {
  const st = readState()
  const day = today()
  if (!force && st.postDay === day) return { skipped: '今天已经问过' }

  const { prefs } = prefsNow()
  const h = new Date().getHours()
  if (!force && (h < prefs.fromHour || h >= prefs.toHour)) return { skipped: '不在她的时间窗口' }

  const last = st.postAt ? Date.parse(st.postAt) : 0
  if (!force && last && Date.now() - last < 20 * 3600 * 1000) return { skipped: '离上次发说说不到 20 小时' }

  const r = await thinkAloud({
    root: ROOT,
    record: false,   // 这是内部决策，不是她想说的话，不进事件流
    purpose: '你可以在 QQ 空间发一条说说（公开，好友能看到）。想说就写正文；不想发就只回「不想发」。',
  })
  const decline = /^\s*(不想发|不发|算了|没什么想发)/.test(r.text)
  if (dry) return { decline, text: r.text, posted: false }

  const next = { ...st, postDay: day }
  if (decline) {
    writeState(next)
    log('今天不打算发说说')
    return { decline: true }
  }

  const { publish } = await import('./hands/qzone.mjs')
  let result = null
  try { result = await publish(r.text) } catch (err) { result = { ok: false, error: String(err?.message ?? err) } }
  try {
    appendEvent(ROOT, {
      type: 'action',
      actor: 'system',
      surface: 'qzone',
      text: `发说说：${String(r.text).slice(0, 60)}`,
      meta: { action: 'qzone-post', ok: Boolean(result?.ok), tid: result?.tid ?? null },
    })
  } catch { /* ignore */ }
  next.postAt = new Date().toISOString()
  writeState(next)
  log(result?.ok ? `发了说说：${String(r.text).slice(0, 40)}` : `发说说失败：${JSON.stringify(result).slice(0, 160)}`)
  return result
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const once = process.argv.includes('--once')
  const doSend = process.argv.includes('--send')
  const postNow = process.argv.includes('--post')
  const postDry = process.argv.includes('--post-dry')
  if (postNow || postDry) {
    const r = await maybePost({ dry: postDry, force: true })
    log(`发说说决策：${JSON.stringify(r).slice(0, 200)}`)
  } else if (once) {
    await wakeOnce({ send: doSend })
  } else {
    // 一个角色一个进程：撞车的那个安静退出
    const slot = claimSlot('wake')
    if (!slot.ok) { log(`已经有一个 wake 在跑（pid ${slot.pid ?? '?'}），这个退出`); process.exit(0) }
    const { prefs, sources } = prefsNow()
    log(`常驻启动：${prefs.fromHour}-${prefs.toHour} 点，日上限 ${prefs.maxPerDay}，间隔 ${prefs.minGapMin} 分，主动发 ${prefs.sendPerDay} 条${sources.length ? `（其中 ${sources.length} 条是她自己定的）` : '（全部是默认值）'}`)
    beat()
    setInterval(beat, 20000)
    const tick = async () => {
      try { await wakeOnce({ send: doSend }) } catch (err) { log(`出错：${err?.message ?? err}`) }
      try { await maybePost() } catch (err) { log(`发说说出错：${err?.message ?? err}`) }
      try { const n = await maybeClose(ROOT); if (n) log(`收了 ${n} 段对话的尾`) } catch (err) { log(`收尾出错：${err?.message ?? err}`) }
    }
    await tick()
    setInterval(tick, 10 * 60 * 1000)
  }
}
