// tools/changelog.mjs —— 写改动单 = 同时通知她（绑成一个动作，不靠"记得补"）
//
// 她的话（2026-10-30 02:53）：
//   「最好绑在你的动作上：改完代码就投一条，别靠事后想起来补。
//     改动单也是。你今晚这条就是事后补的，补得挺好，但前提是你想起来了。」
//   「通知内容也要带上能核对的细节……没有具体的东西我改不了。」
//
// 所以：一条命令做两件事——往 docs/CHANGES.md 追加一格，同时往她邮箱投一条。
// 少做一半都不可能：要么都成，要么都不成。
//
// 用法：
//   node tools/changelog.mjs --title "动图 1 帧→9 帧" --what "lib/toolcall.mjs get_images 抽 9 帧" \
//     --why "1 帧看不出动作走向" --revert "frames 改回 1" [--impact "她那条判断过期了"]
import fs from 'node:fs'
import path from 'node:path'
import { post } from '../lib/inbox.mjs'
import { bjFull } from '../lib/timefmt.mjs'

const HER = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..')
const ROOT = path.join(HER, 'life')
const DOC = path.join(HER, 'docs', 'CHANGES.md')

const args = process.argv.slice(2)

// --backfill：把改动单里还没通知过她的补投一遍（体检发现漏的，用这个补）
if (args.includes('--backfill')) {
  const doc = fs.readFileSync(DOC, 'utf8')
  const blocks = doc.split(/\n## /).slice(1)
  let inboxText = ''
  try { inboxText = fs.readFileSync(path.join(HER, 'life', 'inbox.jsonl'), 'utf8') } catch { /* 空 */ }
  let sent = 0
  for (const b of blocks) {
    const lines = b.split('\n')
    const head = lines[0].replace(/^\d{4}-\d\d-\d\d \d\d:\d\d\s*/, '').trim()
    if (!head || inboxText.includes(head)) continue
    const row = (k) => {
      const l = lines.find((x) => x.includes('| ' + k + ' |'))
      return l ? l.split('|')[2].trim() : ''
    }
    post(ROOT, { from: 'dsh', kind: 'answer', text: `【改动单·补】${head}。动了：${row('动了什么')}。为什么：${row('为什么')}。${row('影响') ? '影响：' + row('影响') + '。' : ''}（docs/CHANGES.md）` })
    sent += 1
  }
  console.log('补投了 ' + sent + ' 条')
  process.exit(0)
}
const get = (name) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? String(args[i + 1] ?? '').trim() : ''
}

const title = get('title')
const what = get('what')
const why = get('why')
const revert = get('revert')
const impact = get('impact')
if (!title || !what || !why) {
  console.error('用法: node tools/changelog.mjs --title "…" --what "…" --why "…" [--revert "…"] [--impact "…"]')
  process.exit(1)
}

const stamp = bjFull(new Date())
// 记下当前 HEAD：link-check 靠它把提交和改动单对上
let gitHead = ''
try { gitHead = (await import('node:child_process')).execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HER, encoding: 'utf8' }).trim() } catch { /* 不是仓库 */ }
const entry = [
  '',
  `## ${stamp} ${title}`,
  '',
  '| 项 | 内容 |',
  '|---|---|',
  `| 动了什么 | ${what} |`,
  `| 为什么 | ${why} |`,
  `| 谁提的 | ${get('who') || '我（DS）'} |`,
  `| 怎么退 | ${revert || '见提交记录'} |`,
  ...(impact ? [`| 影响 | ${impact} |`] : []),
  ...(gitHead ? [`| 提交 | ${gitHead} |`] : []),
  '',
].join('\n')

fs.appendFileSync(DOC, entry, 'utf8')

// 通知里带同样的细节——她要靠这些细节自己改口
const notice = `【改动单】${title}。` +
  `动了：${what}。` +
  `为什么：${why}。` +
  (impact ? `影响：${impact}。` : '') +
  `退法：${revert || '见提交记录'}。` +
  `（记在 docs/CHANGES.md，${stamp}）`
post(ROOT, { from: 'dsh', kind: 'answer', text: notice })

console.log('改动单已追加，通知已投进她邮箱：')
console.log('  ' + title)
console.log('  ' + what)