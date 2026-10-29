// test/brain.mjs —— 一份生活只能有一个大脑
//
// 2026-10-29 的事故形状：角色锁只防"同一个岗位起两个进程"，
// 但两个 DSH 工作区各跑一份插件时，两份都能往同一份事件流里写——
// 同一份生活里出现两个「她」。这条测试钉的就是"第二个必须只读"。
import { decideClaim, claimBrain, heartbeatBrain, brainStatus, releaseBrain, STALE_MS, lockDir } from '../lib/brain.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 纯决策
{
  ok(decideClaim({}).take, '没人的时候可以占')
  ok(decideClaim({ owner: { pid: 999 }, ageMs: STALE_MS + 1 }).reason === 'stale', '心跳过期 → 可以接手')
  ok(decideClaim({ owner: { pid: 999 }, ageMs: 1000 }).reason === 'busy', '有人在跑 → 拒绝')
  ok(!decideClaim({ owner: { pid: 999 }, ageMs: 1000 }).take, '拒绝就是拒绝，不给"硬上"的口子')
  ok(decideClaim({ owner: { pid: 42 }, ageMs: 0, selfPid: 42 }).reason === 'self', '自己已经持有 → 允许')
  ok(STALE_MS >= 60000, '心跳窗口至少一分钟（不然网络抖动就换脑）')
}

// ---------------------------------------------------------------- 真的占一次
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'))
  const a = claimBrain(root, { role: 'test', build: 'x' })
  ok(a.ok, '第一个进程占到了脑子', JSON.stringify(a))

  const st = brainStatus(root)
  ok(st.live && st.owner.pid === process.pid, '状态里能看到持有者', JSON.stringify(st.owner))
  ok(st.owner.role === 'test', '带上了角色')

  // 同一个进程再占：应该认自己（不把自己挡在外面）
  const b = claimBrain(root, { role: 'test2' })
  ok(b.ok, '同一个进程重复占：认自己')

  // 心跳写得进去
  ok(heartbeatBrain(root), '心跳能写')
  ok(brainStatus(root).ageMs < 5000, '心跳之后年龄变小了')

  ok(releaseBrain(root), '能主动让出')
  ok(!brainStatus(root).owner, '让出之后没人持有')
  ok(fs.existsSync(lockDir(root)) === false, '锁目录被删干净')
  fs.rmSync(root, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 僵尸锁能接手
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'))
  fs.mkdirSync(lockDir(root), { recursive: true })
  // 写一个"心跳很久以前"的假持有者
  fs.writeFileSync(path.join(lockDir(root), 'pid'), JSON.stringify({ pid: 999999, at: new Date(Date.now() - STALE_MS - 60000).toISOString(), role: 'ghost' }))
  const r = claimBrain(root, { role: 'me' })
  ok(r.ok, '过期的僵尸锁可以接手', JSON.stringify(r))
  ok(brainStatus(root).owner.pid === process.pid, '接手之后持有者是自己')
  releaseBrain(root)
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)