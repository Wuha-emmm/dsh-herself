// test/client.mjs —— 浏览器半边（plugin/lib/client.js）的加载测试
//
// 为什么值得单独立一条：那个文件是**一个整体**，工厂里任何一句抛错，
// 连设置页都一起打不开。这里用一个假 React 在 node 里把它跑起来，
// 验三件事：① 能被 __ModuleLoader__ 加载；② 三个槽都注册了；③ 两个面板能渲染出树。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(here, '..', 'plugin', 'lib', 'client.js'), 'utf8')

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  if (cond) { pass += 1; console.log(`✓ ${label}`) }
  else { fail += 1; console.log(`✗ ${label}${extra ? ' — ' + extra : ''}`) }
}

let captured = null
class Component { constructor(props) { this.props = props || {} } }
// useState 的替身：按顺序从这个队列取值，用来把「有数据的 LivePage」渲染出来
let stateQueue = []
const React = {
  Component,
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [stateQueue.length ? stateQueue.shift() : (typeof init === 'function' ? init() : init), () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}

const sandbox = {
  window: { __ModuleLoader__: { load: (def) => { captured = def.factory((n) => (n === 'react' ? React : (() => { throw new Error('unexpected require: ' + n) })())) } } },
  console,
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  document: { hidden: true, head: { appendChild() {} }, createElement: () => ({}) },
  navigator: { userAgent: 'node' },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
}
vm.createContext(sandbox)
vm.runInContext(SRC, sandbox)

ok(Boolean(captured), 'client.js 能被 __ModuleLoader__ 装载')
ok(captured && typeof captured.apply === 'function', '导出了 apply')
ok(captured && Array.isArray(captured.inject) && captured.inject.includes('slots'), 'inject 里有 slots')

// ---------------------------------------------------------------- 槽位注册
const registered = []
const ctx = {
  effect: (fn) => { fn() },
  slots: {
    inject: (name, fn) => { fn() },
    register: (meta, comp) => { registered.push({ meta, comp }); return () => {} },
  },
}
captured.apply(ctx)
const names = registered.map((r) => r.meta.name)
ok(names.includes('settings.section'), '注册了设置页', JSON.stringify(names))
// 2026-10-29 主人说左栏那一行没必要了：球改成挂在全局浮层上（宿主的 shell.overlay）
ok(names.includes('shell.overlay'), '悬浮球挂在全局浮层上（哪一页都在）', JSON.stringify(names))
ok(!names.includes('sidebar.panellist'), '不再占左栏那一行')
ok(!names.includes('main'), '不再占主面板（球自己就是入口）')

const ballSlot = registered.find((r) => r.meta.name === 'shell.overlay')
ok(ballSlot?.meta.id === 'herself-live', '浮层条目的 id 是 herself-live', String(ballSlot?.meta.id))
ok(typeof ballSlot?.comp === 'function', '浮层里挂的是个组件')

// ---------------------------------------------------------------- 渲染：会话列表
const flat = (kids) => (kids ?? []).flatMap((c) => (Array.isArray(c) ? flat(c) : (c == null ? [] : [c])))
// 递归遍历整棵树（列表项藏在 sec > div 里面，只摊平一层找不到）
const walk = (node, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out }
  out.push(node)
  for (const c of node.children ?? []) walk(c, out)
  return out
}
const cls = (c) => (c && c.props && typeof c.props.className === 'string' ? c.props.className : '')

// 状态顺序：data / err / view / sel
const page = captured.LivePage()
ok(page && page.type === 'div' && cls(page).startsWith('dlive'), 'LivePage 能渲染出根节点', cls(page))
ok(cls(page) === 'dlive listv', '默认进的是会话列表（不是把所有会话混在一条时间线里）', cls(page))

