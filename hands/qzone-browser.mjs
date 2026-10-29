// hands/qzone-browser.mjs —— 用她自己的 Edge profile 操作 QQ 空间页面
//
// 关键事实（2026-10-29 实测）：空间的说说列表在**同源 iframe** 里，
// 主文档只有导航。所以所有查找/点击都要先收集 document + 所有 iframe 的 document。
//
// 用法：
//   node hands/qzone-browser.mjs probe
//   node hands/qzone-browser.mjs like <n> [--dry]
//   node hands/qzone-browser.mjs comment <n> "文字" [--dry]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cdpVersion, newTab, closeTab, connect, evaluate, waitFor, screenshot } from './cdp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HER = path.resolve(here, '..')
const OUT = path.join(HER, 'logs', 'shots')
const UIN = process.env.QZ_UIN || (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(HER, 'secrets', 'qq.json'), 'utf8')).self ?? '') } catch { return '' }
})()
const HOME = `https://user.qzone.qq.com/${UIN}/311`

/** 注入到页面里的工具：收集主文档 + 所有同源 iframe 的 document */
const HELPERS = `
  const __docs = () => {
    const out = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try { if (f.contentDocument?.body) out.push(f.contentDocument); } catch {}
    }
    return out;
  };
  const __all = (sel) => __docs().flatMap((d) => { try { return Array.from(d.querySelectorAll(sel)); } catch { return []; } });
  const __visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const __text = (el) => (el.innerText || '').replace(/\\s+/g, ' ').trim();
`

const PROBE_JS = `(() => {
  ${HELPERS}
  const out = [];
  for (const el of __all('a,button,div,span,li')) {
    const t = __text(el);
    if (!t || t.length > 16 || !/赞|评论|回复|发送|说一句/.test(t)) continue;
    if (!__visible(el)) continue;
    const r = el.getBoundingClientRect();
    out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 50), text: t, x: Math.round(r.x), y: Math.round(r.y), ce: el.isContentEditable === true });
    if (out.length >= 50) break;
  }
  const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => {
    try { return { src: f.src, ok: Boolean(f.contentDocument), len: f.contentDocument?.body?.innerText?.length ?? 0 }; } catch { return { src: f.src, ok: false }; }
  });
  return { url: location.href, title: document.title, iframes, controls: out };
})()`

const LIKE_JS = (index, dry) => `(() => {
  ${HELPERS}
  const cands = __all('a.qz_like_btn, a[class*="qz_like_btn"]').filter((el) => __visible(el));
  const el = cands[${index}];
  if (!el) return { ok: false, reason: '没找到赞按钮', total: cands.length };
  if (${dry}) return { ok: true, dry: true, total: cands.length, text: __text(el) };
  el.click();
  return { ok: true, clicked: __text(el), total: cands.length };
})()`

const COMMENT_JS = (index, text, dry) => `(() => {
  ${HELPERS}
  const boxes = __all('[contenteditable="true"], textarea, input[type="text"]').filter((el) => {
    if (!__visible(el)) return false;
    const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.innerText || '';
    return /说一句|评论/.test(ph);
  });
  const box = boxes[${index}];
  if (!box) return { ok: false, reason: '没找到评论输入框', total: boxes.length };
  box.focus();
  if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
    box.value = ${JSON.stringify(text)};
    box.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    box.innerHTML = ${JSON.stringify(text)};
    box.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  if (${dry}) return { ok: true, dry: true, total: boxes.length };
  // 发送：优先找同一容器里的「发表/发送」按钮
  const scope = box.closest('div')?.parentElement ?? document;
  const btns = Array.from(scope.querySelectorAll('a,button,span,div')).filter((el) => {
    const t = __text(el);
    return (t === '发表' || t === '发送' || t === '评论') && __visible(el);
  });
  const btn = btns[btns.length - 1];
  if (!btn) return { ok: false, reason: '填了字但没找到发送按钮', total: boxes.length };
  btn.click();
  return { ok: true, sent: true, total: boxes.length };
})()`

async function withPage(fn) {
  const v = await cdpVersion()
  if (!v) throw new Error('CDP 不可用（Edge 没开或 9222 没监听）')
  const tab = await newTab('about:blank')
  const { call, close } = await connect(tab)
  try {
    await call('Page.enable')
    await call('Runtime.enable')
    await call('Page.navigate', { url: HOME })
    await waitFor(call, `document.readyState === 'complete'`, 20000)
    await new Promise((r) => setTimeout(r, 3500))
    return await fn({ call, tab })
  } finally {
    close()
    await closeTab(tab.id)
  }
}

export async function probe() {
  fs.mkdirSync(OUT, { recursive: true })
  return withPage(async ({ call }) => {
    const info = await evaluate(call, PROBE_JS)
    const shot = path.join(OUT, `qzone-${Date.now()}.png`)
    await screenshot(call, shot)
    return { ...info, shot }
  })
}

export async function like(index = 0, { dry = false } = {}) {
  return withPage(async ({ call }) => evaluate(call, LIKE_JS(Number(index) || 0, dry ? 'true' : 'false')))
}

export async function comment(index = 0, text = '', { dry = false } = {}) {
  return withPage(async ({ call }) => evaluate(call, COMMENT_JS(Number(index) || 0, text, dry ? 'true' : 'false')))
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const rest = args.filter((a) => a !== '--dry')
  const [cmd, a, ...tail] = rest
  if (cmd === 'probe') {
    const r = await probe()
    console.log(JSON.stringify({ url: r.url, title: r.title, iframes: r.iframes, shot: r.shot, controls: r.controls.slice(0, 20) }, null, 2))
  } else if (cmd === 'like') {
    console.log(JSON.stringify(await like(a ?? 0, { dry }), null, 2))
  } else if (cmd === 'comment') {
    console.log(JSON.stringify(await comment(a ?? 0, tail.join(' '), { dry }), null, 2))
  } else {
    console.log('用法：probe | like <n> [--dry] | comment <n> "文字" [--dry]')
  }
}
