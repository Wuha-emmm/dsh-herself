// lib/intent.mjs —— 她在对话里说「我要做某事」，我们识别成可执行动作
//
// 只认明确、低风险、可回滚的说法。识别不出来就不做——宁可漏，不可猜。
// 注意：这里是"她说，我们做"，不是"我们替她决定"。

const RULES = [
  // 改个签
  {
    kind: 'longnick',
    re: /(?:把|将)?(?:你的|我的|她自己的)?个签(?:改成|换成|写成|改为|更新为)[：:，,\s]*[「“"']?([^」”"'\n。！？]{1,30})/,
    build: (m) => ({ kind: 'longnick', text: m[1].trim() }),
  },
  // 给某人点赞（QQ 号）
  {
    kind: 'like',
    re: /给\s*(\d{5,12})\s*点\s*([0-9一二三四五六七八九十]{1,2})?\s*个?赞/,
    build: (m) => ({ kind: 'like', userId: m[1], times: m[2] ? Math.min(10, Number(m[2]) || 1) : 1 }),
  },
  // 给「主人/你」点赞
  {
    kind: 'like-owner',
    re: /给(?:主人|你)点(?:个)?赞/,
    build: () => ({ kind: 'like-owner' }),
  },
  // 她自己的文件夹：看、读、写、删
  {
    kind: 'fs-list',
    re: /(?:看看|看下|看一?眼)?\s*(?:你的|我的)?(?:沙箱|文件夹|目录)(?:里)?(?:有(?:什么|啥)|的文件)?[？?]?\s*$/,
    build: () => ({ kind: 'fs-list' }),
  },
  {
    kind: 'fs-read',
    re: /(?:读|打开|看)(?:一下|看)?\s*([\w\u4e00-\u9fa5-]+\.(?:md|txt|json|csv|log))/,
    build: (m) => ({ kind: 'fs-read', name: m[1] }),
  },
  {
    kind: 'fs-write',
    re: /(?:写|记|存)(?:一?个|一?张|下)?(?:便签|文件|笔记)[：:，,\s]\s*([\s\S]{1,500})/,
    build: (m) => ({ kind: 'fs-write', content: m[1].trim() }),
  },
  {
    kind: 'fs-remove',
    re: /删(?:掉|除)\s*([\w\u4e00-\u9fa5-]+\.(?:md|txt|json|csv|log))/,
    build: (m) => ({ kind: 'fs-remove', name: m[1] }),
  },
]

/** @returns {{kind:string, text?:string, userId?:string, times?:number}|null} */
export function parseAction(text = '') {
  const t = String(text ?? '').trim()
  if (!t || t.length < 4) return null
  for (const r of RULES) {
    const m = t.match(r.re)
    if (m) return r.build(m)
  }
  return null
}
