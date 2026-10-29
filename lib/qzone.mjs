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
export async function feedList(herRoot, { uin = '', num = 20 } = {}) {
  let c
  try { c = await creds(herRoot) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  const target = uin || c.uin
  const gtk = gtkOf(c.cookies)
  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6`
    + `?uin=${target}&ftype=0&sort=0&pos=0&num=${num}&replynum=0&g_tk=${gtk}`
    + `&callback=_preloadCallback&code_version=1&format=jsonp&need_private_comment=1`
  try {
    const r = await fetch(url, {
      headers: { cookie: c.cookies, referer: `https://user.qzone.qq.com/${target}`, 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    })
    const text = await r.text()
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, raw: text.slice(0, 200) }
    // JSONP：_preloadCallback({...});
    const m = text.match(/^[^(]*\(([\s\S]*)\)[^)]*$/)
    const json = JSON.parse(m ? m[1] : text)
    const list = json?.msglist ?? []
    const items = list.map((x) => ({
      id: String(x.tid ?? ''),
      at: (() => {
        const t = x.createTime ?? x.created_time ?? x.createtime
        if (!t) return ''
        if (typeof t === 'number' || /^\d+$/.test(String(t))) {
          const n = Number(t)
          const d = new Date(n > 1e12 ? n : n * 1000)
          return Number.isNaN(d.getTime()) ? '' : d.toISOString()
        }
        const d = new Date(String(t).replace(/-/g, '/'))
        return Number.isNaN(d.getTime()) ? '' : d.toISOString()
      })(),
      text: String(x.content ?? '').replace(/\s+/g, ' ').slice(0, 200),
      comments: Number(x.cmtnum ?? 0),
      likes: Number(x.likenum ?? 0),
      images: Array.isArray(x.pic) ? x.pic.length : 0,
    }))
    return { ok: true, items }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}