// lib/summary.mjs —— 情景记忆：一段话冷下来，让她自己写一句「我们聊到哪」
//
// 不是让别人替她总结——是她回看自己的对话，用自己的口吻写。
// 摘要只做导航：以后要翻原话时，先看摘要决定翻哪段。
import { readEvents, appendEvent } from './store.mjs'
import { liveEvents } from './derive.mjs'
import { brief, threadOf, indexById } from './think.mjs'

const CONTENT = new Set(['encounter', 'utterance'])

/**
 * 给冷下来的线程写摘要。
 * @param {string} root
 * @param {{idleMs?:number, now?:number, maxThreads?:number}} opts
 */
export async function maybeClose(root, { idleMs = 20 * 60 * 1000, now = Date.now(), maxThreads = 2 } = {}) {
  const ev = liveEvents(readEvents(root))
  // 和她说话时同一套认线方式：她自己的回复要靠 refs 找回线程，
  // 不然摘要里只有对方的话（2026-10-29 实测）。
  const byId = indexById(ev)
  const lastByThread = new Map()
  for (const e of ev) {
    if (!CONTENT.has(e.type)) continue
    const th = threadOf(e, byId)
    lastByThread.set(th, e)
  }

  let closed = 0
  for (const [thread, last] of lastByThread) {
    if (closed >= maxThreads) break
    if (now - Date.parse(last.ts) < idleMs) continue
    const already = ev.some((e) => e.type === 'summary' && e.meta?.thread === thread && Date.parse(e.ts) >= Date.parse(last.ts))
    if (already) continue

    const recent = ev.filter((e) => CONTENT.has(e.type) && threadOf(e, byId) === thread).slice(-12)
    const log = recent.map((e) => (e.type === 'utterance' ? '你：' : '他：') + String(e.text).slice(0, 80)).join('\n')
    try {
      const text = await brief({
        system: '你在回看刚才那段对话。用你自己的口吻写两句：我们聊到哪了，下次该怎么接。不要写成报告，不要客套，不要编号。',
        user: log,
        maxTokens: 160,
        temperature: 0.9,
      })
      if (!text) continue
      appendEvent(root, {
        type: 'summary',
        actor: 'self',
        surface: thread.split(':')[0],
        text: text.slice(0, 300),
        refs: recent.map((e) => e.id).slice(-3),
        meta: { thread, lastId: last.id },
      })
      closed += 1
    } catch { /* 模型不可用就算了，下次再收 */ }
  }
  return closed
}
