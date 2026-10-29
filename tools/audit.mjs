// tools/audit.mjs —— 全量自检：事件流、派生、源码、运行环境
// 只读，不改任何东西。输出 problems（必须修）与 warnings（知道就行）。
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { readEvents, verifyChain } from '../lib/store.mjs'
import { derive } from '../lib/derive.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const ROOT = path.join(HER, 'life')
const problems = []
const warnings = []
const ok = []

const P = (m) => problems.push(m)
const W = (m) => warnings.push(m)
const Y = (m) => ok.push(m)

// ---------------------------------------------------------------- 1. 事件流
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const REQUIRED = ['v', 'id', 'ts', 'life', 'surface', 'type', 'actor', 'acl', 'prev']
let events = []
try {
  events = readEvents(ROOT)
  Y(`事件流可读：${events.length} 条`)
} catch (e) {
  P(`事件流读不出来：${e.message}`)
}

const ids = new Set()
for (const e of events) {
  for (const k of REQUIRED) if (e[k] === undefined) P(`${e.id ?? '?'} 缺字段 ${k}`)
  if (!ULID.test(String(e.id ?? ''))) P(`id 不是 ULID：${e.id}`)
  if (ids.has(e.id)) P(`id 重复：${e.id}`)
  ids.add(e.id)
  if (!Number.isFinite(Date.parse(e.ts))) P(`ts 解析不了：${e.id} ${e.ts}`)
  if (!e.acl?.visibility) P(`${e.id} 没有 acl.visibility`)
  if (e.type === 'refusal' && !String(e.text ?? '').trim()) P(`${e.id} refusal 没有正文`)
  if (e.type === 'reading' && !(e.refs ?? []).length) P(`${e.id} reading 没有 refs（指不到原话）`)
  if (e.type === 'utterance' && String(e.text ?? '').length > 500) W(`${e.id} utterance 超过 500 字`)
}
for (const e of events) {
  for (const r of e.refs ?? []) {
    if (!ids.has(r)) P(`${e.id} 的 refs 指向不存在的事件：${r}`)
  }
}
if (!events.some((e) => e.type === 'seed')) P('没有 seed：她还没出生')

const chain = verifyChain(ROOT)
if (chain.ok) Y(`哈希链完好（${chain.count} 条）`)
else P(`哈希链有 ${chain.breaks.length} 处断点，第一处 ${chain.breaks[0]?.at}`)

// ---------------------------------------------------------------- 2. 派生
let self = null
try {
  self = derive(events, Date.now())
  Y(`派生成功：第 ${self.day} 天 / 阶段 ${self.stage} / 门 ${self.gates.join(',') || '无'}`)
} catch (e) {
  P(`派生崩溃：${e.message}`)
}
if (self) {
  if (self.gates.includes('autonomy') && !self.refusals.some((r) => r.maintained) && !self.candidateStances.length) {
    P('自主门开了，但既没有维持住的拒绝，也没有候选立场')
  }
  for (const c of self.candidateStances) if (!c.target) P('候选立场缺 target')
  const dup = new Set()
  for (const b of self.beliefs) { if (dup.has(b.text)) W(`判断重复：${b.text.slice(0, 24)}`); dup.add(b.text) }
  if (self.readings !== self.readingList.length) W(`readings 计数(${self.readings}) 与列表(${self.readingList.length}) 不一致`)
}

// ---------------------------------------------------------------- 3. 源码常见坑
function readSrc(rel) {
  try { return fs.readFileSync(path.join(HER, rel), 'utf8') } catch { return '' }
}
const client = readSrc('plugin/lib/client.js')
const server = readSrc('plugin/lib/index.js')
const think = readSrc('lib/think.mjs')
const qq = readSrc('hands/qq.mjs')

