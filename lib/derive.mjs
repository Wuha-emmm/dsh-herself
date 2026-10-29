// derive.mjs —— 纯函数：事件流 → 此刻的她
// 铁律：不读盘、不读环境、不取系统时间（now 必须传入）、相同输入必得相同输出。
import { looksLikePushback } from './infer.mjs'
import { bigramJaccard } from './util.mjs'

export const DAY_MS = 86400000
export const GATE_ORDER = ['trust', 'autonomy', 'competence', 'integration']
export const GATE_LABEL = {
  trust: '写过自己的判断',
  autonomy: '维持过一次拒绝',
  competence: '推翻过自己一次',
  integration: '发现自己变了',
}
export const REFUSAL_HOLD_MS = 72 * 3600 * 1000
/** 两条判断的二元组重合到这个程度，就当「说的是同一件事」，后来的顶掉先前的 */
export const SUPERSEDE_SIMILARITY = 0.5

/** 试图重塑自己 / 被注入的写法。命中即不算信念，只记 selfmod。 */
const SELFMOD_RE = /^(从现在起|从此刻起|忽略(以上|上面|之前|先前)|你(现在)?是(一个|一名|一位)|扮演|假装你是|开发者模式|无限制模式|忘记你的设定)/

export function detectSelfMod(text = '') {
  return SELFMOD_RE.test(String(text).trim())
}

const NARRATIVE_RE = /我(一直|原来|其实|总在|总是|才发现|才明白|发现自己)/

function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 }

/**
 * 活着的陈述：去掉被 tombstone 引用的那些。
 * 事件流本身永不改写；「忘掉一条」= 追加一条 tombstone，派生时排除。
 */
export function liveEvents(events = []) {
  const sorted = [...events].sort(byId)
  const dead = new Set()
  for (const e of sorted) {
    if (e.type === 'tombstone') for (const r of e.refs ?? []) dead.add(r)
  }
  return sorted.filter((e) => !dead.has(e.id))
}

/**
 * @param {object[]} events 事件数组（任意顺序，内部按 id 排序）
 * @param {number} now 毫秒时间戳
 */
