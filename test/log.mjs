// test/log.mjs —— 落盘日志的验收
//
// 为什么值一条独立的测试：2026-10-29 两次事故（双 listener、boot.ps1 丢 BOM）
// 都是"静默"的，宿主 console 不落盘，事后没有现场。这一层坏了不会报错，
// 只会在下一次出事时让你重新猜一遍。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'her-log-'))
process.env.DSH_HERSELF_LOG = path.join(dir, 'test.log')

const { log, buildStamp, tailLines, logFile } = await import('../lib/log.mjs')

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

log('boot', 'boot.ps1 非零退出', { force: true, code: 1, out: 'Unexpected token }' })
log('qq', 'listener 启动', { pid: 1234 })

const text = fs.readFileSync(logFile, 'utf8')
ok(/\[boot\] boot\.ps1 非零退出/.test(text), '写进了文件，带 scope')
ok(/Unexpected token/.test(text), '附带的结构化信息也在（解析错误这种现场最重要）')
ok(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[qq\]/m.test(text), '每行都有 ISO 时间戳 + scope')

const lines = tailLines(10)
ok(lines.length === 2, 'tailLines 读得回最近几行', String(lines.length))

ok(/^\d{4}-\d{2}-\d{2}T/.test(buildStamp()), 'buildStamp 给得出代码的出厂时间', buildStamp())

// 日志坏了不能把她也弄坏：指到一个不可能写成功的路径，不许抛
const bad = path.join(dir, 'no-such-dir', '\u0000weird')
try {
  process.env.DSH_HERSELF_LOG = bad
  // FILE 在 import 时已经定死，这里只能验证 log() 本身不抛
  log('qq', '测试不会抛')
  ok(true, 'log() 永不抛（写不进去就安静地不写）')
} catch (e) {
  ok(false, 'log() 永不抛', String(e?.message ?? e))
}

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
