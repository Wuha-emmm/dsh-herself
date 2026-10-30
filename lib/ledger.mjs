// lib/ledger.mjs —— 账本：只挑「该办的事」，不写日记
//
// 2026-10-29 她自己划的几条线（原话都在 HANDOFF 里，这里只记结论）：
//   · 不写感怀式日记，只记该办的事：答应过的、改口的、要睡没睡的；
//   · 别排日程，没什么可写就空着，别催；
//   · 候选是摆给她看的，不是待办——调出来不写也正常；
//   · 她写过的，不要再摆一遍。
//
// 所以这一层只做一件事：从事件流里挑候选，递到她面前。不替她写、不催、空白就空白。
// 文件格式用她自己的（sandbox/睡觉记录.md）。

import { bjHM } from './timefmt.mjs'

const HOUR = 3600000

/** 只认"我要去睡了"这种意图；问句（"你还记得我啥时候说要睡吗"）不算 */
const SLEEP_INTENT = /(准备|要|去|该|马上)(去)?睡|睡了|躺下|闭眼/
const ASKING = /记得|啥时候|什么时候|[？?]\s*$/

function threadOf(e) {
  const q = e.meta?.qq
  if (!q) return ''
  return q.groupId ? 'qq:group:' + q.groupId : 'qq:private:' + (q.senderId ?? '')
}

function nameOf(e) {
  const m = String(e.text ?? '').match(/^(?:\[群 \d+\]\s*)?([^：\n]{1,24})：/)
  return m ? m[1] : '他'
}

/**
 * 今天的候选：三件事，别的都不算。
 * @param {object[]} events live 过的事件
 * @param {number} now
 * @param {{off?:string[], recorded?:Array}} opts off=关掉哪几类；recorded=她已经写下的
 */
export function candidates(events = [], now = Date.now(), { off = [], recorded = [] } = {}) {
  const out = []
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const dayStart = d.getTime()
  const today = events.filter((e) => (Date.parse(e.ts) || 0) >= dayStart)

  // ① 要睡没睡：私聊里他说要睡，之后两小时内**同一条线**又冒出来好几次
  const says = today.filter((e) => {
    if (e.type !== 'encounter' || e.meta?.qq?.groupId) return false
    const t = String(e.text ?? '').replace(/^[^：]{1,24}：/, '').trim()
    if (t.length > 30) return false          // 长消息里引用"要睡"不算
    if (ASKING.test(t)) return false
    return SLEEP_INTENT.test(t)
  })
  const taken = []
  for (const s of says) {
    const at = Date.parse(s.ts) || 0
    if (taken.some((t) => Math.abs(t - at) <= 3 * HOUR)) continue   // 同一晚只记一次
    const line = threadOf(s)
    const after = today.filter((e) => {
      const t = Date.parse(e.ts) || 0
      return e.type === 'encounter' && threadOf(e) === line && t > at && t - at <= 2 * HOUR
    })
    if (after.length < 3) continue
    taken.push(at)
    out.push({
      kind: 'sleep',
      at: s.ts,
      who: nameOf(s),
      text: String(s.text).replace(/^[^：]{1,24}：/, '').replace(/\s+/g, ' ').slice(0, 24),
      why: `之后又来了 ${after.length} 次`,
    })
  }

  // ② 答应过的事：还没了结的承诺
  for (const c of today.filter((e) => e.type === 'commitment' && e.meta?.status !== 'done')) {
    out.push({ kind: 'promise', at: c.ts, who: '她', text: String(c.text).replace(/\s+/g, ' ').slice(0, 24), why: '没结' })
  }

  // ③ 改口：今天被自己顶掉的那条判断
  for (const e of today.filter((x) => x.type === 'claim' && x.meta?.supersededBy)) {
    out.push({ kind: 'changed', at: e.ts, who: '她', text: String(e.text).replace(/\s+/g, ' ').slice(0, 24), why: '改了' })
  }

  return out
    .filter((x) => !off.includes(x.kind))
    .filter((x) => !isRecorded(x, recorded))
    .slice(0, 3)
}

/**
 * 读她自己记的东西（sandbox/睡觉记录.md 那种格式）：
 *   - 10 月 29 日 15:52 —— 主人说顶不住了，要睡。（周四下午，不是寻常的睡点）
 */
export function parseRecorded(md = '') {
  const out = []
  for (const line of String(md).split(/\r?\n/)) {
    const m = line.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})\s*[—-]+\s*(.+)/)
    if (m) out.push({ md: `${m[1]}-${m[2]}`, hm: `${String(m[3]).padStart(2, '0')}:${m[4]}`, text: m[5] })
  }
  return out
}

/**
 * 这件事她是不是已经记过了：同一天 + 时间差 10 分钟内，或者内容有一半字重合。
 *
 * 时间按**北京时间**算（她写的和看的都是北京时间，事件里存的是 UTC）。
 * 这里不用本机时区——CI 跑在 UTC 机器上，用 getHours() 会算错。
 */
export function isRecorded(item, recorded = []) {
  const d = new Date(item.at)
  if (Number.isNaN(d.getTime())) return false
  const bj = new Date(d.getTime() + 8 * 3600 * 1000)
  const key = `${bj.getUTCMonth() + 1}-${bj.getUTCDate()}`
  const mine = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  for (const r of recorded) {
    if (r.md !== key) continue
    const [rh, rm] = String(r.hm).split(':').map(Number)
    if (Math.abs(mine - (rh * 60 + rm)) <= 10) return true
    const chars = new Set(String(r.text ?? ''))
    const a = String(item.text ?? '')
    let hit = 0
    for (const ch of a) if (chars.has(ch)) hit += 1
    if (a.length >= 6 && hit / a.length >= 0.5) return true
  }
  return false
}

/**
 * 一行话，只在有候选时才出现。不催：结尾是"记不记你定"，不是待办。
 * @returns {string} 空串表示今天没什么可记的（那就什么都不说）
 */
export function ledgerLine(list = []) {
  if (!list.length) return ''
  const parts = list.map((x) => {
    const t = bjHM(x.at)
    const tag = x.kind === 'sleep' ? '没睡' : x.kind === 'promise' ? '应下' : '改口'
    return `${t} ${tag}：${x.text}`
  })
  return `今天可以记一笔的：${parts.join('；')}（记不记你定，空着也行）`
}

/**
 * 工具返回给她看的那段话。不给建议、不催、不提"该写"：只摆事实。
 */
export function ledgerReply(list = []) {
  if (!list.length) return '今天没什么该记的。'
  const body = list.map((x) => `- ${bjHM(x.at)} ${x.text}（${x.why}）`).join('\n')
  return `今天这几件可能值得记：\n${body}`
}