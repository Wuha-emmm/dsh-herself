// tools/run-tests.mjs —— 一把梭：跑齐所有测试，最后给一张表
//
// 为什么不用 `node --test`：这些测试是自写的断言脚本（每套自己打印 ✓/✗），
// 不是 node:test 的用例，`node --test` 只会把它们当普通文件跑、拿不到汇总。
//
// 用法：
//   node tools/run-tests.mjs            # 全跑
//   node tools/run-tests.mjs budget     # 只跑名字里带 budget 的
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const filter = String(process.argv[2] ?? '')
const files = fs.readdirSync(path.join(root, 'test'))
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort()

let ok = 0
let bad = 0
const rows = []
for (const f of files) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [path.join(root, 'test', f)], { encoding: 'utf8' })
  const ms = Date.now() - t0
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const pass = (out.match(/(\d+)\s*通过/g) ?? []).reduce((s, x) => s + Number(x.replace(/\D/g, '')), 0)
  const failed = r.status !== 0
  if (failed) bad += 1; else ok += 1
  rows.push({ f, pass, failed, ms })
}

const pad = (s, n) => String(s).padEnd(n)
console.log(pad('测试', 22) + pad('断言', 8) + pad('用时', 8) + '结果')
console.log('-'.repeat(48))
for (const r of rows) {
  console.log(pad(r.f, 22) + pad(r.pass, 8) + pad(r.ms + 'ms', 8) + (r.failed ? '✗ 失败' : '✓'))
}
console.log('-'.repeat(48))
console.log(`${ok} 套通过 / ${bad} 套失败 ｜ 断言合计 ${rows.reduce((s, r) => s + r.pass, 0)}`)
process.exit(bad ? 1 : 0)