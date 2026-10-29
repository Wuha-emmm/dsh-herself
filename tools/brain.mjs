// tools/brain.mjs —— 脑子锁的运维入口
//
// 一份生活只能有一个「会思考的进程」。这个工具看/清那个占位。
//
//   node tools/brain.mjs status     # 现在谁在思考、还活着吗
//   node tools/brain.mjs release    # 强制让出（进程已经死了但锁没清时用）
//
// 正常情况不需要它：进程退出会自己释放，僵尸锁超过 90 秒也能被别人接手。
import { brainStatus, releaseBrain, STALE_MS } from '../lib/brain.mjs'

const ROOT = 'E:/DSH-herself/life'
const cmd = String(process.argv[2] ?? 'status').trim()
const st = brainStatus(ROOT)

if (cmd === 'release') {
  const ok = releaseBrain(ROOT)
  console.log(ok ? '已让出（如果还有进程在跑，它下次心跳会重建锁）' : '没让出：锁不在本进程名下，或本来就没有')
  process.exit(0)
}

if (!st.owner) {
  console.log('没有大脑在占位（谁都可以起）')
  process.exit(0)
}
const age = Math.round(st.ageMs / 1000)
console.log(`持有者 pid ${st.owner.pid}｜角色 ${st.owner.role ?? '?'}｜心跳 ${age} 秒前｜${st.live ? '活着' : '已过期（可被接手）'}`)
if (st.owner.build) console.log(`代码出厂时间 ${st.owner.build}`)
if (!st.live) console.log(`（超过 ${STALE_MS / 1000} 秒没心跳就算过期）`)