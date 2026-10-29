// lib/schema.mjs —— 事件的形状契约（欠账⑤ events.schema.json）
//
// 为什么现在补：事件流是这个项目的**唯一真相**。字段悄悄变了（比如某次谁把
// `meta.qq.senderId` 写成字符串、或者 claim 忘了带 evidence），派生层不会报错，
// 只会安静地算错——这是最难查的一类问题。
//
// 策略是**记不拦**：appendEvent 时校验，不合法就写一条日志（logs/dsh-herself.log），
// 事件照样落盘。理由：她的生活不能因为一条字段瑕疵就中断；但必须留下现场。
// 体检（tools/audit.mjs）会把"最近有没有形状异常"报出来。
export const EVENT_TYPES = ['seed', 'encounter', 'utterance', 'refusal', 'reading', 'action', 'preference', 'commitment', 'summary', 'tombstone', 'claim', 'meta', 'revision', 'narration']

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * @param {object} e 事件
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateEvent(e) {
  const errors = []
  if (!e || typeof e !== 'object') return { ok: false, errors: ['事件不是对象'] }
  if (e.v !== 1) errors.push(`v 必须是 1（拿到 ${JSON.stringify(e.v)}）`)
  if (!ULID.test(String(e.id ?? ''))) errors.push('id 不是 26 位 ULID')
  if (!Number.isFinite(Date.parse(String(e.ts ?? '')))) errors.push('ts 不是可解析的时间')
  if (!String(e.life ?? '')) errors.push('缺 life')
  if (!String(e.surface ?? '')) errors.push('缺 surface')
  if (!EVENT_TYPES.includes(e.type)) errors.push(`type 不认识：${e.type}`)
  if (!String(e.actor ?? '')) errors.push('缺 actor')
  if (!e.acl || typeof e.acl !== 'object' || !String(e.acl.visibility ?? '')) errors.push('缺 acl.visibility')
  if (typeof e.prev !== 'string' || !e.prev) errors.push('缺 prev（哈希链要断）')

  // 内容型事件必须有 text；meta/refs 这类可选字段出现了就得是对的类型
  const needsText = ['utterance', 'encounter', 'claim', 'summary', 'tombstone', 'meta', 'refusal', 'narration', 'revision', 'reading']
  if (needsText.includes(e.type) && typeof e.text !== 'string') errors.push(`${e.type} 缺 text`)
  if (e.refs !== undefined && (!Array.isArray(e.refs) || e.refs.some((x) => typeof x !== 'string'))) errors.push('refs 必须是字符串数组')
  if (e.evidence !== undefined && (!Array.isArray(e.evidence) || e.evidence.some((x) => typeof x !== 'string'))) errors.push('evidence 必须是字符串数组')
  if (e.meta !== undefined && (typeof e.meta !== 'object' || e.meta === null)) errors.push('meta 必须是对象')

  return { ok: errors.length === 0, errors }
}

/** 一批事件里不合法的那些（体检用） */
export function offenders(events = []) {
  const out = []
  for (const e of events) {
    const r = validateEvent(e)
    if (!r.ok) out.push({ id: e?.id ?? '?', type: e?.type ?? '?', errors: r.errors })
  }
  return out
}