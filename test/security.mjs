// test/security.mjs —— 出站打码 + 公共动作审批门
//
// 两件事都是"不会报错、但出事很贵"的类型：
//   ① 她把 secrets/ 里的 key 复述出去 → 一条消息飞到群里，撤回也晚了；
//   ② 谁都能让她在群里发表情 → 公共动作没有门槛。
// 这个文件守的是：该打的码打掉、该放行的别误杀、许可过期就不再算数。
import { redact, looksSecret } from '../lib/outbound.mjs'
import { publicAllowed, APPROVAL_TTL_MS } from '../lib/gate.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 出站打码：该打的
const SECRETS = [
  ['sk-abcdefghijklmnopqrstuvwx', 'sk- 密钥'],
  ['Bearer abcdefghijklmnop1234', 'Bearer'],
  ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'GitHub'],
  ['AKIAIOSFODNN7EXAMPLE', 'AWS'],
  ['jdbc://user:pass123456@db.local/x', '连接串'],
  ['-----BEGIN RSA PRIVATE KEY-----\nAAA\n-----END RSA PRIVATE KEY-----', '私钥'],
]
for (const [sample, kind] of SECRETS) {
  const r = redact(`你看这个：${sample}`)
  ok(r.hits.length > 0, `打得掉：${kind}`, '没命中')
  ok(!r.text.includes(sample.slice(0, 12)), `打完码原文不在了：${kind}`, r.text.slice(0, 40))
}

// ---------------------------------------------------------------- 出站打码：不该误杀
const CLEAN = [
  '今天好累啊，晚点再说',
  '表情 id 是 0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  '群号 935190036，你看这个',
  '我这边只有这个文件夹的权限',
  'QQ 号 REDACTED_QQ',
]
for (const s of CLEAN) ok(!looksSecret(s).length, `不误杀：${s.slice(0, 14)}`, looksSecret(s).join('/'))

// ---------------------------------------------------------------- 打码后仍然是一句人话
{
  const r = redact('我的 key 是 sk-abcdefghijklmnopqrstuvwx，别外传')
  ok(r.text.startsWith('我的 key 是') && r.text.endsWith('别外传'), '只替换密钥，前后文保留', r.text)
  ok(r.text.length < 40, '不会把整句吞掉', String(r.text.length))
}

// ---------------------------------------------------------------- 审批门
const t0 = Date.parse('2026-10-29T10:00:00+08:00')
const ev = (ts, value) => ({ type: 'meta', ts, meta: { key: 'public-approval', value } })

{
  const none = publicAllowed([], t0)
  ok(!none.allowed, '没许可就是不许', none.reason)
  ok(/approve/.test(none.reason), '而且告诉她怎么给', none.reason)

  const okNow = publicAllowed([ev('2026-10-29T09:00:00+08:00', true)], t0)
  ok(okNow.allowed, '一小时前给的许可有效', okNow.reason)

  const expired = publicAllowed([ev('2026-10-27T09:00:00+08:00', true)], t0)
  ok(!expired.allowed, `超过 ${APPROVAL_TTL_MS / 3600000} 小时就过期`, expired.reason)

  const revoked = publicAllowed([ev('2026-10-29T09:00:00+08:00', true), ev('2026-10-29T09:30:00+08:00', false)], t0)
  ok(!revoked.allowed && /收回/.test(revoked.reason), '收回之后立刻失效', revoked.reason)

  const reGrant = publicAllowed([ev('2026-10-29T09:00:00+08:00', true), ev('2026-10-29T09:30:00+08:00', false), ev('2026-10-29T09:50:00+08:00', true)], t0)
  ok(reGrant.allowed, '收回后再给也认（取最后一条）', reGrant.reason)

  const garbage = publicAllowed([ev('看不懂的时间', true)], t0)
  ok(!garbage.allowed, '时间读不出来就别放行', garbage.reason)
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)