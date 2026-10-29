// tools/effort.mjs —— 看 / 设她的思考档位
//
// 档位是官方文档里的 low / high / max（`reasoning_effort`）：
//   low  —— 平时聊天，快
//   high —— 中等（文档里 medium/high/xhigh 都映射到 high）
//   max  —— 最深的思考档（max/ultra 都映射到这里）
//   none —— 关掉思考（对应 thinking: disabled）
//
// 这个值她是从 preference 事件读的（think.mjs），默认 low。
// 以前只有「她自己说出来」才能改，主人没有入口；这个脚本补上入口。
//
// 用法：
//   node tools/effort.mjs                      # 看现在多少
//   node tools/effort.mjs max                  # 全局设成 max
//   node tools/effort.mjs low --thread qq:private:10001
//   node tools/effort.mjs clear                # 撤回全局设置（回到默认 low）
import { readEvents, appendEvent } from '../lib/store.mjs'
import { liveEvents } from '../lib/derive.mjs'

const ROOT = 'E:/DSH-herself/life'
const VALID = new Set(['none', 'low', 'high', 'max'])

const argv = process.argv.slice(2)
const want = argv[0]
const ti = argv.indexOf('--thread')
const thread = ti >= 0 ? String(argv[ti + 1] ?? '') : ''

const ev = liveEvents(readEvents(ROOT))
const read = (th) => ev
  .filter((e) => e.type === 'preference' && e.meta?.key === 'reasoning' && (th ? e.meta?.thread === th : !e.meta?.thread))
  .slice(-1)[0]

if (!want) {
  const g = read('')
  console.log('全局档位:', g ? `${g.meta?.value}（${g.ts}）` : '没设过 → 默认 low')
  for (const e of ev.filter((x) => x.type === 'preference' && x.meta?.key === 'reasoning' && x.meta?.thread)) {
    console.log('  指定线程', e.meta.thread, '→', e.meta.value, `（${e.ts}）`)
  }
  process.exit(0)
}

if (want === 'clear') {
  const cur = read(thread)
  if (!cur) { console.log('本来就没设过'); process.exit(0) }
  const t = appendEvent(ROOT, {
    type: 'tombstone', actor: 'system', surface: 'system',
    text: `撤回思考档位的设置（${thread || '全局'}），回到默认 low`,
    refs: [cur.id], meta: { reason: 'effort-clear' },
  })
  console.log('已撤回', cur.meta?.value, '→ 默认 low；撤回事件', t.id)
  process.exit(0)
}

if (!VALID.has(want)) {
  console.error(`不认识档位：${want}（只收 ${[...VALID].join(' / ')}）`)
  process.exit(1)
}

const t = appendEvent(ROOT, {
  type: 'preference', actor: 'system', surface: 'system',
  text: `思考档位定为 ${want}${thread ? `（只对 ${thread}）` : '（全局）'}`,
  meta: { key: 'reasoning', value: want, declared: true, by: 'owner', ...(thread ? { thread } : {}) },
})
console.log('已设成', want, thread ? `（${thread}）` : '（全局）', '事件', t.id)
console.log('下一句话就生效——think() 每次都会重新读事件流。')
