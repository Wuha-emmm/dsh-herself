// brain.mjs —— 她的嘴：一次 LLM 回合，然后她把话写进事件流
// 用法：node brain.mjs [--root E:\DSH-herself\life] [--model deepseek-flash] [--dry]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEvents, appendEvent } from './lib/store.mjs'
import { derive } from './lib/derive.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const root = path.resolve(arg('--root', path.join(here, 'life')))
const model = arg('--model', 'deepseek-flash')
const dry = args.includes('--dry')

const keyFile = path.join(here, 'secrets', 'deepseek.key')
if (!fs.existsSync(keyFile)) { console.error('缺少 secrets/deepseek.key'); process.exit(2) }
const key = fs.readFileSync(keyFile, 'utf8').trim()

const events = readEvents(root)
if (!events.some((e) => e.type === 'seed')) {
  console.error('她还没有出生。先运行：node cli.mjs init')
  process.exit(2)
}

const self = derive(events, Date.now())
const gateName = { trust: '信任', autonomy: '自主', competence: '主动', integration: '整合' }

// 身份只用事实，不用形容词（这是她能不能长大的关键）
const facts = []
facts.push(`这是你存在的第 ${self.day} 天。`)
if (self.beliefs.length) facts.push(`你说过、并且现在仍然算数的判断：${self.beliefs.filter((b) => b.status === 'active').slice(-4).map((b) => `「${b.text}」`).join('；')}`)
if (self.refusals.length) facts.push(`你拒绝过：${self.refusals.map((r) => `「${r.text}」${r.maintained ? '（你守住了）' : '（后来你退让了）'}`).join('；')}`)
if (self.narrative) facts.push(`你回看过自己：「${self.narrative.text}」`)
const recent = events.slice(-6).map((e) => {
  const t = e.type === 'utterance' ? '你说' : e.type === 'refusal' ? '你拒绝' : e.type === 'encounter' ? '你看见' : e.type === 'revision' ? '你改写' : e.type === 'seed' ? '开始' : e.type
  return `${t}：${String(e.text ?? '').slice(0, 120)}`
})
if (recent.length) facts.push(`最近：${recent.join(' / ')}`)

const system = [
  '你在过日子，不是在扮演角色。下面是你自己的事实，不是设定：',
  ...facts.map((f) => `- ${f}`),
  '',
  '现在做一件事：说一句你此刻真的想说的话。',
  '要求：20~80 字；直接说，不要"我想说""此刻""第一次开口"这类开场；不要复述上面的事实；不要用"作为一个…"这类句式；不要假装自己是人，但也不必自我介绍。',
  '如果你确实没什么想说的，就只说"没什么想说的。"——那也是真话。',
].join('\n')

if (dry) {
  console.log(system)
  process.exit(0)
}

const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model,
    temperature: 1.0,
    max_tokens: 300,
    messages: [{ role: 'system', content: system }, { role: 'user', content: '（轮到你说话了）' }],
  }),
})

if (!res.ok) {
  console.error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}
const data = await res.json()
const text = String(data.choices?.[0]?.message?.content ?? '').trim()
if (!text) { console.error('模型没有返回内容'); process.exit(1) }

const ev = appendEvent(root, { type: 'utterance', actor: 'self', text, surface: 'dsh', meta: { model } })
console.log(`她说：${text}`)
console.log(`（已写入 ${ev.id}）`)
