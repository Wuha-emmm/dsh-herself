import { synonymTokens } from './synonyms.mjs'

// lib/recall.mjs —— 检索 v2：BM25 + 强度门控（**先不接线**，用 tools/recall-dryrun.mjs 预演）
//
// 为什么要换掉现在的 retrieve()：
//   · 现在 = 二元组命中数 ×2 + 14 天半衰。实测问「上个月那家咖啡店」（她没聊过咖啡店），
//     照样返回 4 条全无关的东西，188 token 每轮塞进提示词——**自信地错**。
//   · 半衰让三个月前的东西注定翻不出来，正好撞在欠账②的验收点上。
//
// 这一版的三条主张：
//   1. BM25 + IDF：稀有词（人名、地名、专有名词）天然权重高，高频虚词直接丢；
//   2. **不惩罚年代**：打分完全不读时间，同内容不同年代同分；
//   3. **强度门控**：不够确定就**不注入**，宁可让她说"我想不起来"，也不塞一堆不相干的。
//
// 中文的特殊麻烦：二元组会跨词边界造出「站那」「个刷」这种稀有但没意义的碎片。
// 所以「够确定」要求：分数过线 + 覆盖率过线 + **稀有词命中 ≥2 个**（或整句 6 字连续重合）。
// 参考实现用的是「线索里必须含拉丁词」，那个对纯中文场景太严，这里换掉。

/* ------------------------------------------------------------------ 分词 */

/** 拉丁词（≥2 字符）+ 中文二元组。保留重复，供 BM25 算词频。 */
export function tokenList(text = '') {
  const s = String(text ?? '').toLowerCase()
  const out = []
  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.push(w)
  for (const run of s.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) out.push(run)
    for (let i = 0; i + 1 < run.length; i += 1) out.push(run.slice(i, i + 2))
  }
  return out
}

/** 默认参数。都是工程初值，不是准确率承诺——用 dryrun 校准。 */
export const RECALL_DEFAULTS = Object.freeze({
  k1: 1.4,
  b: 0.7,
  // 参数是对着她 792 条真实事件扫出来的（tools/recall-sweep.mjs），不是拍脑袋：
  // 6 条「该命中」+ 5 条「该静默」，这一组是 6/6 + 5/5。
  maxDfRatio: 0.08,     // 出现在超过 8% 文档里的词 = 噪声，直接丢（什么/不是/自己这种）
  rareDfRatio: 0.05,    // 出现在 ≤5% 文档里的词 = 稀有词
  minScore: 0.45,       // 0.32 太松：泛词凑一凑就过线
  minCoverage: 0.35,
  minRare: 2,           // 至少几个稀有词命中才算「定位到了」
  quoteLen: 6,          // 整句 6 字连续重合也算强证据
  // 「特定词」按**文档数**判，不按比例：比例对语料规模太敏感——
  // 64 条语料里「杭州」占 1.6%，792 条里占 0.13%，同一个词两种命运。
  specificDfRatio: 0.01,
  specificDfMin: 3,     // 但至少给 3 个文档的额度，小语料才不会全军覆没
  maxUnknownRatio: 0.75, // 线索里几乎每个词她都没见过（≥75%）→ 这事没聊过（只做极端兜底）
  maxCandidates: 12,
  maxItems: 3,
  maxChars: 360,        // 注入进去的总字数上限
})

/* ------------------------------------------------------------------ 建索引 */

const CONTENT_TYPES = new Set(['utterance', 'encounter', 'refusal', 'revision', 'narration'])

/**
 * @param {object[]} events 事件流（live 过的更好，但 tombstone 掉的也能靠调用方过滤）
 * @returns {{entries:Array, postings:Map, df:Map, total:number, avgdl:number}}
 */
