// hands/qq.mjs —— 她的一只手：OneBot v11 客户端（默认连 SnowLuma；NapCat 只作回滚）
// 用法：
//   node hands/qq.mjs listen            # 收消息 → 写进事件流
//   node hands/qq.mjs send private 123 "…"
//   node hands/qq.mjs send group 456 "…"
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appendEvent, readEvents } from '../lib/store.mjs'
import { think } from '../lib/think.mjs'
import { claimSlot } from '../lib/singleton.mjs'
import { splitMessage } from '../lib/split.mjs'
import { claimBrain, heartbeatBrain } from '../lib/brain.mjs'
import { log, buildStamp } from '../lib/log.mjs'
import { nextWait, composeUserText, MIN_GAP_MS } from '../lib/batch.mjs'
import { forwardIdIn } from '../lib/forward.mjs'
import { redact } from '../lib/outbound.mjs'
import { backfill } from './history.mjs'
import { onebot } from './qzone.mjs'
import { describe } from '../lib/vision.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const selfFile = path.join(here, '..', 'logs', 'self.json')
const ROOT = path.resolve(process.env.DSH_HERSELF_ROOT || path.join(here, '..', 'life'))
const TOKEN_FILE = path.join(here, '..', 'secrets', 'onebot.token')
const BASE = 'ws://127.0.0.1:3001'

function token() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() } catch { return '' }
}

/** 从 OneBot 消息段里取纯文本 */
function textOf(message) {
  if (typeof message === 'string') return message
  if (!Array.isArray(message)) return ''
  return message.map((seg) => {
    if (seg.type === 'text') return seg.data?.text ?? ''
    if (seg.type === 'image') return '[图片]'
    if (seg.type === 'face') return '[表情]'
    if (seg.type === 'record') {
      // 语音段：带上时长；file id 由 recordMessage 单独存进 meta（不塞进正文）
      const sec = Number(seg.data?.duration ?? 0)
      return sec ? '[语音 ' + Math.round(sec) + 's]' : '[语音]'
    }
    if (seg.type === 'forward') return '[转发]'   // 让她至少知道有一段记录可以展开
    if (seg.type === 'at') return `@${seg.data?.qq ?? ''}`
    return ''
  }).join('').trim()
}

function open() {
  const t = token()
  const url = t ? `${BASE}/?access_token=${encodeURIComponent(t)}` : BASE
  return new WebSocket(url)
}

/** 收藏表情 → OneBot image 段（mface 三元组在的时候带上，客户端才当表情而不是图片） */
export function stickerSegment(s) {
  const data = { file: String(s?.url ?? '') }
  if (s?.packageId && s?.key) {
    data.emoji_id = s.emojiId
    data.emoji_package_id = s.packageId
    data.key = s.key
  }
  return [{ type: 'image', data }]
}

/** 往某个会话发一个收藏表情（她的 send_sticker 工具走这里） */
export async function sendStickerTo(kind, target, s) {
  return onebot(kind === 'group' ? 'send_group_msg' : 'send_private_msg',
    kind === 'group'
      ? { group_id: Number(target), message: stickerSegment(s) }
      : { user_id: Number(target), message: stickerSegment(s) })
}

/**
 * 只按「结构上一定是系统消息」的写法判，不按"像公告的词"判。
 * 教训（2026-10-29）：有个群员昵称就叫「ⓘ 该群聊涉嫌违规，已被停用。」，
 * 按文本关键词过滤会把他的话误杀——系统公告应该看 post_type/sub_type，不是看字面。
 */
const SYSTEM_NOTICE_RE = /(撤回了一条消息|加入了群聊|退出了群聊|被管理员禁言|被解除禁言|群公告：|该消息已被撤回|消息已过期)/

function isSystemNotice(text, ev) {
  if (ev?.post_type && ev.post_type !== 'message') return true
  if (ev?.message_type === 'group' && ev?.sub_type && ev.sub_type !== 'normal') return true
  if (SYSTEM_NOTICE_RE.test(text)) return true
  if (/^\[(图片|表情|语音|视频|文件)\]$/.test(text)) return true
  return false
}

/** 心跳：让面板知道这个进程还活着（DSH 沙箱里 process.kill(pid,0) 不可靠） */
const HEARTBEAT = path.join(process.env.DSH_HERSELF_LOG_DIR || path.join(here, '..', 'logs'), 'heartbeat-qq.txt')
function beat() {
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true })
    fs.writeFileSync(HEARTBEAT, new Date().toISOString())
  } catch { /* ignore */ }
}

