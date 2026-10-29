// test/commit.mjs —— 承诺的两头：抽得准，放得下
//
// 2026-10-29 实测的事故：一条 11:14 误抽的"承诺"（其实是她在追问对方），
// 没有任何关闭机制，于是之后三个小时她每句话都绕回同一件事——连主人问
// "你上下文多长"都要追一句"那两件你还没交底"。
// 所以这里守两件事：① 追问不是承诺；② 承诺会过期。
import { extractCommitment, openCommitments, COMMIT_TTL_HOURS, COMMIT_MAX } from '../lib/commit.mjs'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

// ---------------------------------------------------------------- 抽取：什么算她许下的事
ok(Boolean(extractCommitment('说好了，明早我把那份记录整理给你。')), '「说好了 + 具体动作」算承诺')
ok(Boolean(extractCommitment('答应你，今晚不熬夜了。')), '「答应你」算承诺')
ok(Boolean(extractCommitment('这笔账我记着，回头补上。')), '「这笔账记着」算承诺')

// 事故原句：她的**追问**，不是承诺
const bad = '你是说那两件没给全的吧？镜头里到底逮着什么，还有你说的"奇怪"指哪儿。这俩你一直没交底，我记着呢。别光起个头就撂下，把缺的那截说清楚。'
// 2026-10-29 第二次收：三条承诺全是误抽，都栽在「答应」这个词上——
// 列举类别（「答应下来的事」）、否定（「并没有答应什么」）都不算她许诺。
ok(extractCommitment('真要记，就记该办的事：你答应过的、改口的、要睡没睡的。') === null, '「你答应过的」是在列举，不是她许诺')
ok(extractCommitment('这条只是我的判断，并没有答应什么。') === null, '否定句不算许诺')
ok(extractCommitment('行，那我挑着记：答应下来的事。') === null, '「答应下来的事」是名词短语，不算')
ok(Boolean(extractCommitment('说好了，明早我把那份记录整理给你。')), '句首「说好了」算（不带主语也算）')
ok(extractCommitment(bad) === null, '追问/催对方交底，不是承诺（事故原句）')
ok(extractCommitment('你今天看了什么？') === null, '普通问句不是承诺')
ok(extractCommitment('好') === null, '太短的不是承诺')

// ---------------------------------------------------------------- 过期与限量
function makeCommit(ts, text, status = 'open') {
  return { type: 'commitment', ts, text, meta: { status } }
}
const now = Date.parse('2026-10-29T14:00:00+08:00')
const fresh = makeCommit('2026-10-29T13:30:00+08:00', '说好了，等会儿把记录发你。')
const stale = makeCommit('2026-10-29T03:14:46+08:00', '你是说那两件没给全的吧？…')
const done = makeCommit('2026-10-29T13:40:00+08:00', '说好了，明天给你。', 'done')

const open = openCommitments([stale, fresh, done], { now })
ok(open.length === 1 && open[0].text.includes('等会儿'), '过期的和已完成的都不再催，只留新鲜的', JSON.stringify(open.map((c) => c.text.slice(0, 12))))
ok(openCommitments([stale], { now }).length === 0, '事故原句那条（2.5 小时前的误抽）不再进上下文')

const many = Array.from({ length: 5 }, (_, i) => makeCommit(new Date(now - (5 - i) * 60000).toISOString(), `说好了，第 ${i} 件我补上。`))
ok(openCommitments(many, { now }).length === COMMIT_MAX, `最多只挂 ${COMMIT_MAX} 条（多了她会变成催债的）`)
ok(COMMIT_TTL_HOURS > 0 && COMMIT_TTL_HOURS <= 24, 'TTL 是个合理的小时数', String(COMMIT_TTL_HOURS))

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
