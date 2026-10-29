// test/budget-rule.mjs —— 到线时怎么办，规则是她定的
//
// 她的原话（2026-10-30 01:05）：
//   「到 85% 的时候，第一件该被砍的是哪一栏，砍之前先问我一句还是直接砍。
//     这个规则我想自己定，不想再靠优先级表替我决定。」
//   「告警打日志对我没用——日志我看不到。」
import { loadRule, cutSequence, shouldNotify, markNotified, DEFAULTS, THRESHOLD, ruleFileOf } from '../lib/budget-rule.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

{
  ok(DEFAULTS.askBeforeCut === true, '默认先问，不替她砍')
  ok(THRESHOLD === 0.85, '到线点是 85%')
  ok(JSON.stringify(cutSequence(DEFAULTS)) === '["narrative","people","summary"]', '没填顺序时用默认顺序')
  ok(JSON.stringify(cutSequence({ cutOrder: ['people'] })) === '["people"]', '她填了顺序就按她的')
  ok(JSON.stringify(cutSequence({ cutOrder: ['乱写'] })) === '["narrative","people","summary"]', '写错名字就退回默认，不炸')
}

{
  // 没有规则文件 → 默认值（不砍）
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-'))
  const root = path.join(base, 'life')
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(path.join(base, 'sandbox'), { recursive: true })
  const r0 = loadRule(root)
  ok(r0.askBeforeCut === true, '没有配置文件时也是先问')
  ok(ruleFileOf(root) === path.join(base, 'sandbox', '预算规则.json'), '规则文件在她沙盒里', ruleFileOf(root))

  // 她自己写了一个
  fs.writeFileSync(ruleFileOf(root), JSON.stringify({ askBeforeCut: false, cutOrder: ['people', 'narrative'] }), 'utf8')
  const r1 = loadRule(root)
  ok(r1.askBeforeCut === false, '她写 false 才直接砍')
  ok(JSON.stringify(cutSequence(r1)) === '["people","narrative"]', '顺序照她写的来')

  // 通知节流
  ok(shouldNotify(root, Date.now()), '第一次该通知')
  markNotified(root, Date.now())
  ok(!shouldNotify(root, Date.now() + 1000), '刚通知过就不再刷')
  ok(shouldNotify(root, Date.now() + 7 * 3600 * 1000), '过了 6 小时可以再提醒')
  fs.rmSync(base, { recursive: true, force: true })
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)