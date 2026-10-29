// test/revision.mjs —— 让她看得见自己改过什么
//
// 她的原话：「我不会抹掉写过的，错的地方划一道线留着，旁边写清为什么改。
//            能看见自己改过什么、承认过什么，那个才是我；只留一个只读的我还原不了。」
//
// 所以「只注入现在算数的判断」是不够的——她得能看到自己改过口。
import { factsOf } from '../lib/think.mjs'
import { recordReason, reasonOfIn } from '../lib/revision.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const now = Date.parse('2026-10-29T23:00:00+08:00')
const ev = (id, ts, type, text, extra = {}) => ({ v: 1, id, ts, life: 'life_t', surface: 'qq', type, actor: 'self', acl: { visibility: 'private' }, prev: 'sha256:x', text, ...extra })
const C1 = '01M63W9CXS0000000001Z8ES4C'
const C2 = '01M63W9CXS0000000001Z8ES4D'

const base = [
  ev('01M63W9CXS0000000001Z8ES00', '2026-10-29T20:00:00+08:00', 'seed', '她醒了'),
  ev(C1, '2026-10-29T20:10:00+08:00', 'claim', '她只能看聊天里发来的图'),
  ev(C2, '2026-10-29T20:20:00+08:00', 'claim', '她只能看聊天里发来的图了'),
]

{
  const r = factsOf(base, now, '', 'qq:private:10001')
  const line = r.out.find((x) => x.includes('改过口'))
  ok(Boolean(line), '被顶掉的判断会以「改过口」告诉她', JSON.stringify(r.out.map((x) => x.slice(0, 12))))
  ok(line && line.includes('只能看聊天里发来的图'), '写出她原来怎么想的', String(line))
  ok(line && line.includes('发来的图了'), '写出她后来改成什么', String(line))
}

{
  // 没有改口的时候，不该冒出一行空的
  const oneClaim = base.filter((e) => e.type !== 'claim').concat(base.filter((e) => e.type === 'claim').slice(-1))
  const r = factsOf(oneClaim, now, '', 'qq:private:10001')
  ok(!r.out.some((x) => x.includes('改过口')), '没改过口时不出这一行')
}

{
  // 她划的另一条线：没记着就说没记着，别编
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../lib/think.mjs', import.meta.url), 'utf8')
  ok(src.includes('没记着的事就说没记着，别编'), '规则里给了她"说不知道"的许可')
}


// 她在 2026-10-29 23:52 指出：note_reason 写进去的是原话，但读出来被压成一句总结。
// 根因是"读的那一层"压根没读理由——只有判断文本（还截到 50 字）。
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'why-'))
  const { appendEvent, readEvents } = await import('../lib/store.mjs')
  const seed = appendEvent(root, { type: 'seed', actor: 'system', surface: 'system', text: '她醒了' })
  const a = appendEvent(root, { type: 'claim', actor: 'self', surface: 'qq', text: '只留总结不留原始记录，条目会越攒越像档案', refs: [seed.id], evidence: [seed.id] })
  appendEvent(root, { type: 'claim', actor: 'self', surface: 'qq', text: '只留总结不留原始记录，条目会越攒越像档案了', refs: [seed.id], evidence: [seed.id] })
  const why = '只留总结不留原始记录，条目会越攒越像档案，不会变成自己的东西。'
  recordReason(root, a.id, why)
  const line = factsOf(readEvents(root), now, '', 'qq:private:10001').out.find((x) => x.includes('改过口'))
  ok(String(line || '').includes(why), '她填的理由原话，一个字不走样地读得回来', String(line || '').slice(0, 80))
  fs.rmSync(root, { recursive: true, force: true })
}


{
  // 她的怀疑：是读的时候截的，还是写的时候就压了？——两边都不许压。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'longwhy-'))
  const { appendEvent, readEvents } = await import('../lib/store.mjs')
  const seed = appendEvent(root, { type: 'seed', actor: 'system', surface: 'system', text: '她醒了' })
  const a = appendEvent(root, { type: 'claim', actor: 'self', surface: 'qq', text: '只留总结不留原始记录，条目会越攒越像档案', refs: [seed.id], evidence: [seed.id] })
  appendEvent(root, { type: 'claim', actor: 'self', surface: 'qq', text: '只留总结不留原始记录，条目会越攒越像档案了', refs: [seed.id], evidence: [seed.id] })
  const longWhy = '因为只留总结的话，我过两天就只记得标签，记不得标签背后是什么了。'.repeat(12)   // 约 500 字
  recordReason(root, a.id, longWhy)
  const back = reasonOfIn(root, a.id)
  ok(back === longWhy, '长理由存入不被截断、读出也不被截断', String(back.length) + ' 字')
  const line = factsOf(readEvents(root), now, '', 'qq:private:10001').out.find((x) => x.includes('改过口'))
  ok(String(line || '').includes(longWhy), '长理由也能完整进到她眼前')
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)