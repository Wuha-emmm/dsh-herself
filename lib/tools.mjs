// lib/tools.mjs —— 她「伸手」的地方：工具定义与执行
//
// 对照 surfcore 原始定义的边界：一次最多 5 张图、单张 8MB、转发最多 30 条。
// SnowLuma 实测（2026-10-29）：
//   · fetch_custom_face 直接返回 URL 数组（不是 packs[].emojiInfo[]）
//   · emojiId 藏在 URL 里（32 位 hex 那一段），正好是 mface 段要的格式
//   · 备注标签 API 不返回 —— 由她自己起名，存 sandbox/stickers.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { onebot } from '../hands/qzone.mjs'
import { renderForwardNodes } from './forward.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const STICKER_FILE = path.join(HER, 'sandbox', 'stickers.json')

export const TOOLS = [
  { name: 'get_images', desc: '取当前消息里的图片（她要看图时调用）', args: { count: '1-5，默认 1' } },
  { name: 'get_forward', desc: '展开当前消息里的合并转发', args: {} },
  { name: 'list_stickers', desc: '列出收藏表情（她自己起的名字）', args: {} },
  { name: 'send_sticker', desc: '发一个收藏表情（mface 段，不是图片）', args: { keyword: '她自己起的名或序号' } },
]

const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_FORWARD = 30

export function imagesOf(message) {
  const segs = Array.isArray(message) ? message : []
  return segs
    .filter((s) => s.type === 'image')
    .map((s) => String(s.data?.url ?? s.data?.file ?? ''))
    .filter((u) => u.startsWith('http') || u.startsWith('base64://'))
    .slice(0, MAX_IMAGES)
}

/** 从字节猜 MIME：QQ 的 base64:// 段没有类型，猜错了动图就抽不了帧 */
export function sniffMime(buf) {
  if (!buf || buf.length < 12) return ''
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return ''
}

export async function toDataUrl(src, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  if (src.startsWith('base64://')) {
    const buf = Buffer.from(src.slice(9), 'base64')
    return `data:${sniffMime(buf) || 'image/png'};base64,${buf.toString('base64')}`
  }
  const r = await fetch(src, { signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > maxBytes) throw new Error(`图片超过 ${Math.round(maxBytes / 1024 / 1024)}MB`)
  const mime = r.headers.get('content-type')?.split(';')[0] || sniffMime(buf) || 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

/**
 * 展开一段合并转发。
 * 以前只拼 text 段（图片/视频/嵌套全丢），空 id 还会直接回「空的」——
 * 现在交给 lib/forward.mjs 纯渲染，并且把图片 URL 带回来（要不要看由上层决定）。
 * @returns {Promise<{ok:boolean, lines:string[], images:Array, error?:string}>}
 */
export async function expandForward(id) {
  const fid = String(id ?? '').trim()
  if (!fid) return { ok: false, lines: [], images: [], error: '这条消息里没有转发（或者那段的 id 没拿到）' }
  const f = await onebot('get_forward_msg', { id: fid })
  const list = f?.messages ?? f?.data?.messages ?? []
  if (!Array.isArray(list) || !list.length) {
    return { ok: false, lines: [], images: [], error: '接口没返回内容（可能是权限，或者这段记录被撤了）' }
  }
  const r = renderForwardNodes(list, { maxNodes: MAX_FORWARD })
  return { ok: true, lines: r.lines, images: r.images, total: r.total, truncated: r.truncated }
}

/** 从 URL 里抠 32 位 hex 当 emojiId */
function emojiIdOf(url) {
  const m = String(url).match(/([0-9a-fA-F]{32})/)
  return m ? m[1] : ''
}

/** 收藏表情原始列表：{url, emojiId} */
export async function rawStickers() {
  const r = await onebot('fetch_custom_face', { count: 200 })
  const arr = Array.isArray(r) ? r : (r?.data ?? [])
  return arr
    .map((u) => ({ url: String(u), emojiId: emojiIdOf(u) }))
    .filter((s) => s.emojiId)
}

/** 她自己起的名字：{name: emojiId} */
export function readNames() {
  try { return JSON.parse(fs.readFileSync(STICKER_FILE, 'utf8')) } catch { return {} }
}
export function writeName(name, emojiId) {
  const all = readNames()
  all[name] = emojiId
  fs.mkdirSync(path.dirname(STICKER_FILE), { recursive: true })
  fs.writeFileSync(STICKER_FILE, JSON.stringify(all, null, 2), 'utf8')
  return all
}

/** 带名字的目录；没名字的用序号 */
export async function listStickers() {
  const raw = await rawStickers()
  const meta = readNames()
  return raw.map((s, i) => {
    const m = meta[s.emojiId]
    const named = m && typeof m === 'object'
    return {
      ...s,
      tag: named ? (m.name || `表情${i + 1}`) : `表情${i + 1}`,
      emotion: named ? String(m.emotion ?? '') : '',
      keywords: named && Array.isArray(m.keywords) ? m.keywords : [],
      packageId: m?.packageId ?? '',
      key: m?.key ?? '',
    }
  })
}

export async function pickSticker(keyword) {
  const all = await listStickers()
  const k = String(keyword ?? '').trim()
  if (!k) return null
  return all.find((s) => s.tag.includes(k))
    ?? all.find((s) => s.emotion.includes(k))
    ?? all.find((s) => s.keywords.some((w) => String(w).includes(k)))
    ?? all.find((s) => s.emojiId === k)
    ?? null
}

/** 执行一个工具调用 */
export async function runTool(name, args = {}, ctx = {}) {
  try {
    if (name === 'get_images') {
      const srcs = imagesOf(ctx.message).slice(0, Math.max(1, Math.min(MAX_IMAGES, Number(args.count) || 1)))
      if (!srcs.length) return { ok: false, kind: 'text', payload: '这条消息里没有图片' }
      const urls = []
      for (const s of srcs) urls.push(await toDataUrl(s))
      return { ok: true, kind: 'image', payload: urls }
    }
    if (name === 'get_forward') {
      const r = await expandForward(ctx.forwardId)
      if (!r.ok) return { ok: false, kind: 'text', payload: `展开不了：${r.error}` }
      const lines = [...r.lines]
      if (r.truncated) lines.push(`（后面还有，只读了前 ${r.total} 条）`)
      if (r.images.length) lines.push(`（里面一共 ${r.images.length} 张图。想让我看就说一声，我挑前两张看。）`)
      return { ok: true, kind: 'text', payload: lines.join('\n') || '这段转发是空的', images: r.images }
    }
    if (name === 'list_stickers') {
      const all = await listStickers()
      return { ok: true, kind: 'text', payload: all.map((s) => s.tag).join('、') || '收藏里没有表情' }
    }
    if (name === 'send_sticker') {
      const s = await pickSticker(args.keyword)
      if (!s) return { ok: false, kind: 'text', payload: '没找到匹配的表情' }
      return { ok: true, kind: 'sticker', payload: s }
    }
    return { ok: false, kind: 'text', payload: `没有这个工具：${name}` }
  } catch (err) {
    return { ok: false, kind: 'text', payload: String(err?.message ?? err) }
  }
}
