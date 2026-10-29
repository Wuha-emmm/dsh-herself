// test/inbox.mjs —— 她 ↔ DSH 的投递口
//
// 她要的链路（2026-10-30 00:28）：
//   她发现问题 → 投给 DSH → DSH 分析给出解释 → 她收到 → 转给主人
//   → 主人下指令 → 传回 DSH
import { post, all, pendingForDsh, pendingForHer, markSeen, inboxLine, claimNext, answer, release, openClaim, CLAIM_TTL_MS } from '../lib/inbox.mjs'
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

  // 长回复也不许切在半句上（她的原话：截断会让人以为自己没写全）
  post(root, { from: 'dsh', kind: 'answer', text: '第一句很短。'.repeat(3) + '这一句特别长'.repeat(40) + '。收尾。' })
  const long = inboxLine(root)
  ok(!/[^。！？」]$/.test(long.replace(/^DSH 那边回你话了：/, '').replace(/（DSH）/, '')), '不切在半句（以标点收尾）', long.slice(-12))
  ok(all(root).length === 4, '全部条目都留着（append-only）')
  ok(all(root).map((e) => e.from).join(',') === 'her,dsh,owner,dsh', '顺序按投递先后')
}


// ---------------------------------------------------------------- 一次只处理一条
{
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-'))
  post(r2, { from: 'her', kind: 'question', text: '问题甲' })
  post(r2, { from: 'her', kind: 'question', text: '问题乙' })

  const a = claimNext(r2)
  ok(a.ok && a.item.text === '问题甲', '先领最早的一条')
  ok(Boolean(openClaim(r2)), '领了就有锁')

  const b = claimNext(r2)
  ok(!b.ok && Boolean(b.busy), '锁没解之前领不到第二条（避免重复执行）', JSON.stringify(b.busy))
  ok(pendingForDsh(r2).length === 1, '待处理列表里也把领走的排除了', String(pendingForDsh(r2).length))

  answer(r2, a.item.id, '答甲')
  ok(!openClaim(r2), '答完锁自动解开')
  const c = claimNext(r2)
  ok(c.ok && c.item.text === '问题乙', '解锁后能领下一条')

  // 放回去
  release(r2, c.item.id, '不会')
  ok(pendingForDsh(r2).some((e) => e.text === '问题乙'), '放回去的重新进待处理列表')
  const again = claimNext(r2)
  ok(again.ok && again.item.text === '问题乙', '放回去的还能再被领（同一条）', again.item?.text)
  answer(r2, again.item.id, '答乙')

  // 僵尸锁：领了没答，超过 TTL 可以重领
  post(r2, { from: 'her', kind: 'question', text: '问题丙' })
  const d = claimNext(r2)
  ok(d.ok && d.item.text === '问题丙', '接着能领问题丙', d.item?.text)
  const later = Date.now() + CLAIM_TTL_MS + 1000
  ok(openClaim(r2, later) === null, '超过 TTL 的锁视为失效，不会永久卡住')
  fs.rmSync(r2, { recursive: true, force: true })
}


// ---------------------------------------------------------------- 底层安全策略
{
  const { exec } = await import('../lib/toolcall.mjs')
  const r3 = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'))
  ok(String(await exec('ask_dsh', { text: '查代码' }, { root: r3, isOwner: false })).includes('只对主人开'), '陌生人投不出去')
  ok(String(await exec('ask_dsh', { text: '查代码' }, { root: r3, isOwner: true, publicSurface: true })).includes('群里不'), '群里主人也投不出去')
  ok(String(await exec('ask_dsh', { text: '查代码' }, { root: r3, isOwner: true })).includes('投出去了'), '私聊主人才放行')
  for (let i = 0; i < 5; i += 1) await exec('ask_dsh', { text: '第' + i + '条' }, { root: r3, isOwner: true })
  ok(String(await exec('ask_dsh', { text: '第七条' }, { root: r3, isOwner: true })).includes('上限'), '一小时 6 条上限', '第 7 条')
  fs.rmSync(r3, { recursive: true, force: true })
}

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)