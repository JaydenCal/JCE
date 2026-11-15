// Hide and show the right-hand Properties / AI design assistant panel as a whole, so the plan can have the full width.
//   * a "Hide panel" button in the panel header and a slim edge tab ("Show panel") on the stage bring it back; Alt+P toggles it,
//   * the choice is remembered per browser (localStorage, every access in try/catch),
//   * on phones the panel is the bottom sheet: the same button closes it and the tab becomes a small pill that reopens it,
//   * a builder's portal setting "Show AI design assistant to clients" can switch the assistant off entirely (setAssistantAllowed(false)).
// The assistant's own logic is not touched. The pure helpers have no DOM so they are unit tested in node.
import { h } from './dom.js';
import { icon } from './icons.js';

export const PANEL_KEY = 'gi.panelHidden.v1';

export function readPanelHidden() {
  try { return globalThis.localStorage?.getItem(PANEL_KEY) === '1'; } catch { return false; }
}
export function writePanelHidden(hidden) {
  try { globalThis.localStorage?.setItem(PANEL_KEY, hidden ? '1' : '0'); } catch { /* private mode or storage blocked */ }
}

let allowed = true; // the builder setting; true unless a client login of a builder who turned the assistant off
const shells = new Set();
const applyAllowed = (shell) => { if (allowed) delete shell.dataset.ai; else shell.dataset.ai = 'off'; };

/** The builder's "Show AI design assistant to clients" (true when not set). Applies to the open app and to anything mounted later. */
export function setAssistantAllowed(on) {
  allowed = on !== false;
  for (const s of shells) applyAllowed(s);
}
export const assistantAllowed = () => allowed;

/** Wire the hide control. `refs` are the shell refs (shell, panel, stage). Returns { hidden, set, toggle, dispose }. */
export function mountPanelHide(refs, { panel: panelApi } = {}) {
  const { shell, panel, stage } = refs;
  shells.add(shell);
  applyAllowed(shell);
  const head = panel.querySelector('.ps-panel-head');

  const hide = h('button', { class: 'ps-btn ps-btn--ghost ps-btn--icon ps-panel-hide', type: 'button', 'aria-controls': panel.id || undefined, dataset: { ps: 'panel-hide' } });
  hide.append(icon('chevR', { size: 18 }));
  hide.setAttribute('aria-label', 'Hide panel');
  hide.title = 'Hide panel (Alt+P)';
  head?.append(hide);

  const tab = h('button', { class: 'ps-panel-tab', type: 'button', hidden: true, dataset: { ps: 'panel-show' }, 'aria-label': 'Show panel', title: 'Show panel (Alt+P)' });
  tab.append(icon('chevL', { size: 16 }), h('span', { class: 'ps-panel-tab-text' }, 'Panel'));
  stage.append(tab);

  let hidden = readPanelHidden();
  function set(next, { remember = true, focus = false } = {}) {
    hidden = !!next;
    if (hidden) shell.dataset.panel = 'hidden'; else delete shell.dataset.panel;
    panel.hidden = hidden;
    panel.setAttribute('aria-hidden', String(hidden));
    tab.hidden = !hidden;
    if (remember) writePanelHidden(hidden);
    if (!hidden) panel.dataset.open = 'true';
    if (focus) (hidden ? tab : hide).focus?.();
    // The plan and 3D hosts follow their container size; nudge them so the freed width is used straight away.
    try { globalThis.dispatchEvent?.(new Event('resize')); } catch { /* ignore */ }
  }
  const toggle = () => set(!hidden, { focus: true });
  hide.addEventListener('click', () => set(true, { focus: true }));
  tab.addEventListener('click', () => set(false, { focus: true }));
  const onKey = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || String(e.key).toLowerCase() !== 'p') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    toggle();
  };
  globalThis.addEventListener?.('keydown', onKey);
  set(hidden, { remember: false });
  void panelApi;
  return { get hidden() { return hidden; }, set, toggle, dispose() { shells.delete(shell); globalThis.removeEventListener?.('keydown', onKey); } };
}
