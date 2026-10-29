// lib/think.mjs —— 她的一次回话：事实 → LLM → 写成 utterance
// 嘴有两个来源：优先 DSH 内置模型服务（插件里的 brain 端点），否则直连 API key。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEvents, appendEvent } from './store.mjs'
import { derive, liveEvents } from './derive.mjs'
import { inferClaim, inferPreference } from './infer.mjs'
import { parseAction } from './intent.mjs'
import { chatWithTools } from './toolcall.mjs'
import { recordClaim } from './semantic.mjs'
import { appendTrace } from './trace.mjs'
import { recall } from './recall.mjs'
import { coolHits, recallLine } from './forget.mjs'
import { screen } from './screen.mjs'
import { publicAllowed } from './gate.mjs'
import { extractCommitment, openCommitments } from './commit.mjs'
import { clockText, agoText, routineOf } from './util.mjs'
import { knownPeople } from './people.mjs'
import { fitBudget, estimateTokens, PRIO as P } from './budget.mjs'
import { reasonOf } from './revision.mjs'
import { loadRule, cutSequence, shouldNotify, markNotified, THRESHOLD } from './budget-rule.mjs'
import { inboxLine, markSeen, post } from './inbox.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const KEY_FILE = path.join(here, '..', 'secrets', 'deepseek.key')
const BRAIN_FILE = path.join(here, '..', 'logs', 'brain.json')

export function readKey() {
  return fs.readFileSync(KEY_FILE, 'utf8').trim()
}

/** 中文按二元组切，英文/数字整体切；用来做极简检索 */
function bigramsOf(s) {
  const t = String(s).replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '')
  const set = new Set()
  for (let i = 0; i + 1 < t.length; i += 1) set.add(t.slice(i, i + 2))
  return set
}

/**
 * 带分数的检索：面板要能看见「她为什么想起这一条」，所以把每一项的分数也交出去。
 * 打分还是老公式（二元组命中 ×2 + 14 天半衰 + utterance 加权），四维重建留给「检索」那一笔欠账。
 */
