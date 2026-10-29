// lib/gif.mjs —— 纯 JS 的 GIF 解码：把动图抽成几帧
//
// 为什么自己写：视觉端点拿到 GIF 只解码第一帧（实测），而这台机器上没有 ffmpeg、
// 没有 ImageMagick，项目又是零依赖。所以 GIF 的 LZW 和帧合成得自己做。
//
// 只做「看懂了动什么」需要的事：解码索引 → 合成到画布（含 disposal）→ 抽 n 帧 → 编成 PNG。
// 不做动画、不做优化、不处理少见扩展（遇到就跳过）。

/* ------------------------------------------------------------------ 小工具 */

import zlib from 'node:zlib'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** RGBA → PNG（8bit / RGBA / 无滤波） */
export function encodePng(rgba, w, h) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0            // filter: none
    src.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibDeflate(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function zlibDeflate(buf) {
  return zlib.deflateSync(buf, { level: 6 })
}
/** 最近的整数倍缩放（够看，不追求画质） */
export function downscale(rgba, w, h, maxSide) {
  const long = Math.max(w, h)
  if (long <= maxSide) return { rgba, w, h }
  const f = Math.ceil(long / maxSide)
  const nw = Math.max(1, Math.floor(w / f))
  const nh = Math.max(1, Math.floor(h / f))
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y += 1) {
    const sy = Math.min(h - 1, y * f)
    for (let x = 0; x < nw; x += 1) {
      const sx = Math.min(w - 1, x * f)
      const s = (sy * w + sx) * 4
      const d = (y * nw + x) * 4
      out[d] = rgba[s]
      out[d + 1] = rgba[s + 1]
      out[d + 2] = rgba[s + 2]
      out[d + 3] = rgba[s + 3]
    }
  }
  return { rgba: out, w: nw, h: nh }
}

/* ------------------------------------------------------------------ GIF 解析 */

export function isGif(buf) {
  if (!buf || buf.length < 6) return false
  const m = Buffer.from(buf.buffer ?? buf, buf.byteOffset ?? 0, 6).toString('latin1')
  return m === 'GIF87a' || m === 'GIF89a'
}

/** GIF 的 LZW 解压：返回颜色索引数组 */
function lzwDecode(minCodeSize, data, expected) {
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1
  let codeSize
  let dict
  const reset = () => {
    dict = new Array(clearCode + 2)
    for (let i = 0; i < clearCode; i += 1) dict[i] = [i]
    dict[clearCode] = null
    dict[eoiCode] = null
    codeSize = minCodeSize + 1
  }
  reset()

  const out = new Uint8Array(expected)
  let outLen = 0
  let bitBuf = 0
  let bitCount = 0
  let pos = 0
  let prev = null

  while (outLen < expected) {
    while (bitCount < codeSize) {
      if (pos >= data.length) return out.subarray(0, outLen)
      bitBuf |= data[pos] << bitCount
      pos += 1
      bitCount += 8
    }
    const code = bitBuf & ((1 << codeSize) - 1)
    bitBuf >>>= codeSize
    bitCount -= codeSize

    if (code === clearCode) { reset(); prev = null; continue }
    if (code === eoiCode) break

    let entry
    if (code < dict.length && dict[code]) entry = dict[code]
    else if (code === dict.length && prev) entry = [...prev, prev[0]]
    else break

    for (let i = 0; i < entry.length && outLen < expected; i += 1) out[outLen++] = entry[i]
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]])
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize += 1
    }
    prev = entry
  }
  return out.subarray(0, outLen)
}

/** 扫一遍块结构，数出帧数和每帧延时（不解压像素） */
function headOf(buf) {
  // 6 字节签名 + 7 字节逻辑屏描述符，之后是可有可无的全局色表
  const w = buf.readUInt16LE(6)
  const h = buf.readUInt16LE(8)
  const packed = buf[10]
  const gctSize = packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0
  return { width: w, height: h, packed, gctSize, start: 13 + gctSize }
}

function scanFrames(buf) {
  const head = headOf(buf)
  let p = head.start

  const frames = []
  let delay = 0
  while (p < buf.length) {
    const b = buf[p]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = buf[p + 1]
      p += 2
      if (label === 0xf9 && buf[p] === 4) {
        delay = buf.readUInt16LE(p + 2)
      }
      // 跳过子块（GCE 是 size=4 + 4 字节 + 终止 0）
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1
      p += 1
      continue
    }
    if (b === 0x2c) {
      frames.push({ delay })
      const pk = buf[p + 9]
      p += 10
      if (pk & 0x80) p += 3 * (1 << ((pk & 7) + 1))
      p += 1                      // LZW min code size
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1
      p += 1
      delay = 0
      continue
    }
    break
  }
  return { width: head.width, height: head.height, frameCount: frames.length, delays: frames.map((f) => f.delay) }
}

