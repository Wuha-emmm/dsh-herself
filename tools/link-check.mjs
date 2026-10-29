// tools/link-check.mjs —— 把"改了代码但改动单里挂不上 hash"的提交，原样摆给她看
//
// 她的要求（2026-10-30 03:00）：
//   「反向检查那边，把碰到 lib/ hands/ plugin/ tools/ 的提交逐条列出来，
//     凡是在 CHANGES.md 里挂不上 hash 的，整张清单原样投进邮箱。
//     不筛、不判断该不该写，只把没挂上的摆出来。」「设成只报不拦。」
//
// 所以这里不判断"该不该写改动单"，只做一件事：找 hash、对不上就列出来。
// 用法：node tools/link-check.mjs [--days 7] [--post]   （--post 才投邮箱）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const HER = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..')
const DIRS = ['lib/', 'hands/', 'plugin/', 'tools/']

export function unlinkedCommits(days = 7) {
  let out = ''
  try {
    out = execFileSync('git', ['log', `--since=${days}.days`, '--pretty=format:%h%x09%ad%x09%s', '--date=short', '--name-only'], { cwd: HER, encoding: 'utf8' })
  } catch { return { ok: false, commits: [], touched: 0, linked: 0 } }
  const blocks = out.split('\n\n').map((b) => b.trim()).filter(Boolean)
  let entries = ''
  try { entries = fs.readFileSync(path.join(HER, 'docs', 'CHANGES.md'), 'utf8') } catch { /* 没有 */ }

  const commits = []
  for (const b of blocks) {
    const lines = b.split('\n')
    const [hash, date, subject] = lines[0].split('\t')
    const files = lines.slice(1).filter(Boolean)
    if (!files.some((f) => DIRS.some((d) => f.startsWith(d)))) continue
    commits.push({ hash, date, subject: String(subject ?? '').slice(0, 40), files: files.length, linked: entries.includes(hash) })
  }
  return { ok: true, commits, linked: commits.filter((c) => c.linked).length }
}

if (process.argv[1]?.endsWith('link-check.mjs')) {
  const args = process.argv.slice(2)
  const days = Number((args[args.indexOf('--days') + 1] ?? '7')) || 7
  const r = unlinkedCommits(days)
  if (!r.ok) { console.log('不是 git 仓库，跳过'); process.exit(0) }
  const missing = r.commits.filter((c) => !c.linked)
  console.log(`七天内碰过代码的提交 ${r.commits.length} 个｜挂上改动单 ${r.linked} 个｜没挂上 ${missing.length} 个`)
  for (const c of missing) console.log(`  ${c.hash} ${c.date} ${c.subject}（${c.files} 个文件）`)

  if (args.includes('--post')) {
    const { post } = await import('../lib/inbox.mjs')
    const body = missing.length
      ? `【没挂上改动单的提交】${missing.length} 个（七天内）：\n` + missing.map((c) => `${c.hash} ${c.date} ${c.subject}`).join('\n')
      : '【没挂上改动单的提交】没有。七天内碰过代码的提交都能在改动单里找到。'
    post(path.join(HER, 'life'), { from: 'dsh', kind: 'answer', text: body })
    console.log('已投进她邮箱')
  }
}