/** 把一条 QQ 消息写进事件流 */
export function recordMessage(ev, { root = ROOT } = {}) {
  const selfId = String(ev.self_id ?? '')
  const senderId = String(ev.sender?.user_id ?? ev.user_id ?? '')
  const isSelf = senderId === selfId
  const text = textOf(ev.message)
  // 语音段原样留下：file / url / duration 都在里面
  const voiceSeg = (Array.isArray(ev.message) ? ev.message.find((s) => s.type === 'record')?.data : null) ?? null
  if (!text) return null
  if (isSystemNotice(text, ev)) return null

  // 同一条 QQ 消息只记一次：万一又起了两个进程，这是第二道闸
  if (ev.message_id) {
    const dup = readEvents(root).slice(-400).some((e) => e.meta?.qq?.messageId === ev.message_id)
    if (dup) return null
  }

  const isPrivate = ev.message_type === 'private'
  const groupId = isPrivate ? '' : String(ev.group_id ?? '')
  const sender = isSelf ? (ev.sender?.card || ev.sender?.nickname || '她') : (ev.sender?.card || ev.sender?.nickname || senderId)

  const event = appendEvent(root, {
    type: isPrivate ? 'encounter' : 'encounter',
    actor: isSelf ? 'self' : `other:qq_${senderId}`,
    surface: 'qq',
    text: groupId ? `[群 ${groupId}] ${sender}：${text}` : `${sender}：${text}`,
    acl: { visibility: 'private', surfaces: ['qq', 'dsh'] },
    meta: {
      qq: { selfId, senderId, groupId, messageId: ev.message_id, private: isPrivate, atMe: Boolean(ev.atme), ...(voiceSeg ? { voice: voiceSeg } : {}) },
    },
  })
  return event
}

