// test/schema.mjs —— 事件形状契约（欠账⑤）
//
// 事件流是唯一真相。字段悄悄变了，派生层不会报错，只会安静算错——
// 这是最难查的一类问题。所以这里把"什么算一条合法事件"钉死。
import { validateEvent, offenders, EVENT_TYPES } from '../lib/schema.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const good = {
  v: 1, id: '01M639C71R0000000002JKQJWE', ts: '2026-10-29T15:00:00+08:00', life: 'life_t',
  surface: 'qq', type: 'utterance', actor: 'self', acl: { visibility: 'private' }, prev: 'sha256:abc', text: '在。',
}
{
  ok(validateEvent(good).ok, '一条标准事件过关', JSON.stringify(validateEvent(good).errors))
  ok(EVENT_TYPES.includes('claim') && EVENT_TYPES.includes('tombstone'), '类型表里有 claim / tombstone')

  const bad = (patch, label) => {
    const r = validateEvent({ ...good, ...patch })
    ok(!r.ok && r.errors.length > 0, label, r.errors.join('; '))
  }
  bad({ v: 2 }, '版本号不对')
  bad({ id: 'short' }, 'id 不是 ULID')
  bad({ ts: '昨天下午' }, '时间不可解析')
  bad({ type: 'dream' }, '不认识的类型')
  bad({ acl: {} }, '缺 acl.visibility')
  bad({ prev: '' }, '缺 prev（链会断）')
  bad({ text: undefined }, '内容型事件缺 text')
  bad({ refs: 'abc' }, 'refs 不是数组')
  bad({ evidence: [1, 2] }, 'evidence 不是字符串数组')
  bad({ meta: null }, 'meta 不是对象')

  ok(validateEvent(null).ok === false, 'null 不炸')
  ok(offenders([good, { ...good, id: 'x' }]).length === 1, '一批里挑出不合法的那条')
  ok(offenders([]).length === 0, '空数组没有不合法')
}

{
  // 真实事件流必须干净——这条如果红了，说明有人改了写入格式
  const fs = await import('node:fs')
  const { readEvents } = await import('../lib/store.mjs')
  const root = 'E:/DSH-herself/life'
  if (fs.existsSync(root + '/events.jsonl')) {
    const ev = readEvents(root)
    const bad = offenders(ev)
    ok(bad.length === 0, `她的 ${ev.length} 条真实事件全部合形状`, JSON.stringify(bad.slice(0, 3)))
  } else {
    ok(true, '（这台机器上没有她的生活目录，跳过真实数据检查）')
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)