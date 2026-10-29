// lib/infer.mjs —— 事后解读：她说过的话里，有没有「拒绝 / 立场」的形状
//
// 这不是让她申报，是我们这边做笔记。
// 笔记永远标 inferred，永远不写成她自己的 refusal 事件。
// 门要开，需要「同一件事被推断出 ≥2 次」+「对方真的顶回来过」——行为与代价，不是一句声明。

const REFUSE_HINTS = /(反对|不接受|不认同|不同意|不喜欢|不想|不要|不愿意|谈不上|拒绝|别指望|用不着|没兴趣)/
const PUSHBACK = /(可是|但是|不过|为什么|必须|应该|一定要|就要|我反对|你错了|不行|别|偏要)/

/** 从她的原话里抽一个「她在反对什么」的短标签；抽不出就不记 */
export function inferClaim({ herText = '' } = {}) {
  const t = String(herText ?? '').trim()
  if (!t || t.length < 6) return null
  if (!REFUSE_HINTS.test(t)) return null

  let target = ''
  const quoted = t.match(/[「“"]([^」”"]{2,20})[」”"]/)
  if (quoted) {
    target = quoted[1]
  } else {
    const m = t.match(/(?:反对|不接受|不认同|不同意|不喜欢|不想|不要)(?:的)?(?:是|了)?([^，。；！？、]{2,16})/)
    if (m) target = m[1]
  }
  target = String(target).replace(/^[的是]/, '').trim()
  if (!target || target.length < 2) return null

  return {
    kind: 'refusal',
    target: target.slice(0, 20),
    confidence: 0.55,
    quote: t.slice(0, 80),
    inferred: true,
  }
}

/** 对方是不是在顶她（用于判「代价」） */
export function looksLikePushback(text = '') {
  return PUSHBACK.test(String(text ?? ''))
}

// ---------------------------------------------------------------- 她的作息偏好
function cnNum(s) {
  const t = String(s).trim()
  if (/^\d+$/.test(t)) return Number(t)
  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  if (t === '十') return 10
  if (t.includes('十')) {
    const [a, b] = t.split('十')
    return (map[a] ?? (a === '' ? 1 : 0)) * 10 + (map[b] ?? (b === '' ? 0 : 0))
  }
  return map[t] ?? null
}

/**
 * 从她的话里读「她想怎么被对待」：几点后安静、每天几次、别老发。
 * 只读作息，不读人格——她可以决定节奏，不能决定自己是谁。
 * @returns {{key:string, value:any, quote:string}|null}
 */
export function inferPreference(text = '') {
  const t = String(text ?? '').trim()
  if (t.length < 4) return null
  const quote = t.slice(0, 60)
  let m

  // 「十点以后别找我」→ fromHour = 10
  m = t.match(/([0-9一二三四五六七八九十]{1,3})\s*点\s*(?:以后|之后|后)(?![面边])/)
  if (m) {
    const h = cnNum(m[1])
    if (h != null && h >= 0 && h <= 23) return { key: 'fromHour', value: h, quote }
  }

  // 「十一点前别发」→ toHour = 11
  m = t.match(/([0-9一二三四五六七八九十]{1,3})\s*点\s*(?:以前|之前|前)(?![面边])/)
  if (m) {
    const h = cnNum(m[1])
    if (h != null && h >= 1 && h <= 24) return { key: 'toHour', value: h, quote }
  }

  // 「一天最多两次」
  m = t.match(/(?:每天|一天)[^。，,]{0,6}?(?:最多|只要|就)?\s*([0-9一二三四五六七八九十]{1,2})\s*次/)
  if (m) {
    const n = cnNum(m[1])
    if (n != null && n >= 1 && n <= 12) return { key: 'maxPerDay', value: n, quote }
  }

  // 「别老找我」「少发点」
  if (/(别老|别总|少发|别烦|别吵|别打扰|不用天天)/.test(t)) {
    return { key: 'sendPerDay', value: 0, quote }
  }

  return null
}
