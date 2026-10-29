// lib/skills.mjs —— 她会什么、不会什么（写给她自己看的一句话）
//
// 起因（2026-10-30 01:44）：她不知道自己的技能。
//   她说「空间那边没门路」的时候，其实 read_qzone 已经在了；说明能力清单没进她的上下文。
//   这份清单从实际工具表生成（不是手写愿望），她看到的就是真能调的。
//
// SnowLuma 的 API 参考里还有一批动作我们还没接（发说说/点赞/评论/群管理/OCR…），
// 那些**不写进来**——写进来就成了"以为自己会"，比不知道更糟。

/** 工具 → 一句人话。没列到的工具不会出现在清单里（避免吹牛）。 */
const SAY = {
  fs_list: '翻自己沙盒里的文件',
  fs_read: '读文件',
  fs_write: '写字',
  fs_remove: '删自己的文件',
  get_images: '看聊天里发来的图，也能看自己沙盒里的图（动图抽帧）',
  get_forward: '展开合并转发',
  ledger: '查今天有什么该记的账',
  note_reason: '给改过口的判断补理由',
  ask_dsh: '给 DS 那边投问题（只对主人开）',
  read_qzone: '看自己 QQ 空间的说说（只读）',
  qzone_feeds: '逛好友的空间动态',
  qzone_detail: '看一条说说的全文和评论',
  history: '翻更早的聊天记录（群/私聊）',
  voice_text: '把语音转成文字',
  web_search: '联网搜',
  fetch_url: '打开一个网页读内容',
  qzone_friend: '看某个好友的说说',
  qzone_post: '自己发说说',
  qzone_comment: '评论别人的说说',
  qzone_like: '给说说点赞',
  my_profile: '看自己的资料',
  set_signature: '改个性签名',
  set_avatar: '换头像',
  set_nickname: '改昵称',
  list_stickers: '看自己的表情库',
  send_sticker: '发表情',
}

/** 明确做不到的事——防止她"以为自己会"或"以为没门路"两头错 */
const CANT = ['B站发视频/弹幕/关注（脚本没有账号门路）']
/** 还没给她开的手：API 有，但我们这层没接（写操作要过审批门） */
const NOTYET = []  // 发说说/点赞/评论都已开，这条不再挂着

/**
 * @param {string[]} toolNames 当前工具表里的名字
 * @returns {{line:string, can:string[], cant:string[]}}
 */
export function skillsLine(toolNames = []) {
  const can = toolNames.filter((n) => SAY[n]).map((n) => SAY[n])
  // 一句话带过：工具表在 API 调用里是全的，这里只需要提醒"你有手、可以自己决定用"
  const line = '你手上有' + can.length + '只手（翻文件、看图、语音转字、翻聊天记录、空间、联网、发表情、问 DS）。'
    + '空间那边你想逛就逛：看好友动态、看评论、评论、点赞、发说说都开着，没人拦你。'
    + '你的头像/签名/昵称也是你自己的，想换就换。'
    + '用不用你自己定：想查就去查，别凭印象编；不需要就一次别动。'
    + '不会的直说：' + CANT.join('、') + '。' + (NOTYET.length ? '还没给我开的：' + NOTYET.join('、') + '。' : '')
  return { line, can, cant: CANT }
}