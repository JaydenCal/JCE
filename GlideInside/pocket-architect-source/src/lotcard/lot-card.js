// The lot card: what a builder sees live is what the sales pitch showed. Sits over the 3D view of a lot with a house on it:
//   header (top left)      lot label and a muted "Builder name · Concept only" line
//   design card (bottom left)  design name, lot line, scheme, stats, colour swatches, actions, setback status
//   design carousel (bottom centre)  "< NAME · 1 / n >" re-places the next design on the lot
//   top view minimap (bottom right)  lot, house and neighbours with a north arrow; click toggles the 2D plan
// Everything is derived from the project (src/lotcard/stats.js, src/model/colour-schemes.js, src/site/lot-checks.js). The card never
// edits the design except through store.apply (colour scheme, change of design), so every change is one undo step and saves with
// the project. The camera is inset so the card does not sit over the lot (viewer.setInset).

import { attachMiniView } from './mini-view.js';
import { zoneDwellingNote } from '../site/default-setbacks.js';
import { h } from '../ui/dom.js';
import { createLiveSearch } from '../site/address-search.js';
import { downloadBlob } from '../premium/exporters/download.js';
import { requirePlanTerms, planTermsLinkText, PLAN_TERMS_URL } from '../legal/terms-gate.js';
import { toast } from '../ui/toast.js';
import { lotOf } from '../model/placement.js';
import * as G from '../model/geometry.js';
import { canMoveHouse, onHouse, turnAngle } from '../editor2d/tool-movehouse.js';
import { ringOf } from '../editor2d/draw-lotplan.js';
import { buildingRings, buildingHull } from '../site/lotplan.js';
import { setbackStatusLine } from '../site/lot-checks.js';
import { SCHEMES, effectiveSchemeId, schemeById, schemeLine, schemeColours } from '../model/colour-schemes.js';
import { cardStats, lotHeading, lotLine, lotIdentity, hasBuilding } from './stats.js';
import { designsFor, currentIndex, pagerText, stepIndex } from './designs.js';
import { swapHouse } from './swap.js';
import { LOT_CARD_CSS } from './lot-card-css.js';
import { icon } from '../ui/icons.js';
import { listRoomTabs } from '../viewer3d/rooms.js';
import { roomsPlanModel } from './rooms-plan.js';
import { createSendToEngineer, SEND_LABEL } from './send-engineer.js';
import { runUpload, creditText, FOOT_BASE } from '../site/upload/flow.js';
import { createTopView, expandButton, housingScene } from './topview.js';
import { createAerialToggle } from '../ui/aerial-toggle.js';
import { moveHouseBy, turnHouseBy } from '../site/site-items.js';
import { createFitCard, stashGuidance } from '../ui/fit-card.js';
import { createCoach, TOPVIEW_COACH } from '../ui/fit-coach.js';
import { aerialOn } from '../site/aerial-pref.js';
import { injectUploadCss } from '../site/upload/css.js';

const STYLE_ID = 'lc-style';
const COMPACT_W = 980;
const PHONE_W = 600;
const DOT = { inside: '#6fd39a', outside: '#ff8a7a', check: '#f2b94b' };

/** The muted header line: "Builder name · Concept only" in the portal, "Concept only" in the public app. */
export const mutedLine = (builderName) => (builderName ? `${builderName} · Concept only` : 'Concept only');

