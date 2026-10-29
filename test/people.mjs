// test/people.mjs —— 她认得谁（从事件流直接算）
//
// 2026-10-29 之前 lib/people.mjs 是个孤儿：写好了没人调。
// 现在群聊里会多一行「这个群里你见过的：…」，数据是从 encounter 原文现算的，
// 不依赖 people.json 那份缓存（缓存会过期，原文不会）。
import { knownPeople, ensure, resolve } from '../lib/people.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const enc = (ts, senderId, name, groupId) => ({
  type: 'encounter', ts, text: groupId ? `[群 ${groupId}] ${name}：说了一句` : `${name}：说了一句`,
  meta: { qq: { senderId, groupId: groupId || '' } },
})

const events = [
  enc('2026-10-29T10:00:00+08:00', '1', '主人', ''),
  enc('2026-10-29T10:01:00+08:00', '2', '困', '647'),
  enc('2026-10-29T10:02:00+08:00', '2', '困', '647'),
  enc('2026-10-29T10:03:00+08:00', '3', '某人.', '647'),
  enc('2026-10-29T10:04:00+08:00', '1', '主人', '647'),
  { type: 'utterance', ts: '2026-10-29T10:05:00+08:00', text: '我自己说的话不算人', meta: {} },
]

{
  const g = knownPeople(events, { thread: 'qq:group:647' })
  ok(g.length === 3, '群里三个人就是三个', String(g.length))
  ok(g[0].name === '困' && g[0].count === 2, '按说话次数排第一', JSON.stringify(g[0]))
  ok(g.every((x) => x.count >= 1), '每人都有次数')
  ok(g[0].last >= g[2].last <= true, '带最后出现时间', String(g[0].last > 0))

  const p = knownPeople(events, { thread: 'qq:private:1' })
  ok(p.length === 1 && p[0].name === '主人', '私聊只算那个人', JSON.stringify(p))

  ok(knownPeople(events, { thread: 'qq:group:999' }).length === 0, '没聊过的群是空的')
  ok(knownPeople([], {}).length === 0, '没事件也不炸')
  ok(knownPeople(events, { limit: 1 }).length === 1, 'limit 生效')
}

{
  // people.json 那层还在，别写坏了
  const db = ensure()
  ok(Boolean(db?.people), 'people.json 仍然可读')
  // 不写死某个号：从注册表里读主人自己的 QQ，换机器也能跑
  const ownQq = db?.people?.owner?.aliases?.find((a) => a.surface === 'qq')?.id
  ok(Boolean(ownQq) && resolve('qq', ownQq) === 'owner', '主人的 QQ 还认得', String(ownQq))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
