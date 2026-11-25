// The guided start flow framework, shared by the residential and the commercial tools: a full screen overlay with a progress indicator
// (five numbered steps), Back and Next, a skip to the editor, and the step saved on the project so a refresh resumes at the same step.
//
//   const flow = createGuidedFlow({ store, kind, brand, steps: [{ id, title, intro, mount(ctx) -> step }], onEditor })
//   step = { el, canNext?(), beforeNext?() -> Promise<boolean>, nextLabel?, hideNext?, onEnter?(), dispose?() }      (mount runs on every entry to the step)
//   ctx  = { store, flow, refresh(), go(n), next(), back() }                       refresh() re-reads canNext after the step's state changed
//   flow.open(step?) / flow.close() / flow.step / flow.go(n) / flow.root / flow.destroy()

import { h } from '../ui/dom.js';
import { FLOW_CSS } from './css.js';
import { stepsFor, PHONE_STEPS, EDIT_STEP, clampStep, flowOf, writeFlow } from './state.js';
import { CONFIG } from '../config.js';
import { onPhoneChange, phoneApi, isPhoneMode } from '../phone/mode.js';
import { openSheet, sheetButton } from '../phone/sheet.js';
import { saveDesign, shareDesign, isSaved } from '../phone/actions.js';

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.dataset.ps = 'flow-css';
  st.textContent = FLOW_CSS;
  document.head.append(st);
}