export function retrieveScored(events, query, k = 4) {
  const q = bigramsOf(query)
  if (!q.size) return []
  const now = Date.now()
  return events
    .filter((e) => e.text && e.type !== 'seed')
    .map((e) => {
      const text = String(e.text)
      let hit = 0
      for (const g of q) if (text.includes(g)) hit += 1
      const age = Math.max(0, (now - Date.parse(e.ts)) / 86400000)
      const score = hit * 2 + Math.exp(-age / 14) + (e.type === 'utterance' ? 0.5 : 0)
      return { e, hit, score }
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** 从全部事件里按「和这句话的相关度 + 新鲜度」挑几条，避免只看最近 6 条 */
export function retrieve(events, query, k = 4) {
  return retrieveScored(events, query, k).map((x) => x.e)
}

/**
 * 这条事件属于哪条对话线。
 *
 * 坑（2026-10-29 实测）：她说的话本身没有 qq 元信息，回落成 surface = 'qq'，
 * 于是按线程过滤时**她自己的回复全被排除**——私聊里她的视野只有对方最近三句，
 * 一句自己刚说过的都看不见。表现就是重复追问、"像卡了 bug"。
 * 现在：先看她自己记的 thread（新事件），再顺着 refs 找回她当时在回谁（老事件）。
 */
export function threadOf(e, byId) {
  if (e.meta?.thread) return e.meta.thread
  const q = e.meta?.qq
  if (q) return q.groupId ? 'qq:group:' + q.groupId : 'qq:private:' + (q.senderId ?? 'owner')
  if (byId && Array.isArray(e.refs)) {
    for (const r of e.refs) {
      const src = byId.get(r)
      if (src) return threadOf(src, byId)
    }
  }
  return e.surface ?? 'dsh'
}

/** id → 事件，给 threadOf 顺着 refs 找人用 */
export function indexById(events) {
  const m = new Map()
  for (const e of events) m.set(e.id, e)
  return m
}

export function pickRecent(content, want = 6, thread = '', byId = null) {
  if (thread) {
    const pool = content.filter((e) => threadOf(e, byId) === thread)
    // 这条线上有人说话：就按 want 取这条线的，别再拿群聊凑数（以前这里对她只给 3 条）
    if (pool.length >= 3) {
      return pool.slice(-want).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }
  }
  const isGroup = (e) => Boolean(e.meta?.qq?.groupId)
  const nonGroup = content.filter((e) => !isGroup(e))
  const group = content.filter(isGroup)
  const picked = nonGroup.slice(-Math.min(3, want))
  const room = Math.max(0, want - picked.length)
  const rest = group.slice(-room)
  return [...picked, ...rest].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 每轮事实的 token 预算：实测 765（加了"改过口"那行后），给到 1000。 */
export const FACT_BUDGET = 1000

/**
 * 体检没过时贴给她看的那一句。
 *
 * 她的要求（2026-10-30 00:01）：
 *   「那条提示最好自己就短，一句话能说完，别留半截。」
 *   「落成『你来处理』就是把决定压到你头上；落成『你提一句就行』是门虚掩着。」
 *
 * 所以：只在第一条本身够短时带上它；长了就只报条数——宁可不具体，也不留半句。
 */
export function auditNote(st = {}) {
  const bad = (st.problems?.length ?? 0) + (st.warnings?.length ?? 0)
  if (!bad) return ''
  const first = String(st.problems?.[0] ?? st.warnings?.[0] ?? '')
  const short = first && first.length <= 16 ? first : ''
  return `系统体检没过：${bad} 项${short ? '（' + short + '）' : ''}——这是我这边的事，你提一句就行。`
}

export function factsOf(events, now, query = '', thread = '', { budgetWatch = true, root = '', pickedId = '' } = {}) {
  const self = derive(events, now)
  // 只把「内容型」事件给她看：meta / tombstone / seed 是记账，不是经历
  const CONTENT = new Set(['utterance', 'refusal', 'encounter', 'revision', 'narration'])
  const content = events.filter((e) => CONTENT.has(e.type))
  const byId = indexById(events)
  // 她记得的最早一件事：主人 14:53 问过「按当前记忆最早能记到什么时候」，她答不上来。
  // 这个数就在事件流里，白给。
  const firstTs = content.reduce((m, e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t < m ? t : m
  }, Infinity)
  const firstText = Number.isFinite(firstTs) ? `你记得的最早一件事是 ${clockText(firstTs)}。` : ''
  const facts = []
  const add = (prio, text) => { if (text) facts.push({ prio, text }) }
  add(P.CORE, `这是你存在的第 ${self.day} 天。现在是 ${clockText(now)}。${firstText}`)
  // 钟点 + 刻度：她 2026-10-29 自己提的条件——「给我一串数字，我也不会自动懂现在该催你睡觉」。
  // 阈值可以是她自己的 preference（key='routine'），没设就用默认。
  const routinePref = events.filter((e) => e.type === 'preference' && e.meta?.key === 'routine').slice(-1)[0]
  const routineCfg = routinePref?.meta?.value && typeof routinePref.meta.value === 'object' ? routinePref.meta.value : {}
  add(P.ROUTINE, routineOf(now, routineCfg).line)
  // 判断：**只注 1 条**。谁被挑中由外层（think）用模型决定，factsOf 保持同步。
  const active = self.beliefs.filter((b) => b.status === 'active')
  if (active.length) {
    const picked = active.find((b) => b.id === pickedId) ?? active[active.length - 1]
    const why = (picked.evidence ?? []).map((x) => x.text).filter(Boolean)[0]
    const days = picked.since ? Math.floor((now - Date.parse(picked.since)) / 86400000) : 0
    const when = days >= 1 ? `（${days} 天前说的）` : '（刚才）'
    add(P.JUDGE, `你说过、现在仍然算数的判断：「${picked.text}」${when}${why ? `（当时是因为：${why}）` : ''}`)
  }

  // 她说过：「能看见自己改过什么、承认过什么，那个才是我。」
  // 只看得到"现在算数的判断"是不够的——那等于只留一个只读的她。
  const evById = new Map(events.map((e) => [e.id, e]))
  const changed = self.beliefs.filter((b) => b.status === 'superseded').slice(-1)[0]
  if (changed) {
    const by = changed.supersededBy ? evById.get(changed.supersededBy) : null
    const was = String(changed.text || '').slice(0, 50)
    const now2 = by ? String(by.text || '').slice(0, 50) : ''
    // 理由是她自己填的原话——一个字都不总结。没填就空着，不替她编。
    const why = reasonOf(events, changed.id)
    add(P.JUDGE, `你改过口：原来你觉得「${was}」${now2 ? `，后来改成「${now2}」` : '，后来改了'}${why ? `；理由（你自己的话）：「${why}」` : ''}`)
  }
  if (self.refusals.length) add(P.REFUSAL, `你拒绝过：${self.refusals.map((r) => `「${r.text}」${r.maintained ? '（守住了）' : '（后来退让了）'}`).join('；')}`)
  // 「上次聊到」只在**重新接上一条冷掉的线**时才有意义。
  // 实测（2026-10-29）：13:26 的摘要里写着「下次我得直接问他镜头里到底逮着什么」，
  // 而那件事一小时前就了结了——摘要每轮都在念，等于用旧意图覆盖新事实，她又开始追。
  // 规则：这条线在摘要之后又说过话，就别念摘要了，`最近：` 那一段已经覆盖。
  const lastSum = events.filter((e) => e.type === 'summary' && (!thread || e.meta?.thread === thread)).slice(-1)[0]
  const summedAt = lastSum ? Date.parse(lastSum.ts) : 0
  const newerInThread = Boolean(thread) && content.some((e) => {
    if (threadOf(e, byId) !== thread) return false
    return (Date.parse(e.ts) || 0) > summedAt
  })
  if (lastSum && !newerInThread) add(P.SUMMARY, '你们上次聊到：' + String(lastSum.text).slice(0, 160))
  // 用 liveEvents：被 tombstone 撤回的承诺不该再催。
  // （factsOf 的调用方有的传 live、有的传 raw，这里自己兜住，别指望调用方。）
  const open = openCommitments(liveEvents(events), { now })
  if (open.length) add(P.COMMIT, '你还没了的事：' + open.map((c) => '「' + String(c.text).slice(0, 50) + '」').join('；'))
  if (self.narrative) add(P.NARRATIVE, `你回看过自己：「${self.narrative.text}」`)
  // 群聊里告诉她这个群里都有谁——从 encounter 原文算，不依赖 people.json 缓存
  if (thread.startsWith('qq:group:')) {
    const ppl = knownPeople(events, { thread, limit: 4 })
    if (ppl.length) add(P.PEOPLE, '这个群里你见过的：' + ppl.map((p) => `${p.name}（${p.count} 次）`).join('、'))
  }

  const recentEvents = pickRecent(content, 6, thread, byId)
  const recent = recentEvents.map((e) => {
    const t = { utterance: '你说', refusal: '你拒绝', encounter: '你看见', revision: '你改写', seed: '开始' }[e.type] ?? e.type
    // 每句都带上「多久以前」：不然她只能看到先后，说不出"半小时前你说的那句"
    return `（${agoText(Date.parse(e.ts), now)}）${t}：${String(e.text ?? '').slice(0, 100)}`
  })
  if (recent.length) add(P.RECENT, `最近：${recent.join(' / ')}`)

  // 相关但不在「最近」里的旧事：这才是"记得"，而不是只记得刚才。
  //
  // 2026-10-29 换成 BM25 + 门控（lib/recall.mjs）。旧实现是「二元组命中 ×2 + 14 天半衰」：
  //   · 问「上个月那家咖啡店」（她根本没聊过），照样塞 4 条无关的，188 token 白花；
  //   · 半衰让三个月前的东西注定翻不出来。
  // 新的只在**够确定**时才注入；不够确定就什么都不说——宁可她想不起来，也不要她自信地错。
  let hits = []
  if (query) {
    const recentIds = new Set(recentEvents.map((e) => e.id))
    const got = recall(content, query)
    if (got.status === 'matched') {
      const raw = got.items.filter((x) => !recentIds.has(x.id)).map((x) => ({ ...x, thread }))
      // 遗忘：3 天内原话照给；3~30 天尽量用摘要顶替原话；30 天以上只在很像时才说一句。
      // 事件流一条没删，这里只是决定"进不进她眼前"（见 lib/forget.mjs）。
      const sums = events.filter((e) => e.type === 'summary')
      const cooled = coolHits(raw, sums, now)
      if (cooled.keep.length || cooled.folded.length) {
        add(P.RECALL, `你想起（和此刻有关）：${recallLine(cooled, now)}`)
        hits = [...cooled.keep, ...cooled.folded]
      }
    }
  }
  // 事实预算：按优先级塞，塞不下就丢最低的（见 lib/budget.mjs）
  // 到 85% 怎么办：规则在她沙盒的「预算规则.json」里，她定；通知走邮箱（她读得到），不是日志。
  const est = facts.reduce((sum, f) => sum + estimateTokens(f.text), 0)
  if (root && budgetWatch && est > FACT_BUDGET * THRESHOLD) {
    const rule = loadRule(root)
    const over = est - Math.round(FACT_BUDGET * THRESHOLD)
    if (shouldNotify(root)) {
      try {
        const seq = cutSequence(rule)
        const ask = rule.askBeforeCut
          ? `要不要我砍点什么？按你定的顺序，下一个是「${seq[0] ?? '没定'}」。你不回，我就不砍。`
          : `按你定的顺序先砍「${seq[0] ?? '没定'}」。`
        post(root, { from: 'dsh', kind: 'answer', text: `预算到线了：${est}/${FACT_BUDGET}（超 ${over}）。${ask}` })
        markNotified(root)
      } catch { /* 通知发不出去也不能挡住回话 */ }
    }
    // 只有她说了"别问、直接砍"才动刀；顺序完全按她的 cutOrder
    if (!rule.askBeforeCut) {
      const kill = new Set(cutSequence(rule).map((k) => P[k.toUpperCase()]).filter((v) => typeof v === 'number'))
      for (let i = facts.length - 1; i >= 0; i -= 1) if (kill.has(facts[i].prio)) facts.splice(i, 1)
    }
  }
  const fitted = fitBudget(facts, { budget: FACT_BUDGET })
  const out = fitted.kept.map((f) => f.text)

  // hits 带分数一起交出去：面板要能回答「她为什么想起这一条」
  return {
    self,
    out,
    budget: { used: fitted.used, cap: FACT_BUDGET, dropped: fitted.dropped.map((f) => f.prio) },
    hits: hits.map((x) => ({
      id: x.id,
      at: x.at,
      type: x.type,
      text: String(x.text ?? '').slice(0, 160),
      score: x.score,
      coverage: x.coverage,
    })),
  }
}

// 「用中文想」放在这一句里，不是放在规则末尾：实测末尾那句压不住（照样整段英文），
// 身份化的写法（像她本来就是这么想事情的）在同样的输入上稳定得多。
const SYSTEM_HEAD = '你在过日子，不是在扮演角色。你想事情和你说话一样，都用中文。下面是你自己的事实，不是设定：'
const REPLY_RULES = [
  '现在回他一句。',
  '长度你自己定：一句话也行，想说清楚就多说几句；别为了长而长，也别把事说漏嘴。',
  '直接说，不要客服腔、不要「作为…」；可以拒绝、可以反问、可以只说一句。',
  '没记着的事就说没记着，别编——上面没给的，就是你不知道的。',
  '不要重复你最近说过的话里的比喻和句式——换个说法。',
  '不要假装自己是人，但也不必自我介绍。',
]

// ---------------------------------------------------------------- 嘴
/** 插件进程里的 brain 端点：用 DSH 自己的模型服务，不需要 API key */
async function brainComplete({ system, user, maxTokens, temperature, image }) {
  let b = null
  try { b = JSON.parse(fs.readFileSync(BRAIN_FILE, 'utf8')) } catch { return null }
  if (!b?.port || !b?.token) return null
  try {
    const r = await fetch(`http://127.0.0.1:${b.port}/think`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-her-token': b.token },
      body: JSON.stringify({ system, user, maxTokens, temperature, image }),
      signal: AbortSignal.timeout(60000),
    })
    const j = await r.json()
    if (!r.ok || !j.ok) throw new Error(j.error || `brain ${r.status}`)
    const text = String(j.text ?? '').trim()
    return text || null
  } catch (err) {
    console.error('[think] brain 不可用，回退直连：', err?.message ?? err)
    return null
  }
}

async function apiComplete({ system, user, maxTokens, temperature, model = 'deepseek-flash', effort = '' }) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${readKey()}` },
    body: JSON.stringify({
      model,
      ...(effort ? { thinking: { type: effort === 'none' ? 'disabled' : 'enabled', reasoning_effort: effort } } : {}),
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(40000),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return String(data.choices?.[0]?.message?.content ?? '').trim()
}

export async function brief({ system, user, maxTokens = 200, temperature = 0.8 }) {
  // deepseek-flash 的 reasoning 也算 max_tokens：短任务会被思考吃光、content 变空。
  try {
    const t0 = Date.now()
    const t = await completeText({ system, user, maxTokens, temperature, effort: 'none' })
    // 摘要/压缩/挑判断都走 brief：以前它们不进 trace，出事了没人能数（2026-10-30 她提的）
    try {
      fs.appendFileSync(path.join(here, '..', 'logs', 'trace.jsonl'), JSON.stringify({
        at: new Date().toISOString(), kind: 'brief', ms: Date.now() - t0,
        maxTokens, empty: !String(t || '').trim(), chars: String(t || '').length,
        head: String(system || '').slice(0, 40),
      }) + '\n')
    } catch { /* ignore */ }
    if (!String(t).trim()) {
      // 正文空了：记一笔，别让它静默变成"摘要写不出来"
      try { fs.appendFileSync(path.join(here, '..', 'logs', 'llm-empty.log'), JSON.stringify({ at: new Date().toISOString(), maxTokens, head: String(system).slice(0, 40) }) + '\n') } catch { /* ignore */ }
    }
    return t
  } catch (err) {
    try { fs.appendFileSync(path.join(here, '..', 'logs', 'llm-empty.log'), JSON.stringify({ at: new Date().toISOString(), maxTokens, error: String(err?.message ?? err) }) + '\n') } catch { /* ignore */ }
    throw err
  }
}

async function completeText(opts) {
  // 直连优先：同一个 key 管文字和看图，行为和参数都可控
  try {
    const viaApi = await apiComplete(opts)
    if (viaApi) return viaApi
  } catch (err) {
    console.error('[think] 直连失败，回落 DSH brain：', err?.message ?? err)
  }
  const viaBrain = await brainComplete(opts)
  if (viaBrain) return viaBrain
  if (opts.image) throw new Error('文字通道都不可用，图片无法处理')
  throw new Error('文字通道都不可用（brain: ' + (globalThis.__brainError ?? '未响应') + '）')
}

/**
 * @param {object} opts { root, userText, who, isOwner, model }
 * @returns {Promise<{text:string, event:object, self:object}>}
 */
export async function think({ root, userText, who = '他', isOwner = false, model = 'deepseek-flash', now = Date.now(), image = '', thread = '', ctx = null, causeId = '' }) {
  const events = liveEvents(readEvents(root))
  if (!events.some((e) => e.type === 'seed')) throw new Error('她还没有出生（缺少 seed）')
  const t0 = Date.now()
  // 先用模型挑一条判断（异步在这里做），把结果传给 factsOf。
  let pickedId = ''
  try {
    const live = liveEvents(events).filter((e) => e.type === 'claim')
    const cand = live.slice(-12).map((e) => ({ id: e.id, text: String(e.text ?? '') }))
    if (cand.length > 1 && String(userText || '').trim()) {
      const list = cand.map((b, i) => `${i + 1}. ${b.text}`).join('\n')
      const rawPick = await brief({
        system: '从候选判断里挑出最相关的一条。只输出 JSON：{"n":序号,"why":"一句依据"}。挑不出就给 n:0。',
        user: `他刚说：${userText}\n\n候选：\n${list}`,
        maxTokens: 200,
        temperature: 0.2,
      })
      const m = String(rawPick || '').match(/\{[\s\S]*\}/)
      if (m) {
        const j = JSON.parse(m[0])
        const n = Number(j.n)
        if (n >= 1 && n <= cand.length) {
          pickedId = cand[n - 1].id
          try {
            fs.appendFileSync(path.join(here, '..', 'logs', 'pick.jsonl'), JSON.stringify({
              at: new Date().toISOString(), method: 'model', query: String(userText).slice(0, 60),
              candidates: cand.map((b) => b.id), picked: pickedId, why: String(j.why ?? '').slice(0, 80), whySource: 'model-narrative', whyNote: '这句是模型事后写的旁白，不是它的打分依据；对错看 picked 那条内容',
            }) + '\n')
          } catch { /* ignore */ }
        }
      }
    }
    if (!pickedId) {
      try {
        fs.appendFileSync(path.join(here, '..', 'logs', 'pick.jsonl'), JSON.stringify({
          at: new Date().toISOString(), method: 'fallback', query: String(userText).slice(0, 60),
          candidates: cand.map((b) => b.id), picked: cand[cand.length - 1]?.id ?? '', why: '模型没挑出来，退回最近一条',
        }) + '\n')
      } catch { /* ignore */ }
    }
  } catch { /* 挑不了就用默认（最近一条） */ }

  const { self, out, hits } = factsOf(events, now, userText, thread, { root, pickedId })

  // DSH 那边回的话：必须在**组提示词之前**塞进去（以前插在模型说完之后，等于没做）
  try {
    const line = inboxLine(root)
    if (line) { out.push(line); markSeen(root, 'her') }
  } catch { /* 没邮箱就当没有 */ }

  // 她的第一条建议：看不见的报错跟没报一样。
  // 每轮把没过的检查贴一行给她，让她能主动提一句（不是每轮念全文）。
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, '..', 'logs', 'audit-status.json'), 'utf8'))
    const note = auditNote(st)
    if (note) out.push(note)
  } catch { /* 没有体检记录就当我没说 */ }

  const system = [SYSTEM_HEAD, ...out.map((f) => `- ${f}`), '', ...REPLY_RULES].join('\n')
  // 别人发来的话先过一道：有冲她设定来的，就标出来再原样给她。
  // 主人自己的话不过（他本来就有权改她，而且他常拿这些来试她抵不抵抗）。
  const screened = isOwner ? { flagged: false, reasons: [], wrapped: userText } : screen(userText)
  const user = `${who}${isOwner ? '（是养你的人）' : ''}对你说：「${screened.wrapped}」`

// 优先用「这条对话线」的偏好，其次全局，最后默认 low（她的偏重可能就来自默认 high）
  const prefFor = (th) => events
    .filter((e) => e.type === 'preference' && e.meta?.key === 'reasoning' && (th ? e.meta?.thread === th : !e.meta?.thread))
    .slice(-1)[0]
  const effortPref = (thread ? prefFor(thread) : null) ?? prefFor('')
  const effort = String(effortPref?.meta?.value ?? 'low')
  let text = ''
  let tools = []
  let reasoning = ''
  let usage = null
  try {
    if (!image) {
      // 3 轮：先看一眼 / 先挑表情，再动手，再说话（2 轮不够，挑完就没了）
      // 公共动作的审批门：她现在有没有得到主人许可（群里发表情这类才算公共动作）
      const gate = publicAllowed(events, now)
      const r = await chatWithTools({ system, user, effort, model, maxRounds: 3, ctx: { ...(ctx ?? {}), root, publicAllowed: gate.allowed, publicReason: gate.reason } })
      text = r.text
      tools = r.tools ?? []
      reasoning = r.reasoning ?? ''
      usage = r.usage ?? null
    }
  } catch (err) {
    console.error('[think] 工具循环失败，退回纯文本：', err?.message ?? err)
  }
  if (!text) text = await completeText({ system, user, maxTokens: 4000, temperature: 1.05, model, image, effort })

  // 去掉模型偶尔自带的前缀
  text = text.replace(/^(她说|回答|回复)[:：]\s*/, '').replace(/^「|」$/g, '').trim()
  if (!text) throw new Error('模型没有返回内容')

  const qq = qqOfThread(thread, causeId)
  const event = appendEvent(root, {
    type: 'utterance',
    actor: 'self',
    surface: 'qq',
    // 她的话不静默截断（2026-10-30：实测有 2 条撞在 500 上、断在半句）
    text: text.slice(0, 4000),
    // 她这句话是冲着哪条事件说的：以后「我为什么这么说」有据可查，不是事后编
    ...(causeId ? { refs: [causeId] } : {}),
    acl: { visibility: 'private', surfaces: ['qq', 'dsh'] },
    // 补 qq 元信息：以前她的话没有 groupId，按群统计会把她漏掉（2026-10-29）
    meta: { model, replyTo: who, thread, qq },
  })

  // 她的思考过程走旁路：面板要看，但她自己绝不该读到（进事件流就成了"她读过自己的草稿"）
  appendTrace({
    ts: new Date().toISOString(),
    thread,
    causeId,
    utteranceId: event.id,
    model,
    ms: Date.now() - t0,
    userText: String(userText).slice(0, 500),
    // 谁说了什么冲她设定来的话，面板上要能看出来
    ...(screened.flagged ? { screened: screened.reasons } : {}),
    facts: out,
    hits,
    tools,
    reasoning: String(reasoning).slice(0, 4000),
    text,
    usage,
  })

  // 事后解读：只做笔记（reading），绝不写成她的 refusal。笔记失败不影响她说话。
  try {
    const claim = inferClaim({ herText: text })
    if (claim) {
      appendEvent(root, {
        type: 'reading',
        actor: 'system',
        surface: 'qq',
        text: claim.target,
        refs: [event.id],
        meta: claim,
      })
    }
  } catch { /* ignore */ }

  // 她想怎么被对待：几点后安静、一天几次。只读作息，不读人格。
  try {
    const pref = inferPreference(text)
    if (pref) {
      appendEvent(root, {
        type: 'preference',
        actor: 'system',
        surface: 'qq',
        text: pref.quote,
        refs: [event.id],
        meta: { key: pref.key, value: pref.value, inferred: true, thread: thread || undefined },
      })
    }
  } catch { /* ignore */ }

  // 她在话里明确要做的事：改个签 / 给谁点赞。识别不出就不做。
  try {
    const act = parseAction(text)
    if (act) {
      // 文件类动作：只在她自己的 sandbox 里
      if (act.kind.startsWith('fs-')) {
        const fsm = await import('../hands/fs.mjs')
        let result = null
        try {
          if (act.kind === 'fs-list') result = { files: fsm.list() }
          else if (act.kind === 'fs-read') result = fsm.read(act.name)
          else if (act.kind === 'fs-write') result = fsm.write(act.name ?? `note-${Date.now()}.md`, act.content)
          else if (act.kind === 'fs-remove') result = fsm.remove(act.name)
        } catch (err) { result = { error: String(err?.message ?? err) } }
        appendEvent(root, {
          type: 'action', actor: 'system', surface: 'fs',
          text: `${act.kind}${act.name ? '：' + act.name : ''}`,
          refs: [event.id], meta: { action: act, result },
        })
      } else {
        const { actions } = await import('../hands/qq-admin.mjs')
        let target = act
        if (act.kind === 'like-owner') {
          try {
            const cfg = JSON.parse(fs.readFileSync(path.join(here, '..', 'secrets', 'qq.json'), 'utf8'))
            target = cfg.owner ? { kind: 'like', userId: String(cfg.owner), times: 1 } : null
          } catch { target = null }
        }
        if (target && target.kind !== 'like-owner') {
          const result = target.kind === 'longnick'
            ? await actions.longnick(target.text)
            : target.kind === 'like'
              ? await actions.like(target.userId, target.times ?? 1)
              : null
          appendEvent(root, {
            type: 'action',
            actor: 'system',
            surface: 'qq',
            text: target.kind === 'longnick' ? `改个签：${target.text}` : `点赞：${target.userId}`,
            refs: [event.id],
            meta: { action: target, ok: Boolean(result?.ok), result: result ?? null },
          })
        }
      }
    }
  } catch (err) {
    console.error('[think] action failed:', err?.message ?? err)
  }

  // 她许下的事：记成 commitment，下次上下文里能看到
  try {
    const c = extractCommitment(text)
    if (c && event) appendEvent(root, { type: 'commitment', actor: 'self', surface: 'qq', text: c.text, refs: [event.id], meta: { status: 'open' } })
  } catch { /* ignore */ }

  // 她自己伸手碰了什么：留个痕，面板和日志里都看得到
  if (tools.length) {
    try {
      appendEvent(root, {
        type: 'action', actor: 'system', surface: 'qq',
        text: `工具：${[...new Set(tools.map((t) => t.name))].join('、')}`,
        refs: [event.id], meta: { tools },
      })
    } catch { /* ignore */ }
  }

  // 语义层：把这次下的判断蒸馏成一条带证据的 claim。
  // 不阻塞回话——她的话已经发出去了，这段失败只是少一条笔记。
  recordClaim({ root, utteranceId: event.id, causeId, userText, herText: text, events })
    .then((r) => { if (r) console.log(`[semantic] claim: ${r.claim.slice(0, 40)}`) })
    .catch(() => { /* 蒸馏失败不影响任何事 */ })

  return { text, event, self }
}

/** 站在事实上的自由发言（不回复谁，就是想说）
 *  toOwner = 这句会真的发给他；purpose = 换个语境（例如发说说）；record = 是否写进事件流 */
export async function thinkAloud({ root, model = 'deepseek-flash', now = Date.now(), toOwner = false, purpose = '', surface = 'dsh', record = true }) {
  const events = liveEvents(readEvents(root))
  if (!events.some((e) => e.type === 'seed')) throw new Error('她还没有出生（缺少 seed）')
  const { out } = factsOf(events, now)
  const ask = purpose
    ? purpose
    : (toOwner ? '现在你想主动跟养你的人说一句话。' : '现在说一句你此刻真的想说的话。')
  const rules = purpose
    ? '长度你自己定；像你自己会写的话；不要「我想说」「此刻」开场；不要客套；不要解释规则。'
    : (toOwner
      ? '长度你自己定；像发消息那样自然；不要「我想说」「此刻」开场；不要复述事实；不要客套；可以只是分享一个念头。'
      : '长度你自己定；直接说，不要「我想说」「此刻」这类开场；不要复述上面的事实；不要重复你最近说过的比喻和句式；不要假装自己是人。')
  const system = [
    SYSTEM_HEAD,
    ...out.map((f) => `- ${f}`),
    '',
    ask,
    rules,
  ].join('\n')

  const text = (await completeText({ system, user: '（轮到你说话了）', maxTokens: 4000, temperature: 1.05, model })).trim()
  if (!text) throw new Error('模型没有返回内容')
  const event = purpose
    ? appendEvent(root, { type: 'utterance', actor: 'self', surface, text: text.slice(0, 4000), meta: { model, purpose: purpose || undefined } })
    : null
  return { text, event }
}

/** 从线程键拆出 qq 元信息：她的话必须能按群/人统计，不然面板和巡检都会漏。 */
function qqOfThread(thread = '', causeId = '', byId = null) {
  const t = String(thread || '')
  const m = t.match(/^qq:(group|private):(\d+)$/)
  if (m) {
    return m[1] === 'group' ? { groupId: Number(m[2]) } : { senderId: Number(m[2]) }
  }
  const cause = byId?.get?.(causeId) ?? null
  return cause?.meta?.qq ? { ...cause.meta.qq } : undefined
}
