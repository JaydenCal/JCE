// Status bar: cursor position, snap toggle, zoom, indoor area, current hint and autosave state.

import { h } from './dom.js';
import { icon } from './icons.js';
import { indoorTotalM2 } from './schedules.js';
import { toast } from './toast.js';
import { currentTheme, applyTheme, onTheme } from './theme.js';
import { openModal } from './modal.js';
import { CONFIG } from '../config.js';

const fmt = (n) => (Math.round(n) + 0).toLocaleString('en-AU');
const clock = (t) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

function showDisclaimer() {
  openModal({
    title: 'About these designs',
    size: 'sm',
    body: h('p', { style: { margin: 0 } }, CONFIG.disclaimer),
    footer: (close) => h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: () => close() }, 'Close'),
  });
}

export function createStatusBar(el, store, { editor } = {}) {
  const cursor = h('span', { class: 'ps-mono', 'aria-label': 'Cursor position' }, '');
  const snapBtn = h('button', { class: 'ps-status-btn', type: 'button', 'aria-pressed': 'true', title: 'Snap to the grid and wall ends. Hold Alt to bypass.' }, 'Snap');
  const zoom = h('span', { class: 'ps-mono' }, '100%');
  const fit = h('button', { class: 'ps-status-btn', type: 'button', title: 'Zoom to fit (Shift and F, or Home)', 'aria-label': 'Zoom to fit' }, icon('fit', { size: 14 }));
  const area = h('span', { class: 'ps-mono', title: 'Indoor floor area, all levels' }, '');
  const hint = h('span', { class: 'ps-status-hint', role: 'status' }, '');
  const saved = h('span', { class: 'ps-autosave', dataset: { state: 'idle' } }, 'Autosave on');
  const themeBtn = h('button', { class: 'ps-status-btn', type: 'button', 'aria-label': 'Switch between light and dark', title: 'Switch between light and dark' });
  const disclaimerBtn = h('button', { class: 'ps-status-btn', type: 'button', title: CONFIG.disclaimer, onclick: showDisclaimer }, 'Concept design only');
  const cell = (...kids) => h('span', { class: 'ps-status-cell' }, ...kids);
  const cursorCell = cell(h('span', null, 'X Y'), cursor);
  cursorCell.classList.add('ps-cell-cursor');
  const planCells = [cursorCell, cell(snapBtn), cell(h('span', null, 'Zoom'), zoom, fit)];
  el.append(
    ...planCells,
    cell(h('span', null, 'Indoor'), area),
    hint,
    saved,
    disclaimerBtn,
    themeBtn,
  );

  const syncSnap = () => {
    const on = store.ui.snap;
    snapBtn.setAttribute('aria-pressed', String(on));
    snapBtn.textContent = on ? `Snap ${store.project.settings.snapMm} mm` : 'Snap off';
  };
  const syncArea = () => {
    area.textContent = `${indoorTotalM2(store.project).toFixed(2)} m²`;
  };
  const syncTheme = () => {
    themeBtn.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon', { size: 14 }));
  };
  const setHint = (t) => {
    hint.textContent = t || '';
    hint.title = t || '';
  };

  snapBtn.addEventListener('click', () => store.setUI({ snap: !store.ui.snap }));
  fit.addEventListener('click', () => editor?.zoomToFit());
  themeBtn.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', { remember: true }));
  let autosaveWarned = false;

  const offs = [
    store.on('plan:cursor', (p) => {
      cursor.textContent = p ? `${fmt(p.x)}  ${fmt(p.y)} mm` : '';
    }),
    store.on('plan:zoom', ({ scale }) => {
      zoom.textContent = `${Math.round(scale * 1000)}%`;
    }),
    store.on('plan:hint', setHint),
    store.on('ui', (patch = {}) => {
      if ('snap' in patch) syncSnap();
      if ('view' in patch) syncView();
    }),
    store.on('project', () => {
      syncSnap();
      syncArea();
      saved.dataset.state = 'dirty';
      saved.textContent = 'Saving';
    }),
    store.on('saved', ({ at }) => {
      autosaveWarned = false;
      saved.dataset.state = 'saved';
      saved.textContent = `Saved ${clock(at)}`;
    }),
    store.on('autosave-error', (e) => {
      saved.dataset.state = 'error';
      saved.textContent = 'Autosave failed. Save a file to keep your work.';
      if (!autosaveWarned) {
        autosaveWarned = true;
        toast(`Autosave failed${e?.name === 'QuotaExceededError' ? ' because browser storage is full' : ''}. Use Save to download your design.`, { kind: 'warn', timeout: 9000 });
      }
    }),
    onTheme(syncTheme),
  ];
  // Cursor, snap and zoom belong to the plan editor. The 3D viewer shows its own hints.
  function syncView() {
    const plan = store.ui.view === '2d';
    for (const c of planCells) c.hidden = !plan;
    if (!plan) setHint('');
  }
  syncSnap();
  syncArea();
  syncTheme();
  syncView();
  zoom.textContent = `${Math.round((editor?.getView?.().scale ?? 0.08) * 1000)}%`;
  return { setHint, setAutosave: (on) => { saved.hidden = !on; }, dispose: () => offs.forEach((o) => o?.()) };
}