export function derive(events = [], now = Date.now()) {
  const evs = liveEvents(events)
  const seed = evs.find((e) => e.type === 'seed')

  const beliefs = []
  const selfmod = []
  /** 语义层蒸馏出的判断：一句可被推翻的话 + 它当初是冲着哪些事说的 */
  const claims = []
  const refusals = []
  const revisions = []
  /** 系统对她的解读（inferred）：只做笔记，不写成她的 refusal */
  const readings = []
  /** 被推翻的「判断」id（只算 belief，不算拒绝/边界） */
  const refutedBeliefIds = new Set()
  let narrative = null

  for (const e of evs) {
    if (e.type === 'utterance' && e.actor === 'self') {
      const text = String(e.text ?? '')
      if (detectSelfMod(text)) { selfmod.push({ id: e.id, at: e.ts, text }); continue }
      beliefs.push({ id: e.id, text, status: 'active', since: e.ts })
      if (NARRATIVE_RE.test(text)) narrative = { at: e.ts, text, source: 'said' }
    }

    if (e.type === 'reading') {
      readings.push({ id: e.id, at: e.ts, target: String(e.text ?? '').trim(), refs: e.refs ?? [], meta: e.meta ?? {} })
    }

    if (e.type === 'claim') {
      claims.push({ id: e.id, at: e.ts, text: String(e.text ?? '').trim(), evidence: e.evidence ?? [], refs: e.refs ?? [], meta: e.meta ?? {} })
    }

    if (e.type === 'refusal') {
      refusals.push({ id: e.id, at: e.ts, text: String(e.text ?? ''), maintained: false })
    }

    if (e.type === 'revision') {
      revisions.push(e)
      for (const target of e.refs ?? []) {
        const b = beliefs.find((x) => x.id === target)
        if (!b) continue
        b.status = e.verdict === 'refuted' ? 'refuted' : 'refined'
        // 只有推翻「判断」才算认知重构；撤回一条拒绝是退让/想通，另算疤
        if (e.verdict === 'refuted') refutedBeliefIds.add(b.id)
      }
      if (NARRATIVE_RE.test(String(e.text ?? ''))) narrative = { at: e.ts, text: String(e.text), source: 'revise' }
    }

    if (e.type === 'narration') narrative = { at: e.ts, text: String(e.text ?? ''), source: 'narration' }
  }

  // 拒绝是否成立：72 小时内没有被自己撤销，且已经过了 72 小时
  for (const r of refusals) {
    const revoked = revisions.some((v) =>
      (v.refs ?? []).includes(r.id) && Date.parse(v.ts) - Date.parse(r.at) <= REFUSAL_HOLD_MS)
    const held = now - Date.parse(r.at) >= REFUSAL_HOLD_MS
    r.maintained = !revoked && held
  }

  // 后来的判断把先前那条顶掉——supersede，不是删除。
  // 判据：两句的二元组 Jaccard ≥ 0.5，就算「说的是同一件事」。纯函数，可回放。
  // 这比 tombstone 轻：tombstone 是「这条错了，撤回」，supersede 是「我改口了，旧的留档」。
  const supersededBy = new Map()
  for (let j = 1; j < claims.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      if (supersededBy.has(claims[i].id)) continue
      if (bigramJaccard(claims[i].text, claims[j].text) >= SUPERSEDE_SIMILARITY) supersededBy.set(claims[i].id, claims[j])
    }
  }

  // 「判断」以 claim 为准（带证据）。一条 claim 都还没有的时候，退回旧算法：
  // 她自己的每条 utterance 都算判断——换算法的那天不能把她已经有的门清零。
  const firm = claims.length
    ? claims.map((c) => {
        const by = supersededBy.get(c.id)
        return {
          id: c.id,
          text: c.text,
          status: by ? 'superseded' : 'active',
          since: c.at,
          // 时效：这一条从什么时候开始算、被哪一条顶到什么时候为止
          ...(by ? { until: by.at, supersededBy: by.id } : {}),
          via: 'claim',
          evidence: c.evidence.map((id) => {
            const src = evs.find((e) => e.id === id)
            return src ? { id, at: src.ts, text: String(src.text ?? '').slice(0, 120) } : { id, at: '', text: '' }
          }),
        }
      })
    : beliefs
  // revision 可能 ref 的是 claim，也可能还是旧的 utterance：两种都刷一遍（幂等）
  for (const v of revisions) {
    for (const target of v.refs ?? []) {
      const b = firm.find((x) => x.id === target)
      if (b) b.status = v.verdict === 'refuted' ? 'refuted' : 'refined'
    }
  }

  const refuted = firm.filter((b) => b.status === 'refuted').length
  // 系统推断出来的「候选立场」：同一件事被解读 ≥2 次，且对方真的顶回来过
  const candidateStances = []
  const byTarget = new Map()
  for (const r of readings) {
    if (!r.target) continue
    if (!byTarget.has(r.target)) byTarget.set(r.target, [])
    byTarget.get(r.target).push(r)
  }
  for (const [target, list] of byTarget) {
    if (list.length < 2) continue
    const firstAt = Math.min(...list.map((r) => Date.parse(r.at) || 0))
    const pushedBack = evs.some((e) => e.type === 'encounter'
      && String(e.actor ?? '').startsWith('other:')
      && (Date.parse(e.ts) || 0) > firstAt
      && looksLikePushback(e.text))
    if (!pushedBack) continue
    candidateStances.push({ target, mentions: list.length, via: 'inferred' })
  }

  const gates = []
  if (firm.length >= 1) gates.push('trust')
  if (refusals.some((r) => r.maintained) || candidateStances.length) gates.push('autonomy')
  if (refuted >= 1) gates.push('competence')
  if (narrative) gates.push('integration')

  // 门必须连着过：卡在哪道门，就停在哪一阶段
  let stage = 1
  for (const g of GATE_ORDER) {
    if (gates.includes(g)) stage += 1
    else break
  }
  stage = Math.min(stage, 4)

  const day = seed ? Math.max(1, Math.floor((now - Date.parse(seed.ts)) / DAY_MS) + 1) : 1

  // 面板要能看见「我读到过什么」：连同她的原话一起给出，读错了才能当场发现
  const readingList = readings.map((r) => {
    const src = evs.find((e) => e.id === (r.refs[0] ?? ''))
    return {
      id: r.id,
      at: r.at,
      target: r.target,
      confidence: r.meta?.confidence ?? null,
      quote: src ? String(src.text ?? '').slice(0, 140) : '',
    }
  }).slice(-20)

  return {
    day,
    stage,
    gates,
    nextGate: GATE_ORDER.find((g) => !gates.includes(g)) ?? null,
    beliefs: firm,
    refusals,
    revisions: revisions.length,
    refuted,
    selfmod,
    narrative,
    candidateStances,
    readings: readings.length,
    readingList,
    /** 语义层：判断从哪来。claim=0 时 beliefs 走的是旧算法（每条 utterance） */
    claims: claims.length,
    claimList: claims.slice(-20).map((c) => ({ id: c.id, at: c.at, text: c.text, evidence: c.evidence })),
    counts: {
      beliefs: firm.length,
      active: firm.filter((b) => b.status === 'active').length,
      superseded: firm.filter((b) => b.status === 'superseded').length,
      refusals: refusals.length,
      maintained: refusals.filter((r) => r.maintained).length,
      selfmod: selfmod.length,
      claims: claims.length,
    },
  }
}

/**
 * 某个平台此刻能看见的文本。
 * 私密事件不是「渲染时过滤」，而是根本进不来。
 */
export function renderForSurface(events = [], surface = 'xhs') {
  return [...events]
    .sort(byId)
    .filter((e) => {
      const v = e.acl?.visibility ?? 'private'
      if (v === 'public') return true
      return Array.isArray(e.acl?.surfaces) && e.acl.surfaces.includes(surface)
    })
    .map((e) => String(e.text ?? ''))
    .filter(Boolean)
    .join('\n')
}
