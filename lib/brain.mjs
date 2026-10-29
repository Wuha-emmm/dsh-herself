// lib/brain.mjs —— 一份生活，只能有一个「大脑」
//
// 事故背景（2026-10-29）：`hands/qq.mjs` 和 `wake.mjs` 各有一个角色锁（`lib/singleton.mjs`），
// 但那只防「同一个角色起两个进程」。真正危险的是**另一种撞车**：
// 两个 DSH 工作区各跑一份插件，两份插件都能往同一份 `life/events.jsonl` 里写事件
// （`/api/say` 手动让她说、`/api/stack/start` 又各起一套 listener）。
// 于是同一份生活里出现两个「她」——各自以为自己在说话，事件流里两条线互相打架。
//
// 所以再加一层：**脑子级别的占位**。
//   · 谁在思考（listener 进程）就先占住 `life/.brain.lock`；
//   · 占不到的那一方**只读**：面板照样能看，但不许写事件、不许再起一套进程；
//   · 占位带心跳，进程没了别人能接手（和角色锁一样的原子 mkdir，不靠 pid 文件猜）。
//
// 与角色锁的分工：
//   角色锁 = 同一台机器上「同一个岗位」只能一个人干（qq-listen / wake）
//   脑子锁 = 同一份生活里「会思考的那个人」只能有一个（跨进程、跨 DSH 工作区）
import fs from 'node:fs'
import path from 'node:path'

/** 心跳超过这个时间没更新，视为僵尸（listener 每 20s 心跳一次） */
export const STALE_MS = 90 * 1000

/** 锁目录放在生活目录里：换一份 life 就是另一个脑子，天然隔离 */
export function lockDir(root) {
  return path.join(root, '.brain.lock')
}

/**
 * 纯决策：现在能不能占？（不碰文件系统，方便测）
 * @param {{owner?:{pid:number,at:string,role?:string}|null, ageMs:number, selfPid:number}} p
 * @returns {{take:boolean, reason:'empty'|'stale'|'dead'|'self'|'busy'}}
 */
export function decideClaim({ owner = null, ageMs = Infinity, selfPid = 0 } = {}) {
  if (!owner) return { take: true, reason: 'empty' }
  if (owner.pid === selfPid) return { take: true, reason: 'self' }
  if (ageMs > STALE_MS) return { take: true, reason: 'stale' }
  return { take: false, reason: 'busy' }
}

function alive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (err) { return err?.code === 'EPERM' }
}

/** 读当前持有者（可能为空 / 刚建目录还没写） */
export function brainStatus(root) {
  const dir = lockDir(root)
  let owner = null
  let ageMs = Infinity
  try {
    owner = JSON.parse(fs.readFileSync(path.join(dir, 'pid'), 'utf8'))
    ageMs = Date.now() - (Date.parse(owner.at) || 0)
  } catch { /* 没有锁或还没写完 */ }
  return {
    owner: owner && owner.pid ? owner : null,
    ageMs,
    live: Boolean(owner?.pid && alive(owner.pid) && ageMs <= STALE_MS),
    dir,
  }
}

/**
 * 占脑子。抢不到返回 {ok:false, owner}，调用方应当**只读**而不是硬上。
 * @param {string} root 生活目录
 * @param {{role?:string, build?:string}} info
 */
export function claimBrain(root, info = {}) {
  const dir = lockDir(root)
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  const release = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'pid'), JSON.stringify({
        pid: process.pid,
        at: new Date().toISOString(),
        role: String(info.role ?? 'brain'),
        build: String(info.build ?? ''),
        host: process.env.COMPUTERNAME || process.env.HOSTNAME || 'this-machine',
      }), 'utf8')
      process.on('exit', release)
      return { ok: true, pid: process.pid, release }
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err
      const st = brainStatus(root)
      const decision = decideClaim({
        owner: st.owner,
        ageMs: st.ageMs,
        selfPid: process.pid,
      })
      // 持有者进程已经没了，也算可以接手（心跳可能还没过期）
      const dead = st.owner && !alive(st.owner.pid)
      if (decision.take || dead) { release(); continue }
      return { ok: false, owner: st.owner, reason: decision.reason }
    }
  }
  return { ok: false, owner: brainStatus(root).owner, reason: 'busy' }
}

/** 心跳：让别的进程知道这个脑子还活着 */
export function heartbeatBrain(root) {
  const file = path.join(lockDir(root), 'pid')
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j?.pid !== process.pid) return false
    j.at = new Date().toISOString()
    fs.writeFileSync(file, JSON.stringify(j), 'utf8')
    return true
  } catch { return false }
}

/** 主动让出（退出时也由 process.on('exit') 兜底） */
export function releaseBrain(root) {
  const dir = lockDir(root)
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'pid'), 'utf8'))
    if (j?.pid && j.pid !== process.pid) return false   // 不是我的，别拆
  } catch { /* 没锁 */ }
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  return true
}
