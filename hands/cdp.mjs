// hands/cdp.mjs —— 极简 CDP 客户端：开标签页、执行 JS、截图
// 只依赖 Node 自带的 WebSocket 与 fetch，不装 playwright。

const CDP = 'http://127.0.0.1:9222'

export async function cdpVersion() {
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1500) })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** 新开一个标签页 */
export async function newTab(url = 'about:blank') {
  const r = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT', signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`开标签页失败 HTTP ${r.status}`)
  return r.json()
}

export async function closeTab(id) {
  try { await fetch(`${CDP}/json/close/${id}`, { method: 'PUT', signal: AbortSignal.timeout(3000) }) } catch { /* ignore */ }
}

/** 连到一个 page target */
export async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('CDP 连接超时')), 5000)
    ws.addEventListener('open', () => { clearTimeout(t); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('CDP 连接失败')) }, { once: true })
  })

  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    let msg = null
    try { msg = JSON.parse(String(e.data)) } catch { return }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id)
      clearTimeout(timer)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message ?? 'CDP error'))
      else resolve(msg.result)
    }
  })

  const call = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} 超时`)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try { ws.send(JSON.stringify({ id, method, params })) } catch (err) { clearTimeout(timer); reject(err) }
  })

  const close = () => { try { ws.close() } catch { /* ignore */ } }
  return { call, close }
}

/** 执行 JS，返回可序列化结果 */
export async function evaluate(call, expression, { awaitPromise = true } = {}) {
  const r = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '页面脚本异常')
  return r.result?.value
}

/** 等某个条件为真 */
export async function waitFor(call, expression, timeoutMs = 8000, stepMs = 250) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try { if (await evaluate(call, `Boolean(${expression})`)) return true } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}

/** 截图，返回 png 路径 */
export async function screenshot(call, file) {
  const r = await call('Page.captureScreenshot', { format: 'png' }, 15000)
  const buf = Buffer.from(r.data, 'base64')
  const fs = await import('node:fs')
  fs.writeFileSync(file, buf)
  return file
}
