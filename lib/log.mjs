// lib/log.mjs —— 落盘日志：她的现场
//
// 为什么要有这一层：DsH 插件里只有 console.warn，宿主不落盘。
// 2026-10-29 两次事故（两个 listener 同时跑、boot.ps1 丢 BOM 导致巡检静默失败）
// 都是"静默"的——事后连一条现场都没有。日志不落盘，等于每次出事都从零猜。
//
// 规矩：别记密码/密钥；一条一行；超过 4MB 滚一档（只留最近的一档）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const FILE = process.env.DSH_HERSELF_LOG || path.join(HER, 'logs', 'dsh-herself.log')
const MAX_BYTES = 4 * 1024 * 1024

function rotate() {
  try {
    const st = fs.statSync(FILE)
    if (st.size <= MAX_BYTES) return
    try { fs.rmSync(FILE + '.1', { force: true }) } catch { /* ignore */ }
    fs.renameSync(FILE, FILE + '.1')
  } catch { /* 还没有文件 */ }
}

/**
 * 记一行。永远不抛——日志坏了不能把她也弄坏。
 * @param {string} scope 'boot' | 'qq' | 'plugin' | 'vision' | …
 * @param {string} msg
 * @param {object} [extra] 结构化补充（别放密钥）
 */
export function log(scope, msg, extra) {
  const at = new Date().toISOString()
  let tail = ''
  if (extra && typeof extra === 'object') {
    try { tail = ' ' + JSON.stringify(extra).slice(0, 600) } catch { tail = '' }
  }
  const line = `${at} [${scope}] ${msg}${tail}`
  try { console.log(`[${scope}] ${msg}`) } catch { /* ignore */ }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    rotate()
    fs.appendFileSync(FILE, line + '\n', 'utf8')
  } catch { /* ignore */ }
  return line
}

/**
 * 这一份代码的「出厂时间」＝ lib/ hands/ 里最新的修改时间。
 * 用来判断"跑着的进程是不是旧代码"——不重启就改代码时最容易踩这个。
 */
export function buildStamp() {
  let newest = 0
  for (const dir of ['lib', 'hands']) {
    try {
      for (const f of fs.readdirSync(path.join(HER, dir))) {
        if (!/\.(mjs|js)$/.test(f)) continue
        const t = fs.statSync(path.join(HER, dir, f)).mtimeMs
        if (t > newest) newest = t
      }
    } catch { /* ignore */ }
  }
  return newest ? new Date(newest).toISOString() : ''
}

/** 读最近 n 行（面板/排查用） */
export function tailLines(n = 50) {
  try {
    const text = fs.readFileSync(FILE, 'utf8')
    const lines = text.split('\n').filter(Boolean)
    return lines.slice(-n)
  } catch {
    return []
  }
}

export const logFile = FILE
