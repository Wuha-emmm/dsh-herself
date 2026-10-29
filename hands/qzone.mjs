// hands/qzone.mjs —— 她的 QQ 空间：读写都走空间接口（cookie 由 NapCat 提供）
//
// 为什么不用浏览器：空间有完整 CGI，NapCat 又能给出 cookie + bkn(g_tk)。
// 代价：内部接口无文档，风控/改版会坏，所以每个动作都要能单独失败、单独报告。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const TOKEN = path.join(HER, 'secrets', 'onebot.token')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BASE = 'https://user.qzone.qq.com/proxy/domain/'

function token() {
  try { return fs.readFileSync(TOKEN, 'utf8').trim() } catch { return '' }
}

/** 问 NapCat 要空间登录态（cookie + bkn） */
export function onebot(action, params = {}, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:3001/?access_token=${encodeURIComponent(token())}`)
    const echo = `qz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    let done = false
    const finish = (v) => { if (done) return; done = true; try { ws.close() } catch { /* ignore */ } resolve(v) }
    const timer = setTimeout(() => finish(null), timeoutMs)
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ action, params, echo })) } catch { clearTimeout(timer); finish(null) }
    })
    ws.addEventListener('message', (e) => {
      try {
        const j = JSON.parse(String(e.data))
        if (j.echo === echo) { clearTimeout(timer); finish(j.data ?? null) }
      } catch { /* ignore */ }
    })
    ws.addEventListener('error', () => { clearTimeout(timer); finish(null) })
  })
}

/** 取空间会话：{ cookies, bkn, uin } */
export async function session() {
  const c = await onebot('get_cookies', { domain: 'user.qzone.qq.com' })
  if (!c?.cookies) throw new Error('拿不到空间 cookie（NapCat 可能掉线）')
  const uin = (String(c.cookies).match(/uin=o?(\d+)/) ?? [])[1] ?? ''
  return { cookies: c.cookies, bkn: c.bkn, uin }
}

function headers(s) {
  return {
    cookie: s.cookies,
    referer: `https://user.qzone.qq.com/${s.uin}`,
    'user-agent': UA,
  }
}

async function postForm(pathname, body, s) {
  const res = await fetch(`${BASE}${pathname}?g_tk=${encodeURIComponent(s.bkn)}`, {
    method: 'POST',
    headers: { ...headers(s), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  try { return { http: res.status, json: JSON.parse(text) } } catch { return { http: res.status, raw: text.slice(0, 300) } }
}

async function getJson(url, s) {
  const res = await fetch(url, { headers: headers(s), signal: AbortSignal.timeout(15000) })
  const text = await res.text()
  try { return { http: res.status, json: JSON.parse(text) } } catch { return { http: res.status, raw: text.slice(0, 300) } }
}

// ---------------------------------------------------------------- 读
/** 自己的说说 */
export async function listOwn(num = 5) {
  const s = await session()
  const url = `${BASE}taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${s.uin}&ftype=0&sort=0&pos=0&num=${num}&g_tk=${s.bkn}&code_version=1&format=json&need_private_comment=1`
  return getJson(url, s)
}

/** 一条说说的详情（含评论） */
export async function feedDetail(tid) {
  const s = await session()
  const url = `${BASE}taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6?uin=${s.uin}&tid=${encodeURIComponent(tid)}&g_tk=${s.bkn}&code_version=1&format=json&need_private_comment=1`
  return getJson(url, s)
}

// ---------------------------------------------------------------- 写
/** 发一条说说：纯文字，或带图（本地路径 / http(s) / base64，NapCat 自动上传）
 *  ugc_right: 1 所有人 4 好友 16 部分好友 64 仅自己 128 部分好友不可见 */
export async function publish(content, { images = [], ugcRight = 1, targetUins } = {}) {
  const text = String(content ?? '').slice(0, 1000)
  const params = { content: text, ugc_right: ugcRight }
  if (images.length) params.images = images
  if (targetUins?.length) params.target_uins = targetUins
  const r = await onebot('send_qzone_msg', params)
  return { ok: Boolean(r?.tid), tid: r?.tid ?? null, raw: r }
}

/** 兼容旧名字 */
export async function publishText(text) {
  return publish(text)
}

/** 删一条自己的说说 */
export async function deleteFeed(tid) {
  const r = await onebot('delete_qzone_msg', { tid: String(tid) })
  return { ok: r !== null && r !== undefined, raw: r }
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2)
  const out = (x) => console.log(JSON.stringify(x, null, 2))
  if (cmd === 'session') {
    const s = await session()
    out({ uin: s.uin, bkn: s.bkn, cookies: s.cookies.slice(0, 60) + '…' })
  } else if (cmd === 'list') {
    const r = await listOwn(Number(rest[0]) || 5)
    const msgs = r.json?.msglist ?? []
    out({ http: r.http, count: msgs.length, items: msgs.map((m) => ({ tid: m.tid, time: m.createTime, content: String(m.content).slice(0, 60), comments: m.cmtnum })) })
  } else if (cmd === 'post') {
    const text = rest.join(' ')
    if (!text) { console.error('用法：node hands/qzone.mjs post "内容"'); process.exit(2) }
    out(await publishText(text))
  } else if (cmd === 'del') {
    out(await deleteFeed(rest[0]))
  } else if (cmd === 'detail') {
    out(await feedDetail(rest[0]))
  } else {
    console.log('用法：node hands/qzone.mjs session|list [n]|post "文字"|del <tid>|detail <tid>')
  }
}
