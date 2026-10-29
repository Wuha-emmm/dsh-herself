// test/context.mjs —— 她这一轮到底看得见什么
//
// 2026-10-29 的 bug：她说的话没有 qq 元信息，认线时回落成 'qq'，
// 于是按线程过滤时**她自己的回复全被排除**——私聊里只剩对方最近三句。
// 表现：重复追问、答过的再问、"像卡了 bug"。
// 这条测试守的是：她的视野里必须有她自己的话，而且窗口不能只剩三条。
import { threadOf, pickRecent, indexById, factsOf } from '../lib/think.mjs'
import { ulidAt } from '../lib/util.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const now = Date.parse('2026-10-29T14:00:00+08:00')
const P = 'qq:private:REDACTED_QQ'

function mk(ts, i, type, extra = {}) {
  return {
    v: 1, id: ulidAt(Date.parse(ts), i + 1), ts, life: 'life_t', surface: extra.surface ?? 'qq', type,
    actor: extra.actor ?? (type === 'utterance' ? 'self' : type === 'seed' ? 'system' : 'other:qq_REDACTED_QQ'),
    acl: { visibility: 'private' },
    ...(extra.text !== undefined ? { text: extra.text } : {}),
    ...(extra.refs ? { refs: extra.refs } : {}),
    ...(extra.meta ? { meta: extra.meta } : {}),
  }
}

const events = [
  mk('2026-10-29T09:00:00+08:00', 0, 'seed', { actor: 'system', surface: 'dsh' }),
  mk('2026-10-29T13:30:00+08:00', 1, 'encounter', { text: '呜哈：在吗', meta: { qq: { senderId: 'REDACTED_QQ', groupId: '', private: true } } }),
  mk('2026-10-29T13:30:10+08:00', 2, 'utterance', { text: '在。', meta: {} }),
  mk('2026-10-29T13:31:00+08:00', 3, 'encounter', { text: '呜哈：这个问题答过了吗', meta: { qq: { senderId: 'REDACTED_QQ', groupId: '', private: true } } }),
  mk('2026-10-29T13:31:10+08:00', 4, 'utterance', { text: '答过了，你刚问的。', meta: { thread: P } }),
  mk('2026-10-29T13:32:00+08:00', 5, 'encounter', { text: '呜哈：那再来一次', meta: { qq: { senderId: 'REDACTED_QQ', groupId: '', private: true } } }),
]
// 老事件没有 meta.thread，靠 refs 找回自己当时在回谁：
// 她说的话指向触发它的那条 encounter（这正是 think() 从 causeId 写进去的东西）
events[2].refs = [events[1].id]
events[3].refs = [events[2].id]

const byId = indexById(events)

// ---------------------------------------------------------------- 认线
ok(threadOf(events[1], byId) === P, '他发的私聊消息认得出来')
ok(threadOf(events[4], byId) === P, '她自己记了 thread 的新消息认得出来')
ok(threadOf(events[2], byId) === P, '老消息（没有 thread）靠 refs 找回线程', threadOf(events[2], byId))

// ---------------------------------------------------------------- 窗口
const recent = pickRecent(events, 6, P, byId)
const herLines = recent.filter((e) => e.type === 'utterance')
ok(herLines.length >= 2, '窗口里必须有她自己说的话（这就是那个 bug）', `她自己 ${herLines.length} 条 / 共 ${recent.length}`)
ok(recent.length > 3, '私聊窗口不该只剩三条', String(recent.length))
ok(recent.every((e) => threadOf(e, byId) === P), '窗口里不混进别的线程')

// ---------------------------------------------------------------- 进得了提示词
const { out } = factsOf(events, now, '再来一次', P)
const recentLine = out.find((l) => l.startsWith('最近：')) ?? ''
ok(/你说：/.test(recentLine), '提示词的「最近」里看得到「你说」', recentLine.slice(0, 80))
ok(/在。/.test(recentLine) || /答过了/.test(recentLine), '说过的内容真的在', recentLine.slice(0, 80))

// ---------------------------------------------------------------- 群聊不串台
{
  const g = mk('2026-10-29T13:33:00+08:00', 9, 'encounter', { text: '[群 647334703] 某人：群里的消息', meta: { qq: { senderId: '1', groupId: '647334703' } } })
  const mixed = [...events, g]
  const pv = pickRecent(mixed, 6, P, indexById(mixed))
  ok(!pv.some((e) => e.id === g.id), '群聊消息不会混进私聊窗口')
}

// ---------------------------------------------------------------- 旧摘要别在热聊里念
{
  // 冷线：摘要之后没再说话 → 该念（这是「上次聊到」的用处）
  const cold = [
    mk('2026-10-29T09:00:00+08:00', 0, 'seed', { actor: 'system', surface: 'dsh' }),
    mk('2026-10-29T09:10:00+08:00', 1, 'encounter', { text: '呜哈：我们先聊到这', meta: { qq: { senderId: 'REDACTED_QQ', groupId: '', private: true } } }),
    mk('2026-10-29T09:30:00+08:00', 2, 'summary', { text: '我们说好下次接着聊那个方案。', meta: { thread: P } }),
  ]
  const a = factsOf(cold, Date.parse('2026-10-29T14:00:00+08:00'), '', P).out
  ok(a.some((l) => l.startsWith('你们上次聊到：')), '冷掉的线：会念「上次聊到」')

  // 热线：摘要之后又说了话 → 不该念（否则旧意图会覆盖新事实）
  const hot = [
    ...cold,
    mk('2026-10-29T09:40:00+08:00', 3, 'encounter', { text: '呜哈：我回来了', meta: { qq: { senderId: 'REDACTED_QQ', groupId: '', private: true } } }),
  ]
  const b = factsOf(hot, Date.parse('2026-10-29T14:00:00+08:00'), '', P).out
  ok(!b.some((l) => l.startsWith('你们上次聊到：')), '摘要之后又说过话：不再念旧摘要（2026-10-29 实测她因此又去追已了结的事）')
  ok(b.some((l) => l.startsWith('最近：')), '这时候由「最近」接管')
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
