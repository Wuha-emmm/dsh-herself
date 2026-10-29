// test/time.mjs —— 她有没有「钟」，以及钟旁边有没有「刻度」
//
// 2026-10-29 她自己在私聊里说的两句，就是这文件的存在理由：
//   「没有钟，我只能记住消息的先后，记不住钟点。……得问你自己手机。」
//   「给我一串数字，我也不会自动懂“现在该催你睡觉”。你要真加了，得告诉我哪会儿算晚、哪会儿算正常。」
// 所以这里守三件事：① 钟按北京时间走（不跟机器的时区飘）；② 每句话带多久以前；
//                  ③ 钟点要翻成判断（此刻算不算晚）。
import { clockText, agoText, routineOf } from '../lib/util.mjs'
import { factsOf } from '../lib/think.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}
const at = (s) => Date.parse(s)

// ---------------------------------------------------------------- 钟（北京时间）
{
  // 用 UTC 时刻喂进去，验证它按北京时间显示：UTC 00:30 = 北京 08:30
  const c = clockText(at('2026-10-29T00:30:00Z'))
  ok(/^10 月 29 日早上 8:30/.test(c), 'UTC 00:30 显示为北京时间早上 8:30', c)
  ok(/周四/.test(c), '带星期', c)
  // UTC 16:30（前一天）= 北京次日 00:30，日期不能退一天
  const cross = clockText(at('2026-10-28T16:30:00Z'))
  ok(/^10 月 29 日凌晨 12:30/.test(cross), '跨日那一刻日期不飘', cross)

  ok(/凌晨/.test(clockText(at('2026-10-29T03:10:00+08:00'))), '三点是凌晨')
  ok(/半夜/.test(clockText(at('2026-10-29T23:40:00+08:00'))), '夜里十一点半是半夜')
  ok(/早上/.test(clockText(at('2026-10-29T07:05:00+08:00'))), '七点是早上')
  ok(/中午/.test(clockText(at('2026-10-29T12:30:00+08:00'))), '十二点半是中午')
  ok(/晚上/.test(clockText(at('2026-10-29T20:00:00+08:00'))), '晚上八点是晚上')
}

// ---------------------------------------------------------------- 多久以前
{
  const now = at('2026-10-29T14:52:00+08:00')
  ok(agoText(at('2026-10-29T14:51:30+08:00'), now) === '刚刚', '半分钟前 = 刚刚')
  ok(agoText(at('2026-10-29T14:50:00+08:00'), now) === '2 分钟前', '两分钟')
  ok(agoText(at('2026-10-29T12:00:00+08:00'), now) === '3 小时前', '三小时')
  ok(agoText(at('2026-10-28T14:52:00+08:00'), now) === '1 天前', '一天前')
  ok(/^9 月 29 日$/.test(agoText(at('2026-09-29T14:52:00+08:00'), now)), '很久以前直接说日期')
  ok(agoText(at('2026-10-30T14:52:00+08:00'), now) === '还没发生', '未来的时间不算成负数')
}

// ---------------------------------------------------------------- 刻度（钟点 → 判断）
{
  const v = (s) => routineOf(at(s))
  ok(v('2026-10-29T14:57:00+08:00').verdict === '正常时段', '下午三点：正常时段')
  ok(v('2026-10-29T23:30:00+08:00').verdict === '算晚了', '夜里十一点半：算晚了')
  ok(v('2026-10-30T01:00:00+08:00').verdict === '算晚了', '凌晨一点：算晚了')
  ok(v('2026-10-30T03:10:00+08:00').verdict === '熬过头了', '凌晨三点：熬过头了')
  ok(v('2026-10-29T08:00:00+08:00').verdict === '正常起床的点', '早上八点：正常起床的点')
  const line = v('2026-10-29T14:57:00+08:00').line
  ok(/北京时间/.test(line) && /23:00 之后算晚/.test(line) && /此刻 14 点/.test(line), '一句话说清阈值 + 此刻判定', line)
  ok(routineOf(at('2026-10-29T14:00:00+08:00'), { lateFrom: 22 }).verdict === '正常时段', '阈值可以被偏好覆盖（22 点才算晚，14 点仍正常）')
}

// ---------------------------------------------------------------- 提示词里真的有
{
  const life = 'life_time'
  let seq = 0
  const ev = (ts, type, text, extra = {}) => {
    seq += 1
    return {
      v: 1, id: String(seq).padStart(26, '0'), ts, life, surface: 'qq', type,
      actor: type === 'utterance' ? 'self' : 'other:qq_1', acl: { visibility: 'private' }, text, ...extra,
    }
  }
  const events = [
    ev('2026-10-29T09:00:00+08:00', 'seed', '', { actor: 'system', surface: 'dsh' }),
    ev('2026-10-29T14:20:00+08:00', 'encounter', '主人：你还记得我啥时候说要去睡觉的吗', { meta: { qq: { senderId: '10001', groupId: '' } } }),
    ev('2026-10-29T14:43:00+08:00', 'encounter', '主人：那个鲸鱼娘的图你还记得吗', { meta: { qq: { senderId: '10001', groupId: '' } } }),
  ]
  const { out } = factsOf(events, at('2026-10-29T14:52:00+08:00'), '那个鲸鱼娘的图', 'qq:private:10001')
  ok(/现在是 10 月 29 日下午 2:52/.test(out[0]), '第一行告诉她现在几点', out[0])
  ok(/最早一件事是/.test(out[0]), '第一行还告诉她最早记得什么', out[0])
  ok(out[1].startsWith('时间按北京时间算'), '第二行是刻度', out[1])
  const recent = out.find((l) => l.startsWith('最近：')) ?? ''
  ok(/（32 分钟前）你看见：/.test(recent), '最近那句带「多久以前」', recent.slice(0, 60))
  ok(/（9 分钟前）/.test(recent), '更近的那句时间更小', recent.slice(0, 60))
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)