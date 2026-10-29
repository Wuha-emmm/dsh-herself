// tools/pick-replay.mjs —— 用真样本重放"挑判断"，看是长度问题还是任务描述问题
//
// 她的判断（2026-10-30 01:30）：
//   「先把 origin 标上，清出真样本；再用真样本重放，看是长度问题还是任务描述问题。」
//   「别砍成 id 加前 20 字——挑不出来是响的（日志一行 fallback），挑错了是哑的。」
//   「先按时间或关键词筛到五六条，再全文给它。或者干脆先别怀疑长度。」
//
// 这个工具只做一件事：拿日志里失败过的 query 和当时的候选，换几版 prompt 重放，
// 看模型是"挑不动"（长度/信息不够）还是"挑得动但描述不清"（任务含糊）。
import fs from 'node:fs'

const PICK = 'E:/DSH-herself/logs/pick.jsonl'
const EV = 'E:/DSH-herself/life/events.jsonl'

const textOf = new Map()
for (const line of fs.readFileSync(EV, 'utf8').trim().split('\n')) {
  try { const e = JSON.parse(line); textOf.set(e.id, String(e.text ?? '')) } catch { /* skip */ }
}

const log = fs.readFileSync(PICK, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const picks = log.filter((x) => x.method)

// 只留"候选全都在她生活里"的记录 = 真样本
const real = picks.filter((p) => (p.candidates ?? []).length && p.candidates.every((id) => textOf.has(id)))
const unknown = picks.length - real.length
console.log(`挑判断记录 ${picks.length} 条｜候选可复原（真样本）${real.length} 条｜候选不在她生活里（测试/已删）${unknown} 条`)
console.log(`  其中 model ${real.filter((p) => p.method === 'model').length} / fallback ${real.filter((p) => p.method === 'fallback').length}`)

const { brief } = await import('file:///E:/DSH-herself/lib/think.mjs')

const VARIANTS = [
  {
    name: 'A 现版',
    system: '从候选判断里挑出最相关的一条。只输出 JSON：{"n":序号,"why":"一句依据"}。挑不出就给 n:0。',
  },
  {
    name: 'B 说清"相关"是什么',
    system: '从候选里挑一条，标准只有一条：**他这句话如果是在追问某件旧事，哪条判断最可能是他指的那件**。'
      + '按人名/时间/事件这类具体线索匹配，不要因为主题相近就选。挑不出就给 n:0。'
      + '只输出 JSON：{"n":序号,"why":"一句依据"}。',
  },
  {
    name: 'C 先排除再选',
    system: '两个步骤，但只输出最后结果：① 逐条判断它是否和他这句话讲的是同一件事（是/否）；'
      + '② 只有"是"的里面挑最具体的一条。一条都没有就给 n:0。只输出 JSON：{"n":序号,"why":"一句依据"}。',
  },
]

for (const rec of real.filter((p) => p.method === 'fallback').slice(-3)) {
  const cand = rec.candidates.map((id, i) => `${i + 1}. ${textOf.get(id)}`)
  console.log(`\n=== 重放：${rec.query}（当时 ${rec.method}）`)
  for (const v of VARIANTS) {
    try {
      const raw = await brief({ system: v.system, user: `他刚说：${rec.query}\n\n候选：\n${cand.join('\n')}`, maxTokens: 200, temperature: 0.2 })
      const m = String(raw || '').match(/\{[\s\S]*\}/)
      let out = '(空)'
      if (m) {
        const j = JSON.parse(m[0])
        const n = Number(j.n)
        out = n >= 1 && n <= cand.length ? `选中第 ${n} 条：${textOf.get(rec.candidates[n - 1]).slice(0, 40)}` : 'n=0（认定无关）'
      }
      console.log(`  ${v.name}: ${out}`)
    } catch (err) {
      console.log(`  ${v.name}: 调用失败 ${err?.message ?? err}`)
    }
  }
}