/**
 * 解码。只保留 want 里指定的帧（其余解出来就丢），避免大动图吃内存。
 * @returns {{width:number,height:number,total:number,frames:Array<{rgba:Uint8Array,w:number,h:number,index:number}>}|null}
 */
export function decodeGif(buf, { want = null } = {}) {
  if (!isGif(buf)) return null
  const meta = scanFrames(buf)
  if (!meta.frameCount) return null

  const canvasW = meta.width
  const canvasH = meta.height
  const canvas = new Uint8Array(canvasW * canvasH * 4)   // 全透明
  let kept = []

  let p = 6
  const packed = buf[p + 4]
  let gct = null
  if (packed & 0x80) {
    const n = 1 << ((packed & 7) + 1)
    gct = buf.subarray(13, 13 + n * 3)
  }
  p = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0)

  let gce = { disposal: 0, transparent: -1, delay: 0 }
  let index = 0
  while (p < buf.length) {
    const b = buf[p]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = buf[p + 1]
      p += 2
      if (label === 0xf9) {
        const size = buf[p]
        const flags = buf[p + 1]
        gce = {
          disposal: (flags >> 2) & 7,
          transparent: flags & 1 ? buf[p + 4] : -1,
          delay: buf.readUInt16LE(p + 2),
        }
        p += size + 1
      }
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1
      p += 1
      continue
    }
    if (b !== 0x2c) break

    const fLeft = buf.readUInt16LE(p + 1)
    const fTop = buf.readUInt16LE(p + 3)
    const fw = buf.readUInt16LE(p + 5)
    const fh = buf.readUInt16LE(p + 7)
    const fpacked = buf[p + 9]
    const interlaced = Boolean(fpacked & 0x40)
    p += 10

    let lct = null
    if (fpacked & 0x80) {
      const n = 1 << ((fpacked & 7) + 1)
      lct = buf.subarray(p, p + n * 3)
      p += 3 * n
    }
    const palette = lct || gct || Buffer.alloc(768)

    const minCode = buf[p]
    p += 1
    const parts = []
    while (p < buf.length && buf[p] !== 0) {
      const len = buf[p]
      parts.push(buf.subarray(p + 1, p + 1 + len))
      p += 1 + len
    }
    p += 1

    // 需要才解压
    const keep = !want || want.includes(index)
    let saved = null
    if (gce.disposal === 3) saved = canvas.slice()

    if (keep) {
      const indices = lzwDecode(minCode, Buffer.concat(parts), fw * fh)
      for (let y = 0; y < fh; y += 1) {
        const srcY = interlaced ? interlaceRow(y, fh) : y
        const cy = fTop + srcY
        if (cy < 0 || cy >= canvasH) continue
        for (let x = 0; x < fw; x += 1) {
          const ci = indices[y * fw + x]
          if (ci === undefined) continue
          if (ci === gce.transparent) continue
          const cx = fLeft + x
          if (cx < 0 || cx >= canvasW) continue
          const d = (cy * canvasW + cx) * 4
          canvas[d] = palette[ci * 3]
          canvas[d + 1] = palette[ci * 3 + 1]
          canvas[d + 2] = palette[ci * 3 + 2]
          canvas[d + 3] = 255
        }
      }
      kept.push({ rgba: canvas.slice(), w: canvasW, h: canvasH, index })
    }

    // disposal：2 = 还原成背景（这里按全透明处理），3 = 还原上一帧
    if (gce.disposal === 2) {
      for (let y = 0; y < fh; y += 1) {
        const cy = fTop + y
        if (cy < 0 || cy >= canvasH) continue
        for (let x = 0; x < fw; x += 1) {
          const cx = fLeft + x
          if (cx < 0 || cx >= canvasW) continue
          const d = (cy * canvasW + cx) * 4
          canvas[d] = 0; canvas[d + 1] = 0; canvas[d + 2] = 0; canvas[d + 3] = 0
        }
      }
    } else if (gce.disposal === 3 && saved) {
      canvas.set(saved)
    }
    index += 1
  }

  return { width: canvasW, height: canvasH, total: meta.frameCount, delays: meta.delays, frames: kept }
}