const data = {
  ok: true, traced: 2,
  turns: [
    { id: 'E1', ts: '2026-10-29T14:00:00+08:00', type: 'encounter', who: '10001', group: '', thread: 'qq:private:10001', text: '主人：他在吗', trace: null },
    { id: 'U1', ts: '2026-10-29T14:00:10+08:00', type: 'utterance', who: '她', group: '', thread: 'qq:private:10001', text: '在。', trace: { reasoning: 120, tools: 1, tokens: 60 } },
    { id: 'E2', ts: '2026-10-29T14:05:00+08:00', type: 'encounter', who: '777', group: '20002', thread: 'qq:group:20002', text: '[群 20002] 困：@她 看戏', trace: null },
    { id: 'U2', ts: '2026-10-29T14:05:10+08:00', type: 'utterance', who: '她', group: '20002', thread: 'qq:group:20002', text: '票钱还没谈呢。', trace: null },
  ],
}
// 列表视图：data / err / 'list' / sel
stateQueue = [data, '', 'list', '']
const listPage = captured.LivePage()
const trows = walk(listPage).filter((c) => cls(c) === 'trow')
ok(trows.length === 2, '两个会话分开成两行（私聊一条、群一条）', String(trows.length))
const secs = walk(listPage).filter((c) => cls(c) === 'sec')
ok(secs.length === 2, '按「私聊 / 群聊」分组，而不是混在一起', String(secs.length))
const rowNames = trows.map((r) => {
  const el = walk(r).find((c) => cls(c) === 'trow-name')
  return String(el?.children?.[0] ?? '')
})
ok(rowNames.some((n) => n.includes('主人')), '私聊那行显示的是对方名字', JSON.stringify(rowNames))
ok(rowNames.some((n) => n.includes('20002')), '群那行显示的是群号', JSON.stringify(rowNames))
const counts = trows.map((r) => {
  const el = walk(r).find((c) => cls(c) === 'trow-count')
  return String(el?.children?.[0] ?? '')
})
ok(counts.every((n) => n === '2'), '每行带消息条数', JSON.stringify(counts))
const previews = trows.map((r) => {
  const el = walk(r).find((c) => cls(c) === 'trow-last')
  return String(el?.children?.[0] ?? '')
})
ok(previews.every((s) => s.length > 0), '每行都有预览文字（以前这里是空的：函数组件没被渲染）', JSON.stringify(previews))
ok(Boolean(walk(trows[0]).find((c) => cls(c).includes('trow-ava'))), '每行左边有圆头像')

// ---------------------------------------------------------------- 渲染：进到某条会话（三级导航的第二级）
{
  stateQueue = [data, '', 'qq:private:10001', '']
  const conv = captured.LivePage()
  ok(cls(conv) === 'dlive', '会话页根节点是 dlive', cls(conv))
  const feedC = walk(conv).find((c) => cls(c) === 'feed')
  ok(Boolean(feedC), '会话页有一栏对话流')
  ok(!walk(conv).some((c) => cls(c) === 'detail'), '不再有挤在右边的第二栏（430px 放不下）')
  // 'msgs' 容器也会 startsWith('msg')，只认真正的消息行
  const msgsC = walk(conv).filter((c) => cls(c).split(' ')[0] === 'msg')
  ok(msgsC.length === 2, '只显示这条会话的 2 条（群聊不串进来）', String(msgsC.length))
  const rightC = msgsC.find((r) => cls(r).includes('right'))
  const leftC = msgsC.find((r) => cls(r).includes('left'))
  ok(Boolean(rightC) && Boolean(leftC), '她的靠右、他的靠左')
  ok(cls(rightC?.children?.[0]).includes('bub her'), '她说的话是「她」的气泡')
  ok(Boolean(walk(conv).find((c) => cls(c) === 'msgs')), '消息装在可滚动的容器里（才能贴底）')
  const order = msgsC.map((r) => cls(r).includes('right') ? 'her' : 'him')
  ok(order[0] === 'him' && order[1] === 'her', '顺序跟 QQ 一样：上旧下新', JSON.stringify(order))
  const seps = walk(conv).filter((c) => cls(c) === 'sep')
  ok(seps.length === 1, '同一段对话只在开头插一个时间条（间隔不到 10 分钟不插）', String(seps.length))
  // 进来要贴底显示最新那条，而不是停在最上面
  ok(/dataset\.seen/.test(SRC) && /el\.scrollTop = el\.scrollHeight/.test(SRC), '进会话先贴底（显示最新的，不是最旧的）')
  ok(/思考 120 字/.test(String(walk(rightC).find((c) => cls(c) === 'badge')?.children?.[0] ?? '')), '气泡里带「思考 N 字」')
}