export function createGuidedFlow({ store, kind, brand, steps, onEditor = () => {}, onSkip = null, onHelp = null, host = document.body }) {
  injectStyle();
  // The residential tool on a phone shows the simple four step path (Address, Pick, Fit, Plans); everything else keeps its own steps.
  const metaNow = () => (kind === 'residential' && isPhoneMode() && CONFIG.phoneSimple !== false ? PHONE_STEPS : stepsFor(kind));
  const total = metaNow().length;
  let current = 0;
  let live = null; // the mounted step
  let seq = 0;

  const brandEl = h('div', { class: 'gf-brand', dataset: { ps: 'flow-brand' } }, brand);
  const prog = h('ol', { class: 'gf-prog', 'aria-label': 'Progress', dataset: { ps: 'flow-progress' } });
  const skip = h('button', { class: 'gf-skip', type: 'button', dataset: { ps: 'flow-skip' }, onclick: () => skipToEditor() }, 'Skip to editor');
  const help = h('button', { class: 'gf-skip gf-help', type: 'button', title: 'Show me how', 'aria-label': 'Show me how', dataset: { ps: 'flow-help' }, onclick: () => onHelp?.() }, 'Show me how');
  // Phone mode: the header keeps the brand and the progress; the rest lives behind one Menu button (a bottom sheet).
  const menuBtn = h('button', { class: 'gf-menu', type: 'button', 'aria-label': 'Menu', dataset: { ps: 'flow-menu' }, onclick: () => openMenu() }, 'Menu');
  const head = h('header', { class: 'gf-head' }, brandEl, menuBtn, prog, help, skip);
  const titleEl = h('h1', { class: 'gf-title', dataset: { ps: 'flow-title' }, tabindex: '-1' });
  const introEl = h('p', { class: 'gf-intro' });
  const content = h('div', { class: 'gf-content', style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } });
  const wrap = h('div', { class: 'gf-wrap' }, titleEl, introEl, content);
  const body = h('div', { class: 'gf-body' }, wrap);
  const count = h('span', { class: 'gf-count' });
  const back = h('button', { class: 'gf-btn', type: 'button', dataset: { ps: 'flow-back' }, onclick: () => go(stepNo() - 1) }, 'Back');
  const nextBtn = h('button', { class: 'gf-btn gf-btn--primary', type: 'button', dataset: { ps: 'flow-next' }, onclick: () => go(stepNo() + 1) }, 'Next');
  const foot = h('footer', { class: 'gf-foot' }, count, back, nextBtn);
  const root = h('div', { class: 'gf-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': brand, hidden: true, dataset: { ps: 'flow-root', kind } }, head, body, foot);
  host.append(root);

  const stepNo = () => current + 1;
  let ctx = null;

  function openMenu() {
    let sheet = null;
    const act = (fn) => () => { sheet?.close(); fn(); };
    const items = [sheetButton({ label: 'Save design', hint: 'Keep this design on your profile', ps: 'flow-menu-save', onClick: act(() => saveDesign()) })];
    if (isSaved()) items.push(sheetButton({ label: 'Share design link', hint: 'Send it to yourself to carry on at a computer', ps: 'flow-menu-share', onClick: act(() => shareDesign()) }));
    items.push(sheetButton({ label: 'Show me how', ps: 'flow-menu-help', onClick: act(() => onHelp?.()) }));
    items.push(sheetButton({ label: 'Skip to the editor', ps: 'flow-menu-skip', onClick: act(() => skipToEditor()) }));
    const pa = phoneApi();
    if (pa) items.push(sheetButton({ label: 'Desktop view', hint: 'Show the full page layout', ps: 'flow-menu-desktop', onClick: act(() => pa.setDesktopView(true)) }));
    sheet = openSheet({ title: 'Menu', id: 'flow-menu-sheet', body: h('div', { class: 'ps-sheet-list' }, ...items) });
  }
  // The steps lay themselves out for a phone or for a desktop: when the mode flips (a turn of the phone, Desktop view) the current step is built again.
  const offPhone = onPhoneChange(() => { if (!root.hidden && live) show(current + 1); });

  function paintProgress() {
    prog.replaceChildren(...metaNow().map((m, i) => {
      const state = i < current ? 'done' : i === current ? 'current' : 'todo';
      const inner = [h('span', { class: 'gf-num', 'aria-hidden': 'true' }, state === 'done' ? '✓' : String(i + 1)), h('span', { class: 'gf-lbl' }, m.title)];
      const el = h('li', { dataset: { step: String(i + 1), state }, ...(state === 'current' ? { 'aria-current': 'step' } : {}) },
        state === 'done' ? h('button', { type: 'button', 'aria-label': `Go back to step ${i + 1}, ${m.title}`, onclick: () => go(i + 1) }, ...inner) : h('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, ...inner));
      return el;
    }));
  }

  function refresh() {
    const ok = !live?.canNext || !!live.canNext();
    nextBtn.disabled = !ok;
    nextBtn.textContent = live?.nextLabel || (current === total - 2 ? 'Open the editor' : 'Next');
    nextBtn.hidden = !!live?.hideNext;
    back.disabled = current === 0;
    count.textContent = `Step ${current + 1} of ${total}`;
  }

  function leave() {
    try { live?.dispose?.(); } catch (e) { console.warn('[flow] step dispose failed', e); }
    live = null;
    content.replaceChildren();
  }

  async function show(n) {
    const mine = ++seq;
    leave();
    current = clampStep(n) - 1;
    writeFlow(store, { kind, step: current + 1 });
    const def = steps[current];
    titleEl.textContent = `${current + 1}. ${def.title}`;
    introEl.textContent = def.intro || '';
    root.dataset.step = String(current + 1);
    root.dataset.stepId = def.id;
    paintProgress();
    ctx = { store, flow: api, refresh, go: (k) => go(k), next: () => go(stepNo() + 1), back: () => go(stepNo() - 1) };
    let step = null;
    try { step = await def.mount(ctx); } catch (e) { console.warn('[flow] step failed to mount', e); step = { el: h('p', { class: 'gf-note gf-note--bad' }, 'This step could not load. Try again, or skip to the editor.') }; }
    if (mine !== seq) { try { step?.dispose?.(); } catch { /* superseded */ } return; }
    live = step || { el: h('div') };
    content.replaceChildren(live.el);
    try { body.scrollTop = 0; } catch { /* a new step starts at its top, not where the last one was scrolled to */ }
    refresh();
    try { await live.onEnter?.(); } catch (e) { console.warn('[flow] step enter failed', e); }
    if (mine === seq) refresh();
  }

  async function go(n) {
    const target = clampStep(n);
    // A step can ask a question before the person moves on (the setback breach confirmation).
    if (target > current + 1 && live?.beforeNext && !(await live.beforeNext())) return;
    if (target === EDIT_STEP) { await toEditor(); return; }
    await show(target);
  }

  async function toEditor() {
    leave();
    writeFlow(store, { kind, step: EDIT_STEP });
    root.hidden = true;
    document.documentElement.classList.remove('gf-open');
    await onEditor({ kind });
  }

  async function skipToEditor() {
    await toEditor();
    onSkip?.();
  }

  const onKey = (e) => {
    if (root.hidden || e.key !== 'Escape' || document.querySelector('.ps-modal')) return;
    // Escape never throws the person's work away: it only closes a suggestion list (handled by the step); nothing else.
  };
  document.addEventListener('keydown', onKey);

  const api = {
    root, kind,
    get step() { return current + 1; },
    get isOpen() { return !root.hidden; },
    async open(n = null) {
      root.hidden = false;
      document.documentElement.classList.add('gf-open');
      const f = flowOf(store.project);
      await show(n ?? (f && f.kind === kind && f.step < EDIT_STEP ? f.step : 1));
      titleEl.focus({ preventScroll: true });
    },
    close() { leave(); root.hidden = true; document.documentElement.classList.remove('gf-open'); },
    /** Straight to the editor (step 5) without the step's own question: used by "Make it narrower". */
    editor: () => toEditor(),
    /** The Skip to editor action (also runs the page's onSkip), for a step that offers it itself. */
    skip: () => skipToEditor(),
    go,
    refresh,
    destroy() { leave(); offPhone(); document.removeEventListener('keydown', onKey); root.remove(); },
  };
  return api;
}
