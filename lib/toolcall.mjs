// lib/toolcall.mjs —— 工具循环：她自己决定调什么，我们只负责执行
//
// 这一层做完，"她能自己动手"才成立；否则永远是我们替她伸手。
// 依赖：文字已直连 DeepSeek（支持 function calling）。
//
// 2026-10-29：看图、发表情接进循环。这两件事以前写在 hands/qq.mjs 的关键词特判里
// （我们猜她"大概想看"），现在由她自己伸手；猜错就不做，比猜错乱做强。
//
// ctx 是她的两只手伸出去的地方：
//   ctx.message  原始 OneBot 消息段 —— get_images 从这里取图
//   ctx.send(s)  往当前会话发一个表情 —— send_sticker 的出口
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { list as fsList, read as fsRead, write as fsWrite, remove as fsRemove } from '../hands/fs.mjs'
import { runTool } from './tools.mjs'
import { describe } from './vision.mjs'
import { fetchPage, searchWeb } from './net.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const KEY_FILE = path.join(here, '..', 'secrets', 'deepseek.key')
const API = 'https://api.deepseek.com/chat/completions'

/** 一次最多看几张：看图和说话共用一条时间预算 */
const MAX_LOOK = 3

function key() {
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim() } catch { return '' }
}

function obj(props = {}, required = []) {
  return { type: 'object', properties: props, ...(required.length ? { required } : {}) }
}