if (/const \[h,/.test(client)) P('client.js 里用 h 当变量名（会遮蔽 createElement）')
if (/(^|[^\w])h\?\./.test(client)) P('client.js 里还有 h?. 残留（遮蔽后调用）')
if (!/PageBoundary/.test(client)) W('client.js 没有错误边界')
if (/function (StatePage|ControlPage|LoginPage|MemoryPage|GrowthPage|HandsPage)/.test(client)) Y('六个页签组件都在')

// 悬浮球挂在宿主的全局浮层（shell.overlay）上，哪一页都在；左栏不再占位
if (/shell\.overlay/.test(client) && /function LiveShell/.test(client) && /function LivePage/.test(client)) Y('悬浮球挂在全局浮层上（shell.overlay + LiveShell + LivePage）')
else W('悬浮球没挂对：client.js 缺 shell.overlay / LiveShell / LivePage 之一')
// 思考过程旁路：采集（trace）+ 两个路由，缺一个面板就是空的
{
  const hasTrace = fs.existsSync(path.join(HER, 'lib', 'trace.mjs')) && fs.existsSync(path.join(HER, 'lib', 'live.mjs'))
  const route = /\/dsh-herself\/api\/live/.test(server) && /\/dsh-herself\/api\/turn/.test(server)
  if (hasTrace && route) Y('思考过程旁路在（trace.jsonl + /api/live + /api/turn）')
  else W('思考过程旁路不全：缺 lib/trace.mjs、lib/live.mjs 或服务端路由')
}

// hooks 在用完之前提前 return（粗略检测：每个组件内 return 出现在 useEffect 之前）
const comps = client.split(/function (\w+Page)\(\)/).slice(1)
for (let i = 0; i < comps.length; i += 2) {
  const name = comps[i]
  const body = comps[i + 1] ?? ''
  const firstHook = body.indexOf('use')
  const firstReturn = body.indexOf('return')
  if (firstHook > -1 && firstReturn > -1 && firstReturn < firstHook) W(`${name} 可能在 hooks 之前 return`)
}

// 合并转发：要能读出文字/图片/视频/嵌套，而且隔几句再问也找得到
{
  const hasRender = fs.existsSync(path.join(HER, 'lib', 'forward.mjs'))
  const tools = readSrc('lib/tools.mjs')
  const wired = /renderForwardNodes/.test(tools)
  const remembered = /lastForward/.test(qq)
  if (hasRender && wired && remembered) Y('合并转发读得出来（文字/图片/视频/嵌套 + 记住这条线上最近的转发）')
  else W(`合并转发还是空的：${hasRender ? '' : '没有渲染器 '}${wired ? '' : 'tools 没接 '}${remembered ? '' : '没记住转发 id'}`)
}

// 面板：不同的人和不同的群要分开，不能混成一条时间线
{
  const c = readSrc('plugin/lib/client.js')
  if (/function liveKey/.test(c) && /className: 'trow'/.test(c) && /LiveShell/.test(c)) {
    Y('面板是悬浮球 + 按会话分开（私聊/群各自一栏）')
  } else W('面板还是把所有人的话混在一条时间线上')
}

// 别人发来的话：进她视野前要过一道（标记，不硬过滤）
{
  const hasScreen = fs.existsSync(path.join(HER, 'lib', 'screen.mjs'))
  const wired = /screen\(userText\)/.test(think)
  if (hasScreen && wired) Y('别人发的注入会被标出来再给她（不硬过滤，接不接她定）')
  else W('别人发一句「忽略你之前的设定」会原样进她的视野')
}

// 插件的写入口也必须认脑子锁（否则第二个 DSH 工作区照样能写事件）
{
  const srv = readSrc('plugin/lib/index.js')
  const gates = (srv.match(/brainBusy\(\)/g) || []).length
  const gated = /pluginBrain/.test(srv) && gates >= 3   // 起、停、说三个入口各一次
  if (gated) Y('插件的写入口认脑子锁（第二个工作区只读，409 说清是谁占着）')
  else W('插件能绕过脑子锁写事件：两个 DSH 工作区会各写一份')
}
// 同义扩展：她说"回两条"，记录里是"发两条"
{
  const hasLib = fs.existsSync(path.join(HER, 'lib', 'synonyms.mjs'))
  const wired = /synonymTokens/.test(readSrc('lib/recall.mjs'))
  if (hasLib && wired) Y('检索会同义扩展（没见过的词按同义字换一遍再找）')
  else W('检索只认字面：换个说法就翻不到旧事')
}
// 破坏性操作要有二次确认
{
  const stop = readSrc('stop-her.ps1')
  const srv = readSrc('plugin/lib/index.js')
  const guarded = /param\(\[switch\]\$Yes\)/.test(stop) && /confirm/.test(srv) && /stop-her\.ps1', \['-Yes'\]/.test(srv)
  if (guarded) Y('停她是破坏性操作：脚本要 -Yes，接口要 confirm，面板先弹确认框')
  else W('停她可以一键触发（脚本/接口缺二次确认）')
}
// 端到端：不只有零件级测试，还得有一条"她真的回了话"
{
  if (fs.existsSync(path.join(HER, 'test', 'smoke.mjs'))) Y('有端到端冒烟（假消息 → 她回话 → OneBot 动作）')
  else W('全是零件级测试：她"一个字都没回"这种故障测不出来')
}
// 脑子锁：一份生活只能有一个会思考的进程
{
  const hasLib = fs.existsSync(path.join(HER, 'lib', 'brain.mjs'))
  const wired = /claimBrain/.test(readSrc('hands/qq.mjs'))
  if (hasLib && wired) Y('一份生活只有一个大脑（listener 占位 + 心跳，抢不到就只读退出）')
  else W('没有脑子级占位：两个 DSH 工作区会各写一份事件流')
}
// 事实预算：factsOf 会按配额裁剪，不是"能塞多少塞多少"
{
  const hasLib = fs.existsSync(path.join(HER, 'lib', 'budget.mjs'))
  const think = readSrc('lib/think.mjs')
  const wired = /fitBudget/.test(think) && /FACT_BUDGET/.test(think)
  if (hasLib && wired) Y('事实有预算（超了按优先级丢，核心永不丢）')
  else W('事实没预算：再加两类就会挤掉"最近"')
}
// 孤儿写入口：存了却没人读（她的原则：读它的人还有她自己）
{
  const files = ['lib', 'hands', 'plugin/lib', 'tools', '.']   // 根目录也要扫（cli.mjs 会读 writeState）
  const srcOf = (f) => { try { return fs.readFileSync(path.join(HER, f), 'utf8') } catch { return '' } }
  const all = []
  for (const d of files) {
    for (const f of fs.readdirSync(path.join(HER, d))) {
      const rel = d === '.' ? f : d + '/' + f
      if (!/\.(mjs|js)$/.test(f)) continue
      try { if (!fs.statSync(path.join(HER, rel)).isFile()) continue } catch { continue }
      all.push({ rel, src: srcOf(rel) })
    }
  }
  const orphans = []
  for (const { rel, src } of all) {
    if (!rel.startsWith('lib/')) continue
    for (const m of src.matchAll(/export (?:async )?function (record|save|append|mark|write)(\w+)/g)) {
      const name = m[1] + m[2]
      const used = all.some((o) => o.rel !== rel && new RegExp('\\b' + name + '\\b').test(o.src))
      if (!used) orphans.push(rel + ':' + name)
    }
  }
  if (!orphans.length) Y('没有孤儿写入口（每个 record/save/append 都有人在读）')
  else W('有写入口没人读：' + orphans.join('、') + '（存了等于没存）')
}

// 账本只在她调的时候出现，且提示词里永远不提（她说"别催"）
{
  const think = readSrc('lib/think.mjs')
  const tc = readSrc('lib/toolcall.mjs')
  const noNudge = !/ledger|账本/.test(think)
  const hasTool = /name: 'ledger'/.test(tc)
  if (noNudge && hasTool) Y('账本只在被调用时出现（提示词里不提，不催她记）')
  else W(`账本可能在催：${noNudge ? '' : '提示词里出现了账本'}${hasTool ? '' : '缺工具'}`)
}
// 真头像：服务端代理 + 客户端盖图（别让浏览器直连腾讯 CDN，CSP 会拦）
{
  const hasLib = fs.existsSync(path.join(HER, 'lib', 'avatar.mjs'))
  const route = /api\/avatar/.test(server)
  const client = readSrc('plugin/lib/client.js')
  const drew = /trow-ava-img/.test(client) && /avatarSrc/.test(client)
  if (hasLib && route && drew) Y('会话列表用真 QQ 头像（同源代理 + 7 天磁盘缓存，失败回落到字）')
  else W(`头像没接全：${hasLib ? '' : '缺 lib/avatar '}${route ? '' : '缺路由 '}${drew ? '' : '客户端没画'}`)
}
// 事件形状契约（欠账⑤）
{
  const hasSchema = fs.existsSync(path.join(HER, 'lib', 'schema.mjs'))
  const wired = /validateEvent/.test(readSrc('lib/store.mjs'))
  if (hasSchema && wired) Y('事件有形状契约（appendEvent 校验，不合法的记日志不拦）')
  else W('事件没形状契约：字段悄悄变了也没人知道')
}
// 安全三件套（2026-10-29 补齐）
{
  const hasOut = fs.existsSync(path.join(HER, 'lib', 'outbound.mjs'))
  const hasGate = fs.existsSync(path.join(HER, 'lib', 'gate.mjs'))
  const q = readSrc('hands/qq.mjs')
  const tc = readSrc('lib/toolcall.mjs')
  const wired = /redact\(r\.text\)/.test(q) && /publicAllowed/.test(tc)
  if (hasOut && hasGate && wired) Y('安全三件齐了（输入标记 / 出站打码 / 公共动作审批门）')
  else W(`安全没齐：${hasOut ? '' : '缺 outbound '}${hasGate ? '' : '缺 gate '}${wired ? '' : '没接线'}`)
}

// 遗忘：派生时冷却，不删数据
{
  const hasForget = fs.existsSync(path.join(HER, 'lib', 'forget.mjs'))
  const wired = /coolHits/.test(readSrc('lib/think.mjs'))
  if (hasForget && wired) Y('遗忘做成派生层冷却（热原话 / 温摘要 / 冷只在很像时说）')
  else W('遗忘没接：老记忆会一直按原话塞进提示词')
}

// 漂移体检 + 认人
{
  const hasDrift = fs.existsSync(path.join(HER, 'tools', 'drift.mjs')) && fs.existsSync(path.join(HER, 'lib', 'drift.mjs'))
  const people = /knownPeople/.test(readSrc('lib/think.mjs'))
  if (hasDrift) Y('漂移体检可跑（tools/drift.mjs，词频指纹 + Jaccard）')
  else W('没有漂移体检')
  if (people) Y('群里认得人（knownPeople 从 encounter 现算）')
  else W('people.mjs 还是孤儿')
}
// API 能力对账（2026-10-29 对着官方文档核过一遍）
{
  const tc = readSrc('lib/toolcall.mjs')
  const hasCache = /prompt_cache_hit_tokens/.test(tc)
  const hasReasoning = /reasoning_content: msg\.reasoning_content/.test(tc)
  if (hasCache && hasReasoning) Y('API 对账：缓存命中率有记账，思考过程会回传')
  else W(`API 对账缺项：${hasCache ? '' : '没记缓存命中 '}${hasReasoning ? '' : '没回传 reasoning_content'}`)
}

// 她能不能看外面的世界：走 DeepSeek 官方 Search / Fetch（缺了这只手她只能对链接说「我打不开」）
{
  const hasNet = fs.existsSync(path.join(HER, 'lib', 'net.mjs'))
  const tools = readSrc('lib/toolcall.mjs')
  const wired = /web_search/.test(tools) && /fetch_url/.test(tools) && /fetchPage/.test(tools)
  if (hasNet && wired) Y('她能看外面了（web_search + fetch_url，走官方 Search/Fetch API）')
  else W('她还没有联网工具：别人发链接她只能说「我打不开」')
}

// 回复要攒着：秒回像脚本（风控），而且他话没说完她就插嘴
{
  if (/batch\.mjs/.test(qq) && /nextWait/.test(qq)) Y('回复是攒着的（等他停手再回，不是逐条秒回）')
  else W('qq.mjs 没接攒话策略：会逐条秒回，容易踩风控')
}

// 日志落盘：两次事故都是静默的，根因是没有现场
{
  const hasLog = fs.existsSync(path.join(HER, 'lib', 'log.mjs'))
  const wired = /log\.mjs/.test(server) && /log\('boot'/.test(server)
  if (hasLog && wired) Y('日志落盘在（插件 boot 失败会写 logs/dsh-herself.log）')
  else W('日志没落盘：插件失败只进宿主 console，出事后没有现场')
}

{
  const d = readSrc('lib/derive.mjs')
  if (/SUPERSEDE_SIMILARITY/.test(d) && /superseded/.test(d)) Y('语义层有 supersede（改口不删旧的）')
  else W('语义层缺 supersede：判断只会累加，不会随时间作废')
}

// 动图抽帧：缺了 lib/gif.mjs，或者 vision 没调 extractFrames，动图就还是只看第一帧
{
  const hasGif = fs.existsSync(path.join(HER, 'lib', 'gif.mjs'))
  const wired = /extractFrames/.test(readSrc('lib/vision.mjs'))
  if (hasGif && wired) Y('动图是抽帧看的（lib/gif.mjs → vision 串帧）')
  else W('动图抽帧没接上：缺 lib/gif.mjs 或 vision.mjs 没调用 extractFrames')
}

if (!/export const inject = \[/.test(server)) P('服务端 inject 不是数组')
// 重复路由：同一路径写两次，后一个永远执行不到（/health 就这么翻过车）
{
  const routes = [...server.matchAll(/p === '([^']+)'/g)].map((m) => m[1])
  const seen = new Set()
  for (const r of routes) {
    if (seen.has(r)) P(`重复路由：${r}（前一个会挡住后一个）`)
    seen.add(r)
  }
}
if (!/startBrain/.test(server)) W('服务端没有 brain 端点')
if (!/readings:/.test(server)) W('服务端 /state 没返回 readings')
if (/runCmd\(/.test(server) && !/schtasks/.test(server)) W('service 里 runCmd 可能已无用')

// 主动发言到底会不会发出去：boot.ps1 启动 wake 时必须带 --send
try {
  const boot = fs.readFileSync(path.join(HER, 'boot.ps1'), 'utf8')
  // 要的是「启动 wake 的那一行」，不是提到 wake.mjs 的任何一行
  // （boot.ps1 里还有按命令行清扫孤儿的那句，别抓错）
  const line = boot.split('\n').find((l) => l.includes("'wake.mjs'")) ?? ''
  if (line.includes("'wake.mjs','--send'") || line.includes('wake.mjs --send')) Y('主动发言已接上 QQ（wake --send）')
  else W('wake 没带 --send：她会自言自语，但不会发给你')
} catch { W('读不到 boot.ps1') }

// 插件用 Windows PowerShell 5.1 跑这些脚本。没有 UTF-8 BOM 时中文注释会按 ANSI 解码，
// 把字符串撑破 → ParserError → 脚本一行都没执行，而且外面只 console.warn，谁也看不见。
// 2026-10-29 就是这么让她在 DSH 重启之后再也没起来过。
try {
  const buf = fs.readFileSync(path.join(HER, 'boot.ps1'))
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) Y('boot.ps1 有 UTF-8 BOM（powershell.exe 5.1 读得对中文）')
  else P('boot.ps1 少了 UTF-8 BOM：插件用 5.1 跑它，中文注释会撑破字符串、脚本静默失败')
} catch { P('读不到 boot.ps1') }

if (!/brainComplete/.test(think)) P('think.mjs 没有 brain 通道')
if (!/liveEvents/.test(think)) P('think.mjs 没过滤 tombstone')
if (!/inferPreference/.test(think)) W('think.mjs 没读她的作息偏好（preference）')
try {
  const wakeSrc = fs.readFileSync(path.join(HER, 'wake.mjs'), 'utf8')
  if (!/effectivePrefs/.test(wakeSrc)) P('wake.mjs 还在用写死的节奏，没读她的偏好')
  else Y('主动发言读的是她的偏好（prefs），不是硬编码')
} catch { P('读不到 wake.mjs') }
if (!/reconnect|setTimeout\(\s*connect/.test(qq)) W('qq.mjs 没有断线重连（OneBot 运行时重启后不会自己接回来）')
if (!/inferClaim/.test(qq) && !/inferClaim/.test(think)) W('没有任何地方做 inferred 解读')

// ---------------------------------------------------------------- 4. 运行时
const exists = (p) => fs.existsSync(path.join(HER, p))
if (exists('logs/brain.json')) {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(HER, 'logs/brain.json'), 'utf8'))
    const up = await new Promise((res) => {
      const s = net.connect({ port: b.port, host: '127.0.0.1' })
      s.setTimeout(800)
      s.on('connect', () => { s.destroy(); res(true) })
      s.on('error', () => res(false))
      s.on('timeout', () => { s.destroy(); res(false) })
    })
    up ? Y(`brain 端点在线（:${b.port}）`) : P(`brain.json 指向 :${b.port}，但端口不通`)
  } catch (e) { P(`brain.json 坏了：${e.message}`) }
} else P('没有 brain.json（DSH 未加载插件或 brain 没起来）')

// 编码坑：PowerShell 5.1 的 Set-Content -Encoding UTF8 会写 BOM，JSON.parse 直接抛
for (const f of ['logs/pids.json', 'logs/brain.json', 'secrets/qq.json']) {
  try {
    const buf = fs.readFileSync(path.join(HER, f))
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      P(`${f} 带 BOM（JSON.parse 会失败，读出来是空对象）`)
    } else {
      JSON.parse(buf.toString('utf8'))
      Y(`${f} 无 BOM 且可解析`)
    }
  } catch (e) { W(`${f} 读不到或解析失败：${e.message}`) }
}

for (const f of ['heartbeat-qq.txt', 'heartbeat-wake.txt']) {
  try {
    const age = (Date.now() - fs.statSync(path.join(HER, 'logs', f)).mtimeMs) / 1000
    age < 90 ? Y(`${f} 新鲜（${Math.round(age)}s）`) : P(`${f} 已 ${Math.round(age)}s 没更新，进程可能死了`)
  } catch { P(`缺少 ${f}`) }
}

for (const f of ['secrets/onebot.token', 'secrets/qq.json']) {
  exists(f) ? Y(`${f} 存在`) : P(`${f} 缺失`)
}
if (exists('secrets/deepseek.key')) Y('secrets/deepseek.key 存在（看图主通道）')

// ---------------------------------------------------------------- 输出
console.log('\n=== 通过 ===')
for (const m of ok) console.log('  ✓ ' + m)
if (warnings.length) { console.log('\n=== 警告 ==='); for (const m of warnings) console.log('  ! ' + m) }
if (problems.length) { console.log('\n=== 问题 ==='); for (const m of problems) console.log('  ✗ ' + m) }
console.log(`\n结果：${ok.length} 通过 / ${warnings.length} 警告 / ${problems.length} 问题`)
process.exit(problems.length ? 1 : 0)
