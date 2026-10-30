// tools/inbox.mjs —— DS/主人这一侧的邮箱操作台
//
//   node tools/inbox.mjs                     # 看有哪些在等我处理
//   node tools/inbox.mjs all                 # 看全部
//   node tools/inbox.mjs reply "解释内容"      # 回给她（她会看到）
//   node tools/inbox.mjs order "修复指令"      # 主人口吻的指令（也算给她的话）
import { all, pendingForDsh, pendingForHer, post, markSeen, claimNext, answer, release, openClaim } from '../lib/inbox.mjs'
import { httpCreds, readOwner } from '../lib/owner.mjs'
import { splitMessage } from '../lib/split.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 仓库根按本文件位置推导：换台机器/换个目录拷过去也能跑（2026-10-30 整理）
const HER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ROOT = path.join(HER, 'life')
const [cmd, ...rest] = process.argv.slice(2)
const rest_all = () => rest

if (cmd === 'reply' || cmd === 'order') {
  const text = rest.join(' ').trim()
  if (!text) { console.error('要写内容'); process.exit(1) }
  const e = post(ROOT, { from: cmd === 'order' ? 'owner' : 'dsh', kind: cmd === 'order' ? 'order' : 'answer', text })
  console.log(`${cmd === 'order' ? '指令' : '回复'}已投递：${e.id}`)
  process.exit(0)
}

if (cmd === 'next') {
  // status / budget 这两类 DSH 能立刻答（本地数据，不用人看），直接答掉再继续
  {
    const quick = pendingForDsh(ROOT).find((x) => x.kind === 'status' || x.kind === 'budget')
    if (quick) {
      let body = ''
      try {
        const st = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'logs', 'audit-status.json'), 'utf8'))
        if (quick.kind === 'status') body = `体检 ${st.ok} 通过 / ${(st.warnings ?? []).length} 警告 / ${(st.problems ?? []).length} 问题`
        else {
          const ev = (await import('../lib/store.mjs')).readEvents(ROOT)
          const th = (await import('../lib/think.mjs')).factsOf(ev, Date.now(), '', '', { budgetWatch: false })
          body = `提示词 ${th.budget.used} / ${th.budget.cap} token`
        }
      } catch (err) { body = String(err?.message ?? err) }
      answer(ROOT, quick.id, body)
      console.log('秒答:', quick.kind, '→', body)
      process.exit(0)
    }
  }
  // 一次只领一条：领了别的地方就领不到（她的要求：避免重复执行）
  const r = claimNext(ROOT)
  if (r.ok) {
    console.log('领到:' , r.item.id)
    console.log('内容:', r.item.text)
  } else if (r.busy) {
    console.log('已经有一条在处理（' + r.busy.ref + '，' + Math.round(r.busy.ageMs / 1000) + ' 秒前领的），先答完它')
  } else {
    console.log('没有待处理的')
  }
  process.exit(0)
}

if (cmd === 'done') {
  const [ref, ...rest] = rest_all()
  const text = rest.join(' ').trim()
  if (!ref || !text) { console.error('用法: done <ref> <回复内容>'); process.exit(1) }
  answer(ROOT, ref, text)
  console.log('已回复并解锁:', ref)

  // 来源是主人的私聊 → 直接发到他 QQ，不等她下一轮
  const q = all(ROOT).find((x) => x.id === ref)
  const src = q?.source
  const relay = !rest.includes('--no-relay') && src?.isOwner !== false && String(src?.thread ?? '').startsWith('qq:private:')
  if (relay) {
    try {
      const c = httpCreds(ROOT.replace(/[\\/]life$/, ''))
      const owner = readOwner(ROOT.replace(/[\\/]life$/, ''))
      if (c && owner) {
        for (const part of splitMessage('DSH 那边回她了（她转过来）：\n\n' + text)) {
          const r = await fetch(`${c.base}/send_private_msg`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
            body: JSON.stringify({ user_id: Number(owner), message: part }),
            signal: AbortSignal.timeout(20000),
          })
          const j = await r.json().catch(() => ({}))
          console.log(j.retcode === 0 ? '  转发到主人 QQ ✓' : `  转发失败 retcode ${j.retcode}`)
        }
      }
    } catch (err) { console.log('  转发失败:', String(err?.message ?? err)) }
  }
  process.exit(0)
}

if (cmd === 'release') {
  const [ref, ...rest] = rest_all()
  release(ROOT, ref, rest.join(' '))
  console.log('已放回:', ref)
  process.exit(0)
}

if (cmd === 'all') {
  for (const e of all(ROOT)) console.log(String(e.at).slice(11, 19), e.from.padEnd(6), e.kind.padEnd(9), e.text.slice(0, 100))
  process.exit(0)
}

if (cmd === 'seen') { markSeen(ROOT, 'dsh'); console.log('她把的未读都标成已读了'); process.exit(0) }

const mine = pendingForDsh(ROOT)
const hers = pendingForHer(ROOT)
console.log(`等我处理：${mine.length} 条`)
for (const e of mine) console.log('  ', String(e.at).slice(11, 19), e.text.slice(0, 110))
console.log(`她还没看：${hers.length} 条`)
for (const e of hers) console.log('  ', String(e.at).slice(11, 19), e.from, e.text.slice(0, 80))