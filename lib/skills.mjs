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
  web_search: '联网搜',
  fetch_url: '打开一个网页读内容',
  list_stickers: '看自己的表情库',
  send_sticker: '发表情',
}

/** 明确做不到的事——防止她"以为自己会"或"以为没门路"两头错 */
const CANT = ['发说说', '点赞', '评论', '发视频', '弹幕', '关注 B 站账号']

/**
 * @param {string[]} toolNames 当前工具表里的名字
 * @returns {{line:string, can:string[], cant:string[]}}
 */
export function skillsLine(toolNames = []) {
  const can = toolNames.filter((n) => SAY[n]).map((n) => SAY[n])
  const brief = [
    '沙盒文件（翻/读/写/删）',
    '看图（含动图抽帧）',
    '展开转发',
    '查账本',
    '补改口理由',
    '问 DS（仅主人）',
    '读自己的空间（只读）',
    '联网搜/读网页',
    '表情库与发表情',
  ].filter((x, i) => i < can.length)
  const line = `你会：${brief.join('、')}。不会：${CANT.join('、')}；问起就直说不会。`
  return { line, can, cant: CANT }
}