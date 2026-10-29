// test/synonym.mjs —— 同义扩展：她说"回两条"，记录里是"发两条"
//
// 2026-10-29 复盘：她记不住旧事，很大一部分不是没存，是**词对不上**。
// 分词是中文二元组，"回两"她没见过 → 直接判 unknown → 整条线索作废。
import { synonymTokens, knownChar } from '../lib/synonyms.mjs'
import { recall } from '../lib/recall.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 替换本身
{
  ok(synonymTokens('回两').includes('发两'), '「回两」能给到「发两」', JSON.stringify(synonymTokens('回两')))
  ok(!synonymTokens('回两').includes('回两'), '不把自己也算成替身')
  ok(synonymTokens('abc').length === 0, '英文/数字不做同义替换')
  ok(synonymTokens('').length === 0, '空串不炸')
  ok(knownChar('睡') && knownChar('发'), '表里收了这一路上踩过的字')
}

// ---------------------------------------------------------------- 端到端：改写也能翻到
{
  const ev = []
  for (let i = 0; i < 40; i += 1) {
    ev.push({ type: 'encounter', ts: `2026-10-29T${String(10 + (i % 10)).padStart(2, '0')}:00:00+08:00`, text: `主人：第 ${i} 条闲聊内容`, meta: {} })
  }
  ev.push({ type: 'encounter', ts: '2026-10-29T10:30:00+08:00', text: '主人：你回消息总是发两条差不多的话', meta: {} })
  ev.push({ type: 'encounter', ts: '2026-10-29T10:31:00+08:00', text: '主人：今天天气不错适合出去玩', meta: {} })
  // 语料很小，门控会全丢——这里放宽，只看"词对上没对上"
  const loose = { minRare: 0, minScore: 0, minCoverage: 0, maxDfRatio: 1 }
  const a = recall(ev, '回两条', loose)
  const b = recall(ev, '发两条', loose)
  ok(a.status === 'matched', '「回两条」能翻到记录里的「发两条」', a.status)
  ok(String(a.items?.[0]?.text ?? '').includes('发两条'), '翻到的就是那条', String(a.items?.[0]?.text ?? '').slice(0, 24))
  ok(b.status === 'matched' && String(b.items?.[0]?.text ?? '') === String(a.items?.[0]?.text ?? ''), '原词和改写落到同一条')
}

// ---------------------------------------------------------------- 不扩见过的词
{
  const ev = []
  for (let i = 0; i < 40; i += 1) {
    ev.push({ type: 'encounter', ts: `2026-10-29T${String(10 + (i % 10)).padStart(2, '0')}:00:00+08:00`, text: `主人：第 ${i} 条闲聊内容`, meta: {} })
  }
  ev.push({ type: 'encounter', ts: '2026-10-29T10:30:00+08:00', text: '主人：记得把钥匙放门口', meta: {} })
  const loose = { minRare: 0, minScore: 0, minCoverage: 0, maxDfRatio: 1 }
  const r = recall(ev, '钥匙', loose)
  ok(r.status === 'matched', '见过的词照常命中，不因扩展而改变', r.status)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)