// test/avatar.mjs —— QQ 头像：取谁、怎么取、取不到怎么办
//
// 2026-10-29 主人说「头像样式想换成真正的 QQ 头像图」。
// 关键不在拼 URL，而在**不让浏览器直连腾讯 CDN**：页面有 CSP，跨域图会被拦，
// 失败就是一坨破图。所以走插件同源代理 + 磁盘缓存，取不到就露出垫底的那个字。
import { targetOf, fromThreadKey, sniffImage } from '../lib/avatar.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 取谁的
{
  const u = targetOf({ uin: 'REDACTED_QQ' })
  ok(u.ok && u.url.includes('nk=REDACTED_QQ'), '私聊：拼出个人头像地址', u.url)
  ok(u.key === 'user-REDACTED_QQ', '缓存键按人分开', u.key)

  const g = targetOf({ group: '647334703' })
  ok(g.ok && g.url.startsWith('https://p.qlogo.cn/gh/647334703/'), '群：拼出群头像地址', g.url)
  ok(g.kind === 'group', '标出这是群头像')

  ok(!targetOf({ uin: 'abc' }).ok, 'QQ 号不是数字就不取（防止拼出任意的 URL）')
  ok(!targetOf({ uin: '123' }).ok, '太短的不当 QQ 号')
  ok(!targetOf({}).ok, '什么都没给就不取')
  ok(targetOf({ group: '647334703', uin: '1' }).kind === 'group', '群优先（群聊里显示群头像）')
}

// ---------------------------------------------------------------- 从会话 key 拆
{
  ok(JSON.stringify(fromThreadKey('qq:private:REDACTED_QQ')) === '{"uin":"REDACTED_QQ"}', '私聊 key → uin')
  ok(JSON.stringify(fromThreadKey('qq:group:647334703')) === '{"group":"647334703"}', '群 key → group')
  ok(fromThreadKey('__legacy') === null && fromThreadKey('') === null, '老数据/空 key 不硬拆')
}

// ---------------------------------------------------------------- 拿回来的字节是什么
{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])
  ok(sniffImage(png) === 'image/png', '认得出 PNG')
  ok(sniffImage(jpg) === 'image/jpeg', '认得出 JPEG')
  ok(sniffImage(Buffer.from('<html>不是图片</html>')) === '', '不是图就返回空（服务端会当失败处理）')
  ok(sniffImage(Buffer.alloc(0)) === '', '空的不炸')
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)