// hands/bili.mjs —— 她的第一只眼睛：B站只读
// 只用公开接口，不带 cookie，不登录，不写任何账号动作。
// 用法：
//   node hands/bili.mjs popular [--limit 5] [--record]
//   node hands/bili.mjs video BV1xx411c7mD [--record]
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { appendEvent } from '../lib/store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.join(here, '..', 'life')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function api(url, { timeoutMs = 10000 } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  if (j.code !== 0) throw new Error(`bili ${j.code}: ${j.message ?? ''}`)
  return j.data
}

function fmtCount(n) {
  const v = Number(n) || 0
  if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿'
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '万'
  return String(v)
}

function cleanTitle(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').trim()
}

export async function popular(ps = 5) {
  const d = await api(`https://api.bilibili.com/x/web-interface/popular?ps=${Math.min(50, ps)}&pn=1`)
  return (d.list ?? []).map((v) => ({
    bvid: v.bvid,
    title: cleanTitle(v.title),
    up: v.owner?.name ?? '',
    duration: v.duration,
    view: v.stat?.view,
    like: v.stat?.like,
    desc: String(v.desc ?? '').slice(0, 120),
  }))
}

export async function video(bvid) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('BV 号格式不对')
  const d = await api(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
  return {
    bvid: d.bvid,
    title: cleanTitle(d.title),
    up: d.owner?.name ?? '',
    duration: d.duration,
    view: d.stat?.view,
    like: d.stat?.like,
    desc: String(d.desc ?? '').slice(0, 200),
    pubdate: d.pubdate,
  }
}

/** 把一条视频写成她的一次「看见」 */
export function recordEncounter(root, v) {
  const mins = Math.round((Number(v.duration) || 0) / 60)
  const text = `在 B 站看到《${v.title}》，UP 主是 ${v.up}，${mins} 分钟，${fmtCount(v.view)} 播放。${v.desc ? '简介：' + v.desc : ''}`
  return appendEvent(root, {
    type: 'encounter',
    actor: 'system',
    surface: 'bili',
    text: text.slice(0, 900),
    meta: { bvid: v.bvid, kind: 'bili-popular' },
  })
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const cmd = args[0]
  const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
  const root = path.resolve(arg('--root', DEFAULT_ROOT))
  const record = args.includes('--record')

  if (cmd === 'popular') {
    const limit = Number(arg('--limit', '5'))
    const list = await popular(limit)
    for (const v of list) {
      console.log(`- ${v.title}\n  ${v.up} · ${fmtCount(v.view)} 播放 · ${v.bvid}`)
      if (record) { recordEncounter(root, v); }
    }
    if (record) console.log(`\n已记下 ${list.length} 次「看见」→ ${root}`)
  } else if (cmd === 'video') {
    const bvid = args[1]
    if (!bvid) { console.error('用法：node hands/bili.mjs video BV号'); process.exit(2) }
    const v = await video(bvid)
    console.log(`- ${v.title}\n  ${v.up} · ${fmtCount(v.view)} 播放 · ${v.desc}`)
    if (record) { recordEncounter(root, v); console.log('已记下一次「看见」') }
  } else {
    console.log('用法：')
    console.log('  node hands/bili.mjs popular [--limit 5] [--record]')
    console.log('  node hands/bili.mjs video BV1xx411c7mD [--record]')
  }
}
