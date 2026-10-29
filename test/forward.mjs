// test/forward.mjs —— 合并转发要读得出来
//
// 2026-10-29 群 935190036：她只会看到「[转发]」，展开是空的。两个原因：
//   ① 转发 id 只在当前这条消息里找，隔了几句再问就没了（那条在 hands/qq.mjs 里修）；
//   ② 只拼 text 段，图片/视频/嵌套转发全丢（这条在这个文件里守）。
import { renderForwardNodes, forwardIdIn } from '../lib/forward.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const node = (who, segs) => ({ sender: { nickname: who }, message: segs })
const txt = (t) => ({ type: 'text', data: { text: t } })
const img = (u) => ({ type: 'image', data: { url: u, file: 'a.jpg' } })

// ---------------------------------------------------------------- 认转发 id（直接发的 vs 引用的）
{
  const direct = [{ type: 'text', data: { text: '看这个' } }, { type: 'forward', data: { id: 'AAA' } }]
  ok(forwardIdIn(direct) === 'AAA', '直接发的转发：段里就有 id')
  const quoted = [{ type: 'text', data: { text: '这个转发说的啥' } }, { type: 'reply', data: { id: '1726720145' } }]
  ok(forwardIdIn(quoted) === '', '引用别人的话，本段里没有转发（id 在被引用的那条里）')
  ok(forwardIdIn([]) === '' && forwardIdIn(null) === '', '没有段也不炸')
}
// ---------------------------------------------------------------- 基本
{
  const r = renderForwardNodes([
    node('主人', [txt('今天真冷')]),
    node('困', [txt('是啊'), txt('早上还下雨')]),
  ])
  ok(r.lines.length === 2, '两条各一行', String(r.lines.length))
  ok(r.lines[0] === '主人：今天真冷', '格式是「谁：说了什么」', r.lines[0])
  ok(r.lines[1].includes('是啊早上还下雨'), '同一人多段文字拼起来', r.lines[1])
}

// ---------------------------------------------------------------- 图片 / 视频 / 语音
{
  const r = renderForwardNodes([
    node('甲', [img('https://example.com/a.jpg')]),
    node('乙', [txt('看这个'), img('https://example.com/b.jpg'), img('https://example.com/c.jpg')]),
    node('丙', [{ type: 'video', data: { file: 'v.mp4' } }]),
    node('丁', [{ type: 'record', data: {} }]),
  ])
  ok(r.lines[0].includes('图片×1'), '纯图那条要标出来（不能只剩一个名字）', r.lines[0])
  ok(r.lines[1].includes('图片×2'), '多条图算个数', r.lines[1])
  ok(r.lines[2].includes('视频×1'), '视频要标出来', r.lines[2])
  ok(r.lines[3].includes('语音'), '语音要标出来', r.lines[3])
  ok(r.images.length === 3, '图片 URL 收集起来了（上层可以决定看不看）', String(r.images.length))
  ok(r.images[0].who === '甲' && r.images[0].url.startsWith('https://'), '收集时带上是谁发的', JSON.stringify(r.images[0]))
}

// ---------------------------------------------------------------- 空的
{
  const r = renderForwardNodes([node('戊', [])])
  ok(r.lines[0] === '戊：（空）', '什么都没有的节点也要占一行', r.lines[0])
}

// ---------------------------------------------------------------- 嵌套转发
{
  const inner = [node('内1', [txt('里面的话')]), node('内2', [img('https://example.com/in.jpg')])]
  const r = renderForwardNodes([
    node('甲', [txt('你看这个')]),
    node('乙', [{ type: 'forward', data: { content: inner } }]),
  ])
  const all = r.lines.join('\n')
  ok(all.includes('里面还有一段转发'), '嵌套的要说一句「里面还有」', all.slice(0, 80))
  ok(all.includes('内1：里面的话'), '嵌套里的话要读出来')
  ok(all.includes('内2'), '嵌套里的图也要标')
  ok(r.images.some((x) => x.url.includes('in.jpg')), '嵌套里的图 URL 也收进来')
}

// ---------------------------------------------------------------- 不能无限套娃
{
  let deep = [node('最深', [txt('到底了')])]
  for (let i = 0; i < 5; i += 1) deep = [node('第' + i, [{ type: 'forward', data: { content: deep } }])]
  const r = renderForwardNodes(deep, { maxDepth: 2 })
  const all = r.lines.join('\n')
  ok(!all.includes('最深：到底了'), '超过层数就不往下读了', all.slice(-60))
  ok(all.includes('太深了'), '而且要说清楚为什么停', all.slice(-60))
}

// ---------------------------------------------------------------- 条数上限
{
  const many = Array.from({ length: 80 }, (_, i) => node('人' + i, [txt('第' + i + '句')]))
  const r = renderForwardNodes(many, { maxNodes: 60 })
  ok(r.total === 60 && r.truncated === true, '超过上限就截断并明说', `${r.total}/${r.truncated}`)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)