// lib/revision.mjs —— 改口理由：她自己填，我们不猜
//
// 她的原话（2026-10-29）：
//   「理由别让模型替我总结。它写的『因为发现更准了』和我自己认的『因为我错了』
//     不是一回事，前者是推测，后者是承认。划线旁边如果摆的是推测，那条线就成了装饰。
//     理由这一栏我自己填，填不上就留空——空着比编一条强。」
//
// 所以这里只提供两件事：
//   · 一个空槽：被顶掉的判断默认没有理由（不是"AI 推测的理由"）；
//   · 一条通道：她自己用 note_reason 写进去，写的就是她的话，一个字不改。
import fs from 'node:fs'
import { appendEvent, readEvents } from './store.mjs'

const KEY = 'revision-reason'

/**
 * 她填理由。append-only：不覆盖、不改写，多次填就多条，取最后一条。
 * @param {string} root life 根
 * @param {string} claimId 被顶掉的那条判断
 * @param {string} text 她自己的话（不润色、不压缩）
 */
export function recordReason(root, claimId, text) {
  const t = String(text ?? '').trim()
  const has = readEvents(root).some((e) => e.id === claimId)
  if (!has) throw new Error('找不到这条判断（id 不对？）：' + claimId)
  if (!claimId || !t) throw new Error('要填理由，得说清是哪条判断、理由是什么')
  return appendEvent(root, {
    type: 'meta',
    actor: 'self',
    surface: 'dsh',
    text: t.slice(0, 300),
    refs: [claimId],
    meta: { key: KEY, value: { claimId } },
  })
}

/**
 * 读某条判断的理由。没填过就返回空串——**不编**。
 * @returns {string}
 */
export function reasonOf(events, claimId) {
  let out = ''
  for (const e of events) {
    if (e.type !== 'meta' || e.meta?.key !== KEY) continue
    if (e.meta?.value?.claimId !== claimId) continue
    out = String(e.text ?? '')
  }
  return out
}

/** 一次读盘版本，给面板/工具用 */
export function reasonOfIn(root, claimId) {
  return reasonOf(readEvents(root), claimId)
}

/** 有没有人给她塞过"自动生成的理由"——体检用，必须是 0 */
export function autoReasons(root) {
  return readEvents(root).filter((e) => e.type === 'meta' && e.meta?.key === KEY && e.actor !== 'self')
}