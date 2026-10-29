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
export async function exec(name, args = {}, ctx = {}) {
  try {
    if (name === 'fs_list') {
      const files = fsList()
      return files.length ? files.map((f) => `${f.name}（${f.size}B）`).join('、') : '空文件夹'
    }
    if (name === 'fs_read') {
      const r = fsRead(args.name)
      return r.kind === 'image' ? `${r.name} 是一张图（${r.size}B），用 get_images 看不了它，它不在消息里` : String(r.text).slice(0, 2000)
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
      try {
        const { post } = await import('./inbox.mjs')
        const root = String(ctx.root || '')
        if (!root) return '我读不到生活目录，投不出去'
        const t = String(args.text || '').trim()
        if (!t) return '要投什么？写一句'
        post(root, { from: 'her', kind: 'question', text: t })
        return '投出去了。他回了你这边会看到。'
      } catch (err) {
        return `没投出去：${String(err?.message ?? err)}`
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
