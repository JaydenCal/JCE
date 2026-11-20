// The tutorial card: arrow to the real control, Back, Next and Skip tutorial. Beside the control, never over the lot or the 3D view;
// at 390 px wide it becomes a bottom sheet. coach.start(kind) / restart(kind) / stop().
import { h } from '../ui/dom.js';
import { tutorialFor, readTutorial, writeTutorial, shouldStartTutorial, stepIndexForFlow, chapterById, markChapter, BASICS_ID } from './steps.js';
import { createHelpMenu } from './menu.js';
import { isPhoneMode } from '../phone/mode.js';
import { touchLine } from '../phone/touch-text.js';

const AVOID_FLOW = '.gf-stage,.gf-3d,.gf-foot,.gf-head';
const AVOID_EDITOR = '.lc-card,[data-ps="lot-card"],.ps-stage canvas';
export const CSS = `
.tut-card{position:fixed;z-index:2147483000;width:260px;box-sizing:border-box;padding:12px 14px;border-radius:12px;background:#12263a;color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)}
.tut-card[hidden]{display:none}
.tut-card p{margin:0 0 10px}.tut-count{font-size:11px;opacity:.7;margin-bottom:4px}
.tut-row{display:flex;gap:8px;align-items:center}.tut-row button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;padding:6px 10px;min-height:32px}
.tut-next{background:#c7a256!important;color:#12263a!important;border-color:#c7a256!important;font-weight:700}
.tut-skip{margin-left:auto;border:0!important;text-decoration:underline;padding:6px 0!important}
.tut-arrow{position:absolute;width:12px;height:12px;background:#12263a;transform:rotate(45deg)}
.tut-hl{outline:2px solid #c7a256;outline-offset:3px;border-radius:6px}
@media (max-width:600px){.tut-card{left:8px!important;right:8px;top:auto!important;bottom:8px!important;width:auto}.tut-arrow{display:none}}
`;

/** Where to put a card of size (w,h) beside rect r inside the viewport, avoiding the rects in `avoid`. Returns { left, top, side } or null (use the bottom sheet). Pure. */
export function placeBeside(r, size, view, avoid = []) {
  const gap = 14;
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const tries = [
    ['below', r.left + r.width / 2 - size.w / 2, r.bottom + gap + 24],
    ['right', r.right + gap, r.top + r.height / 2 - size.h / 2],
    ['left', r.left - gap - size.w, r.top + r.height / 2 - size.h / 2],
    ['above', r.left + r.width / 2 - size.w / 2, r.top - gap - size.h],
  ];
  for (const [side, x, y] of tries) {
    const left = Math.min(Math.max(8, x), view.w - size.w - 8), top = Math.min(Math.max(8, y), view.h - size.h - 8);
    const box = { left, top, right: left + size.w, bottom: top + size.h };
    if (!avoid.some((a) => hit(box, a)) && !hit(box, r)) return { left, top, side };
  }
  return null;
}

/** Another dialog or prompt is on screen (a modal such as the plan set preview, the profile prompt): the coach steps aside so only one shows. Pure on `doc`. */
export const OTHER_PROMPTS = '.ps-modal,.psp-modal,.gi-terms,.tv-dlg,.ps-prof-prompt'; // not the guided flow itself (it is also a dialog, and the coach lives over it)
export const otherPromptOpen = (doc = typeof document !== 'undefined' ? document : null) => !!doc?.querySelector?.(OTHER_PROMPTS);

/** Where a card of size (w,h) goes when it cannot sit beside its target: the first screen corner that touches neither the target nor anything in `avoid`. Null when every corner is taken. Pure. */
export function placeCorner(r, size, view, avoid = []) {
  const m = 8;
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const corners = [['br', view.w - size.w - m, view.h - size.h - m], ['tr', view.w - size.w - m, m], ['tl', m, m], ['bl', m, view.h - size.h - m]];
  for (const [, left, top] of corners) {
    const box = { left, top, right: left + size.w, bottom: top + size.h };
    if (!avoid.some((a) => hit(box, a)) && !(r && hit(box, r))) return { left, top };
  }
  return null;
}