export function createLotCard({ store, host, viewerHost = host, catalogue = null, getApp = () => (typeof window !== 'undefined' ? window.__ps : null), getViewer = () => null, onEdit = null, onMini = null, onFind = null, onFullEditor = null, embed = false, widget = false }) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = LOT_CARD_CSS;
    document.head.append(st);
  }
  const E = (cls, tag = 'div', attrs = {}, ...kids) => h(tag, { class: cls, ...attrs }, ...kids);

  const headT = E('lc-head-t', 'b');
  const headS = E('lc-head-s', 'span');
  const head = E('lc-head', 'div', { dataset: { ps: 'lot-head' } }, headT, headS);

  const title = E('lc-title', 'h2');
  const sub = E('lc-sub');
  const stats = E('lc-stats');
  const chips = E('lc-strip', 'div', { role: 'group', 'aria-label': 'Colour schemes' });
  const bWalk = h('button', { class: 'lc-btn lc-pri', type: 'button', dataset: { ps: 'lc-walk' }, onclick: () => walkInside() }, 'Walk inside');
  const bEdit = h('button', { class: 'lc-btn', type: 'button', hidden: widget, dataset: { ps: 'lc-edit' }, onclick: () => (onEdit ? onEdit() : store.setUI({ view: '2d' })) }, embed ? 'Choose and place a home' : 'Edit floor plan');
  const bPdf = h('button', { class: 'lc-btn lc-gh', type: 'button', hidden: widget, dataset: { ps: 'lc-pdf' }, onclick: () => planSetPdf('site') }, 'Site plan PDF');
  const bPdfH = h('button', { class: 'lc-btn lc-gh', type: 'button', hidden: widget, dataset: { ps: 'lc-pdf-house' }, onclick: () => planSetPdf('house') }, 'House plan PDF');
  // Under the PDF links: send the plans to a registered engineer (hidden until the premium layer is loaded and sending is allowed).
  const bSend = h('button', { class: 'lc-btn lc-sendbtn', type: 'button', hidden: true, dataset: { ps: 'lc-send-engineer' }, onclick: () => engineer.open() }, SEND_LABEL);
  const sendRow = E('lc-send', 'div', { hidden: true }, bSend);
  const fit = E('lc-fit', 'div', { role: 'status', 'aria-live': 'polite', dataset: { ps: 'lc-fit' } });
  const zoneNote = E('lc-zone', 'div', { role: 'note', hidden: true, dataset: { ps: 'lc-zone-note' } });
  const more = h('button', { class: 'lc-more', type: 'button', 'aria-expanded': 'false', onclick: () => { card.classList.toggle('is-open'); more.setAttribute('aria-expanded', String(card.classList.contains('is-open'))); sizeInset(); } }, 'Details');
  const tabsEl = E('lc-tabs', 'div', { role: 'tablist', 'aria-label': 'Rooms', dataset: { ps: 'lc-tabs' } });
  const body = E('lc-body', 'div', null, stats, E('lc-sp', 'div', null, E('lc-k', 'span', null, 'Colours'), chips), E('lc-sp lc-sp-rooms', 'div', null, E('lc-k', 'span', null, 'Rooms'), tabsEl), E('lc-acts', 'div', null, bWalk, bEdit, E('lc-links', 'span', null, bPdf, E('lc-dotsep', 'span', { 'aria-hidden': 'true' }, '\u00b7'), bPdfH)), sendRow, fit, zoneNote);
  const MINK = 'ps.lotcard.min';
  let isMin = false; try { isMin = localStorage.getItem(MINK) === '1'; } catch { isMin = false; }
  const minBtn = h('button', { class: 'lc-min', type: 'button', dataset: { ps: 'lc-minimise' }, onclick: () => { isMin = !card.classList.contains('is-min'); card.classList.toggle('is-min', isMin); paintMin(); try { localStorage.setItem(MINK, isMin ? '1' : '0'); } catch { /* storage blocked */ } try { sizeInset(); } catch { /* not ready */ } } });
  const paintMin = () => { minBtn.textContent = isMin ? '+' : '\u2212'; minBtn.setAttribute('aria-label', isMin ? 'Expand the design card' : 'Minimise the design card'); minBtn.title = isMin ? 'Expand' : 'Minimise'; minBtn.setAttribute('aria-expanded', String(!isMin)); };
  // The fit card and the first placement tips sit in the design card under its title (never over the lot), so they show on a phone too,
  // where the rest of the card is folded away.
  let breachSides = [];
  let tipsRef = null; // the homepage "How to" tips: they step aside while the fit card has something to say
  const fitCard = createFitCard({
    store, theme: 'glass', compact: true,
    onSides: (s) => { breachSides = s; },
    onChange: () => { try { const up = !fitCard.el.hidden && !['fits', 'tight'].includes(fitCard.el.dataset.verdict); fit.classList.toggle('lc-fit-off', up); advice.classList.toggle('has-problem', up); if (up) tipsRef?.hide(); sizeInset(); schedule(); } catch { /* not ready */ } },
    getDesigns: () => designs,
    onSwapped: (d) => { store.setUI({ placedDesign: { id: d.id, name: d.name } }); selTab = 'aerial'; bedI = 0; go('aerial'); },
    onGuide: (text) => {
      if (widget) { toast('Try another design from this builder to find one that suits this block.', { kind: 'info', timeout: 12000 }); return; }
      if (embed) { stashGuidance(text); (onFullEditor || onEdit)?.(); return; }
      store.setUI({ view: '2d' });
      toast(text, { kind: 'info', timeout: 20000 });
    },
    onEngineer: () => engineer.open(),
    canEngineer: () => !widget && engineer.available(),
  });
  const coach = createCoach({ theme: 'glass', steps: TOPVIEW_COACH, onChange: () => { try { sizeInset(); } catch { /* not ready */ } } });
  const advice = E('lc-advice', 'div', null, coach.el, fitCard.el);
  // Change the building type or design from the card, in every tool: the title and a small chevron open a compact list (designs for this lot first,
  // then every other building type in the catalogue). Picking one places it exactly as the pager does.
  const swapBtn = h('button', { class: 'lc-chev', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'Change building type or design', title: 'Change building type or design', dataset: { ps: 'lc-swap' }, onclick: (e) => { e.stopPropagation(); toggleSwap(); } }, '\u25be');
  const swapList = E('lc-swaplist', 'div', { role: 'listbox', 'aria-label': 'Building types and designs', hidden: true, dataset: { ps: 'lc-swaplist' } });
  title.addEventListener('click', () => toggleSwap());
  title.style.cursor = 'pointer';
  const card = E('lc-card lc-glass', 'section', { 'aria-label': 'House design', dataset: { ps: 'lot-card' } }, E('lc-hd', 'div', null, E('lc-hd-in', 'div', null, E('lc-ttl', 'div', null, title, swapBtn), sub), more, minBtn), swapList, advice, body);
  if (isMin) card.classList.add('is-min');
  paintMin();

  const pgP = h('button', { type: 'button', 'aria-label': 'Previous design', onclick: () => step(-1) }, '‹');
  const pgN = h('button', { type: 'button', 'aria-label': 'Next design', onclick: () => step(1) }, '›');
  const pgT = E('lc-pgt', 'span', { dataset: { ps: 'lc-pager-text' }, 'aria-live': 'polite' });
  const pager = E('lc-pager lc-glass', 'div', { dataset: { ps: 'lc-pager' } }, pgP, pgT, pgN);

  // Rooms: tab pills, a one line caption and a small floor plan with the chosen room highlighted (rooms on it are clickable).
  const tabsCompact = E('lc-tabs', 'div', { role: 'tablist', 'aria-label': 'Rooms', dataset: { ps: 'lc-tabs-compact' } });
  // The room pills scroll sideways on a phone: a fade on the clipped edge says there are more.
  const cue = () => {
    const more = tabsCompact.scrollWidth > tabsCompact.clientWidth + 2 && tabsCompact.scrollLeft + tabsCompact.clientWidth < tabsCompact.scrollWidth - 2;
    tabsCompact.classList.toggle('has-more', more);
    tabsCompact.classList.toggle('has-less', tabsCompact.scrollLeft > 2);
  };
  tabsCompact.addEventListener('scroll', cue, { passive: true });
  const cap = E('lc-cap', 'p', { dataset: { ps: 'lc-caption' }, 'aria-live': 'polite' });
  const plan = (() => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'lc-plan'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', 'Floor plan'); return svg; })();
  const rooms = E('lc-rooms lc-glass', 'div', { dataset: { ps: 'lc-rooms' } }, tabsCompact, E('lc-rooms-row', 'div', null, cap, plan));

  const cv = h('canvas', { width: 300, height: 400, 'aria-hidden': 'true' });
  const north = (() => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-20 -20 40 40');
    svg.setAttribute('class', 'lc-north');
    svg.innerHTML = '<circle r="17" fill="rgba(10,10,12,.72)" stroke="rgba(255,255,255,.5)"/><path d="M0-14 L4 2 L0 -1 L-4 2Z" fill="#ffc83d"/><path d="M0 14 L4 2 L0 5 L-4 2Z" fill="rgba(255,255,255,.5)"/><text x="0" y="-6" font-size="0" fill="#000">N</text>';
    return svg;
  })();
  const northLabel = E('lc-nlabel', 'i', null, 'N');
  // The mini map is a plain box (not a button) so the expand button can be a real button on it. A click on the map, or the expand button, opens
  // the large top view (src/lotcard/topview.js).
  const miniX = expandButton(() => topView.open());
  const mini = h('div', { class: 'lc-mini', role: 'group', title: 'Top view. Click to enlarge', 'aria-label': 'Top view of the lot', dataset: { ps: 'lc-mini' }, onclick: (e) => { if (e.target.closest?.('.lc-mini-x')) return; if (suppressClick) { suppressClick = false; return; } if (mv?.consumeClick()) return; if (embed) topView.open(); else toggle2d(); } }, cv, h('span', { class: 'lc-mini-t' }, 'TOP VIEW'), north, northLabel, h('span', { class: 'lc-mini-hint', 'aria-hidden': 'true' }, 'Drag the house to move it, drag the map to pan, scroll to zoom, right-drag to rotate. Click to enlarge'), miniX);
  const aerialT = createAerialToggle({ store, className: 'lc-aerial lc-glass' });
  const topView = createTopView({ root: () => root, getScene: () => housingScene(store.project), store, trigger: miniX, onChange: () => paintMenu(), movers: { can: (p) => canMoveHouse(p), move: (id, dx, dy) => { coach.did('move'); return store.apply('Move house', (q) => { moveHouseBy(q, dx, dy); }); }, turn: (id, deg, c) => { coach.did('move'); return store.apply('Rotate house', (q) => { turnHouseBy(q, deg, c); }); } } });
  let suppressClick = false;

  // The search pill. In the embedded viewer it is the real address search (NSW and QLD, /api/site/search) as an input with suggestions; in the
  // app it opens the Find my block dialog.
  const findInput = embed ? h('input', { class: 'lc-find-in', type: 'search', placeholder: 'Search a NSW or QLD address', 'aria-label': 'Street address in NSW or QLD', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false', maxlength: '120', dataset: { ps: 'lc-find-input' } }) : null;
  const findList = embed ? h('ul', { class: 'lc-find-list lc-glass', role: 'listbox', hidden: true }) : null;
  const findPill = embed
    ? h('div', { class: 'lc-find lc-glass', dataset: { ps: 'lc-find' } }, icon('search', { size: 16 }), findInput, findList)
    : h('button', { class: 'lc-find lc-glass', type: 'button', dataset: { ps: 'lc-find' }, 'aria-label': 'Find another block', onclick: () => import('../ui/find-block.js').then((m) => m.openFindBlock(store)) }, icon('search', { size: 16 }), h('span', null, ''));
  // Compass (resets the view to the whole lot) and the menu, embedded viewer only.
  const compass = embed ? (() => {
    const b = h('button', { class: 'lc-compass lc-glass', type: 'button', title: 'Reset the view', 'aria-label': 'Reset the view to the whole lot', dataset: { ps: 'lc-compass' }, onclick: () => { selTab = 'aerial'; bedI = 0; schedule(); go('aerial'); } });
    b.innerHTML = '<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="17" fill="none" stroke="rgba(255,255,255,.6)"/><path d="M0-13 L4 3 L0 0 L-4 3Z" fill="#ffc83d"/><path d="M0 13 L4 3 L0 6 L-4 3Z" fill="rgba(255,255,255,.55)"/></svg>';
    return b;
  })() : null;
  const menuItems = widget ? [['Enlarge top view', () => topView.toggle()]] : embed ? [
    ['Open full editor', () => (onFullEditor || onEdit)?.()],
    ['Site plan PDF', () => planSetPdf('site')],
    ['House plan PDF', () => planSetPdf('house')],
    [SEND_LABEL, () => engineer.open()],
    [planTermsLinkText(), () => window.open(PLAN_TERMS_URL, '_blank', 'noopener')],
    ['Upload boundary', () => runUpload(store, { viewer: true, catalogue })],
    ['Site rules', () => import('../site/upload/rules-panel.js').then((m) => m.openRulesPanel(store))],
    ['Enlarge top view', () => topView.toggle()],
  ] : [];
  injectUploadCss();
  const uploadBtn = embed && !widget ? h('button', { class: 'lc-upload lc-glass', type: 'button', dataset: { ps: 'lc-upload' }, title: 'Use your own lot boundary, anywhere in the world', onclick: () => runUpload(store, { viewer: true, catalogue }) }, 'Upload boundary') : null;
  // The main call to action: a big gold button, a real button so Tab reaches it and Enter or Space opens the full editor.
  const fullBtn = embed && !widget ? h('button', { class: 'lc-full', type: 'button', dataset: { ps: 'lc-full-editor' }, title: 'Open this lot and design in the full editor', onclick: () => (onFullEditor || onEdit)?.() }, 'Open full editor', h('span', { 'aria-hidden': 'true' }, ' \u2197')) : null;
  const menuList = embed ? h('div', { class: 'lc-menu-list lc-glass', role: 'menu', hidden: true }, ...menuItems.map(([label, fn]) => h('button', { class: 'lc-menu-item', type: 'button', role: 'menuitem', onclick: () => { menuList.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); fn(); paintMenu(); } }, label))) : null;
  const menuBtn = embed ? (() => {
    const b = h('button', { class: 'lc-menu lc-glass', type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false', dataset: { ps: 'lc-menu' }, onclick: () => { paintMenu(); menuList.hidden = !menuList.hidden; b.setAttribute('aria-expanded', String(!menuList.hidden)); } });
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';
    return b;
  })() : null;
  // The last menu item names what it will do: "Enlarge top view" or "Shrink top view".
  function paintMenu() { const it = menuList?.lastElementChild; if (it) it.textContent = topView.isOpen() ? 'Close top view' : 'Enlarge top view'; }
  const foot = embed ? E('lc-foot', 'div', { dataset: { ps: 'lc-foot' } }, FOOT_BASE) : null;
  const root = E('lc-root', 'div', { dataset: { ps: 'lot-card-root' } }, head, ...(compass ? [compass] : []), ...(fullBtn ? [fullBtn] : []), findPill, ...(uploadBtn ? [uploadBtn] : []), ...(menuBtn ? [menuBtn, menuList] : []), card, rooms, pager, ...(embed ? [aerialT.el] : []), mini, ...(foot ? [foot] : []));
  if (embed) {
    root.classList.add('lc-embed');
    // No "How to" panel: it covered the design card and the view (owner 18/11/2026). tipsRef stays null.
  }
  host.append(root);

  // Address search (embedded viewer) ----------------------------------------------------------------------------------------------
  let sugg = [];
  let suggI = -1;
  const closeSugg = () => { if (findList) { findList.hidden = true; suggI = -1; } };
  let shownText = '';
  let finding = false;
  // One source of truth: the pill text is derived from the loaded lot (lotIdentity), never from what was last typed or picked.
  const syncPill = (lot) => {
    const lotText = lotIdentity(lot).pill;
    shownText = lotText;
    if (findInput) { if (document.activeElement !== findInput && !finding) findInput.value = lotText; }
    else if (findPill) findPill.lastChild.textContent = lotText || 'Find my block';
  };
  // A failed search puts the previous lot back in the pill (the viewer toasts the reason).
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
      syncPill(lotOf(store.project)); // whatever the outcome (loaded, failed or queued) the pill shows the lot that is actually loaded
      schedule();
    }
  };
  const paintSugg = () => {
    findList.replaceChildren(...sugg.slice(0, 6).map((r, i) => h('li', { class: 'lc-find-item', role: 'option', 'aria-selected': String(i === suggI), onpointerdown: (e) => { e.preventDefault(); pickAddress(r.label); } }, h('span', null, r.label), h('i', null, r.state || ''))));
    findList.hidden = !sugg.length;
  };
  if (findInput) {
    const live = createLiveSearch({
      getText: () => findInput.value,
      onBusy: () => { findList.replaceChildren(h('li', { class: 'lc-find-item lc-find-busy', role: 'status' }, h('span', null, 'Busy, trying again'))); findList.hidden = false; },
      onResults: (r) => { sugg = r; suggI = -1; paintSugg(); },
    });
    const ask = () => live.trigger();
    findInput.addEventListener('input', ask);
    findInput.addEventListener('focus', () => findInput.select());
    findInput.addEventListener('blur', () => setTimeout(closeSugg, 120));
    findInput.addEventListener('keydown', (e) => {
      const n = Math.min(6, sugg.length);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (n) { suggI = (suggI + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; paintSugg(); } e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); const t = suggI >= 0 ? sugg[suggI]?.label : findInput.value.trim(); if (t && t.length >= 3) pickAddress(t); } // typed text: the search takes the top match (exact house number first)
      else if (e.key === 'Escape') { closeSugg(); findInput.blur(); }
    });
  }
  if (menuList) document.addEventListener('pointerdown', (e) => { if (!menuList.hidden && !menuList.contains(e.target) && !menuBtn.contains(e.target)) { menuList.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });

  // State -------------------------------------------------------------------------------------------------------------------------
  let designs = [];
  let designsKey = null;
  let loading = false;
  let raf = 0;
  let disposed = false;

  const app = () => getApp() || {};
  const builderName = () => app().builder?.name || '';
  const engineer = createSendToEngineer({ getApp: app, getProject: () => store.project, getLot: () => lotOf(store.project), getBuilderName: builderName });
  const uiPlaced = () => store.ui.placedDesign || null;

  function lotKey() {
    const lot = lotOf(store.project);
    if (!lot) return null;
    return `${lot.lotLabel}|${lot.areaM2}|${(lot.envelope || []).length}|${(lot.frontEdges || []).join(',')}|${lot.setbacksKey || ''}|${app().lotDesigns ? 'p' : 'c'}${app().widgetRev || 0}`;
  }

  async function loadDesigns() {
    const key = lotKey();
    if (!key || key === designsKey || loading) return;
    loading = true;
    try {
      const list = await designsFor({ catalogue, project: store.project, provider: app().lotDesigns });
      if (disposed) return;
      designs = Array.isArray(list) ? list : [];
      designsKey = key;
      fitCard.update();
    } catch (e) {
      console.warn('[lotcard] designs unavailable', e?.message);
      designs = [];
      designsKey = key;
    } finally {
      loading = false;
    }
    schedule();
  }

  // Stepping places a whole design (the auto fit search can take a second), so it runs a frame later: the pager shows "Placing design" first
  // and the page keeps painting. Resolves when the design is placed.
  let stepping = false;
  function step(dir) {
    if (designs.length < 2 || stepping) return Promise.resolve(false);
    const i = stepIndex(designs.length, currentIndex(designs, store.project, uiPlaced()), dir);
    return placeDesign(designs[i]);
  }
  function placeDesign(d) {
    stepping = true;
    pager.classList.add('is-busy');
    pager.setAttribute('aria-busy', 'true');
    pgP.disabled = true;
    pgN.disabled = true;
    pgT.textContent = 'Placing design';
    selTab = 'aerial';
    bedI = 0;
    go('aerial');
    return new Promise((resolve) => {
      const run = () => {
        try {
          const { fits, tooBig, turnedDeg } = swapHouse(store, d.project, { id: d.id, name: d.name });
          if (turnedDeg) toast(`${d.name} was turned to suit the shape of this lot.`, { kind: 'info' });
          store.setUI({ placedDesign: { id: d.id, name: d.name } });
          if (tooBig) toast(`${d.name} is too big for this block.`, { kind: 'info' });
          else if (fits === false) toast(`${d.name} does not fit inside the setbacks on this lot.`, { kind: 'info' });
          resolve(true);
        } catch (e) {
          toast(e?.message || 'That design could not be placed.', { kind: 'error' });
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

  /** Designs for this lot (ranked) then the other catalogue building types, as [{ id, name, group, project?, make? }]. */
  function swapChoices() {
    const out = designs.map((d) => ({ id: d.id, name: d.name, group: 'Designs for this lot', d }));
    const seen = new Set(out.map((x) => x.id));
    for (const t of widget ? [] : Array.isArray(catalogue?.templates) ? catalogue.templates : []) { // the widget offers the builder's designs only
      if (!t?.id || t.id === 'blank' || seen.has(t.id)) continue;
      out.push({ id: t.id, name: t.name || t.id, group: 'Building types', make: () => ({ id: t.id, name: t.name || t.id, project: catalogue.createFromTemplate ? catalogue.createFromTemplate(t.id) : t.create?.() }) });
    }
    return out;
  }
  function closeSwap() { swapList.hidden = true; swapBtn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outsideSwap, true); try { sizeInset(); } catch { /* not ready */ } }
  function outsideSwap(e) { if (!swapList.contains(e.target) && !swapBtn.contains(e.target) && e.target !== title) closeSwap(); }
  function toggleSwap() {
    if (!swapList.hidden) { closeSwap(); return; }
    const cur = uiPlaced()?.id || store.project.placedHouse?.id || null;
    const curName = uiPlaced()?.name || store.project.placedHouse?.name || store.project.name;
    const kids = [];
    let group = '';
    for (const c of swapChoices()) {
      if (c.group !== group) { group = c.group; kids.push(h('div', { class: 'lc-swap-g' }, group)); }
      const on = (cur && c.id === cur) || (!cur && c.name === curName);
      kids.push(h('button', { class: 'lc-swap-i', type: 'button', role: 'option', 'aria-selected': String(!!on), dataset: { id: c.id }, onclick: () => { closeSwap(); if (on) return; let d = c.d; try { d = d || c.make(); } catch { d = null; } if (d?.project) placeDesign(d); } }, h('span', null, c.name), on ? h('i', null, '\u2713') : null));
    }
    swapList.replaceChildren(...kids);
    swapList.hidden = false;
    swapBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outsideSwap, true);
    try { sizeInset(); } catch { /* not ready */ }
  }

  function setScheme(id) {
    if (effectiveSchemeId(store.project) === id) return;
    store.apply('Colour scheme', (p) => { p.colourScheme = id; });
  }

  // The two PDF buttons call the plan set exporter (src/premium/exporters/planset): "Site plan PDF" is the cover, site plan and house plan,
  // "House plan PDF" the cover and house plan. A builder or client login has the builder's name watermarked on every sheet.
  let pdfBusy = false;
  async function planSetPdf(kind) {
    if (pdfBusy) return;
    pdfBusy = true;
    const btn = kind === 'house' ? bPdfH : bPdf;
    const label = btn.textContent;
    try {
      // The plan terms come first, for every plan PDF including the free preview version (src/legal/terms-gate.js).
      const terms = await requirePlanTerms({ context: kind === 'house' ? 'lot-card-house-pdf' : 'lot-card-site-pdf' });
      if (!terms) return;
      btn.textContent = 'Preparing PDF';
      btn.disabled = true;
      const { exportPlanSet } = await import('../premium/exporters/planset/index.js');
      const lot = lotOf(store.project);
      // To scale only with a Plan Pack, a builder or client login (internal accounts are builder logins) or a commercial subscription.
      // Everyone else, including the free embed viewer, gets the stamped "PREVIEW, NOT TO SCALE" version.
      const a = app();
      const full = !!(a.premium?.isEntitled?.() || a.builder);
      const out = await exportPlanSet({ project: store.project, lot, kind, builderName: builderName() || '', builder: app().builder || null, feasibility: true, download: false, preview: !full, terms, includeAerial: aerialOn(store.project) && store.project.drawing?.includeAerial !== false });
      if (!full) toast('This is a preview, not to scale. A Plan Pack gives you the to-scale plan set.', { kind: 'info' });
      const bytes = out?.bytes || out?.blob || out?.data || out;
      if (bytes instanceof Blob || bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        const slug = String(store.project.placedHouse?.name || store.project.name || 'Design').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Design';
        downloadBlob(bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' }), out?.filename || `${kind === 'house' ? 'House_Plan' : 'Site_Plan'}_${slug}.pdf`);
        if (full) engineer.offerAfterExport(kind);
      }
    } catch (e) {
      toast(e?.message || 'The PDF could not be made.', { kind: 'error' });
    } finally {
      btn.textContent = label;
      btn.disabled = false;
      pdfBusy = false;
    }
  }
  const sitePlanPdf = () => planSetPdf('site');

  // Tabs come from the room engine (one grouped Bedrooms tab). Bedrooms cycles through the individual bedrooms: master first, then the
  // others, one per click. The engine's own per bedroom tab (master, bed2 ...) supplies the pose and the caption.
  let tabs = [];
  let selTab = 'aerial';
  let bedI = 0;
  const bedTabs = () => listRoomTabs(store.project, null).filter((t) => t.bedN > 0);
  // Walk inside starts in the clearest spot of the main living room (rooms.js standing point), not on the street.
  async function walkInside() {
    store.setUI({ view: 'walk' });
    if (store.project.mode === 'commercial') return;
    try {
      const v = (await viewerNow());
      if (!v) return;
      for (let i = 0; i < 40 && !(v.mode === 'walk' && v.walk?.active); i++) await new Promise((r) => setTimeout(r, 100));
      const tabs = v.roomTabs?.() || [];
      const tab = tabs.find((t) => t.id === 'living' && t.roomIds?.length) || tabs.find((t) => t.roomIds?.length);
      if (tab) await v.snapToRoom(tab.id, { duration: 0 });
    } catch { /* the walk keeps its own start */ }
  }
  const viewerNow = async () => getViewer() || (await getViewer.ensure?.().catch(() => null)) || null;
  const targetTab = () => (selTab === 'bedrooms' ? bedTabs()[bedI] : tabs.find((t) => t.id === selTab));
  async function go(id) {
    const v = await viewerNow();
    if (v?.snapToRoom) await v.snapToRoom(id, { duration: 1.1, site: id === 'aerial' }).catch(() => {});
  }
  function pickTab(id) {
    if (id === 'bedrooms') {
      const beds = bedTabs();
      bedI = selTab === 'bedrooms' ? (bedI + 1) % Math.max(1, beds.length) : 0;
      selTab = 'bedrooms';
      schedule();
      if (beds[bedI]) go(beds[bedI].id);
      return;
    }
    selTab = id;
    schedule();
    go(id);
  }
  function pickRoom(roomId) {
    const beds = bedTabs();
    const bi = beds.findIndex((t) => t.roomIds.includes(roomId));
    if (bi >= 0) { selTab = 'bedrooms'; bedI = bi; schedule(); go(beds[bi].id); return; }
    const tab = tabs.find((x) => x.roomIds.includes(roomId));
    if (tab) pickTab(tab.id);
    else { selTab = 'aerial'; schedule(); go(roomId); }
  }

  function toggle2d() { if (embed) { topView.toggle(); return; } if (onMini) { onMini(); return; } store.setUI({ view: store.ui.view === 'split' ? '3d' : 'split' }); }

  // Rendering ---------------------------------------------------------------------------------------------------------------------
  const schemeChip = (s) => {
    const sw = h('span', { class: 'lc-sw' });
    sw.style.setProperty('--r', s.roof);
    sw.style.setProperty('--w', s.wall || '#cfc9bd');
    return h('button', { class: 'lc-chip', type: 'button', title: s.id === 'standard' ? 'Standard colours' : `${s.roofName} roof, ${s.wallName} walls`, 'aria-label': s.name, 'aria-pressed': 'false', dataset: { scheme: s.id }, onclick: () => setScheme(s.id) }, sw);
  };
  for (const s of SCHEMES) chips.append(schemeChip(s));

  function render() {
    raf = 0;
    if (disposed) return;
    const p = store.project;
    const lot = lotOf(p);
    const view = store.ui.view;
    syncPill(lot); // the address pill always names the lot that is loaded, even while the card is hidden
    // Not while the placement panel is open (it uses the bottom of the stage), nor in walk mode.
    const show = !!lot && hasBuilding(p) && p.mode !== 'commercial' && view !== 'walk' && !host.querySelector('.pas-pose');
    if (show && canMoveHouse(p)) coach.start();
    root.hidden = !show;
    root.dataset.view = view;
    viewerHost.classList.toggle('lc-on', show && (view === '3d' || view === 'split'));
    viewerHost.classList.toggle('lc-full', show && view === '3d');
    layoutClasses();
    if (!show) { getViewer()?.setInset?.({}); if (p.mode !== 'commercial') app().editor?.setInset?.({}); return; }
    const canSend = engineer.available();
    bSend.hidden = !canSend;
    sendRow.hidden = !canSend;
    loadDesigns();

    const idx = currentIndex(designs, p, uiPlaced());
    const placed = uiPlaced() || p.placedHouse || null;
    const name = (designs.length && designs[idx]?.name) || placed?.name || p.name || 'House design';
    const sid = effectiveSchemeId(p);
    const scheme = schemeById(sid);
    headT.textContent = lotHeading(lot);
    if (foot) foot.textContent = FOOT_BASE + creditText(lot);
    headS.textContent = mutedLine(builderName());
    title.textContent = name;
    sub.replaceChildren(h('span', null, lotLine(lot)), h('span', { class: 'lc-sc' }, schemeLine(scheme)));
    stats.replaceChildren(...cardStats(p).map((c) => h('div', { dataset: { stat: c.key } }, h('b', null, c.value), h('i', null, c.label))));
    for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.scheme === sid));

    const line = setbackStatusLine(p);
    fit.hidden = line.state === 'none';
    fit.dataset.state = line.state;
    fit.replaceChildren(h('span', { class: 'lc-dot', style: { background: DOT[line.state] || 'transparent' } }), line.text);
    const zn = zoneDwellingNote(lot);
    zoneNote.hidden = !zn;
    zoneNote.textContent = zn;

    tabs = listRoomTabs(p, null, { groupBedrooms: true });
    if (!tabs.some((t) => t.id === selTab)) selTab = 'aerial';
    root.dataset.room = selTab === 'aerial' ? '0' : '1';
    const mkTab = (t) => h('button', { class: 'lc-tab', type: 'button', role: 'tab', title: t.caption || '', 'aria-selected': String(t.id === selTab), dataset: { tab: t.id }, onclick: () => pickTab(t.id) }, t.label);
    tabsEl.replaceChildren(...tabs.map(mkTab));
    tabsCompact.replaceChildren(...tabs.map(mkTab));
    setTimeout(cue, 0);
    const sample = lot.demo || lot.lotLabel === 'Sample lot';
    if (findInput) findInput.placeholder = sample ? `Sample lot · ${lotLine(lot).split(' · ').slice(1).join(' · ') || 'search a NSW or QLD address'}` : 'Search a NSW or QLD address';
    const cur = targetTab() || tabs.find((t) => t.id === 'aerial');
    cap.textContent = cur?.caption || '';
    rooms.hidden = tabs.length < 2;
    drawPlan(p, cur);

    pager.hidden = designs.length < 2;
    if (!stepping) pgT.textContent = pagerText(designs, idx, placed?.name || p.name || '');
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

  function drawPlan(p, cur) {
    const m = roomsPlanModel(p, 150, 100);
    plan.setAttribute('viewBox', `0 0 ${m.w} ${m.h}`);
    const ns = 'http://www.w3.org/2000/svg';
    const on = new Set(cur?.roomIds || []);
    plan.replaceChildren(...m.rooms.map((r) => {
      const el = document.createElementNS(ns, 'polygon');
      el.setAttribute('points', r.points);
      el.setAttribute('class', `lc-room${on.has(r.id) ? ' is-on' : ''}`);
      el.dataset.room = r.id;
      const t = document.createElementNS(ns, 'title');
      t.textContent = r.name;
      el.append(t);
      el.addEventListener('click', () => pickRoom(r.id));
      return el;
    }));
  }

  // Real aerial under the lot when the lot has one stored in the browser (same image the 3D ground uses); otherwise a light schematic.
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

  function drawMini(p, lot) {
    mv?.apply();
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
    const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.32;
    const minX = Math.min(...xs) - pad; const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad; const maxY = Math.max(...ys) + pad;
    const k = Math.min(W / (maxX - minX), H / (maxY - minY));
    const ox = (W - (maxX - minX) * k) / 2 - minX * k;
    const oy = (H - (maxY - minY) * k) / 2 - minY * k;
    const path = (ring) => { ctx.beginPath(); ring.forEach((q, i) => (i ? ctx.lineTo(q.x * k + ox, q.y * k + oy) : ctx.moveTo(q.x * k + ox, q.y * k + oy))); ctx.closePath(); };
    miniT = { k, ox, oy };
    const img = ensureMiniAerial(p, lot);
    const ex = lot.aerial?.extent;
    const hasImg = !!(img && ex);
    if (hasImg) {
      try { ctx.drawImage(img, ex.x0 * k + ox, ex.y0 * k + oy, (ex.x1 - ex.x0) * k, (ex.y1 - ex.y0) * k); } catch { /* fall through to the schematic look */ }
    }
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
      // The buildable area, lightly shaded so it is plain where a house can go.
      path(lot.envelope);
      ctx.fillStyle = breachSides.length ? 'rgba(242,185,75,.26)' : 'rgba(111,211,154,.24)';
      ctx.fill();
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
    // The side the house breaches, picked out.
    for (const sd of breachSides) { ctx.beginPath(); ctx.moveTo(sd.a.x * k + ox, sd.a.y * k + oy); ctx.lineTo(sd.b.x * k + ox, sd.b.y * k + oy); ctx.strokeStyle = '#ffd23d'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt'; }
    const col = schemeColours(p);
    for (const ring of buildingRings(p)) {
      if (ring.length < 3) continue;
      path(ring);
      ctx.fillStyle = col?.roof || '#6b7178';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (canMoveHouse(p)) {
      const ring = ringOf(p, miniRot);
      if (ring) {
        ctx.beginPath();
        ctx.arc(ring.centre.x * k + ox, ring.centre.y * k + oy, ring.radius * k, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(199,162,86,.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ring.handle.x * k + ox, ring.handle.y * k + oy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#c7a256';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  // Top view: drag the house to move it (kept inside the lot), drag the gold handle to turn it (Shift snaps to 15 degrees); two fingers twist.
  // The 3D view follows live: each step replaces the previous one, so the whole drag is one undo step. Same moves as the 2D Move house tool.
  let miniT = null;
  let miniRot = 0;
  let mv = null; // the corner view (pan, zoom, rotate), attached below
  const ptrs = new Map();
  let md = null;
  const canvasPt = (e) => {
    // With the corner view moved, zoomed or turned the canvas is transformed, so go through the view's own inverse.
    const l = mv.toLocal(e.clientX, e.clientY);
    const sx = (l.x * cv.width) / Math.max(1, cv.offsetWidth) + cv.width / 2;
    const sy = (l.y * cv.height) / Math.max(1, cv.offsetHeight) + cv.height / 2;
    return miniT ? { sx, sy, x: (sx - miniT.ox) / miniT.k, y: (sy - miniT.oy) / miniT.k } : null;
  };
  const handleHit = (pt) => {
    const ring = ringOf(store.project, miniRot);
    if (!ring || !pt) return null;
    const hx = ring.handle.x * miniT.k + miniT.ox;
    const hy = ring.handle.y * miniT.k + miniT.oy;
    return Math.hypot(hx - pt.sx, hy - pt.sy) <= 14 ? ring : null;
  };
  const onHouseHull = (pt) => {
    if (onHouse(store.project, pt)) return true;
    const hull = buildingHull(store.project);
    return hull.length >= 3 && G.pointInPolygon(pt, hull);
  };
  const insideLot = (hull, boundary, dx, dy) => hull.every((q) => G.pointInPolygon({ x: q.x + dx, y: q.y + dy }, boundary));
  let flushT = 0;
  function applyDrag(final = false) {
    if (!md) return;
    const now = performance.now();
    if (!final && now - flushT < 70) { if (!md.raf) md.raf = setTimeout(() => { md && (md.raf = 0); applyDrag(); }, 70); return; }
    flushT = now;
    const key = md.mode === 'move' ? `${md.dx}|${md.dy}` : `${md.deg}`;
    if (key === md.key) return;
    md.key = key;
    if (md.applied) store.undo();
    md.applied = false;
    if (md.mode === 'move' ? (!md.dx && !md.dy) : !md.deg) return;
    if (md.mode === 'move') store.apply('Move house', (q) => { moveHouseBy(q, md.dx, md.dy, { quiet: !final }); });
    else store.apply('Rotate house', (q) => { turnHouseBy(q, md.deg, md.centre, { quiet: !final }); });
    md.applied = true;
  }
  function endDrag() {
    if (!md) return;
    clearTimeout(md.raf);
    applyDrag(true);
    if (md.mode !== 'move' && md.applied) miniRot = (((miniRot + md.deg) % 360) + 360) % 360;
    if (md.moved) suppressClick = true;
    if (md.applied) coach.did('move');
    md = null;
    schedule();
  }
  function beginTwist() {
    endDrag();
    const [a, b] = [...ptrs.values()];
    const ring = ringOf(store.project, miniRot);
    if (!ring) return;
    md = { mode: 'turn', centre: ring.centre, a0: (Math.atan2(b.sy - a.sy, b.sx - a.sx) * 180) / Math.PI, total: 0, prev: null, deg: 0, moved: true, twist: true, key: '', applied: false, raf: 0 };
  }
  mini.style.touchAction = 'none';
  mini.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !miniT || !canMoveHouse(store.project)) return;
    const pt = canvasPt(e);
    ptrs.set(e.pointerId, pt);
    if (ptrs.size > 1) return;
    const ring = handleHit(pt);
    if (ring) md = { mode: 'turn', centre: ring.centre, a0: (Math.atan2(pt.sy - (ring.centre.y * miniT.k + miniT.oy), pt.sx - (ring.centre.x * miniT.k + miniT.ox)) * 180) / Math.PI, total: 0, prev: null, deg: 0, moved: false, sx: pt.sx, sy: pt.sy, key: '', applied: false, raf: 0 };
    else if (onHouseHull(pt)) md = { mode: 'move', x0: pt.x, y0: pt.y, dx: 0, dy: 0, moved: false, sx: pt.sx, sy: pt.sy, hull: buildingHull(store.project), key: '', applied: false, raf: 0 };
    else return;
    try { mini.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    e.preventDefault();
  });
  mini.addEventListener('pointermove', (e) => {
    const pt = canvasPt(e);
    if (!pt) return;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, pt);
    if (!md) {
      if (canMoveHouse(store.project) && e.pointerType !== 'touch') mini.style.cursor = handleHit(pt) ? 'grab' : onHouseHull(pt) ? 'move' : '';
      return;
    }
    if (md.twist) {
      if (ptrs.size < 2) return;
      const [a, b] = [...ptrs.values()];
      let d = (Math.atan2(b.sy - a.sy, b.sx - a.sx) * 180) / Math.PI - md.a0;
      d = ((d + 540) % 360) - 180;
      md.total = md.prev == null ? d : md.total + (((d - md.prev + 540) % 360) - 180);
      md.prev = d;
      md.deg = turnAngle(md.total, false);
      applyDrag();
      return;
    }
    if (!md.moved) { if (Math.hypot(pt.sx - md.sx, pt.sy - md.sy) < 3) return; md.moved = true; mini.style.cursor = 'grabbing'; }
    if (md.mode === 'move') {
      const snap = (v) => Math.round(v / 50) * 50;
      const dx = snap(pt.x - md.x0);
      const dy = snap(pt.y - md.y0);
      const lot = lotOf(store.project);
      const b = lot?.boundary;
      const startsInside = !b || insideLot(md.hull, b, 0, 0);
      let nx = md.dx; let ny = md.dy;
      if (!b || !startsInside || insideLot(md.hull, b, dx, dy)) { nx = dx; ny = dy; }
      else if (insideLot(md.hull, b, dx, md.dy)) nx = dx;
      else if (insideLot(md.hull, b, md.dx, dy)) ny = dy;
      md.dx = nx; md.dy = ny;
    } else {
      const c = { x: md.centre.x * miniT.k + miniT.ox, y: md.centre.y * miniT.k + miniT.oy };
      let d = (Math.atan2(pt.sy - c.y, pt.sx - c.x) * 180) / Math.PI - md.a0;
      d = ((d + 540) % 360) - 180;
      md.total = md.prev == null ? d : md.total + (((d - md.prev + 540) % 360) - 180);
      md.prev = d;
      md.deg = turnAngle(md.total, e.shiftKey);
    }
    applyDrag();
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (!md || !(md.twist ? ptrs.size < 2 : true)) return; endDrag(); mini.style.cursor = ''; };
  mini.addEventListener('pointerup', up);
  mini.addEventListener('pointercancel', up);
  mv = attachMiniView({ mini, cv, north, northDeg: () => Number(store.project?.site?.northDeg) || 0, yielding: () => !!md }); // drag the map to pan, scroll to zoom, right-drag or twist to rotate


  // The camera frames the lot in the clear area: card on the left and minimap on the right when there is room, else the card height
  // at the bottom (phone width, where the card collapses to a title and the actions).
  function insetOver(target, els) {
    const vr = target.getBoundingClientRect();
    const inset = { left: 0, right: 0, bottom: 0, top: 0 };
    if (target.hidden || vr.width < 2 || vr.height < 2) return inset;
    for (const el of els) {
      if (el === head || el.hidden || getComputedStyle(el).display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vr.left || r.left >= vr.right || r.bottom <= vr.top || r.top >= vr.bottom) continue;
      if (el.classList.contains('ps-credit')) {
        // The Map data chip only lifts the bottom when it sits at the bottom; in the editor it sits at the top right and takes no room from the view.
        if ((r.top + r.bottom) / 2 - vr.top > vr.height / 2) inset.bottom = Math.max(inset.bottom, vr.bottom - r.top + 10);
        continue;
      }
      const cx = (r.left + r.right) / 2 - vr.left;
      const nearTop = (r.top + r.bottom) / 2 - vr.top < vr.height / 3; // by its middle: a tall card whose top edge is high is still a side card
      if (!nearTop && r.height < vr.height * 0.12 && r.width < vr.width * 0.4 && cx > vr.width * 0.3) { inset.bottom = Math.max(inset.bottom, vr.bottom - r.top + 8); continue; } // a low bar (the pager) only lifts the bottom, it does not take a column of the plan
      if (nearTop) inset.top = Math.max(inset.top, r.bottom - vr.top + 6);
      else if (cx < vr.width * 0.3 && r.width < vr.width * 0.6) inset.left = Math.max(inset.left, r.right - vr.left + 16);
      else if (cx > vr.width * 0.75 && r.width < vr.width * 0.4) inset.right = Math.max(inset.right, vr.right - r.left + 16);
      else inset.bottom = Math.max(inset.bottom, vr.bottom - r.top + 8);
    }
    // Compact and phone widths: a margin each side so the lot is not cut at the screen edge.
    if (root.classList.contains('is-compact')) { inset.left = Math.max(inset.left, 22); inset.right = Math.max(inset.right, 22); }
    return inset;
  }
  function sizeInset() {
    const v = getViewer();
    const ed = app().editor;
    if (root.hidden) { if (store.project.mode !== 'commercial') ed?.setInset?.({}); return; } // commercial mode: the dock and the strip set the plan inset
    root.style.setProperty('--lc-card-h', `${Math.round(card.getBoundingClientRect().height)}px`);
    const els = [card, rooms, pager, mini, head];
    // 3D: framed in what the cards leave clear. 2D and split: the plan is framed the same way, so the lot is not under the card.
    const credit = host.querySelector('.ps-credit');
    if (credit) els.push(credit);
    if (v?.setInset) v.setInset(root.dataset.view === '2d' ? {} : insetOver(viewerHost, els));
    const view = root.dataset.view;
    ed?.setInset?.(ed.element && (view === '2d' || view === 'split') ? insetOver(ed.element, els) : {});
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { layoutClasses(); sizeInset(); }) : null;
  ro?.observe(host);
  ro?.observe(viewerHost);
  layoutClasses();
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => schedule()) : null;
  mo?.observe(host, { childList: true });
  const offs = [store.on('project', schedule), store.on('ui', (patch = {}) => { schedule(); if ('view' in patch) setTimeout(sizeInset, 700); })];
  const onAerial = () => { selTab = 'aerial'; bedI = 0; schedule(); };
  window.addEventListener('ps:room-aerial', onAerial);
  schedule();
  return {
    el: root, render, step, setScheme, sitePlanPdf,
    /** Reload the designs (a sign-in finished after the card was drawn). */
    refresh() { designsKey = null; schedule(); },
    get designs() { return designs; },
    dispose() { disposed = true; window.removeEventListener('ps:room-aerial', onAerial); offs.forEach((o) => o?.()); fitCard.dispose(); coach.dispose(); topView.dispose(); aerialT.dispose(); ro?.disconnect(); mo?.disconnect(); root.remove(); },
  };
}
