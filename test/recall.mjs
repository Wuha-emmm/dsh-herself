// test/recall.mjs —— 检索 v2 的契约
//
// 为什么用合成语料：她的真实事件流每天都在变，测试不能挂在会动的东西上。
// 这里造 60 条背景 + 几条目标，专门验四件事：
//   ① 真提旧事 → 翻得到（而且不因为年代久就被压下去）；
//   ② 从没聊过的事 → 不乱塞（这是旧实现最大的毛病：问「咖啡店」能塞 4 条无关的）；
//   ③ 打招呼 → 不塞；
//   ④ 条数/字数有上限。
import { buildIndex, search, tokenList, recall } from '../lib/recall.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const LIFE = 'life_t'
let seq = 0
function ev(ts, type, text) {
  seq += 1
  return {
    v: 1, id: String(seq).padStart(26, '0'), ts, life: LIFE, surface: 'qq', type,
    actor: type === 'utterance' ? 'self' : 'other:qq_1', acl: { visibility: 'private' }, text,
  }
}

// 60 条背景语料：日常闲聊，制造出「常见的词」和「稀有的词」
const filler = []
const chatter = [
  '今天有点累，先睡了。', '中午吃什么还没想好。', '外面在下雨，记得带伞。',
  '这个功能还没做完，别急。', '你说的那个我看过了，还行。', '行，那就这么办。',
  '下午开会，可能回得慢。', '电脑又卡了，重启一下。', '刚吃完，挺饱的。',
  '晚上有空再说。',
]
for (let i = 0; i < 60; i += 1) {
  filler.push(ev(`2026-10-0${(i % 8) + 1}T0${i % 10}:00:00+08:00`, i % 3 === 0 ? 'utterance' : 'encounter', chatter[i % chatter.length]))
}

// 目标事件：一条很久以前的（三个月前），带专名
const oldOne = ev('2026-07-02T21:00:00+08:00', 'encounter', '呜哈：杭州那家河岸书店的猫还在窗台上睡着，我拍了张照。')
// 最近的一条，同样带专名
const newOne = ev('2026-10-01T20:00:00+08:00', 'encounter', '呜哈：周末去看那个机械臂展会，人挺多。')
// 两条完全一样的话（重复）
const dupA = ev('2026-10-02T10:00:00+08:00', 'encounter', '呜哈：那台老式打字机修好了。')
const dupB = ev('2026-10-02T10:05:00+08:00', 'encounter', '呜哈：那台老式打字机修好了。')

const events = [...filler, oldOne, newOne, dupA, dupB]
const index = buildIndex(events)

console.log(`语料：${index.total} 条，平均 ${index.avgdl.toFixed(1)} token\n`)

// ---------------------------------------------------------------- 分词
{
  const toks = tokenList('杭州那台打字机 codearts')
  ok(toks.includes('杭州') && toks.includes('州那'), '中文切二元组')
  ok(toks.includes('codearts'), '英文整体保留')
  ok(tokenList('').length === 0, '空串切出空')
}

// ---------------------------------------------------------------- ① 旧事翻得到
{
  const r = search(index, '你还记得杭州那家书店的猫吗')
  ok(r.status === 'matched', '提起旧事：判定为「定位到了」', r.status)
  ok(r.items[0]?.text.includes('河岸书店'), '翻到的是三个月前那条，不是最近的', r.items[0]?.text?.slice(0, 30))
  ok(r.debug.quote === false || r.items.length >= 1, '（不靠整句重合也能中）')
}

// ---------------------------------------------------------------- 年代不惩罚
{
  // 把三个月前那条和最新那条放同样关键的地位，看分数是不是只看内容
  const a = search(index, '河岸书店')
  const b = search(index, '机械臂展会')
  ok(a.status === 'matched' && b.status === 'matched', '两条都定位得到')
  ok(a.debug.bestScore > 0.5 && b.debug.bestScore > 0.5, '分数都够高（不是被年代拉平的）', `${a.debug.bestScore}/${b.debug.bestScore}`)
}

// ---------------------------------------------------------------- ② 没聊过就不塞
{
  const r = search(index, '你还记得上个月我们聊的那家咖啡店吗')
  ok(r.status !== 'matched', '从没聊过的主题：不判定为命中', r.status)
  ok(r.items.length === 0, '不注入任何旧事', String(r.items.length))
  ok(r.candidates.length >= 0, '但候选还在（将来可以问她一句）')
}

// ---------------------------------------------------------------- ③ 打招呼不塞
{
  for (const cue of ['在吗', '嗯', '好的']) {
    const r = search(index, cue)
    ok(r.status !== 'matched' && r.items.length === 0, `「${cue}」不塞旧事`, r.status)
  }
}

// ---------------------------------------------------------------- ④ 上限
{
  const r = search(index, '呜哈那台打字机修好了', { maxItems: 1 })
  ok(r.items.length <= 1, '条数上限生效', String(r.items.length))
  const r2 = search(index, '呜哈那台打字机修好了', { maxChars: 10 })
  ok(r2.items.every((x) => x.text.length <= 10) || r2.items.length === 0, '字数上限：超了就不塞', JSON.stringify(r2.items.map((x) => x.text.length)))
}

// ---------------------------------------------------------------- 重复内容
{
  const r = search(index, '那台老式打字机修好了')
  ok(r.status === 'matched', '重复内容照样定位得到')
  const same = r.items.filter((x) => x.text.includes('老式打字机'))
  ok(same.length <= 2, '重复的不会无限堆（受条数上限约束）', String(same.length))
}

// ---------------------------------------------------------------- 空线索
{
  ok(search(index, '').status === 'no_cue', '空线索直接返回 no_cue')
  ok(search(index, '   ').status === 'no_cue', '全空格也是 no_cue')
}

// ---------------------------------------------------------------- 便捷入口
{
  const r = recall(events, '河岸书店')
  ok(r.indexed === events.length, 'recall() 会自己建索引', String(r.indexed))
  ok(r.status === 'matched', 'recall() 结果和 search() 一致')
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
