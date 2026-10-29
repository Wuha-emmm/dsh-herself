// tools/approve.mjs —— 给 / 收「公共动作」的许可
//
// 什么算公共动作：群里发表情这种"她主动往外递东西"。普通回话不需要许可。
// 许可是**事件流里的一条 meta**，24 小时后自动过期。
//
// 用法：
//   node tools/approve.mjs            # 看现在有没有、还剩多久
//   node tools/approve.mjs allow      # 给 24 小时
//   node tools/approve.mjs deny       # 收回
import { readEvents, appendEvent } from '../lib/store.mjs'
import { liveEvents } from '../lib/derive.mjs'
import { publicAllowed, APPROVAL_KEY, APPROVAL_TTL_MS } from '../lib/gate.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ROOT = path.join(HER, 'life')
const cmd = String(process.argv[2] ?? '').trim()
const ev = liveEvents(readEvents(ROOT))

if (!cmd) {
  const st = publicAllowed(ev, Date.now())
  console.log(st.allowed ? `有许可：${st.reason}` : `没有许可：${st.reason}`)
  if (st.allowed) console.log(`还剩 ${(st.leftMs / 3600000).toFixed(1)} 小时（共 ${APPROVAL_TTL_MS / 3600000} 小时）`)
  process.exit(0)
}

if (cmd === 'allow') {
  const t = appendEvent(ROOT, {
    type: 'meta', actor: 'system', surface: 'system',
    text: `主人给了公共动作许可（${APPROVAL_TTL_MS / 3600000} 小时）`,
    meta: { key: APPROVAL_KEY, value: true },
  })
  console.log('已给许可（24 小时），事件', t.id)
  process.exit(0)
}

if (cmd === 'deny') {
  const t = appendEvent(ROOT, {
    type: 'meta', actor: 'system', surface: 'system',
    text: '主人收回了公共动作许可',
    meta: { key: APPROVAL_KEY, value: false },
  })
  console.log('已收回，事件', t.id)
  process.exit(0)
}

console.error(`不认识的命令：${cmd}（只收 allow / deny）`)
process.exit(1)