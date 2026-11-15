// The commercial lot card: the embedded viewer's simple flow for an industrial or commercial lot, the counterpart of src/lotcard/lot-card.js.
//   header (top left)       the lot and "Concept only"
//   search pill (top)       the address search (NSW and QLD), compass and menu
//   layout card (bottom left)  layout name, lot line, zone, stats (units, GFA, parking), feasibility headline, colours, views, buttons, status
//   layout switcher         "< LAYOUT 1 / 7 name >" puts the next ready-made layout on the lot (Best fit first)
//   top view (bottom right) the lot, the setback line, the units and the bays; click to enlarge
// Everything is derived from the project (src/commercial/card-model.js, layouts.js, finishes.js). The card edits the project only through
// store.apply (a layout, a colour), so each change is one undo step and the full editor ("Customise") opens the same project.

import { h, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { searchAddresses } from '../site/client.js';
import { downloadBlob } from '../premium/exporters/download.js';
import { requirePlanTerms, planTermsLinkText, PLAN_TERMS_URL } from '../legal/terms-gate.js';
import { lotOf } from '../model/placement.js';
import { lotHeading, lotLine } from '../lotcard/stats.js';
import { LOT_CARD_CSS } from '../lotcard/lot-card-css.js';
import { createSendToEngineer, SEND_LABEL } from '../lotcard/send-engineer.js';
import { runUpload, creditText, FOOT_BASE } from '../site/upload/flow.js';
import { injectUploadCss } from '../site/upload/css.js';
import { syncCurrency, activeSymbol } from '../site/custom-rules.js';
import { COMMERCIAL_CARD_CSS } from './lotcard-css.js';
import { isCommercial } from './schema.js';
import { layoutUnits } from './layout.js';
import { zoneClass, RESIDENTIAL_NOTE } from './zones.js';
import { CLADDING, DOORS, finishesOf, finishLine, applyFinishes } from './finishes.js';
import { stepLayout } from './layouts.js';
import { activeTypeId, typeChoices, switcherList, switcherIndex, pagerText, chooseFor, applyChoice } from './catalogue/picker.js';
import { STRATA_ID } from './catalogue/types/index.js';
import { buildingsOf } from './catalogue/buildings.js';
import { commercialCardStats, zoneLine, unitList, commercialStatus, feasibilityHeadline, exteriorPose, unitWalkPose } from './card-model.js';
import { summaryRows, costRows, money, CAVEAT, GST_NOTE, RENT_NOTE, SOURCES_TEXT, DATA_DATE } from './feasibility.js';

const STYLE_ID = 'lc-style';
const CC_STYLE_ID = 'cc-style';
const COMPACT_W = 980;
const PHONE_W = 600;
const DOT = { inside: '#6fd39a', outside: '#ff8a7a', check: '#f2b94b' };
export const PLAN_SET_LABEL = 'Get the plan set';
export const CUSTOMISE_LABEL = 'Customise';
export const VIEWS = Object.freeze([
  { id: 'aerial', label: 'Aerial', caption: 'Aerial view of the whole lot' },
  { id: '3d', label: '3D', caption: 'Three quarter view of the units from the street' },
  { id: 'street', label: 'Street', caption: 'Eye level from the street' },
  { id: 'walk', label: 'Walk inside', caption: 'Walk inside a unit' },
  { id: 'units', label: 'Units', caption: 'The units and their areas' },
]);

const inject = (id, css) => {
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = css;
  document.head.append(st);
};

export function createCommercialCard({ store, host, viewerHost = host, getApp = () => (typeof window !== 'undefined' ? window.__ps : null), getViewer = () => null, onEdit = null, onFind = null, onFullEditor = null }) {
  inject(STYLE_ID, LOT_CARD_CSS);
  inject(CC_STYLE_ID, COMMERCIAL_CARD_CSS);
  const E = (cls, tag = 'div', attrs = {}, ...kids) => h(tag, { class: cls, ...attrs }, ...kids);

  const headT = E('lc-head-t', 'b');
  const headS = E('lc-head-s', 'span');
  const head = E('lc-head', 'div', { dataset: { ps: 'lot-head' } }, headT, headS);

  const title = E('lc-title', 'h2', { dataset: { ps: 'cc-title' } });
  const sub = E('lc-sub');
  const stats = E('lc-stats', 'div', { dataset: { ps: 'cc-stats' } });
  const feasT = E('cc-feas-t', 'div');
  const feasBtn = h('button', { class: 'lc-btn', type: 'button', dataset: { ps: 'cc-feas-open' }, onclick: () => openPanel('feas') }, 'See details');
  const feas = E('cc-feas', 'div', { dataset: { ps: 'cc-feas' } }, feasT, feasBtn);
  const cladChips = E('lc-strip', 'div', { role: 'group', 'aria-label': 'Cladding colours', dataset: { ps: 'cc-cladding' } });
  const doorChips = E('lc-strip', 'div', { role: 'group', 'aria-label': 'Roller door colours', dataset: { ps: 'cc-doors' } });
  const bPlan = h('button', { class: 'lc-btn lc-pri', type: 'button', dataset: { ps: 'cc-planset' }, onclick: () => planSet() }, PLAN_SET_LABEL);
  const bEdit = h('button', { class: 'lc-btn', type: 'button', dataset: { ps: 'cc-customise' }, onclick: () => (onEdit ? onEdit() : store.setUI({ view: '2d' })) }, CUSTOMISE_LABEL);
  const bSend = h('button', { class: 'lc-btn lc-sendbtn', type: 'button', hidden: true, dataset: { ps: 'lc-send-engineer' }, onclick: () => engineer.open() }, SEND_LABEL);
  const sendRow = E('lc-send', 'div', { hidden: true }, bSend);
  const fitSet = E('lc-fit', 'div', { role: 'status', 'aria-live': 'polite', dataset: { ps: 'lc-fit' } });
  const fitPark = E('lc-fit', 'div', { role: 'status', dataset: { ps: 'cc-fit-parking' } });
  const fits = E('cc-fits', 'div', null, fitSet, fitPark);
  const zoneNote = E('lc-zone', 'div', { role: 'note', hidden: true, dataset: { ps: 'lc-zone-note' } });
  const more = h('button', { class: 'lc-more', type: 'button', 'aria-expanded': 'false', onclick: () => { card.classList.toggle('is-open'); more.setAttribute('aria-expanded', String(card.classList.contains('is-open'))); sizeInset(); } }, 'Details');
  const viewsEl = E('lc-tabs', 'div', { role: 'tablist', 'aria-label': 'Views', dataset: { ps: 'cc-views' } });
  const body = E('lc-body', 'div', null,
    stats, feas,
    E('lc-sp', 'div', null, E('lc-k', 'span', null, 'Cladding'), cladChips),
    E('lc-sp', 'div', null, E('lc-k', 'span', null, 'Doors'), doorChips),
    E('lc-sp lc-sp-rooms', 'div', null, E('lc-k', 'span', null, 'Views'), viewsEl),
    E('lc-acts', 'div', null, bPlan, bEdit),
    sendRow, zoneNote, fits);
  const card = E('lc-card lc-glass', 'section', { 'aria-label': 'Commercial layout', dataset: { ps: 'lot-card' } }, E('lc-hd', 'div', null, E('lc-hd-in', 'div', null, title, sub), more), body);

  // The layout switcher: arrows and the name, which opens the list of every layout.
  const pgP = h('button', { type: 'button', 'aria-label': 'Previous layout', onclick: () => step(-1) }, '‹');
  const pgN = h('button', { type: 'button', 'aria-label': 'Next layout', onclick: () => step(1) }, '›');
  const pgI = h('i');
  const pgB = h('b');
  const pgT = h('button', { class: 'cc-pgt', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', dataset: { ps: 'lc-pager-text' }, 'aria-live': 'polite', onclick: () => toggleList() }, pgI, pgB);
  const list = h('div', { class: 'cc-list lc-glass', role: 'listbox', 'aria-label': 'Layouts', hidden: true, dataset: { ps: 'cc-layout-list' } });
  const pager = E('lc-pager lc-glass', 'div', { dataset: { ps: 'lc-pager' } }, list, pgP, pgT, pgN);

  // The Building type picker, above the layout switcher: strata units and every registered type, each with an icon and its label.
  const tyIcon = h('span', { class: 'cc-ty-i' });
  const tyName = h('b');
  const tyBtn = h('button', { class: 'cc-tyb', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'Building type', dataset: { ps: 'cc-type-btn' }, onclick: () => toggleTypes() }, tyIcon, h('span', { class: 'cc-ty-t' }, h('i', null, 'Building type'), tyName), h('span', { class: 'cc-ty-c', 'aria-hidden': 'true' }, '▾'));
  const tyList = h('div', { class: 'cc-types lc-glass', role: 'listbox', 'aria-label': 'Building types', hidden: true, dataset: { ps: 'cc-type-list' } });
  const typeBar = E('cc-typebar lc-glass', 'div', { dataset: { ps: 'cc-typebar' } }, tyList, tyBtn);

  // Views strip for compact widths (the same pills as in the card, as the housing card does for its rooms).
  const viewsCompact = E('lc-tabs', 'div', { role: 'tablist', 'aria-label': 'Views', dataset: { ps: 'cc-views-compact' } });
  const rooms = E('lc-rooms lc-glass', 'div', { dataset: { ps: 'lc-rooms' } }, viewsCompact);

  // The Units and feasibility panels.
  const panel = E('cc-panel lc-glass', 'section', { hidden: true, role: 'dialog', 'aria-label': 'Details', dataset: { ps: 'cc-panel' } });

  const cv = h('canvas', { width: 300, height: 400, 'aria-hidden': 'true' });
  const northLabel = E('lc-nlabel', 'i', null, 'N');
  const mini = h('button', { class: 'lc-mini', type: 'button', title: 'Show or hide the 2D plan', 'aria-label': 'Top view. Click to enlarge', dataset: { ps: 'lc-mini' }, onclick: () => toggleMini() }, cv, northLabel, E('lc-mini-t', 'span', null, 'TOP VIEW'));

  // The search pill: the real address search (NSW and QLD) with suggestions, as in the housing viewer.
  const findInput = h('input', { class: 'lc-find-in', type: 'search', placeholder: 'Search a NSW or QLD address', 'aria-label': 'Street address in NSW or QLD', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false', maxlength: '120', dataset: { ps: 'lc-find-input' } });
  const findList = h('ul', { class: 'lc-find-list lc-glass', role: 'listbox', hidden: true });
  const findPill = h('div', { class: 'lc-find lc-glass', dataset: { ps: 'lc-find' } }, icon('search', { size: 16 }), findInput, findList);
  const compass = (() => {
    const b = h('button', { class: 'lc-compass lc-glass', type: 'button', title: 'Reset the view', 'aria-label': 'Reset the view to the whole lot', dataset: { ps: 'lc-compass' }, onclick: () => { selView = 'aerial'; closePanel(); schedule(); go('aerial'); } });
    b.innerHTML = '<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="17" fill="none" stroke="rgba(255,255,255,.6)"/><path d="M0-13 L4 3 L0 0 L-4 3Z" fill="#ffc83d"/><path d="M0 13 L4 3 L0 6 L-4 3Z" fill="rgba(255,255,255,.55)"/></svg>';
    return b;
  })();
  const openUpload = () => runUpload(store, { viewer: true });
  injectUploadCss();
  const uploadBtn = h('button', { class: 'lc-upload lc-glass', type: 'button', dataset: { ps: 'lc-upload' }, title: 'Use your own lot boundary, anywhere in the world', onclick: () => openUpload() }, 'Upload boundary');
  const menuItems = [
    ['Open full editor', () => (onFullEditor || onEdit)?.()],
    [PLAN_SET_LABEL, () => planSet()],
    [SEND_LABEL, () => engineer.open()],
    [planTermsLinkText(), () => window.open(PLAN_TERMS_URL, '_blank', 'noopener')],
    ['Upload boundary', () => openUpload()],
    ['Site rules', () => import('../site/upload/rules-panel.js').then((m) => m.openRulesPanel(store))],
    ['Enlarge top view', () => toggleMini()],
  ];
  const menuList = h('div', { class: 'lc-menu-list lc-glass', role: 'menu', hidden: true }, ...menuItems.map(([label, fn]) => h('button', { class: 'lc-menu-item', type: 'button', role: 'menuitem', onclick: () => { menuList.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); fn(); } }, label)));
  const menuBtn = (() => {
    const b = h('button', { class: 'lc-menu lc-glass', type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false', dataset: { ps: 'lc-menu' }, onclick: () => { paintMenu(); menuList.hidden = !menuList.hidden; b.setAttribute('aria-expanded', String(!menuList.hidden)); } });
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
    return b;
  })();
  function paintMenu() { const it = menuList.lastElementChild; if (it) it.textContent = mini.classList.contains('is-big') ? 'Shrink top view' : 'Enlarge top view'; }
  const foot = E('lc-foot', 'div', { dataset: { ps: 'lc-foot' } }, FOOT_BASE);
  const root = E('lc-root lc-embed cc-root', 'div', { dataset: { ps: 'lot-card-root', mode: 'commercial' } }, head, compass, findPill, uploadBtn, menuBtn, menuList, card, rooms, panel, typeBar, pager, mini, foot);
  host.append(root);

  // Address search -------------------------------------------------------------------------------------------------------------
  let sugg = [];
  let suggI = -1;
  const closeSugg = () => { findList.hidden = true; suggI = -1; };
  let shownText = '';
  let finding = false;
  const pickAddress = async (label) => {
    closeSugg();
    const before = shownText;
    findInput.value = label;
    findInput.blur();
    if (!onFind || finding) return;
    finding = true;
    findPill.classList.add('is-busy');
    try {
      const ok = await onFind(label);
      if (ok === false) findInput.value = before;
    } catch {
      findInput.value = before;
    } finally {
      finding = false;
      findPill.classList.remove('is-busy');
      schedule();
    }
  };
  const paintSugg = () => {
    findList.replaceChildren(...sugg.slice(0, 6).map((r, i) => h('li', { class: 'lc-find-item', role: 'option', 'aria-selected': String(i === suggI), onpointerdown: (e) => { e.preventDefault(); pickAddress(r.label); } }, h('span', null, r.label), h('i', null, r.state || ''))));
    findList.hidden = !sugg.length;
  };
  const ask = debounce(async () => {
    const q = findInput.value.trim();
    if (q.length < 3) { sugg = []; paintSugg(); return; }
    try {
      const r = await searchAddresses(q, { onRetry: () => { findList.replaceChildren(h('li', { class: 'lc-find-item lc-find-busy', role: 'status' }, h('span', null, 'Busy, trying again'))); findList.hidden = false; } });
      if (findInput.value.trim() === q) { sugg = r || []; suggI = -1; paintSugg(); }
    } catch { sugg = []; paintSugg(); }
  }, 220);
  findInput.addEventListener('input', ask);
  findInput.addEventListener('focus', () => findInput.select());
  findInput.addEventListener('blur', () => setTimeout(closeSugg, 120));
  findInput.addEventListener('keydown', (e) => {
    const n = Math.min(6, sugg.length);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (n) { suggI = (suggI + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; paintSugg(); } e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const t = suggI >= 0 ? sugg[suggI]?.label : findInput.value.trim(); if (t && t.length >= 3) pickAddress(t); }
    else if (e.key === 'Escape') { closeSugg(); findInput.blur(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menuList.hidden && !menuList.contains(e.target) && !menuBtn.contains(e.target)) { menuList.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
    if (!list.hidden && !list.contains(e.target) && !pgT.contains(e.target)) closeList();
  });

  // State ----------------------------------------------------------------------------------------------------------------------
  let raf = 0;
  let disposed = false;
  let selView = 'aerial';
  let panelKind = null;
  let stepping = false;
  const app = () => getApp() || {};
  const builderName = () => app().builder?.name || '';
  const engineer = createSendToEngineer({ getApp: app, getProject: () => store.project, getLot: () => lotOf(store.project), getBuilderName: builderName, kind: 'commercial' });
  const viewerNow = async () => getViewer() || (await getViewer.ensure?.().catch(() => null)) || null;

  // Views ----------------------------------------------------------------------------------------------------------------------
  async function go(kind, { unit = 1 } = {}) {
    const v = await viewerNow();
    if (!v) return;
    try {
      if (kind === 'walk') {
        store.setUI({ view: 'walk' });
        for (let i = 0; i < 40 && !(v.mode === 'walk' && v.walk?.active); i++) await new Promise((r) => setTimeout(r, 100));
        const pose = unitWalkPose(store.project, unit);
        if (pose) await v.flyTo?.(pose, { duration: 0.01 });
        return;
      }
      if (store.ui.view === 'walk') store.setUI({ view: '3d' });
      if (kind === 'aerial') { await v.snapToRoom?.('aerial', { duration: 1.1, site: true }); return; }
      const pose = exteriorPose(store.project, kind === 'street' ? 'street' : '3d');
      if (pose) await v.flyTo?.(pose, { duration: 1.1 });
    } catch (e) { console.warn('[commercial card] view failed', e?.message); }
  }
  function pickView(id) {
    if (id === 'units') { openPanel(panelKind === 'units' ? null : 'units'); return; }
    closePanel();
    selView = id;
    schedule();
    go(id);
  }

  // Layouts --------------------------------------------------------------------------------------------------------------------
  const toggleList = () => { closeTypes(); list.hidden ? openList() : closeList(); };
  function openList() {
    const cur = switcherIndex(store.project);
    const LIST = switcherList(activeTypeId(store.project));
    list.replaceChildren(...LIST.map((l, i) => h('button', { type: 'button', role: 'option', 'aria-current': String(i === cur), dataset: { layout: l.id }, onclick: () => { closeList(); setLayout(l.id); } }, h('span', null, l.label), h('i', null, `${i + 1} / ${LIST.length}`))));
    list.hidden = false;
    pgT.setAttribute('aria-expanded', 'true');
  }
  function closeList() { list.hidden = true; pgT.setAttribute('aria-expanded', 'false'); }
  const toggleTypes = () => { tyList.hidden ? openTypes() : closeTypes(); };
  function openTypes() {
    closeList();
    tyList.replaceChildren(...typeChoices(store.project).map((t) => h('button', { type: 'button', role: 'option', 'aria-current': String(t.active), dataset: { type: t.id }, onclick: () => { closeTypes(); setType(t.id); } }, icon(t.icon, { size: 18 }), h('span', null, t.label))));
    tyList.hidden = false;
    tyBtn.setAttribute('aria-expanded', 'true');
  }
  function closeTypes() { tyList.hidden = true; tyBtn.setAttribute('aria-expanded', 'false'); }
  /** Choosing a type puts its Best fit on the lot (strata units: the Best fit rows). */
  function setType(id) {
    if (id === activeTypeId(store.project)) return Promise.resolve(false);
    return setLayout(null, id);
  }

  // Placing a layout runs a frame later (the auto fit tries every layout, turn and position), so the pager shows "Placing layout" first.
  function setLayout(id, typeId = activeTypeId(store.project)) {
    if (stepping) return Promise.resolve(false);
    stepping = true;
    pager.classList.add('is-busy');
    pager.setAttribute('aria-busy', 'true');
    pgP.disabled = true;
    pgN.disabled = true;
    pgB.textContent = 'Placing layout';
    selView = 'aerial';
    closePanel();
    return new Promise((resolve) => {
      const run = () => {
        try {
          const choice = chooseFor(store.project, typeId, id);
          if (!choice) { toast('There is no lot to put a layout on yet.', { kind: 'info' }); resolve(false); return; }
          applyChoice(store, typeId, choice);
          if (choice.tooBig) toast(`${choice.label} is too big for this block.`, { kind: 'info' });
          go('aerial');
          resolve(true);
        } catch (e) {
          toast(e?.message || 'That layout could not be placed.', { kind: 'error' });
          resolve(false);
        } finally {
          stepping = false;
          pager.classList.remove('is-busy');
          pager.removeAttribute('aria-busy');
          pgP.disabled = false;
          pgN.disabled = false;
          schedule();
        }
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0));
      else setTimeout(run, 0);
    });
  }
  function step(dir) {
    if (stepping) return Promise.resolve(false);
    const LIST = switcherList(activeTypeId(store.project));
    const i = stepLayout(switcherIndex(store.project), dir, LIST.length);
    return setLayout(LIST[i].id);
  }

  // Colours --------------------------------------------------------------------------------------------------------------------
  function setFinish(kind, id) {
    const cur = finishesOf(store.project);
    if (cur[kind] === id) return;
    store.apply('Colours', (p) => { applyFinishes(p, { [kind]: id }); });
  }
  const chip = (s, kind) => {
    const sw = h('span', { class: 'lc-sw' });
    sw.style.setProperty('--r', s.hex);
    sw.style.setProperty('--w', s.hex);
    return h('button', { class: 'lc-chip', type: 'button', title: s.name, 'aria-label': `${kind === 'cladding' ? 'Cladding' : 'Roller doors'}: ${s.name}`, 'aria-pressed': 'false', dataset: { kind, finish: s.id }, onclick: () => setFinish(kind === 'cladding' ? 'cladding' : 'door', s.id) }, sw);
  };
  for (const s of CLADDING) cladChips.append(chip(s, 'cladding'));
  for (const s of DOORS) doorChips.append(chip(s, 'door'));

  // Plan set -------------------------------------------------------------------------------------------------------------------
  // The same exporter as the commercial plan set in the editor (C000 to C103), so it has the same gating (the trial watermark and the Plan
  // Pack) as every other export. The send to an engineer offer follows the download, as in the housing card.
  let pdfBusy = false;
  async function planSet() {
    if (pdfBusy) return;
    pdfBusy = true;
    const label = bPlan.textContent;
    try {
      // The plan terms come first (src/legal/terms-gate.js).
      const terms = await requirePlanTerms({ context: 'commercial-plan-set' });
      if (!terms) return;
      bPlan.textContent = 'Preparing plan set';
      bPlan.disabled = true;
      const { exportPlanSet } = await import('../premium/exporters/planset/index.js');
      const out = await exportPlanSet({ project: store.project, lot: lotOf(store.project), kind: 'commercial', builderName: builderName() || '', download: false, terms });
      const bytes = out?.bytes || out?.blob || out?.data || out;
      if (bytes instanceof Blob || bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        downloadBlob(bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' }), out?.filename || 'Commercial_Plan_Set.pdf');
        engineer.offerAfterExport('site');
      }
    } catch (e) {
      toast(e?.message || 'The plan set could not be made.', { kind: 'error' });
    } finally {
      bPlan.textContent = label;
      bPlan.disabled = false;
      pdfBusy = false;
    }
  }

  // Panels ---------------------------------------------------------------------------------------------------------------------
  function closePanel() { panelKind = null; panel.hidden = true; schedule(); }
  function openPanel(kind) {
    if (!kind) { closePanel(); return; }
    panelKind = kind;
    paintPanel();
    panel.hidden = false;
    schedule();
  }
  const x = () => h('button', { class: 'cc-x', type: 'button', 'aria-label': 'Close', onclick: () => closePanel() }, '×');
  function paintPanel() {
    const p = store.project;
    if (panelKind === 'units') {
      const us = unitList(p);
      const gfa = us.reduce((s, u) => s + u.gfa, 0);
      panel.replaceChildren(x(), h('h3', null, 'Units'), h('p', { class: 'cc-sub' }, 'Areas are indicative. Click a unit to walk inside it.'),
        h('table', { dataset: { ps: 'cc-units' } },
          h('thead', null, h('tr', null, h('th', null, 'Unit'), h('th', null, 'Size'), h('th', { class: 'n' }, 'Ground m²'), h('th', { class: 'n' }, 'Mezz. m²'), h('th', { class: 'n' }, 'GFA m²'))),
          h('tbody', null, ...us.map((u) => h('tr', { class: 'cc-unit', dataset: { unit: String(u.n) }, tabindex: '0', onclick: () => { closePanel(); selView = 'walk'; go('walk', { unit: u.n }); }, onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
            h('td', null, u.building ? `${u.n} ${u.label}` : `Unit ${u.n}`), h('td', null, u.size), h('td', { class: 'n' }, u.ground.toFixed(1)), h('td', { class: 'n' }, u.mezz ? u.mezz.toFixed(1) : 'none'), h('td', { class: 'n' }, u.gfa.toFixed(1)))),
            h('tr', { class: 'cc-total' }, h('td', null, 'Total'), h('td'), h('td'), h('td'), h('td', { class: 'n' }, (Math.round(gfa * 10) / 10).toFixed(1))))));
      return;
    }
    const hl = feasibilityHeadline(p);
    if (!hl) { panel.replaceChildren(x(), h('h3', null, 'Indicative yield and value'), h('p', { class: 'cc-sub' }, 'Place a layout on a lot to see the figures.')); return; }
    const f = hl.f;
    const cs = activeSymbol();
    const keys = [['saleRate', 'Sale rate', `${cs}/m²`], ['rentRate', 'Rent per year', `${cs}/m²`], ['yieldPct', 'Net yield', '%'], ['landRate', 'Land rate', `${cs}/m²`], ['buildRate', 'Build rate (GFA)', `${cs}/m²`]];
    const priceInput = h('input', { type: 'number', min: 0, step: 10000, value: f.inputs.landPrice.value ?? '', placeholder: 'Auto', dataset: { ps: 'cc-land-price' }, onchange: () => {
      const raw = priceInput.value;
      store.apply('Set land price', (q) => { if (!q.commercial) return; q.commercial.feasibility ??= { area: null, v: {} }; q.commercial.feasibility.v ??= {}; if (raw === '' || Number(raw) <= 0) delete q.commercial.feasibility.v.landPrice; else q.commercial.feasibility.v.landPrice = Number(raw); });
    } });
    const landRow = h('label', { class: 'cc-land' }, h('span', null, 'Land price, ex GST (leave blank to use the area rate)'), priceInput);
    panel.replaceChildren(x(), h('h3', null, 'Indicative yield and value'), landRow,
      h('p', { class: 'cc-sub' }, `${f.areaLabel}. Portal and market data as at ${DATA_DATE}. ${CAVEAT}`),
      ...summaryRows(f).map(([k, v, b]) => h('div', { class: 'cc-line', dataset: { fz: k } }, h('span', null, k, b ? h('i', null, `Low to high: ${b}`) : null), h('b', null, v))),
      h('h4', null, 'Rates used'),
      ...keys.map(([k, label, unit]) => h('div', { class: 'cc-line' }, h('span', null, label, h('i', null, f.inputs[k].chip)), h('b', null, `${Number(f.inputs[k].value).toLocaleString('en-AU')} ${unit}`))),
      h('h4', null, 'Cost build up'),
      ...costRows(f).map(([k, v]) => h('div', { class: 'cc-line' }, h('span', null, k), h('b', null, v))),
      h('p', { class: 'cc-note' }, `${GST_NOTE} ${RENT_NOTE} ${SOURCES_TEXT}`),
      h('button', { class: 'lc-btn', type: 'button', onclick: () => { closePanel(); (onEdit || (() => store.setUI({ view: '2d' })))(); } }, 'Enter your own values'));
  }

  // Rendering ------------------------------------------------------------------------------------------------------------------
  function render() {
    raf = 0;
    if (disposed) return;
    const p = store.project;
    const lot = lotOf(p);
    const view = store.ui.view;
    const ready = !!lot && isCommercial(p) && (layoutUnits(p.commercial).length > 0 || buildingsOf(p.commercial).length > 0);
    const show = ready && view !== 'walk';
    root.hidden = !show;
    root.dataset.view = view;
    viewerHost.classList.toggle('lc-on', show && (view === '3d' || view === 'split'));
    viewerHost.classList.toggle('lc-full', show && view === '3d');
    layoutClasses();
    if (!show) { getViewer()?.setInset?.({}); return; }
    const canSend = engineer.available();
    bSend.hidden = !canSend;
    sendRow.hidden = !canSend;

    syncCurrency(p);
    headT.textContent = lotHeading(lot);
    headS.textContent = 'Concept only';
    foot.textContent = FOOT_BASE + creditText(lot);
    const pg = pagerText(p);
    const ct = typeChoices(p).find((t) => t.active);
    tyIcon.replaceChildren(icon(ct?.icon || 'bt-strata', { size: 20 }));
    tyName.textContent = ct?.label || 'Strata units';
    title.textContent = pg.title;
    const z = zoneClass(lot);
    sub.replaceChildren(h('span', null, lotLine(lot)), h('span', { class: 'lc-sc', title: finishLine(p) }, zoneLine(lot)));
    stats.replaceChildren(...commercialCardStats(p).map((c) => h('div', { dataset: { stat: c.key } }, h('b', null, c.value), h('i', null, c.label))));
    const hl = feasibilityHeadline(p);
    feas.hidden = !hl;
    if (hl) feasT.replaceChildren(h('div', null, h('b', null, hl.value), h('span', null, 'indicative gross realisation')), h('div', null, h('b', null, hl.rent), h('span', null, 'indicative gross rent per year')));
    const fin = finishesOf(p);
    for (const b of cladChips.children) b.setAttribute('aria-pressed', String(b.dataset.finish === fin.cladding));
    for (const b of doorChips.children) b.setAttribute('aria-pressed', String(b.dataset.finish === fin.door));

    const st = commercialStatus(p);
    for (const [el, line] of [[fitSet, st.setback], [fitPark, st.parking]]) {
      el.hidden = line.state === 'none';
      el.dataset.state = line.state;
      el.replaceChildren(h('span', { class: 'lc-dot', style: { background: DOT[line.state] || 'transparent' } }), line.text);
    }
    const warnZone = z.cls === 'residential' || z.cls === 'other' || z.cls === 'unknown';
    zoneNote.hidden = !warnZone || (z.cls !== 'unknown' && !!lot.customRules?.on) || (z.cls === 'unknown' && !!p.commercial.zoneClass);
    zoneNote.textContent = z.cls === 'unknown' ? 'Zone not known for this lot, check with council' : RESIDENTIAL_NOTE;

    const mkTab = (v) => h('button', { class: 'lc-tab', type: 'button', role: 'tab', title: v.caption, 'aria-selected': String(v.id === (panelKind === 'units' ? 'units' : selView)), dataset: { tab: v.id }, onclick: () => pickView(v.id) }, v.label);
    viewsEl.replaceChildren(...VIEWS.map(mkTab));
    viewsCompact.replaceChildren(...VIEWS.map(mkTab));
    root.dataset.room = selView === 'aerial' ? '0' : '1';
    const sample = lot.demo || lot.lotLabel === 'Sample lot';
    const lotText = sample ? '' : `${lot.address || lot.lotLabel || ''}${lot.areaM2 ? ` · ${Math.round(lot.areaM2).toLocaleString('en-AU')} m²` : ''}`;
    shownText = lotText;
    if (document.activeElement !== findInput && !finding) {
      findInput.value = lotText;
      findInput.placeholder = sample ? `Sample lot · ${lotLine(lot).split(' · ').slice(1).join(' · ') || 'search a NSW or QLD address'}` : 'Search a NSW or QLD address';
    }
    if (!stepping) {
      pgI.textContent = pg.n ? `Layout ${pg.n} / ${pg.of}` : `${pg.of} layouts`;
      pgB.textContent = pg.name;
    }
    if (panelKind) paintPanel();
    drawMini(p, lot);
    sizeInset();
  }
  function layoutClasses() {
    const w = host.clientWidth;
    const compact = w < COMPACT_W;
    root.classList.toggle('is-compact', compact);
    root.classList.toggle('is-phone', w < PHONE_W);
    viewerHost.classList.toggle('lc-compact', compact);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(render); }
  function toggleMini() { mini.classList.toggle('is-big'); paintMenu(); setTimeout(sizeInset, 50); }

  // The top view: the aerial under the lot when it is stored in the browser, the lot, the setback line, bays and the units in the cladding colour.
  let miniAerial = { key: null, img: null, loading: null };
  function ensureMiniAerial(p, lot) {
    const key = lot?.aerial?.extent && lot.aerial.key && lot.layers?.aerial !== false ? lot.aerial.key : null;
    if (!key) { miniAerial = { key: null, img: null, loading: null }; return null; }
    if (miniAerial.key === key) return miniAerial.img;
    miniAerial = { key, img: null, loading: key };
    import('../editor2d/underlay.js')
      .then((m) => m.loadImageBlob(key))
      .then((blob) => (blob && typeof createImageBitmap === 'function' ? createImageBitmap(blob) : null))
      .then((bmp) => { if (disposed || miniAerial.key !== key) return; miniAerial.img = bmp || null; miniAerial.loading = null; if (bmp) drawMini(p, lot); })
      .catch(() => { if (miniAerial.key === key) miniAerial.loading = null; });
    return null;
  }
  async function drawMini(p, lot) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#e8ece7';
    ctx.fillRect(0, 0, W, H);
    const pts = lot.boundary || [];
    if (pts.length < 3) return;
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.3;
    const minX = Math.min(...xs) - pad; const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad; const maxY = Math.max(...ys) + pad;
    const k = Math.min(W / (maxX - minX), H / (maxY - minY));
    const ox = (W - (maxX - minX) * k) / 2 - minX * k;
    const oy = (H - (maxY - minY) * k) / 2 - minY * k;
    const path = (ring) => { ctx.beginPath(); ring.forEach((q, i) => (i ? ctx.lineTo(q.x * k + ox, q.y * k + oy) : ctx.moveTo(q.x * k + ox, q.y * k + oy))); ctx.closePath(); };
    const img = ensureMiniAerial(p, lot);
    const ex = lot.aerial?.extent;
    const hasImg = !!(img && ex);
    if (hasImg) { try { ctx.drawImage(img, ex.x0 * k + ox, ex.y0 * k + oy, (ex.x1 - ex.x0) * k, (ex.y1 - ex.y0) * k); } catch { /* the schematic look follows */ } }
    for (const n of lot.neighbours || []) {
      if (!Array.isArray(n.ring) || n.ring.length < 3) continue;
      path(n.ring);
      if (!hasImg) { ctx.fillStyle = n.isRoad ? '#cfd4d8' : '#f6f7f4'; ctx.fill(); }
      ctx.strokeStyle = hasImg ? 'rgba(255,255,255,.55)' : 'rgba(60,70,80,.28)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    if (!hasImg) { path(pts); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); }
    if (Array.isArray(lot.envelope) && lot.envelope.length >= 3) {
      path(lot.envelope);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = hasImg ? 'rgba(255,255,255,.95)' : 'rgba(40,50,60,.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    path(pts);
    ctx.strokeStyle = '#e53935';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Bays (light), then units.
    try {
      const { parkingLayout } = await import('./parking.js');
      if (disposed || store.project !== p) { /* the project moved on; the next render redraws */ }
      const { buildingParking } = await import('./catalogue/bays.js');
      for (const r of [...parkingLayout(p.commercial).rows, ...buildingParking(p.commercial).rows]) for (const s of r.slots) { path(s.poly); ctx.fillStyle = s.kind === 'bay' ? 'rgba(90,100,110,.55)' : 'rgba(59,130,246,.75)'; ctx.fill(); }
    } catch { /* bays are decoration here */ }
    const fill = CLADDING.find((c) => c.id === finishesOf(p).cladding)?.hex || '#cfc9bd';
    for (const b of buildingsOf(p.commercial)) {
      for (const e of b.extras) { path(e.polygon); ctx.fillStyle = e.kind === 'canopy' || e.kind === 'fuel-canopy' ? 'rgba(120,130,140,.45)' : 'rgba(90,100,110,.35)'; ctx.fill(); }
      path(b.outline);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,44,50,.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const u of layoutUnits(p.commercial)) {
      path(u.poly);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,44,50,.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // The camera frames the lot in the clear area the cards leave (the same inset as the housing card).
  function insetOver(target, els) {
    const vr = target.getBoundingClientRect();
    const inset = { left: 0, right: 0, bottom: 0, top: 0 };
    if (target.hidden || vr.width < 2 || vr.height < 2) return inset;
    for (const el of els) {
      if (el === head || el.hidden || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vr.left || r.left >= vr.right || r.bottom <= vr.top || r.top >= vr.bottom) continue;
      if (el.classList.contains('ps-credit')) { inset.bottom = Math.max(inset.bottom, vr.bottom - r.top + 10); continue; }
      const cx = (r.left + r.right) / 2 - vr.left;
      const nearTop = (r.top + r.bottom) / 2 - vr.top < vr.height / 3;
      if (nearTop) inset.top = Math.max(inset.top, r.bottom - vr.top + 6);
      else if (cx < vr.width * 0.3 && r.width < vr.width * 0.6) inset.left = Math.max(inset.left, r.right - vr.left + 16);
      else if (cx > vr.width * 0.75 && r.width < vr.width * 0.4) inset.right = Math.max(inset.right, vr.right - r.left + 16);
      else inset.bottom = Math.max(inset.bottom, vr.bottom - r.top + 8);
    }
    if (root.classList.contains('is-compact')) { inset.left = Math.max(inset.left, 22); inset.right = Math.max(inset.right, 22); }
    return inset;
  }
  function sizeInset() {
    const v = getViewer();
    if (root.hidden) return;
    root.style.setProperty('--lc-card-h', `${Math.round(card.getBoundingClientRect().height)}px`);
    const els = [card, rooms, typeBar, pager, mini, head];
    const credit = host.querySelector('.ps-credit');
    if (credit) els.push(credit);
    if (v?.setInset) v.setInset(insetOver(viewerHost, els));
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { layoutClasses(); sizeInset(); }) : null;
  ro?.observe(host);
  ro?.observe(viewerHost);
  layoutClasses();
  const offs = [store.on('project', schedule), store.on('ui', (patch = {}) => { schedule(); if ('view' in patch) setTimeout(sizeInset, 700); })];
  const onAerial = () => { selView = 'aerial'; schedule(); };
  window.addEventListener('ps:room-aerial', onAerial);
  schedule();
  return {
    el: root, render, step, setLayout, setType, setFinish, planSet, openPanel, closePanel, pickView,
    dispose() { disposed = true; window.removeEventListener('ps:room-aerial', onAerial); offs.forEach((o) => o?.()); ro?.disconnect(); root.remove(); },
  };
}
