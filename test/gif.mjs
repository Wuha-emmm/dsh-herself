// test/gif.mjs —— 动图抽帧的验收
//
// 跑：node test/gif.mjs
// 夹具 test/fixtures/anim3.gif 是从她表情库里一张真 GIF 上做块级手术切出来的前 3 帧，
// 没有重编码——所以它是真实世界的数据，不是自己造的。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isGif, decodeGif, extractFrames, encodePng, downscale } from '../lib/gif.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(here, 'fixtures', 'anim3.gif')

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 1 纯函数
ok(!isGif(Buffer.from('89504e470d0a1a0a', 'hex')), 'PNG 不会被当成 GIF')
ok(!isGif(Buffer.from('short')), '太短的不会崩')
ok(isGif(fs.readFileSync(FIX)), '夹具是真 GIF')

{
  const rgba = new Uint8Array(2 * 2 * 4).fill(200)
  const png = encodePng(rgba, 2, 2)
  ok(png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'encodePng 输出的是 PNG')
  ok(png.readUInt32BE(16) === 2 && png.readUInt32BE(20) === 2, 'PNG 头里的宽高对', `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`)
}

{
  const big = new Uint8Array(4 * 300 * 200).fill(9)
  const d = downscale(big, 300, 200, 64)
  ok(Math.max(d.w, d.h) <= 64 && d.w > 0 && d.h > 0, 'downscale 把长边压到上限内', `${d.w}x${d.h}`)
  const same = downscale(big, 30, 20, 64)
  ok(same.w === 30 && same.h === 20, '小图不放大')
}

// ---------------------------------------------------------------- 2 真夹具解码
{
  const buf = fs.readFileSync(FIX)
  const dec = decodeGif(buf, { want: [0, 1, 2] })
  ok(Boolean(dec), '解得出')
  ok(dec.total === 3, '数得出 3 帧', String(dec.total))
  ok(dec.frames.length === 3, '取到 3 帧', String(dec.frames.length))
  ok(dec.width === 500 && dec.height === 500, '画布尺寸对', `${dec.width}x${dec.height}`)
  const nonEmpty = dec.frames.every((f) => f.rgba.some((v) => v !== 0))
  ok(nonEmpty, '每帧都有像素（不是空白画布）')

  const only = decodeGif(buf, { want: [1] })
  ok(only.frames.length === 1 && only.frames[0].index === 1, 'want 只解指定的帧（不为大动图吃内存）')
}

// ---------------------------------------------------------------- 3 抽帧
{
  const buf = fs.readFileSync(FIX)
  const r = extractFrames(buf, { count: 9, maxSide: 384 })
  ok(r.ok, '抽帧成功', r.reason ?? '')
  ok(r.frames.length === 3, '帧数不够 9 就按实际帧数来（不放空帧）', String(r.frames.length))
  ok(r.frames.every((f) => f.startsWith('data:image/png;base64,')), '每帧都是 PNG data URL')
  const dims = r.frames.map((f) => {
    const b = Buffer.from(f.split(',')[1], 'base64')
    return [b.readUInt32BE(16), b.readUInt32BE(20)]
  })
  ok(dims.every(([w, h]) => Math.max(w, h) <= 384), '抽出来的帧被压到 384 以内（省 token）', JSON.stringify(dims))
}

// ---------------------------------------------------------------- 4 脏输入
{
  ok(decodeGif(Buffer.from('not a gif at all')) === null, '不是 GIF 返回 null，不抛')
  const bad = extractFrames(Buffer.from('not a gif at all'))
  ok(bad.ok === false && bad.frames.length === 0, '抽帧失败时给空数组 + 原因', bad.reason ?? '')
}

// ---------------------------------------------------------------- 5 走完整链路：她调 get_images → 下载 → 抽帧 → 串起来看
{
  const b64 = fs.readFileSync(FIX).toString('base64')
  const { exec } = await import('../lib/toolcall.mjs')
  const ctx = { message: [{ type: 'image', data: { url: 'base64://' + b64 } }], send: async () => {} }
  const out = await exec('get_images', { count: 1 }, ctx)
  ok(/抽了 3 帧/.test(out), '她调 get_images 时动图也是抽帧看的（完整链路）', out.slice(0, 40))
  ok(out.length > 30, '拿到了像样的描述', String(out.length))
  console.log('   → ' + out.replace(/\s+/g, ' ').slice(0, 150))
}

// ---------------------------------------------------------------- 6 base64 段要认得出是动图
{
  const { sniffMime } = await import('../lib/tools.mjs')
  const gif = fs.readFileSync(FIX)
  ok(sniffMime(gif) === 'image/gif', 'base64 段能认出 GIF（以前一律标成 png，动图就抽不了帧）')
  ok(sniffMime(Buffer.from('89504e470d0a1a0a0000000d', 'hex')) === 'image/png', '认得出 PNG')
  ok(sniffMime(Buffer.from('ffd8ffe000104a464946000101', 'hex')) === 'image/jpeg', '认得出 JPEG')
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
