// The tutorial card: arrow to the real control, Back, Next and Skip tutorial. Beside the control, never over the lot or the 3D view;
// at 390 px wide it becomes a bottom sheet. coach.start(kind) / restart(kind) / stop().
import { h } from '../ui/dom.js';
import { tutorialFor, readTutorial, writeTutorial, shouldStartTutorial, stepIndexForFlow } from './steps.js';

const AVOID = '.gf-stage,.gf-3d,.lc-card,[data-ps="lot-card"],.ps-stage canvas';
export const CSS = `
.tut-card{position:fixed;z-index:2147483000;width:260px;box-sizing:border-box;padding:12px 14px;border-radius:12px;background:#12263a;color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)}
.tut-card[hidden]{display:none}
.tut-card p{margin:0 0 10px}.tut-count{font-size:11px;opacity:.7;margin-bottom:4px}
.tut-row{display:flex;gap:8px;align-items:center}.tut-row button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;padding:6px 10px;min-height:32px}
.tut-next{background:#c7a256!important;color:#12263a!important;border-color:#c7a256!important;font-weight:700}
.tut-skip{margin-left:auto;border:0!important;text-decoration:underline;padding:6px 0!important}
.tut-arrow{position:absolute;width:12px;height:12px;background:#12263a;transform:rotate(45deg)}
.tut-hl{outline:2px solid #c7a256;outline-offset:3px;border-radius:6px}
@media (max-width:600px){.tut-card{left:8px!important;right:8px;top:auto!important;bottom:8px;width:auto}.tut-arrow{display:none}}
`;

/** Where to put a card of size (w,h) beside rect r inside the viewport, avoiding the rects in `avoid`. Returns { left, top, side } or null (use the bottom sheet). Pure. */
export function placeBeside(r, size, view, avoid = []) {
  const gap = 14;
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const tries = [
    ['right', r.right + gap, r.top + r.height / 2 - size.h / 2],
    ['left', r.left - gap - size.w, r.top + r.height / 2 - size.h / 2],
    ['below', r.left + r.width / 2 - size.w / 2, r.bottom + gap],
    ['above', r.left + r.width / 2 - size.w / 2, r.top - gap - size.h],
  ];
  for (const [side, x, y] of tries) {
    const left = Math.min(Math.max(8, x), view.w - size.w - 8), top = Math.min(Math.max(8, y), view.h - size.h - 8);
    const box = { left, top, right: left + size.w, bottom: top + size.h };
    if (!avoid.some((a) => hit(box, a)) && !hit(box, r)) return { left, top, side };
  }
  return null;
}

export function createTutorial({ getFlow = () => null, storage } = {}) {
  let kind = null, steps = [], i = 0, active = false, timer = null;
  const text = h('p'), count = h('div', { class: 'tut-count' });
  const back = h('button', { type: 'button', dataset: { ps: 'tutorial-back' }, onclick: () => go(i - 1) }, 'Back');
  const next = h('button', { type: 'button', class: 'tut-next', dataset: { ps: 'tutorial-next' }, onclick: () => go(i + 1) }, 'Next');
  const skip = h('button', { type: 'button', class: 'tut-skip', dataset: { ps: 'tutorial-skip' }, onclick: () => end('skipped') }, 'Skip tutorial');
  const arrow = h('div', { class: 'tut-arrow' });
  const el = h('div', { class: 'tut-card', hidden: true, role: 'dialog', 'aria-label': 'Tutorial', dataset: { ps: 'tutorial' } }, arrow, count, text, h('div', { class: 'tut-row' }, back, next, skip));
  let hl = null;
  if (typeof document !== 'undefined') {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    document.body.append(el);
    window.addEventListener('resize', () => active && paint());
  }

  function end(value) { active = false; el.hidden = true; hl?.classList.remove('tut-hl'); hl = null; clearInterval(timer); if (value) writeTutorial(kind, value, storage); }
  async function go(n) {
    if (n < 0) return;
    if (n >= steps.length) { end('done'); return; }
    const s = steps[n], flow = getFlow();
    // Moving to a control in another flow step takes the flow there first (the flow asks its own question if it has one).
    const want = s.where === 'editor' ? 5 : s.flowStep;
    if (flow?.isOpen && flow.step !== want) {
      if (want > flow.step) {
        // Forward moves use the flow's own Next, so a step that still needs something (a lot, a home) is never skipped.
        const nb = document.querySelector('[data-ps="flow-next"]');
        if (!nb || nb.disabled) { text.textContent = 'Finish this step first, then press Next.'; return; }
        nb.click(); await new Promise((r) => setTimeout(r, 600));
        if (flow.step < want && flow.step !== 5) return paint();
      } else await flow.go(want);
    }
    i = n; paint();
  }
  function paint() {
    if (!active) return;
    const s = steps[i];
    count.textContent = `Tutorial ${i + 1} of ${steps.length}`;
    text.textContent = s.text;
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Done' : 'Next';
    hl?.classList.remove('tut-hl');
    const t = document.querySelector(s.target);
    hl = t; t?.classList.add('tut-hl');
    el.hidden = false;
    if (!t) { el.style.left = '8px'; el.style.top = 'auto'; el.style.bottom = '8px'; arrow.style.display = 'none'; return; }
    const r = t.getBoundingClientRect();
    const avoid = [...document.querySelectorAll(AVOID)].map((n) => n.getBoundingClientRect()).filter((b) => b.width > 40 && b.height > 40);
    const pos = placeBeside(r, { w: el.offsetWidth || 260, h: el.offsetHeight || 120 }, { w: innerWidth, h: innerHeight }, avoid);
    el.style.bottom = 'auto';
    if (!pos) { el.style.left = '8px'; el.style.top = 'auto'; el.style.bottom = '8px'; arrow.style.display = 'none'; return; }
    el.style.left = `${pos.left}px`; el.style.top = `${pos.top}px`;
    arrow.style.display = '';
    const cx = r.left + r.width / 2 - pos.left, cy = r.top + r.height / 2 - pos.top;
    Object.assign(arrow.style, { left: pos.side === 'right' ? '-6px' : pos.side === 'left' ? 'auto' : `${Math.max(12, Math.min(236, cx))}px`, right: pos.side === 'left' ? '-6px' : 'auto', top: pos.side === 'below' ? '-6px' : pos.side === 'above' ? 'auto' : `${Math.max(12, cy)}px`, bottom: pos.side === 'above' ? '-6px' : 'auto' });
  }
  const begin = (k, from) => { kind = k; steps = tutorialFor(k); active = true; i = from ?? 0; clearInterval(timer); timer = setInterval(paint, 700); paint(); };
  return {
    el, get active() { return active; }, get index() { return i; },
    /** First visit only (not after Done or Skip). Returns whether it started. */
    startIfFirst(k, flowStep = 1) { if (!shouldStartTutorial(k, storage)) return false; begin(k, stepIndexForFlow(tutorialFor(k), flowStep) ?? 0); return true; },
    /** The "Show me how" and "?" buttons: always restarts, from the first step. */
    restart(k) { writeTutorial(k, null, storage); begin(k, 0); },
    stop() { end(null); },
    status: (k) => readTutorial(k, storage),
  };
}
