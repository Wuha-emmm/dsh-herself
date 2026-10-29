// lib/singleton.mjs —— 同一个角色，只允许一个进程
//
// 2026-10-29 的事故：boot.ps1 和插件的每分钟巡检撞在同一秒，两边都判「没人」，
// 各起了一个 listener。于是每条消息被处理两遍——第二个进程回话时，第一个的回答
// 已经进了事件流，它只能换个说法再讲一遍。她的回话从那天起变成「每条回两遍、
// 越回越软」。
//
// pids.json 记不住这件事：后写的那次会覆盖前一次，孤儿就永远没人杀。
// 所以锁放在这里，用目录创建（mkdir）的原子性，进程没了锁自动可接手。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// 默认在 logs/；测试可以指到临时目录，避免和真进程抢同一个岗位
const LOCK_ROOT = process.env.DSH_HERSELF_LOCK_DIR || path.join(here, '..', 'logs')

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (err) { return err?.code === 'EPERM' }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** 读锁里的 pid；刚建目录还没写完时多等一会儿 */
function readHolder(dir) {
  for (let i = 0; i < 4; i += 1) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'pid'), 'utf8'))
      if (j?.pid) return j
    } catch { /* 还没写完 */ }
    sleep(40)
  }
  return null
}

/**
 * 抢一个角色。抢不到返回 { ok:false, pid }，调用方应该安静退出。
 * @param {string} name 'qq-listen' | 'wake' | …
 */
export function claimSlot(name) {
  fs.mkdirSync(LOCK_ROOT, { recursive: true })
  const dir = path.join(LOCK_ROOT, `${name}.lock`)
  const release = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'pid'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8')
      process.on('exit', release)
      return { ok: true, pid: process.pid, release }
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err
      const holder = readHolder(dir)
      if (holder && holder.pid !== process.pid && alive(holder.pid)) return { ok: false, pid: holder.pid }
      // 读不到持有者：可能是刚建好还没写 pid（别拆人家的锁），也可能是僵尸锁
      if (!holder) {
        let age = 0
        try { age = Date.now() - fs.statSync(dir).mtimeMs } catch { age = 999999 }
        if (age < 5000) return { ok: false, pid: null }   // 别人正在启动，让给它
      }
      release()   // 僵尸锁：持有者进程已经没了
    }
  }
  return { ok: false, pid: null }
}
