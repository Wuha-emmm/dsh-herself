// tools/need-restart.mjs —— 她的代码变了没有？变了就重启，别等她开到一半才发现
//
// 起因（2026-10-30 10:41）：她报"空间评论读不到评论人"——其实那只手早修好了，
// 是她进程还在跑 00:09 的旧代码。boot.ps1 是幂等的：只补缺失，**不会因为代码变了而重启**，
// 所以每次改完 lib/ hands/ 都得有人记得敲 -Force。又是"靠记得"。
//
// 这个脚本回答一个问题：现在跑着的那份，是不是最新的？
// 退出码 0 = 不用重启；1 = 该重启了。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG = path.join(HER, 'logs', 'dsh-herself.log')

function newestCodeMtime() {
  let newest = 0
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name)
      if (d.isDirectory()) { if (d.name !== 'node_modules') walk(p); continue }
      if (!/\.(mjs|js)$/.test(d.name)) continue
      const t = fs.statSync(p).mtimeMs
      if (t > newest) newest = t
    }
  }
  for (const d of ['lib', 'hands']) {
    const p = path.join(HER, d)
    if (fs.existsSync(p)) walk(p)
  }
  for (const f of ['cli.mjs', 'wake.mjs', 'brain.mjs']) {
    const p = path.join(HER, f)
    if (fs.existsSync(p)) newest = Math.max(newest, fs.statSync(p).mtimeMs)
  }
  return newest
}

function lastBuild() {
  try {
    const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n')
    const mine = [...lines].reverse().find((l) => l.includes('listener 启动') && l.includes('DSH-herself\\\\life'))
    const m = String(mine ?? '').match(/"build":"([^"]+)"/)
    return m ? Date.parse(m[1]) : 0
  } catch { return 0 }
}

// --worker：值班进程用的是一组代码（hands/inbox-worker.mjs + lib/*），
// 它的 "build" 就是日志里最后一条 start 的时间
if (process.argv.includes('--worker')) {
  const wlog = path.join(HER, 'logs', 'inbox-worker.log')
  let started = 0
  try {
    const lines = fs.readFileSync(wlog, 'utf8').trim().split('\n')
    const last = [...lines].reverse().find((l) => l.includes('"msg":"start"'))
    started = Date.parse(JSON.parse(last).at)
  } catch { /* 没跑过 */ }
  const stale = started > 0 && newestCodeMtime() > started + 1000
  console.log(stale ? 'restart' : 'ok')
  process.exit(stale ? 1 : 0)
}

const code = newestCodeMtime()
const build = lastBuild()
const stale = build > 0 && code > build + 1000
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ code: new Date(code).toISOString(), build: build ? new Date(build).toISOString() : null, stale }))
} else {
  console.log(stale ? 'restart' : 'ok')
}
process.exit(stale ? 1 : 0)