// store.mjs —— 只追加的事件流 + 哈希链 + 原子派生快照
import fs from 'node:fs'
import path from 'node:path'
import { ulid, chainHash } from './util.mjs'
import { validateEvent } from './schema.mjs'
import { log } from './log.mjs'

export function paths(root) {
  return {
    root,
    events: path.join(root, 'events.jsonl'),
    state: path.join(root, 'state.json'),
  }
}

export function ensureRoot(root) {
  fs.mkdirSync(path.join(root, 'diary'), { recursive: true })
  fs.mkdirSync(path.join(root, 'home'), { recursive: true })
  if (!fs.existsSync(paths(root).events)) fs.writeFileSync(paths(root).events, '', 'utf8')
  return paths(root)
}

/** 读文件里真正最后一行（链的前驱必须以写入顺序为准，不能按 id 排序取最大） */
function lastLineEvent(root) {
  const file = paths(root).events
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8').trimEnd()
  if (!text) return null
  const idx = text.lastIndexOf('\n')
  const line = idx >= 0 ? text.slice(idx + 1) : text
  try { return JSON.parse(line) } catch { return null }
}

/** 跨进程追加锁：同一时刻只允许一个写者（wake / listener / 插件都可能写） */
function withAppendLock(root, fn) {
  const lock = path.join(root, '.append.lock')
  const wait = new Int32Array(new SharedArrayBuffer(4))
  const deadline = Date.now() + 3000
  let fd = null
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx')
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      if (Date.now() > deadline) { try { fs.unlinkSync(lock) } catch { /* ignore */ } }
      Atomics.wait(wait, 0, 0, 10)
    }
  }
  try {
    return fn()
  } finally {
    try { fs.closeSync(fd) } catch { /* ignore */ }
    try { fs.unlinkSync(lock) } catch { /* ignore */ }
  }
}
export function readEvents(root) {
  const file = paths(root).events
  if (!fs.existsSync(file)) return []
  const out = []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e && typeof e === 'object' && e.id && e.type) out.push(e)
    } catch { /* 坏行进 quarantine，后面再加 */ }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 追加一条事件：自动补 id / ts / prev */
export function appendEvent(root, input) {
  ensureRoot(root)
  return withAppendLock(root, () => appendEventUnlocked(root, input))
}

function appendEventUnlocked(root, input) {
  // 形状校验：**记不拦**。她的生活不能因为一条字段瑕疵就中断，但必须留现场。
  // （真正让它变红的时机是体检/测试，不是她说话的时候。）
  const evs = readEvents(root)
  const last = lastLineEvent(root)
  const actor = input.actor || (input.type === 'seed' ? 'system' : 'self')
  const selfTypes = ['utterance', 'refusal', 'revision', 'narration']
  // 默认私有；她自己说的话至少要在她自己的房间（dsh）里看得见，但绝不默认公开
  const acl = input.acl
    || (selfTypes.includes(input.type) && actor === 'self'
      ? { visibility: 'private', surfaces: ['dsh'] }
      : { visibility: 'private' })
  const event = {
    v: 1,
    id: input.id || ulid(Date.parse(input.ts) || Date.now()),
    ts: input.ts || new Date().toISOString(),
    life: input.life || 'life_main',
    surface: input.surface || 'dsh',
    type: input.type,
    actor,
    acl,
    prev: last ? chainHash(last) : 'genesis',
  }
  if (input.text !== undefined) event.text = String(input.text).slice(0, 4000)
  if (input.refs?.length) event.refs = input.refs
  if (input.evidence?.length) event.evidence = input.evidence
  if (input.verdict) event.verdict = input.verdict
  if (input.target) event.target = input.target
  if (input.meta) event.meta = input.meta

  // 不变量：seed 只能一条
  if (event.type === 'seed' && evs.some((e) => e.type === 'seed')) {
    throw new Error('seed 已存在：一个 life 只能有一个起点')
  }
  // 不变量：refs 必须指向更早的事件
  for (const r of event.refs || []) {
    const idx = evs.findIndex((e) => e.id === r)
    if (idx < 0) throw new Error(`refs 指向不存在的事件：${r}`)
  }

  // 形状校验（记不拦）：不合法的照样落盘，但要在日志里留下现场
  const check = validateEvent(event)
  if (!check.ok) log('store', '事件形状不对（仍然落盘）', { id: event.id, type: event.type, errors: check.errors })
  fs.appendFileSync(paths(root).events, JSON.stringify(event) + '\n', 'utf8')
  return event
}

/** 校验哈希链：按**文件顺序**（写入顺序）验，不按 id 排序 */
export function verifyChain(root) {
  const file = paths(root).events
  if (!fs.existsSync(file)) return { ok: true, count: 0, breaks: [] }
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
  const breaks = []
  let expected = 'genesis'
  lines.forEach((line, index) => {
    let e = null
    try { e = JSON.parse(line) } catch { breaks.push({ at: 'unparsable', index }); return }
    if (e.prev !== expected) breaks.push({ at: e.id, index, expect: expected, got: e.prev })
    expected = chainHash(e)
  })
  return { ok: breaks.length === 0, count: lines.length, breaks }
}

/** 派生快照是可丢的：写它只是为了让观测台秒开 */
export function writeState(root, state) {
  const file = paths(root).state
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}
