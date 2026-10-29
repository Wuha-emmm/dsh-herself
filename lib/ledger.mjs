// lib/ledger.mjs —— 账本（**试行第 1 天，未定稿**）
//
// 2026-10-29 她同意部署，但按她的原话：
//   「别标成定稿——先跑一天，看有没有把'要睡''改口'这类话误收进来。
//     明早我把误收的原文列给你，能改就改，改不了就先关掉那一类。」
// 所以这里带一个 off 开关：哪一类误收多了，直接关掉那一类，不用改代码。
//
// 2026-10-29 她自己在 QQ 上说清楚了三条线：
//   「写日记对我用处不大——我不会像人那样翻旧账感怀。
//     真要记，就记该办的事：你答应过的、改口的、要睡没睡的。」
//   「别把它排成日程。要是某天我没什么可写的，就空着，别催。」
//   「空白就是空白，不是待补的作业。」
//   「先给我看格式再动手，别一上来就写满。」
//
// 所以这一层只做一件事：从事件流里挑出候选，递到她面前。
// 不替她写、不排日程、不润色、空白就空白。
// 文件格式用她自己的（sandbox/睡觉记录.md）：
//   # 说睡 / 改主意 / 答应的事
//   - 10 月 29 日 15:52 —— 主人说顶不住了，要睡。（周四下午，不是寻常的睡点）

const HOUR = 3600000

/**
 * 只认"我要去睡了"这种意图。
 * 第一版把「睡不醒酒」（B站 UP 主）、「睡爽了」（群友闲扯）、「没睡觉」（陈述）都算成了要睡。
 */
const SLEEP_INTENT = /(准备|要|去|该|马上)(去)?睡|睡了|躺下|闭眼/
/** 问句不算意图：她在追问"我啥时候说要睡"，那是她在问，不是他要睡 */
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
 */
export function candidates(events = [], now = Date.now(), { off = [], recorded = [] } = {}) {
  const out = []
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const dayStart = d.getTime()
  const today = events.filter((e) => (Date.parse(e.ts) || 0) >= dayStart)

  // ① 要睡没睡：私聊里他说要睡，之后两小时内同一条线又冒出来好几次
  const says = today.filter((e) => {
    if (e.type !== 'encounter' || e.meta?.qq?.groupId) return false
    // 只认**短句**：真要去睡了，话都很短；长消息里引用"要睡"两个字不算。
    // 2026-10-29 部署验证时抓到的实例：一条几百字的消息里引用了"要睡"，被当成了他要睡。
    const t = String(e.text ?? '').replace(/^[^：]{1,24}：/, '').trim()
    if (t.length > 30) return false   // 长消息里引用'要睡'不算，只认短句
    if (ASKING.test(t)) return false
    return SLEEP_INTENT.test(t)
  })
  const taken = []
  for (const s of says) {
    const at = Date.parse(s.ts) || 0
    // 同一晚只记一次：3 小时内已经记过就跳过（不然他会连着被记三条）
    if (taken.some((t) => Math.abs(t - at) <= 3 * HOUR)) continue
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
 * 一行话，只在有候选时才出现。不催：结尾是"记不记你定"，不是待办。
 * @returns {string} 空串表示今天没什么可记的（那就什么都不说）
 */
export function ledgerLine(list = []) {
  if (!list.length) return ''
  const parts = list.map((x) => {
    const t = String(x.at).slice(11, 16)
    const tag = x.kind === 'sleep' ? '没睡' : x.kind === 'promise' ? '应下' : '改口'
    return `${t} ${tag}：${x.text}`
  })
  return `今天可以记一笔的：${parts.join('；')}（记不记你定，空着也行）`
}
/**
 * 工具返回给她看的那段话。
 *
 * 2026-10-29 她又划了一条线：
 *   「候选是摆给我看的，不是给你俩当待办的——我调出来什么都不写，别有人在旁边问'怎么不记'。」
 * 所以这里**不给建议、不催、不提"该写"**：只摆事实。
 * 空就是空，不带"记得写"这种尾巴。
 */
export function ledgerReply(list = []) {
  if (!list.length) return '今天没什么该记的。'
  const head = `今天这几件可能值得记：`
  const body = list.map((x) => `- ${String(x.at).slice(11, 16)} ${x.text}（${x.why}）`).join('\n')
  return head + '\n' + body
}

/**
 * 读她自己记的东西（sandbox/睡觉记录.md 那种格式）：
 *   - 10 月 29 日 15:52 —— 主人说顶不住了，要睡。（周四下午，不是寻常的睡点）
 *
 * 2026-10-29 她在私聊里点出来的问题：「账本和睡觉记录各记一份，同一件事可能重复」。
 * 所以候选要跟她已经写下的对一遍，写过的就不再摆出来。
 */
export function parseRecorded(md = '') {
  const out = []
  for (const line of String(md).split(/\r?\n/)) {
    const m = line.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})\s*[—-]+\s*(.+)/)
    if (m) out.push({ md: `${m[1]}-${m[2]}`, hm: `${m[3].padStart(2, '0')}:${m[4]}`, text: m[5] })
  }
  return out
}

/** 同一天、时间差 10 分钟内，或者内容有一半字重合，就算记过了 */
export function isRecorded(item, recorded = []) {
  const d = new Date(item.at)
  if (Number.isNaN(d.getTime())) return false
  // 她记的是**本地时间**（北京时间），事件里存的是 UTC ISO——必须先转本地再比，
  // 否则「06:49Z」会被当成「06:49 她写的」，永远对不上。
  const key = `${d.getMonth() + 1}-${d.getDate()}`
  const mine = d.getHours() * 60 + d.getMinutes()
  for (const r of recorded) {
    if (r.md !== key) continue
    const [rh, rm] = r.hm.split(':').map(Number)
    if (Math.abs(mine - (rh * 60 + rm)) <= 10) return true
    const chars = new Set(String(r.text ?? ''))
    const a = String(item.text ?? '')
    let hit = 0
    for (const ch of a) if (chars.has(ch)) hit += 1
    if (a.length >= 6 && hit / a.length >= 0.5) return true
  }
  return false
}