export function buildIndex(events = []) {
  const entries = []
  const postings = new Map()
  const df = new Map()
  const chars = new Set()      // 语料里出现过的所有汉字（判断「她连这个字都没见过」）
  let totalTokens = 0

  for (const e of events) {
    if (!CONTENT_TYPES.has(e.type)) continue
    const text = String(e.text ?? '')
    if (!text) continue
    for (const ch of text) if (/[\u3400-\u9fff]/.test(ch)) chars.add(ch)
    const toks = tokenList(text)
    if (!toks.length) continue
    const tf = new Map()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    const idx = entries.length
    entries.push({ event: e, tf, len: toks.length })
    totalTokens += toks.length
    for (const t of tf.keys()) {
      if (!postings.has(t)) postings.set(t, [])
      postings.get(t).push([idx, tf.get(t)])
      df.set(t, (df.get(t) ?? 0) + 1)
    }
  }

  return {
    entries,
    postings,
    df,
    chars,
    total: entries.length,
    avgdl: entries.length ? totalTokens / entries.length : 0,
  }
}

/* ------------------------------------------------------------------ 打分 */

function bigramsOf(text) {
  const set = new Set()
  for (const t of tokenList(text)) if (t.length === 2 && /[\u3400-\u9fff]/.test(t)) set.add(t)
  return set
}

/** 整句里有没有 6 个字以上连续重合（对中文比单靠稀有词更硬） */
function quoteHit(cue, text, n = RECALL_DEFAULTS.quoteLen) {
  const a = String(cue ?? '').replace(/\s+/g, '')
  const b = String(text ?? '').replace(/\s+/g, '')
  if (a.length < n || b.length < n) return false
  for (let i = 0; i + n <= b.length; i += 1) {
    if (a.includes(b.slice(i, i + n))) return true
  }
  return false
}

/**
 * 按线索检索。**不看时间**——旧事不会因为年头久就被压下去。
 * @returns {{status:'matched'|'ambiguous'|'not_found'|'no_cue', items:Array, candidates:Array, debug:object}}
 */