export function createTutorial({ getFlow = () => null, onEnter = null, storage } = {}) {
  let kind = null, steps = [], i = 0, skippedAddress = false, active = false, timer = null, chapterId = BASICS_ID, hint = '';
  const text = h('p'), count = h('div', { class: 'tut-count' });
  const back = h('button', { type: 'button', dataset: { ps: 'tutorial-back' }, onclick: () => go(i - 1) }, 'Back');
  const next = h('button', { type: 'button', class: 'tut-next', dataset: { ps: 'tutorial-next' }, onclick: () => go(i + 1) }, 'Next');
  // Skip works on the first press and is remembered at once (pointerdown, not only click, so a repaint between the two cannot swallow it).
  let skipped = false;
  const doSkip = (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); if (skipped) return; skipped = true; end('skipped'); setTimeout(() => { skipped = false; }, 400); };
  const skip = h('button', { type: 'button', class: 'tut-skip', dataset: { ps: 'tutorial-skip' }, onpointerdown: doSkip, onclick: doSkip }, 'Skip tutorial');
  const arrow = h('div', { class: 'tut-arrow' });
  const el = h('div', { class: 'tut-card', hidden: true, role: 'dialog', 'aria-label': 'Tutorial', dataset: { ps: 'tutorial' } }, arrow, count, text, h('div', { class: 'tut-row' }, back, next, skip));
  let hl = null;
  if (typeof document !== 'undefined') {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    document.body.append(el);
    window.addEventListener('resize', () => active && paint());
    // A dialog opening or closing is noticed at once (not on the next 700 ms tick).
    try { new MutationObserver(() => { if (active && otherPromptOpen() !== wasBlocked) paint(); }).observe(document.body, { childList: true, subtree: true }); } catch { /* no observer: the timer still checks */ }
  }

  let gen = 0; // bumped by end(), so a step change still waiting on the flow cannot paint after the card was closed
  function end(value) {
    gen += 1;
    active = false; el.hidden = true; hl?.classList.remove('tut-hl'); hl = null; clearInterval(timer);
    // Finishing the Basics (or skipping the first visit tour) is remembered as before; any chapter that is finished is ticked in the menu.
    if (value && chapterId === BASICS_ID) writeTutorial(kind, value, storage);
    if (value === 'done') markChapter(kind, chapterId, true, storage);
  }
  async function go(n) {
    if (n < 0) return;
    if (n >= steps.length) { end('done'); return; }
    const s = steps[n], flow = getFlow(), mine = gen;
    // Moving to a control in another flow step takes the flow there first (the flow asks its own question if it has one).
    const want = s.where === 'editor' ? 5 : s.flowStep;
    if (s.where === 'flow' && !flow?.isOpen) {
      // In the editor: the "Back to placement" pill reopens the flow at step 3, and the flow takes it from there.
      const pill = document.querySelector('[data-ps="flow-back-to-placement"]');
      if (pill && !pill.hidden) {
        pill.click(); await new Promise((r) => setTimeout(r, 700));
        const f2 = getFlow(); if (f2?.isOpen && f2.step !== want) await f2.go(want);
      } else { hint = 'This step is in the guided flow. Press New to start a design, then try again.'; i = n; paint(); return; }
    } else if (flow?.isOpen && flow.step !== want) {
      if (want > flow.step) {
        // Forward moves use the flow's own Next, so a step that still needs something (a lot, a home) is never skipped.
        for (let guard = 0; flow.isOpen && flow.step < want && guard < 5; guard += 1) {
          const nb = document.querySelector('[data-ps="flow-next"]');
          if (!nb || nb.disabled) { hint = 'Finish this step first, then press Next.'; paint(); return; }
          nb.click(); await new Promise((r) => setTimeout(r, 700));
        }
      } else await flow.go(want);
    }
    if (mine !== gen) return;
    hint = ''; i = n; try { onEnter?.(s); } catch { /* the tool is optional */ } paint();
  }
  // The card follows the flow: when the person moves on with the flow's own Next or Back (or opens the editor), the tutorial jumps to the first
  // step that belongs to where they are, so it never shows "Type your address" over the placement step.
  function syncToFlow() {
    const flow = getFlow(); if (!flow) return;
    const s = steps[i]; if (!s) return;
    const open = !!flow.isOpen;
    // A lot is already found (the website's ?sample=1 link, or a returning visit): the card moves past "Type your address" once, so it never opens over the step that follows. Back still reaches it.
    if (!skippedAddress && s.id === 'address' && open && flow.step === 1 && typeof document !== 'undefined' && document.querySelector('[data-ps="flow-setbacks"]')) {
      skippedAddress = true;
      const j = steps.findIndex((x, n) => n > i && x.where === 'flow' && x.flowStep === 1);
      if (j >= 0) { i = j; return; }
    }
    if (s.where === 'flow' && open && s.flowStep !== flow.step) { const j = stepIndexForFlow(steps, flow.step); if (j !== null) i = j; }
    else if (s.where === 'flow' && !open) { const j = steps.findIndex((x) => x.where === 'editor'); if (j >= 0) i = j; }
    else if (s.where === 'editor' && open) { const j = stepIndexForFlow(steps, flow.step); if (j !== null) i = j; }
  }
  let wasBlocked = false;
  function paint() {
    if (!active) return;
    // Never over another dialog or prompt: the card hides while one is open and comes back when it closes.
    wasBlocked = otherPromptOpen();
    if (wasBlocked) { el.hidden = true; hl?.classList.remove('tut-hl'); hl = null; return; }
    syncToFlow();
    const s = steps[i];
    count.textContent = `${chapterById(kind, chapterId)?.title || 'Tutorial'}: ${i + 1} of ${steps.length}`;
    text.textContent = isPhoneMode() ? touchLine(hint || s.text) : (hint || s.text);
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Done' : 'Next';
    hl?.classList.remove('tut-hl');
    const t = document.querySelector(s.target);
    hl = t; t?.classList.add('tut-hl');
    el.hidden = false;
    if (innerWidth <= 600) { // bottom sheet (CSS), lifted above the flow footer so it never covers Back and Next
      el.style.left = el.style.top = el.style.bottom = ''; arrow.style.display = 'none';
      const foot = document.querySelector('[data-ps="flow-root"]:not([hidden]) .gf-foot');
      if (foot && foot.offsetHeight) el.style.setProperty('bottom', `${foot.offsetHeight + 8}px`, 'important'); else el.style.removeProperty('bottom');
      return;
    }
    const avoidFor = () => [...document.querySelectorAll(document.querySelector('[data-ps="flow-root"]:not([hidden])') ? AVOID_FLOW : AVOID_EDITOR)].map((n) => n.getBoundingClientRect()).filter((b) => b.width > 40 && b.height > 40);
    const corner = (rect) => {
      const c = placeCorner(rect, { w: el.offsetWidth || 260, h: el.offsetHeight || 120 }, { w: innerWidth, h: innerHeight }, avoidFor());
      el.style.left = `${c ? c.left : 8}px`; el.style.top = c ? `${c.top}px` : 'auto'; el.style.bottom = c ? 'auto' : '8px'; arrow.style.display = 'none';
    };
    if (!t) { corner(null); return; }
    const r = t.getBoundingClientRect();
    const avoid = [...document.querySelectorAll(document.querySelector('[data-ps="flow-root"]:not([hidden])') ? AVOID_FLOW : AVOID_EDITOR)].map((n) => n.getBoundingClientRect()).filter((b) => b.width > 40 && b.height > 40);
    const pos = placeBeside(r, { w: el.offsetWidth || 260, h: el.offsetHeight || 120 }, { w: innerWidth, h: innerHeight }, avoid);
    el.style.bottom = 'auto';
    if (!pos) { corner(r); return; }
    el.style.left = `${pos.left}px`; el.style.top = `${pos.top}px`;
    arrow.style.display = '';
    const cx = r.left + r.width / 2 - pos.left, cy = r.top + r.height / 2 - pos.top;
    Object.assign(arrow.style, { left: pos.side === 'right' ? '-6px' : pos.side === 'left' ? 'auto' : `${Math.max(12, Math.min(236, cx))}px`, right: pos.side === 'left' ? '-6px' : 'auto', top: pos.side === 'below' ? '-6px' : pos.side === 'above' ? 'auto' : `${Math.max(12, cy)}px`, bottom: pos.side === 'above' ? '-6px' : 'auto' });
  }
  const begin = (k, from, chapter = null) => {
    kind = k; skippedAddress = false; chapterId = chapter?.id || BASICS_ID; steps = chapter ? chapter.steps : tutorialFor(k); active = true; i = from ?? 0;
    clearInterval(timer); timer = setInterval(paint, 700);
    if (i > 0) go(i); else { paint(); go(i); } // paint() may already have moved past "Type your address" (a lot is loaded); go(i) keeps that
  };
  const menu = createHelpMenu({ storage, onWalk: (k, id) => api.startChapter(k, id) });
  const api = {
    el, menu, get active() { return active; }, get index() { return i; },
    /** First visit only (not after Done or Skip). Returns whether it started. */
    startIfFirst(k, flowStep = 1) { if (!shouldStartTutorial(k, storage)) return false; begin(k, stepIndexForFlow(tutorialFor(k), flowStep) ?? 0); return true; },
    /** The "Show me how" and "?" buttons: opens the chapter menu (each chapter has a guided tour and a video). */
    openMenu(k) { api.stop(); menu.show(k); },
    /** Runs one chapter from its first step. The first step takes the app to the place it lives in. */
    startChapter(k, id) { const c = chapterById(k, id); if (!c) return false; menu.hide(); menu.closeVideo(); if (id === BASICS_ID) writeTutorial(k, null, storage); begin(k, 0, c); return true; },
    /** Restarts the Basics from its first step. */
    restart(k) { api.startChapter(k, BASICS_ID); },
    stop() { end(null); },
    status: (k) => readTutorial(k, storage),
    get chapter() { return chapterId; },
  };
  return api;
}
