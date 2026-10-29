// tools/drift.mjs —— 漂移体检（欠账⑥）
//
//   node tools/drift.mjs --save      # 把当下存成基线
//   node tools/drift.mjs             # 和基线比，给出三档结论
//   node tools/drift.mjs --days 7    # 只比最近 7 天的
//
// 只看**她自己说的话**的词频指纹（lib/drift.mjs）。不碰模型，随时能跑。
import fs from 'node:fs'
import path from 'node:path'
import { readEvents } from '../lib/store.mjs'
import { liveEvents } from '../lib/derive.mjs'
import { fingerprint, compare, verdict } from '../lib/drift.mjs'
import { fileURLToPath } from 'node:url'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const BASE = path.join(HER, 'logs/drift-baseline.json')
const argv = process.argv.slice(2)
const save = argv.includes('--save')
const di = argv.indexOf('--days')
const days = di >= 0 ? Number(argv[di + 1]) || 0 : 0

const events = liveEvents(readEvents(path.join(HER, 'life')))
const to = Date.now()
const from = days ? to - days * 86400000 : 0
const fp = fingerprint(events, { from, to })

if (save) {
  fs.mkdirSync(path.dirname(BASE), { recursive: true })
  fs.writeFileSync(BASE, JSON.stringify(fp, null, 2), 'utf8')
  console.log(`基线已存：${Object.keys(fp.tokens).length} 个词，${fp.chars} 字（${BASE}）`)
  process.exit(0)
}

let base = null
try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')) } catch { /* 第一次跑没有基线 */ }
if (!base) {
  console.log('还没有基线。先跑一次 `node tools/drift.mjs --save`。')
  console.log(`当前指纹：${Object.keys(fp.tokens).length} 个词 / ${fp.chars} 字`)
  process.exit(0)
}

const r = compare(base, fp)
const v = verdict(r.jaccard)
console.log(`相似度 ${(r.jaccard * 100).toFixed(1)}% —— ${v.text}`)
console.log(`  基线：${base.at} · ${Object.keys(base.tokens).length} 个词 / ${base.chars} 字`)
console.log(`  现在：${fp.at} · ${Object.keys(fp.tokens).length} 个词 / ${fp.chars} 字`)
if (r.gained.length) console.log('  新出现的词：', r.gained.join('、'))
if (r.lost.length) console.log('  不再出现的词：', r.lost.join('、'))
process.exit(v.level === 'alert' ? 1 : 0)