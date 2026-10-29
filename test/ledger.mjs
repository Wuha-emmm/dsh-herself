// test/ledger.mjs —— 账本：只挑「该办的事」，而且不催
//
// 2026-10-29 她自己划的线：记答应过的、改口的、要睡没睡的；别排日程；
// 空白就是空白；先看格式再动手。这个文件守的就是这几条。
import { candidates, ledgerLine, ledgerReply } from '../lib/ledger.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const now = Date.parse('2026-10-29T23:00:00+08:00')
const ev = (ts, type, text, extra = {}) => ({ type, ts, text, ...extra })
const him = (ts, text) => ev(ts, 'encounter', `呜哈：${text}`, { meta: { qq: { senderId: '1', groupId: '' } } })
const grp = (ts, text) => ev(ts, 'encounter', `[群 9] 某人：${text}`, { meta: { qq: { senderId: '2', groupId: '9' } } })

// ---------------------------------------------------------------- 要睡没睡
{
  const day = [
    him('2026-10-29T22:00:00+08:00', '准备去睡觉了'),
    him('2026-10-29T22:10:00+08:00', '对了那个文件'),
    him('2026-10-29T22:20:00+08:00', '还有个事'),
    him('2026-10-29T22:30:00+08:00', '再说一句'),
  ]
  const r = candidates(day, now)
  ok(r.length === 1 && r[0].kind === 'sleep', '说了要睡又冒出来好几次 → 记一条', JSON.stringify(r.map((x) => x.kind)))
  ok(/^之后又来了 3 次$/.test(r[0].why), '理由只摆事实，不加解释', r[0].why)
  ok(!/呜哈：/.test(r[0].text), '正文去掉「谁：」前缀', r[0].text)
}

{
  // 群里的"睡爽了"、B站视频名里的"睡不醒酒"、问句——都不算
  const day = [
    grp('2026-10-29T22:00:00+08:00', '睡爽了'),
    grp('2026-10-29T22:05:00+08:00', '睡不醒酒更新了'),
    him('2026-10-29T22:10:00+08:00', '你还记得我啥时候说要睡觉吗'),
    grp('2026-10-29T22:20:00+08:00', '睡'),
    grp('2026-10-29T22:30:00+08:00', '睡'),
  ]
  ok(candidates(day, now).length === 0, '群聊闲扯 / 问句 / 视频名都不算"要睡"')
}

{
// 2026-10-29 部署验证时抓到的：一条几百字的消息里引用了"要睡"，被当成他要睡
{
  const long = '按她说的改了，原始输出都在下面。第一次实跑（改之前）那一段里提到了要睡，还有别的内容，整段很长很长，超过三十个字。'
  const day = [him('2026-10-29T22:00:00+08:00', long), him('2026-10-29T22:05:00+08:00', 'x'), him('2026-10-29T22:06:00+08:00', 'y'), him('2026-10-29T22:07:00+08:00', 'z')]
  ok(candidates(day, now).length === 0, '长句里引用「要睡」不算，只认短句', JSON.stringify(candidates(day, now).map((x) => x.kind)))
}

  // 只有一两条后续，不算没睡
  const day = [him('2026-10-29T22:00:00+08:00', '去睡了'), him('2026-10-29T22:05:00+08:00', '晚安'), him('2026-10-29T22:06:00+08:00', '嗯')]
  ok(candidates(day, now).length === 0, '说睡之后只补两句，不当成"没睡"')
}

// ---------------------------------------------------------------- 同一晚只记一次
{
  const day = [him('2026-10-29T22:00:00+08:00', '去睡了')]
  for (let i = 1; i <= 4; i += 1) day.push(him(`2026-10-29T22:${10 + i}:00+08:00`, `第${i}条`))
  day.push(him('2026-10-29T23:30:00+08:00', '我又要去睡了'))
  for (let i = 1; i <= 3; i += 1) day.push(him(`2026-10-29T23:4${i}:00+08:00`, `晚${i}`))
  const r = candidates(day, now)
  ok(r.filter((x) => x.kind === 'sleep').length === 1, '3 小时内只记一次（不重复记他）', String(r.length))
}

