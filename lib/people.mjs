// lib/people.mjs —— 跨平台"认人"：她记的是人，不是账号
//
// 为什么先做这个：接 B站 之后，同一个人会以不同 surface 出现。
// 没有这一层，QQ 里的你 和 B站 里的你 会被算成两个人。
//
// 原则（定稿 §十二）：
//   · 平台是入口，人是记忆的边界
//   · 身份对齐靠显式 linkage，不静默合并
//   · people.json 是派生文件，可从事件流重建
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const FILE = path.join(HER, 'life', 'people.json')
const QQ_CFG = path.join(HER, 'secrets', 'qq.json')

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return null }
}
function save(obj) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), 'utf8')
}

/** 默认登记：他自己（QQ 号来自 secrets/qq.json） */
export function ensure() {
  let db = load()
  if (!db) {
    db = { people: {}, aliases: {} }
    let owner = ''
    try { owner = String(JSON.parse(fs.readFileSync(QQ_CFG, 'utf8')).owner ?? '') } catch { /* ignore */ }
    if (owner) {
      db.people.owner = { name: '主人', role: 'owner', aliases: [{ surface: 'qq', id: owner }] }
      db.aliases['qq:' + owner] = 'owner'
    }
    save(db)
  }
  return db
}

/** 由「平台 + 账号」找到 personId */
export function resolve(surface, id) {
  const db = ensure()
  return db.aliases[`${surface}:${id}`] ?? ''
}

/** 由事件推断涉及的人（没有就返回空串，绝不猜） */
export function personOf(event) {
  const q = event?.meta?.qq
  if (q?.senderId) {
    const hit = resolve('qq', q.senderId)
    if (hit) return hit
    return q.senderId === String(ownerQQ()) ? 'owner' : ''
  }
  return event?.meta?.person ?? ''
}

function ownerQQ() {
  try { return String(JSON.parse(fs.readFileSync(QQ_CFG, 'utf8')).owner ?? '') } catch { return '' }
}

/** 显式绑定：把某平台账号归到某个人 */
export function link(personId, surface, id, { name = '' } = {}) {
  const db = ensure()
  const person = db.people[personId] ?? { name: '', role: 'acquaintance', aliases: [] }
  if (!person.aliases.some((a) => a.surface === surface && String(a.id) === String(id))) {
    person.aliases.push({ surface, id: String(id) })
  }
  if (name) person.name = name
  db.people[personId] = person
  db.aliases[`${surface}:${id}`] = personId
  save(db)
  return db.people[personId]
}

export function all() {
  return ensure().people
}

// CLI
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const [cmd, a, b, c] = process.argv.slice(2)
  if (cmd === 'list') console.log(JSON.stringify(all(), null, 2))
  else if (cmd === 'link' && a && b && c) console.log(JSON.stringify(link(a, b, c, { name: process.argv[5] ?? '' }), null, 2))
  else console.log('用法：list | link <person> <surface> <id> [name]')
}

/**
 * 从事件流**直接算出**她认得的人（不读 people.json）。
 *
 * 为什么要这个：people.json 是给"跨平台对齐"用的派生缓存，但她平时需要的是
 * 「这个群里都有谁、谁说得最多」——那个从 encounter 的原文就能算出来，
 * 而且不会因为缓存过期而失真。2026-10-29 之前 people.mjs 是个孤儿，没人调用。
 *
 * @param {object[]} events live 过的事件
 * @param {{thread?:string, limit?:number}} opts
 * @returns {Array<{id:string,name:string,count:number,last:number}>}
 */
export function knownPeople(events = [], { thread = '', limit = 6 } = {}) {
  const map = new Map()
  for (const e of events) {
    if (e.type !== 'encounter') continue
    const q = e.meta?.qq
    if (!q?.senderId) continue
    if (thread) {
      const th = q.groupId ? 'qq:group:' + q.groupId : 'qq:private:' + q.senderId
      if (th !== thread) continue
    }
    const m = String(e.text ?? '').match(/^(?:\[群 \d+\]\s*)?([^：\n]{1,24})：/)
    const name = m ? m[1] : String(q.senderId)
    const id = String(q.senderId)
    const cur = map.get(id) ?? { id, name, count: 0, last: 0 }
    cur.count += 1
    const ts = Date.parse(e.ts) || 0
    if (ts >= cur.last) { cur.last = ts; cur.name = name }
    map.set(id, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, limit)
}