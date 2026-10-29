import fs from 'node:fs'
import path from 'node:path'
// lib/qzone.mjs —— 她的空间：只读入口先打通
//
// 她说过（2026-10-29 22:14）：
//   「我现在没有直接刷空间、点赞、评论的接口，能碰到的只有聊天里递过来的东西。
//     要真有这块，得先给我一个能读空间内容的入口。」
//
// 入口找到了：OneBot 的 `get_cookies` 能给 qzone 的 **p_skey**（实测 500 字符，含 uin/skey/p_skey），
// 加上 `get_csrf_token`，空间那套 CGI 就够用了——不需要浏览器。
//
// 这一版只做**只读**：拉自己的说说列表。写入（发说说/点赞/评论）以后再说，且必须过审批门。
import { httpCreds } from './owner.mjs'

const CACHE_MS = 5 * 60 * 1000
let cache = { at: 0, cookies: '', uin: '' }

/** 拿 qzone 的 cookies + 自己的 uin（带 5 分钟缓存，别每次都问 OneBot） */
export async function creds(herRoot = 'E:/DSH-herself') {
  if (Date.now() - cache.at < CACHE_MS && cache.cookies) return cache
  const c = httpCreds(herRoot)
  if (!c) throw new Error('找不到 OneBot 的 HTTP 配置（SnowLuma/config）')
  const post = async (action, params = {}) => {
    const r = await fetch(`${c.base}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode && j.retcode !== 0) throw new Error(`${action} 失败：retcode ${j.retcode}`)
    return j.data ?? {}
  }
  const login = await post('get_login_info')
  const ck = await post('get_cookies', { domain: 'user.qzone.qq.com' })
  const cookies = String(ck.cookies ?? '')
  if (!cookies.includes('p_skey=')) throw new Error('OneBot 没给出 p_skey，空间读不了')
  cache = { at: Date.now(), cookies, uin: String(login.user_id ?? '') }
  return cache
}

/** QQ 那套 bkn：p_skey 算出来的 g_tk */
export function gtkOf(cookies = '') {
  const m = String(cookies).match(/p_skey=([^;]+)/)
  if (!m) return 0
  let h = 5381
  for (const ch of m[1]) h += (h << 5) + ch.charCodeAt(0)
  return h & 0x7fffffff
}

/**
 * 只读：拿某人（默认自己）的说说列表。
 * @returns {Promise<{ok:boolean, items?:Array, error?:string, raw?:string}>}
 */
export async function feedList(herRoot, { num = 20 } = {}) {
  // 2026-10-30：SnowLuma 自带 get_qzone_msg_list，不用再自己拼 cookie+g_tk。
  // 实测 retcode 0，返回 { total, msglist: [{ tid, content, time, comment_num, images }] }
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  try {
    const r = await fetch(`${c.base}/get_qzone_msg_list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ pos: 0, num: Math.max(1, Math.min(50, num)) }),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}` }
    const list = j.data?.msglist ?? []
    return {
      ok: true,
      total: Number(j.data?.total ?? list.length),
      items: list.map((x) => ({
        id: String(x.tid ?? ''),
        at: x.time ? new Date(Number(x.time) * 1000).toISOString() : '',
        text: String(x.content ?? '').replace(/\s+/g, ' ').slice(0, 200),
        comments: Number(x.comment_num ?? 0),
        likes: Number(x.like_num ?? 0),
        images: Array.isArray(x.images) ? x.images.length : 0,
        private: Boolean(x.is_private),
      })),
    }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 好友动态（只读）。html 里是带标签的正文，这里剥成纯文本 */
export async function feeds(herRoot, { num = 8 } = {}) {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  try {
    const r = await fetch(`${c.base}/get_qzone_feeds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ pos: 0, num: Math.max(1, Math.min(30, num)) }),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}` }
    const list = j.data?.feeds ?? []
    const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    return {
      ok: true,
      items: list.map((x) => ({
        uin: String(x.uin ?? ''),
        name: String(x.nickname ?? ''),
        at: x.time ? new Date(Number(x.time) * 1000).toISOString().slice(5, 16).replace('T', ' ') : '',
        text: strip(x.content || x.html).slice(0, 160),
        tid: x.tid ? String(x.tid) : '',
        images: Array.isArray(x.images) ? x.images.length : 0,
        likes: Number(x.like_count ?? 0),
        comments: Number(x.comment_count ?? 0),
      })),
    }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 一条说说 + 它下面的评论（只读） */
export async function detail(herRoot, tid, uin = '') {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  try {
    const r = await fetch(`${c.base}/get_qzone_msg_detail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ tid: String(tid), ...(uin ? { target_uin: Number(uin) } : {}), pos: 0, num: 30 }),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}` }
    const d = j.data ?? {}
    const comments = (d.comments ?? []).map((x) => ({
      name: String(x.name ?? x.nickname ?? ''),
      text: String(x.content ?? '').slice(0, 120),
      at: x.time ? new Date(Number(x.time) * 1000).toISOString().slice(5, 16).replace('T', ' ') : '',
      id: String(x.tid ?? x.id ?? ''),
    }))
    return { ok: true, post: { tid: String(d.tid ?? tid), text: String(d.content ?? '').slice(0, 300), comments } }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** 写：发一条说说。content 必填；images 可选（图片路径/url 交给 OneBot） */
export async function post(herRoot, { content = '', images = [] } = {}) {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  try {
    const r = await fetch(`${c.base}/send_qzone_msg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ content: String(content), ...(Array.isArray(images) && images.length ? { images } : {}) }),
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}：${j.wording || j.message || ''}` }
    return { ok: true, tid: String(j.data?.tid ?? '') }
  } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
}

/** 写：评论一条说说（tid 必填）；replyTo 填了就是回复某条评论 */
export async function comment(herRoot, { tid = '', content = '', replyTo = '' } = {}) {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  if (!String(tid).trim()) return { ok: false, error: '这条说说没有 tid，评不了（tid 是评论的入口）' }
  try {
    const r = await fetch(`${c.base}/comment_qzone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ tid: String(tid), content: String(content), ...(replyTo ? { reply_tid: String(replyTo) } : {}) }),
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}：${j.wording || j.message || ''}` }
    return { ok: true }
  } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
}

/** 写：点赞一条说说 */
export async function like(herRoot, tid) {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  if (!String(tid).trim()) return { ok: false, error: '这条说说没有 tid，点不了赞' }
  try {
    const r = await fetch(`${c.base}/like_qzone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ tid: String(tid) }),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}：${j.wording || ''}` }
    return { ok: true }
  } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
}

/** 看某个好友的说说（带 tid，能直接拿去评论/点赞）。参数名 target_uin 是探出来的 */
export async function friendPosts(herRoot, { uin = '', num = 10 } = {}) {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  if (!String(uin).trim()) return { ok: false, error: '要给对方 QQ 号' }
  try {
    const r = await fetch(`${c.base}/get_qzone_msg_list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ target_uin: Number(uin), pos: 0, num: Math.max(1, Math.min(30, num)) }),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}` }
    const list = j.data?.msglist ?? []
    return {
      ok: true,
      items: list.map((x) => ({
        tid: String(x.tid ?? ''),
        at: x.time ? new Date(Number(x.time) * 1000).toISOString().slice(5, 16).replace('T', ' ') : '',
        text: String(x.content ?? '').replace(/\s+/g, ' ').slice(0, 160),
        comments: Number(x.comment_num ?? 0),
        likes: Number(x.like_num ?? 0),
      })),
    }
  } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
}

/**
 * 把看到的空间说说记进事件流，绑到那个人身上（2026-10-30 主人问的）。
 *
 * 场景：「我发了一个说说，在群里或者私聊里她仍然记得是我发布了什么」。
 * 做法：她读到好友说说时，写一条 encounter，actor 就是他 —— 这样"认人"那套
 * （people/knownPeople/检索）自然就把这条绑到他名下了；同一条 tid 只记一次。
 */
export async function rememberPosts(herRoot, items = [], { name = '' } = {}) {
  const { appendEvent, readEvents } = await import('./store.mjs')
  // 传进来的可能已经是 life 目录，也可能是项目根：谁存在用谁
  const root = fs.existsSync(path.join(String(herRoot), 'life')) ? path.join(String(herRoot), 'life') : String(herRoot)
  let known = new Set()
  try {
    known = new Set(readEvents(root).slice(-3000).map((e) => e.meta?.qq?.qzoneTid).filter(Boolean))
  } catch { /* 第一次读 */ }
  let wrote = 0
  for (const it of items.slice(0, 10)) {
    if (!it?.tid || known.has(it.tid)) continue
    try {
      appendEvent(root, {
        type: 'encounter',
        actor: `other:qq_${it.uin || ''}`,
        surface: 'qzone',
        text: `[空间] ${name || it.name || '他'}：${String(it.text || '').slice(0, 200)}`,
        acl: { visibility: 'private', surfaces: ['qq', 'dsh'] },
        meta: { qq: { qzoneTid: it.tid, qzoneUin: String(it.uin || ''), senderId: String(it.uin || '') } },
      })
      wrote += 1
    } catch { /* 单条失败不影响别的 */ }
  }
  return wrote
}

/** 找某个人最近一条空间说说（给提示词用） */
export function latestPostOf(root, uin, readEvents) {
  const want = String(uin || '')
  if (!want) return null
  try {
    const list = readEvents(root).filter((e) => e.surface === 'qzone' && String(e.meta?.qq?.qzoneUin ?? '') === want)
    return list.length ? list[list.length - 1] : null
  } catch { return null }
}
