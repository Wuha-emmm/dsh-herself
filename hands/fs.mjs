// hands/fs.mjs —— 她的「文件」这只手：只在自己的文件夹里，读为主，写受限
//
// 边界（硬编码，不靠配置）：
//   · 只能碰 <repo>\sandbox\，越界一律拒绝
//   · 只认几种扩展名；单文件 256KB
//   · 删除只允许 sandbox 里的文件
//   · 每次操作都写 action 事件（由 think 负责），你能看见她碰了什么
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
export const ROOT = path.join(HER, 'sandbox')
const MAX = 256 * 1024
const TEXT = new Set(['.txt', '.md', '.json', '.csv', '.log'])
const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const EXT = new Set([...TEXT, ...IMG])

function safe(name) {
  const p = path.resolve(ROOT, String(name ?? '').replace(/^[\\/]+/, ''))
  if (!p.startsWith(ROOT + path.sep)) throw new Error('越界：只能访问 sandbox 目录')
  const ext = path.extname(p).toLowerCase()
  if (!EXT.has(ext)) throw new Error(`不允许的文件类型：${ext || '(无扩展名)'}`)
  return p
}

export function ensure() { fs.mkdirSync(ROOT, { recursive: true }) }

export function list() {
  ensure()
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => {
      const st = fs.statSync(path.join(ROOT, d.name))
      return { name: d.name, size: st.size, mtime: st.mtime.toISOString() }
    })
    .slice(0, 200)
}

/** 读文本；图片只回元信息 */
export function read(name) {
  const p = safe(name)
  const st = fs.statSync(p)
  if (st.size > MAX) throw new Error(`文件太大（${st.size} 字节）`)
  if (IMG.has(path.extname(p).toLowerCase())) return { kind: 'image', name: path.basename(p), size: st.size }
  return { kind: 'text', name: path.basename(p), size: st.size, text: fs.readFileSync(p, 'utf8').slice(0, 20000) }
}

/** 写文本（只写文本，不写二进制） */
export function write(name, content) {
  const p = safe(name)
  if (IMG.has(path.extname(p).toLowerCase())) throw new Error('不写二进制文件')
  const text = String(content ?? '')
  if (Buffer.byteLength(text) > MAX) throw new Error('内容太大')
  ensure()
  fs.writeFileSync(p, text, 'utf8')
  return { name: path.basename(p), bytes: Buffer.byteLength(text) }
}

/** 删：只允许 sandbox 里的文件 */
export function remove(name) {
  const p = safe(name)
  if (!fs.existsSync(p)) throw new Error('文件不存在')
  if (fs.statSync(p).isDirectory()) throw new Error('不删目录')
  fs.unlinkSync(p)
  return { deleted: path.basename(p) }
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, name, ...rest] = process.argv.slice(2)
  const out = (x) => console.log(JSON.stringify(x, null, 2))
  if (cmd === 'list') out(list())
  else if (cmd === 'read') out(read(name))
  else if (cmd === 'write') out(write(name, rest.join(' ')))
  else if (cmd === 'rm') out(remove(name))
  else console.log('用法：list | read <文件> | write <文件> "内容" | rm <文件>')
}
