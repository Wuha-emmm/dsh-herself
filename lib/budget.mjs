// lib/budget.mjs —— 事实预算：先定配额，再决定塞什么
//
// 为什么要有这一层：`factsOf` 现在一个人管 8 类事实（钟点/判断/拒绝/摘要/承诺/叙事/群里的人/最近/回忆）。
// 每加一类就多几十上百 token，而"最近"是最该保住的那一类——它一被挤，她就"失忆"。
// 2026-10-29 实测每轮 500~550 tok，靠的是"没加太多"，不是"有配额"。
//
// 规则：
//   1. 每条事实带一个优先级（数字越小越重要）；
//   2. 按优先级塞，塞不下就丢**优先级最低**的；
//   3. 优先级 0 的（天数/钟点）永远不丢——丢了就不是她了，是报时器坏了；
//   4. 单条太长就截断，不整条丢（截断至少还有信息）。
//
// 纯函数，可回放。

/** 中英混排的粗略 token 估法：汉字 1 token，英文/数字 4 字符 1 token */
export function estimateTokens(text = '') {
  let cjk = 0
  let other = 0
  for (const ch of String(text ?? '')) {
    if (/[\u3400-\u9fff]/.test(ch)) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 4)
}

/** 事实的优先级：小的先保 */
export const PRIO = Object.freeze({
  CORE: 0,      // 第几天 + 现在几点 + 最早记得什么（永不丢）
  RECENT: 1,    // 最近说了什么（丢了就是失忆）
  JUDGE: 2,     // 她的判断（身份）
  ROUTINE: 3,   // 作息刻度
  RECALL: 4,    // 想起来的旧事
  COMMIT: 5,    // 还没了的事
  SUMMARY: 6,   // 上次聊到
  REFUSAL: 7,   // 拒绝过的
  PEOPLE: 8,    // 群里的人
  NARRATIVE: 9, // 她回看过自己
})

/**
 * 按预算裁剪。
 * @param {Array<{text:string, prio:number}>} facts
 * @param {{budget?:number, maxCharsPerLine?:number}} opts
 * @returns {{kept:Array, dropped:Array, used:number, budget:number, truncated:string[]}}
 */
export function fitBudget(facts = [], { budget = 600, maxCharsPerLine = 400 } = {}) {
  const items = facts.map((f) => ({ ...f, est: estimateTokens(f.text) }))
  const order = items.map((_, i) => i)
  // 重要在前；同优先级保持原顺序（稳定，回放时不会抖）
  const ranked = [...items].sort((a, b) => a.prio - b.prio)
  const kept = []
  const dropped = []
  const truncated = []
  let used = 0

  for (const f of ranked) {
    // CORE 永不丢
    if (f.prio === 0) { kept.push(f); used += f.est; continue }
    if (used + f.est <= budget) { kept.push(f); used += f.est; continue }
    // 塞不下：太长的话截一段试试
    const room = budget - used
    if (room > 40 && String(f.text).length > 80) {
      // 中文 1 字 ≈ 1 token，所以按"剩余 token 数"当字数截，别乘 2（那是英文的估法）
      const cutChars = Math.max(40, Math.min(maxCharsPerLine, Math.floor(room * 0.9)))
      const cut = String(f.text).slice(0, cutChars)
      const t = { ...f, text: cut + '…', est: estimateTokens(cut + '…') }
      kept.push(t)
      used += t.est
      truncated.push(cut.slice(0, 20))
      continue
    }
    dropped.push(f)
  }

  // 按原来的顺序还原，读起来才连贯
  kept.sort((a, b) => order[items.indexOf(a)] - order[items.indexOf(b)])
  return { kept, dropped, used, budget, truncated }
}