// ---------------------------------------------------------------- 渲染：点开某一轮（第三级，占满整卡）
{
  stateQueue = [data, '', 'qq:private:10001', 'U1']
  const turn = captured.LivePage()
  const backBtn = walk(turn).find((c) => cls(c) === 'back')
  ok(Boolean(backBtn) && typeof backBtn.props.onClick === 'function', '这一层有 ← 返回对话')
  ok(!walk(turn).some((c) => cls(c).startsWith('msg')), '这一层不再显示消息列表（整卡给思考）')
  ok(typeof walk(turn).find((c) => typeof c.type === 'function')?.type === 'function', '里面挂的是 LiveTurn（那一轮的详情）')
}
// ---------------------------------------------------------------- 悬浮球外壳
{
  ok(typeof captured.LiveShell === 'function', '导出了悬浮球外壳')
  const sh = captured.LiveShell()
  ok(cls(sh) === 'dshell', '外壳根节点是 dshell', cls(sh))
  const kids = flat(sh.children).filter(Boolean)
  const ball = kids.find((c) => cls(c).includes('dshell-ball'))
  ok(Boolean(ball), '右下角那个球在')
  const ballTxt = walk(ball).find((c) => cls(c).includes('dshell-ball-txt'))
  ok(String(ballTxt?.children?.[0] ?? '') === '她', '收起时球上写「她」（拉不到头像时的兜底）', String(ballTxt?.children?.[0]))
  const ballImg = walk(ball).find((c) => cls(c) === 'dshell-ball-img')
  ok(String(ballImg?.props?.src || '').includes('/avatar?self=1'), '球面接的是她自己的 QQ 头像', String(ballImg?.props?.src))
  ok(typeof ballImg?.props?.onError === 'function', '头像拉不到会隐藏，退回那个字')
  const card = kids.find((c) => cls(c).includes('dshell-card'))
  ok(Boolean(card) && !cls(card).includes('on'), '默认收起：卡片在但没展开（靠 CSS 隐藏，才能做动画）')
  ok(card?.children?.[0]?.props?.active === false, '收起时不轮询（active=false）')
  ok(card?.props?.style?.transformOrigin, '卡片的缩放原点跟着吸附边（左上/右上）', JSON.stringify(card?.props?.style))
  const ballSlot2 = registered.find((r) => r.meta.name === 'shell.overlay')
  ok(ballSlot2?.comp === captured.LiveShell, '浮层里挂的是外壳（点了才展开）')
}

