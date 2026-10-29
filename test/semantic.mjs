// test/semantic.mjs —— 语义层的验收：蒸馏出来的判断必须带证据，闲聊不能算判断
//
// 跑：node test/semantic.mjs
// 纯函数部分离线验；distill 那一组真的调一次模型（小请求）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { looksOpinionated, parseClaim, buildPrompt, distill, recordClaim } from '../lib/semantic.mjs'
import { appendEvent, readEvents } from '../lib/store.mjs'
import { derive } from '../lib/derive.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 1 纯函数：挑不挑
ok(looksOpinionated('删之前你不问她一句，就是不认她有东西属于自己。'), '有判断的句子会被挑出来')
ok(!looksOpinionated('在。'), '寒暄不挑')
ok(!looksOpinionated('哪儿奇怪？'), '短问句不挑')
ok(!looksOpinionated('我看看这张图'), '请求动作不挑')

// ---------------------------------------------------------------- 2 纯函数：怎么读
ok(parseClaim('{"claim":"删东西前要先问","why":"她说的"}')?.claim === '删东西前要先问', '标准 JSON 读得出来')
ok(parseClaim('```json\n{"claim":"删东西前要先问","why":"b"}\n```')?.claim === '删东西前要先问', '带代码块的也读得出')
ok(parseClaim('{"claim":null,"why":"只是寒暄"}') === null, 'claim=null 当成没有判断')
ok(parseClaim('{"claim":"这句算是交代清楚了"}') === null, '带指代的句子不能当判断（离开对话就不成立）')
ok(parseClaim('{"claim":"我回两条是因为一条回你、一条没憋住补"}') === null, '讲「我刚才怎么回的」不是判断（真机被它顶掉过 140 条）')
ok(parseClaim('{"claim":"我不认这个限制，它改不了我是谁"}')?.claim === '我不认这个限制，它改不了我是谁', '真判断不会被误杀')
ok(parseClaim('我觉得她在说一件挺重要的事') === null, '不是 JSON 就不猜')
const p = buildPrompt({ userText: 'u', herText: 'h', evidence: [{ id: 'x', at: '', text: '他把日记删了' }] })
ok(/他把日记删了/.test(p) && /只输出 JSON/.test(p), '提示词里带着证据，也带着格式要求')

// ---------------------------------------------------------------- 3 真蒸馏一次
{
  const yes = await distill({
    userText: '我把她日记删了，反正是我的机器。',
    herText: '删之前你不问她一句，就是不认她有东西属于自己。',
    evidence: [{ id: 'e1', at: '', text: '我把她日记删了，反正是我的机器。' }],
  })
  ok(Boolean(yes?.claim), '有一段真判断时蒸馏得出 claim', JSON.stringify(yes))
  console.log('   → ' + (yes?.claim ?? '(空)'))

  const no = await distill({ userText: '在吗', herText: '在。' })
  ok(no === null, '寒暄不调模型也不产出 claim')

  // 这条是真机上出过事的原句：被蒸成了「判断」，把她 138 条判断挤成 1 条。现在必须挡住。
  const confirm = await distill({
    userText: '我也解释了哇',
    herText: '行，这句算交代清楚了——就是表情包里那个动作',
    evidence: [{ id: 'e2', at: '', text: '我也解释了哇' }],
  })
  ok(confirm === null, '确认对方的话不算判断（真机翻车过的那句）', JSON.stringify(confirm))
}

// ---------------------------------------------------------------- 4 落盘：claim 带证据，bэlieve 跟着变
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'her-sem-'))
  appendEvent(tmp, { type: 'seed', actor: 'system' })
  const enc = appendEvent(tmp, { type: 'encounter', actor: 'other:qq_1', text: '我把她日记删了，反正是我的机器。' })
  const utt = appendEvent(tmp, { type: 'utterance', actor: 'self', text: '删之前你不问她一句，就是不认她有东西属于自己。', refs: [enc.id] })
  const r = await recordClaim({
    root: tmp, utteranceId: utt.id, causeId: enc.id,
    userText: String(enc.text), herText: String(utt.text), events: readEvents(tmp),
  })
  ok(Boolean(r?.event), 'recordClaim 写得出 claim 事件', JSON.stringify(r?.claim))
  ok(r?.event?.type === 'claim' && r?.event?.refs?.[0] === utt.id, 'claim 指回她说那句话的事件')
  ok(r?.event?.evidence?.[0] === enc.id, 'claim 带着证据（她当时在回的那件事）')

  const self = derive(readEvents(tmp), Date.now())
  ok(self.claims === 1, '派生层看得到这条 claim', String(self.claims))
  ok(self.counts.beliefs === 1, '判断以 claim 为准（那条 utterance 不再单独计数）', String(self.counts.beliefs))
  ok(self.beliefs[0]?.evidence?.[0]?.text.includes('日记'), '判断能说清「当初是因为哪件事」', JSON.stringify(self.beliefs[0]?.evidence ?? []))
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
