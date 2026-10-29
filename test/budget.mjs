// test/budget.mjs —— 事实预算：先定配额，再决定塞什么
//
// 2026-10-29：factsOf 一个人管 8 类事实，每轮 500~576 tok，靠的是"没加太多"而不是"有配额"。
// 这一层要保证：超预算时按优先级丢，而不是让"最近"被挤掉。
import { estimateTokens, fitBudget, PRIO } from '../lib/budget.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 估算
{
  ok(estimateTokens('今天好累') === 4, '中文 1 字 1 token', String(estimateTokens('今天好累')))
  ok(estimateTokens('abcdefgh') === 2, '英文 4 字符 1 token', String(estimateTokens('abcdefgh')))
  ok(estimateTokens('') === 0, '空串是 0')
}

// ---------------------------------------------------------------- 不超预算
{
  const facts = [
    { prio: PRIO.CORE, text: '这是你存在的第 1 天。现在是 10 月 29 日晚上 9 点。' },
    { prio: PRIO.RECENT, text: '最近：' + '他说的某句话。'.repeat(30) },
    { prio: PRIO.JUDGE, text: '判断：' + '「某条判断」。'.repeat(10) },
    { prio: PRIO.PEOPLE, text: '群里见过的：A（12 次）、B（8 次）' },
  ]
  for (const budget of [120, 250, 600]) {
    const r = fitBudget(facts, { budget })
    ok(r.used <= budget, `预算 ${budget}：实际没超`, `${r.used} > ${budget}`)
  }
}

// ---------------------------------------------------------------- 先丢低优先级
{
  // 用"条数多、每条都不长"来触发丢弃分支（单条太长会走截断，不丢）
  const facts = [
    { prio: PRIO.CORE, text: '核心' },
    { prio: PRIO.RECENT, text: '最近一句话' },
    { prio: PRIO.JUDGE, text: '一条判断' },
    { prio: PRIO.PEOPLE, text: '群里见过的 ABC' },
    { prio: PRIO.NARRATIVE, text: '一段叙事' },
  ]
  const r = fitBudget(facts, { budget: 12 })
  ok(!r.dropped.some((f) => f.prio === PRIO.CORE), '核心永不丢')
  ok(r.dropped.some((f) => f.prio === PRIO.NARRATIVE), '预算紧时先丢最低优先级', JSON.stringify(r.dropped.map((f) => f.prio)))
  ok(r.kept.some((f) => f.prio === PRIO.RECENT), '最近活下来了（它比叙事重要）', JSON.stringify(r.kept.map((f) => f.prio)))
}

// ---------------------------------------------------------------- 长的截断，不整条丢
{
  const facts = [
    { prio: PRIO.CORE, text: '核心' },
    { prio: PRIO.RECENT, text: '最近：' + '这句话很长。'.repeat(60) },
  ]
  const r = fitBudget(facts, { budget: 200 })
  ok(r.kept.some((f) => f.prio === PRIO.RECENT), '太长时截断保留，而不是整条丢掉')
  ok(r.kept.find((f) => f.prio === PRIO.RECENT).text.endsWith('…'), '截断有标记', r.kept[1]?.text?.slice(-8))
  ok(r.used <= 200, '截断后也没超预算', String(r.used))
}

// ---------------------------------------------------------------- 顺序不乱
{
  const facts = [
    { prio: PRIO.NARRATIVE, text: '最后一条' },
    { prio: PRIO.CORE, text: '第一条' },
    { prio: PRIO.RECENT, text: '第二条' },
  ]
  const r = fitBudget(facts, { budget: 999 })
  ok(r.kept.map((f) => f.text).join(',') === '最后一条,第一条,第二条', '保留原来的顺序（读起来连贯）', r.kept.map((f) => f.text).join(','))
}

// ---------------------------------------------------------------- 真实调用
{
  const { readEvents } = await import('../lib/store.mjs')
  const { factsOf, FACT_BUDGET } = await import('../lib/think.mjs')
  const fs = await import('node:fs')
  const root = 'E:/DSH-herself/life'
  if (fs.existsSync(root + '/events.jsonl')) {
    const ev = readEvents(root)
    const r = factsOf(ev, Date.now(), '', 'qq:private:10001')
    ok(r.budget.used <= FACT_BUDGET, '她的真实一轮在预算内', `${r.budget.used}/${FACT_BUDGET}`)
    ok(r.out.length >= 3, '至少留下核心 + 最近 + 判断', String(r.out.length))
    ok(r.out[0].includes('第 1 天'), '第一行永远是"第几天"')
  } else {
    ok(true, '（这台机器上没有她的生活目录，跳过）')
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