export function listen({ root = ROOT, reply = true, chat = think, socket = null } = {}) {
  // chat / socket 只给冒烟测试注入：生产路径两者都不传，行为完全不变。
  // 一个角色一个进程：撞车的那个安静退出（事故记在 lib/singleton.mjs 顶上）
  const slot = claimSlot('qq-listen')
  if (!slot.ok) {
    log('qq', '另一个 listener 在跑，本进程退出', { pid: process.pid, holder: slot.pid ?? null })
    return { stop() { /* 锁不是我们的，不能删 */ } }
  }
  // 脑子级别的占位：一份生活只能有一个「会思考的人」（2026-10-29 补）
  // 角色锁只防同一岗位起两个进程；脑子锁防两个 DSH 工作区各写一份事件流。
  const brain = claimBrain(root, { role: 'qq-listener', build: buildStamp() })
  if (!brain.ok) {
    log('qq', '另一个大脑在跑，本进程只读退出', { pid: process.pid, owner: brain.owner ?? null, reason: brain.reason })
    slot.release?.()
    return { stop() { /* 什么都没起 */ } }
  }
  // 现场：pid + 代码的出厂时间。两个进程撞车、或者跑的是改之前的旧代码，
  // 都能从这一行看出来。
  log('qq', 'listener 启动', { pid: process.pid, build: buildStamp(), root, reply })
  beat()
  setInterval(beat, 20000)
  setInterval(() => heartbeatBrain(root), 20000)
  const ownerFile = path.join(here, '..', 'secrets', 'qq.json')
  let owner = ''
  try { owner = String(JSON.parse(fs.readFileSync(ownerFile, 'utf8')).owner ?? '') } catch { /* 还没配主人 */ }

  let n = 0
  let replies = 0
  let ws = null
  let retry = 0
  let stopped = false

  const onMessage = (e) => {
    let ev
    try { ev = JSON.parse(String(e.data)) } catch { return }

    if (ev.post_type === 'meta_event') {
      if (ev.meta_event_type === 'lifecycle') {
        console.log(`[qq] lifecycle ${ev.sub_type} self=${ev.self_id}`)
        // 记下"她自己的 QQ 号"：面板上的悬浮球拿它去要头像（2026-10-29 主人要的）
        try {
          if (ev.self_id) fs.writeFileSync(selfFile, JSON.stringify({ self: String(ev.self_id), at: new Date().toISOString() }), 'utf8')
        } catch { /* ignore */ }
      }
      return
    }
    if (ev.post_type !== 'message') return

    const written = recordMessage(ev, { root })
    if (written) {
      n += 1
      console.log(`[qq] +${n} ${written.actor} :: ${String(written.text).slice(0, 60)}`)
    }

    if (!reply) return
    const selfId = String(ev.self_id ?? '')
    const senderId = String(ev.sender?.user_id ?? '')
    if (!senderId || senderId === selfId) return

    const text = textOf(ev.message)
  // 语音段原样留下：file / url / duration 都在里面
  const voiceSeg = (Array.isArray(ev.message) ? ev.message.find((s) => s.type === 'record')?.data : null) ?? null
    if (!text || text.startsWith('/')) return

    const isGroup = ev.message_type === 'group'
    const atMe = Array.isArray(ev.message) && ev.message.some((s) => s.type === 'at' && String(s.data?.qq) === selfId)
    if (isGroup && !atMe) return   // 群里只接 @，不抢话

    const who = ev.sender?.card || ev.sender?.nickname || senderId
    captureStickerMeta(ev)
    const key = keyOf(isGroup, ev, senderId)
    // 转发 id 记在这条线上：那条转发发出来之后，可能过好几句才有人问「这转的啥」。
    // 只在当前这条消息里找的话，那时候 ctx.forwardId 是空的 —— 她 2026-10-29 就是这么"展开是空"的。
    const fwdId = forwardIdIn(ev.message)
    if (fwdId) lastForward.set(key, String(fwdId))
    schedule(key, { text, ev, written, who, senderId, isGroup })
  }

  // ---------------------------------------------------------------- 攒着回
  //
  // 秒回有两个毛病（主人 2026-10-29 反馈）：
  //   ① 每句都秒回，像脚本，容易踩 QQ 风控；
  //   ② 他话还没说完她就插嘴（连着发三句，她回三句）。
  // 所以：同一条线上先攒着，他停手 DEBOUNCE_MS 之后再回一次；
  // 他一直不停，最多等 MAX_WAIT_MS 也要回。策略在 lib/batch.mjs（纯函数，可测）。
  const pending = new Map()        // key -> { parts, evs, timer, firstAt }
  const busy = new Set()           // 这条线正在说
  const lastSentAt = new Map()     // key -> 上次发出去的时间
  const lastForward = new Map()    // key -> 这条线上最近一段转发的 id
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const keyOf = (isGroup, ev, senderId) => (isGroup ? 'qq:group:' + ev.group_id : 'qq:private:' + senderId)

  /** 别人发的表情把三元组收进收藏（数据采集，和回不回无关） */
  function captureStickerMeta(ev) {
    try {
      const seg = Array.isArray(ev.message) ? ev.message.find((s) => s.type === 'image') : null
      const em = String(seg?.data?.emoji_id ?? '')
      if (em.length !== 32) return
      const f = 'E:/DSH-herself/sandbox/stickers.json'
      const all = JSON.parse(fs.readFileSync(f, 'utf8'))
      all[em] = { ...(all[em] || {}), packageId: String(seg.data.emoji_package_id ?? ''), key: String(seg.data.key ?? ''), url: String(seg.data.url ?? all[em]?.url ?? '') }
      fs.writeFileSync(f, JSON.stringify(all, null, 2), 'utf8')
      console.log('[qq] 捕获表情三元组', em.slice(0, 8), seg.data.emoji_package_id)
    } catch { /* ignore */ }
  }

  function schedule(key, part) {
    let p = pending.get(key)
    if (!p) { p = { parts: [], evs: [], timer: null, firstAt: Date.now() }; pending.set(key, p) }
    p.parts.push(part)
    p.evs.push(part)
    if (p.timer) clearTimeout(p.timer)
    const wait = nextWait({ firstAt: p.firstAt, now: Date.now(), jitter: Math.round(Math.random() * 1500) })
    p.timer = setTimeout(() => { void flush(key) }, wait)
    console.log(`[qq] 攒着（${p.parts.length} 句），${(wait / 1000).toFixed(1)}s 后回`)
  }

  async function flush(key) {
    if (busy.has(key)) { setTimeout(() => { void flush(key) }, 2000); return }
    const p = pending.get(key)
    if (!p) return
    pending.delete(key)
    busy.add(key)
    try { await respond(key, p) } catch (err) {
      console.error('[qq] 回复失败：', err?.message ?? err)
    } finally { busy.delete(key) }
  }

  async function respond(key, batch) {
    const last = batch.evs[batch.evs.length - 1]
    const { ev, who, senderId, isGroup, written } = last
    const text = batch.parts.map((x) => x.text).join('\n')
    try {
      // 引用 + 合并转发：把被引用的原文取回来，她才知道你在说什么
      let extra = ''
      let quotedFwd = ''
        try {
          const segs = Array.isArray(ev.message) ? ev.message : []
          const rep = segs.find((x) => x.type === 'reply')
          if (rep?.data?.id) {
            const q = await onebot('get_msg', { message_id: Number(rep.data.id) })
            const mm = q?.message ?? q?.data?.message
            const qt = Array.isArray(mm)
              ? mm.filter((x) => x.type === 'text').map((x) => x.data?.text ?? '').join('')
              : String(q?.raw_message ?? q?.data?.raw_message ?? '')
            if (qt) extra += '\n（他引用了：「' + qt.slice(0, 200) + '」）'
            // 被引用的那条**本身就是一段转发**（2026-10-29 群 935190036 就是这个形状）：
            // 自己这条消息里没有 forward 段，id 只在被引用的消息里。不捞出来的话，
            // 无论她怎么调 get_forward 都是空的。
            const qfwdId = forwardIdIn(mm)
            if (qfwdId) {
              quotedFwd = qfwdId
              extra += '\n（他引用的是一段转发。里面说了什么得展开才知道，你可以调 get_forward 看。）'
            }
            // 引用的是一张表情 + 说「这个叫 XX」→ 改她自己的标签
            const qimg = Array.isArray(mm) ? mm.find((x) => x.type === 'image') : null
            const qurl = String(qimg?.data?.url ?? '')
            const em = (qurl.match(/([0-9a-fA-F]{32})/) || [])[1]
            const rename = (text.match(/(?:这个|这张|它)?(?:表情)?(?:叫|是|应该叫)\s*([^\s，。！？]{1,12})/) || [])[1]
            if (qurl && !rename) {
              try {
                // 先落成 data URL 再给她看：动图要抽帧，describe 只对 data URL 做得到
                const { toDataUrl } = await import('../lib/tools.mjs')
                const desc = await describe(await toDataUrl(qurl))
                extra += '\n（他引用的是一张图，你看到：' + desc + '）'
              } catch { /* 看不到就算了 */ }
            }            if (em && rename) {
              try {
                const f = 'E:/DSH-herself/sandbox/stickers.json'
                const all = JSON.parse(fs.readFileSync(f, 'utf8'))
                all[em] = { ...(all[em] || {}), name: rename, at: new Date().toISOString() }
                fs.writeFileSync(f, JSON.stringify(all, null, 2), 'utf8')
                extra += '\n（他把这张表情改名叫「' + rename + '」了）'
                console.log('[qq] 表情改名：', rename, em)
              } catch { /* ignore */ }
            }
          }
        } catch { /* 取不到就当没引用 */ }
        // 合并转发不再替她展开：她自己有 get_forward 这只手，想看才看
        let r
        // 她自己的两只手：这条消息里的图，这个会话里的表情出口。
        // 传给她 = 让她自己决定要不要看、要不要发，而不是我们先猜。
        // 看图也一样：以前这里有一段「像在说图就先替她 describe 一次」的启发式，
        // 现在她自己调 get_images —— 该看才看，一次都不白花。
        const ctx = {
          // 图可能在前几句里（他先发图、再补一句）：取最近一条带图的消息给她
          message: (([...batch.parts].reverse()
            .find((x) => Array.isArray(x.ev?.message) && x.ev.message.some((s) => s.type === 'image'))) ?? last).ev.message,
          forwardId: quotedFwd || lastForward.get(key) || '',
          publicSurface: isGroup,
          send: async (s) => sendStickerTo(isGroup ? 'group' : 'private', isGroup ? ev.group_id : senderId, s),
        }
        // 连着发了几句就告诉她，别把几件事混成一件事回（拼法在 lib/batch.mjs）
        r = await chat({
          root,
          userText: composeUserText(batch.parts.map((x) => x.text)) + extra,
          who,
          isOwner: senderId === owner,
          thread: key,
          ctx,
          causeId: written?.id ?? '',
        })
        // 风控：同一条线两次回复之间留够间隔
        const gap = Date.now() - (lastSentAt.get(key) ?? 0)
        if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap)
        // 打字也要时间：太快不像人在回
        await sleep(500 + Math.round(Math.random() * 1200) + Math.min(1500, r.text.length * 20))
        // 出门前扫一遍凭据形态：她上下文里有 secrets/，复述出来就飞到群里了
        const masked = redact(r.text)
        if (masked.hits.length) log('qq', '出站打码', { kinds: masked.hits, len: r.text.length })
        await sendVerified(isGroup ? 'group' : 'private', isGroup ? ev.group_id : senderId, masked.text, root)
        lastSentAt.set(key, Date.now())
        replies += 1
        console.log(`[qq] 回 ${who}（${batch.parts.length} 句合成一次）：${r.text.slice(0, 60)}`)
      } catch (err) {
        console.error('[qq] 回复失败：', err?.message ?? err)
      }
  }

  // 断线自动重连：OneBot 运行时重启、被踢下线、网络抖动都不用人管
  const connect = () => {
    if (stopped) return
    ws = socket ?? open()
    ws.addEventListener('open', () => {
      retry = 0
      console.log('[qq] 已连上 OneBot')
      // 断线期间错过的话：补进事件流（不触发回复）。失败不影响收消息。
      backfill({ root }).then((r) => {
        if (r.added) console.log(`[qq] 补录 ${r.added} 条断线期间的消息`)
      }).catch((err) => console.error('[qq] 补录失败：', err?.message ?? err))
    })
    ws.addEventListener('error', (e) => console.error('[qq] 连接错误', e.message ?? ''))
    ws.addEventListener('close', () => {
      if (stopped) return
      const delay = Math.min(30000, 1000 * Math.pow(2, retry))
      retry += 1
      console.log(`[qq] 断开，${Math.round(delay / 1000)} 秒后重连`)
      setTimeout(connect, delay)
    })
    ws.addEventListener('message', onMessage)
  }

  connect()

  return {
    stop() {
      stopped = true
      try { ws?.close() } catch { /* ignore */ }
    },
  }
}

