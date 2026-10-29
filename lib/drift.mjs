// lib/drift.mjs —— 漂移体检：她还是不是同一个她
//
// 这个指标**不是**"她变没变好"，而是"她的表达/关注点有没有悄悄跑到别处去"。
// 做法很朴素：把一段时间里她自己说的话做词频指纹，和上一次基线比 Jaccard 相似度。
//   · 掉太多 = 换了个话题世界（可能被最近的对话带跑）
//   · 涨太多 = 复读（一直围着同一件事转）
// 纯词法，不碰模型，所以能离线、能回放、能天天跑。
//
// 已知边界：词法漂移 ≠ 语义漂移。她换同义词、换语气，这里看不出来。
// 真要看语义，得上模型抽样对比——那是另一次投入，不在这一层假装。

/** 中文二元组 + 英文词，去停用词后计数 */
const STOP = new Set(['我们', '你们', '他们', '什么', '这个', '那个', '就是', '不是', '可以', '一个', '因为', '所以', '还是', '已经', '没有', '自己', '现在', '时候', '这样', '那样'])

export function tokenCounts(text = '') {
  const s = String(text ?? '').toLowerCase()
  const out = new Map()
  const bump = (t) => out.set(t, (out.get(t) ?? 0) + 1)
  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) bump(w)
  for (const run of s.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const t = run.slice(i, i + 2)
      if (!STOP.has(t)) bump(t)
    }
  }
  return out
}

/**
 * 取一段时间的指纹。
 * @param {object[]} events live 过的事件
 * @param {{from?:number, to?:number, maxChars?:number}} opts
 */
export function fingerprint(events = [], { from = 0, to = Infinity, maxChars = 20000 } = {}) {
  let chars = 0
  const counts = new Map()
  for (const e of events) {
    if (e.type !== 'utterance') continue
    const ts = Date.parse(e.ts) || 0
    if (ts < from || ts > to) continue
    const text = String(e.text ?? '')
    if (!text) continue
    chars += text.length
    for (const [k, v] of tokenCounts(text)) counts.set(k, (counts.get(k) ?? 0) + v)
    if (chars >= maxChars) break
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
  return { at: new Date().toISOString(), chars, tokens: Object.fromEntries(top), size: counts.size }
}

/** 两份指纹差多少（0 = 完全一样，1 = 毫无交集） */
export function compare(a, b) {
  const A = new Set(Object.keys(a?.tokens ?? {}))
  const B = new Set(Object.keys(b?.tokens ?? {}))
  if (!A.size || !B.size) return { jaccard: 0, gained: [], lost: [], note: '有一边是空的，比不了' }
  let inter = 0
  for (const t of A) if (B.has(t)) inter += 1
  const union = A.size + B.size - inter
  const gained = [...B].filter((t) => !A.has(t)).slice(0, 12)
  const lost = [...A].filter((t) => !B.has(t)).slice(0, 12)
  return { jaccard: union ? inter / union : 0, gained, lost }
}

/** 判断这次漂移要不要当回事 */
export function verdict(j = 0) {
  if (j >= 0.5) return { level: 'ok', text: '和基线差不多' }
  if (j >= 0.3) return { level: 'watch', text: '有点偏了，留意最近在聊什么' }
  return { level: 'alert', text: '偏得厉害：她最近关注的东西和基线差很多' }
}
