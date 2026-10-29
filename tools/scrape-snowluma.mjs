// tools/scrape-snowluma.mjs —— 把 SnowLuma 的 API 目录扒下来，放进她的沙盒
//
// 为什么要这个：她会用 OneBot 的动作，但只有我们自己知道有哪些动作；
// 她需要一份能自己翻的目录（"我会什么"的原始依据），而不是等我们喂。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const URL = 'https://snowluma.github.io/zh/docs/api'
const OUT = path.join(HER, 'sandbox/SnowLuma-API速查.md')

const html = await (await fetch(URL, { headers: { 'user-agent': 'herself/1.0' } })).text()

// 文档是静态渲染的：链接 + 描述都在 <a href="/zh/docs/api/...">描述</a> 里，
// 区块标题在 <h2> 里。按出现顺序扫，归到最近的标题下。
const items = []
let section = '其它'
const re = /<h2[^>]*>([\s\S]*?)<\/h2>|<a[^>]+href="(\/zh\/docs\/api\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g
let m
while ((m = re.exec(html))) {
  if (m[1]) {
    const t = m[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').trim()
    if (t && !/^(怎么调用|应答信封|在文档里试调|全部动作)/.test(t)) section = t
  } else if (m[2]) {
    const desc = m[3].replace(/<[^>]+>/g, '').trim()
    const name = m[2].split('/').pop()
    if (desc && !items.some((x) => x.name === name)) items.push({ section, name, desc })
  }
}

const bySection = new Map()
for (const it of items) {
  if (!bySection.has(it.section)) bySection.set(it.section, [])
  bySection.get(it.section).push(it)
}

const lines = [
  '# SnowLuma / OneBot 动作目录（她可以自己翻）',
  '',
  `> 从 ${URL} 扒的，共 ${items.length} 个动作。`,
  '> 怎么调：`POST http://127.0.0.1:3000/<动作名>`，body 是 JSON，',
  '> 鉴权 `Authorization: Bearer <token>`；返回看 `retcode`，0 才是成功。',
  '> 她手上已经接了哪些，见下一节「我已经有的」。',
  '',
  '## 我已经有的（能直接调）',
  '',
  '- `get_cookies` / `get_csrf_token` → 读自己的 QQ 空间',
  '- `get_forward_msg` → 展开合并转发',
  '- `get_stranger_info` → 核验 QQ 号是否真存在',
  '- `send_private_msg` / `send_group_msg` → 发消息（她说话走这条）',
  '',
]

for (const [sec, list] of bySection) {
  if (!list.length) continue
  lines.push(`## ${sec}（${list.length}）`, '')
  for (const it of list) lines.push(`- \`${it.name}\` —— ${it.desc}`)
  lines.push('')
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(`写入 ${OUT}`)
console.log(`动作 ${items.length} 个，区块 ${bySection.size} 个`)
for (const [sec, list] of bySection) console.log(`  ${sec}: ${list.length}`)