// test/smoke.mjs —— 端到端冒烟：一条假消息进来，她真的回了话
//
// 为什么要有这条：26 套测试全是零件级的（纯函数、渲染树、命令拼接），
// 没有一条验证「她真的说话了」。出事的时候（进程死了、锁抢不到、攒话卡住）
// 零件测试全绿，她却一个字都没回。
//
// 做法：不连真 QQ、不调真模型（省钱、快、可重复）：
//   · 假插座喂一条私聊消息；
//   · 注入假「脑子」，固定回一句；
//   · 全局 WebSocket 也换成桩，只记录她发出去的 OneBot 动作。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 隔离：别去抢真 listener 的岗位锁，也别往真 logs 里写心跳
const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'her-smoke-env-'))
process.env.DSH_HERSELF_LOCK_DIR = path.join(iso, 'locks')
process.env.DSH_HERSELF_LOG_DIR = path.join(iso, 'logs')
fs.mkdirSync(process.env.DSH_HERSELF_LOCK_DIR, { recursive: true })
fs.mkdirSync(process.env.DSH_HERSELF_LOG_DIR, { recursive: true })

// OneBot 动作全记在这里（send() 会自己新开一条连接，所以只能从全局桩上抓）
const actions = []
class FakeWS {
  constructor(url) {
    this.url = url
    this.ls = {}
    setTimeout(() => this.fire('open', {}), 0)
  }
  addEventListener(type, cb) { (this.ls[type] ||= []).push(cb) }
  fire(type, ev) { for (const cb of this.ls[type] ?? []) cb(ev) }
  send(raw) {
    const a = JSON.parse(String(raw))
    actions.push(a)
    setTimeout(() => this.fire('message', { data: JSON.stringify({ echo: a.echo, status: 'ok', retcode: 0, data: { message_id: 1 } }) }), 0)
  }
  close() {}
}
globalThis.WebSocket = FakeWS

const { listen } = await import('../hands/qq.mjs')
const { readEvents } = await import('../lib/store.mjs')

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'her-smoke-'))
const listeners = {}
const socket = {
  addEventListener(type, cb) { (listeners[type] ||= []).push(cb) },
  send(raw) { actions.push(JSON.parse(String(raw))) },
  close() {},
}
const emit = (type, data) => (listeners[type] ?? []).forEach((cb) => cb(data))

const asked = []
const chat = async (args) => {
  asked.push(args)
  return { text: '在。你说。', trace: { reasoning: '冒烟', tools: 0 } }
}

const ev = {
  post_type: 'message',
  message_type: 'private',
  self_id: 30003,
  time: Math.floor(Date.now() / 1000),
  message_id: 90001,
  user_id: 10001,
  sender: { user_id: 10001, nickname: '主人' },
  message: [{ type: 'text', data: { text: '在吗' } }],
  raw_message: '在吗',
}

const me = listen({ root, reply: true, chat, socket })
emit('message', { data: JSON.stringify(ev) })

console.log('……等她回话（攒话 4.5 秒 + 打字延迟）')
const deadline = Date.now() + 25000
while (!actions.some((a) => a.action === 'send_private_msg') && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 200))
}
me.stop()

// ---------------------------------------------------------------- 断言
const sent = actions.find((a) => a.action === 'send_private_msg')
ok(readEvents(root).some((e) => e.type === 'encounter' && /在吗/.test(e.text)), '① 消息先落进事件流（不是先回话）')
ok(asked.length === 1, '② 脑子被叫了一次（不多不少）', String(asked.length))
ok(String(asked[0]?.userText ?? '').includes('在吗'), '③ 她看到的是那句话')
ok(String(asked[0]?.thread ?? '') === 'qq:private:10001', '④ 知道这是哪条线（私聊）', String(asked[0]?.thread))
ok(Boolean(sent), '⑤ 回复真的发出去了（OneBot 动作里有 send_private_msg）')
ok(String(sent?.params?.message ?? '').includes('在。'), '⑥ 发的是她说的那句', JSON.stringify(sent?.params?.message ?? ''))
ok(Number(sent?.params?.user_id) === 10001, '⑦ 回复发给对的人', String(sent?.params?.user_id))
// 她的回话落盘是 think 的职责（这里注入了假脑子，所以不落）——那条由 test/tools.mjs 覆盖
ok(asked[0]?.ctx?.publicSurface === false, '⑧ 私聊不当作公开面（群里发表情才要审批）', String(asked[0]?.ctx?.publicSurface))
ok(String(asked[0]?.causeId ?? '').length > 0, '⑨ 带上触发她的是哪条事件（能顺藤摸回去）')

fs.rmSync(root, { recursive: true, force: true })
fs.rmSync(iso, { recursive: true, force: true })
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
