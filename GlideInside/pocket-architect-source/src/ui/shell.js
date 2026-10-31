// Builds the static page skeleton. Behaviour is attached by the other ui modules.

import { h } from './dom.js';
import { panelMarkup } from './panel.js';

export function buildShell(root) {
  const topbar = h('header', { class: 'ps-topbar', role: 'banner' });
  const toolbox = h('nav', { class: 'ps-toolbox', 'aria-label': 'Drawing tools' });
  const planHost = h('div', { class: 'ps-plan-host', id: 'ps-plan-host', dataset: { ps: 'plan-canvas' } });
  const host3d = h('div', { class: 'ps-3d-host', id: 'ps-3d-host', hidden: true });
  const stageNote = h('div', { class: 'ps-stage-note', hidden: true, role: 'status' });
  const drawer = h('div', { class: 'ps-drawer', hidden: true, role: 'dialog', 'aria-label': 'Furniture catalogue' });
  const chips = h('div', { class: 'ps-hintbar' });
  const stage = h('main', { class: 'ps-stage', id: 'ps-stage' }, planHost, host3d, chips, drawer, stageNote);
  const parts = panelMarkup();
  const main = h('div', { class: 'ps-main' }, toolbox, stage, parts.panel);
  const statusbar = h('footer', { class: 'ps-statusbar', role: 'contentinfo' });
  const toasts = h('div', { class: 'ps-toasts', 'aria-live': 'polite' });
  const modalRoot = h('div', { class: 'ps-modal-root' });
  const premiumRoot = h('div', { class: 'ps-modal-root', id: 'ps-premium-root' });
  const shell = h('div', { class: 'ps-shell', dataset: { view: '2d' } }, topbar, main, statusbar, toasts, modalRoot, premiumRoot);
  root.replaceChildren(shell);
  return { shell, topbar, toolbox, stage, planHost, host3d, chips, stageNote, drawer, statusbar, toasts, modalRoot, premiumRoot, ...parts };
}
