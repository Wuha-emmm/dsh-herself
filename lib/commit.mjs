// lib/commit.mjs —— 关系记忆：只记她真的许下的事
//
// 教训（2026-10-29）：上一版把「回头/下次/记着」全算承诺，结果
//   · 她复述我们注入的「你还没了的事」，又被抽成一条新承诺 → 回声
//   · 「回头我看看」这种软话也入表 → 噪音
// 宁可漏，不可错——错记一条会污染她之后所有的判断。

// 2026-10-29 第二次收：三条承诺全是误抽，都栽在「答应」这个词上——
//   「你答应过的、改口的」（在列举类别）、「答应下来的事」（名词短语）、「并没有答应什么」（否定）。
// 所以「答应」必须是她**第一人称**说的，而且不能是"答应过的/答应下来的"这种名词用法。
const NEG = /(你|他|她|没|不|并没有|别)\s*答应|答应(过|下来|的)/

const STRONG = [
  /(?:^|[，。！？\s])(?:我|咱)?说好了?/,
  /(?:^|[，。！？\s])(?:我|咱)?答应/,                        // 答应你…／我答应…
  /(?:我|咱)\s*保证/,                     // 我保证…
  /这笔账我记/,
  /(?:回头|下次|明天|等会)(?:我)?(?:给|帮|带|还|补|把|来|去)/,   // 得带具体动作
]

const NOISE = [
  /你还没了的事/,      // 我们注入的标题
  /你之前提过/,
  /^[（(]/,            // 括号旁注
  // 2026-10-29 追加：她在**追问对方**，不是她在许事。
  // 实测一条这样的文本被旧版规则写成了承诺，然后追了主人三个小时。
  /交底|撂下|别光/,
]

/** 从她的话里抽一条承诺；没有就返回 null */
export function extractCommitment(text = '') {
  const t = String(text ?? '').trim()
  if (t.length < 8) return null
  if (NOISE.some((re) => re.test(t))) return null
  if (NEG.test(t)) return null   // 「你答应过的」「并没有答应什么」都不算她许诺
  if (!STRONG.some((re) => re.test(t))) return null
  return { text: t.slice(0, 120) }
}

/** 一条承诺最多在她眼前挂多久（小时）。超过就当她放下了——原文还在流里，只是不再催。 */
export const COMMIT_TTL_HOURS = 6
/** 一次最多挂几条：多了她会变成催债的 */
export const COMMIT_MAX = 2

/**
 * 未结的承诺（去重 + 过期 + 限量）。
 *
 * 为什么要有 TTL：没有关闭机制的承诺会变成复读机。
 * 2026-10-29 实测——一条 11:14 误抽的"承诺"让她在之后三个小时里，
 * 每句话都要绕回同一件事（连主人问"你上下文多长"都要追一句）。
 * 承诺是"她答应要做的事"，不是"她永远记仇的事"。
 */
export function openCommitments(events = [], { now = Date.now(), ttlHours = COMMIT_TTL_HOURS, max = COMMIT_MAX } = {}) {
  const ttl = ttlHours * 3600000
  const seen = new Set()
  const out = []
  for (const e of events) {
    if (e.type !== 'commitment' || e.meta?.status === 'done') continue
    const at = Date.parse(e.ts)
    if (Number.isFinite(at) && now - at > ttl) continue
    const key = String(e.text ?? '').replace(/\s+/g, '').slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out.slice(-max)
}