// ---------------------------------------------------------------- 展开态（吸在左边）
{
  // 状态顺序：open / pos / drag / backTick / grabbing
  stateQueue = [true, { side: 'left', top: 120 }, { active: false }, 0, false]
  const sh = captured.LiveShell()
  const kids = flat(sh.children).filter(Boolean)
  const ball = kids.find((c) => cls(c).includes('dshell-ball'))
  const card = kids.find((c) => cls(c).includes('dshell-card'))
  ok(cls(card).includes('on'), '展开时卡片带 on 类（触发缩放动画）', cls(card))
  ok(ball?.props?.style?.left === 12, '球吸在左边时 left = 12', JSON.stringify(ball?.props?.style))
  ok(card?.props?.style?.left === 12, '卡片跟着从左边展开', JSON.stringify(card?.props?.style))
  ok(card?.children?.[0]?.props?.active === true, '展开时才轮询')
  ok(typeof card?.children?.[0]?.props?.onRootBack === 'function', '外壳给了「已经在最外层就收起」的回调')
}
const B = captured.BALL_SIZE   // 球的边长（测试跟着实现走，不写死）
// ---------------------------------------------------------------- 拖拽吸附
{
  const { snapSide, clampBallTop } = captured
  ok(typeof snapSide === 'function' && typeof clampBallTop === 'function', '导出了吸附/夹取两个纯函数')
  ok(snapSide(100, 1200) === 'left', '落点在左半屏 → 吸左边')
  ok(snapSide(900, 1200) === 'right', '落点在右半屏 → 吸右边')
  ok(snapSide(600, 1200) === 'right', '正好中间按右边算（不抖）')
  ok(clampBallTop(-50, 800) === 8, '往上拖出界 → 夹在 8px')
  ok(clampBallTop(9999, 800) === 800 - B - 8, '往下拖出界 → 夹在视口内')
  ok(clampBallTop(300, 800) === 300, '正常范围原样')
  ok(Number.isFinite(clampBallTop(0, 0)), '视口高度拿不到时也不出 NaN')
  const { ballX, clampBallX } = captured
  ok(ballX('left', 1200) === 12, '贴左边时 left = 12', String(ballX('left', 1200)))
  ok(ballX('right', 1200) === 1200 - B - 12, '贴右边时 left = 屏宽-球宽-边距', String(ballX('right', 1200)))
  ok(clampBallX(-100, 1200) === 12, '往左拖出界 → 夹在 12', String(clampBallX(-100, 1200)))
  ok(clampBallX(9999, 1200) === 1200 - B - 12, '往右拖出界 → 夹在右边', String(clampBallX(9999, 1200)))
  const { cardPlacement } = captured
  ok(typeof cardPlacement === 'function', '导出了卡片展开方向的计算')
  const topRight = cardPlacement({ ballTop: 40, side: 'right', vw: 1400, vh: 900 })
  ok(topRight.top === 40 + B + 10 && topRight.right === 12, '球在右上 → 卡片往下展开（右对齐）', JSON.stringify(topRight))
  const bottomLeft = cardPlacement({ ballTop: 800, side: 'left', vw: 1400, vh: 900 })
  ok(bottomLeft.bottom > 0 && bottomLeft.top === undefined, '球在左下 → 卡片往上翻（否则看不见）', JSON.stringify(bottomLeft))
  ok(bottomLeft.left === 12 && String(bottomLeft.transformOrigin).startsWith('bottom'), '往上翻时缩放的锚点也在下面', JSON.stringify(bottomLeft))
  const lowScreen = cardPlacement({ ballTop: 200, side: 'left', vw: 900, vh: 420 })
  ok(lowScreen.top === 12, '上面也放不下时贴着视口顶，至少看得见', JSON.stringify(lowScreen))
  const wide = cardPlacement({ ballTop: 40, side: 'right', vw: 360, vh: 700 })
  ok(wide.top > 0 && Number.isFinite(wide.top), '窄屏也给出有效位置', JSON.stringify(wide))
}

// ---------------------------------------------------------------- 视口变了要重新贴边（全屏 / 改窗口大小）
{
  const W = sandbox.window
  W.innerWidth = 1400; W.innerHeight = 900
  const a = captured.LiveShell()
  const ballA = flat(a.children).filter(Boolean).find((c) => cls(c).includes('dshell-ball'))
  ok(ballA?.props?.style?.left === 1400 - B - 12, '1400 宽时贴在右边缘', JSON.stringify(ballA?.props?.style))
  W.innerWidth = 2400; W.innerHeight = 1300
  const b = captured.LiveShell()
  const ballB = flat(b.children).filter(Boolean).find((c) => cls(c).includes('dshell-ball'))
  ok(ballB?.props?.style?.left === 2400 - B - 12, '全屏变宽后自己吸到新右边缘（不是原地不动）', JSON.stringify(ballB?.props?.style))
  W.innerWidth = 800; W.innerHeight = 600
  const c = captured.LiveShell()
  const ballC = flat(c.children).filter(Boolean).find((c) => cls(c).includes('dshell-ball'))
  ok(ballC?.props?.style?.left === 800 - B - 12, '窗口变窄也一样跟着走', JSON.stringify(ballC?.props?.style))
  ok(ballC?.props?.style?.top <= 600 - B - 8, '高度变小后 top 被夹回视口内', JSON.stringify(ballC?.props?.style))
}

const section = captured.HerSection()
ok(section && section.type === 'div' && section.props.className === 'dher', '设置页仍能渲染（没被新面板弄坏）')

