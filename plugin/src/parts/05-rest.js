

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
      // 顺序跟 QQ 一致：上旧下新（以前 reverse 过，看起来像倒着长）
      const msgs = view === 'list' ? [] : all.filter((x) => keyOf(x) === view)
      // 进来先贴底（显示最新的）。两个坑：
      //   ① 卡片里真正滚动的是 .feed，.msgs 只是普通块——所以要往上找可滚动的那层；
      //   ② effect 可能在布局之前跑，那时 scrollHeight 还是 0，需要重试几次。
      useEffect(() => {
        if (view === 'list') return
        const tick = (n) => {
          const start = document.querySelector('.dshell-card .dlive .msgs')
          if (!start) return
          let el = start
          while (el && el.scrollHeight <= el.clientHeight + 2) el = el.parentElement
          const target = el || start
          const first = target.dataset.seen !== view
          const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80
          if (first || nearBottom) {
            target.scrollTop = target.scrollHeight
            target.dataset.seen = view
          }
          if (n < 5 && (target.scrollHeight <= target.clientHeight + 2 || first)) {
            setTimeout(() => tick(n + 1), 60)
          }
        }
        tick(0)
      }, [view, msgs.length])
      // 时间分隔条：相邻两条隔了 10 分钟以上（或跨天）就插一个时间，像 QQ 一样
      const rowsWithSep = []
      msgs.forEach((x, k) => {
        const prev = msgs[k - 1]
        const gap = prev ? (Date.parse(x.ts) - Date.parse(prev.ts)) : Infinity
        const newDay = prev && String(prev.ts).slice(0, 10) !== String(x.ts).slice(0, 10)
        if (!prev || gap >= 10 * 60000 || newDay) rowsWithSep.push({ sep: true, key: 'sep-' + x.id, at: x.ts, newDay })
        rowsWithSep.push(x)
      })

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
          h('div', { className: 'msgs' },
          rowsWithSep.map((x) => {
            if (x.sep) {
              const t = String(x.at).slice(11, 16)
              const day = String(x.at).slice(5, 10).replace('-', ' 月 ') + ' 日'
              return h('div', { key: x.key, className: 'sep' }, x.newDay ? (day + ' ' + t) : t)
            }
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
          ),
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
