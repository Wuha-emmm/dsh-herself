/**
 * index.js —— 插件服务端
 *
 * 只做三件事：
 *   1. 把她的派生状态暴露成 JSON（/dsh-herself/api/state）
 *   2. 提供登录/手的体检（/dsh-herself/api/browser）
 *   3. 给设置页一个手动入口（/dsh-herself/api/say）
 *
 * 不碰 DSH 凭据、不自铸 Cookie、不写 profile。内核在 ../../lib。
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { readEvents, appendEvent } from '../../lib/store.mjs'
import { derive, renderForSurface } from '../../lib/derive.mjs'
import { openLogin, listTabs } from '../../hands/login.mjs'
import { checkSessions } from '../../hands/session.mjs'
import { targetOf, sniffImage } from '../../lib/avatar.mjs'
import { effectivePrefs } from '../../lib/prefs.mjs'
import { buildLive, readTurn } from '../../lib/live.mjs'
import { log, buildStamp, logFile } from '../../lib/log.mjs'

export const name = 'dsh-herself'

// ⚠️ 必须是一个数组（dsh-fish 踩过：写成对象会静默丢服务）
export const inject = ['webServer']

const DEFAULT_ROOT = 'E:\\DSH-herself\\life'

// 整套东西的根（OneBot 运行时 / 常驻进程 / 日志都在这里）
const HER_ROOT = 'E:\\DSH-herself'
const PID_FILE = path.join(HER_ROOT, 'logs', 'pids.json')
const NAPCAT_SHELL = path.join(HER_ROOT, 'NapCat.Shell.Windows.OneKey', 'NapCat.52230.Shell')
const QR_FILE = path.join(NAPCAT_SHELL, 'versions', '9.9.33-52230', 'resources', 'app', 'napcat', 'cache', 'qrcode.png')
const WEBUI_CFG = path.join(NAPCAT_SHELL, 'versions', '9.9.33-52230', 'resources', 'app', 'napcat', 'config', 'webui.json')
const BRAIN_FILE = path.join(HER_ROOT, 'logs', 'brain.json')

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', (c) => {
      s += c
      if (s.length > 1_000_000) req.destroy()
    })
    req.on('end', () => resolve(s))
    req.on('error', reject)
  })
}

function alive(pid) {
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

/** 心跳文件是否新鲜（DSH 沙箱里 pid 探测不可靠） */
function fresh(file, ms = 90000) {
  try { return Date.now() - fs.statSync(path.join(HER_ROOT, 'logs', file)).mtimeMs < ms } catch { return false }
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host })
    const done = (v) => { try { s.destroy() } catch { /* ignore */ } resolve(v) }
    s.setTimeout(800)
    s.on('connect', () => done(true))
    s.on('error', () => done(false))
    s.on('timeout', () => done(false))
  })
}

function readPids() {
  try {
    // PowerShell 的 Set-Content -Encoding UTF8 会写 BOM，JSON.parse 会直接抛错
    const raw = fs.readFileSync(PID_FILE, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(raw)
  } catch { return {} }
}

async function napcatLogin() {
  let token = ''
  try { token = fs.readFileSync(path.join(HER_ROOT, 'secrets', 'onebot.token'), 'utf8').trim() } catch { return null }
  const ws = new WebSocket(`ws://127.0.0.1:3001/?access_token=${encodeURIComponent(token)}`)
  const info = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500)
    const finish = (v) => { clearTimeout(timer); resolve(v) }
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ action: 'get_login_info', echo: 'probe' })) } catch { finish(null) }
    })
    ws.addEventListener('message', (e) => {
      try {
        const r = JSON.parse(String(e.data))
        if (r.echo === 'probe') finish(r.data ?? null)
      } catch { /* ignore */ }
    })
    ws.addEventListener('error', () => finish(null))
  })
  try { ws.close() } catch { /* ignore */ }
  return info ? { uin: String(info.user_id ?? ''), nickname: info.nickname ?? '', online: true } : null
}

function qrImage() {
  try {
    const st = fs.statSync(QR_FILE)
    const b = fs.readFileSync(QR_FILE).toString('base64')
    const ageSec = Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000))
    return { data: `data:image/png;base64,${b}`, at: st.mtime.toISOString(), ageSec, stale: ageSec > 100 }
  } catch { return null }
}

