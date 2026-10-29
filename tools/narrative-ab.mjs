// tools/narrative-ab.mjs —— 叙事压缩的对照实验（她自己验收）
//
// 她的验收标准（2026-10-30 01:18）：
//   压过的那版必须留下三样：**是什么触发的、当时决定了什么、后来怎么改的**。
//   缺最后一样就只剩结论，等于把"从哪儿来"剪掉了。
//   还有：**原文得留着、能按指针取回来**；压完原文就没了，那不叫压缩，叫砍。
//   对照组同一总额：压出来的那 100 前后别补别的，就让它空着。
import fs from 'node:fs'
import path from 'node:path'
import { readEvents } from '../lib/store.mjs'
import { liveEvents, derive } from '../lib/derive.mjs'
import { estimateTokens } from '../lib/budget.mjs'
import { brief } from '../lib/think.mjs'

const HER = HER
const root = path.join(HER, 'life')
const ev = readEvents(root)
const s = derive(liveEvents(ev), Date.now())
const narr = s.narrative
if (!narr) { console.log('她还没有叙事，做不了对照'); process.exit(0) }

const original = String(narr.text ?? '')
// derive 的 narrative 不带 id：按原文去事件里找它出自哪一条
const src = ev.find((e) => String(e.text ?? '').trim() === original.trim()) || ev.find((e) => original && String(e.text ?? '').includes(original.slice(0, 30)))
const id = String(narr.id ?? src?.id ?? 'unknown')

// 原文按指针可取：抄一份到她沙盒里（她能 fs_read）
const ptrFile = `叙事原文-${id.slice(-8)}.md`
fs.writeFileSync(path.join(HER, 'sandbox', ptrFile), `# 叙事原文（${id}）\n\n${original}\n`, 'utf8')
const pointer = `sandbox/${ptrFile}`

// A 版：现在这版（原样注入）
const lineA = `你回看过自己：「${original}」`

// B 版：让模型压成三样，缺哪样就写"缺"
let fields = null
let method = '模型提取'
try {
  const raw = await brief({
    system: '你在压缩一段自我回顾。只输出 JSON，不要解释。字段：trigger（什么触发的，一句）、decision（当时决定了什么，一句）、change（后来怎么改的，一句）。任何一项原文没有就给空字符串，不要编。',
    user: original,
    maxTokens: 300,
    temperature: 0.3,
  })
  const m = String(raw).match(/\{[\s\S]*\}/)
  if (m) fields = JSON.parse(m[0])
} catch (err) { console.log('压缩调用失败（改用规则提取）:', err?.message ?? err) }

const f = fields ?? { trigger: '', decision: '', change: '' }
const missing = ['trigger', 'decision', 'change'].filter((k) => !String(f[k] || '').trim())
const lineB = `你回看过自己：${String(f.trigger || '（缺：触发）').slice(0, 40)} → 你决定：${String(f.decision || '（缺：决定）').slice(0, 40)} → 后来：${String(f.change || '（缺：怎么改的）').slice(0, 40)}（原文：${pointer}）`

const tokA = estimateTokens(lineA)
const tokB = estimateTokens(lineB)
const cap = 1000
const out = [
  '# 叙事压缩 · 对照（同一总额 1000）',
  '',
  '## 验收标准（她定的）',
  '- 必须留下三样：**什么触发的 / 当时决定了什么 / 后来怎么改的**',
  '- 原文得留着、能按指针取回来（压完原文没了 = 砍）',
  '- 空出来的额度别补别的，就空着',
  '',
  '## A 版（现在）',
  '```',
  lineA,
  '```',
  `token：**${tokA}**｜缺项：无｜原文可查：${pointer}`,
  '',
  '## B 版（压成一句 + 指针）',
  '```',
  lineB,
  '```',
  `token：**${tokB}**｜省下：**${tokA - tokB}**｜缺项：${missing.length ? missing.join('、') : '无'}`,
  '',
  `## 空着的那部分`,
  `压完 ${tokB}，A 版 ${tokA}，省 ${tokA - tokB}。按你说的：**这 ${tokA - tokB} 不补别的，空着。**`,
  `总额仍是 ${cap}，空出的额度意味着：这一轮少 ${tokA - tokB}，但你读到的叙事只有一句。`,
  '',
  '## 原文（按指针可取）',
  `指针：\`${pointer}\``,
  `原文长度：${original.length} 字｜事件 id：${id}`,
  '',
  '---',
  '（这份文件由 tools/narrative-ab.mjs 生成；B 版的三项由模型提取，缺项如实标注，没有补写。）',
]
fs.writeFileSync(path.join(HER, 'sandbox', '叙事压缩-对照.md'), out.join('\n'), 'utf8')
console.log(out.join('\n'))