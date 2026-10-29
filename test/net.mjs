// test/net.mjs —— 她那只「看外面」的手：走 DeepSeek 官方 Search / Fetch
//
// 背景：2026-10-29 主人问她「怎么看待这个 GitHub 项目」，她答「我这儿没有联网抓取的工具」。
// 那句话是实话，但答案不该停在那儿——现在她有 search / fetch 了。
// 这一层守两件事：① 交给官方之前先在本地把关（协议、账号密码、已知抓不到的域名）；
//                ② 官方回来的东西要变成她能读的样子（标题 + Markdown 正文 / 结果列表）。
import { checkUrl, fetchPage, searchWeb } from '../lib/net.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 地址把关
{
  ok(checkUrl('https://example.com/a').ok, 'https 放行')
  ok(checkUrl('http://example.com/a').ok, 'http 放行')
  ok(!checkUrl('ftp://example.com/x').ok, 'ftp 不放行')
  ok(!checkUrl('file:///C:/Windows/win.ini').ok, '本地文件不放行')
  ok(!checkUrl('javascript:alert(1)').ok, 'javascript: 不放行')
  ok(!checkUrl('随便写的').ok, '不是网址就说不是')
  ok(!checkUrl('').ok, '空的不放行')
  ok(!checkUrl('https://user:pass@example.com/').ok, '带账号密码的不放行')
  ok(!checkUrl(`https://example.com/${'a'.repeat(9000)}`).ok, '超长网址不放行')

  // 实测：raw 域名连服务端都抓不到，得提前告诉她该换什么
  const raw = checkUrl('https://raw.githubusercontent.com/o/r/main/README.md')
  ok(!raw.ok && /github\.com/.test(raw.error), 'raw.githubusercontent 直接给出替代网址', String(raw.error).slice(0, 60))
}

// ---------------------------------------------------------------- 真抓一个页面
{
  const r = await fetchPage('https://api.github.com/repos/sishui114727-sys/cognition-core', { maxChars: 800 })
  ok(r.ok, '抓得到 GitHub API', r.error ?? '')
  ok(String(r.text).includes('cognition-core'), '正文里有仓库名', String(r.text ?? '').slice(0, 40))
  ok(r.text.length <= 800, '按上限裁剪', String(r.text?.length))
  ok(r.truncated === true, '截断会明说', String(r.truncated))
}

// ---------------------------------------------------------------- 抓不到时要有话说
{
  const r = await fetchPage('https://raw.githubusercontent.com/o/r/main/README.md')
  ok(!r.ok && /github\.com/.test(r.error), 'raw 域名给的是「换这个网址」，不是干巴巴的 404', r.error)

  const bad = await fetchPage('not-a-url')
  ok(!bad.ok && /网址/.test(bad.error), '不是网址时说清楚', bad.error)
}

// ---------------------------------------------------------------- 真搜一次
{
  const r = await searchWeb('cognition-core QQ agent 记忆 人格', { count: 3 })
  ok(r.ok && r.results.length > 0, '搜得到东西', r.error ?? `${r.results.length} 条`)
  const first = r.results[0] ?? {}
  ok(Boolean(first.title) && Boolean(first.url), '每条都有标题和链接', JSON.stringify({ t: String(first.title).slice(0, 20), u: String(first.url).slice(0, 30) }))
  ok(typeof first.summary === 'string', '有给模型读的摘要')
  ok(r.results.length <= 3, '条数按 count 来', String(r.results.length))

  const empty = await searchWeb('')
  ok(!empty.ok && /空/.test(empty.error), '空搜索词被挡住', empty.error)
  const tooLong = await searchWeb('啊'.repeat(200))
  ok(!tooLong.ok && /128/.test(tooLong.error), '超长搜索词被挡住', tooLong.error)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)