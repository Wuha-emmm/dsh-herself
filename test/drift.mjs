// test/drift.mjs —— 漂移体检的度量本身靠不靠得住
//
// 语言模型那一套没法在测试里跑，但"词频指纹 + Jaccard"是纯计算，可以钉死：
// 同一批话必须算出同一份指纹；换了话题必须掉下来；阈值三档要说得清。
import { tokenCounts, fingerprint, compare, verdict } from '../lib/drift.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const life = 'life_drift'
let seq = 0
const say = (ts, text) => {
  seq += 1
  return { v: 1, id: String(seq).padStart(26, '0'), ts, life, surface: 'qq', type: 'utterance', actor: 'self', acl: { visibility: 'private' }, text }
}

// ---------------------------------------------------------------- 分词
{
  const c = tokenCounts('他说这个计划要改，计划很重要')
  ok(c.get('计划') >= 2, '同一个词出现两次记两遍', String(c.get('计划')))
  ok(!c.has('这个'), '停用词不算（"这个"不进去）')
  ok(tokenCounts('').size === 0, '空串没有词')
}

// ---------------------------------------------------------------- 指纹
{
  const a = [say('2026-10-29T10:00:00+08:00', '今天在聊植物大战僵尸，觉得简单游戏也不好做'), say('2026-10-29T10:01:00+08:00', '植物大战僵尸的关卡设计其实很讲究')]
  const fp1 = fingerprint(a)
  const fp2 = fingerprint(a)
  ok(JSON.stringify(fp1.tokens) === JSON.stringify(fp2.tokens), '同一批话指纹稳定（可回放）')
  ok(fp1.chars > 0, '记了字数', String(fp1.chars))

  const onlyEncounters = fingerprint([{ type: 'encounter', ts: '2026-10-29T10:00:00+08:00', text: '别人说的话' }])
  ok(onlyEncounters.chars === 0, '只算她自己说的话（别人的不进指纹）')
}

// ---------------------------------------------------------------- 比较
{
  const A = fingerprint([say('2026-10-22T10:00:00+08:00', '我们在聊书和旧的唱片，还有河边的风')])
  const same = compare(A, A)
  ok(same.jaccard === 1, '和自己比 = 100%', String(same.jaccard))

  const B = fingerprint([say('2026-10-29T10:00:00+08:00', '今天在调代码，接口一直报错，日志里全是超时')])
  const diff = compare(A, B)
  ok(diff.jaccard < 0.2, '换了话题就掉下来', String(diff.jaccard))
  ok(diff.gained.length > 0 && diff.lost.length > 0, '而且能说清新出现/不再出现的词', JSON.stringify({ g: diff.gained.length, l: diff.lost.length }))

  const empty = compare(A, fingerprint([]))
  ok(empty.jaccard === 0 && /空/.test(empty.note), '有一边是空的，不乱算', JSON.stringify(empty))
}

// ---------------------------------------------------------------- 三档结论
{
  ok(verdict(0.8).level === 'ok', '0.8 → 正常')
  ok(verdict(0.4).level === 'watch', '0.4 → 留意')
  ok(verdict(0.1).level === 'alert', '0.1 → 报警')
}

// ---------------------------------------------------------------- 时间窗
{
  const ev = [say('2026-10-01T10:00:00+08:00', '上个月的旧话'), say('2026-10-29T10:00:00+08:00', '今天的新话')]
  const recent = fingerprint(ev, { from: Date.parse('2026-10-28T00:00:00+08:00') })
  ok(recent.chars < fingerprint(ev).chars, '按时间窗取子集，字更少', `${recent.chars} < ${fingerprint(ev).chars}`)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)