/** 隔行 GIF 的行序 */
function interlaceRow(y, h) {
  const p1 = Math.ceil(h / 8)
  const p2 = Math.ceil((h - 4) / 8)
  const p3 = Math.ceil((h - 2) / 4)
  if (y < p1) return y * 8
  if (y < p1 + p2) return (y - p1) * 8 + 4
  if (y < p1 + p2 + p3) return (y - p1 - p2) * 4 + 2
  return (y - p1 - p2 - p3) * 2 + 1
}

/**
 * 抽 n 帧，均匀分布（含首帧，尽量含尾帧），输出 PNG data URL。
 * @param {Buffer} buf
 * @param {{count?:number,maxSide?:number}} opts
 * @returns {{ok:boolean, total:number, frames:string[], reason?:string}}
 */
export function extractFrames(buf, { count = 9, maxSide = 512 } = {}) {
  const meta = scanFrames(buf)
  if (!meta.frameCount) return { ok: false, total: 0, frames: [], reason: '不是有效的 GIF' }
  if (meta.frameCount < 2) return { ok: false, total: 1, frames: [], reason: '只有一帧' }

  const n = Math.min(count, meta.frameCount)
  const idx = []
  for (let i = 0; i < n; i += 1) {
    idx.push(Math.round((i * (meta.frameCount - 1)) / Math.max(1, n - 1)))
  }
  const dec = decodeGif(buf, { want: idx })
  if (!dec) return { ok: false, total: meta.frameCount, frames: [], reason: '解码失败' }

  const frames = dec.frames.map((f) => {
    const d = downscale(f.rgba, f.w, f.h, maxSide)
    const png = encodePng(d.rgba, d.w, d.h)
    return 'data:image/png;base64,' + png.toString('base64')
  })
  return { ok: frames.length > 0, total: meta.frameCount, frames }
}

/**
 * 把抽出来的帧拼成**一张**网格图（左→右、上→下）。
 *
 * 为什么要它：实测一张图固定 184 token，跟尺寸无关；9 张分开发就是 9×184。
 * 拼成一张 = 一张图的价钱看到全部帧，代价是每格分辨率低一些。
 * 这是「省钱」和「看清」之间的一个折中选项，具体用哪个由调用方决定。
 * @returns {{ok:boolean, dataUrl?:string, width?:number, height?:number, cols?:number, rows?:number, frames?:number, reason?:string}}
 */
export function composeSheet(buf, { count = 9, cell = 512, cols = 3 } = {}) {
  const dec = decodeGif(buf, { want: null })
  if (!dec || !dec.frames.length) return { ok: false, reason: '解码失败' }
  const total = dec.frames.length
  if (total < 2) return { ok: false, reason: '只有一帧' }

  // 均匀抽帧（和 extractFrames 同一套取法）
  const n = Math.min(count, total)
  const idx = []
  for (let i = 0; i < n; i += 1) idx.push(Math.round((i * (total - 1)) / Math.max(1, n - 1)))
  const picked = idx.map((i) => dec.frames.find((f) => f.index === i)).filter(Boolean)
  if (!picked.length) return { ok: false, reason: '抽帧失败' }

  const c = Math.max(1, Math.min(cols, picked.length))
  const rows = Math.ceil(picked.length / c)
  const W = c * cell
  const H = rows * cell
  const out = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i += 1) {
    out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = 255
  }
  picked.forEach((f, k) => {
    const d = downscale(f.rgba, f.w, f.h, cell)
    const ox = (k % c) * cell + Math.floor((cell - d.w) / 2)
    const oy = Math.floor(k / c) * cell + Math.floor((cell - d.h) / 2)
    for (let y = 0; y < d.h; y += 1) {
      const src = y * d.w * 4
      const dst = ((oy + y) * W + ox) * 4
      for (let x = 0; x < d.w; x += 1) {
        const s = src + x * 4
        const t = dst + x * 4
        out[t] = d.rgba[s]; out[t + 1] = d.rgba[s + 1]; out[t + 2] = d.rgba[s + 2]; out[t + 3] = 255
      }
    }
  })
  const png = encodePng(out, W, H)
  return { ok: true, dataUrl: 'data:image/png;base64,' + png.toString('base64'), width: W, height: H, cols: c, rows, frames: picked.length, png }
}
