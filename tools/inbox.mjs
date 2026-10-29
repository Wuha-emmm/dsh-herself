// tools/inbox.mjs —— DS/主人这一侧的邮箱操作台
//
//   node tools/inbox.mjs                     # 看有哪些在等我处理
//   node tools/inbox.mjs all                 # 看全部
//   node tools/inbox.mjs reply "解释内容"      # 回给她（她会看到）
//   node tools/inbox.mjs order "修复指令"      # 主人口吻的指令（也算给她的话）
import { all, pendingForDsh, pendingForHer, post, markSeen } from '../lib/inbox.mjs'

const ROOT = 'E:/DSH-herself/life'
const [cmd, ...rest] = process.argv.slice(2)

if (cmd === 'reply' || cmd === 'order') {
  const text = rest.join(' ').trim()
  if (!text) { console.error('要写内容'); process.exit(1) }
  const e = post(ROOT, { from: cmd === 'order' ? 'owner' : 'dsh', kind: cmd === 'order' ? 'order' : 'answer', text })
  console.log(`${cmd === 'order' ? '指令' : '回复'}已投递：${e.id}`)
  process.exit(0)
}

if (cmd === 'all') {
  for (const e of all(ROOT)) console.log(String(e.at).slice(11, 19), e.from.padEnd(6), e.kind.padEnd(9), e.text.slice(0, 100))
  process.exit(0)
}

if (cmd === 'seen') { markSeen(ROOT, 'dsh'); console.log('她把的未读都标成已读了'); process.exit(0) }

const mine = pendingForDsh(ROOT)
const hers = pendingForHer(ROOT)
console.log(`等我处理：${mine.length} 条`)
for (const e of mine) console.log('  ', String(e.at).slice(11, 19), e.text.slice(0, 110))
console.log(`她还没看：${hers.length} 条`)
for (const e of hers) console.log('  ', String(e.at).slice(11, 19), e.from, e.text.slice(0, 80))