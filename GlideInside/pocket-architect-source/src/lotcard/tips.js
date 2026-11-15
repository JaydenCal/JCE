// A small "how to" for the homepage viewer: four one line tips, a close button, "Don't show tips again" and a "?" button that brings them back.
// The choice is remembered in this browser (localStorage, in try/catch). Pure helpers are exported for the tests.
import { h } from '../ui/dom.js';

export const TIPS_KEY = 'gi.viewer.tips';
export const TIPS = [
  'Search an address to load your own lot',
  'Drag to orbit, scroll or pinch to zoom, right drag to pan',
  'Arrows change the design, + adds it to your shortlist',
  'Open full editor to change rooms and walls',
];

/** 'show' (first load), 'hidden' (closed this time only, not stored) or 'off' (stored: do not show tips again). */
export function readTipsPref(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { return storage?.getItem(TIPS_KEY) === 'off' ? 'off' : 'show'; } catch { return 'show'; }
}
export function writeTipsPref(value, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { if (value === 'off') storage?.setItem(TIPS_KEY, 'off'); else storage?.removeItem(TIPS_KEY); return true; } catch { return false; }
}

export const TIPS_CSS = `
.lc-tips{position:absolute;z-index:6;left:14px;top:92px;width:260px;box-sizing:border-box;padding:10px 12px 10px;border-radius:12px;color:#fff;font:500 12px/1.35 var(--lc-sans,system-ui,sans-serif)}
.lc-tips[hidden],.lc-tips-q[hidden]{display:none!important}
.lc-tips ul{margin:6px 0 8px;padding:0 0 0 16px}.lc-tips li{margin:0 0 3px}
.lc-tips-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700;letter-spacing:.04em}
.lc-tips button{font:inherit;color:#fff;cursor:pointer}
.lc-tips-x{width:28px;height:28px;border-radius:14px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08)}
.lc-tips-off{padding:0;border:0;background:none;text-decoration:underline;font-size:11.5px;opacity:.9}
.lc-tips-q{position:absolute;z-index:6;left:14px;top:92px;width:30px;height:30px;border-radius:15px;border:1px solid rgba(255,255,255,.28);padding:0;font:700 14px var(--lc-sans,system-ui,sans-serif);color:#fff;cursor:pointer}
.lc-embed.is-compact .lc-tips{left:54px;top:104px;width:calc(100% - 66px);padding:6px 10px;min-height:34px}
.lc-embed.is-compact .lc-tips ul,.lc-embed.is-compact .lc-tips-off,.lc-embed.is-compact .lc-tips-h b{display:none}
.lc-embed.is-compact .lc-tips-one{display:block}
.lc-tips-one{display:none;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:calc(100% - 34px)}
.lc-embed.is-compact .lc-tips-h{position:relative}
.lc-embed.is-compact .lc-tips-x{position:absolute;right:-4px;top:-3px;width:26px;height:26px}
.lc-embed.is-compact .lc-tips-q{left:54px;top:104px}
`;
let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.id = 'lc-tips-css';
  st.textContent = TIPS_CSS;
  document.head.append(st);
}

/** { el, q, show, hide, dispose }. Append both el and q to the viewer root. */
export function createTips({ storage } = {}) {
  injectCss();
  let pref = readTipsPref(storage);
  const q = h('button', { class: 'lc-tips-q lc-glass', type: 'button', title: 'How to use this viewer', 'aria-label': 'Show tips', dataset: { ps: 'lc-tips-q' }, onclick: () => show() }, '?');
  const one = h('span', { class: 'lc-tips-one' }, 'Tip: ' + TIPS[0]);
  const x = h('button', { class: 'lc-tips-x', type: 'button', 'aria-label': 'Close tips', dataset: { ps: 'lc-tips-close' }, onclick: () => hide() }, '×');
  const off = h('button', { class: 'lc-tips-off', type: 'button', dataset: { ps: 'lc-tips-off' }, onclick: () => { writeTipsPref('off', storage); pref = 'off'; hide(); } }, "Don't show tips again");
  const el = h('section', { class: 'lc-tips lc-glass', 'aria-label': 'How to use this viewer', dataset: { ps: 'lc-tips' } },
    h('div', { class: 'lc-tips-h' }, h('b', null, 'How to'), one, x),
    h('ul', null, ...TIPS.map((t) => h('li', null, t))), off);
  function paint(open) { el.hidden = !open; q.hidden = open; }
  function show() { writeTipsPref('show', storage); pref = 'show'; paint(true); }
  function hide() { paint(false); }
  paint(pref !== 'off');
  return { el, q, show, hide, isOpen: () => !el.hidden, dispose() { el.remove(); q.remove(); } };
}
