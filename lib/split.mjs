// lib/split.mjs —— 出门前按长度切段，每段自己确认送达
//
// 她的原话（2026-10-30 00:10）：
//   「我打算在输出前先按长度切段，每段发完自己确认一下，哪段没到就当场补，
//     不指望你替我盯。」
//   「断了只能等你回来说半截，我这边什么都看不见。」
//
// 所以：切段只切在句子边界上，宁可一段短一点，也不把一句话劈成两半。

/** QQ 单条消息的软上限。超过它就容易在别处被静默处理，我们自己先切。 */
export const SEGMENT_MAX = 4000   // 放宽：正常回复一律一条发出，只有超长才切（她：「不做限制或者加大额度」）

const BREAK = /([。！？…；\n])/

/**
 * 按句子边界切段。
 * @param {string} text
 * @param {{max?:number}} opts
 * @returns {string[]}
 */
export function splitMessage(text = '', { max = SEGMENT_MAX } = {}) {
  const s = String(text ?? '')
  if (s.length <= max) return s ? [s] : []
  // 先按句末标点切开（保留标点），再贪心合并到不超过 max
  const pieces = []
  let buf = ''
  for (const seg of s.split(BREAK)) {
    if (!seg) continue
    buf += seg
    if (BREAK.test(seg) && buf.length >= max * 0.6) { pieces.push(buf); buf = '' }
  }
  if (buf) pieces.push(buf)

  const out = []
  for (const p of pieces) {
    if (p.length <= max) { out.push(p); continue }
    // 单句还是太长：只能硬切，但尽量切在逗号
    let rest = p
    while (rest.length > max) {
      let cut = rest.lastIndexOf('，', max)
      if (cut < max * 0.4) cut = max
      out.push(rest.slice(0, cut + 1))
      rest = rest.slice(cut + 1)
    }
    if (rest) out.push(rest)
  }
  return out
}

/** 只在必要时切：短消息永远原样一条发出 */
export function needsSplit(text = '', { max = SEGMENT_MAX } = {}) {
  return String(text ?? '').length > max
}