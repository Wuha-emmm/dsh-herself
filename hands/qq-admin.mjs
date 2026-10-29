// hands/qq-admin.mjs —— 她在 QQ 上的「账号级」动作
//
// OneBot 能做的：资料、头像、个签、点赞、在线状态、群设置、表情回应。
// 空间（说说/相册/评论）没有 API，走浏览器，不在这里。
//
// 安全：所有写操作默认要显式调用；CLI 支持 --dry 只打印不执行。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const TOKEN = path.join(HER, 'secrets', 'onebot.token')
const POLICY = path.join(HER, 'secrets', 'qq-policy.json')

function token() {
  try { return fs.readFileSync(TOKEN, 'utf8').trim() } catch { return '' }
}

/** 授权策略：没写的动作默认不允许（fail-closed） */
export function policy() {
  try {
    return JSON.parse(fs.readFileSync(POLICY, 'utf8'))
  } catch {
    return {
      allow: ['get_login_info', 'get_friend_list', 'get_profile_like', 'set_self_longnick', 'send_like', 'set_online_status'],
      deny: ['set_qq_avatar', 'set_qq_profile', 'set_group_kick', 'set_group_ban', 'set_group_leave', 'delete_friend'],
    }
  }
}

function allowed(action) {
  const p = policy()
  if ((p.deny ?? []).includes(action)) return false
  return (p.allow ?? []).includes(action)
}

/** 调一次 OneBot action */
export function qqAction(action, params = {}, { timeoutMs = 12000 } = {}) {
  if (!allowed(action)) return Promise.resolve({ ok: false, error: `policy denies ${action}` })
  return new Promise((resolve) => {
    const t = token()
    const ws = new WebSocket(`ws://127.0.0.1:3001/?access_token=${encodeURIComponent(t)}`)
    const echo = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    let done = false
    const finish = (v) => { if (done) return; done = true; try { ws.close() } catch { /* ignore */ } resolve(v) }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs)
    ws.addEventListener('open', () => {
      try { ws.send(JSON.stringify({ action, params, echo })) } catch (e) { clearTimeout(timer); finish({ ok: false, error: String(e.message) }) }
    })
    ws.addEventListener('message', (e) => {
      try {
        const j = JSON.parse(String(e.data))
        if (j.echo !== echo) return
        clearTimeout(timer)
        finish({ ok: j.status === 'ok' && j.retcode === 0, retcode: j.retcode, data: j.data, message: j.message ?? j.wording })
      } catch { /* ignore */ }
    })
    ws.addEventListener('error', () => { clearTimeout(timer); finish({ ok: false, error: 'ws error' }) })
  })
}

// ---------------------------------------------------------------- 具体动作
export const actions = {
  /** 改个签 */
  longnick: (text) => qqAction('set_self_longnick', { longNick: String(text).slice(0, 60) }),
  /** 改昵称/资料（sex: 0 未知 1 男 2 女） */
  profile: ({ nickname, sex = 0 }) => qqAction('set_qq_profile', { nickname: String(nickname).slice(0, 24), sex }),
  /** 换头像：本地文件绝对路径或 URL */
  avatar: (file) => qqAction('set_qq_avatar', { file }),
  /** 给好友点赞（每人每天最多 10 次，别刷） */
  like: (userId, times = 1) => qqAction('send_like', { user_id: Number(userId), times: Math.max(1, Math.min(10, Number(times) || 1)) }),
  /** 在线状态：1 在线 2 离开 3 隐身 4 忙碌 5 Q我吧 6 请勿打扰 */
  online: (status = 1) => qqAction('set_online_status', { status: Number(status), ext_status: 0, battery_status: 100 }),
  /** 群名片 */
  groupCard: (groupId, userId, card) => qqAction('set_group_card', { group_id: Number(groupId), user_id: Number(userId), card: String(card).slice(0, 30) }),
  /** 群签到 */
  groupSign: (groupId) => qqAction('send_group_sign', { group_id: Number(groupId) }),
  /** 给消息加表情回应（emoji id 例如 128077） */
  emojiLike: (messageId, emojiId = '128077') => qqAction('set_msg_emoji_like', { message_id: Number(messageId), emoji_id: String(emojiId) }),
  /** 只读：我收到的赞 */
  likes: () => qqAction('get_profile_like', {}),
  /** 只读：登录信息 */
  me: () => qqAction('get_login_info', {}),
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const cmd = args.find((a) => !a.startsWith('--'))
  const rest = args.filter((a) => a !== cmd && a !== '--dry')

  const ACT = {
    longnick: () => actions.longnick(rest.join(' ')),
    profile: () => actions.profile({ nickname: rest[0] }),
    avatar: () => actions.avatar(rest[0]),
    like: () => actions.like(rest[0], rest[1] ?? 1),
    online: () => actions.online(rest[0] ?? 1),
    groupcard: () => actions.groupCard(rest[0], rest[1], rest.slice(2).join(' ')),
    groupsign: () => actions.groupSign(rest[0]),
    emoji: () => actions.emojiLike(rest[0], rest[1]),
    likes: () => actions.likes(),
    me: () => actions.me(),
  }

  const fn = ACT[cmd]
  if (!fn) {
    console.log('用法：')
    console.log('  node hands/qq-admin.mjs me                         看登录信息')
    console.log('  node hands/qq-admin.mjs likes                      看收到的赞')
    console.log('  node hands/qq-admin.mjs longnick "新的个签"         改个签')
    console.log('  node hands/qq-admin.mjs like <QQ号> [次数]          给好友点赞')
    console.log('  node hands/qq-admin.mjs online <1-6>               在线状态')
    console.log('  node hands/qq-admin.mjs avatar <图片路径>           换头像（默认被策略拦）')
    console.log('  node hands/qq-admin.mjs profile <昵称>              改昵称（默认被策略拦）')
    console.log('  node hands/qq-admin.mjs groupcard <群> <QQ> <名片>  改群名片')
    console.log('  node hands/qq-admin.mjs groupsign <群>              群签到')
    console.log('  加 --dry 只打印不执行')
    process.exit(0)
  }

  const map = { longnick: 'set_self_longnick', profile: 'set_qq_profile', avatar: 'set_qq_avatar', like: 'send_like', online: 'set_online_status', groupcard: 'set_group_card', groupsign: 'send_group_sign', emoji: 'set_msg_emoji_like', likes: 'get_profile_like', me: 'get_login_info' }
  const action = map[cmd]
  if (!allowed(action)) {
    console.error(`✗ 策略不允许：${action}（想放开就编辑 secrets/qq-policy.json）`)
    process.exit(2)
  }
  if (dry) { console.log(`[dry] ${action}`, JSON.stringify(rest)); process.exit(0) }
  const r = await fn()
  console.log(JSON.stringify(r, null, 2))
}
