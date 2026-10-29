// util.mjs —— 纯工具：ULID、稳定序列化、哈希
import { createHash, randomBytes } from 'node:crypto'

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 把毫秒时间 + 16 位随机段编成 26 位 ULID（字典序 = 时间序） */
export function ulidAt(ms, seed = 0) {
  let t = Math.max(0, Math.floor(Number(ms) || 0))
  let head = ''
  for (let i = 0; i < 10; i++) { head = B32[t % 32] + head; t = Math.floor(t / 32) }
  let r = (Number(seed) || 0) >>> 0
  let tail = ''
  for (let i = 0; i < 16; i++) { tail = B32[r % 32] + tail; r = Math.floor(r / 32) }
  return head + tail
}

/** 进程内单调 ULID：同一毫秒内递增尾段，保证 id 顺序 = 写入顺序 */
let lastMs = 0
let lastSeed = 0
export function ulid(ms = Date.now()) {
  const t = Math.max(Number(ms) || 0, lastMs)
  if (t === lastMs) {
    lastSeed = (lastSeed + 1) >>> 0
  } else {
    lastMs = t
    const rand = randomBytes(8)
    let n = 0
    for (const b of rand) n = (n * 256 + b) % 0xffffffff
    lastSeed = n >>> 0
  }
  return ulidAt(t, lastSeed)
}

/** 深度稳定序列化：键排序，保证同一对象每次得到同一字符串 */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const keys = Object.keys(v).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}

export function sha256(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex')
}

/** 事件的链哈希：对整条事件（含 prev）算 sha256 */
export function chainHash(event) {
  return 'sha256:' + sha256(stableStringify(event))
}

export function dayBetween(fromIso, nowMs) {
  const t = Date.parse(fromIso)
  if (!Number.isFinite(t)) return 1
  return Math.max(1, Math.floor((nowMs - t) / 86400000) + 1)
}

/** 按北京时间拆出年月日时分和星期——不依赖这台机器的时区 */
function beijingParts(ms) {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t) => p.find((x) => x.type === t)?.value ?? ''
  return {
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: get('minute'),
    weekday: get('weekday') || '',
  }
}

function partOfDay(hh) {
  return hh < 5 ? '凌晨' : hh < 9 ? '早上' : hh < 12 ? '上午' : hh < 14 ? '中午' : hh < 18 ? '下午' : hh < 23 ? '晚上' : '半夜'
}

/**
 * 现在几点，说成人话。**按北京时间算**（主人 2026-10-29 定）。
 */
export function clockText(ms) {
  if (!Number.isFinite(ms)) return ''
  const { month, day, hour, minute, weekday } = beijingParts(ms)
  const h12 = ((hour + 11) % 12) + 1
  return `${month} 月 ${day} 日${partOfDay(hour)} ${h12}:${minute}（${weekday}）`
}

/**
 * 作息刻度：光有数字她不会用——她自己说的「给我一串数字，我也不会自动懂现在该催你睡觉」。
 * 所以这里把钟点翻成一句**判断**：此刻算不算晚。
 * 阈值可以被她的 preference 覆盖（key = 'routine'，value = {lateFrom, overFrom, morningFrom, morningTo}）。
 */
export const ROUTINE_DEFAULTS = Object.freeze({ lateFrom: 23, overFrom: 2, morningFrom: 7, morningTo: 9 })

/** @returns {{hour:number, part:string, verdict:string, line:string}} */
export function routineOf(ms, opts = {}) {
  const cfg = { ...ROUTINE_DEFAULTS, ...opts }
  const { hour } = beijingParts(ms)
  const part = partOfDay(hour)
  const over = hour >= cfg.overFrom && hour < cfg.morningFrom
  const late = hour >= cfg.lateFrom || hour < 5
  const verdict = over ? '熬过头了'
    : late ? '算晚了'
      : hour >= cfg.morningFrom && hour < cfg.morningTo ? '正常起床的点'
        : '正常时段'
  const line = `时间按北京时间算。${cfg.lateFrom}:00 之后算晚，${cfg.overFrom}:00 到 ${cfg.morningFrom}:00 算熬过头，`
    + `${cfg.morningFrom}:00–${cfg.morningTo}:00 算早上。此刻 ${hour} 点属于${part}，${verdict}。`
  return { hour, part, verdict, line }
}

/** 这件事是多久以前 / 什么时候 */
export function agoText(thenMs, nowMs) {
  if (!Number.isFinite(thenMs)) return ''
  const s = Math.round((nowMs - thenMs) / 1000)
  if (s < 0) return '还没发生'
  if (s < 90) return '刚刚'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} 天前`
  const dd = new Date(thenMs)
  return `${dd.getMonth() + 1} 月 ${dd.getDate()} 日`
}

/** 中文二元组集合（英文/数字整体保留）；检索和相似度共用这一个口径 */
export function bigrams(s) {
  const t = String(s ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '').toLowerCase()
  const set = new Set()
  for (let i = 0; i + 1 < t.length; i += 1) set.add(t.slice(i, i + 2))
  return set
}

/** 两句「说的是不是同一件事」的粗判：二元组 Jaccard。纯函数，可回放。 */
export function bigramJaccard(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter += 1
  return inter / (A.size + B.size - inter)
}
