// test/ledger.mjs —— 账本：只挑「该办的事」，而且不催
//
// 2026-10-29 她自己划的线：记答应过的、改口的、要睡没睡的；别排日程；
// 空白就是空白；先看格式再动手；写过的别重复摆。
import { candidates, ledgerLine, ledgerReply, parseRecorded, isRecorded } from '../lib/ledger.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const now = Date.parse('2026-10-29T23:00:00+08:00')
const ev = (ts, type, text, extra = {}) => ({ type, ts, text, ...extra })
const him = (ts, text) => ev(ts, 'encounter', `主人：${text}`, { meta: { qq: { senderId: '1', groupId: '' } } })
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
  ok(r[0] && /^之后又来了 \d+ 次$/.test(r[0].why), '理由只摆事实，不加解释', r[0]?.why)
  ok(!/主人：/.test(r[0]?.text ?? ''), '正文去掉「谁：」前缀', r[0]?.text)
}

// ---------------------------------------------------------------- 假阳性
{
  const day = [
    grp('2026-10-29T22:00:00+08:00', '睡爽了'),
    grp('2026-10-29T22:05:00+08:00', '睡不醒酒更新了'),
    him('2026-10-29T22:10:00+08:00', '你还记得我啥时候说要睡觉吗'),
    grp('2026-10-29T22:20:00+08:00', '睡'),
    grp('2026-10-29T22:30:00+08:00', '睡'),
  ]
  ok(candidates(day, now).length === 0, '群聊闲扯 / 问句 / 视频名都不算"要睡"')

  const long = '按她说的改了，原始输出都在下面。第一次实跑那一段里提到了要睡，还有别的内容，整段很长很长，超过三十个字。'
  const d2 = [him('2026-10-29T22:00:00+08:00', long), him('2026-10-29T22:05:00+08:00', 'x'), him('2026-10-29T22:06:00+08:00', 'y'), him('2026-10-29T22:07:00+08:00', 'z')]
  ok(candidates(d2, now).length === 0, '长句里引用「要睡」不算，只认短句')

  const d3 = [him('2026-10-29T22:00:00+08:00', '去睡了'), him('2026-10-29T22:05:00+08:00', '晚安'), him('2026-10-29T22:06:00+08:00', '嗯')]
  ok(candidates(d3, now).length === 0, '说睡之后只补两句，不当成「没睡」')
}

// ---------------------------------------------------------------- 同一晚只记一次
{
  const day = [him('2026-10-29T22:00:00+08:00', '去睡了')]
  for (let i = 1; i <= 4; i += 1) day.push(him(`2026-10-29T22:1${i}:00+08:00`, `第${i}条`))
  day.push(him('2026-10-29T23:30:00+08:00', '我又要去睡了'))
  for (let i = 1; i <= 3; i += 1) day.push(him(`2026-10-29T23:4${i}:00+08:00`, `晚${i}`))
  ok(candidates(day, now).filter((x) => x.kind === 'sleep').length === 1, '3 小时内只记一次（不重复记他）')
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

// ---------------------------------------------------------------- 空白 / 不催
{
  ok(ledgerLine([]) === '', '今天没事 → 一个字都不说')
  ok(ledgerReply([]) === '今天没什么该记的。', '空的时候只说「没什么」，不带尾巴')
  const some = ledgerReply(candidates([
    him('2026-10-29T22:00:00+08:00', '去睡了'),
    him('2026-10-29T22:05:00+08:00', '看'),
    him('2026-10-29T22:06:00+08:00', '还'),
    him('2026-10-29T22:07:00+08:00', '最后'),
  ], now))
  ok(!/要记|应该|记得|别忘|待办|务必/.test(some), '有候选时也不催、不给建议', some)
  ok(/可能值得记/.test(some), '只是摆出来，语气是"可能"')
}

// ---------------------------------------------------------------- 按类关掉
{
  const day = [
    him('2026-10-29T22:00:00+08:00', '去睡了'),
    him('2026-10-29T22:05:00+08:00', '再看一眼'),
    him('2026-10-29T22:06:00+08:00', '还有'),
    him('2026-10-29T22:07:00+08:00', '最后一句'),
  ]
  ok(candidates(day, now).length === 1, '全开时有 1 条')
  ok(candidates(day, now, { off: ['sleep'] }).length === 0, '关掉 sleep 这一类就不收')
}

// ---------------------------------------------------------------- 她写过的就别再摆一遍
{
  // 她在私聊里点的：「账本和睡觉记录各记一份，同一件事可能重复」
  const md = ['# 说睡 / 改主意 / 答应的事', '', '- 10 月 29 日 14:49 —— 主人说准备去睡觉了（之后又来了 14 次）'].join('\n')
  const rec = parseRecorded(md)
  ok(rec.length === 1 && rec[0].hm === '14:49', '能读她自己写的格式', JSON.stringify(rec))
  ok(isRecorded({ at: '2026-10-29T06:49:14.038Z', text: '准备去睡觉了' }, rec), '同一件事（UTC 06:49 = 本地 14:49）算记过')
  ok(!isRecorded({ at: '2026-10-29T12:00:00.000Z', text: '完全不同的事' }, rec), '别的事不算记过')

  const day = [
    him('2026-10-29T22:00:00+08:00', '准备去睡觉了'),
    him('2026-10-29T22:10:00+08:00', 'a'),
    him('2026-10-29T22:20:00+08:00', 'b'),
    him('2026-10-29T22:30:00+08:00', 'c'),
  ]
  const before = candidates(day, now).length
  const rec2 = parseRecorded('- 10 月 29 日 22:00 —— 他说要睡了')
  ok(before === 1 && candidates(day, now, { recorded: rec2 }).length === 0, '写进记录后，候选里不再出现', `${before} → ${candidates(day, now, { recorded: rec2 }).length}`)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)