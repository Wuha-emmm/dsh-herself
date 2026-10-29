// hands/setup-onebot.mjs —— 给 OneBot11 运行时加一个本地 WS 服务端（SnowLuma / NapCat 通用）
// 用法：node hands/setup-onebot.mjs <onebot11_xxx.json> <token 文件路径>
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const cfgPath = process.argv[2]
const tokenFile = process.argv[3]
if (!cfgPath || !tokenFile) { console.error('用法：node hands/setup-onebot.mjs <cfg.json> <token.txt>'); process.exit(2) }
if (!fs.existsSync(cfgPath)) { console.error('找不到配置文件：' + cfgPath); process.exit(2) }

fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
const token = fs.existsSync(tokenFile) && fs.readFileSync(tokenFile, 'utf8').trim()
  ? fs.readFileSync(tokenFile, 'utf8').trim()
  : crypto.randomBytes(16).toString('hex')
fs.writeFileSync(tokenFile, token, { mode: 0o600 })

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
cfg.network = cfg.network ?? {}
cfg.network.websocketServers = [{
  name: 'her-ws',
  enable: true,
  host: '127.0.0.1',
  port: 3001,
  messagePostFormat: 'array',
  reportSelfMessage: true,
  token,
  debug: false,
  heartInterval: 30000,
}]
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
console.log(`ok: ws://127.0.0.1:3001  token 长度=${token.length}  已写入 ${tokenFile}`)
