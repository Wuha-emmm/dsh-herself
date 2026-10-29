// lib/avatar.mjs —— QQ 头像的取法
//
// 群里/私聊里显示真人头像，比一个汉字色块清楚得多（2026-10-29 主人提的）。
// QQ 头像在腾讯的公开 CDN 上，不需要登录：
//   个人：https://q1.qlogo.cn/g?b=qq&nk=<uin>&s=100
//   群：  https://p.qlogo.cn/gh/<gid>/<gid>/100/
//
// 但**不能让浏览器直接去拉**：页面有 CSP，跨域图片会被拦，且失败时是个破图。
// 所以走插件服务端代理（同源 `/api/avatar`），顺手做磁盘缓存——头像几乎不变，
// 缓存 7 天能省掉绝大多数请求，也避免每次刷新都去打腾讯的 CDN。

/** QQ 号/群号只可能是 5~12 位数字，别的一律不当头像 */
const ID = /^\d{5,12}$/

/**
 * @param {{uin?:string, group?:string}} q
 * @returns {{ok:true, url:string, key:string, kind:'user'|'group'}|{ok:false, error:string}}
 */
export function targetOf(q = {}) {
  const uin = String(q.uin ?? '').trim()
  const group = String(q.group ?? '').trim()
  if (group) {
    if (!ID.test(group)) return { ok: false, error: '群号不合法' }
    return { ok: true, url: `https://p.qlogo.cn/gh/${group}/${group}/100/`, key: `group-${group}`, kind: 'group' }
  }
  if (!uin) return { ok: false, error: '没给 QQ 号' }
  if (!ID.test(uin)) return { ok: false, error: 'QQ 号不合法' }
  return { ok: true, url: `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`, key: `user-${uin}`, kind: 'user' }
}

/** 从面板的会话 key 里抠出该显示谁的头像：qq:private:<uin> / qq:group:<gid> */
export function fromThreadKey(key = '') {
  const m = String(key).match(/^qq:(private|group):(\d{5,12})$/)
  if (!m) return null
  return m[1] === 'group' ? { group: m[2] } : { uin: m[2] }
}

/** 服务端拿到字节后猜类型（qlogo 有时不回 content-type） */
export function sniffImage(buf) {
  if (!buf || buf.length < 8) return ''
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif'
  if (buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return ''
}
