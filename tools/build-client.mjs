// tools/build-client.mjs —— 把 plugin/src/parts/*.js 拼成 plugin/lib/client.js
//
// 为什么要拼：`client.js` 不是 ESM，它走宿主的 `window.__ModuleLoader__.load({ factory })`。
// 所以不能用 import 拆文件——拆了宿主也认不了。唯一安全的路子是：
//   源码按段拆在 plugin/src/parts/ 里（人看的是这些），构建时按顺序拼回一个文件。
//
// 规矩：
//   1. 拼出来的必须和 `git show HEAD:plugin/lib/client.js` 逐字节一致才允许提交；
//   2. 段文件按名字排序（01-… / 02-…），顺序就是拼接顺序；
//   3. 任何一段都可以单独看、单独测——这就是拆的意义。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const HER = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..')
const SRC = path.join(HER, 'plugin', 'src', 'parts')
const OUT = path.join(HER, 'plugin', 'lib', 'client.js')

const parts = fs.existsSync(SRC)
  ? fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort()
  : []
if (!parts.length) {
  console.error('没有 plugin/src/parts/*.js，先跑一次拆分：node tools/build-client.mjs --split')
  process.exit(1)
}

const body = parts.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('')
fs.writeFileSync(OUT, body, 'utf8')
console.log(`拼好：${parts.length} 段 → plugin/lib/client.js（${body.length} 字符）`)
if (process.argv.includes('--check')) {
  // 和 HEAD 里的版本比：不一致说明有人手改了生成文件，或者忘了重新拼
  let head = ''
  try { head = execFileSync('git', ['show', 'HEAD:plugin/lib/client.js'], { cwd: HER, encoding: 'utf8' }) } catch { /* 第一次 */ }
  if (head && head !== body) {
    console.error('✗ 生成的 client.js 和 HEAD 不一致：改代码请改 plugin/src/parts/，再跑一次本脚本')
    process.exit(2)
  }
  console.log('✓ 和 HEAD 一致')
}
