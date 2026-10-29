// tools/recall-dryrun.mjs —— 检索的预演：新旧两套在她真实的历史上并排跑
//
// 只读，不改任何行为。用法：
//   node tools/recall-dryrun.mjs            # 跑内置的一组问题
//   node tools/recall-dryrun.mjs "某句话"    # 只跑这一句
//
// 看的是三件事：① 模糊问候会不会硬塞旧事（现在的实现会）；② 真提旧事时能不能翻到；
// ③ 每轮注入多少 token。
import { readEvents } from '../lib/store.mjs'
import { liveEvents } from '../lib/derive.mjs'
import { retrieveScored } from '../lib/think.mjs'
import { recall } from '../lib/recall.mjs'

const CJK = /[\u3400-\u9fff]/
const LAT = /[A-Za-z0-9]/
const est = (t) => {
  let a = 0, b = 0, c = 0
  for (const ch of String(t ?? '')) { if (CJK.test(ch)) a += 1; else if (LAT.test(ch)) b += 1; else c += 1 }
  return Math.ceil(a + b / 4 + c / 4)
}

const root = 'E:/DSH-herself/life'
const events = liveEvents(readEvents(root))
const content = events.filter((e) => ['utterance', 'encounter', 'refusal', 'revision', 'narration'].includes(e.type))

const QUERIES = process.argv[2] ? [process.argv[2]] : [
  '在吗',
  '嗯',
  '你好',
  '你现在的上下文长度是多少勒',
  '你还记得上个月我们聊的那家咖啡店吗',
  '我们最开始聊的是什么',
  '动图那个你只能看第一帧',
  '你说我回话总发两条',
  '委屈的表情',
  '那天你说仓库结果不对',
  '鲸鱼娘举着手机拍照',
]

console.log(`事件 ${events.length} 条（内容型 ${content.length}），下面每题对比「现在」和「v2」\n`)

let savedTokens = 0
let oldInject = 0
let newInject = 0

for (const q of QUERIES) {
  const oldHits = retrieveScored(content, q, 4)
  const v2 = recall(content, q)

  const oldTok = oldHits.reduce((s, x) => s + est(x.e.text), 0)
  const newTok = v2.items.reduce((s, x) => s + est(x.text), 0)
  oldInject += oldTok
  newInject += newTok
  savedTokens += oldTok - newTok

  console.log(`━━ ${q}`)
  console.log(`  现在：${oldHits.length} 条 / ${oldTok} tok`)
  for (const h of oldHits.slice(0, 4)) {
    console.log(`    ${h.score.toFixed(1).padStart(5)}  ${String(h.e.text).slice(0, 52)}`)
  }
  const d = v2.debug
  console.log(`  v2：${v2.status} · 稀有命中 ${d.rareHits} · 分 ${d.bestScore} · 覆盖 ${d.bestCoverage}${d.quote ? ' · 有连续重合' : ''} → ${v2.items.length} 条 / ${newTok} tok`)
  for (const it of v2.items) console.log(`    ${String(it.score).padStart(5)}  ${String(it.text).slice(0, 52)}`)
  if (v2.status === 'ambiguous') {
    console.log('    （不够确定，只给候选，让她问一句：' + (v2.candidates[0]?.text ?? '').slice(0, 40) + '…）')
  }
  console.log('')
}

console.log(`合计：现在每轮约 ${oldInject} tok，v2 约 ${newInject} tok，少 ${savedTokens} tok`)
console.log(`按 ${QUERIES.length} 题算，平均每轮省 ${Math.round(savedTokens / QUERIES.length)} tok`)