// ---------------------------------------------------------------- 样式回归
// 这三条都是真机上翻过的车，而且只有肉眼能发现，所以从源码上钉死：
const css = (SRC.match(/const LIVE_CSS = `([\s\S]*?)`\r?\n/) || [])[1] || ''
ok(Boolean(css), '抓得到 LIVE_CSS')
ok(/\.bub\.her\{background:#[0-9a-f]{3,8}/i.test(css), '她的气泡底色是写死的颜色')
ok(!/\.bub\.(her|him)\{[^}]*var\(--/.test(css),
  '气泡底色不依赖主题变量（--dsw-alias-brand-primary 在某些主题下是白色 → 白底白字）')
ok(/\.dlive,.dlive \*\{box-sizing:border-box\}/.test(css),
  '写了 border-box（否则 feed 的 padding 撑破宽度，气泡右边被裁掉）')
// 溢出回归：这类问题只有肉眼能发现（2026-10-29 头像按原图尺寸撑爆行、文字滚出卡片），所以从源码上钉死
ok(/\.dlive \.trow-main\{[^}]*min-width:0[^}]*overflow:hidden/.test(css), '行内容器会收缩且裁切（否则一长句把整行撑宽、横向滚出卡片）')
ok(/\.dlive \.trow-name\{[^}]*min-width:0/.test(css), '名字那格能收缩（flex 子项默认 min-width:auto 会顶出去）')
ok(/\.dlive \.trow-top\{[^}]*display:flex/.test(css), '名字和时间同一行的布局规则在')
ok(/\.dlive \.trow-ava\{[^}]*width:28px[^}]*overflow:hidden/.test(css), '头像锁成 28px 并裁切（不锁就按原图尺寸撑爆）')
ok(/\.dlive \.trow-ava-img\{[^}]*position:absolute[^}]*object-fit:cover/.test(css), '头像图绝对定位填满那一格')
ok(/\.dshell-card \.dlive\.listv\{[^}]*overflow-x:hidden/.test(css), '会话列表不横向滚')
ok(/@media \(max-width:760px\)/.test(css), '窄屏会改成上下排（否则右栏被挤成一条缝）')

// 只读工作区：第二个 DSH 里不能装作能操作（2026-10-29 主人要求）
{
  // 面板是运行时渲染的，这里从句柄层钉住：只读分支必须在，并且要说清是谁占着
  ok(/\bs\?\.readonly/.test(SRC), '面板读 state.readonly')
  ok(SRC.includes('这个面板只能看'), '只读时显示「这个面板只能看」')
  // 页签不能有死链：每个 tab 都要有页面，页面组件不能是未定义的
  const tabsBlock = (SRC.match(/const TABS = \[([\s\S]*?)\n    \]/) || [])[1] || ''
  const tabIds = [...tabsBlock.matchAll(/\['(\w+)'/g)].map((m) => m[1])
  ok(tabIds.every((id) => SRC.includes('tab === ' + String.fromCharCode(39) + id + String.fromCharCode(39))), '每个页签都有对应页面', JSON.stringify(tabIds))
  const used = [...new Set([...SRC.matchAll(/h\((\w+Page)\)/g)].map((m) => m[1]))]
  ok(used.every((n) => SRC.indexOf('function ' + n + '(') >= 0), '用到的页面组件都定义了（不会点开空白）', JSON.stringify(used))
  ok(/她现在相信什么/.test(SRC) && /当初是因为/.test(SRC), '判断清单带时间与证据')

  // 渲染期 ReferenceError 的教训：桩 h 不会执行组件，所以 'st is not defined' 测试抓不到。
  // 试过写通用的静态检查，但 health.listener?.alive 这种链式属性会被误判成未声明变量，
  // 误报比漏报更糟——改成钉住这一处具体的回归。
  ok(!/\bst\?\.readonly/.test(SRC), '状态页不再引用没声明的 st（之前整页报错）')
  ok(/\bs\?\.readonly/.test(SRC), '只读判断读的是本页的 s')
  ok(/brainHolder/.test(SRC), '把占着大脑的 pid 说出来，不是含糊的有人在用')
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
