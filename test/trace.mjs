// test/trace.mjs —— 侧栏面板的数据侧验收
//
// 跑：node test/trace.mjs
// 验三件事：① 思考过程真的落到了旁路（不进事件流）；② /live 只给摘要；③ /turn 能取全文。
// 最后一段会真跑一次 think()（一次小模型调用），确认「她的回合」会自己记一条。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// 必须在 import trace/live 之前设置：FILE 是模块级常量
const TRACE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'her-trace-')), 'trace.jsonl')
process.env.DSH_HERSELF_TRACE = TRACE

const { appendTrace, readTrace } = await import('../lib/trace.mjs')
const { buildLive, readTurn } = await import('../lib/live.mjs')
const { appendEvent, readEvents } = await import('../lib/store.mjs')
const { think } = await import('../lib/think.mjs')

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 1 旁路读写
{
  appendTrace({ ts: new Date().toISOString(), utteranceId: 'A1', text: '第一句', reasoning: '想了一下' })
  appendTrace({ ts: new Date().toISOString(), utteranceId: 'A2', text: '第二句', reasoning: '又想了一下' })
  const all = readTrace({ limit: 10 })
  ok(all.length === 2 && all[1].utteranceId === 'A2', '落盘且按写入顺序读回', JSON.stringify(all.map((x) => x.utteranceId)))
  ok(readTrace({ limit: 1 }).length === 1, 'limit 生效')
  ok(fs.existsSync(TRACE), '旁路文件在（logs/trace.jsonl 或 env 指定的位置）')
}

// ---------------------------------------------------------------- 2 live 只给摘要
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'her-live-'))
  appendEvent(root, { type: 'seed', actor: 'system' })
  const enc = appendEvent(root, { type: 'encounter', actor: 'other:qq_1', surface: 'qq', text: '他在吗' })
  const utt = appendEvent(root, { type: 'utterance', actor: 'self', surface: 'qq', text: '在。', refs: [enc.id] })
  appendTrace({
    ts: new Date().toISOString(),
    thread: 'qq:private:1',
    causeId: enc.id,
    utteranceId: utt.id,
    model: 'deepseek-flash',
    ms: 1200,
    userText: '他在吗',
    facts: ['这是你存在的第 1 天。'],
    hits: [{ id: enc.id, text: '他在吗', hit: 2, score: 4.1 }],
    tools: [{ name: 'fs_list', args: {}, out: '空文件夹' }],
    reasoning: '他只是打个招呼。',
    text: '在。',
    usage: { prompt_tokens: 10, completion_tokens: 20, reasoning_tokens: 15 },
  })

  const live = buildLive(root, { limit: 10 })
  ok(live.turns.length === 2, '对话流按时间给出两轮', String(live.turns.length))
  const her = live.turns.find((t) => t.type === 'utterance')
  ok(her?.trace && her.trace.reasoning > 0, '她那一轮带思考摘要（字数）', JSON.stringify(her?.trace))
  ok(!JSON.stringify(live).includes('他只是打个招呼'), '/live 不带 reasoning 全文（轮询不背大包）')

  const full = await readTurn(root, utt.id)
  ok(full?.facts?.[0]?.includes('第 1 天'), '/turn 取得到她看到的事实')
  ok(full?.hits?.[0]?.score === 4.1, '/turn 取得到检索分数（面板要回答“为什么想起这条”）')
  ok(full?.reasoningZh === undefined, '中文腹稿不会被多翻一遍（省钱）')
  ok((await readTurn(root, 'nope')) === null, '取不到就返回 null（路由转 404）')
  ok(!readEvents(root).some((e) => e.type === 'trace' || e.reasoning), '思考过程没有污染事件流')
  fs.rmSync(root, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 2.5 英文腹稿要翻成中文
{
  const { needsZh, ensureZh } = await import('../lib/live.mjs')
  ok(needsZh('User says my image recognition is still problematic. I should answer directly and admit the limitation, in Chinese, 15-100 chars.'), '整段英文会被判成「要翻」')
  ok(!needsZh('用户问是不是只能看到动图第一帧。我之前判断过确实如此。直接承认，简短。'), '中文腹稿不翻')
  ok(!needsZh('好的'), '太短的不翻')

  const id = 'EN-' + Date.now()
  const zh = await ensureZh(id, 'User asks whether I can only see the first frame of a GIF. I should admit it directly and briefly, without over-explaining the mechanism.')
  const cjk = (zh.match(/[\u4e00-\u9fa5]/g) ?? []).length
  ok(Boolean(zh) && cjk > zh.length * 0.4, '真翻出来是中文', String(zh).slice(0, 60))
  const again = await ensureZh(id, 'User asks whether I can only see the first frame of a GIF. I should admit it directly and briefly, without over-explaining the mechanism.')
  ok(again === zh, '第二次命中缓存（同一句不再花钱）')
}

// ---------------------------------------------------------------- 3 真跑一回合，她自己会记
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'her-turn-'))
  appendEvent(root, { type: 'seed', actor: 'system' })
  const enc = appendEvent(root, { type: 'encounter', actor: 'other:qq_1', surface: 'qq', text: '你今天怎么样？' })
  const before = readTrace({ limit: 500 }).length
  const r = await think({ root, userText: '你今天怎么样？', who: '他', causeId: enc.id, thread: 'qq:private:1' })
  const after = readTrace({ limit: 500 })
  const rec = after.find((x) => x.utteranceId === r.event.id)
  ok(after.length === before + 1, 'think() 走完会自己写一条思考记录', `${before} → ${after.length}`)
  ok(Boolean(rec), '记录挂在她这句话的 id 上（面板才能对上）')
  ok(Array.isArray(rec?.facts) && rec.facts.length > 0, '记录里有她看到的事实')
  ok(typeof rec?.reasoning === 'string', '记录里有 reasoning 字段（有就给，没给就是空串）', String(rec?.reasoning?.length))
  ok(Boolean(rec?.usage), '记录里有 token 用量')
  fs.rmSync(root, { recursive: true, force: true })
}

fs.rmSync(path.dirname(TRACE), { recursive: true, force: true })
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
