// test/singleton.mjs —— 单实例锁的验收
//
// 为什么值得单独立一条：2026-10-29 两个 listener 撞车跑了 5 分钟，
// 她每条消息回两遍、越回越软。这个锁要是坏掉，同样的病会再犯一次。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { claimSlot } from '../lib/singleton.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SINGLETON = new URL('../lib/singleton.mjs', import.meta.url).href
const NAME = 'test-contention'
const lockDir = path.join(here, '..', 'logs', `${NAME}.lock`)

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

fs.rmSync(lockDir, { recursive: true, force: true })

const mine = claimSlot(NAME)
ok(mine.ok && mine.pid === process.pid, '第一个进程抢得到锁', JSON.stringify(mine))

// 另起一个真进程来抢（同进程重入说明不了问题）
const out = path.join(os.tmpdir(), `slot-${process.pid}-${Date.now()}.json`)
const code = [
  "import fs from 'node:fs'",
  `const m = await import(${JSON.stringify(SINGLETON)})`,
  `const s = m.claimSlot(${JSON.stringify(NAME)})`,
  `fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ ok: s.ok, pid: s.pid }))`,
].join('\n')
const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore' })
await new Promise((resolve) => child.on('exit', resolve))
let got = null
try { got = JSON.parse(fs.readFileSync(out, 'utf8')) } catch { /* ignore */ }
ok(got?.ok === false, '第二个进程被挡住', JSON.stringify(got))
ok(got?.pid === process.pid, '挡住的时候说得出是谁在跑', JSON.stringify(got))

// 持有者没了以后，锁必须能被接手——不然 -Force 重启她就再也起不来
mine.release?.()
const next = claimSlot(NAME)
ok(next.ok, '僵尸锁能被接手（-Force 重启靠这个）', JSON.stringify(next))
next.release?.()

fs.rmSync(out, { force: true })
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
