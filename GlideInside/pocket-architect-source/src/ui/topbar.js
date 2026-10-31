// Top bar: design name, file actions, undo and redo, view switch, level tabs, status view and roof toggle.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { deleteLevelWithConfirm } from './level-actions.js';
import { hasExtensionContent, levelsByElevation } from '../editor2d/math.js';
import { CONFIG } from '../config.js';

const VIEWS = [['2d', 'Plan'], ['3d', '3D'], ['walk', 'Walk']];
const STATUS_VIEWS = [['existing', 'Existing'], ['proposed', 'Proposed'], ['both', 'Both']];
const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? 'Cmd' : 'Ctrl';

function textButton({ name, text, title, onClick, cls = '', action }) {
  return h('button', { class: `ps-btn ${cls}`.trim(), type: 'button', title: title || text, 'aria-label': title || text, dataset: action ? { action } : undefined, onclick: onClick },
    icon(name, { size: 18 }),
    h('span', { class: 'ps-btn-text' }, text));
}

// Handlers: onNew, onOpen, onSave, onOpenFull. `demo` hides the file controls.
export function createTopbar(el, store, { demo = false, onNew, onOpen, onSave, onOpenFull } = {}) {
  const brand = h('div', { class: 'ps-brand' }, h('span', { class: 'ps-logo', 'aria-hidden': 'true' }), h('span', { class: 'ps-product' }, CONFIG.productName));

  const nameInput = h('input', { class: 'ps-name', type: 'text', maxlength: '80', 'aria-label': 'Design name', spellcheck: 'false', autocomplete: 'off' });
  nameInput.value = store.project.name;
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim();
    if (!v) {
      nameInput.value = store.project.name;
      return;
    }
    if (v === store.project.name) return;
    try {
      store.run('set_project', { name: v });
    } catch (e) {
      toast(e?.message || 'The name could not be changed', { kind: 'warn' });
      nameInput.value = store.project.name;
    }
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
    else if (e.key === 'Escape') {
      nameInput.value = store.project.name;
      nameInput.blur();
    }
  });

  // File group -----------------------------------------------------------------------------------------------------------
  const fileGroup = h('div', { class: 'ps-group', role: 'group', 'aria-label': 'File' },
    textButton({ name: 'new', action: 'new', text: 'New', title: 'New design from a template', onClick: () => onNew?.() }),
    textButton({ name: 'open', action: 'open', text: 'Open', title: 'Open a saved design (.json)', onClick: () => onOpen?.() }),
    textButton({ name: 'save', action: 'save', text: 'Save', title: 'Save this design as a .json file', onClick: () => onSave?.() }));

  // History group ----------------------------------------------------------------------------------------------------------
  const undoBtn = h('button', { class: 'ps-btn ps-btn--icon', type: 'button', onclick: () => store.undo() }, icon('undo', { size: 18 }));
  const redoBtn = h('button', { class: 'ps-btn ps-btn--icon', type: 'button', onclick: () => store.redo() }, icon('redo', { size: 18 }));
  const historyGroup = h('div', { class: 'ps-group', role: 'group', 'aria-label': 'History' }, undoBtn, redoBtn);

  // View switch --------------------------------------------------------------------------------------------------------
  const viewSeg = h('div', { class: 'ps-seg ps-view-switch', role: 'group', 'aria-label': 'View' });
  const viewBtns = VIEWS.map(([id, label]) => {
    const b = h('button', { class: 'ps-seg-btn', type: 'button', 'aria-pressed': 'false', dataset: { view: id }, onclick: () => store.setUI({ view: id }) }, label);
    viewSeg.append(b);
    return b;
  });

  // Level tabs ---------------------------------------------------------------------------------------------------------
  const levels = h('div', { class: 'ps-levels', role: 'tablist', 'aria-label': 'Levels' });
  let levelKey = '';

  function addLevel() {
    try {
      const res = store.run('add_level', {});
      if (res?.id) store.setUI({ activeLevelId: res.id, ...(store.ui.view !== '2d' ? { levelFilter: 'all' } : {}) });
    } catch (e) {
      toast(e?.message || 'A level could not be added', { kind: 'warn' });
    }
  }

  function selectLevel(id) {
    if (store.ui.view === '2d') store.setUI({ activeLevelId: id });
    else store.setUI({ activeLevelId: id, levelFilter: id });
  }

  function syncLevels() {
    const p = store.project;
    const view = store.ui.view;
    const sorted = levelsByElevation(p);
    const selected = view === '2d' ? store.ui.activeLevelId : store.ui.levelFilter;
    const key = [view, selected, ...sorted.map((l) => `${l.id}:${l.name}`)].join('|');
    if (key === levelKey) return;
    levelKey = key;
    clear(levels);
    const tab = (id, label, title) =>
      h('button', { class: 'ps-level-tab', type: 'button', role: 'tab', 'aria-selected': String(selected === id), dataset: { level: id }, title, onclick: () => (id === 'all' ? store.setUI({ levelFilter: 'all' }) : selectLevel(id)) }, label);
    const many = sorted.length > 1;
    for (const l of sorted) {
      levels.append(h('span', { class: 'ps-level-tabwrap', role: 'presentation' },
        tab(l.id, l.name, `Show ${l.name}`),
        many ? h('button', { class: 'ps-level-x', type: 'button', 'aria-label': `Delete ${l.name}`, title: `Delete ${l.name}`, dataset: { deleteLevel: l.id }, onclick: (e) => {
          e.stopPropagation();
          deleteLevelWithConfirm(store, l.id);
        } }, icon('close', { size: 10 })) : null));
    }
    if (view !== '2d') levels.append(tab('all', 'All', 'Show every level'));
    levels.append(h('button', { class: 'ps-level-tab ps-level-add', type: 'button', title: 'Add a level above the top level', 'aria-label': 'Add a level', onclick: addLevel }, '+ Level'));
  }

  // Status view and roof -----------------------------------------------------------------------------------------------------
  const statusSeg = h('div', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': 'Existing or proposed work', title: 'Choose which work to show' });
  const statusBtns = STATUS_VIEWS.map(([id, label]) => {
    const b = h('button', { class: 'ps-seg-btn', type: 'button', 'aria-pressed': 'false', dataset: { status: id }, onclick: () => store.setUI({ statusView: id }) }, label);
    statusSeg.append(b);
    return b;
  });
  const roofBtn = h('button', { class: 'ps-btn ps-btn--wide', type: 'button', onclick: () => store.setUI({ showRoof: !store.ui.showRoof }) }, icon('roof', { size: 18 }), h('span', { class: 'ps-btn-text' }, 'Roof'));

  const fullBtn = textButton({ name: 'plan', text: 'Open full app', title: 'Open the full screen app', cls: 'ps-btn--wide', onClick: () => onOpenFull?.() });
  const premiumSlot = h('div', { class: 'ps-premium-slot', id: 'ps-premium-slot' });

  // Demo mode (embedded teaser) hides the file and premium controls and offers the full app instead.
  function setDemo(on) {
    fileGroup.hidden = on;
    premiumSlot.hidden = on;
    fullBtn.hidden = !on;
  }
  setDemo(demo);

  el.append(brand, nameInput, fileGroup, historyGroup, viewSeg, levels, statusSeg, roofBtn, h('span', { class: 'ps-topbar-spacer' }), fullBtn, premiumSlot);

  // Sync -----------------------------------------------------------------------------------------------------------------------
  function syncHistory() {
    const u = store.undoLabel();
    const r = store.redoLabel();
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    const ut = u ? `Undo ${u} (${MOD}+Z)` : `Nothing to undo (${MOD}+Z)`;
    const rt = r ? `Redo ${r} (${MOD}+Shift+Z)` : `Nothing to redo (${MOD}+Shift+Z)`;
    undoBtn.title = ut;
    redoBtn.title = rt;
    undoBtn.setAttribute('aria-label', ut);
    redoBtn.setAttribute('aria-label', rt);
  }
  function syncView() {
    const view = store.ui.view;
    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    roofBtn.hidden = view === '2d';
  }
  function syncStatus() {
    const show = store.project.type === 'extension' || hasExtensionContent(store.project);
    statusSeg.hidden = !show;
    for (const b of statusBtns) b.setAttribute('aria-pressed', String(b.dataset.status === store.ui.statusView));
  }
  function syncRoof() {
    const on = store.ui.showRoof;
    roofBtn.setAttribute('aria-pressed', String(on));
    roofBtn.title = on ? 'Roof is shown. Click to hide it.' : 'Roof is hidden. Click to show it.';
    roofBtn.setAttribute('aria-label', roofBtn.title);
  }
  function syncName() {
    if (document.activeElement !== nameInput) nameInput.value = store.project.name;
  }
  function syncAll() {
    syncName();
    syncHistory();
    syncView();
    syncLevels();
    syncStatus();
    syncRoof();
  }

  const offs = [
    store.on('project', syncAll),
    store.on('history', syncHistory),
    store.on('ui', (patch = {}) => {
      if ('view' in patch) syncView();
      if ('view' in patch || 'activeLevelId' in patch || 'levelFilter' in patch) syncLevels();
      if ('statusView' in patch) syncStatus();
      if ('showRoof' in patch) syncRoof();
    }),
  ];
  syncAll();

  return { premiumSlot, nameInput, setDemo, refresh: syncAll, dispose: () => offs.forEach((o) => o?.()) };
}
