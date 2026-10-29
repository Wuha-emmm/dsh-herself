// lib/outbound.mjs —— 她说出去的话，出门前扫一遍凭据形态
//
// 为什么需要：她的上下文里有 secrets/（deepseek.key、qq.json），
// 也可能看到别人贴的 key。模型一旦复述出来，那条消息就飞到群里了——不可撤回。
//
// 设计取舍：
//   · **只认前缀明确的形态**（sk-、ghp_、AKIA、PEM、JWT…），不做"像密钥就算"的模糊判断。
//     误杀正常对话（比如 32 位 hex 的 QQ 表情 id）比漏杀更糟——她会被自己的嘴绊住。
//   · 命中就**打码**，不是拒发：话照说，把那段换成 ***。这样既不泄露，也不让她突然哑掉。
//   · 纯函数，不读盘不读时钟，可回放。

const MASK = '***'

/** 每一条都要有明确的前缀/结构，避免误报 */
const PATTERNS = [
  { kind: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'sk- 密钥', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { kind: 'Bearer 令牌', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/g },
  { kind: 'GitHub 令牌', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: 'AWS 密钥', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: 'OneBot access_token', re: /\baccess_token=[A-Za-z0-9._-]{10,}/gi },
  { kind: '带密码的连接串', re: /\b[a-z]+:\/\/[^\s/@:]+:[^\s/@]{6,}@/gi },
]

/**
 * @param {string} text 她要说出去的话
 * @returns {{text:string, hits:string[]}} hits 是命中的类型（去重）
 */
export function redact(text = '') {
  const raw = String(text ?? '')
  const hits = []
  let out = raw
  for (const p of PATTERNS) {
    p.re.lastIndex = 0
    if (!p.re.test(out)) continue
    p.re.lastIndex = 0
    out = out.replace(p.re, MASK)
    if (!hits.includes(p.kind)) hits.push(p.kind)
  }
  return { text: out, hits }
}

/** 只要判断有没有，不要打码后的文本 */
export function looksSecret(text = '') {
  return redact(text).hits
}
