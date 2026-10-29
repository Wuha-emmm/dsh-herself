
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
      const [ownerQq, setOwnerQq] = useState('')
      const [ownerMsg, setOwnerMsg] = useState('')
      useEffect(() => { get('/owner').then((r) => setOwnerQq(String(r.owner ?? ''))).catch(() => {}) }, [])
      const saveOwner = useCallback(async (qq) => {
        setOwnerMsg('正在核…')
        try {
          const r = await get('/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qq }) })
          setOwnerQq(r.owner)
          setOwnerMsg(`已设为 ${r.owner}${r.nickname ? '（' + r.nickname + '）' : ''}；她下一轮生效`)
        } catch (e) { setOwnerMsg('没存上：' + e.message) }
      }, [])
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
            // brain 其实是插件内部的本地服务（不是模型）；以前标成「模型」是错的
            h('span', { className: 'chip ' + (health === null ? '' : (health.brain?.ok ? 'good' : 'bad')) }, '内部服务 ' + (health === null ? '…' : (health.brain?.ok ? '通' : '断'))),
            h('span', { className: 'chip ' + (health === null ? '' : (health.qq?.online ? 'good' : 'bad')) }, 'QQ ' + (health === null ? '…' : (health.qq?.online ? '在线' : '离线'))),
            // 浏览器是可选的：只有要看网页/空间时才需要。没开不该报红，那会让人以为她坏了
            h('span', { className: 'chip ' + (health === null ? '' : (health.edge?.cdp ? 'good' : '')) }, '浏览器 ' + (health === null ? '…' : (health.edge?.cdp ? '在' : '未开'))),
            h('span', { className: 'chip ' + (health === null ? '' : (health.listener?.alive ? 'good' : 'bad')) }, '监听 ' + (health === null ? '…' : (health.listener?.alive ? '在' : '断了'))),
            h('span', { className: 'chip ' + (health === null ? '' : (health.wake?.alive ? 'good' : 'bad')) }, '主动发言 ' + (health === null ? '…' : (health.wake?.alive ? '在' : '停了'))),
          ),
          h('p', { className: 'sub', style: { marginTop: 8 } }, '浏览器只在要看网页 / QQ 空间时才需要，没开不影响她说话；要开去「登录」页。'),
          health === null
            ? h('p', { className: 'sub', style: { marginTop: 8 } }, '健康接口还没响应——如果一直停在这里，说明插件没重载或 /health 路由没注册。')
            : (health.lastError ? h('p', { className: 'sub', style: { marginTop: 8, color: '#d9534f' } }, '最近错误：' + health.lastError) : null),
        ),

        h('div', { className: 'card' },
        h('div', { className: 'card' },
        h('div', { className: 'card' },
          h('h3', {}, '主人是谁（只认这个号）'),
          h('p', { className: 'sub' }, '写死在 secrets/qq.json，不走文本识别。存之前拿 OneBot API 核一次昵称，查不到不让存。'),
          h('div', { className: 'row' },
            h('span', { style: { flex: 1 } }, '现在是：' + (ownerQq || '（还没配）')),
            h('button', { className: 'go', onClick: () => { const v = window.prompt('主人 QQ 号（5-12 位数字）', ownerQq || ''); if (v) saveOwner(v) } }, ownerQq ? '改' : '设置'),
          ),
          ownerMsg ? h('p', { className: 'sub', style: { marginTop: 8 } }, ownerMsg) : null,
        ),

          h('h3', {}, '谁能让我联系 DS'),
          h('p', { className: 'sub' }, '这条通道不是对所有人开的。下面三条写死在代码里，不靠我临场判断：'),
          h('div', { className: 'row' }, h('span', { className: 'chip on' }, '只有主人'), h('span', { style: { flex: 1 } }, '群里的人 @ 我、陌生人私聊我，都投不出去')),
          h('div', { className: 'row' }, h('span', { className: 'chip on' }, '只在私聊'), h('span', { style: { flex: 1 } }, '群里一句话被截图转出去，等于把入口交出去')),
          h('div', { className: 'row' }, h('span', { className: 'chip' }, '每小时 6 条'), h('span', { style: { flex: 1 } }, '防止被人反复诱导刷屏')),
          h('p', { className: 'sub', style: { marginTop: 8 } }, '被挡住时我会直说「这条通道只对主人开」，不会假装没听见。'),
        ),
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

        s?.readonly
          ? h('div', { className: 'card ro' },
            h('h3', {}, '这个面板只能看'),
            h('p', { className: 'muted' }, `她在另一个 DSH 工作区里跑（pid ${s?.brainHolder ?? '?'}）。`),
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
          h('h3', {}, `她现在相信什么（${(s.beliefs || []).length} 条）`),
          (s.beliefs || []).filter((b) => !q || String(b.text).includes(q)).length
            ? (s.beliefs || []).filter((b) => !q || String(b.text).includes(q)).map((b) => h('div', { key: b.id, style: { padding: '7px 0', borderTop: '.5px solid var(--dsw-alias-border-l2)' } },
              h('div', { className: 'row' },
                h('span', { className: 'chip ' + (b.status === 'active' ? 'on' : 'off') }, b.status === 'active' ? '算数' : '已顶掉'),
                h('span', { style: { flex: 1 } }, b.text),
                h('span', { className: 'muted' }, String(b.since ?? b.at ?? '').slice(5, 16).replace('T', ' ')),
              ),
              b.evidence && b.evidence[0]
                ? h('div', { className: 'sub', style: { marginTop: 3 } }, '当初是因为：' + String(b.evidence[0].text ?? '').slice(0, 60))
                : null,
              b.until ? h('div', { className: 'sub' }, '顶掉于 ' + String(b.until).slice(5, 16).replace('T', ' ')) : null,
            ))
            : h('p', { className: 'muted' }, q ? '没有匹配的判断。' : '还没有判断。先让她说一句话。'),
          h('p', { className: 'sub', style: { marginTop: 8 } }, '这里只能看：判断是她自己下的，你改不了。过时了就直接告诉她。'),
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
            h('button', { className: 'go', onClick: () => act('/stack/start', { confirm: 'yes' }) }, '启动 / 自愈'),
            // 破坏性操作先问一次，再去服务端（服务端还会再验一次 confirm）
            h('button', { className: 'go danger', onClick: () => { if (window.confirm('确认停掉她？她正在跟你说话的话会停在半句。')) act('/stack/stop', { confirm: 'yes' }) } }, '停止'),
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
                  : tab === 'hands' ? h(HandsPage)
                    : tab === 'snowluma' ? h(SnowLumaPage) : h(StatePage)
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

    