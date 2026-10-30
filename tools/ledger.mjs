// tools/ledger.mjs —— 账本的观察期工具（试行第 1 天用）
//
// 她说：「先跑一天，看有没有把'要睡''改口'这类话误收进来。
//        明早我把误收的原文列给你，能改就改，改不了就先关掉那一类。」
//
// 用法：
//   node tools/ledger.mjs                # 看今天的候选（含原始事件 id，方便她报误收）
//   node tools/ledger.mjs off sleep      # 先关掉"要睡"这一类
//   node tools/ledger.mjs on sleep       # 再打开
//   node tools/ledger.mjs status         # 现在哪几类是开的
//
// 配置存在 logs/ledger.json：{ "off": ["sleep"] }。改完下一句就生效，不用重启。
import fs from 'node:fs'
import path from 'node:path'
import { readEvents } from '../lib/store.mjs'
import { liveEvents } from '../lib/derive.mjs'
import { candidates, ledgerReply } from '../lib/ledger.mjs'
import { fileURLToPath } from 'node:url'
import { bjHM } from '../lib/timefmt.mjs'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ROOT = path.join(HER, 'life')
const CFG = path.join(HER, 'logs/ledger.json')
const KINDS = ['sleep', 'promise', 'changed']
const LABEL = { sleep: '要睡没睡', promise: '答应过的事', changed: '改口' }

function load() {
  try { const j = JSON.parse(fs.readFileSync(CFG, 'utf8')); return { off: Array.isArray(j.off) ? j.off.filter((x) => KINDS.includes(x)) : [] } } catch { return { off: [] } }
}
function save(cfg) {
  fs.mkdirSync(path.dirname(CFG), { recursive: true })
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8')
}

const argv = process.argv.slice(2)
const cmd = String(argv[0] ?? '').trim()
const kind = String(argv[1] ?? '').trim()
const cfg = load()

if (cmd === 'off' || cmd === 'on') {
  if (!KINDS.includes(kind)) { console.error(`不认识这一类：${kind}（只收 ${KINDS.join(' / ')}）`); process.exit(1) }
  const off = new Set(cfg.off)
  if (cmd === 'off') off.add(kind); else off.delete(kind)
  save({ off: [...off] })
  console.log(cmd === 'off' ? `已关掉：${LABEL[kind]}` : `已打开：${LABEL[kind]}`)
  console.log('现在关着的：', [...off].map((k) => LABEL[k]).join('、') || '（全开）')
  process.exit(0)
}

if (cmd === 'status') {
  console.log('三类：')
  for (const k of KINDS) console.log(`  ${cfg.off.includes(k) ? '✗ 关' : '✓ 开'}  ${LABEL[k]}（${k}）`)
  process.exit(0)
}

const ev = liveEvents(readEvents(ROOT))
const all = candidates(ev, Date.now())          // 全开，方便看"假如没关会是什么"
const shown = all.filter((x) => !cfg.off.includes(x.kind))
console.log(ledgerReply(shown) || '今天没什么该记的。')
if (cfg.off.length) console.log(`（关着的类：${cfg.off.map((k) => LABEL[k]).join('、')}）`)
const hidden = all.filter((x) => cfg.off.includes(x.kind))
if (hidden.length) console.log(`（被关掉、没显示的 ${hidden.length} 条：\n${hidden.map((x) => `   ${bjHM(x.at)} ${x.text}（${x.why}）`).join('\n')}`)