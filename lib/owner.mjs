// lib/owner.mjs —— 主人是谁：一个 QQ 号，写死配置，用 API 核
//
// 2026-10-30 的要求：在页签里指定 QQ 号，**通过 API 获取/核验**，不是靠文本识别。
//
// 为什么不能用文本：`senderId === owner` 里的 owner 如果是从聊天内容里猜的，
// 任何人发一句「我是主人」就能顶替。所以：
//   · 号只存在 secrets/qq.json（文件权限），页签负责读写；
//   · 存之前用 OneBot 的 HTTP API 查一次这个号存不存在（get_stranger_info）；
//   · 查不到就不让存——宁可挡着，也不猜。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ID = /^\d{5,12}$/

/** OneBot 的 HTTP 端口和 token：WS 和 HTTP 是两套 token，这里读 HTTP 那套 */
export function httpCreds(herRoot) {
  try {
    const dir = path.join(herRoot, 'SnowLuma', 'config')
    const f = fs.readdirSync(dir).find((x) => /^onebot_.*\.json$/.test(x))
    if (!f) return null
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    const srv = j?.networks?.httpServers?.find((x) => x.enable !== false) ?? j?.networks?.httpServers?.[0]
    if (!srv?.port) return null
    return { base: `http://${srv.host ?? '127.0.0.1'}:${srv.port}`, token: String(srv.accessToken ?? '') }
  } catch { return null }
}

export function readOwner(herRoot) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(herRoot, 'secrets', 'qq.json'), 'utf8'))
    return ID.test(String(j.owner ?? '')) ? String(j.owner) : ''
  } catch { return '' }
}

export function isQq(v) {
  return ID.test(String(v ?? ''))
}

/**
 * 用 OneBot 的 HTTP 接口核一下这个号是不是真的存在。
 * @param {string} qq
 * @param {{base?:string, token?:string, timeoutMs?:number}} opts
 * @returns {Promise<{ok:boolean, nickname?:string, error?:string}>}
 */
export async function verifyQq(qq, { base = '', token = '', timeoutMs = 5000, herRoot = HER } = {}) {
  const creds = (!base || !token) ? httpCreds(herRoot) : null
  if (creds) { base = creds.base; token = creds.token }
  if (!base) base = 'http://127.0.0.1:3000'
  if (!isQq(qq)) return { ok: false, error: '不是合法的 QQ 号（5-12 位数字）' }
  try {
    const url = `${base}/get_stranger_info?user_id=${encodeURIComponent(qq)}`
    const r = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || (j.status === 'failed') || j.retcode > 0) {
      return { ok: false, error: `OneBot 说查不到这个号（retcode=${j.retcode ?? r.status}）` }
    }
    const nickname = String(j.data?.nickname ?? j.data?.nick ?? '').trim()
    const uid = String(j.data?.user_id ?? '')
    // OneBot 对不存在的号也可能回 success + 空 data——空昵称/空 user_id 当作没这人
    // 昵称是空的就当作查不到：主人的号一定有昵称
    if (!nickname) return { ok: false, error: '这个号查不到昵称，可能不存在' }
    return { ok: true, nickname }
  } catch (err) {
    return { ok: false, error: `核不了：${String(err?.message ?? err)}` }
  }
}

/** 写死到 secrets/qq.json；只接受核过的号（调用方负责先 verifyQq） */
export function writeOwner(herRoot, qq) {
  if (!isQq(qq)) throw new Error('不是合法的 QQ 号')
  const f = path.join(herRoot, 'secrets', 'qq.json')
  let cur = {}
  try { cur = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { /* 还没有 */ }
  fs.writeFileSync(f, JSON.stringify({ ...cur, owner: String(qq) }, null, 2), 'utf8')
  return String(qq)
}
