// lib/prefs.mjs —— 她的作息：默认值 + 她自己说的偏好 + 不可越过的护栏
//
// 设计原则：
//   · DEFAULTS 只是"她还没表过态"时的起点，不是命令
//   · 她说的偏好（preference 事件，declared 或 inferred）覆盖默认值
//   · HARD 是护栏，任何人（包括她）都不能越过——因为被影响的是另一个人

export const DEFAULTS = Object.freeze({
  fromHour: 9,      // 几点之后可以主动说话
  toHour: 23,       // 几点之后安静
  maxPerDay: 4,     // 每天最多内省几次
  sendPerDay: 1,    // 其中几次真的发给他
  minGapMin: 90,    // 两次之间至少隔多久
})

/** 护栏：不是偏好，是边界 */
export const HARD = Object.freeze({
  maxPerDay: 6,
  sendPerDay: 2,
  minGapMin: 30,
  earliestHour: 6,
  latestHour: 24,
})

function clamp(n, lo, hi, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(v)))
}

/**
 * 从事件流算「她现在的作息」。
 * @returns {{prefs: object, sources: Array<{key:string,value:any,at:string,inferred:boolean,quote:string}>}}
 */
export function effectivePrefs(events = []) {
  const prefs = { ...DEFAULTS }
  const sources = []

  for (const e of events) {
    if (e.type !== 'preference') continue
    const key = String(e.meta?.key ?? '')
    if (!(key in DEFAULTS)) continue
    const value = e.meta?.value
    prefs[key] = value
    sources.push({
      key,
      value,
      at: e.ts,
      inferred: e.meta?.inferred === true,
      quote: String(e.text ?? '').slice(0, 60),
    })
  }

  // 不再用外部 HARD 夹她：只做最基本的数值合法性检查，节奏由她自己的偏好决定
  prefs.maxPerDay = Math.max(1, Number(prefs.maxPerDay) || DEFAULTS.maxPerDay)
  prefs.sendPerDay = Math.max(0, Number(prefs.sendPerDay) || 0)
  prefs.minGapMin = Math.max(5, Number(prefs.minGapMin) || DEFAULTS.minGapMin)
  prefs.fromHour = Math.min(23, Math.max(0, Number(prefs.fromHour) ?? DEFAULTS.fromHour))
  prefs.toHour = Math.min(24, Math.max(prefs.fromHour + 1, Number(prefs.toHour) ?? DEFAULTS.toHour))

  return { prefs, sources }
}
