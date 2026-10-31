// Right panel: Properties (tool settings, selected element, or the design summary) and Assistant tabs.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { buildElementForm } from './panel-element.js';
import { buildSummary } from './panel-summary.js';
import { buildToolPanel } from './panel-tool.js';

export function createPanel(refs, store, { catalogue, editor } = {}) {
  const { panel, tabs, propsSection, aiSection } = refs;
  let view = null;
  let tab = 'props';

  const ctx = {
    store,
    catalogue,
    editor,
    toast,
    run(op, args) {
      try {
        return store.run(op, args);
      } catch (e) {
        toast(e?.message || 'That change was not possible', { kind: 'warn' });
        view?.refresh?.();
        return null;
      }
    },
    apply(label, fn) {
      try {
        return store.apply(label, fn) ?? true;
      } catch (e) {
        toast(e?.message || 'That change was not possible', { kind: 'warn' });
        view?.refresh?.();
        return null;
      }
    },
    remove(id, what) {
      if (ctx.run('delete', { id })) toast(`Deleted ${what}.`, { action: { label: 'Undo', onClick: () => store.undo() } });
    },
  };

  function keyFor() {
    const tool = store.ui.tool;
    if (tool !== 'select') return `tool:${tool}`;
    const found = store.ui.selection ? store.find(store.ui.selection) : null;
    if (found && found.kind !== 'level') {
      const flag = found.kind === 'room' ? (found.item.outdoor ? ':out' : ':in') : found.kind === 'opening' ? `:${found.item.kind}` : found.kind === 'wall' ? `:${found.item.kind}` : '';
      return `el:${found.kind}:${found.item.id}${flag}`;
    }
    return `summary:${store.ui.activeLevelId}`;
  }

  function render(force = false) {
    const key = keyFor();
    if (view && view.key === key && !force) {
      view.refresh();
      return;
    }
    clear(propsSection);
    const tool = store.ui.tool;
    if (tool !== 'select') view = buildToolPanel(ctx, tool);
    else {
      const found = store.ui.selection ? store.find(store.ui.selection) : null;
      view = found && found.kind !== 'level' ? buildElementForm(ctx, found) : buildSummary(ctx);
    }
    view.key = key;
    propsSection.append(view.el);
  }

  function setTab(next, { open = true } = {}) {
    tab = next;
    for (const b of tabs.querySelectorAll('.ps-tab')) b.setAttribute('aria-selected', String(b.dataset.tab === next));
    propsSection.hidden = next !== 'props';
    aiSection.hidden = next !== 'ai';
    if (open) panel.dataset.open = 'true';
  }

  for (const b of tabs.querySelectorAll('.ps-tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
  const toggle = panel.querySelector('.ps-sheet-toggle');
  if (toggle) {
    const sync = () => {
      const open = panel.dataset.open !== 'false';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.replaceChildren(icon(open ? 'down' : 'up', { size: 18 }));
      toggle.setAttribute('aria-label', open ? 'Collapse panel' : 'Expand panel');
    };
    toggle.addEventListener('click', () => {
      panel.dataset.open = panel.dataset.open === 'false' ? 'true' : 'false';
      sync();
    });
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['data-open'] });
    sync();
  }

  const offs = [
    store.on('project', () => render()),
    store.on('selection', () => {
      render();
      if (store.ui.selection) setTab('props', { open: false });
    }),
    store.on('ui', (patch = {}) => {
      if ('tool' in patch || 'toolArg' in patch || 'activeLevelId' in patch || 'statusView' in patch) render(true);
    }),
    store.on('plan:underlay', () => render(true)),
    store.on('plan:calibrating', () => render(true)),
  ];
  render(true);
  setTab('props', { open: false });

  return { render, setTab, getTab: () => tab, dispose: () => offs.forEach((o) => o?.()) };
}

// Shell fragment for the panel (built by shell.js).
export function panelMarkup() {
  const tabs = h('div', { class: 'ps-tabs', role: 'tablist' },
    h('button', { class: 'ps-tab', type: 'button', role: 'tab', dataset: { tab: 'props', panelTab: 'properties' }, 'aria-selected': 'true' }, 'Properties'),
    h('button', { class: 'ps-tab', type: 'button', role: 'tab', dataset: { tab: 'ai', panelTab: 'assistant' }, 'aria-selected': 'false' }, 'Assistant'));
  const toggle = h('button', { class: 'ps-btn ps-btn--ghost ps-btn--icon ps-sheet-toggle', type: 'button' });
  const propsSection = h('section', { class: 'ps-tab-props', 'aria-label': 'Properties' });
  const aiMount = h('div', { class: 'ps-ai-mount', id: 'ps-ai-mount' });
  const aiFallback = h('div', { class: 'ps-ai-fallback', hidden: true }, 'The assistant is part of the Plan Pack and could not be loaded in this session. Everything else keeps working.');
  const aiSection = h('section', { class: 'ps-tab-ai', 'aria-label': 'Assistant', hidden: true }, aiMount, aiFallback);
  const panel = h('aside', { class: 'ps-panel', 'aria-label': 'Design panel', dataset: { open: 'true' } },
    h('div', { class: 'ps-panel-head' }, tabs, toggle),
    h('div', { class: 'ps-panel-body' }, propsSection, aiSection));
  return { panel, tabs, propsSection, aiSection, aiMount, aiFallback };
}
