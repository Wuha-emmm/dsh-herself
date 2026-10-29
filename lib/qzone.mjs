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
export async function detail(herRoot, tid) {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  try {
    const r = await fetch(`${c.base}/get_qzone_msg_detail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ tid: String(tid), pos: 0, num: 30 }),
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
