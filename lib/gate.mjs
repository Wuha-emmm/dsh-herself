// lib/gate.mjs —— 公共动作的审批门
//
// 定稿里那句「公共动作要主人点头」，落在这里。
// 什么算公共动作？**群里发表情**这种"她主动往外递东西"的动作。
// 普通回话不算——那是对话本身，每条都拦就没法说话了。
//
// 许可写在事件流里（`meta` 事件，key='public-approval'），不是配置文件：
// 因为它是**有时间窗**的，而且她会看到（"主人昨天许可过"）。
//   · 默认没有许可；
//   · 许可 24 小时后过期（过期后要重新点头）；
//   · 用 tools/approve.mjs 发/收回。
import { liveEvents } from './derive.mjs'

export const APPROVAL_TTL_MS = 24 * 3600 * 1000
export const APPROVAL_KEY = 'public-approval'

/**
 * 现在能不能做公共动作。
 * @param {object[]} events 事件流（调用方传 liveEvents 过的）
 * @param {number} now
 * @returns {{allowed:boolean, reason:string, at?:string, leftMs?:number}}
 */
export function publicAllowed(events = [], now = Date.now()) {
  const list = events.filter((e) => e.type === 'meta' && e.meta?.key === APPROVAL_KEY)
  const last = list.slice(-1)[0]
  if (!last) return { allowed: false, reason: '还没得到主人许可（tools/approve.mjs 可以给）' }
  if (last.meta?.value === false) return { allowed: false, reason: '主人收回了许可' }
  const at = Date.parse(last.ts)
  if (!Number.isFinite(at)) return { allowed: false, reason: '许可的时间读不出来' }
  const left = at + APPROVAL_TTL_MS - now
  if (left <= 0) {
    const hours = Math.round((now - at) / 3600000)
    return { allowed: false, reason: `许可是 ${hours} 小时前给的，过期了`, at: last.ts, leftMs: left }
  }
  return { allowed: true, reason: `主人许可到 ${new Date(at + APPROVAL_TTL_MS).toISOString().slice(11, 16)}（UTC）`, at: last.ts, leftMs: left }
}
