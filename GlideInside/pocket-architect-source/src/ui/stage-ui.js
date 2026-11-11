// Small overlays on the stage: context chips (plan view) and the first-visit welcome card.

import { hasPlan } from './view-mode.js';
import { h, clear, storage } from './dom.js';
import { icon } from './icons.js';
import { hasExtensionContent, levelsByElevation } from '../editor2d/math.js';
import { deleteLevelWithConfirm } from './level-actions.js';
import { toast } from './toast.js';
import { openFindBlock } from './find-block.js';
import { CONFIG } from '../config.js';
import { siteCredits } from '../site/credits.js';

export function createStageChips(el, store) {
  // The level chip is a small menu: switch level, add a level, rename the current one.
  const chipBtn = h('button', { class: 'ps-chip-note ps-chip-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', dataset: { ps: 'level-chip' }, title: 'Switch level, add a level or rename this one' });
  const menu = h('div', { class: 'ps-level-menu', role: 'menu', hidden: true, 'aria-label': 'Levels' });
  const chipWrap = h('span', { class: 'ps-chip-wrap' }, chipBtn, menu);
  const notes = h('span', { class: 'ps-chip-notes' });
  let open = false;
  let renaming = false;

  const sorted = () => levelsByElevation(store.project);

  function close() {
    if (!open) return;
    open = false;
    renaming = false;
    menu.hidden = true;
    chipBtn.setAttribute('aria-expanded', 'false');
  }

  function buildMenu() {
    clear(menu);
    const active = store.level();
    if (renaming) {
      const input = h('input', { class: 'ps-input', type: 'text', maxlength: '40', 'aria-label': 'Level name', autocomplete: 'off', spellcheck: 'false' });
      input.value = active.name;
      const save = () => {
        const v = input.value.trim();
        if (v && v !== active.name) {
          try {
            store.run('update_level', { id: active.id, name: v });
          } catch (e) {
            toast(e?.message || 'The level could not be renamed', { kind: 'warn' });
          }
        }
        close();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') close();
      });
      menu.append(
        h('div', { class: 'ps-menu-title' }, 'Rename level'),
        input,
        h('div', { class: 'ps-menu-actions' },
          h('button', { class: 'ps-btn ps-btn--sm', type: 'button', onclick: close }, 'Cancel'),
          h('button', { class: 'ps-btn ps-btn--sm ps-btn--primary', type: 'button', onclick: save }, 'Save')));
      setTimeout(() => {
        input.focus({ preventScroll: true });
        input.select();
      }, 0);
      return;
    }
    for (const l of sorted().reverse()) {
      menu.append(h('button', { class: 'ps-menu-item', type: 'button', role: 'menuitemradio', 'aria-checked': String(l.id === active.id), dataset: { level: l.id },
        onclick: () => {
          store.setUI({ activeLevelId: l.id });
          close();
        } }, h('span', { class: 'ps-menu-tick', 'aria-hidden': 'true' }, l.id === active.id ? icon('check', { size: 14 }) : null), l.name));
    }
    menu.append(
      h('div', { class: 'ps-menu-sep', role: 'separator' }),
      h('button', { class: 'ps-menu-item', type: 'button', role: 'menuitem', dataset: { action: 'add-level' }, onclick: () => {
        try {
          const res = store.run('add_level', {});
          if (res?.id) store.setUI({ activeLevelId: res.id });
        } catch (e) {
          toast(e?.message || 'A level could not be added', { kind: 'warn' });
        }
        close();
      } }, h('span', { class: 'ps-menu-tick', 'aria-hidden': 'true' }, icon('plus', { size: 14 })), 'Add level'),
      h('button', { class: 'ps-menu-item', type: 'button', role: 'menuitem', dataset: { action: 'rename-level' }, onclick: () => {
        renaming = true;
        buildMenu();
      } }, h('span', { class: 'ps-menu-tick', 'aria-hidden': 'true' }), `Rename ${active.name}`),
      store.project.levels.length > 1 ? h('button', { class: 'ps-menu-item ps-menu-item--danger', type: 'button', role: 'menuitem', dataset: { action: 'delete-level' }, onclick: () => {
        const id = active.id;
        close();
        deleteLevelWithConfirm(store, id);
      } }, h('span', { class: 'ps-menu-tick', 'aria-hidden': 'true' }, icon('trash', { size: 14 })), 'Delete level') : null);
  }

  function toggle() {
    if (open) return close();
    open = true;
    renaming = false;
    buildMenu();
    menu.hidden = false;
    chipBtn.setAttribute('aria-expanded', 'true');
  }

  chipBtn.addEventListener('click', toggle);
  const onDocDown = (e) => {
    if (open && !chipWrap.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      close();
      chipBtn.focus({ preventScroll: true });
    }
  };
  document.addEventListener('pointerdown', onDocDown, true);
  menu.addEventListener('keydown', onKey);

  function render() {
    const view = store.ui.view;
    el.hidden = !hasPlan(view);
    if (!hasPlan(view)) {
      close();
      return;
    }
    const level = store.level();
    chipBtn.replaceChildren(h('span', { class: 'ps-label' }, 'Level'), level.name, icon('down', { size: 12 }));
    if (open && !renaming) buildMenu();
    const kids = [];
    const ext = store.project.type === 'extension' || hasExtensionContent(store.project);
    if (ext && store.ui.statusView !== 'proposed') {
      kids.push(h('span', { class: 'ps-chip-note' }, store.ui.statusView === 'existing' ? 'Showing existing work only' : 'Showing existing and proposed work'));
    }
    notes.replaceChildren(...kids);
    if (!el.contains(chipWrap)) el.replaceChildren(chipWrap, notes);
  }
  const offs = [store.on('project', render), store.on('ui', render)];
  render();
  return { render, close, dispose: () => { offs.forEach((o) => o?.()); document.removeEventListener('pointerdown', onDocDown, true); } };
}

