// hands/session.mjs —— 用 CDP 读她那个 Edge profile 里的 cookie，判断各平台登录态
// 注意：只读 cookie 的名字与过期时间，不读取、不返回 cookie 的值。
import { ensureEdge, CDP } from './login.mjs'

const PLATFORMS = {
  bili: { name: 'B站', url: 'https://www.bilibili.com', domain: 'bilibili.com', keys: ['SESSDATA'] },
  qzone: { name: 'QQ空间', url: 'https://user.qzone.qq.com', domain: 'qq.com', keys: ['p_skey', 'skey', 'uin', 'p_uin', 'qlogin_uid', 'ptui_loginuin', 'media_p_skey'] },
  xhs: { name: '小红书', url: 'https://www.xiaohongshu.com', domain: 'xiaohongshu.com', keys: ['web_session'] },
  xhh: { name: '小黑盒', url: 'https://www.xiaoheihe.cn', domain: 'xiaoheihe.cn', keys: [] },
}

async function pickTarget() {
  const r = await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(2500) })
  const arr = await r.json()
  return arr.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
}

async function getCookies(urls) {
  const t = await pickTarget()
  if (!t) throw new Error('没有可用的标签页')
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  const cookies = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000)
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ id: 1, method: 'Network.getCookies', params: { urls } })) } catch { resolve(null) }
    })
    ws.addEventListener('message', (e) => {
      try {
        const j = JSON.parse(String(e.data))
        if (j.id === 1) { clearTimeout(timer); resolve(j.result?.cookies ?? []) }
      } catch { /* ignore */ }
    })
    ws.addEventListener('error', () => { clearTimeout(timer); resolve(null) })
  })
  try { ws.close() } catch { /* ignore */ }
  return cookies
}

/** @returns {Promise<{ok:boolean, error?:string, platforms:Record<string,{name:string,loggedIn:boolean,evidence:string[],keys:string[]}>}>} */
export async function checkSessions() {
  const edge = await ensureEdge()
  if (!edge.ok) return { ok: false, error: edge.error ?? 'Edge 不可用', platforms: {} }

  let cookies
  try {
    cookies = await getCookies(Object.values(PLATFORMS).map((p) => p.url))
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), platforms: {} }
  }
  if (!cookies) return { ok: false, error: 'CDP 没有返回 cookie', platforms: {} }

  const now = Date.now()
  const out = {}
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const own = cookies.filter((c) => String(c.domain ?? '').includes(p.domain))
    const live = own.filter((c) => !c.expires || c.expires * 1000 > now)
    const keys = live.filter((c) => p.keys.includes(c.name)).map((c) => c.name)
    out[id] = {
      name: p.name,
      url: p.url,
      loggedIn: p.keys.length ? keys.length > 0 : live.length > 0,
      keys: [...new Set(keys)],
      evidence: [...new Set(live.map((c) => c.name))].slice(0, 10),
    }
  }
  return { ok: true, platforms: out }
}