export function search(index, cue, opts = {}) {
  const cfg = { ...RECALL_DEFAULTS, ...opts }
  const cueText = String(cue ?? '').trim()
  const empty = { status: 'no_cue', items: [], candidates: [], debug: { cue: cueText } }
  if (!cueText) return empty

  // 她从没见过的词，先按同义字换一遍再找（'回两条' ↔ '发两条'）
  const qTokens = [...new Set(tokenList(cueText))].flatMap((t) => {
    const seen = index.postings.get(t)?.length
    return seen ? [t] : [t, ...synonymTokens(t)]
  })
  if (!qTokens.length) return empty
  /** 「特定词」的文档数上限：语料小时给 3 个名额，语料大时按 1% 走 */
  const specMax = Math.max(cfg.specificDfMin, Math.round(index.total * cfg.specificDfRatio))

  const scores = new Map()
  const covers = new Map()
  const specHit = new Set()   // 命中了「特定词」（df ≤ specMax）的文档下标
  let maxIdf = 0
  let rareHits = 0
  const usedTokens = []
  const unknown = []

  for (const t of qTokens) {
    const list = index.postings.get(t)
    if (!list || !list.length) { unknown.push(t); continue }   // 她从没见过的词
    const dfRatio = list.length / Math.max(1, index.total)
    if (dfRatio > cfg.maxDfRatio) continue          // 虚词/泛词：不当证据
    const idf = Math.log(1 + (index.total - list.length + 0.5) / (list.length + 0.5))
    maxIdf += idf
    usedTokens.push({ token: t, df: list.length, idf: Number(idf.toFixed(3)), rare: dfRatio <= cfg.rareDfRatio })
    if (dfRatio <= cfg.rareDfRatio) rareHits += 1
    const isSpecific = list.length <= specMax

    for (const [idx, tf] of list) {
      const entry = index.entries[idx]
      const norm = 1 - cfg.b + (cfg.b * entry.len) / Math.max(1, index.avgdl)
      const partial = idf * ((tf * (cfg.k1 + 1)) / (tf + cfg.k1 * norm))
      scores.set(idx, (scores.get(idx) ?? 0) + partial)
      covers.set(idx, (covers.get(idx) ?? 0) + idf)
      if (isSpecific) specHit.add(idx)
    }
  }

  const ranked = []
  for (const [idx, raw] of scores) {
    const entry = index.entries[idx]
    const score = maxIdf > 0 ? Math.min(1, raw / maxIdf) : 0
    const coverage = maxIdf > 0 ? Math.min(1, (covers.get(idx) ?? 0) / maxIdf) : 0
    const quote = quoteHit(cueText, entry.event.text)
    // 「特定」看的是**命中的这条文档里**有没有专名，不是线索里有没有
    const specific = specHit.has(idx) || quote
    ranked.push({ entry, score, coverage, quote, specific })
  }
  // 只用分数排序，同分按 id 升序（稳定、可复现；**没有时间项**）
  ranked.sort((a, b) => b.score - a.score || (a.entry.event.id < b.entry.event.id ? -1 : 1))

  const best = ranked[0]
  // 线索里有「她连字都没见过」的词吗？——「咖啡」「天气」这种。
  // 二元组会造出跨词碎片（么你、还记），按碎片判会误伤真匹配；按**字**判稳得多：
  // 「那天你说仓库……」里的字她全见过，只是没这么连过，所以不算「没聊过」。
  const novel = unknown.filter((t) => [...t].every((ch) => /[\u3400-\u9fff]/.test(ch) && !index.chars.has(ch)))
  const unknownRatio = qTokens.length ? unknown.length / qTokens.length : 0
  const unseen = novel.length >= 1 || unknownRatio >= cfg.maxUnknownRatio
  // 命中的那条必须带一个「特定词」（人名/地名/专名）或整句连续重合，
  // 否则「今天天气怎么样」这种泛问也会凑出一条旧事。
  const specific = Boolean(best?.specific)
  const strong = Boolean(best) && !unseen && specific
    && best.score >= cfg.minScore && best.coverage >= cfg.minCoverage
    && (rareHits >= cfg.minRare || best.quote)

  const toItem = (r) => ({
    id: r.entry.event.id,
    at: r.entry.event.ts,
    type: r.entry.event.type,
    text: String(r.entry.event.text ?? '').slice(0, 160),
    score: Number(r.score.toFixed(3)),
    coverage: Number(r.coverage.toFixed(3)),
  })

  const candidates = ranked.slice(0, cfg.maxCandidates).map(toItem)

  const debug = {
    cue: cueText,
    usedTokens,
    rareHits,
    unknown,
    unknownRatio: Number(unknownRatio.toFixed(2)),
    bestScore: best ? Number(best.score.toFixed(3)) : 0,
    bestCoverage: best ? Number(best.coverage.toFixed(3)) : 0,
    quote: Boolean(best?.quote),
    strong,
  }

  if (!strong) {
    // 有候选但不够确定：如实说"没把握"，让她问一句，而不是硬塞
    return { status: candidates.length ? 'ambiguous' : 'not_found', items: [], candidates, debug }
  }

  // 取够确定的前几条，受条数与字数双上限
  const items = []
  let chars = 0
  for (const r of ranked) {
    if (items.length >= cfg.maxItems) break
    if (r !== best && r.score < cfg.minScore) break
    const len = String(r.entry.event.text ?? '').length
    if (chars + len > cfg.maxChars) continue
    chars += len
    items.push(toItem(r))
  }
  return { status: items.length ? 'matched' : 'ambiguous', items, candidates, debug }
}

/** 便捷入口：临时建索引再查（900 条量级也就几毫秒） */
export function recall(events, cue, opts = {}) {
  const idx = buildIndex(events)
  return { ...search(idx, cue, opts), indexed: idx.total }
}
