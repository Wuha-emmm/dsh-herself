// lib/semantic.mjs —— 语义层：把她的原话蒸馏成「一个可以被推翻的判断」
//
// 为什么要这一层：derive 以前把她的**每一条回话**都当判断（123 条里大半是
// 「哪儿奇怪？」「你光说有趣我接不住」）。那不是判断，是对话。
// 判断要有两样东西：一句能被后来的事推翻的话，和**它当初是冲着哪件事说的**（证据）。
//
// 分寸：宁可漏，不可猜。蒸馏不出来就不记；记错了会污染她以后「改口」的对象。
//
// 分工：这里是唯一碰模型的地方；其余（挑不挑、证据长什么样、JSON 怎么解析）
// 全是纯函数，方便回放和单测。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendEvent } from './store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const KEY_FILE = path.join(here, '..', 'secrets', 'deepseek.key')
const API = 'https://api.deepseek.com/chat/completions'

/** 值得花一次模型调用去蒸馏的句子：先粗筛，省钱也省延迟 */
const OPINION_HINTS = /(我(觉得|认为|看|认|不认|不信|不干|不接)|不该|应该|根本|从来|就是|只会|不能|没必要|才算|别想|凭什么|说白了|其实是|而不是|等于)/

export function looksOpinionated(herText = '') {
  const t = String(herText ?? '').trim()
  if (t.length < 12) return false
  if (!OPINION_HINTS.test(t)) return false
  // 纯提问不是判断（但「你就不能…？」这种反问算，所以只滤掉短问句）
  if (t.length < 24 && /[？?]$/.test(t)) return false
  return true
}

/** 证据：把事件 id 变成能给她看的一句话 */
export function evidenceOf(events = [], ids = []) {
  const set = new Set(ids.filter(Boolean))
  return events
    .filter((e) => set.has(e.id))
    .map((e) => ({ id: e.id, at: e.ts, text: String(e.text ?? '').slice(0, 160) }))
}

export function buildPrompt({ userText = '', herText = '', evidence = [] } = {}) {
  const ev = evidence.map((e) => `- ${e.text}`).join('\n') || '（没有记到具体的事）'
  return [
    '下面是「他」对她说的话、她当时的回话，以及她回话前发生的事。',
    '如果她在回话里下了一个「以后可能被推翻的判断」，把它蒸馏成一句不超过 40 字的陈述。',
    '',
    '什么算判断：一句脱离这段对话也成立的话，讲的是这个世界或她自己的看法，以后可能被证明错了。',
    '什么不算（claim 一律输出 null）：',
    '  · 只是在确认/复述对方说的话（「行，这句我收了：没含义」）',
    '  · 追问、要对方补信息的（「哪儿奇怪？」「你光说有趣我接不住」）',
    '  · 要求做某件事、发表情的（「我看看这张图」）',
    '  · 带「这句/那句/刚才/这回/你说的」这类指代的——那不是判断，是当下的对话',
    '  · 讲「我刚才怎么说话 / 我是怎么回的」这类对话本身的——那是回声，不是判断',
    '',
    '正例：她说「删之前你不问她一句，就是不认她有东西属于自己」',
    '  → {"claim":"删别人的东西之前要先问，那是她自己的东西。"}',
    '正例：她说「越熬越精神，这是身体在骗你，把最后的劲都提前拿出来了」',
    '  → {"claim":"熬夜越精神是身体提前把最后的劲拿出来。"}',
    '反例：她说「行，这句算交代清楚了——就是表情包里那个动作」',
    '  → {"claim":null}',
    '',
    '只输出 JSON，不要解释，不要代码块：{"claim":"…"} 或 {"claim":null}',
    '',
    '他说：「' + String(userText).slice(0, 400) + '」',
    '她说：「' + String(herText).slice(0, 400) + '」',
    '她回话前发生的事：',
    ev,
  ].join('\n')
}

/** 带指代的句子不可能是判断：它离开这段对话就不成立了 */
const DEICTIC = /(这句|那句|这一句|那一段|刚才|这回|这次|你说的|他说的|上面|前面那)/

/** 讲「我刚才怎么说话」的不是判断，是对话本身的回声（真机上被它顶掉过 140 条） */
const META_TALK = /^(我|她)(回|说|答|解释|补充|收|认|问)/

/** 干净地把模型输出读成 {claim, why}；读不懂就返回 null（不猜） */
export function parseClaim(raw = '') {
  let t = String(raw ?? '').trim()
  if (!t) return null
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  let j = null
  try { j = JSON.parse(t.slice(s, e + 1)) } catch { return null }
  const claim = typeof j?.claim === 'string' ? j.claim.trim() : ''
  if (!claim || claim.length < 4) return null
  if (/^(null|none|无)$/i.test(claim)) return null
  // 判据要能脱离这段对话成立；带指代、或讲对话本身的，一律不记（宁可漏）
  if (DEICTIC.test(claim)) return null
  if (META_TALK.test(claim)) return null
  return { claim: claim.slice(0, 80), why: String(j?.why ?? '').slice(0, 200) }
}

/** 蒸馏一次。失败返回 null——语义层坏了，她的话照说。 */
export async function distill({ userText = '', herText = '', evidence = [] } = {}) {
  if (!looksOpinionated(herText)) return null
  let k = ''
  try { k = fs.readFileSync(KEY_FILE, 'utf8').trim() } catch { return null }
  if (!k) return null
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k },
      body: JSON.stringify({
        model: 'deepseek-flash',
        thinking: { type: 'disabled' },
        temperature: 0.2,
        max_tokens: 200,
        messages: [{ role: 'user', content: buildPrompt({ userText, herText, evidence }) }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return null
    const j = await r.json().catch(() => ({}))
    const out = String(j?.choices?.[0]?.message?.content ?? '')
    const parsed = parseClaim(out)
    if (!parsed) return null
    return { ...parsed, distilled: 'llm' }
  } catch {
    return null
  }
}

/**
 * 蒸馏 + 落盘：一条 claim 事件，refs 指向她说那句话的事件，evidence 指向她当时在回的那件事。
 * 这是语义层唯一的写入口；think 只是在说完话之后顺手调它。
 * @returns {Promise<{claim:string, event:object}|null>}
 */
export async function recordClaim({ root, utteranceId = '', causeId = '', userText = '', herText = '', events = [] } = {}) {
  if (!looksOpinionated(herText)) return null
  const evidence = evidenceOf(events, causeId ? [causeId] : [])
  const c = await distill({ userText, herText, evidence })
  if (!c) return null
  const event = appendEvent(root, {
    type: 'claim',
    actor: 'self',
    surface: 'qq',
    text: c.claim,
    ...(utteranceId ? { refs: [utteranceId] } : {}),
    ...(causeId ? { evidence: [causeId] } : {}),
    meta: { why: c.why, distilled: c.distilled, inferred: true },
  })
  return { claim: c.claim, event }
}
