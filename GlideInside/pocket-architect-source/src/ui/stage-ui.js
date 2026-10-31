// Small overlays on the stage: context chips (plan view) and the first-visit welcome card.

import { h, clear, storage } from './dom.js';
import { icon } from './icons.js';
import { hasExtensionContent, levelsByElevation } from '../editor2d/math.js';
import { deleteLevelWithConfirm } from './level-actions.js';
import { toast } from './toast.js';

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
    el.hidden = view !== '2d';
    if (view !== '2d') {
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
    offs.forEach((o) => o?.());
    if (remember) storage.set(WELCOME_KEY, '1');
  };
  const card = h('div', { class: 'ps-welcome', role: 'region', 'aria-label': 'Welcome' },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('h3', null, 'Start with a real plan'),
      h('p', null, 'This design is a starting template. Drag walls, add doors and windows, then switch to 3D. Your work saves in this browser as you go.'),
      h('div', { class: 'ps-welcome-actions' },
        h('button', { class: 'ps-btn ps-btn--primary ps-btn--sm', type: 'button', onclick: () => {
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
      if ('view' in patch && patch.view !== '2d') dismiss(false);
    }),
  ];
  return { dismiss };
}