// ---------------------------------------------------------------- 答应过 / 改口
{
  const day = [
    ev('2026-10-29T10:00:00+08:00', 'commitment', '说好了明早把记录整理好', { meta: { status: 'open' } }),
    ev('2026-10-29T11:00:00+08:00', 'claim', '我以为她只能看一帧', { meta: { supersededBy: 'X' } }),
  ]
  const r = candidates(day, now)
  ok(r.some((x) => x.kind === 'promise'), '没了的承诺进候选')
  ok(r.some((x) => x.kind === 'changed'), '被自己顶掉的判断进候选')
}

// ---------------------------------------------------------------- 不催 / 空白
{
  ok(ledgerLine([]) === '', '今天没事 → 一个字都不说')
  const line = ledgerLine(candidates([him('2026-10-29T22:00:00+08:00', '去睡了')].concat([1, 2, 3].map((i) => him(`2026-10-29T22:0${i}:30+08:00`, `x${i}`))), now))
  ok(/记不记你定/.test(line) && !/待办|请|务必/.test(line), '有候选时也是「你定」，不是待办', line)
  ok(candidates([], now).length === 0, '空事件不炸')
}


// ---------------------------------------------------------------- 摆了就摆了，不许催
{
  // 2026-10-29 她补的一条线：
  //   「候选是摆给我看的，不是给你俩当待办的——我调出来什么都不写，别有人在旁边问'怎么不记'。」
  const empty = ledgerReply([])
  ok(empty === '今天没什么该记的。', '空的时候只说"没什么"，不带尾巴', empty)
  ok(!/要记|应该|记得|别忘|待办|务必/.test(empty), '空的时候没有任何催促词')

  const some = ledgerReply(candidates([
    ev('2026-10-29T22:00:00+08:00', 'encounter', '呜哈：去睡了', { meta: { qq: { senderId: '1', groupId: '' } } }),
    ev('2026-10-29T22:05:00+08:00', 'encounter', '呜哈：再看一眼', { meta: { qq: { senderId: '1', groupId: '' } } }),
    ev('2026-10-29T22:06:00+08:00', 'encounter', '呜哈：还有', { meta: { qq: { senderId: '1', groupId: '' } } }),
    ev('2026-10-29T22:07:00+08:00', 'encounter', '呜哈：最后一句', { meta: { qq: { senderId: '1', groupId: '' } } }),
  ], now))
  ok(!/要记|应该|记得|别忘|待办|务必/.test(some), '有候选时也不催、不给建议', some)
  ok(/可能值得记/.test(some), '只是摆出来，语气是"可能"', some)
}

// ---------------------------------------------------------------- 观察期：可以按类关掉
{
  // 她的原话：「明早我把误收的原文列给你，能改就改，改不了就先关掉那一类。」
  const day = [
    ev('2026-10-29T22:00:00+08:00', 'encounter', '呜哈：去睡了', { meta: { qq: { senderId: '1', groupId: '' } } }),
    ev('2026-10-29T22:05:00+08:00', 'encounter', '呜哈：再看一眼', { meta: { qq: { senderId: '1', groupId: '' } } }),
    ev('2026-10-29T22:06:00+08:00', 'encounter', '呜哈：还有', { meta: { qq: { senderId: '1', groupId: '' } } }),
    ev('2026-10-29T22:07:00+08:00', 'encounter', '呜哈：最后一句', { meta: { qq: { senderId: '1', groupId: '' } } }),
  ]
  ok(candidates(day, now).length === 1, '全开时有 1 条')
  ok(candidates(day, now, { off: ['sleep'] }).length === 0, '关掉 sleep 这一类就不收', String(candidates(day, now, { off: ['sleep'] }).length))
  ok(candidates(day, now, { off: ['promise', 'changed'] }).length === 1, '关别的类不影响它')
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