const WELCOME_KEY = 'ps.welcome.dismissed';

// Returns null when it should not show (already dismissed, or not a first visit).
export function createWelcome(stage, store, { onChoose } = {}) {
  if (storage.get(WELCOME_KEY) === '1') return null;
  let gone = false;
  const dismiss = (remember = true) => {
    if (gone) return;
    gone = true;
    card.remove();
    find?.dispose();
    offs.forEach((o) => o?.());
    if (remember) storage.set(WELCOME_KEY, '1');
  };
  const find = CONFIG.siteLookupEnabled ? { el: null, dispose() {} } : null;
  const card = h('div', { class: 'ps-welcome', role: 'region', 'aria-label': 'Welcome' },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('h3', null, find ? 'Start with your block' : 'Start with a real plan'),
      h('p', null, find ? 'Find your block to draw your real lot, its neighbours and the aerial photo under the plan. This design is a starting template: you can also drag walls, add doors and windows, then switch to 3D.' : 'This design is a starting template. Drag walls, add doors and windows, then switch to 3D. Your work saves in this browser as you go.'),
      h('div', { class: 'ps-welcome-actions' },
        find ? h('button', { class: 'ps-btn ps-btn--primary ps-welcome-find', type: 'button', dataset: { ps: 'welcome-find' }, onclick: () => { dismiss(false); openFindBlock(store); } }, icon('search', { size: 20 }), 'Find my block') : null,
        h('button', { class: `ps-btn ${find ? '' : 'ps-btn--primary '}ps-btn--sm`, type: 'button', onclick: () => {
          dismiss();
          onChoose?.();
        } }, 'Choose another template'),
        h('button', { class: 'ps-btn ps-btn--sm', type: 'button', onclick: () => dismiss() }, 'Keep exploring'))),
    h('button', { class: 'ps-btn ps-btn--ghost ps-btn--icon ps-btn--sm', type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => dismiss() }, icon('close', { size: 16 })));
  stage.append(card);
  // The first edit, or leaving the plan view, means the card has done its job.
  const offs = [
    store.on('project', ({ label } = {}) => {
      if (label !== 'Open project') dismiss();
    }),
    store.on('ui', (patch = {}) => {
      if ('view' in patch && !hasPlan(patch.view)) dismiss(false);
    }),
  ];
  return { dismiss };
}

// "Map data" credit chip --------------------------------------------------------------------------------------------------
const CREDIT_CSS = `
.ps-credit{position:absolute;right:10px;bottom:10px;z-index:12;font:500 11px var(--ps-font-ui,system-ui,sans-serif);display:flex;flex-direction:column;align-items:flex-end;gap:6px;max-width:min(420px,calc(100% - 20px))}
.ps-credit[hidden]{display:none}
.ps-shell:is([data-view="3d"],[data-view="split"],[data-view="walk"]) .ps-credit{bottom:50px}
.ps-credit-chip{border:1px solid var(--ps-border,#c9ccd1);background:color-mix(in srgb,var(--ps-panel,#fff) 90%,transparent);color:var(--ps-muted,#5a5e66);border-radius:999px;padding:3px 10px;cursor:pointer;font:inherit}
.ps-credit-chip:hover{color:var(--ps-text,#1a1c20)}
.ps-credit-body{background:var(--ps-panel,#fff);border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:6px;padding:8px 10px;box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--ps-muted,#5a5e66);line-height:1.35;max-height:40vh;overflow:auto}
.ps-credit-body p{margin:0 0 5px}.ps-credit-body p:last-child{margin:0}
`;

/** A small "Map data" chip that opens the full attribution text for the lot on screen (the PDFs print it in full). */
export function createMapCredit(stage, store) {
  if (!document.getElementById('ps-credit-css')) {
    const st = document.createElement('style');
    st.id = 'ps-credit-css';
    st.textContent = CREDIT_CSS;
    document.head.append(st);
  }
  let open = false;
  const body = h('div', { class: 'ps-credit-body', role: 'region', 'aria-label': 'Map data credits', hidden: true });
  const chip = h('button', { class: 'ps-credit-chip', type: 'button', 'aria-expanded': 'false', title: 'Map data credits', onclick: () => set(!open) }, 'Map data ⓘ');
  const el = h('div', { class: 'ps-credit', hidden: true }, body, chip);
  stage.append(el);
  function set(v) {
    open = v;
    body.hidden = !v;
    chip.setAttribute('aria-expanded', String(v));
  }
  function render() {
    const lot = store.project.site?.lot;
    const lines = lot ? siteCredits(lot).filter((c) => c.id !== 'setbacks') : [];
    el.hidden = !lines.length;
    if (!lines.length) set(false);
    body.replaceChildren(...lines.map((c) => h('p', null, c.text)));
  }
  const offs = [store.on('project', render), store.on('ui', render)];
  const onDoc = (e) => { if (open && !el.contains(e.target)) set(false); };
  document.addEventListener('pointerdown', onDoc);
  render();
  return { render, dispose: () => { offs.forEach((o) => o?.()); document.removeEventListener('pointerdown', onDoc); el.remove(); } };
}