function runPs(script, args = []) {
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HER_ROOT, script), ...args], { windowsHide: true })
    let out = ''
    const push = (d) => { out += String(d) }
    p.stdout?.on('data', push)
    p.stderr?.on('data', push)
    p.on('close', (code) => resolve({ code, out: out.slice(-1500) }))
    p.on('error', (e) => resolve({ code: -1, out: String(e.message) }))
  })
}

// ---------------------------------------------------------------- 她的嘴：走 DSH 自己的模型服务
async function llmComplete(ctx, { system = '', user = '', maxTokens = 600, temperature = 1, image = '' }) {
  const llm = ctx?.get?.('llm')
  if (!llm?.stream) throw new Error('DSH 的 llm 服务不可用')
  const sel = ctx?.get?.('agentDefaultModel')?.currentSelection?.()
  const provider = String(sel?.provider ?? '')
  const model = String(sel?.model ?? '')
  if (!provider || !model) throw new Error('读不到 DSH 的默认模型（设置 → 模型）')
  let text = ''
  const parts = [{ type: 'text', text: String(user ?? '') }]
  // 图片：拆成 { mediaType, base64 } 两段，AI SDK 认这个形状；裸 data URL 会被拒
  if (image) {
    // DeepSeek 走 Anthropic 兼容 /messages：图片要 source 对象（文档 2026-10）
    const raw = String(image)
    const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(raw)
    if (m) parts.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })
    else parts.push({ type: 'image', source: { type: 'url', url: raw } })
  }
  const stream = llm.stream({
    provider,
    model,
    system: String(system ?? ''),
    messages: [{ role: 'user', content: parts }],
    maxTokens: Math.max(64, Math.min(4000, Number(maxTokens) || 600)),
    temperature: Math.max(0, Math.min(2, Number(temperature) || 1)),
  })
  for await (const chunk of stream) {
    if (!chunk) continue
    if (chunk.type === 'text-delta' && chunk.text) text += chunk.text
    else if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
      throw new Error(chunk.reason?.failure?.message ?? '模型调用失败')
    }
  }
  return text.trim()
}

/** 本机回环小端点：给外部监听进程调用，带随机 token，不经过 DSH 登录态 */
function startBrain(ctx) {
  const token = crypto.randomBytes(16).toString('hex')
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      const body = JSON.stringify(obj)
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
      res.end(body)
    }
    if (req.headers['x-her-token'] !== token) return send(401, { ok: false, error: 'bad token' })
    if (req.method !== 'POST' || req.url !== '/think') return send(404, { ok: false, error: 'not found' })
    try {
      const raw = await readBody(req)
      const j = JSON.parse(raw || '{}')
      const text = await llmComplete(ctx, {
        system: j.system ?? '',
        user: j.user ?? '',
        maxTokens: j.maxTokens ?? 600,
        temperature: j.temperature ?? 1,
        image: j.image ?? '',
      })
      return send(200, { ok: true, text })
    } catch (err) {
      return send(500, { ok: false, error: String(err?.message ?? err) })
    }
  })
  server.on('error', (e) => log('plugin', 'brain server 出错', { err: String(e?.message ?? e) }))
  server.listen(0, '127.0.0.1', () => {
    try {
      fs.mkdirSync(path.join(HER_ROOT, 'logs'), { recursive: true })
      fs.writeFileSync(BRAIN_FILE, JSON.stringify({ port: server.address().port, token, at: new Date().toISOString() }))
    } catch { /* ignore */ }
  })
  return { close() { try { server.close() } catch { /* ignore */ } } }
}

