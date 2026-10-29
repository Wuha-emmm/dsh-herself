// lib/profile.mjs —— 她自己的资料：头像 / 个性签名 / 昵称
//
// 主人 2026-10-30 03:56：「加上修改QQ头像、个性签名等技能，一样的原则，她可以自己意愿去更换。」
//
// 原则同别的空间写入：**不设审批门、不加频率限制**。
// 但每一条都写 action 事件——不是拦她，是事后能查"谁让她改的、改成什么了"。
import { httpCreds } from './owner.mjs'

const call = async (herRoot, action, params) => {
  const c = httpCreds(herRoot)
  if (!c) return { ok: false, error: '找不到 OneBot 的 HTTP 配置' }
  try {
    const r = await fetch(`${c.base}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json().catch(() => ({}))
    if (j.retcode !== 0) return { ok: false, error: `retcode ${j.retcode}：${j.wording || j.message || ''}` }
    return { ok: true, data: j.data }
  } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
}

/** 现在的资料 */
export async function current(herRoot) {
  const r = await call(herRoot, 'get_login_info', {})
  return r.ok ? { ok: true, nickname: String(r.data?.nickname ?? ''), uin: String(r.data?.user_id ?? '') } : r
}

/** 改个性签名（longNick 严格要 string） */
export async function setSignature(herRoot, text) {
  const t = String(text ?? '').trim()
  if (!t) return { ok: false, error: '签名不能是空的' }
  const r = await call(herRoot, 'set_self_longnick', { longNick: t })
  return r.ok ? { ok: true, value: t } : r
}

/** 改头像：file 可以是本地路径或链接 */
export async function setAvatar(herRoot, file) {
  const f = String(file ?? '').trim()
  if (!f) return { ok: false, error: '要给一张图的路径或链接' }
  const r = await call(herRoot, 'set_qq_avatar', { file: f })
  return r.ok ? { ok: true, file: f } : r
}

/** 改昵称（set_qq_profile 的 nickname 字段） */
export async function setNickname(herRoot, name) {
  const n = String(name ?? '').trim()
  if (!n) return { ok: false, error: '昵称不能是空的' }
  const r = await call(herRoot, 'set_qq_profile', { nickname: n })
  return r.ok ? { ok: true, value: n } : r
}