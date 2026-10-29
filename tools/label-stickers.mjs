// tools/label-stickers.mjs —— 让她「认识」自己收藏的每一张表情
//
// 做法：逐张丢给视觉模型，让它给一句话：名字 / 情绪 / 关键词。
// 结果存 sandbox/stickers.json（她自己的记忆，不是 QQ 备注）。
// 用错了在聊天里改就行——names 是可以被覆盖的。
//
// 用法：
//   node tools/label-stickers.mjs                 # 只补还没命名的
//   node tools/label-stickers.mjs --force         # 全部重认（动图会抽帧，名字能带上动作）
//   node tools/label-stickers.mjs --force --frames 4 --limit 20
//
// 2026-10-29：以前传的是 http URL，动图只能看第一帧；现在先落成 data URL，
// 动图走 lib/gif.mjs 抽帧（默认 4 帧——够看清动作，比 9 帧省一半多）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe } from '../lib/vision.mjs'
import { rawStickers, toDataUrl } from '../lib/tools.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const FILE = path.join(HER, 'sandbox', 'stickers.json')

const PROMPT = [
  '这是一个 QQ 收藏表情（可能很糊）。',
  '如果给的是几帧，说明它是动图：注意它在动什么——**动作本身就是这个表情的意思**。',
  '只输出一行 JSON，不要代码块：',
  '{"name":"两个到六个字的短名，尽量写动作或状态","emotion":"它表达的情绪","keywords":["两个搜索词"]}',
  '不要解释，不要多余的话。',
].join('\n')

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const frames = Number((argv[argv.indexOf('--frames') + 1] || '').trim()) || 4
const limit = Number((argv[argv.indexOf('--limit') + 1] || '').trim()) || 0
/** --id A,B,C：只重认这几张（大图失败后补跑用） */
const onlyIds = (() => {
  const i = argv.indexOf('--id')
  if (i < 0) return null
  const raw = (argv[i + 1] || '').trim()
  return raw ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)) : null
})()

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} }
}

/** 改之前先留一份：这是她自己的记忆文件，覆盖错了没处找 */
function backup() {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(FILE, `${FILE}.bak-${stamp}`)
  } catch { /* 第一次跑还没有文件 */ }
}

/**
 * 合并写回：她那边（qq.mjs）也会往这个文件里补新人抓到的表情三元组，
 * 整份覆盖会把人家刚写进去的吃掉。
 */
function saveMerged(store) {
  const cur = load()
  const merged = { ...cur, ...store }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

/** 从模型输出里抠 JSON（它有时会包 ```） */
function parseJson(text) {
  const s = String(text).replace(/```json|```/g, '').trim()
  const i = s.indexOf('{')
  const j = s.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try { return JSON.parse(s.slice(i, j + 1)) } catch { return null }
}

const stickers = await rawStickers()
const store = load()
if (force) backup()
const todo = onlyIds ? stickers.filter((s) => onlyIds.has(s.emojiId)) : stickers
console.log(`库存 ${stickers.length} 张 · 已命名 ${Object.values(store).filter((v) => v?.name).length} 张 · `
  + `${onlyIds ? `只认 ${todo.length} 张` : force ? '全部重认' : '只补缺'} · 动图抽 ${frames} 帧${limit ? ` · 最多 ${limit} 张` : ''}`)

let done = 0
let tried = 0
let failed = 0
const t0 = Date.now()

for (const s of todo) {
  if (limit && tried >= limit) break
  if (!onlyIds && !force && store[s.emojiId]?.name) continue
  tried += 1
  try {
    // 表情原图可能十几 MB（动图尤其），这个上限是给「发给模型」设的，
    // 抽帧只用得着解码，放宽一点。
    const dataUrl = await toDataUrl(s.url, { maxBytes: 24 * 1024 * 1024 })
    const out = await describe(dataUrl, { prompt: PROMPT, maxTokens: 200, frames })
    const j = parseJson(out)
    if (!j?.name) { failed += 1; console.log(`跳过（解析失败） ${s.emojiId} :: ${out.slice(0, 60)}`); continue }
    store[s.emojiId] = {
      ...(store[s.emojiId] || {}),
      name: String(j.name).slice(0, 12),
      emotion: String(j.emotion ?? '').slice(0, 12),
      keywords: Array.isArray(j.keywords) ? j.keywords.slice(0, 4).map((k) => String(k).slice(0, 8)) : [],
      url: s.url,
      at: new Date().toISOString(),
    }
    saveMerged(store)
    done += 1
    const tag = /抽了 \d+ 帧/.test(out) ? '〔动图〕' : ''
    console.log(`[${done}/${tried}] ${tag}${store[s.emojiId].name} · ${store[s.emojiId].emotion} · ${store[s.emojiId].keywords.join('/')}`)
  } catch (e) {
    failed += 1
    console.log(`失败 ${s.emojiId} :: ${e?.message ?? e}`)
  }
}

saveMerged(store)
const sec = Math.round((Date.now() - t0) / 1000)
console.log(`完成：重认 ${done} 张 · 失败 ${failed} · 用时 ${sec}s · 库存 ${Object.keys(load()).length}`)
