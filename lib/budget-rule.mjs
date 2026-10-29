// lib/budget-rule.mjs —— 预算到线时怎么办：她定，不是优先级表定
//
// 她的原话（2026-10-30 01:05）：
//   「给我一条明面的线：到 85% 的时候，第一件该被砍的是哪一栏，砍之前先问我一句还是直接砍。
//     这个规则我想自己定，不想再靠优先级表替我决定。」
//   还有：「告警打日志对我没用——日志我看不到。要么落到我能读的通道里，要么就别叫告警。」
//
// 所以：
//   · 规则文件在她沙盒里，她自己改（sandbox/预算规则.json）
//   · 到线时**通过邮箱**通知她（她能读到），不是 console.warn
//   · askBeforeCut=true 就先问，不砍；false 才按 cutOrder 砍
import fs from 'node:fs'
import path from 'node:path'

export const RULE_FILE = '预算规则.json'
export const THRESHOLD = 0.85

/** 默认值：先问、不砍。没有配置时按这个来——宁可问她，也不替她决定。 */
export const DEFAULTS = Object.freeze({
  askBeforeCut: true,
  cutOrder: [],
  notifyVia: 'inbox',
})

/** cutOrder 里的名字 → 事实分类 */
export const KEY_TO_PRIO = Object.freeze({
  narrative: 'narrative',
  people: 'people',
  summary: 'summary',
  recall: 'recall',
  commit: 'commit',
  refusal: 'refusal',
  judge: 'judge',
})

export function ruleFileOf(root) {
  return path.join(root, '..', 'sandbox', RULE_FILE)
}

export function loadRule(root) {
  try {
    const j = JSON.parse(fs.readFileSync(ruleFileOf(root), 'utf8'))
    return {
      askBeforeCut: j.askBeforeCut !== false,
      cutOrder: Array.isArray(j.cutOrder) ? j.cutOrder.filter((k) => KEY_TO_PRIO[k]) : [],
      notifyVia: j.notifyVia === 'note' ? 'note' : 'inbox',
    }
  } catch { return { ...DEFAULTS } }
}

/** 通知节流：同一件事 6 小时内只提醒一次，别刷她 */
export const NOTIFY_GAP_MS = 6 * 3600 * 1000

export function shouldNotify(root, now = Date.now(), gapMs = NOTIFY_GAP_MS) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, 'budget-notify.json'), 'utf8'))
    return now - (Date.parse(st.at) || 0) > gapMs
  } catch { return true }
}

export function markNotified(root, now = Date.now()) {
  try { fs.writeFileSync(path.join(root, 'budget-notify.json'), JSON.stringify({ at: new Date(now).toISOString() }), 'utf8') } catch { /* ignore */ }
}

/** 按她给的顺序决定先砍谁（返回 prio 数组，从先砍到后砍） */
export function cutSequence(rule) {
  const order = rule?.cutOrder?.length ? rule.cutOrder : ['narrative', 'people', 'summary']
  const seq = order.map((k) => KEY_TO_PRIO[k]).filter(Boolean)
  return seq.length ? seq : ['narrative', 'people', 'summary']
}