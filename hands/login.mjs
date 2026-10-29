// hands/login.mjs —— 在专用 Edge profile 里打开某个平台的登录页
// 供设置页按钮 / 命令行调用；不读密码、不碰 cookie、不填表单。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

export const PROFILE = 'E:\\DSH-herself\\profile\\edge'
export const CDP = 'http://127.0.0.1:9222'

export const PLATFORMS = {
  bili: { name: 'B站', url: 'https://www.bilibili.com' },
  qzone: { name: 'QQ空间', url: 'https://user.qzone.qq.com' },
  xhs: { name: '小红书', url: 'https://www.xiaohongshu.com' },
  xhh: { name: '小黑盒', url: 'https://www.xiaoheihe.cn' },
}

async function cdpUp(timeoutMs = 1200) {
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch { return false }
}

export function edgePath() {
  return EDGE_CANDIDATES.find((p) => fs.existsSync(p)) ?? null
}

export async function ensureEdge() {
  if (await cdpUp()) return { ok: true, launched: false }
  const exe = edgePath()
  if (!exe) return { ok: false, launched: false, error: '找不到 msedge.exe' }
  fs.mkdirSync(PROFILE, { recursive: true })
  spawn(exe, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { detached: true, stdio: 'ignore', windowsHide: false }).unref()

  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (await cdpUp()) return { ok: true, launched: true }
    await new Promise((r) => setTimeout(r, 400))
  }
  return { ok: false, launched: true, error: 'Edge 起来了但 CDP 没响应（可能被杀软拦了）' }
}

/** 打开一个新标签页；返回 targetId */
export async function openUrl(url) {
  const r = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`打开标签失败 HTTP ${r.status}`)
  const j = await r.json()
  return { id: j.id, url: j.url ?? url }
}

/** 打开某个平台的登录页 */
export async function openLogin(platform) {
  const p = PLATFORMS[platform]
  if (!p) throw new Error(`未知平台：${platform}（可选 ${Object.keys(PLATFORMS).join('/')}）`)
  const edge = await ensureEdge()
  if (!edge.ok) throw new Error(edge.error ?? 'Edge 不可用')
  const tab = await openUrl(p.url)
  return { ok: true, platform, name: p.name, url: tab.url, tabId: tab.id, launched: edge.launched }
}

/** 当前 profile 里有几个标签、都是什么（给"已打开哪些"用） */
export async function listTabs() {
  try {
    const r = await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(2000) })
    const arr = await r.json()
    return arr.filter((t) => t.type === 'page').map((t) => ({ id: t.id, title: t.title, url: t.url }))
  } catch { return [] }
}

// CLI: node hands/login.mjs bili|qzone|xhs|xhh|list
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2]
  if (cmd === 'list') {
    console.log(JSON.stringify(await listTabs(), null, 2))
  } else if (cmd && PLATFORMS[cmd]) {
    const r = await openLogin(cmd)
    console.log(`${r.launched ? '已启动 Edge，' : ''}已打开 ${r.name}：${r.url}`)
  } else {
    console.log('用法：node hands/login.mjs bili|qzone|xhs|xhh|list')
  }
}
