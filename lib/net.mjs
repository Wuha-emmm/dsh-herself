// lib/net.mjs —— 她的手之一：用 DeepSeek 官方 Search / Fetch API 看外面的世界
//
// 2026-10-29 的来龙去脉：
//   1. 主人问她「怎么看待这个 GitHub 项目」，她答「我这儿没有联网抓取的工具」——说的是实话，
//      她当时的工具只有文件、QQ、表情；
//   2. 我先写了个本地 fetch。后来主人提醒：DeepSeek 官方已经有 Search / Fetch API 了。
//   3. 官方这两个是**服务端抓取**，直接回 Markdown，比本地 fetch 强得多
//      （本地是 DNS 受限、还要自己剥 HTML）。所以本地实现整个撤掉，改调官方：
//        POST https://api.deepseek.com/v1/tools/search   {query, count, need_content}
//        POST https://api.deepseek.com/v1/tools/fetch    {url}
//      文档：https://api-docs.deepseek.com/guides/search
//
// 计费：$0.75 / 1000 次成功请求（按次，不按 token）。失败和空结果不计费。
// 实测这台机器：Search ~0.3s；Fetch 普通站 0.1s，GitHub 页面 ~12s。
// 实测的坑：raw.githubusercontent.com **服务端也抓不到**（404），
//          github.com/<owner>/<repo>/blob/... 和 api.github.com 都能抓。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const KEY_FILE = path.join(here, '..', 'secrets', 'deepseek.key')
const BASE = 'https://api.deepseek.com'

export const NET_DEFAULTS = Object.freeze({
  maxChars: 6000,        // 回来给她看的字数上限
  searchTimeoutMs: 20000,
  fetchTimeoutMs: 60000, // GitHub 页面实测要 12s，别卡太紧
})

function key() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim() } catch { return '' }
}

/** 把 HTTP 错误翻译成她能看懂的一句话 */
function explain(status, body) {
  const msg = String(body?.error?.message ?? '')
  if (status === 401) return 'API key 不对（secrets/deepseek.key）'
  if (status === 402) return 'DeepSeek 账户余额不够了'
  if (status === 403) return '这个地址被安全策略拒了'
  if (status === 404) return '那边没抓到可用内容（页面不存在、站点拒绝、或没有可提取的正文）'
  if (status === 429) return '请求太密被限流了，等一会儿再试'
  if (status >= 500) return `服务端出错（${status}），等会儿再试`
  return msg || `HTTP ${status}`
}

/**
 * 检查 URL 能不能交给官方 Fetch。抓取发生在 DeepSeek 那边，本机的网络限制不影响。
 * @returns {{ok:true,url:string}|{ok:false,error:string}}
 */
export function checkUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { ok: false, error: '没给网址' }
  if (s.length > 8192) return { ok: false, error: '网址太长' }
  let u
  try { u = new URL(s) } catch { return { ok: false, error: '这不是一个完整的网址（要带 http:// 或 https://）' } }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: `只收 http/https，不吃 ${u.protocol}` }
  if (!u.hostname) return { ok: false, error: '网址里没有域名' }
  if (u.username || u.password) return { ok: false, error: '网址里不要带账号密码' }
  // 已知抓不到的一类：raw 域名连服务端都拿不到，直接告诉她该用什么
  if (u.hostname === 'raw.githubusercontent.com') {
    return {
      ok: false,
      error: 'raw.githubusercontent.com 连服务端都抓不到（实测 404）。改用 github.com/<owner>/<repo>/blob/<branch>/<path>，或者 api.github.com/repos/<owner>/<repo>',
    }
  }
  return { ok: true, url: u.toString() }
}

/** 网页 → Markdown 正文（官方已经提取好了，这里只做长度裁剪） */
function clip(text, maxChars) {
  const s = String(text ?? '').replace(/\r/g, '').trim()
  return { text: s.slice(0, maxChars), truncated: s.length > maxChars }
}

/**
 * 抓一个网页。
 * @returns {Promise<{ok:boolean,title?:string,text?:string,truncated?:boolean,error?:string}>}
 */
export async function fetchPage(raw, opts = {}) {
  const cfg = { ...NET_DEFAULTS, ...opts }
  const chk = checkUrl(raw)
  if (!chk.ok) return { ok: false, error: chk.error }
  const k = key()
  if (!k) return { ok: false, error: '没有 secrets/deepseek.key' }

  try {
    const r = await fetch(`${BASE}/v1/tools/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k },
      body: JSON.stringify({ url: chk.url }),
      signal: AbortSignal.timeout(cfg.fetchTimeoutMs),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, status: r.status, error: explain(r.status, j) }
    const page = clip(j?.content ?? '', cfg.maxChars)
    if (!page.text) return { ok: false, status: r.status, error: '页面抓到了但没有可读正文' }
    return { ok: true, url: chk.url, title: String(j?.title ?? '').slice(0, 120), text: page.text, truncated: page.truncated }
  } catch (err) {
    const code = err?.name === 'TimeoutError' ? '超时' : String(err?.message ?? err)
    return { ok: false, error: `抓取失败：${code}` }
  }
}

/**
 * 搜网页。
 * @param {string} query 1~128 字
 * @returns {Promise<{ok:boolean,results:Array,error?:string}>}
 */
export async function searchWeb(query, opts = {}) {
  const cfg = { ...NET_DEFAULTS, ...opts }
  const q = String(query ?? '').trim()
  if (!q) return { ok: false, results: [], error: '搜索词是空的' }
  if (q.length > 128) return { ok: false, results: [], error: '搜索词超过 128 字' }
  const k = key()
  if (!k) return { ok: false, results: [], error: '没有 secrets/deepseek.key' }

  const count = Math.max(1, Math.min(Number(opts.count) || 5, 10))
  try {
    const r = await fetch(`${BASE}/v1/tools/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k },
      body: JSON.stringify({ query: q, count }),
      signal: AbortSignal.timeout(cfg.searchTimeoutMs),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, results: [], status: r.status, error: explain(r.status, j) }
    const results = (Array.isArray(j?.results) ? j.results : []).map((x) => ({
      title: String(x?.title ?? '').slice(0, 120),
      url: String(x?.url ?? ''),
      // summary 是给模型读的长摘要（600~800 字）；snippet 是给人看的短句
      summary: String(x?.summary ?? x?.snippet ?? '').slice(0, 800),
      date: x?.date ? String(x.date).slice(0, 10) : '',
      authority: Number(x?.authority ?? -1),
      score: Number(x?.rerank_score ?? 0),
    }))
    return { ok: true, results }
  } catch (err) {
    const code = err?.name === 'TimeoutError' ? '超时' : String(err?.message ?? err)
    return { ok: false, results: [], error: `搜索失败：${code}` }
  }
}
