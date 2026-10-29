// lib/forget.mjs —— 遗忘：细节会冷，摘要留下，太老的只留结论
//
// 这个项目里「遗忘」不是删数据（事件流是 append-only），而是**派生时决定进不进她眼前**。
// 三层：
//   热（3 天内）：原话照给。
//   温（3~30 天）：如果那段时间有摘要，就给摘要这一句，不再逐字复述；
//                  没有摘要就照给，但会明说「这是好几天前的」。
//   冷（30 天以上）：只在**很确定**（分数高）时才给，而且同样只说摘要或一句话概括，
//                  避免她拿一个月前的一句玩笑当现在的证据。
//
// 纯函数：输入 hit 列表 + 摘要列表 + now，输出「该给她看的」和「被她忘掉的」。

export const COOL_AFTER_MS = 3 * 24 * 3600000
export const FORGET_AFTER_MS = 30 * 24 * 3600000
/** 冷记忆还值不值得说：分数要够高 */
export const COLD_KEEP_SCORE = 0.65

/**
 * @param {Array<{id:string, at:string, text:string, score:number, type?:string}>} hits 检索命中
 * @param {Array<{id:string, ts:string, text:string, meta?:object}>} summaries 摘要事件
 * @param {number} now
 * @returns {{keep:Array, folded:Array, dropped:Array}}
 *   keep   照原话给
 *   folded 被摘要顶替（给摘要那一句）
 *   dropped 太老又不确定，不给她看
 */
export function coolHits(hits = [], summaries = [], now = Date.now()) {
  const keep = []
  const folded = []
  const dropped = []

  for (const h of hits) {
    const at = Date.parse(h.at)
    if (!Number.isFinite(at)) { keep.push({ ...h, age: 'unknown' }); continue }
    const age = now - at

    if (age <= COOL_AFTER_MS) { keep.push({ ...h, age: 'hot' }); continue }

    // 找覆盖这段时间的摘要（同一条线、时间不早于这条命中）
    const sum = summaries
      .filter((s) => (s.meta?.thread ?? '') === (h.thread ?? '') || !h.thread)
      .filter((s) => (Date.parse(s.ts) || 0) >= at)
      .slice(-1)[0]

    if (age > FORGET_AFTER_MS) {
      if (Number(h.score) >= COLD_KEEP_SCORE) {
        folded.push({ ...h, age: 'cold', summary: sum?.text ?? '', note: '很久以前的事' })
      } else {
        dropped.push({ ...h, age: 'cold' })
      }
      continue
    }

    if (sum) { folded.push({ ...h, age: 'warm', summary: sum.text, note: '' }); continue }
    keep.push({ ...h, age: 'warm' })
  }

  return { keep, folded, dropped }
}

/** 给她看的那一行文字（keep 用原话，folded 用摘要） */
export function recallLine({ keep, folded }, now = Date.now(), slice = 90) {
  const parts = []
  for (const x of keep) {
    const mark = x.age === 'warm' ? '（好几天前）' : ''
    parts.push(`${mark}「${String(x.text).slice(0, slice)}」`)
  }
  for (const x of folded) {
    const body = x.summary ? `（${x.note || '那次聊过'}）${String(x.summary).slice(0, slice)}` : `（${x.note || '很久以前'}）「${String(x.text).slice(0, slice)}」`
    parts.push(body)
  }
  return parts.join('；')
}
