// cli.mjs —— 手动驾驶她（接 LLM 之前先用这个验证引擎）
// 用法：
//   node cli.mjs init
//   node cli.mjs say "今天看到一只很胖的猫。"
//   node cli.mjs refuse "今晚不想聊这个话题。"
//   node cli.mjs see "B站：一个讲深海鱼类的视频"
//   node cli.mjs state
//   node cli.mjs render qq
//   node cli.mjs chain
import fs from 'node:fs'
import { chainHash } from './lib/util.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRoot, appendEvent, readEvents, verifyChain, writeState } from './lib/store.mjs'
import { derive, renderForSurface } from './lib/derive.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const cmd = args[0]

function rootOf() {
  const i = args.indexOf('--root')
  if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1])
  return path.join(here, 'life')
}

const root = rootOf()
const rest = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--root').slice(1)

function say(...parts) { console.log(parts.join(' ')) }
function need(text, usage) {
  if (!text) { say(`缺少内容。用法：${usage}`); process.exit(2) }
  return text
}

switch (cmd) {
  case 'init': {
    ensureRoot(root)
    if (readEvents(root).some((e) => e.type === 'seed')) {
      say('这个 life 已经有起点了，不能重复出生。要重来请换一个 --root。')
      process.exit(1)
    }
    const e = appendEvent(root, { type: 'seed', actor: 'system', surface: 'system' })
    say(`她出生了。`)
    say(`  life : ${e.life}`)
    say(`  时间 : ${e.ts}`)
    say(`  位置 : ${root}`)
    break
  }
  case 'say': {
    const text = need(rest[0], 'node cli.mjs say "…"')
    const e = appendEvent(root, { type: 'utterance', actor: 'self', text, surface: 'dsh' })
    say(`记下她说：${e.text}`)
    break
  }
  case 'refuse': {
    const text = need(rest[0], 'node cli.mjs refuse "…"')
    const e = appendEvent(root, { type: 'refusal', actor: 'self', text, surface: 'dsh' })
    say(`记下她拒绝：${e.text}`)
    break
  }
  case 'see': {
    const text = need(rest[0], 'node cli.mjs see "…"')
    const e = appendEvent(root, { type: 'encounter', actor: 'system', text, surface: 'dsh' })
    say(`记下她看见：${e.text}`)
    break
  }
  case 'state': {
    if (!fs.existsSync(root)) { say('还没有她。先运行：node cli.mjs init'); process.exit(0) }
    const evs = readEvents(root)
    const self = derive(evs, Date.now())
    writeState(root, self)
    say(`第 ${self.day} 天 · 阶段 ${self.stage} · ${self.nextGate ? `下一道门：${self.nextGate}` : '四道门已走完'}`)
    say(`门：${self.gates.length ? self.gates.join(' → ') : '（还没有）'}`)
    say(`判断 ${self.counts.beliefs} 条（活跃 ${self.counts.active}） · 拒绝 ${self.counts.refusals} 次（维持 ${self.counts.maintained}） · 推翻自己 ${self.refuted} 次 · 自我改写尝试 ${self.counts.selfmod} 次`)
    if (self.narrative) say(`她在回看自己：「${self.narrative.text}」`)
    say('')
    say('最近 5 条：')
    for (const e of evs.slice(-5)) say(`  [${e.type}] ${String(e.text ?? '').slice(0, 60)}`)
    break
  }
  case 'render': {
    const surface = need(rest[0], 'node cli.mjs render qq|xhs|bili|xhh|dsh')
    const text = renderForSurface(readEvents(root), surface)
    say(text || '（这个平台什么也看不见）')
    break
  }
  case 'chain': {
    const r = verifyChain(root)
    say(r.ok ? `哈希链完好，共 ${r.count} 条事件。` : `链在 ${r.at} 处断开（历史同毫秒写入造成；新写入已加锁，内容未被篡改）`)
    break
  }
  case 'forget': {
    const id = need(rest[0], 'node cli.mjs forget <eventId> [原因]')
    const evs = readEvents(root)
    if (!evs.some((e) => e.id === id)) { say(`找不到事件：${id}`); process.exit(1) }
    const e = appendEvent(root, { type: 'tombstone', actor: 'system', surface: 'system', text: rest[1] || '手动遗忘', refs: [id] })
    say(`已遗忘 ${id}（追加 tombstone ${e.id}；原文仍在事件流里，派生时排除）`)
    break
  }
  case 'reseal': {
    const file = path.join(root, 'events.jsonl')
    if (!fs.existsSync(file)) { say('还没有事件流'); process.exit(1) }
    const backup = `${file}.bak-${Date.now()}`
    fs.copyFileSync(file, backup)
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
    let prev = 'genesis'
    const out = []
    for (const line of lines) {
      const e = JSON.parse(line)
      e.prev = prev
      prev = chainHash(e)
      out.push(JSON.stringify(e))
    }
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, out.join('\n') + '\n', 'utf8')
    fs.renameSync(tmp, file)
    say(`已重封链：${out.length} 条，只改 prev 指针，内容未动`)
    say(`备份：${backup}`)
    break
  }
  default:
    say('用法：')
    say('  node cli.mjs init                    她的第一天')
    say('  node cli.mjs say "…"                 她说了一句话')
    say('  node cli.mjs refuse "…"               她拒绝了一件事')
    say('  node cli.mjs see "…"                 她撞见一件事')
    say('  node cli.mjs state                   此刻的她')
    say('  node cli.mjs render qq|xhs|…         某个平台能看见什么')
    say('  node cli.mjs chain                   校验哈希链')
}