export function apply(ctx, baseConfig = {}) {
  const root = baseConfig?.root || process.env.DSH_HERSELF_ROOT || DEFAULT_ROOT
  const brain = startBrain(ctx)
  // 现场：插件什么时候加载的、root 指哪、代码是哪一版。
  // 事故二是"boot.ps1 解析失败"，而错误只进了宿主 console——宿主不落盘，于是什么都没有。
  log('plugin', 'apply', { pid: process.pid, root, build: buildStamp() })

  // 她的命跟着 DSH：启动时拉起，之后每分钟巡检一次（只补缺，不重启活的）。
  // 进程是 DSH 的子进程，所以 DSH 退出时她会一起走——这正是期望的行为。
  let stackTimer = null
  const bootStack = (force = false) => {
    runPs('boot.ps1', force ? ['-Force'] : [])
      .then((r) => {
        if (r.code !== 0) {
          // 解析错误在 stderr，runPs 已经合并进 out；以前这句只 console.warn，等于没记。
          log('boot', 'boot.ps1 非零退出', { force, code: r.code, out: String(r.out ?? '').slice(-600) })
        }
      })
      .catch((err) => log('boot', 'boot.ps1 起不来', { force, err: String(err?.message ?? err) }))
  }
  try {
    // 第一次强制重启一次：把上一代遗留的孤儿进程收编成 DSH 的子进程
    bootStack(true)
    stackTimer = setInterval(() => bootStack(false), 60 * 1000)
    stackTimer.unref?.()
  } catch (err) {
    log('boot', 'stack timer 装不上', { err: String(err?.message ?? err) })
  }

  const webServer = ctx?.webServer
  if (!webServer?.register) {
    log('plugin', '没有 webServer，设置页路由未注册', {})
    return { dispose() { try { clearInterval(stackTimer) } catch { /* ignore */ } } }
  }

  const handler = async (req, res) => {
    let p = '/'
    try {
      p = new URL(req.url, 'http://127.0.0.1').pathname
    } catch { /* keep default */ }

    try {
      if (p === '/dsh-herself/api/pref' && req.method === 'POST') {
        try {
          const raw = await readBody(req)
          const b = JSON.parse(raw || '{}')
          if (!b.key) return sendJson(res, 400, { ok: false, error: 'key required' })
          appendEvent(root, {
            type: 'preference', actor: 'system', surface: 'dsh',
            text: b.by === 'owner' ? '他替我定了：' + b.key + '=' + b.value : String(b.key) + '=' + String(b.value),
            meta: { key: b.key, value: b.value, by: b.by ?? 'owner' },
          })
          return sendJson(res, 200, { ok: true })
        } catch (err) { return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) }) }
      }
      if (p === '/dsh-herself/api/live') {
        // 侧栏面板轮询用：只给摘要，reasoning 全文走 /turn
        const u = new URL(req.url, 'http://127.0.0.1')
        const limit = Math.max(10, Math.min(200, Number(u.searchParams.get('limit')) || 60))
        try {
          return sendJson(res, 200, buildLive(root, { limit }))
        } catch (err) { return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) }) }
      }
      if (p === '/dsh-herself/api/avatar') {
        // 头像代理：同源取图 + 磁盘缓存 7 天。
        // 为什么不让浏览器直连腾讯 CDN：页面有 CSP，跨域图会被拦；而且失败就是破图。
        const u = new URL(req.url, 'http://127.0.0.1')
        // ?self=1 表示她自己：QQ 号由 listener 收到 lifecycle 时写进 logs/self.json
        let uinQ = u.searchParams.get('uin') || ''
        if (u.searchParams.get('self')) {
          try { uinQ = String(JSON.parse(fs.readFileSync(path.join(path.dirname(logFile), 'self.json'), 'utf8')).self ?? '') } catch { uinQ = '' }
        }
        const t = targetOf({ uin: uinQ, group: u.searchParams.get('group') || '' })
        if (!t.ok) return sendJson(res, 400, { ok: false, error: t.error })
        try {
          const dir = path.join(path.dirname(logFile), 'avatar-cache')
          fs.mkdirSync(dir, { recursive: true })
          const file = path.join(dir, t.key + '.img')
          const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86400000
          if (fresh) {
            const buf = fs.readFileSync(file)
            res.writeHead(200, { 'content-type': sniffImage(buf) || 'image/jpeg', 'cache-control': 'private, max-age=86400' })
            return res.end(buf)
          }
          const r = await fetch(t.url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'herself/1.0' } })
          if (!r.ok) return sendJson(res, 502, { ok: false, error: 'CDN 回了 ' + r.status })
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.length < 64) return sendJson(res, 502, { ok: false, error: '图太小，可能不是头像' })
          fs.writeFileSync(file, buf)
          res.writeHead(200, { 'content-type': sniffImage(buf) || 'image/jpeg', 'cache-control': 'private, max-age=86400' })
          return res.end(buf)
        } catch (err) {
          return sendJson(res, 502, { ok: false, error: String(err?.message ?? err) })
        }
      }
      if (p === '/dsh-herself/api/turn') {
        // 点开某一轮时拉全文：她看到的事实 / 检索命中的分数 / 工具 / reasoning
        // 英文腹稿在这里按需翻成中文（翻过就缓存，点第二次不再花钱）
        const u = new URL(req.url, 'http://127.0.0.1')
        const t = await readTurn(root, String(u.searchParams.get('id') ?? ''))
        if (!t) return sendJson(res, 404, { ok: false, error: '这一轮没有记录（面板上线之前的回合补不回来）' })
        return sendJson(res, 200, { ok: true, turn: t })
      }
      if (p === '/dsh-herself/api/state') {
        const events = fs.existsSync(root) ? readEvents(root) : []
        const self = derive(events, Date.now())
        return sendJson(res, 200, {
          ok: true,
          root,
          born: events.some((e) => e.type === 'seed'),
          day: self.day,
          stage: self.stage,
          gates: self.gates,
          nextGate: self.nextGate,
          counts: self.counts,
          refuted: self.refuted,
          narrative: self.narrative,
          beliefs: self.beliefs.slice(-5),
          readings: self.readingList ?? [],
          candidateStances: self.candidateStances ?? [],
          wake: (() => {
            try { return JSON.parse(fs.readFileSync(path.join(HER_ROOT, 'life', 'wake-state.json'), 'utf8')) } catch { return null }
          })(),
          prefs: (() => {
            try {
              const p = effectivePrefs(events)
              return { ...p.prefs, sources: p.sources }
            } catch { return null }
          })(),
          recent: events.slice(-8).map((e) => ({
            type: e.type,
            text: String(e.text ?? '').slice(0, 160),
            ts: e.ts,
            surface: e.surface,
          })),
        })
      }

      if (p === '/dsh-herself/api/stack') {
        const pids = readPids()
        const ws = await portOpen(3001)
        const login = ws ? await napcatLogin() : null
        let wakeState = null
        try { wakeState = JSON.parse(fs.readFileSync(path.join(HER_ROOT, 'life', 'wake-state.json'), 'utf8')) } catch { /* 还没醒过 */ }
        return sendJson(res, 200, {
          ok: true,
          napcat: { ws, online: Boolean(login?.online ?? login?.uin), account: login?.uin ?? null, nickname: login?.nickname ?? null },
          listener: { pid: pids.qq ?? null, alive: fresh('heartbeat-qq.txt') || alive(pids.qq) },
          wake: { pid: pids.wake ?? null, alive: fresh('heartbeat-wake.txt') || alive(pids.wake), state: wakeState },
          qr: ws && !login ? qrImage() : null,
        })
      }

      if (p === '/dsh-herself/api/stack/start' && req.method === 'POST') {
        // 她跟着 DSH 活：直接起，进程在 DSH 树下，DSH 关她关
        const r = await runPs('boot.ps1', ['-Force'])
        return sendJson(res, 200, { ok: r.code === 0, out: r.out || '已启动' })
      }

      if (p === '/dsh-herself/api/stack/stop' && req.method === 'POST') {
        const r = await runPs('stop-her.ps1')
        return sendJson(res, 200, { ok: r.code === 0, ...r })
      }

      if (p === '/dsh-herself/api/login/open' && req.method === 'POST') {
        const raw = await readBody(req)
        let platform = ''
        try { platform = String(JSON.parse(raw || '{}').platform ?? '') } catch { /* ignore */ }
        try {
          const r = await openLogin(platform)
          return sendJson(res, 200, r)
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: String(err?.message ?? err) })
        }
      }

      if (p === '/dsh-herself/api/login/tabs') {
        return sendJson(res, 200, { ok: true, tabs: await listTabs() })
      }

      if (p === '/dsh-herself/api/health') {
        const pids = readPids()
        let brain = null
        try {
          const b = JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8'))
          brain = { port: b.port, ok: await portOpen(b.port) }
        } catch { /* 没有 brain */ }
        const login = await napcatLogin()
        const wsOk = await portOpen(3001)
        let cdp = false
        try {
          const r = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1200) })
          cdp = r.ok
        } catch { /* ignore */ }
        let lastError = ''
        try {
          const lines = fs.readFileSync(path.join(HER_ROOT, 'logs', 'qq.err.log'), 'utf8').trim().split('\n').filter(Boolean)
          lastError = lines[lines.length - 1] ?? ''
        } catch { /* ignore */ }
        return sendJson(res, 200, {
          ok: true,
          brain,
          qq: { ws: wsOk, online: Boolean(login?.uin), account: login?.uin ?? null },
          edge: { cdp },
          listener: { alive: fresh('heartbeat-qq.txt') || alive(pids.qq), pid: pids.qq ?? null },
          wake: { alive: fresh('heartbeat-wake.txt') || alive(pids.wake), pid: pids.wake ?? null },
          lastError: String(lastError).slice(0, 200),
        })
      }

      if (p === '/dsh-herself/api/sessions') {
        try {
          const r = await checkSessions()
          return sendJson(res, 200, r)
        } catch (err) {
          return sendJson(res, 200, { ok: false, error: String(err?.message ?? err), platforms: {} })
        }
      }

      if (p === '/dsh-herself/api/browser') {
        let cdp = false
        let version = null
        try {
          const r = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1500) })
          if (r.ok) {
            cdp = true
            version = (await r.json()).Browser ?? null
          }
        } catch { /* 没开就是没开 */ }
        return sendJson(res, 200, {
          ok: true,
          cdp,
          version,
          profile: 'E:\\DSH-herself\\profile\\edge',
          platforms: [
            { id: 'bili', name: 'B站', url: 'https://www.bilibili.com' },
            { id: 'qzone', name: 'QQ空间', url: 'https://user.qzone.qq.com' },
            { id: 'xhs', name: '小红书', url: 'https://www.xiaohongshu.com' },
            { id: 'xhh', name: '小黑盒', url: 'https://www.xiaoheihe.cn' },
          ],
        })
      }

      if (p === '/dsh-herself/api/render') {
        const surface = new URL(req.url, 'http://127.0.0.1').searchParams.get('surface') || 'dsh'
        const events = fs.existsSync(root) ? readEvents(root) : []
        return sendJson(res, 200, { ok: true, surface, text: renderForSurface(events, surface) })
      }

      if (p === '/dsh-herself/api/forget' && req.method === 'POST') {
        const raw = await readBody(req)
        let id = ''
        let reason = '读错了'
        try {
          const j = JSON.parse(raw || '{}')
          id = String(j.id ?? '')
          reason = String(j.reason ?? '读错了').slice(0, 80)
        } catch { /* ignore */ }
        if (!id) return sendJson(res, 400, { ok: false, error: '缺少 id' })
        const events = fs.existsSync(root) ? readEvents(root) : []
        if (!events.some((e) => e.id === id)) return sendJson(res, 404, { ok: false, error: '找不到这条' })
        const ev = appendEvent(root, { type: 'tombstone', actor: 'system', surface: 'system', text: reason, refs: [id] })
        return sendJson(res, 200, { ok: true, tombstone: ev.id })
      }

      if (p === '/dsh-herself/api/say' && req.method === 'POST') {
        const raw = await readBody(req)
        let text = ''
        try { text = String(JSON.parse(raw || '{}').text ?? '').trim() } catch { /* ignore */ }
        if (!text) return sendJson(res, 400, { ok: false, error: 'text 不能为空' })
        const ev = appendEvent(root, { type: 'utterance', actor: 'self', text, surface: 'dsh' })
        return sendJson(res, 200, { ok: true, id: ev.id })
      }

      return sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
  }

  let dispose = null
  try {
    dispose = webServer.register({
      kind: 'prefix',
      path: '/dsh-herself/api',
      handler,
    })
  } catch (err) {
    log('plugin', '路由注册失败（设置页会没数据，但插件不挂）', { err: String(err?.message ?? err) })
  }

  return {
    dispose() {
      try { clearInterval(stackTimer) } catch { /* ignore */ }
      try { brain.close() } catch { /* ignore */ }
      try {
        if (typeof dispose === 'function') dispose()
        else dispose?.dispose?.()
      } catch { /* ignore */ }
      // 跟着 DSH 一起死：停监听、生物钟和 SnowLuma（脚本只碰 her 自己的进程）
      try {
        // 插件是 ESM，没有 require；用动态 import
        import('node:child_process').then(({ spawn }) => {
          const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HER_ROOT, 'stop-her.ps1')], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          })
          child.unref()
        }).catch(() => { /* ignore */ })
      } catch { /* ignore */ }
    },
  }
}
