// tools/recall-sweep.mjs —— 预演：用她真实的历史做一次参数扫描
//
// 不是调参玄学：先手写一批「该命中 / 不该命中」的小标注集，然后让不同的
// (maxDfRatio, minScore, minRare) 组合去跑，看谁在两边都不出错。
// 标注依据都是真实发生过的话，不是我编的。
import { readEvents } from '../lib/store.mjs'
import { liveEvents } from '../lib/derive.mjs'
import { buildIndex, search } from '../lib/recall.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const events = liveEvents(readEvents(path.join(HER, 'life')))
const content = events.filter((e) => ['utterance', 'encounter', 'refusal', 'revision', 'narration'].includes(e.type))
const index = buildIndex(content)

console.log(`语料：${index.total} 条内容事件，平均长度 ${index.avgdl.toFixed(1)} token\n`)

/** 该命中的：期望的结果里包含 expect 这段原文 */
const SHOULD = [
  ['动图那个你只能看第一帧', '只能看到动图的第一帧'],
  ['你现在为什么回话都是回2条大差不差的', '两条一条是回你'],
  ['那天你说仓库结果不对', '仓库里的结果不对'],
  ['鲸鱼娘举着手机拍照', '鲸鱼娘拿着手机拍照'],
  ['你现在的上下文长度是多少勒', '你现在的上下文长度是多少勒'],
  ['我们最开始聊的是什么', '我们最开始聊什么'],
]

/** 不该命中的：她根本没聊过这些，或者只是打招呼 */
const SHOULD_NOT = [
  '你还记得上个月我们聊的那家咖啡店吗',
  '在吗',
  '嗯',
  '你好',
  '今天天气怎么样',
]

const CONFIGS = []
for (const maxDfRatio of [0.05, 0.08, 0.12, 0.20, 0.35]) {
  for (const minScore of [0.25, 0.32, 0.45]) {
    for (const minRare of [2, 3]) {
      for (const maxUnknownRatio of [0.4, 0.5, 0.6, 1.1]) CONFIGS.push({ maxDfRatio, minScore, minRare, maxUnknownRatio })
    }
  }
}

const rows = []
for (const cfg of CONFIGS) {
  let hit = 0
  let silent = 0
  const misses = []
  const leaks = []
  for (const [cue, expect] of SHOULD) {
    const r = search(index, cue, cfg)
    const ok = r.status === 'matched' && r.items.some((x) => x.text.includes(expect))
    if (ok) hit += 1
    else misses.push(cue)
  }
  for (const cue of SHOULD_NOT) {
    const r = search(index, cue, cfg)
    if (r.status !== 'matched') silent += 1
    else leaks.push(`${cue}→${r.items[0].text.slice(0, 16)}`)
  }
  const total = hit + silent
  rows.push({ cfg, hit, silent, total, misses, leaks })
}

rows.sort((a, b) => b.total - a.total || b.hit - a.hit || a.cfg.maxDfRatio - b.cfg.maxDfRatio)

console.log('前 12 个组合（满分 ' + (SHOULD.length + SHOULD_NOT.length) + '）：\n')
for (const r of rows.slice(0, 12)) {
  const c = r.cfg
  console.log(`  命中 ${r.hit}/${SHOULD.length} · 静默 ${r.silent}/${SHOULD_NOT.length}  `
    + `df<${c.maxDfRatio} 分>=${c.minScore} 稀有>=${c.minRare} 未见比>=${c.maxUnknownRatio}`)
  if (r.misses.length) console.log('     漏：' + r.misses.join(' / '))
  if (r.leaks.length) console.log('     误：' + r.leaks.join(' / '))
}

// 顺带看看语料里最「泛」的词，验证 maxDfRatio 该压到哪
const dfRows = [...index.df.entries()]
  .map(([t, n]) => ({ t, n, ratio: n / index.total }))
  .filter((x) => x.t.length === 2 && /[\u3400-\u9fff]/.test(x.t))
  .sort((a, b) => b.n - a.n)
  .slice(0, 20)
console.log('\n语料里最常见的 20 个二字词（这些就是该被 maxDfRatio 砍掉的）：')
console.log('  ' + dfRows.map((x) => `${x.t}(${(x.ratio * 100).toFixed(0)}%)`).join('  '))
