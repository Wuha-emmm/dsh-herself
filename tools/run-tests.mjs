// tools/run-tests.mjs —— 一把梭：跑齐所有测试
//
// 什么时候用 `node --test`：这些是自写的断言脚本（自己打印 ✓/✗），不是 node:test 用例。
//
// 2026-10-29 CI 第一次跑红：6 套是**依赖她本机环境**的集成测试
// （要 DeepSeek key、要她的事件流、要表情库），干净机器上当然跑不了。
// 所以这里显式声明依赖：缺环境就打印「跳过」并计入 skip，不算失败——
// 但**不允许**把真失败伪装成跳过（只有 NEEDS 表里列出的才算）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const filter = String(process.argv[2] ?? '')

/** 这些套件要她的真实环境；文件和目录都是 .gitignore 掉的，CI 里不会有 */
const NEEDS = {
  'gif.mjs': ['secrets/deepseek.key'],        // 看图要走视觉模型
  'net.mjs': ['secrets/deepseek.key'],        // 官方 Search/Fetch 要 key
  'semantic.mjs': ['secrets/deepseek.key'],   // 蒸馏判断要模型
  'trace.mjs': ['secrets/deepseek.key'],      // 翻译/回落要模型
  'people.mjs': ['life/people.json'],         // 认人注册表
  'tools.mjs': ['sandbox/stickers.json'],     // 表情库
}

const files = fs.readdirSync(path.join(root, 'test'))
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort()

let pass = 0
let fail = 0
let skip = 0
const rows = []
for (const f of files) {
  const missing = (NEEDS[f] ?? []).filter((p) => !fs.existsSync(path.join(root, p)))
  if (missing.length) {
    skip += 1
    rows.push({ f, pass: 0, ms: 0, state: `跳过（缺 ${missing.join('、')}）` })
    continue
  }
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [path.join(root, 'test', f)], { encoding: 'utf8', cwd: root })
  const ms = Date.now() - t0
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  // 两种汇总格式：`N 通过 / M 失败` 和 `N / N 全部通过`
  const n1 = (out.match(/(\d+)\s*通过/g) ?? []).reduce((s, x) => s + Number(x.replace(/\D/g, '')), 0)
  const bad = r.status !== 0
  if (bad) fail += 1; else pass += 1
  rows.push({ f, pass: n1, ms, state: bad ? '✗ 失败' : '✓' })
}

const pad = (s, n) => String(s).padEnd(n)
console.log(pad('测试', 20) + pad('断言', 7) + pad('用时', 8) + '结果')
console.log('-'.repeat(52))
for (const r of rows) {
  console.log(pad(r.f, 20) + pad(r.pass || '-', 7) + pad(r.ms ? `${r.ms}ms` : '-', 8) + r.state)
}
console.log('-'.repeat(52))
console.log(`${pass} 套通过 / ${fail} 套失败 / ${skip} 套跳过 ｜ 断言合计 ${rows.reduce((s, r) => s + r.pass, 0)}`)
process.exit(fail ? 1 : 0)