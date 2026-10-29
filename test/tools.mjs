// test/tools.mjs —— 工具循环的本地验收：不用 QQ、不写她的事件流
//
// 跑：node test/tools.mjs
// 验的是「她伸手」这条路本身：ctx 传进去了没有、exec 会不会真执行、
// 模型会不会在该调工具的时候调工具。这一步不过，接 QQ 就是碰运气。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 这个测试会真跑一次 think()——它会写思考过程旁路。
// 必须在 import 之前把路径指到临时目录，否则测试会往生产日志 logs/trace.jsonl 里写
// （2026-10-29 实测：26 条 trace 里有 14 条是这么来的空线程垃圾）。
process.env.DSH_HERSELF_TRACE = path.join(os.tmpdir(), `her-tools-trace-${process.pid}-${Date.now()}.jsonl`)
const { exec, chatWithTools } = await import('../lib/toolcall.mjs')
const { think } = await import('../lib/think.mjs')

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const PNG = path.join(HER, 'sandbox', 'QQ_1793238496430.png')
const b64 = fs.existsSync(PNG) ? 'base64://' + fs.readFileSync(PNG).toString('base64') : ''

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

/** 假 ctx：跟 hands/qq.mjs 给的一样形状 */
function fakeCtx() {
  const sent = []
  return {
    sent,
    ctx: {
      message: b64 ? [{ type: 'image', data: { url: b64 } }] : [],
      send: async (s) => { sent.push(s); return `已经发出「${s.tag}」` },
    },
  }
}

// ---------------------------------------------------------------- 1 文件那只手
{
  const name = `_test-${Date.now()}.md`
  const w = await exec('fs_write', { name, content: '她自己的测试便签' }, {})
  ok(/写好了/.test(w), 'fs_write 写得进 sandbox', w)
  const r = await exec('fs_read', { name }, {})
  ok(/她自己的测试便签/.test(r), 'fs_read 读得回刚写的内容', r.slice(0, 60))
  const rm = await exec('fs_remove', { name }, {})
  ok(/删掉了/.test(rm), 'fs_remove 删得掉', rm)
  const out = await exec('fs_write', { name: '../../escape.md', content: 'x' }, {})
  ok(!fs.existsSync(path.join(HER, 'escape.md')), '越界写被 sandbox 挡住', out)

  // D18：白名单外的工具必须被拒绝，而且要说清楚（不能静默失败）
  const unknown = await exec('rm_rf_everything', {}, {})
  ok(/没有这个工具/.test(unknown), '调用不存在的工具会被拒绝并说明', unknown)

  // 2026-10-29：她说过「我这边打不开 GitHub」——事实是她根本没有联网工具。
  // 现在有了 fetch_url / web_search（走 DeepSeek 官方 Search/Fetch，抓取发生在服务端）。
  const blocked = await exec('fetch_url', { url: 'file:///C:/Windows/win.ini' }, {})
  ok(/打不开/.test(blocked) && /http\/https/.test(blocked), 'fetch_url 不吃 file:// ', blocked)
  const badUrl = await exec('fetch_url', { url: '瞎写的' }, {})
  ok(/打不开/.test(badUrl), 'fetch_url 对不是网址的东西也说得清', badUrl)
}

// ---------------------------------------------------------------- 2 表情那只手
{
  const { ctx, sent } = fakeCtx()
  const out = await exec('send_sticker', { keyword: '委屈' }, ctx)
  ok(sent.length === 1 && /已经发出/.test(out), 'send_sticker 挑得到「委屈」并走 ctx.send', out)
  ok(Boolean(sent[0]?.url), '发出去的是真表情（带 url）', JSON.stringify(sent[0] ?? {}).slice(0, 80))
  const noHand = await exec('send_sticker', { keyword: '委屈' }, {})
  ok(/没有出口/.test(noHand), '没有 send 出口时她说得清，而不是假装发了', noHand)
}

// ---------------------------------------------------------------- 3 看图那只手
if (!b64) {
  console.log('- 跳过看图：sandbox 里没有测试图')
} else {
  const { ctx } = fakeCtx()
  const out = await exec('get_images', { count: 1 }, ctx)
  ok(typeof out === 'string' && out.length > 4 && !/没有图片/.test(out), 'get_images 把图变成了她看得懂的描述', out.replace(/\s+/g, ' ').slice(0, 90))
  const none = await exec('get_images', { count: 1 }, { message: [] })
  ok(/没有图片/.test(none), '消息里没图时她不会看到幻觉', none)
}

// ---------------------------------------------------------------- 4 她自己决定调
{
  const sys = '你在过日子，不是在扮演角色。别人发来的图，你自己决定看不看。'
  const a = await chatWithTools({ system: sys, user: '看看这张图，你看到的是什么？', ctx: fakeCtx().ctx, maxRounds: 3 })
  ok(a.tools.some((t) => t.name === 'get_images'), '说「看看这张图」时她自己调 get_images', JSON.stringify(a.tools.map((t) => t.name)))

  const b = await chatWithTools({ system: sys, user: '发个委屈的表情', ctx: fakeCtx().ctx, maxRounds: 3 })
  ok(b.tools.some((t) => t.name === 'send_sticker'), '说「发个委屈的表情」时她自己调 send_sticker', JSON.stringify(b.tools.map((t) => t.name)))
  ok(/表情/.test(b.text) || b.text.length > 0, '调完工具她仍然说了话', b.text.slice(0, 60))

  // 以前这是 hands/qq.mjs 里的 fs 特判，现在得她自己翻
  const c = await chatWithTools({ system: sys, user: '看看你文件夹里有什么', ctx: {}, maxRounds: 3 })
  ok(c.tools.some((t) => t.name === 'fs_list'), '说「看看你文件夹」时她自己调 fs_list', JSON.stringify(c.tools.map((t) => t.name)))

  // 合并转发：以前 qq.mjs 替她展开并塞进上下文，现在她自己要
  const d = await chatWithTools({ system: sys, user: '这条转发里他们在说什么？', ctx: { forwardId: 'bogus-id' }, maxRounds: 3 })
  ok(d.tools.some((t) => t.name === 'get_forward'), '说「这条转发里说了什么」时她自己调 get_forward', JSON.stringify(d.tools.map((t) => t.name)))
  const noFwd = await exec('get_forward', {}, {})
ok(/没找到可展开|没有可展开/.test(noFwd), '没有转发时她说得清，而不是去调空 id', noFwd)
}

// ---------------------------------------------------------------- 5 think 透传 ctx
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'her-tools-'))
  fs.copyFileSync(path.join(HER, 'life', 'events.jsonl'), path.join(tmp, 'events.jsonl'))
  const { ctx, sent } = fakeCtx()
  const before = fs.readFileSync(path.join(tmp, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).length
  const r = await think({ root: tmp, userText: '你发个委屈的表情给我看看', who: '他', isOwner: true, ctx })
  const evs = fs.readFileSync(path.join(tmp, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const added = evs.slice(before)
  const toolEvent = added.find((e) => e.type === 'action' && e.meta?.tools)
  ok(Boolean(toolEvent), 'think 把 ctx 传到了工具层（事件流里有工具记录）', JSON.stringify(added.map((e) => e.type)))
  ok(sent.length >= 1, '表情真的从 think 那条路发出去了', String(sent[0]?.tag ?? ''))
  ok(r.text.length > 0, '她照常回了一句话', r.text.slice(0, 60))
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
