/**
 * client.js —— 设置 → 她（浏览器半边）
 *
 * 形态：一个 settings.section，内部自带页签（状态 / 登录 / 记忆 / 成长 / 手）。
 * 数据：同源 fetch /dsh-herself/api/*（App 内自带登录 cookie，浏览器直敲会 401）。
 * 红线：这里没有任何能改她人格/数值的控件。
 */
window.__ModuleLoader__.load({
  id: 'dsh-herself',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = '/dsh-herself/api'
    const NS = 'herself'

    const CSS = `
      .dher{color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px;font-size:13px}
      .dher h2{margin:0;font-size:16px;font-weight:500;line-height:24px}
      .dher .sub{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:19px;margin:0}
      .dher .tabs{display:flex;gap:8px;border-bottom:.5px solid var(--dsw-alias-border-l2);padding-bottom:10px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:var(--dsw-alias-bg-base, transparent)}
      .dher .tab{padding:6px 14px;border-radius:8px;border:.5px solid transparent;background:transparent;cursor:pointer;font-size:13px;color:var(--dsw-alias-text-2);transition:all .12s}
      .dher .tab:hover{background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1)}
      .dher .tab.on{background:var(--dsw-alias-bg-2,rgba(127,127,127,.12));border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-text-1);font-weight:600}
      .dher .card{margin-top:14px}
      .dher .tab{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);
        border-radius:999px;padding:4px 12px;font-size:12.5px;cursor:pointer}
      .dher .tab.on{background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);font-weight:600}
      .dher .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
      .dher .stat{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px}
      .dher .stat b{display:block;font-size:20px;line-height:28px;font-weight:600}
      .dher .stat span{color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dher .card{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px}
      .dher .card>h3{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;
        color:var(--dsw-alias-label-tertiary);text-transform:uppercase}
      .dher .row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:.5px dashed var(--dsw-alias-border-l2)}
      .dher .row:last-child{border-bottom:0}
      .dher .muted{color:var(--dsw-alias-label-tertiary)}
      .dher .chip{border-radius:999px;padding:1px 9px;font-size:11.5px;border:.5px solid var(--dsw-alias-border-l2)}
      .dher .chip.on{background:var(--dsw-alias-bg-l2);font-weight:600}
      .dher .chip.off{opacity:.45}
      .dher .chip.good{background:rgba(46,160,67,.18);border-color:rgba(63,185,80,.55);color:#3fb950;font-weight:600}
      .dher .chip.bad{background:rgba(217,83,79,.16);border-color:rgba(217,83,79,.5);color:#e5534b;font-weight:600}
      .dher input{flex:1;min-width:180px;background:transparent;color:var(--dsw-alias-label-primary);
        border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;font-size:13px}
      .dher button.go{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
        border-radius:8px;padding:6px 12px;font-size:12.5px;cursor:pointer}
      .dher .err{color:#d9534f}
      .dher code{font-size:11.5px;background:var(--dsw-alias-bg-l2);padding:1px 5px;border-radius:4px}
    `

    /** 本地日期 YYYY-MM-DD（wake.mjs 也用这个口径，别用 toISOString 的 UTC 日） */
    function localDay() {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    async function get(path, options) {
      const r = await fetch(API + path, options)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      return j
    }

    const TABS = [
      ['state', '状态'],
      ['control', '控制'],
      ['login', '登录'],
      ['memory', '记忆'],
      ['growth', '成长'],
      ['hands', '手'],
      ['snowluma', 'SnowLuma'],
    ]

    function StatePage() {
      const [s, setS] = useState(null)
      const [err, setErr] = useState('')
      const [text, setText] = useState('')

      const load = useCallback(() => {
        get('/state').then((j) => { setS(j); setErr('') }).catch((e) => setErr(String(e.message)))
      }, [])

      useEffect(() => { load() }, [load])

      const [health, setHealth] = useState(null)
      useEffect(() => {
        const pull = () => get('/health').then(setHealth).catch(() => {})
        pull()
        const t = setInterval(pull, 15000)
        return () => clearInterval(t)
      }, [])

      const say = useCallback(async () => {
        const t = text.trim()
        if (!t) return
        try {
          await get('/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }) })
          setText('')
          load()
        } catch (e) { setErr(String(e.message)) }
      }, [text, load])

      if (err) return h('div', { className: 'dher' }, h('p', { className: 'err' }, '读不到她的状态：' + err))

      if (!s) return h('div', { className: 'dher' }, h('p', { className: 'muted' }, '正在读她的状态…'))

      if (!s.born) {
        return h('div', { className: 'dher' },
          h('h2', {}, '她还没有出生'),
          h('p', { className: 'sub' }, '在她的命令行里运行：'),
          h('p', {}, h('code', {}, 'node cli.mjs init')),
          h('p', { className: 'sub' }, '出生只会发生一次。'),
        )
      }

      const gateName = { trust: '信任', autonomy: '自主', competence: '主动', integration: '整合' }

      return h('div', { className: 'dher' },
        h('div', { className: 'grid' },
          h('div', { className: 'stat' }, h('b', {}, String(s.day)), h('span', {}, '天')),
          h('div', { className: 'stat' }, h('b', {}, String(s.stage)), h('span', {}, '阶段 · ' + (gateName[s.nextGate] ? '下一道门：' + gateName[s.nextGate] : '四门已过'))),
          h('div', { className: 'stat' }, h('b', {}, String(s.counts.beliefs)), h('span', {}, '判断（活跃 ' + s.counts.active + '）')),
          h('div', { className: 'stat' }, h('b', {}, String(s.counts.maintained)), h('span', {}, '维持住的拒绝')),
        ),

        (() => {
          const lastSaid = [...(s.recent || [])].reverse().find((e) => e.type === 'utterance')
          const woke = s.wake && s.wake.day === localDay() ? (s.wake.count ?? 0) : 0
          return h('div', { className: 'card' },
            h('h3', {}, '此刻'),
            h('p', { style: { margin: 0 } }, lastSaid ? '她刚才说：「' + lastSaid.text + '」' : '她还没说过话。'),
            h('p', { className: 'sub', style: { marginTop: 6 } },
              `今天主动说了 ${woke} / ${s.prefs?.maxPerDay ?? 4} 次 · ${s.prefs?.fromHour ?? 9}–${s.prefs?.toHour ?? 23} 点 · 发你 ${s.prefs?.sendPerDay ?? 1} 条`
              + ((s.prefs?.sources ?? []).length ? `（其中 ${s.prefs.sources.length} 条是她自己定的）` : '（默认作息）')
              + ` · 心跳 ${health?.listener?.alive ? '正常' : '异常'}`),
          )
        })(),

        h('div', { className: 'card' },
          h('h3', {}, '自检'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('span', { className: 'chip ' + (health === null ? '' : (health.brain?.ok ? 'good' : 'bad')) }, '模型 ' + (health === null ? '…' : (health.brain?.ok ? '通' : '断'))),
            h('span', { className: 'chip ' + (health === null ? '' : (health.qq?.online ? 'good' : 'bad')) }, 'QQ ' + (health === null ? '…' : (health.qq?.online ? '在线' : '离线'))),
            h('span', { className: 'chip ' + (health === null ? '' : (health.edge?.cdp ? 'good' : 'bad')) }, '浏览器 ' + (health === null ? '…' : (health.edge?.cdp ? '通' : '断'))),
            h('span', { className: 'chip ' + (health === null ? '' : (health.listener?.alive ? 'good' : 'bad')) }, '监听 ' + (health === null ? '…' : (health.listener?.alive ? '在' : '停'))),
            h('span', { className: 'chip ' + (health === null ? '' : (health.wake?.alive ? 'good' : 'bad')) }, '主动发言 ' + (health === null ? '…' : (health.wake?.alive ? '在' : '停'))),
          ),
          health === null
            ? h('p', { className: 'sub', style: { marginTop: 8 } }, '健康接口还没响应——如果一直停在这里，说明插件没重载或 /health 路由没注册。')
            : (health.lastError ? h('p', { className: 'sub', style: { marginTop: 8, color: '#d9534f' } }, '最近错误：' + health.lastError) : null),
        ),

        h('div', { className: 'card' },
          h('h3', {}, '四道门'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            ['trust', 'autonomy', 'competence', 'integration'].map((g) =>
              h('span', { key: g, className: 'chip ' + (s.gates.includes(g) ? 'on' : 'off') }, gateName[g] ?? g))),
        ),

        s.narrative ? h('div', { className: 'card' },
          h('h3', {}, '她在回看自己'),
          h('p', { style: { margin: 0 } }, '「' + s.narrative.text + '」'),
        ) : null,

        h('div', { className: 'card' },
          h('h3', {}, '最近的事'),
          (s.recent.length ? s.recent : [{ type: 'seed', text: '（还没有别的事）', ts: '' }]).map((e, i) =>
            h('div', { className: 'row', key: i },
              h('span', { className: 'chip' }, e.type),
              h('span', { style: { flex: 1 } }, e.text || '（起点）'),
              h('span', { className: 'muted' }, String(e.ts).slice(5, 16).replace('T', ' ')),
            )),
        ),

        st?.readonly
          ? h('div', { className: 'card ro' },
            h('h3', {}, '这个面板只能看'),
            h('p', { className: 'muted' }, `她在另一个 DSH 工作区里跑（pid ${st?.brainHolder ?? '?'}）。`),
            h('p', { className: 'muted' }, '这里不写事件、也不起停进程——去那个工作区操作，或者先把那边的她停掉。'),
          )
          : h('div', { className: 'card' },
            h('h3', {}, '手动记一句（接嘴之前先用）'),
            h('div', { style: { display: 'flex', gap: 8 } },
              h('input', { value: text, placeholder: '她会记住这句话…', onChange: (e) => setText(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') say() } }),
              h('button', { className: 'go', onClick: say }, '记下'),
            ),
          ),
      )
    }

    function LoginPage() {
      const [b, setB] = useState(null)
      const [sess, setSess] = useState(null)
      const [st, setSt] = useState(null)
      const [msg, setMsg] = useState('')
      useEffect(() => { get('/browser').then(setB).catch(() => setB({ cdp: false, platforms: [] })) }, [])
      useEffect(() => {
        const load = () => {
          get('/sessions').then(setSess).catch(() => setSess({ ok: false, platforms: {} }))
          get('/stack').then(setSt).catch(() => {})
        }
        load()
        const t = setInterval(load, 15000)
        return () => clearInterval(t)
      }, [])
      const openLogin = useCallback(async (id) => {
        setMsg('正在打开…')
        try {
          const r = await get('/login/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: id }) })
          setMsg(`${r.launched ? '已启动 Edge，' : ''}已打开 ${r.name} 登录页`)
          setTimeout(() => get('/sessions').then(setSess).catch(() => {}), 4000)
        } catch (e) { setMsg('打开失败：' + e.message) }
      }, [])
      if (!b) return h('div', { className: 'dher' }, h('p', { className: 'muted' }, '检测中…'))
      return h('div', { className: 'dher' },
        h('div', { className: 'card' },
          h('h3', {}, '浏览器（她的眼睛和手）'),
          h('div', { className: 'row' },
            h('span', { className: 'chip ' + (b.cdp ? 'on' : 'off') }, b.cdp ? 'CDP 已连接' : 'CDP 未连接'),
            h('span', { className: 'muted' }, b.version || '端口 9222'),
          ),
          h('p', { className: 'sub', style: { marginTop: 8 } },
            '专用 profile：', h('code', {}, b.profile)),
          h('p', { className: 'sub' }, '登录状态只留在这个 profile 里；插件不读密码、不打印 cookie。'),
        ),
        h('div', { className: 'card' },
          h('h3', {}, '四个平台'),
          (b.platforms || []).filter((p) => p.id !== 'qzone').map((p) => {
            const info = sess?.platforms?.[p.id]
            const label = !sess ? '检测中' : (sess.ok ? (info?.loggedIn ? '已登录' : '未登录') : '未知')
            return h('div', { className: 'row', key: p.id },
              h('span', { className: 'chip' }, p.id),
              h('span', { style: { flex: 1 } }, p.name),
              h('span', { className: 'chip ' + (info?.loggedIn ? 'on' : 'off') }, label),
              h('button', { className: 'go', onClick: () => openLogin(p.id) }, '登录 / 换号'),
            )
          }),
          sess && !sess.ok ? h('p', { className: 'sub', style: { marginTop: 8 } }, '状态检测失败：' + (sess.error || '未知原因')) : null,
          msg ? h('p', { className: 'sub', style: { marginTop: 8 } }, msg) : null,
          h('p', { className: 'sub', style: { marginTop: 8 } }, '登录判定只读 cookie 的名字与过期时间，不读值；扫码或输密码都由你完成。'),
        ),
        h('div', { className: 'card' },
          h('h3', {}, 'QQ'),
          h('div', { className: 'row' },
            h('span', { className: 'chip ' + (st?.napcat?.ws ? 'on' : 'off') }, st?.napcat?.ws ? 'SnowLuma 已连接' : 'SnowLuma 未连接'),
            h('span', { className: 'muted' }, st?.napcat?.account ? `${st.napcat.nickname} ${st.napcat.account}` : 'ws://127.0.0.1:3001'),
          ),
          h('p', { className: 'sub', style: { marginTop: 8 } }, 'QQ 私聊/群聊在「控制」页签里启停；空间仍走浏览器。'),
        ),
      )
    }

    function MemoryPage() {
      const [s, setS] = useState(null)
      const [msg, setMsg] = useState('')
      const [q, setQ] = useState('')
      const load = useCallback(() => { get('/state').then(setS).catch(() => setS(null)) }, [])
      useEffect(() => { load() }, [load])
      const forget = useCallback(async (id) => {
        try {
          await get('/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, reason: '读错了' }) })
          setMsg('已作废这条解读（原文仍在，只是不再算数）')
          load()
        } catch (e) { setMsg('作废失败：' + e.message) }
      }, [load])
      if (!s) return h('div', { className: 'dher' }, h('p', { className: 'muted' }, '加载中…'))
      return h('div', { className: 'dher' },
        h('div', { className: 'card' },
          h('input', {
            value: q,
            placeholder: '搜她说过的、我读到的…',
            onChange: (e) => setQ(e.target.value),
            style: { width: '100%' },
          }),
        ),
        h('div', { className: 'card' },
          h('h3', {}, '现在的判断（最多 5 条）'),
          (s.beliefs || []).filter((b) => !q || String(b.text).includes(q)).length
            ? s.beliefs.filter((b) => !q || String(b.text).includes(q)).map((b, i) => h('div', { className: 'row', key: i },
              h('span', { className: 'chip ' + (b.status === 'active' ? 'on' : 'off') }, b.status),
              h('span', { style: { flex: 1 } }, b.text)))
            : h('p', { className: 'muted' }, q ? '没有匹配的判断。' : '还没有判断。先让她说一句话。'),
        ),
        h('div', { className: 'card' },
          h('h3', {}, '系统对她的解读（推断，不是她申报的）'),
          (s.readings || []).filter((r) => !q || String(r.target).includes(q) || String(r.quote || '').includes(q)).length
            ? s.readings.filter((r) => !q || String(r.target).includes(q) || String(r.quote || '').includes(q)).slice().reverse().map((r, i) => h('div', { className: 'row', key: i },
              h('span', { className: 'chip' }, '推断'),
              h('span', { style: { flex: 1 } }, `「${r.target}」` + (r.quote ? ` ← ${r.quote}` : '')),
              h('button', { className: 'go', onClick: () => forget(r.id) }, '读错了'),
            ))
            : h('p', { className: 'muted' }, '还没有解读记录。'),
          msg ? h('p', { className: 'sub', style: { marginTop: 8 } }, msg) : null,
          h('p', { className: 'sub' }, '这些只是笔记：她看不见，也不会因此改变；点「读错了」会作废它。'),
        ),

        h('div', { className: 'card' },
          h('h3', {}, '存储'),
          h('div', { className: 'row' }, h('span', { style: { flex: 1 } }, '事件流'), h('code', {}, s.root + '\\events.jsonl')),
          h('p', { className: 'sub', style: { marginTop: 8 } }, '只追加、不可改。人格是它派生出来的，随时可重算。'),
        ),
      )
    }

    function GrowthPage() {
      const [s, setS] = useState(null)
      useEffect(() => { get('/state').then(setS).catch(() => setS(null)) }, [])
      const gateName = { trust: '信任', autonomy: '自主', competence: '主动', integration: '整合' }
      const need = { trust: '写下第一条自己的判断', autonomy: '维持过一次拒绝', competence: '推翻过自己一次', integration: '说出"我变了"' }
      if (!s) return h('div', { className: 'dher' }, h('p', { className: 'muted' }, '加载中…'))
      return h('div', { className: 'dher' },
        h('div', { className: 'card' },
          h('h3', {}, '进度'),
          h('div', { style: { height: 6, background: 'var(--dsw-alias-bg-l2)', borderRadius: 3, overflow: 'hidden' } },
            h('div', { style: { width: ((s.stage - 1) / 4 * 100) + '%', height: '100%', background: 'var(--dsw-alias-label-primary)' } }),
          ),
          h('p', { className: 'sub', style: { marginTop: 6 } }, `阶段 ${s.stage} / 4 · ${s.gates.length} 道门已过`),
        ),
        ['trust', 'autonomy', 'competence', 'integration'].map((g, i) => {
          const on = s.gates.includes(g)
          return h('div', { className: 'card', key: g },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { className: 'chip ' + (on ? 'on' : 'off') }, on ? '已通过' : '未通过'),
              h('b', {}, '第 ' + (i + 1) + ' 道门 · ' + gateName[g]),
            ),
            h('p', { className: 'sub', style: { margin: '6px 0 0' } }, '瓶颈：' + need[g]),
          )
        }),
        (s.candidateStances || []).length ? h('div', { className: 'card' },
          h('h3', {}, '推断出的候选立场（不是她申报的）'),
          s.candidateStances.map((c, i) => h('div', { className: 'row', key: i },
            h('span', { className: 'chip on' }, 'inferred'),
            h('span', { style: { flex: 1 } }, c.target),
            h('span', { className: 'muted' }, `${c.mentions} 次 · 有代价`),
          )),
          h('p', { className: 'sub' }, '同一件事被读出国 ≥2 次、且对方真的顶回来过，才算数。'),
        ) : null,
      )
    }

    function HandsPage() {
      const [st, setSt] = useState(null)
      const [sess, setSess] = useState(null)
      useEffect(() => {
        const pull = () => {
          get('/stack').then(setSt).catch(() => {})
          get('/sessions').then(setSess).catch(() => {})
        }
        pull()
        const t = setInterval(pull, 15000)
        return () => clearInterval(t)
      }, [])
      const qq = Boolean(st?.napcat?.ws)
      const p = (id) => sess?.platforms?.[id]
      const rows = [
        ['私聊', qq ? '可用' : '不可用', 'SnowLuma OneBot', qq],
        ['群 @', qq ? '可用' : '不可用', '只在被 @ 时接话', qq],
        ['B站 读', '可用', '公开接口，无需登录', true],
        ['B站 登录', p('bili')?.loggedIn ? '已登录' : '未登录', 'Edge profile', Boolean(p('bili')?.loggedIn)],
        ['QQ空间 发/删/读', '可用', 'SnowLuma 结构化接口', true],
        ['QQ空间 赞/评论', '可用', 'like_qzone / comment_qzone', true],
        ['小红书', p('xhs')?.loggedIn ? '已登录' : '未登录', 'Edge profile', Boolean(p('xhs')?.loggedIn)],
        ['小黑盒', p('xhh')?.loggedIn ? '已登录' : '未登录', 'Edge profile', Boolean(p('xhh')?.loggedIn)],
      ]
      return h('div', { className: 'dher' },
        h('div', { className: 'card' },
          h('h3', {}, '手（真实状态）'),
          rows.map(([name, status, via, ok], i) => h('div', { className: 'row', key: i },
            h('span', { className: 'chip ' + (ok ? 'on' : 'off') }, ok ? '✓' : '—'),
            h('span', { style: { flex: 1 } }, name),
            h('span', { className: 'muted' }, via),
            h('span', { style: { width: 64, textAlign: 'right' } }, status),
          )),
        ),
        h('p', { className: 'sub' }, '「可用」= 现在就能做；「已登录」= 有登录态，对应功能还没接。'),
      )
    }

    function ControlPage() {
      const [s, setS] = useState(null)
      const [msg, setMsg] = useState('')
      const load = useCallback(() => { get('/stack').then(setS).catch((e) => setMsg(String(e.message))) }, [])
      useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])
      const act = useCallback(async (p) => {
        setMsg('执行中…')
        try {
          const r = await get(p, { method: 'POST' })
          setMsg(r.out ? String(r.out).slice(-300) : '完成')
          setTimeout(load, 2500)
        } catch (e) { setMsg('失败：' + e.message) }
      }, [load])

      if (!s) return h('div', { className: 'dher' }, h('p', { className: 'muted' }, '读取中…'))
      const dot = (ok) => h('span', { className: 'chip ' + (ok ? 'good' : 'bad') }, ok ? '运行中' : '已停止')

      return h('div', { className: 'dher' },
        h('div', { className: 'card' },
          h('h3', {}, '运行状态'),
          h('div', { className: 'row' },
            h('span', { style: { flex: 1 } }, 'SnowLuma / OneBot'),
            dot(s.napcat.ws),
            h('span', { className: 'muted' }, s.napcat.account ? `${s.napcat.nickname ?? ''} ${s.napcat.account}` : '未登录'),
          ),
          h('div', { className: 'row' },
            h('span', { style: { flex: 1 } }, 'QQ 监听'),
            dot(s.listener.alive),
            h('span', { className: 'muted' }, s.listener.pid ? 'pid ' + s.listener.pid : '—'),
          ),
          h('div', { className: 'row' },
            h('span', { style: { flex: 1 } }, '主动发言'),
            dot(s.wake.alive),
            h('span', { className: 'muted' }, (() => {
              const w = s.wake.state
              if (w && w.day === localDay()) return `今日 ${w.count ?? 0} / 4 次`
              return '今天还没主动说话（9:00–23:00，最多 4 次，发你 1 条）'
            })()),
          ),
        ),

        h('div', { className: 'card' },
          h('h3', {}, '开关'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { className: 'go', onClick: () => act('/stack/start') }, '启动 / 自愈'),
            h('button', { className: 'go', onClick: () => act('/stack/stop') }, '停止'),
          ),
          msg ? h('p', { className: 'sub', style: { marginTop: 8 } }, msg) : null,
          h('p', { className: 'sub' }, '启动会拉起 SnowLuma + QQ + 监听 + 主动发言；停止只关她那个 QQ 实例，不影响你自己的 QQ。'),
        ),

        s.qr && !s.qr.stale ? h('div', { className: 'card' },
          h('h3', {}, 'QQ 登录（二维码）'),
          h('img', { src: s.qr.data, style: { width: 200, height: 200, imageRendering: 'pixelated' } }),
          h('p', { className: 'sub' }, `这张码生成于 ${s.qr.ageSec} 秒前。扫码后状态 5 秒内自动刷新。`),
        ) : null,

        s.qr && s.qr.stale ? h('div', { className: 'card' },
          h('h3', {}, 'QQ 登录'),
          h('p', { className: 'sub' }, `二维码已过期（生成于 ${Math.round(s.qr.ageSec / 60)} 分钟前）。`),
          h('p', { className: 'sub' }, '点「停止」再「启动」会重新生成一张码；有效期约 2 分钟，扫的时候快一点。'),
        ) : null,
      )
    }

    /** 单页兜底：某个页签渲染出错时只让它自己报错，不把整块面板弄空白 */
    class PageBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: '' } }
      static getDerivedStateFromError(e) { return { err: String(e?.message ?? e) } }
      render() {
        if (this.state.err) {
          return h('div', { className: 'card' },
            h('h3', {}, '这一页出错了'),
            h('p', { className: 'sub', style: { color: '#d9534f' } }, this.state.err),
          )
        }
        return this.props.children
      }
    }

    function SnowLumaPage() {
      const [health, setHealth] = useState(null)
      useEffect(() => {
        const pull = () => get('/health').then(setHealth).catch(() => {})
        pull()
        const t = setInterval(pull, 15000)
        return () => clearInterval(t)
      }, [])
      const up = Boolean(health?.qq?.online)
      return h('div', {},
        h('div', { className: 'card' },
          h('h3', {}, 'QQ 运行时 · SnowLuma'),
          h('p', { className: 'sub' }, '负责 QQ 登录、OneBot 与 QQ 空间接口。关掉它她就下线；DSH 启动时会自动拉起。'),
          h('div', { className: 'row' }, h('span', {}, '连接状态'),
            h('span', { className: 'chip ' + (up ? 'good' : 'bad') }, up ? '已连接' : '未连接')),
          h('div', { className: 'row' }, h('span', {}, 'WebUI 地址'), h('span', { className: 'muted' }, 'http://127.0.0.1:5099')),
          h('div', { className: 'row' }, h('span', {}, 'OneBot 端口'), h('span', { className: 'muted' }, '127.0.0.1:3001')),
          h('button', {
            className: 'btn', style: { marginTop: 12 },
            onClick: () => window.open('http://127.0.0.1:5099', '_blank', 'noopener'),
          }, '打开 SnowLuma WebUI'),
          h('p', { className: 'sub', style: { marginTop: 10 } },
            '在 WebUI 里可以重新扫码登录、看实时日志、改 OneBot 配置。她重新上线不需要重启 DSH。'),
        ),
        h('div', { className: 'card' },
          h('h3', {}, '迁移状态'),
          h('p', { className: 'sub' }, '消息、空间发帖/删除/读取/点赞/评论都已切到 SnowLuma 的结构化接口。NapCat 包保留在硬盘上，设 DSH_QQ_RUNTIME=napcat 可一键回滚。'),
        ),
      )
    }

    function HerSection() {
      const [tab, setTab] = useState('state')
      const page = tab === 'state' ? h(StatePage)
        : tab === 'control' ? h(ControlPage)
          : tab === 'login' ? h(LoginPage)
            : tab === 'memory' ? h(MemoryPage)
              : tab === 'growth' ? h(GrowthPage)
                : tab === 'snowluma' ? h(SnowLumaPage)
                  : h(HandsPage)
      return h('div', { className: 'dher' },
        h('style', {}, CSS),
        h('div', {},
          h('h2', {}, '她'),
          h('p', { className: 'sub' }, '同一记忆体，多只手。事件流是唯一真相，人格是派生。'),
        ),
        h('div', { className: 'tabs' },
          TABS.map(([id, label]) =>
            h('button', { key: id, className: 'tab ' + (tab === id ? 'on' : ''), onClick: () => setTab(id) }, label))),
        h(PageBoundary, { key: tab }, page),
      )
    }

    // ---------------------------------------------------------------- 首页侧栏：实时
    // 左：对话流（她说的 / 他说的）。右：点开她说的某一轮，看她这句是怎么来的。
    // 只读——这里没有任何能改她人格/数值的控件。
    const LIVE_ID = 'herself-live'

    const LIVE_CSS = `
      /* 别指望宿主的全局 reset：不写 border-box，feed 的 padding 会把宽度撑出去，气泡被裁 */
      .dlive,.dlive *{box-sizing:border-box}
      .dlive{display:flex;gap:14px;align-items:flex-start;color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 2px}
      .dlive .feed{width:min(44%,400px);max-height:72vh;overflow:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px}
      .dlive .detail{flex:1;min-width:0;max-height:72vh;overflow:auto}
      /* 窄的时候上下排，不然右栏被挤成一条缝 */
      @media (max-width:760px){
        .dlive{flex-direction:column}
        .dlive .feed{width:100%;max-height:42vh}
        .dlive .detail{max-height:none;width:100%}
      }
      .dlive .msg{display:flex;margin-bottom:10px}
      .dlive .msg.left{justify-content:flex-start}
      .dlive .msg.right{justify-content:flex-end}
      /* 气泡底色写死，不用主题变量：--dsw-alias-brand-primary 在某些主题下是白色，
         结果就是白底白字（2026-10-29 截图里就是这么翻的）。 */
      .dlive .bub{max-width:88%;border-radius:14px;padding:7px 11px 8px;line-height:19px;word-break:break-word}
      .dlive .bub.him{background:rgba(127,127,127,.18);color:inherit;border-bottom-left-radius:5px}
      .dlive .bub.her{background:#4d6bfe;color:#fff;border-bottom-right-radius:5px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.22)}
      .dlive .bub.her:hover{filter:brightness(1.08)}
      .dlive .bub.her.on{outline:2px dashed rgba(255,255,255,.9);outline-offset:2px}
      .dlive .bub .who{font-size:10.5px;opacity:.78;margin-bottom:3px;display:flex;gap:8px;justify-content:space-between;align-items:baseline}
      .dlive .bub .txt{white-space:pre-wrap;word-break:break-word}
      .dlive .bub .badge{font-size:10.5px;opacity:.86;margin-top:5px;border-top:.5px solid rgba(255,255,255,.32);padding-top:3px}
      .dlive .filters{display:flex;gap:8px;margin-bottom:10px;align-items:center}
      .dlive .f{padding:3px 11px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dlive .f.on{background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);font-weight:600}
      .dlive .k{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
      .dlive .hit{border-bottom:.5px dashed var(--dsw-alias-border-l2);padding:5px 0}
      .dlive .hit:last-child{border-bottom:0}
      .dlive .score{float:right;font-size:11px;color:var(--dsw-alias-label-tertiary)}
      .dlive .empty{color:var(--dsw-alias-label-tertiary);padding:16px 4px;line-height:20px}
      .dlive .err{color:#d9534f}
      /* ---------------- 思考过程那一栏的美化（2026-10-29） ---------------- */
      .dlive .blk{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;margin-bottom:12px;
        background:rgba(127,127,127,.06)}
      .dlive .blk>summary{display:flex;align-items:center;gap:6px;font-weight:600;letter-spacing:.02em;
        color:var(--dsw-alias-label-secondary);cursor:pointer;list-style:none}
      .dlive .blk>summary::-webkit-details-marker{display:none}
      .dlive .blk>summary::before{content:'▸';color:#4d6bfe;font-size:11px;transition:transform .15s ease}
      .dlive .blk[open]>summary::before{transform:rotate(90deg)}
      .dlive .blk>summary:hover{color:var(--dsw-alias-label-primary)}
      .dlive .blk .body{margin-top:8px;line-height:1.78;white-space:pre-wrap;word-break:break-word}
      .dlive .meta{gap:8px !important}
      .dlive .meta .k{background:rgba(127,127,127,.14);border-radius:6px;padding:1px 7px;font-variant-numeric:tabular-nums}
      .dlive .hit{padding:8px 0}
      .dlive .score{background:rgba(77,107,254,.14);border-radius:8px;padding:1px 7px;font-variant-numeric:tabular-nums}
      .dlive .hint{margin:2px 0 10px;padding:8px 10px;border-radius:9px;font-size:11.5px;line-height:1.6;
        background:rgba(77,107,254,.10);color:var(--dsw-alias-label-secondary)}
      /* ---------------- 悬浮球（2026-10-29）：平时一个球，点开才展开 ---------------- */
      .dshell-ball{position:fixed;width:36px;height:36px;border-radius:50%;border:0;cursor:grab;touch-action:none;user-select:none;
        padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#4d6bfe;
        transition:left .2s cubic-bezier(.2,.9,.3,1.08),top .2s cubic-bezier(.2,.9,.3,1.08),transform .18s cubic-bezier(.2,.9,.3,1.1),background .12s ease,opacity .12s ease;
        background:#4d6bfe;color:#fff;font-size:13.5px;font-weight:600;letter-spacing:.02em;opacity:.94;
        box-shadow:0 4px 14px rgba(0,0,0,.28);z-index:9999;transition:transform .12s ease,background .12s ease,opacity .12s ease}
      .dshell-ball:hover{transform:translateY(-1px);opacity:1;box-shadow:0 6px 18px rgba(0,0,0,.36)}
      .dshell-ball-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;pointer-events:none}
      .dshell-ball-txt{position:relative;z-index:1;font-size:13.5px;font-weight:600;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5)}
      .dshell-ball-txt.on{font-size:20px}
      .dshell-ball.drag{transform:scale(1.06);opacity:1;box-shadow:0 8px 22px rgba(0,0,0,.42);transition:none}
      .dshell-ball.on{background:rgba(127,127,127,.62);font-size:19px;opacity:1;transform:rotate(90deg) scale(.94)}

      /* 卡片：定高 + 内部各自滚动，别让整张卡随着消息长短跳 */
      .dshell-card{position:fixed;width:min(94vw,430px);height:auto;min-height:190px;max-height:min(78vh,620px);overflow:hidden;z-index:9999;
        transform:scale(.90);opacity:0;pointer-events:none;visibility:hidden;
        transition:transform .18s cubic-bezier(.2,.9,.3,1.1),opacity .14s ease,visibility .18s;
        display:flex;flex-direction:column;gap:6px;
        background:var(--dsw-alias-bg-l1,#1b1b1f);border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;
        box-shadow:0 14px 44px rgba(0,0,0,.45);padding:10px 12px}
      .dshell-card.on{transform:scale(1);opacity:1;pointer-events:auto;visibility:visible}
      .dshell-card.drag{opacity:0;transform:scale(.94);pointer-events:none}
      .dshell-card .dlive{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:0}
      /* 会话列表：整块滚动，不把卡片撑高 */
      .dshell-card .dlive.listv{display:block;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
      /* 单条会话：对话流吃掉剩余高度，思考过程限高 */
      .dshell-card .dlive .feed{flex:1;min-height:0;width:100% !important;max-height:none}
      .dshell-card .dlive .detail{max-height:38%;overflow:auto}
      @media (max-width:520px){ .dshell-card{left:8px !important;right:8px !important;width:auto}}
      .dlive.listv{display:block}
      .dlive .page-h{display:flex;align-items:center;gap:8px;margin:2px 0 10px;font-size:12px}
      .dlive .page-h .title{font-size:13px;font-weight:600}
      .dlive .back{border:0;background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px}
      .dlive .back:hover{background:rgba(127,127,127,.16)}
      .dlive .sec{margin-bottom:14px}
      .dlive .sec-h{font-size:11px;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);margin:0 0 6px 2px;text-transform:uppercase}
      .dlive .trow{display:flex;gap:9px;align-items:center;width:100%;min-width:0;text-align:left;background:transparent;
        color:inherit;font:inherit;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;
        padding:8px 10px;margin-bottom:7px;cursor:pointer;overflow:hidden;transition:background .12s ease}
      .dlive .trow:hover{background:rgba(127,127,127,.12)}
      .dlive .trow:active{background:rgba(127,127,127,.2)}
      .dlive .trow-ava{position:relative;flex:0 0 auto;width:28px;height:28px;border-radius:8px;overflow:hidden;
        display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600;
        background:rgba(77,107,254,.16);color:#8fa3ff}
      .dlive .trow-ava.grp{background:rgba(127,127,127,.2);color:var(--dsw-alias-label-secondary)}
      .dlive .trow-ava-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit}
      /* 这两层的 min-width:0 + overflow:hidden 是防溢出的关键：
         flex 子项默认 min-width:auto，不写就会把整行撑宽、横向滚出卡片。 */
      .dlive .trow-main{flex:1 1 auto;min-width:0;overflow:hidden}
      .dlive .trow-top{display:flex;align-items:baseline;gap:8px;min-width:0}
      .dlive .trow-name{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dlive .trow-time{flex:0 0 auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
      .dlive .trow-last{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:3px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .dlive .trow-count{flex:0 0 auto;min-width:18px;text-align:center;font-size:10px;font-variant-numeric:tabular-nums;
        color:var(--dsw-alias-label-tertiary);background:rgba(127,127,127,.16);border-radius:9px;padding:1px 6px}
    `


    function hhmm(ts) {
      try {
        const d = new Date(ts)
        if (Number.isNaN(d.getTime())) return ''
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      } catch { return '' }
    }

    /**
     * 他发来的原文形如「主人：…」或「[群 20002] 主人：…」。
     * 气泡里名字要单独占一行，正文不能带着「主人：」这个前缀。
     */
    function splitHim(t) {
      const raw = String(t.text ?? '')
      const m = raw.match(/^(?:\[群 (\d+)\]\s*)?([^：\n]{1,24})：([\s\S]*)$/)
      if (!m) return { group: t.group || '', name: t.who || '', body: raw }
      return { group: m[1] || t.group || '', name: m[2], body: m[3] }
    }

    function LiveTurn({ id }) {
      const [t, setT] = useState(null)
      const [err, setErr] = useState('')
      useEffect(() => {
        let alive = true
        setT(null); setErr('')
        get('/turn?id=' + encodeURIComponent(id))
          .then((j) => { if (alive) setT(j.turn) })
          .catch((e) => { if (alive) setErr(String(e.message)) })
        return () => { alive = false }
      }, [id])

      if (err) return h('div', { className: 'blk' }, h('div', { className: 'err' }, err))
      if (!t) return h('div', { className: 'empty' }, '正在读这一轮…（英文腹稿会顺带翻成中文，第一次会慢一两秒）')

      const u = t.usage ?? {}
      const facts = t.facts ?? []
      const hits = t.hits ?? []
      const tools = t.tools ?? []
      return h('div', {},
        h('div', { className: 'blk' },
          h('div', { className: 'meta', style: { display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11 } },
            h('span', { className: 'k' }, hhmm(t.ts)),
            h('span', { className: 'k' }, t.thread || ''),
            h('span', { className: 'k' }, t.model || ''),
            h('span', { className: 'k' }, t.ms ? (t.ms / 1000).toFixed(1) + 's' : ''),
            h('span', { className: 'k' }, `tokens ${u.completion_tokens ?? '?'}（想 ${u.reasoning_tokens ?? 0}）`),
          ),
          h('div', { className: 'body' }, '他：「' + String(t.userText || '').slice(0, 300) + '」'),
          h('div', { className: 'body' }, '她：「' + String(t.text || '') + '」'),
        ),
        h('details', { className: 'blk', open: true },
          h('summary', {}, `她想的（${String(t.reasoningZh || t.reasoning || '').length} 字）`),
          h('div', { className: 'body' }, t.reasoningZh || t.reasoning || '（这一轮模型没有返回推理内容）'),
          t.reasoningZh ? h('details', { style: { marginTop: 8 } },
            h('summary', { className: 'k' }, '原文'),
            h('div', { className: 'body k' }, t.reasoning)) : null),
        tools.length ? h('details', { className: 'blk', open: true },
          h('summary', {}, `她伸手了（${tools.length}）`),
          h('div', {}, tools.map((x, i) => h('div', { key: i, className: 'body' },
            `${x.name}(${JSON.stringify(x.args || {})}) → ${String(x.out || '').slice(0, 200)}`)))) : null,
        h('details', { className: 'blk' },
          h('summary', {}, `她看到的事实（${facts.length} 条）`),
          h('div', {}, facts.length
            ? facts.map((x, i) => h('div', { key: i, className: 'body' }, '- ' + x))
            : h('div', { className: 'k' }, '（无）'))),
        h('details', { className: 'blk' },
          h('summary', {}, `她想起的（${hits.length} 条）`),
          h('div', {}, hits.length
            ? hits.map((x, i) => h('div', { key: i, className: 'hit' },
                h('span', { className: 'score' }, '分 ' + x.score),
                h('div', { className: 'body' }, String(x.text || '').slice(0, 180))))
            : h('div', { className: 'k' }, '（没有检索命中）'))),
      )
    }

    /**
     * 一条对话线的 key。和服务端 threadOf 同一口径；
     * 早期没记 thread 的回合（surface 是 'qq' / 'dsh'）统一并到「早期」那一桶，
     * 不然面板上会出现两行一模一样的「早期」。
     */
    function liveKey(x) {
      const t = String(x.thread || '')
      if (t.startsWith('qq:private:') || t.startsWith('qq:group:')) return t
      return x.group ? 'qq:group:' + x.group : '__legacy'
    }

    /** 一条会话的摘要行：名字 / 最后一句 / 时间 / 条数（keyOf 可传入，处理老数据） */
    function threadRows(turns, keyOf = liveKey) {
      const map = new Map()
      for (const x of turns) {
        const key = keyOf(x)
        let r = map.get(key)
        if (!r) { r = { key, group: x.group || '', name: '', count: 0, last: x, ts: 0 }; map.set(key, r) }
        r.count += 1
        const ts = Date.parse(x.ts) || 0
        if (ts >= r.ts) { r.ts = ts; r.last = x }
        if (x.type !== 'utterance') {
          const h = splitHim(x)
          if (h.name) r.name = h.name
          if (h.group) r.group = h.group
        }
      }
      return [...map.values()].sort((a, b) => b.ts - a.ts)
    }

    /**
     * 一行预览。以前写成 `h(PreviewText, {x})` 这种**函数组件**，
     * 但宿主的渲染器只认 createElement 出来的元素/字符串，函数组件不会被执行——
     * 所以列表里那行预览一直是空的（2026-10-29 截图里看得很清楚）。改成普通函数直接算字符串。
     */
    function previewOf(x) {
      const isHer = x?.type === 'utterance'
      const body = isHer ? String(x?.text ?? '') : splitHim(x ?? {}).body
      const t = String(body).replace(/\\s+/g, ' ').trim()
      return (isHer ? '她：' : '') + (t.length > 42 ? t.slice(0, 42) + '…' : t)
    }

    /** 会话行左边的圆头像：群用「群」，私聊用名字首字 */
    /** 会话行左边的头像：先画一个字垫底，真头像走同源代理盖上去；拉不到就露出垫底的字 */
    function avatarOf(row) {
      if (row.key.startsWith('qq:group:')) return '群'
      const n = String(row.name || '').trim()
      return n ? n.slice(0, 1) : '她'
    }

    /**
     * 真 QQ 头像的地址。走插件自己的代理（同源、带磁盘缓存），
     * 不直连腾讯 CDN——页面有 CSP，跨域图会被拦，失败就是一坨破图。
     */
    function avatarSrc(row) {
      const m = String(row.key || '').match(/^qq:(private|group):(\d{5,12})$/)
      if (!m) return ''
      return m[1] === 'group'
        ? `${API}/avatar?group=${m[2]}`
        : `${API}/avatar?uin=${m[2]}`
    }
    /**
     * @param {{active?:boolean, backTick?:number, onRootBack?:Function}} props
     *   active    收起来的时候不轮询（省请求），但组件留着，才能做收起动画
     *   backTick  外壳收到「点框外」时 +1；这里据此退一层（会话→列表，列表→由外壳收起）
     *   onRootBack 已经在最外层（列表）时，交给外壳决定要不要缩成球
     */
    function LivePage({ active = true, backTick = 0, onRootBack = null } = {}) {
      const [data, setData] = useState(null)
      const [err, setErr] = useState('')
      const [view, setView] = useState('list')   // 'list' 或某条会话的 key
      const [sel, setSel] = useState('')

      useEffect(() => {
        if (!active) return undefined
        let alive = true
        const pull = () => {
          if (typeof document !== 'undefined' && document.hidden) return
          get('/live?limit=120')
            .then((j) => { if (alive) { setData(j); setErr('') } })
            .catch((e) => { if (alive) setErr(String(e.message)) })
        }
        pull()
        const t = setInterval(pull, 3000)
        return () => { alive = false; clearInterval(t) }
      }, [active])

      // 点框外：退一层。已经在列表了就让外壳缩回球。
      useEffect(() => {
        if (!backTick) return
        if (view === 'list') { if (typeof onRootBack === 'function') onRootBack() }
        else { setView('list'); setSel('') }
      }, [backTick])

      const all = data?.turns ?? []
      // 兜底：服务端那份 live.mjs 要重启 DSH 才会「顺着 refs 认线」，在那之前
      // 她的老回复全是 thread='qq'。这里只做**高置信度**归位，规则叫「前后夹逼」：
      //   前一条别人说的话、后一条别人说的话，**属于同一条线**，且前一条在 120 秒内
      //   → 才认为她这句是在那条线上回的。
      // 为什么不用「只看前一条」：群和私聊是交错的，她的私聊回复常常紧跟在一条群消息后面，
      // 那样就会显示到错的窗口里（2026-10-29 主人报的「显示错窗口」）。
      // 拿不准的就留在「没记线」那一桶——宁可不归位，也不归错位。重启 DSH 后这段自然失效。
      const MAX_GAP = 120 * 1000
      const sorted = [...all].sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0))
      const keyById = new Map()
      {
        const prevKey = new Map()
        const prevTs = new Map()
        let lk = '__legacy'
        let lts = 0
        for (const x of sorted) {
          prevKey.set(x.id, lk)
          prevTs.set(x.id, lts)
          const k = liveKey(x)
          if (k !== '__legacy' && x.type === 'encounter') { lk = k; lts = Date.parse(x.ts) || 0 }
        }
        const nextKey = new Map()
        let nk = '__legacy'
        for (let i = sorted.length - 1; i >= 0; i -= 1) {
          const x = sorted[i]
          nextKey.set(x.id, nk)
          const k = liveKey(x)
          if (k !== '__legacy') nk = k
        }
        for (const x of sorted) {
          const k = liveKey(x)
          if (k !== '__legacy') { keyById.set(x.id, k); continue }
          const pk = prevKey.get(x.id)
          const ts = Date.parse(x.ts) || 0
          const ok = pk !== '__legacy' && pk === nextKey.get(x.id) && ts - (prevTs.get(x.id) || 0) <= MAX_GAP
          keyById.set(x.id, ok ? pk : '__legacy')
        }
      }
      const keyOf = (x) => keyById.get(x.id) ?? liveKey(x)
      const rows = threadRows(all, keyOf)
      const cur = rows.find((r) => r.key === view)
      const msgs = view === 'list' ? [] : all.filter((x) => keyOf(x) === view).slice().reverse()

      const back = () => { setView('list'); setSel('') }
      const head = (title, right) => h('div', { className: 'page-h' },
        view !== 'list' ? h('button', { className: 'back', onClick: back, title: '回到会话列表' }, '←') : null,
        h('span', { className: 'title' }, title),
        h('span', { className: 'k', style: { marginLeft: 'auto' } }, right),
      )

      // ---------------------------------------------------------------- 会话列表
      if (view === 'list') {
        const sect = [
          ['私聊', rows.filter((r) => r.key.startsWith('qq:private:'))],
          ['群聊', rows.filter((r) => r.key.startsWith('qq:group:'))],
          ['没记线（重启 DSH 后会自动归位）', rows.filter((r) => r.key === '__legacy')],
        ].filter(([, xs]) => xs.length)

        return h('div', { className: 'dlive listv' },
          h('style', {}, LIVE_CSS),
          err ? h('div', { className: 'err' }, err) : null,
          !data && !err ? h('div', { className: 'empty' }, '正在读她的状态…') : null,
          data ? head('会话', `${rows.length} 条 · ${data.traced ?? 0} 轮有记录`) : null,
          data && !rows.length ? h('div', { className: 'empty' }, '还没有对话。') : null,
          sect.map(([label, xs]) => h('div', { key: label, className: 'sec' },
            h('div', { className: 'sec-h' }, label, h('span', { className: 'sec-n' }, String(xs.length))),
            xs.map((r) => h('button', {
              key: r.key, className: 'trow', onClick: () => { setView(r.key); setSel('') },
            },
              h('span', { className: 'trow-ava' + (r.key.startsWith('qq:group:') ? ' grp' : '') },
                avatarOf(r),
                avatarSrc(r)
                  ? h('img', {
                    className: 'trow-ava-img', src: avatarSrc(r), alt: '', loading: 'lazy',
                    onError: (e) => { try { e.currentTarget.style.display = 'none' } catch { /* ignore */ } },
                  })
                  : null,
              ),
              h('div', { className: 'trow-main' },
                h('div', { className: 'trow-top' },
                  h('span', { className: 'trow-name' },
                    r.key.startsWith('qq:group:') ? `群 ${r.group || r.key.split(':')[2] || ''}` : (r.name || '某个人')),
                  h('span', { className: 'trow-time' }, hhmm(r.last.ts)),
                ),
                h('div', { className: 'trow-last' }, previewOf(r.last)),
              ),
              h('span', { className: 'trow-count' }, String(r.count)),
            )),
          )),
          h('div', { className: 'empty k' }, '点一条会话进去看；在她说的那一句上点一下，看她那一轮看到了什么、想起了什么、想了什么。'),
        )
      }

      // ---------------------------------------------------------------- 单条会话
      // 2026-10-29：卡片只有 430px 宽，原来"对话流 + 右栏思考"挤成两条缝，不合理。
      // 改成三级导航：会话列表 → 这条会话 → 某一轮的思考，每层占满整张卡片，
      // 左上角一个 ← 逐层返回（和「点框外退一层」是同一条路径）。
      if (sel) {
        return h('div', { className: 'dlive' },
          h('style', {}, LIVE_CSS),
          h('div', { className: 'feed' },
            h('div', { className: 'page-h' },
              h('button', { className: 'back', onClick: () => setSel(''), title: '回到对话' }, '←'),
              h('span', { className: 'title' }, '她那一轮'),
              h('span', { className: 'k', style: { marginLeft: 'auto' } }, hhmm((msgs.find((m) => m.id === sel) || {}).ts)),
            ),
            h(LiveTurn, { key: sel, id: sel }),
          ),
        )
      }
      return h('div', { className: 'dlive' },
        h('style', {}, LIVE_CSS),
        h('div', { className: 'feed' },
          head(cur ? (cur.key.startsWith('qq:group:') ? `群 ${cur.group || ''}` : (cur.name || '会话')) : '会话', `${msgs.length} 条`),
          err ? h('div', { className: 'err' }, err) : null,
          !msgs.length ? h('div', { className: 'empty' }, '这条会话还没有内容。') : null,
          msgs.map((x) => {
            const isHer = x.type === 'utterance'
            const him = isHer ? null : splitHim(x)
            return h('div', { key: x.id, className: 'msg ' + (isHer ? 'right' : 'left') },
              h('div', {
                className: 'bub ' + (isHer ? 'her' : 'him'),
                onClick: isHer ? () => setSel(x.id) : undefined,
                title: isHer ? '点开看她这一轮怎么想的' : undefined,
              },
                h('div', { className: 'who' },
                  h('span', {}, isHer ? '她' : him.name),
                  h('span', { className: 't' }, hhmm(x.ts)),
                ),
                h('div', { className: 'txt' }, isHer ? x.text : him.body),
                isHer && x.trace
                  ? h('div', { className: 'badge' }, `思考 ${x.trace.reasoning} 字${x.trace.tools ? ` · ${x.trace.tools} 手` : ''}`)
                  : null,
              ))
          }),
          h('div', { className: 'empty k', style: { paddingTop: 6 } }, '点她说的任意一句，看那一轮她看到了什么、想了什么。'),
        ),
      )
    }

    /**
     * 悬浮球：可拖动，松手吸附到左右边缘（2026-10-29 主人要的）。
     *
     * 三个必须处理好的细节：
     *   ① 拖和点要分开——移动超过 6px 才算拖，否则松手就该展开/收起；
     *   ② 位置要记住——存 localStorage，刷新后还在原处；
     *   ③ 上下要夹在视口里——拖到屏幕外就再也抓不着了。
     */
    const BALL_KEY = 'dsh-herself:ball'
    const BALL_SIZE = 36
    const EDGE = 12

    function loadBall() {
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BALL_KEY) : ''
        if (raw) {
          const p = JSON.parse(raw)
          if ((p?.side === 'left' || p?.side === 'right') && Number.isFinite(p?.top)) return p
        }
      } catch { /* 存不了就用默认 */ }
      return { side: 'right', top: 56 }
    }

    /** 松手吸到哪边：看落点在哪半屏 */
    function snapSide(px, width) {
      return Number(px) < Number(width) / 2 ? 'left' : 'right'
    }

    /** 上下夹在视口里：拖出屏幕就再也抓不着了 */
    function clampBallTop(y, vh) {
      const max = Math.max(8, (Number(vh) || 800) - BALL_SIZE - 8)
      return Math.max(8, Math.min(Number(y) || 0, max))
    }
    function saveBall(p) {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(BALL_KEY, JSON.stringify(p)) } catch { /* ignore */ }
    }

    /** 贴在边上时球的横坐标（用 left 统一算，左右只是镜像） */
    function ballX(side, width) {
      const w = Number(width) || 1200
      return side === 'left' ? EDGE : Math.max(EDGE, w - BALL_SIZE - EDGE)
    }

    /** 横向夹在视口里，别拖出屏幕 */
    function clampBallX(x, width) {
      const w = Number(width) || 1200
      return Math.max(EDGE, Math.min(Number(x) || 0, Math.max(EDGE, w - BALL_SIZE - EDGE)))
    }

    const CARD_MAX_W = 430
    const CARD_MAX_H = 620
    const GAP = 10

    /**
     * 卡片往哪边展开——**按球的位置算，不能展开了看不见**（2026-10-29 主人提的）。
     * 规则：
     *   · 横向跟球同侧（左球左对齐、右球右对齐）；
     *   · 纵向优先往下；下面放不下就**往上翻**，底边贴在球上面（球在左下角就是这种情况）；
     *   · 往上翻也会顶出去（球在正中间、视口又矮）→ 退回到贴着视口顶，至少看得见。
     * @returns {{left?:number,right?:number,top?:number,bottom?:number,transformOrigin:string}}
     */
    function cardPlacement({ ballTop = 40, side = 'right', vw = 1200, vh = 800 } = {}) {
      const w = Number(vw) || 1200
      const h = Number(vh) || 800
      const cardH = Math.min(h * 0.78, CARD_MAX_H)
      const horiz = side === 'left' ? { left: EDGE } : { right: EDGE }
      const below = (Number(ballTop) || 0) + BALL_SIZE + GAP
      if (below + cardH <= h - EDGE) return { ...horiz, top: below, transformOrigin: `top ${side}` }
      const bottom = h - (Number(ballTop) || 0) + GAP
      if (h - bottom - cardH >= EDGE) return { ...horiz, bottom, transformOrigin: `bottom ${side}` }
      return { ...horiz, top: EDGE, transformOrigin: `top ${side}` }
    }
    function LiveShell() {
      const [open, setOpen] = useState(false)
      const [pos, setPos] = useState(loadBall)
      // 拖拽状态放在一个**稳定的对象**里：useState 换成对象后原地改字段，
      // 这样 pointermove/up 里的值永远是最新的（用 state 闭包会读到上一次渲染的旧值，
      // 表现就是"偶发点一下没反应"或者"松手没吸附"）。
      const [drag] = useState({ active: false, x0: 0, y0: 0, bx: 0, by: 0, moved: false, px: 0, py: 0 })
      // 拖动过程中球是**自由位置**（不贴边）；松手才滑到边上。
      // 2026-10-29 主人反馈：以前拖的时候横向不动、只换上下，像"死卡在边框上"，松手又瞬间换边像闪现。
      const [free, setFree] = useState(null)
      const [backTick, setBackTick] = useState(0)
      const [grabbing, setGrabbing] = useState(false)
      const [, setTick] = useState(0)

      const vh = () => (typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800)
      const vw = () => (typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200)
      const clampTop = (y) => clampBallTop(y, vh())
      // 全屏 / 拖窗口大小之后球要重新贴边（2026-10-29 主人报的「全屏后原地不动」）：
      // 位置只在渲染时算了一次，窗口变了没人触发重算。这里监听 resize 逼一次重渲染，
      // 渲染时 vw()/vh() 现读，left 就自动吸到新的边上；top 也会被重新夹进视口。
      useEffect(() => {
        if (typeof window === 'undefined' || !window.addEventListener) return undefined
        const onResize = () => setTick((n) => n + 1)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      // 点框外 = 退一层（会话 → 列表 → 缩成球）。
      // 用捕获阶段监听，避免被卡片的冒泡处理吃掉；球自己的点击不算"框外"。
      useEffect(() => {
        if (!open) return undefined
        if (typeof document === 'undefined' || !document.addEventListener) return undefined
        const onDocDown = (e) => {
          const t = e?.target
          const inCard = typeof t?.closest === 'function' && t.closest('.dshell-card')
          const inBall = typeof t?.closest === 'function' && t.closest('.dshell-ball')
          if (inCard || inBall) return
          setBackTick((n) => n + 1)
        }
        document.addEventListener('pointerdown', onDocDown, true)
        return () => document.removeEventListener('pointerdown', onDocDown, true)
      }, [open])

      const onDown = (e) => {
        const t = e?.currentTarget
        try { t?.setPointerCapture?.(e.pointerId) } catch { /* 老浏览器 */ }
        Object.assign(drag, {
          active: true,
          x0: e.clientX,
          y0: e.clientY,
          bx: ballX(pos.side, vw()),   // 起手时球的真实横坐标
          by: pos.top,
          moved: false,
          px: e.clientX,
          py: e.clientY,
        })
      }
      const onMove = (e) => {
        if (!drag.active) return
        const dx = e.clientX - drag.x0
        const dy = e.clientY - drag.y0
        if (!drag.moved && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return
        if (!drag.moved) { drag.moved = true; setGrabbing(true) }
        drag.px = e.clientX
        drag.py = e.clientY
        // 自由跟手：横向也动，不再锁在边上
        setFree({ x: clampBallX(drag.bx + dx, vw()), y: clampTop(drag.by + dy) })
      }
      const onUp = (e) => {
        if (!drag.active) return
        const wasMoved = drag.moved
        const px = drag.px || e.clientX
        const py = drag.py || e.clientY
        Object.assign(drag, { active: false, moved: false })
        setGrabbing(false)
        if (!wasMoved) { setOpen(!open); return }
        // 松手才吸附：落点在左半屏吸左，右半屏吸右；上下保留。
        // free 清空的一瞬间会从"自由位置"过渡到"贴边位置"——CSS 的 transition 就在这一段生效。
        const next = { side: snapSide(px, vw()), top: clampTop(py) }
        setFree(null)
        setPos(next)
        saveBall(next)
      }

      // 每次渲染都按当前视口重新夹一遍：全屏变小、或者从大屏拖到小屏，位置都不会留在外面
      const topNow = clampTop(pos.top)
      const ballStyle = free
        ? { left: clampBallX(free.x, vw()), top: clampTop(free.y), cursor: 'grabbing' }
        : { left: ballX(pos.side, vw()), top: topNow, cursor: grabbing ? 'grabbing' : 'grab' }
      // 卡片展开方向跟着球走：球在下半屏就往上翻，不能展开了看不见
      const cardStyle = cardPlacement({ ballTop: free ? clampTop(free.y) : topNow, side: pos.side, vw: vw(), vh: vh() })
      return h('div', { className: 'dshell' },
        h('style', {}, LIVE_CSS),
        h('button', {
          className: 'dshell-ball' + (open ? ' on' : '') + (grabbing ? ' drag' : ''),
          style: ballStyle,
          onPointerDown: onDown,
          onPointerMove: onMove,
          onPointerUp: onUp,
          onPointerCancel: () => { Object.assign(drag, { active: false, moved: false }); setFree(null); setGrabbing(false) },
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(!open) },
          title: open ? '收起（可以拖到边上）' : '看她（可以拖到边上）',
          'aria-label': open ? '收起' : '展开',
        },
        // 球面上就是她自己的 QQ 头像（主人 2026-10-29 要的）；拉不到就退回那个字。
        h('img', {
          className: 'dshell-ball-img', src: `${API}/avatar?self=1`, alt: '', draggable: 'false',
          onError: (e) => { try { e.currentTarget.style.display = 'none' } catch { /* ignore */ } },
        }),
        h('span', { className: 'dshell-ball-txt' + (open ? ' on' : '') }, open ? '×' : '她')),
        // 卡片常驻，只切换 on 类：这样才能用 CSS 做展开/收起的缩放动画。
        // 收起时 active=false → LivePage 不轮询（不会在后台偷跑请求）。
        h('div', {
          className: 'dshell-card' + (open ? ' on' : '') + (grabbing ? ' drag' : ''),
          style: cardStyle,
          'aria-hidden': open ? 'false' : 'true',
        }, h(LivePage, { active: open, backTick, onRootBack: () => setOpen(false) })),
      )
    }


    const inject = ['slots']

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: NS, order: 8, label: () => '她' },
            HerSection,
          ), 'dsh-herself: settings section'),
        'dsh-herself: settings section',
      )
      // 悬浮球挂在**全局浮层**上（宿主的 `shell.overlay`，整个框架之上）。
      // 以前是挂在左栏「她」+ main 面板上，必须先点左栏才看得到；
      // 2026-10-29 主人说左栏那一行没必要了——球现在哪一页都在，左栏也不占位。
      ctx.effect(
        () => ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: LIVE_ID }, LiveShell), 'dsh-herself: floating ball'),
        'dsh-herself: floating ball',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.HerSection = HerSection
    exports.LivePage = LivePage
    exports.LiveShell = LiveShell
    exports.snapSide = snapSide
    exports.clampBallTop = clampBallTop
    exports.cardPlacement = cardPlacement
    exports.ballX = ballX
    exports.clampBallX = clampBallX
    exports.BALL_SIZE = BALL_SIZE
    return module.exports
  },
})
