// lib/batch.mjs —— 等人把话说完
//
// 秒回有两个毛病（2026-10-29 主人反馈）：像脚本（风控），而且他话没说完她就插嘴。
// 策略本身是纯的，所以能单测：给定「第一条什么时候到、现在几点」，算出该再等多久。
// 真正的定时器留在 hands/qq.mjs，那里只有 IO。

/** 攒话最多等多久、停手多久就当他说完了 */
export const DEBOUNCE_MS = 4500
export const MAX_WAIT_MS = 15000
/** 同一条线两次回复之间至少隔这么久（风控） */
export const MIN_GAP_MS = 8000

/**
 * 还要等多久才回。
 * @param {{firstAt:number, now:number, debounceMs?:number, maxWaitMs?:number, jitter?:number}} o
 * @returns {number} 毫秒；0 表示立刻回
 */
export function nextWait({ firstAt, now, debounceMs = DEBOUNCE_MS, maxWaitMs = MAX_WAIT_MS, jitter = 0 }) {
  const waited = Math.max(0, now - firstAt)
  if (waited >= maxWaitMs) return 0
  return Math.max(0, Math.min(maxWaitMs - waited, debounceMs + jitter))
}

/**
 * 把攒下的几句拼成一句人话。
 * 只有一句就原样；多句要标出来，不然她会把几件事混成一件。
 */
export function composeUserText(parts = []) {
  const clean = (Array.isArray(parts) ? parts : [parts]).map((s) => String(s ?? '').trim()).filter(Boolean)
  if (!clean.length) return ''
  if (clean.length === 1) return clean[0]
  return '（他连着发了几条）\n' + clean.join('\n')
}
