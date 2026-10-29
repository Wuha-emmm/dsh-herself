// test/inbox.mjs —— 她 ↔ DSH 的投递口
//
// 她要的链路（2026-10-30 00:28）：
//   她发现问题 → 投给 DSH → DSH 分析给出解释 → 她收到 → 转给主人
//   → 主人下指令 → 传回 DSH
import { post, all, pendingForDsh, pendingForHer, markSeen, inboxLine } from '../lib/inbox.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'))
{
  ok(all(root).length === 0, '空邮箱不炸')
  ok(inboxLine(root) === '', '没消息时她一个字都看不到')

  const q = post(root, { from: 'her', kind: 'question', text: '刚刚会话被截断了，帮我查原因' })
  ok(Boolean(q.id) && Boolean(q.at), '投递会生成 id 和时间')
  ok(pendingForDsh(root).length === 1, 'DS 这边有一条待处理')
  ok(pendingForHer(root).length === 0, '她自己投的不算"待她看"')

  post(root, { from: 'dsh', kind: 'answer', text: '查到了：reasoning 564 + 输出 50 撞满 600' })
  ok(pendingForHer(root).length === 1, 'DS 回了，她就有一条待看')
  const line = inboxLine(root)
  ok(line.includes('DSH') && line.includes('reasoning'), '那一行写清是谁回的、回了什么', line)

  markSeen(root, 'her')
  ok(inboxLine(root) === '', '看过之后不再重复念')

  post(root, { from: 'owner', kind: 'order', text: '把预算拉到 8192' })
  ok(inboxLine(root).includes('主人'), '主人的指令也走同一条通道', inboxLine(root))

  ok(all(root).length === 3, '全部条目都留着（append-only）')
  ok(all(root).map((e) => e.from).join(',') === 'her,dsh,owner', '顺序按投递先后')
}

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)