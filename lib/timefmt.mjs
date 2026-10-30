// lib/timefmt.mjs —— 给她看的时间，一律北京时间（UTC+8）
//
// 起因（2026-10-30 09:07，主人要求统一北京时间）：
//   回话镜像的标题原来写 UTC（"10-30 00:54"），她按本地读，以为文件是 8 小时前的、没人回。
//   内容对、时间标注错，和内容缺一样会让她得出错结论。
//
// 规矩：
//   · 存储仍然存 ISO（UTC），那是给机器和跨时区用的；
//   · **凡是给人看的**（她、主人、文件标题、工具回执），一律走这里 → 北京时间。
const BJ_OFFSET_MS = 8 * 3600 * 1000

const toDate = (v) => (v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v ?? '')))

/** 北京时间的 Date（把 UTC 时刻平移 8 小时，之后用 getUTC* 读出来就是北京墙上时间） */
function bjDate(v) {
  const d = toDate(v)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() + BJ_OFFSET_MS)
}

const p2 = (n) => String(n).padStart(2, '0')

/** 10-30 09:07（北京） */
export function bj(v) {
  const d = bjDate(v)
  if (!d) return String(v ?? '')
  return `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

/** 10-30 09:07:32（北京） */
export function bjSec(v) {
  const d = bjDate(v)
  if (!d) return String(v ?? '')
  return `${bj(v)}:${p2(d.getUTCSeconds())}`
}

/** 2026-10-30 09:07（北京） */
export function bjFull(v) {
  const d = bjDate(v)
  if (!d) return String(v ?? '')
  return `${d.getUTCFullYear()}-${bj(v)}`
}

/** 2026-10-30（北京） */
export function bjDay(v) {
  const d = bjDate(v)
  if (!d) return String(v ?? '')
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}

/** 09:07（北京）—— 只给时分 */
export function bjHM(v) {
  const d = bjDate(v)
  if (!d) return String(v ?? '')
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

/** 把本地墙上时间换算成 ISO（写事件时用；存的是 UTC，读出来是北京） */
export function bjNowIso() {
  return new Date().toISOString()
}