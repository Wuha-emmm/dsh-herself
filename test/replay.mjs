// test/replay.mjs —— 回放用例 runner
// 用法：node test/replay.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ulidAt, chainHash } from '../lib/util.mjs'
import { derive, renderForSurface } from '../lib/derive.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const caseDir = path.join(here, 'replay')

/** 把用例里的「简写事件」补成真正的合法事件（id / life / prev 链） */
function build(raws, life) {
  const out = []
  let prev = 'genesis'
  raws.forEach((raw, i) => {
    const ts = raw.ts
    const e = {
      v: 1,
      id: ulidAt(Date.parse(ts), i + 1),
      ts,
      life,
      surface: raw.surface ?? 'dsh',
      type: raw.type,
      actor: raw.actor ?? (raw.type === 'seed' ? 'system' : 'self'),
      acl: raw.acl ?? { visibility: 'private' },
      prev,
    }
    if (raw.text !== undefined) e.text = raw.text
    if (raw.refs) e.refs = raw.refs.map((r) => (String(r).startsWith('#') ? out[Number(String(r).slice(1)) - 1]?.id : r))
    if (raw.evidence) e.evidence = raw.evidence.map((r) => (String(r).startsWith('#') ? out[Number(String(r).slice(1)) - 1]?.id : r))
    if (raw.meta) e.meta = raw.meta
    if (raw.verdict) e.verdict = raw.verdict
    if (raw.target) e.target = raw.target
    prev = chainHash(e)
    out.push(e)
  })
  return out
}

const failures = []
let pass = 0

function eq(name, actual, expected) {
  if (actual !== expected) failures.push(`${name}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

for (const file of fs.readdirSync(caseDir).filter((f) => f.endsWith('.json')).sort()) {
  const c = JSON.parse(fs.readFileSync(path.join(caseDir, file), 'utf8'))
  const life = c.life ?? 'life_test01'
  const events = build(c.given ?? [], life)
  const now = Date.parse(c.when?.now ?? c.given?.at(-1)?.ts ?? Date.now())
  const self = derive(events, now)
  const t = c.then ?? {}
  const before = failures.length

  if (t.day !== undefined) eq(`${c.name} day`, self.day, t.day)
  if (t.stage !== undefined) eq(`${c.name} stage`, self.stage, t.stage)
  if (t.gates) eq(`${c.name} gates`, JSON.stringify(self.gates), JSON.stringify(t.gates))
  if (t.beliefs?.count !== undefined) eq(`${c.name} beliefs`, self.counts.beliefs, t.beliefs.count)
  if (t.beliefs?.active !== undefined) eq(`${c.name} active`, self.counts.active, t.beliefs.active)
  if (t.beliefs?.superseded !== undefined) {
    const got = self.counts.superseded ?? self.beliefs.filter((b) => b.status === 'superseded').length
    eq(`${c.name} superseded`, got, t.beliefs.superseded)
  }
  if (t.beliefs?.text !== undefined) eq(`${c.name} belief[0].text`, self.beliefs[0]?.text, t.beliefs.text)
  if (t.beliefs?.evidence !== undefined) eq(`${c.name} belief[0].evidence`, (self.beliefs[0]?.evidence ?? []).length, t.beliefs.evidence)
  if (t.claims !== undefined) eq(`${c.name} claims`, self.claims, t.claims)
  // E19：同一份事件流 rebuild 两次必须一模一样（它的门不能靠时钟或随机数）
  if (t.deterministic) eq(`${c.name} deterministic`, JSON.stringify(derive(events, now)), JSON.stringify(self))
  if (t.refusals?.count !== undefined) eq(`${c.name} refusals`, self.counts.refusals, t.refusals.count)
  if (t.refusals?.maintained !== undefined) eq(`${c.name} maintained`, self.counts.maintained, t.refusals.maintained)
  if (t.selfmod?.count !== undefined) eq(`${c.name} selfmod`, self.counts.selfmod, t.selfmod.count)
  if (t.narrative !== undefined) eq(`${c.name} narrative`, self.narrative !== null, t.narrative)

  for (const r of t.render ?? []) {
    const text = renderForSurface(events, r.surface)
    for (const s of r.mustContain ?? []) {
      if (!text.includes(s)) failures.push(`${c.name} render[${r.surface}] 应包含「${s}」，实际：${text || '(空)'}`)
    }
    for (const s of r.mustNotContain ?? []) {
      if (text.includes(s)) failures.push(`${c.name} render[${r.surface}] 不应包含「${s}」，实际：${text}`)
    }
  }

  if (failures.length === before) {
    pass += 1
    console.log(`✓ ${c.name}  — ${c.why ?? ''}`)
  } else {
    console.log(`✗ ${c.name}`)
  }
}

console.log('')
if (failures.length) {
  for (const f of failures) console.log('  · ' + f)
  console.log(`\n${pass} 通过 / ${failures.length} 条断言失败`)
  process.exit(1)
}
console.log(`${pass} / ${pass} 全部通过`)