/** 发一条消息（返回 action 的 echo 结果） */
export /**
 * 切段 + 逐段确认（她的要求 2026-10-30 00:10：断了要自己知道）。
 *
 * 回执里 retcode !== 0 或拿不到 message_id 就算这段没送到，重试一次；
 * 还不行就记一条 action（ok:false），下一轮她能看见「刚才有一段没发出去」。
 */
async function sendVerified(kind, target, message, root) {
  const parts = splitMessage(String(message ?? ''))
  const results = parts.map(() => false)
  for (let i = 0; i < parts.length; i += 1) {
    for (let attempt = 0; attempt < 2 && !results[i]; attempt += 1) {
      try {
        const r = await send(kind, target, parts[i])
        const ok = (r?.status === undefined || r.status === 'ok' || r.status === 'async') && Number(r?.retcode ?? 0) === 0 && Boolean(r?.data?.message_id ?? r?.message_id)
        results[i] = ok
        if (!ok) console.warn('[qq] 这段回执不对:', JSON.stringify(r).slice(0, 160))
      } catch (err) {
        console.error('[qq] 这段发送失败:', err?.message ?? err)
      }
    }
  }
  const failed = results.map((ok, i) => (ok ? -1 : i)).filter((i) => i >= 0)
  if (parts.length > 1 || failed.length) {
    log('qq', '分段发送', { parts: parts.length, failed: failed.length })
  }
  if (failed.length && root) {
    // 给下一轮留证据：她自己能看见"哪一段没送到"
    try {
      appendEvent(root, {
        type: 'action', actor: 'self', surface: 'qq',
        text: `有一段没送到（第 ${failed.map((i) => i + 1).join('、')} 段 / 共 ${parts.length} 段）`,
        meta: { kind: 'send-failed', parts: parts.length, failed },
      })
    } catch { /* 记不上也不能挡住回话 */ }
  }
  return { parts: parts.length, failed }
}

async function send(kind, target, message) {
  const ws = open()
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const action = kind === 'group' ? 'send_group_msg' : 'send_private_msg'
  const params = kind === 'group' ? { group_id: Number(target), message } : { user_id: Number(target), message }
  const echo = `e${Date.now()}`
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('send timeout')), 10000)
    ws.addEventListener('message', (e) => {
      try {
        const r = JSON.parse(String(e.data))
        if (r.echo === echo) { clearTimeout(t); resolve(r) }
      } catch { /* ignore */ }
    })
  })
  ws.send(JSON.stringify({ action, params, echo }))
  const r = await done
  ws.close()
  return r
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'send') {
    const [kind, target, ...words] = rest
    const r = await send(kind, target, words.join(' '))
    console.log(JSON.stringify(r))
  } else if (cmd === 'listen') {
    listen()
  } else {
    console.log('用法：node hands/qq.mjs listen | send private|group <id> "text"')
  }
}
