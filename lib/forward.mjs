// lib/forward.mjs —— 把「合并转发」那段记录读成她看得懂的一串话
//
// 2026-10-29 群 935190036 的实测：她只会看到「[转发]」这个标记，展开是空的。
// 两个原因：
//   ① 转发 id 只在**当前这条消息**里找。那条转发发出去之后隔了好几句别人才 @ 她，
//      这时 ctx.forwardId 是空的 → get_forward_msg('') 当然什么都没有。
//   ② 旧实现只把 text 段拼起来：图片、视频、嵌套的转发全被丢掉，
//      纯图那几条只剩一个「某人：」。
//
// 这里只做**纯渲染**（不碰网络）：把 OneBot 的 messages 数组变成一个节点列表 +
// 一行一行的话，并顺手把里面的图片 URL 收集出来（要不要真的去看图由上层决定）。
// 可回放、可测。

const MAX_TEXT = 90

/**
 * 一条消息的段里有没有转发，有就返回它的 id。
 * 两个地方都要用：别人**直接发**的转发、以及别人**引用**了一条转发
 * （2026-10-29 群 935190036 就是后者——自己那条消息里根本没有 forward 段）。
 */
export function forwardIdIn(segs) {
  if (!Array.isArray(segs)) return ''
  const f = segs.find((s) => s?.type === 'forward')
  return String(f?.data?.id ?? '')
}

function segsOf(node) {
  return Array.isArray(node?.message) ? node.message : []
}

function whoOf(node) {
  const s = node?.sender ?? {}
  return String(s.card || s.nickname || node?.nickname || s.user_id || '某人')
}

function textOfNode(node) {
  return segsOf(node)
    .filter((s) => s.type === 'text')
    .map((s) => String(s.data?.text ?? ''))
    .join('')
}

function imageUrlOf(seg) {
  const u = String(seg?.data?.url ?? seg?.data?.file ?? '')
  return u.startsWith('http') ? u : ''
}

/**
 * 一条转发记录 → 可读的几行。
 * @param {object[]} nodes OneBot get_forward_msg 返回的 messages
 * @param {{maxNodes?:number, depth?:number, maxDepth?:number}} opts
 * @returns {{lines:string[], images:Array<{url:string,who:string,line:number}>, total:number, truncated:boolean}}
 */
export function renderForwardNodes(nodes = [], { maxNodes = 60, depth = 0, maxDepth = 2 } = {}) {
  const lines = []
  const images = []
  const pad = '  '.repeat(depth)
  let used = 0
  let truncated = false

  for (const node of nodes) {
    if (used >= maxNodes) { truncated = true; break }
    used += 1

    const who = whoOf(node)
    const segs = segsOf(node)
    const text = textOfNode(node).replace(/\s+/g, ' ').trim()
    const marks = []
    let imgs = 0
    let videos = 0
    let nested = null
    let others = new Set()

    for (const s of segs) {
      if (s.type === 'image') {
        imgs += 1
        const u = imageUrlOf(s)
        if (u) images.push({ url: u, who, line: lines.length + 1 })
        if (String(s.data?.summary ?? '').includes('动画')) marks.push('动图')
      } else if (s.type === 'video') {
        videos += 1
      } else if (s.type === 'record') {
        others.add('语音')
      } else if (s.type === 'file') {
        others.add('文件')
      } else if (s.type === 'json' || s.type === 'xml') {
        others.add('卡片')
      } else if (s.type === 'mface') {
        others.add('表情')
      } else if (s.type === 'forward') {
        nested = s
      }
    }

    if (imgs) marks.unshift(`图片×${imgs}`)
    if (videos) marks.unshift(`视频×${videos}`)
    for (const o of others) marks.push(o)

    const tail = marks.length ? `［${marks.join('・')}］` : ''
    const head = `${pad}${who}：`
    if (text) lines.push(`${head}${text.slice(0, MAX_TEXT)}${tail}`)
    else if (tail) lines.push(`${head}${tail}`)
    else lines.push(`${head}（空）`)

    // 嵌套转发：再往下读一层（最多 maxDepth 层，防止无限套娃）
    if (nested && depth < maxDepth) {
      const inner = nested?.data?.content
      if (Array.isArray(inner) && inner.length) {
        lines.push(`${pad}  └ 里面还有一段转发：`)
        const sub = renderForwardNodes(inner, { maxNodes: maxNodes - used, depth: depth + 1, maxDepth })
        lines.push(...sub.lines)
        for (const im of sub.images) images.push(im)
        used += sub.total
        if (sub.truncated) truncated = true
      } else {
        lines.push(`${pad}  └ 里面还有一段转发（这层没展开：接口没回内容）`)
      }
    } else if (nested) {
      lines.push(`${pad}  └ 里面还有一段转发（太深了，没再往下读）`)
    }
  }

  return { lines, images, total: used, truncated }
}
