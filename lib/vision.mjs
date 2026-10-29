// lib/vision.mjs —— 她「看」的地方：直连 DeepSeek 的 OpenAI 兼容端点
//
// 为什么不走 DSH 的 llm.stream：实测三种图片形状都被 transport 层丢掉。
// 这里只做一件事：把图交给模型看，返回一段描述。文字对话仍走 DSH，互不干扰。
//
// 2026-10-29：动图只能看到第一帧（视觉端点不解码 GIF）。改成自己抽帧——
// 最多 9 帧按时间顺序塞进同一次调用，让模型串着讲它在动什么。解码器在 lib/gif.mjs。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isGif, extractFrames } from './gif.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const KEY_FILE = path.join(here, '..', 'secrets', 'deepseek.key')
const API = 'https://api.deepseek.com/chat/completions'

const DEFAULT_PROMPT = [
  '这张图里是什么？',
  '如果是表情包/梗图：说清它的情绪和梗，一两句就够。',
  '如果是截图：读出关键文字和信息。',
  '如果是照片：描述画面里的人和事。',
  '如果是动图：描述它在动什么。',
  '不要客套，不要解释你在做什么。',
].join('\n')

const FRAME_PROMPT = [
  '这是一段动图按时间顺序抽出来的 {n} 帧（第 1 帧是开始，第 {n} 帧是结束）。',
  '请按顺序说清它在动什么：主体在这几帧里怎么变（位置、动作、表情、画面元素出现或消失）。',
  '最后一句说明：这段动图整体是什么、想表达什么情绪或梗。',
  '如果是表情包，说清它适合在什么语境下发。',
  '不要逐帧报流水账，不要客套，不要解释你在做什么。',
].join('\n')

function key() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim() } catch { return '' }
}

/** data URL → 原始字节；不是 data URL 就返回 null */
function bytesOf(image) {
  const m = /^data:[^;,]+;base64,([\s\S]+)$/.exec(String(image ?? ''))
  if (!m) return null
  try { return Buffer.from(m[1], 'base64') } catch { return null }
}

/**
 * 看图，返回描述。
 * @param {string} image data URL 或 http(s) URL
 * @param {{prompt?:string, maxTokens?:number, frames?:number}} opts
 *   frames: 动图最多抽几帧（0 = 不抽，只看第一帧）
 */
export async function describe(image, { prompt = '', maxTokens = 500, frames = 9 } = {}) {
  const k = key()
  if (!k) throw new Error('没有 secrets/deepseek.key')

  const content = []
  let used = 0

  if (frames > 0) {
    const buf = bytesOf(image)
    if (buf && isGif(buf)) {
      // 768 不是拍的：实测（2026-10-29）一张图固定 184 token，384/544/768 三种尺寸一模一样，
      // detail low/high 也一样；但 768 的描述明显更细（会说出「白色褶皱女仆发带」这种细节）。
      // 也就是说：小尺寸不是省钱，是白丢信息。
      const got = extractFrames(buf, { count: frames, maxSide: 768 })
      if (got.ok && got.frames.length > 1) {
        used = got.frames.length
        content.push({ type: 'text', text: (prompt || FRAME_PROMPT).replace(/\{n\}/g, String(used)) })
        got.frames.forEach((src, i) => {
          content.push({ type: 'text', text: `第 ${i + 1} 帧` })
          content.push({ type: 'image_url', image_url: { url: src, detail: 'high' } })
        })
      }
    }
  }

  if (!used) {
    content.push({ type: 'text', text: prompt || DEFAULT_PROMPT })
    content.push({ type: 'image_url', image_url: { url: String(image), detail: 'high' } })
  }

  const r = await fetch(API, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + k, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-flash',
      messages: [{ role: 'user', content }],
      thinking: { type: 'disabled' },
      // 9 帧要说得更多，给它点空间；单图仍旧 500
      max_tokens: used ? Math.max(maxTokens, 700) : maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(used ? 90000 : 60000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message ?? `vision HTTP ${r.status}`)
  const text = String(j?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('模型没有返回描述')
  // 让她知道这是「动图看了好几帧」，而不是一张静止的图
  return used ? `（这是一段动图，抽了 ${used} 帧看的）${text}` : text
}

/** 本地文件 → data URL */
export function fileToDataUrl(file) {
  const buf = fs.readFileSync(file)
  const ext = path.extname(file).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}