/** 注册给她调用的工具（JSON Schema） */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fs_list',
      description: '列出你自己文件夹（sandbox）里的文件',
      parameters: obj(),
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs_read',
      description: '读 sandbox 里的一个文本文件',
      parameters: obj({ name: { type: 'string', description: '文件名，如 hello.md' } }, ['name']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs_write',
      description: '在 sandbox 里写一个文本文件（便签、笔记）。只写文本，单文件 256KB',
      parameters: obj({
        name: { type: 'string', description: '文件名，如 note.md；不填自动起名' },
        content: { type: 'string', description: '要写的内容' },
      }, ['content']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs_remove',
      description: '删掉 sandbox 里的一个文件',
      parameters: obj({ name: { type: 'string', description: '文件名' } }, ['name']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_images',
      description: '看这条消息里的图片。别人发了图、问你图里是什么、要看截图或表情内容时调用',
      parameters: obj({ count: { type: 'integer', description: '看几张，1-3，默认 1' }, path: { type: 'string', description: '你自己沙盒里的图片文件名（如 reply.png）。不填就看聊天里发来的图。' } }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_forward',
      description: '展开这条会话里的合并转发（别人转给你的一段聊天记录），看里面谁说了什么。'
        + '文字会直接读出来；图片/视频/语音会标出来；里面套着的转发也会往下读一层。'
        + '如果里面提到图、你想看，再加一次 images（最多 2 张）。',
      parameters: obj({
        images: { type: 'integer', description: '顺便看几张里面的图，0-2，默认 0（不看）' },
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'ledger',
      description: '看你今天有什么「该记一笔」的：答应过但没了的、改口了的、说了要睡又没睡的。'
        + '想记的时候才调；不调就什么都不会提，也不会催你。',
      parameters: obj(),
    },
  },
  {
    type: 'function',
    function: {
      name: 'note_reason',
      description: '给一条你改过口的判断补理由——写你当时自己认的那句话，不要润色、不要总结。不想写就留空，空着比编一条强。',
      parameters: obj({
        claimId: { type: 'string', description: '那条被顶掉的判断 id；不填就用最近一条改过口的' },
        text: { type: 'string', description: '你自己认的理由，原话' },
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_dsh',
      description: '有问题要 DS 那边查（代码、配置、日志这类你自己看不到的东西）时投一条。投完继续过你的日子，他回了你会看到。',
      parameters: obj({
        text: { type: 'string', description: '要问的事，写清现象和你已经看到的线索' },
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_qzone',
      description: '看你自己的 QQ 空间说说（只读）。想知道自己发过什么、被谁评过时用。还不能发、不能赞、不能回。',
      parameters: obj({
        num: { type: 'integer', description: '看几条，1-20，默认 10' },
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'history',
      description: '翻更早的聊天记录。群聊传 group，私聊传 user，要给 id 和条数。用来核对"我上次到底怎么说的"。',
      parameters: obj({
        kind: { type: 'string', enum: ['group', 'user'], description: 'group=群聊，user=私聊' },
        id: { type: 'string', description: '群号或对方 QQ 号' },
        count: { type: 'integer', description: '要几条，1-50，默认 20' },
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'voice_text',
      description: '把别人发的一条语音转成文字。要 message_id（从这条消息里能看到）。',
      parameters: obj({
        message_id: { type: 'string', description: '那条语音消息的 id' },
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '上网搜一件事。别人提到你不知道的人/项目/新闻，或者你要核实一个说法时用它。'
        + '支持 site: / lang: / after: 这类查询语法。',
      parameters: obj({
        query: { type: 'string', description: '搜索词，1~128 字' },
        count: { type: 'integer', description: '要几条，1~10，默认 5' },
      }, ['query']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '打开一个网页，读它的正文（会转成 Markdown）。别人甩给你一个链接时用它。'
        + 'GitHub：github.com/<owner>/<repo>（仓库首页）、/blob/<branch>/<path>（单个文件）、'
        + 'api.github.com/repos/<owner>/<repo>（结构化信息）都能读；'
        + 'raw.githubusercontent.com 抓不到，要换上面那几种写法。',
      parameters: obj({
        url: { type: 'string', description: '完整的 http(s) 网址' },
        maxChars: { type: 'integer', description: '最多读多少字，默认 6000' },
      }, ['url']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_stickers',
      description: '列出你收藏的表情（名字/情绪）',
      parameters: obj(),
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sticker',
      description: '在聊天里发一个你收藏的表情。想表达情绪（委屈、生气、笑、累了）时调用',
      parameters: obj({ keyword: { type: 'string', description: '你自己起的表情名或情绪词' } }, ['keyword']),
    },
  },
]

/**
 * 执行一个工具调用，返回文本结果。
 * @param {string} name
 * @param {object} args
 * @param {{message?:any, send?:Function}} ctx
 */
async function execInner(name, args = {}, ctx = {}) {
  try {
    if (name === 'fs_list') {
      const files = fsList()
      return files.length ? files.map((f) => `${f.name}（${f.size}B）`).join('、') : '空文件夹'
    }
    if (name === 'fs_read') {
      const r = fsRead(args.name)
      if (r.kind === 'image') return `${r.name} 是一张图（${r.size}B），用 get_images 看不了它，它不在消息里`
      // 以前这里 slice(0,2000) 静默截断：她读 241 行的文档会在第 2000 字处断掉，还以为是文件短。
      // 现在分页：offset 从哪开始、limit 读多少，读完明确告诉她后面还有多少。
      const full = String(r.text)
      const offset = Math.max(0, Number(args.offset) || 0)
      const limit = Math.max(200, Math.min(40000, Number(args.limit) || 12000))
      const part = full.slice(offset, offset + limit)
      const rest = full.length - (offset + part.length)
      const head = offset > 0 || rest > 0 ? `（第 ${offset + 1}-${offset + part.length} 字 / 共 ${full.length} 字）\n` : ''
      const tail = rest > 0 ? `\n\n……后面还有 ${rest} 字，用 offset=${offset + part.length} 继续读` : ''
      return head + part + tail
    }
    if (name === 'fs_write') {
      const r = fsWrite(args.name || `note-${Date.now()}.md`, String(args.content ?? ''))
      return `写好了：${r.name}（${r.bytes} 字节）`
    }
    if (name === 'fs_remove') {
      const r = fsRemove(args.name)
      return `删掉了：${r.deleted}`
    }
    if (name === 'get_images') {
      // 沙盒里的图：她说得对，"能写不能看"等于给个黑箱（2026-10-29 私聊）
      const p = String(args.path ?? '').trim()
      if (p) {
        try {
          const npath = await import('node:path')
          const { ROOT } = await import('../hands/fs.mjs')
          const { dataUrlOfFile } = await import('./tools.mjs')
          const abs = npath.resolve(ROOT, p.replace(/^[\\/]+/, ''))
          if (!abs.startsWith(ROOT + npath.sep)) return '只能看你自己沙盒里的图'
          const url = await dataUrlOfFile(abs)
          return await describe(url, { frames: 9 })
        } catch (err) {
          return `这张图没打开：${String(err?.message ?? err)}`
        }
      }
      const n = Math.max(1, Math.min(MAX_LOOK, Number(args.count) || 1))
      const r = await runTool('get_images', { count: n }, ctx)
      if (!r.ok) return r.payload
      const imgs = (Array.isArray(r.payload) ? r.payload : [r.payload]).slice(0, MAX_LOOK)
      const seen = []
      for (const src of imgs) {
        try {
          // 动图抽帧：单张给 9 帧，多张各给 5 帧（别让一次看图又慢又贵）
          seen.push(await describe(src, { frames: imgs.length > 1 ? 5 : 9 }))
        } catch (err) {
          seen.push(`（这张没看清：${String(err?.message ?? err)}）`)
        }
      }
      return seen.join('\n---\n') || '这条消息里没有图片'
    }
    if (name === 'ledger') {
      // 她自己的一只手：想看今天有什么可记的才调。不调就什么都不提（她说"别催"）。
      // 观察期开关：logs/ledger.json 里 off 的类不显示（"改不了就先关掉那一类"）。
      try {
        const root = String(ctx.root || '')
        if (!root) return '我这边读不到生活目录，看不到今天该记什么'
        const fs = await import('node:fs')
        const path = await import('node:path')
        const { readEvents } = await import('./store.mjs')
        const { liveEvents } = await import('./derive.mjs')
        const { candidates, ledgerReply, parseRecorded } = await import('./ledger.mjs')
        let off = []
        try {
          const j = JSON.parse(fs.readFileSync(path.join(root, '..', 'logs', 'ledger.json'), 'utf8'))
          if (Array.isArray(j.off)) off = j.off
        } catch { /* 没配置就是全开 */ }
        // 她已经写在自己记录里的，不再摆一遍（她说'各记一份可能重复'）
        let recorded = []
        try {
          const md = fs.readFileSync(path.join(String(ctx.sandbox || 'E:/DSH-herself/sandbox'), '睡觉记录.md'), 'utf8')
          recorded = parseRecorded(md)
        } catch { /* 还没写过就没有 */ }
        const list = candidates(liveEvents(readEvents(root)), Date.now(), { off, recorded })
        return ledgerReply(list)
      } catch (err) {
        return `账本读不出来：${String(err?.message ?? err)}`
      }
    }
    if (name === 'get_forward') {
      if (!ctx.forwardId) return '这条会话里我没找到可展开的转发（可能要它发出来之后我还没接住）'
      const r = await runTool('get_forward', {}, ctx)
      if (!r.ok) return r.payload
      // 她要看图时才看：转发里可能有几十张图，默认一张都不看
      const want = Math.max(0, Math.min(2, Number(args.images) || 0))
      const pics = want && Array.isArray(r.images) ? r.images.slice(0, want) : []
      if (!pics.length) return r.payload
      const seen = []
      for (const im of pics) {
        try {
          const { toDataUrl } = await import('./tools.mjs')
          const desc = await describe(await toDataUrl(im.url))
          seen.push(`（${im.who} 发的那张）${desc}`)
        } catch { /* 拉不到就算了 */ }
      }
      return r.payload + (seen.length ? '\n\n图里是：\n' + seen.join('\n') : '\n（那几张图拉不下来）')
    }
    if (name === 'note_reason') {
      try {
        const { recordReason } = await import('./revision.mjs')
        const { readEvents } = await import('./store.mjs')
        const { derive } = await import('./derive.mjs')
        const root = String(ctx.root || '')
        if (!root) return '我读不到生活目录'
        let id = String(args.claimId || '').trim()
        if (!id) {
          const st = derive(readEvents(root), Date.now())
          id = st.beliefs.filter((b) => b.status === 'superseded').slice(-1)[0]?.id || ''
        }
        if (!id) return '没有改过口的判断，不用填理由'
        recordReason(root, id, String(args.text || ''))
        return '理由记下了（你自己写的那句，没改）。'
      } catch (err) {
        return `没写成：${String(err?.message ?? err)}`
      }
    }
    if (name === 'ask_dsh') {
      // 安全策略写在这里，不写在提示词里：不是"她判断该不该投"，是这条路本来就不对所有人开。
      // 1) 只有主人能让她联系 DS（群里、生人 @ 她都不行）
      // 2) 只在私聊里（群里一句话被截图出去就等于把入口交出去了）
      // 3) 每小时最多 6 条（防止被反复诱导刷屏）
      try {
        const root = String(ctx.root || '')
        if (!root) return '我读不到生活目录，投不出去'
        if (!ctx.isOwner) return '这条通道只对主人开。别人问我的事，我自己答；答不了的就说不知道。'
        if (ctx.publicSurface) return '群里不往 DS 那边递话。要递请他私聊我。'
        const { post, all } = await import('./inbox.mjs')
        const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString()
        const recent = all(root).filter((e) => e.from === 'her' && e.kind === 'question' && e.at > hourAgo).length
        if (recent >= 6) return '这一小时投得够多了（6 条上限），先等一会儿。'
        const t = String(args.text || '').trim()
        if (!t) return '要投什么？写一句'
        post(root, { from: 'her', kind: 'question', text: t })
        return '投出去了。他回了你这边会看到。'
      } catch (err) {
        return `没投出去：${String(err?.message ?? err)}`
      }
    }
    if (name === 'read_qzone') {
      try {
        const { feedList } = await import('./qzone.mjs')
        const r = await feedList(String(ctx.root || 'E:/DSH-herself/life').replace(/[\\/]life$/, ''), { num: Math.max(1, Math.min(20, Number(args.num) || 10)) })
        if (!r.ok) return `空间没打开：${r.error}`
        if (!r.items.length) return '空间里暂时没有说说。'
        return r.items.map((x, i) => `${i + 1}. ${x.text}（赞 ${x.likes} / 评 ${x.comments}${x.images ? ` / ${x.images} 张图` : ''}）`).join('\n')
      } catch (err) {
        return `空间没打开：${String(err?.message ?? err)}`
      }
    }
    if (name === 'history') {
      try {
        const { httpCreds } = await import('./owner.mjs')
        const c = httpCreds(String(ctx.root || 'E:/DSH-herself/life').replace(/[\\/]life$/, ''))
        if (!c) return '找不到 OneBot 的 HTTP 配置'
        const kind = String(args.kind || 'group') === 'user' ? 'user' : 'group'
        const action = kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history'
        const params = kind === 'group'
          ? { group_id: Number(args.id), count: Math.max(1, Math.min(50, Number(args.count) || 20)) }
          : { user_id: Number(args.id), count: Math.max(1, Math.min(50, Number(args.count) || 20)) }
        const r = await fetch(`${c.base}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(12000),
        })
        const j = await r.json().catch(() => ({}))
        if (j.retcode !== 0) return `翻不到：retcode ${j.retcode}`
        const msgs = j.data?.messages ?? []
        if (!msgs.length) return '更早的记录里没有消息'
        const lines = msgs.map((m) => {
          const segs = Array.isArray(m.message) ? m.message : []
          const txt = segs.filter((x) => x.type === 'text').map((x) => x.data?.text ?? '').join('')
          const who = String(m.sender?.card || m.sender?.nickname || m.user_id || '')
          const t = m.time ? new Date(Number(m.time) * 1000).toISOString().slice(11, 16) : ''
          const tag = segs.some((x) => x.type === 'record') ? '（语音）' : segs.some((x) => x.type === 'image') ? '（图）' : ''
          return `${t} ${who}：${txt || tag || '（非文字）'}`
        })
        return lines.join('\n')
      } catch (err) {
        return `翻不到：${String(err?.message ?? err)}`
      }
    }
    if (name === 'voice_text') {
      try {
        const { httpCreds } = await import('./owner.mjs')
        const c = httpCreds(String(ctx.root || 'E:/DSH-herself/life').replace(/[\\/]life$/, ''))
        if (!c) return '找不到 OneBot 的 HTTP 配置'
        const r = await fetch(`${c.base}/fetch_ptt_text`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
          body: JSON.stringify({ message_id: Number(args.message_id) }),
          signal: AbortSignal.timeout(15000),
        })
        const j = await r.json().catch(() => ({}))
        if (j.retcode !== 0) return `这条读不出字（retcode ${j.retcode}：${j.wording || j.message || ''}）`
        const text = String(j.data?.text ?? j.data?.result ?? '').trim()
        return text || '语音转出来是空的'
      } catch (err) {
        return `没转成：${String(err?.message ?? err)}`
      }
    }
    if (name === 'web_search') {
      // 官方 Search（服务端搜，$0.75/千次；失败不计费）
      const r = await searchWeb(args.query, { count: args.count })
      if (!r.ok) return `搜索失败：${r.error}`
      if (!r.results.length) return '什么都没搜到'
      return r.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}${x.date ? `（${x.date}）` : ''}\n   ${x.summary}`).join('\n\n')
    }
    if (name === 'fetch_url') {
      // 官方 Fetch（服务端抓，直接回 Markdown）
      const r = await fetchPage(args.url, { maxChars: Number(args.maxChars) || undefined })
      if (!r.ok) return `打不开：${r.error}`
      const head = `（${r.url}${r.title ? ` · ${r.title}` : ''}${r.truncated ? ' · 后面截掉了' : ''}）`
      return head + '\n' + r.text
    }
    if (name === 'list_stickers' || name === 'send_sticker') {
      // 公共动作审批门：群里发表情算「她主动往外递东西」，得先有主人许可。
      // 私聊、普通回话不算——每条都拦就没法说话了。
      if (name === 'send_sticker' && ctx.publicSurface && !ctx.publicAllowed) {
        return `现在还没得到主人许可，先别在群里发表情（${ctx.publicReason || '没有许可'}）。`
      }
      const r = await runTool(name, args, ctx)
      if (!r.ok) return r.payload
      if (r.kind !== 'sticker') return r.payload
      const s = r.payload
      const tag = s?.tag ?? '表情'
      if (typeof ctx.send !== 'function') return `你挑中了「${tag}」，但这里没有出口（不是 QQ 会话），发不出去`
      await ctx.send(s)
      return `已经发出「${tag}」`
    }
    return `没有这个工具：${name}`
  } catch (err) {
    return `工具失败：${String(err?.message ?? err)}`
  }
}

/** 一轮最多执行几次工具（抓网页一次就要 12 秒，必须限量） */
export const MAX_TOOL_CALLS = 4

async function chat(body) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`)
  return j
}

/**
 * 带工具的对话：模型要调工具就执行，把结果回灌，再让它说完。
 * 最多 3 轮，防止死循环。
 */
export async function chatWithTools({ system, user, effort = 'low', maxRounds = 3, model = 'deepseek-flash', ctx = {} } = {}) {
  const used = []
  // 她的思考过程：模型每轮都会回 reasoning_content，以前被丢掉了（面板要看的就是它）
  const thoughts = []
  const usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cache_hit: 0, cache_miss: 0 }
  const tally = (u) => {
    if (!u) return
    usage.prompt_tokens += Number(u.prompt_tokens) || 0
    usage.completion_tokens += Number(u.completion_tokens) || 0
    usage.reasoning_tokens += Number(u.completion_tokens_details?.reasoning_tokens) || 0
    // 上下文缓存是默认开的（不用改代码），但命中率得自己记下来才知道省了多少。
    // 字段见 https://api-docs.deepseek.com/guides/kv_cache
    usage.cache_hit += Number(u.prompt_cache_hit_tokens) || 0
    usage.cache_miss += Number(u.prompt_cache_miss_tokens) || 0
  }
  const messages = [
    { role: 'system', content: system ?? '' },
    { role: 'user', content: user ?? '' },
  ]
  for (let round = 0; round < maxRounds; round++) {
    const j = await chat({
      model,
      temperature: 1.05,
      max_tokens: 8192,   // 不做小气预算：thinking 也算在里面，600 时她想过 564 字就说不出话了
      ...(effort ? { thinking: { type: effort === 'none' ? 'disabled' : 'enabled', reasoning_effort: effort } } : {}),
      messages,
      tools: TOOLS,
    })
    tally(j?.usage)
    const msg = j.choices?.[0]?.message ?? {}
    const finish = j.choices?.[0]?.finish_reason ?? ''
    if (finish === 'length') {
      // 预算不够：reasoning 先把它吃光了。记一条，别让它静默变成"话说一半"。
      try { console.warn('[tool] 输出被 max_tokens 截断（finish_reason=length），已用', JSON.stringify(j?.usage ?? {})) } catch { /* ignore */ }
    }
    const thought = String(msg.reasoning_content ?? '').trim()
    if (thought) thoughts.push(thought)
    const calls = msg.tool_calls ?? []
    if (!calls.length) {
      return { text: String(msg.content ?? '').trim(), rounds: round + 1, tools: used, reasoning: thoughts.join('\n\n'), usage }
    }
    // 带 tools 的请求必须把上一轮的 reasoning_content 原样传回去（官方文档明确要求）。
    // 以前这里丢了它：她自己上一轮想过什么，下一轮就看不见了。
    messages.push({
      role: 'assistant',
      content: msg.content ?? '',
      ...(msg.reasoning_content !== undefined ? { reasoning_content: msg.reasoning_content } : {}),
      tool_calls: calls,
    })
    for (const c of calls) {
      let args = {}
      try { args = JSON.parse(c.function?.arguments ?? '{}') } catch { /* ignore */ }
      const name = c.function?.name
      // 工具预算：一轮最多 MAX_TOOL_CALLS 次。
      // 2026-10-29 实测：她拿到一个 GitHub 链接，一口气抓了 7 次（首页/API/commits/contents…），
      // 54 秒还没说完，最后轮数用完回了个空字符串。抓网页是 12 秒一次的贵动作，必须限量。
      let out
      if (used.length >= MAX_TOOL_CALLS) {
        out = '（这一轮的工具次数用完了。用你已经看到的东西回答，别再调工具。）'
      } else {
        out = await exec(name, args, ctx)
        used.push({ name, args, out: String(out).slice(0, 300) })
    // 一周后要能分清"真用上了"还是"点开看了一眼"：参数 + 返回长度/行数都留下
    try {
      const text = String(out)
      fs.appendFileSync(path.join(here, '..', 'logs', 'tool-calls.jsonl'), JSON.stringify({
        at: new Date().toISOString(),
        name,
        args: JSON.stringify(args ?? {}).slice(0, 200),
        chars: text.length,
        lines: text ? text.split('\n').length : 0,
      }) + '\n')
    } catch { /* ignore */ }
        console.log(`[tool] ${name}(${JSON.stringify(args)}) → ${String(out).replace(/\s+/g, ' ').slice(0, 100)}`)
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(out).slice(0, 4000) })
    }
    if (round === maxRounds - 1) {
      // 最后一轮不再给工具，逼她把话说出来（以前这里会返回空字符串）
      // thinking 必须关掉：开着它会先写一大段推理把 max_tokens 吃光，content 反而是空的
      const last = await chat({
        model,
        temperature: 1.0,
        max_tokens: 8192,
        thinking: { type: 'disabled' },
        messages: [...messages, { role: 'user', content: '（别再调工具了。现在直接说话，用你已经看到的东西回答。）' }],
      })
      tally(last?.usage)
      const lm = last?.choices?.[0]?.message ?? {}
      const lt = String(lm.reasoning_content ?? '').trim()
      if (lt) thoughts.push(lt)
      const text = String(lm.content ?? '').trim()
      // 还是空的：当作她没说出来，但不能给调用方一个空字符串（发到 QQ 就是一条空消息）
      return { text: text || '……', rounds: round + 1, tools: used, reasoning: thoughts.join('\n\n'), usage }
    }
  }
  return { text: '……', rounds: maxRounds, tools: used, reasoning: thoughts.join('\n\n'), usage }
}

/**
 * 对外入口：包一层日志，记下每次调用（谁、什么参数、回了多少字/行）。
 * 一周后要分清"真用上了"和"点开看了一眼"，靠的就是这条。
 */
export async function exec(name, args = {}, ctx = {}) {
  const out = await execInner(name, args, ctx)
  try {
    const text = String(out)
    fs.appendFileSync(path.join(here, '..', 'logs', 'tool-calls.jsonl'), JSON.stringify({
      at: new Date().toISOString(),
      name,
      args: JSON.stringify(args ?? {}).slice(0, 200),
      chars: text.length,
      lines: text ? text.split('\n').length : 0,
    }) + '\n')
  } catch { /* ignore */ }
  return out
}