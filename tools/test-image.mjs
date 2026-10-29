import fs from 'node:fs'

const line = fs.readFileSync('logs/qq.out.log', 'utf8').split('\n').filter((l) => l.includes('image seg')).pop() ?? ''
const m = line.match(/"url":"([^"]+)"/)
if (!m) { console.log('日志里没有 url'); process.exit(0) }
const url = m[1]
console.log('url 前 80:', url.slice(0, 80))
try {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const b = Buffer.from(await r.arrayBuffer())
  console.log('status', r.status, 'type', r.headers.get('content-type'), 'bytes', b.length)
} catch (e) {
  console.log('下载失败:', e.message)
}
