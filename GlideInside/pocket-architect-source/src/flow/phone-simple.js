// The simple phone path of the Residential tool: four steps, one clear action each.
//
//   1 Address     type the address, the lot loads (the existing lot step, with its extras hidden)
//   2 Pick        big buttons, granny flats first (1 and 2 bedroom), then shed houses, then full houses (each maps to plans in the library)
//   3 Place       the pick is dropped in, auto fitted inside the setbacks (the existing fit logic), shown in 3D. The phone house screen
//                 (src/phone/house-ui.js): an address and lot pill with a menu on top, the 3D view, and a bottom bar with the house name,
//                 Change home (back to Pick), Move, Rotate and the gold "Get my free plans" button.
//   4 Free plans  a preview of their plan set (sheet 1 with their lot and house, marked Preview), one primary button (free for contact
//                 details while CONFIG.homeownerPlanSetFree is on), and Keep designing for free.
//
// It only runs on a phone (isPhoneMode). `withPhoneSteps` wraps the desktop steps so a desktop window keeps the existing steps, byte for
// byte: every step delegates to the desktop step unless the page is in phone mode when the step opens.

import { h } from '../ui/dom.js';
import { track } from '../ui/analytics.js';
import { toast } from '../ui/toast.js';
import { CONFIG } from '../config.js';
import { lotOf, translateHouse } from '../model/placement.js';
import { chooseDesign, placeChoice } from '../ui/embed-viewer.js';
import { rankFor } from '../lotcard/designs.js';
import { isPhoneMode } from '../phone/mode.js';
import { buildingHull } from '../site/lotplan.js';
import { mountLotStep } from './lot-step.js';
import { lotMapSvg, aerialOf } from './lot-map.js';
import { planWithHouseSvg } from './phone-plan.js';
import { mount3dPreview } from './preview3d.js';
import { ensureFlowAerial } from './flow-aerial.js';
import { placementStatus, nudgeHouse, previewCopy } from './res-logic.js';
import { createBottomBar, houseMenuModel, houseMenuBody, housePillText, turnPlacedHouse, injectHouseCss, NOTICE_MS } from '../phone/house-ui.js';
import { openSheet, sheetButton } from '../phone/sheet.js';
import { listRoomTabs } from '../viewer3d/rooms.js';
import { aerialOn, hasAerial, setAerial } from '../site/aerial-pref.js';
import { runUpload } from '../site/upload/flow.js';
import { writeFlow, flowOf } from './state.js';
import { GET_LABEL, QUOTE_LINE, CONCEPT_LINE, consentText, areaBuilderFor, TIMEFRAME_Q, TIMEFRAMES, OWNERSHIP_Q, OWNERSHIPS, PRIVACY_PATH, PRIVACY_LINE, leadProblems, rememberedLead, alreadyGave } from '../premium/free-planset.js';

// What the buttons start from. Every id is an existing template in the plan library (src/catalogue). The granny flats are the designs under
// the NSW 60 m2 secondary dwelling limit. Order on the Pick step (owner 25/11/2026): granny flats first (1 and 2 bedroom), then shed houses,
// then full houses. The order of ids is the order the designs are tried in.
export const PHONE_TYPES = Object.freeze({
  granny1: Object.freeze({ id: 'granny1', label: 'Granny flat, 1 bedroom', hint: 'Up to 60 m2, a small second home in the backyard', ids: Object.freeze(['granny_1bed', 'granny_studio']) }),
  granny2: Object.freeze({ id: 'granny2', label: 'Granny flat, 2 bedroom', hint: 'Up to 60 m2, room for two bedrooms', ids: Object.freeze(['granny_flat', 'granny_2bed_carport']) }),
  shed: Object.freeze({ id: 'shed', label: 'Shed house', hint: 'A shed with living quarters, or a workshop shed', ids: Object.freeze(['shed_house_barn', 'shed_workshop', 'shed_farm']) }),
  house: Object.freeze({ id: 'house', label: 'House', hint: 'A family home on the lot', ids: Object.freeze(['house_single', 'single_3bed_starter', 'narrow_14_3bed_media', 'narrow_125_4bed', 'narrow_10_3bed', 'narrow_double_4bed', 'house_double', 'townhouse_3bed']) }),
});
export const PHONE_TYPE_ORDER = Object.freeze(['granny1', 'granny2', 'shed', 'house']);
export const isPhoneType = (t) => Object.prototype.hasOwnProperty.call(PHONE_TYPES, t);

/** The designs of a type in the plan library, in cycle order, with the fit of each for the lot (when its setbacks are known). */
export function designsForType(catalogue, project, type) {
  const def = PHONE_TYPES[type];
  if (!def || !catalogue) return [];
  const out = [];
  for (const id of def.ids) {
    const t = catalogue.templates?.find((x) => x.id === id);
    if (!t) continue;
    let proj = null;
    try { proj = catalogue.createFromTemplate ? catalogue.createFromTemplate(id) : t.create?.(); } catch { proj = null; }
    if (proj?.levels?.length) out.push({ id, name: t.name || id, project: proj, group: 'public', ...(t.frontageM != null ? { frontageM: t.frontageM } : {}) });
  }
  return rankFor(project, out).sort((a, b) => def.ids.indexOf(a.id) - def.ids.indexOf(b.id)); // ranked for fit, then put back in cycle order
}

/** The type a placed design belongs to (by id), or null. */
export const typeOfDesign = (id) => PHONE_TYPE_ORDER.find((t) => PHONE_TYPES[t].ids.includes(id)) || null;

/** The design after `currentId` in the cycle of a type (wraps round). */
export function nextInCycle(type, currentId) {
  const ids = PHONE_TYPES[type]?.ids || [];
  if (!ids.length) return null;
  const i = ids.indexOf(currentId);
  return ids[(i + 1) % ids.length];
}

/**
 * Place a design of `type` on the lot, auto fitted: the first design that sits inside the setbacks (the one in `wantId` first).
 * Returns { design, fits } or null.
 */
export async function placeOfType(store, catalogue, type, { wantId = null } = {}) {
  const list = designsForType(catalogue, store.project, type);
  if (!list.length) return null;
  const choice = await chooseDesign(store, { list, own: false, empty: false }, wantId);
  if (!choice?.pick) return null;
  placeChoice(store, choice);
  return { design: choice.pick, fits: choice.fits, tooBig: !!store.project.placedHouse?.tooBig };
}

/** One short line for the status under the 3D view. */
export function fitLine(project) {
  const st = placementStatus(project);
  if (st.state === 'inside') return { ok: true, text: 'Fits inside your setbacks.' };
  if (st.state === 'outside') return { ok: false, text: 'A tight fit on this lot. Try another design, or move it.' };
  if (st.state === 'unknown') return { ok: null, text: 'Setbacks are not loaded, so the position is not checked.' };
  return { ok: null, text: '' };
}

/** The label of the buy button, from the same config the checkout dialog reads. */
export function buyLabel(config = CONFIG) {
  const price = Number(config?.planPack?.priceAud ?? 30);
  return `Download the plan set, A$${Number.isInteger(price) ? price : price.toFixed(2)}`;
}

// Phone editor state -----------------------------------------------------------------------------------------------------------
/** The simple editor: on a phone, after the four steps, until the person taps Open full editor. Stored on the design (project.flow). */
export const simpleEditorOn = (project, phone = isPhoneMode()) => !!phone && project?.flow?.phoneSimple === true;
export function openFullEditorOnPhone(store, from = 'fit') {
  track('phone_full_editor', { from });
  writeFlow(store, { phoneSimple: false });
}

// Steps -------------------------------------------------------------------------------------------------------------------------
const cleanType = (t) => (isPhoneType(t) ? t : null);
// While the simple path is on screen the save your design card is held back (one thing at a time). It comes back in the editor.
const hold = (on) => { try { document.documentElement.classList.toggle('gf-ps-active', !!on); } catch { /* no page */ } };

function mountAddress(ctx) {
  const { store } = ctx;
  writeFlow(store, { phoneSimple: true });
  track('phone_step_address', {});
  const inner = mountLotStep(ctx);
  const el = h('div', { class: 'gf-ps gf-ps-addr', dataset: { ps: 'phone-address' } }, inner.el);
  let told = null;
  const tell = () => {
    const lot = lotOf(store.project);
    if (!lot) { told = null; return; }
    const key = `${lot.lotLabel || ''}|${lot.origin?.e},${lot.origin?.n}`;
    if (told === key) return;
    told = key;
    track('phone_lot_loaded', { source: lot.lotLabel === 'Sample lot' ? 'sample' : 'address' });
  };
  const off = store.on('project', tell);
  tell();
  return { ...inner, el, dispose() { off?.(); inner.dispose?.(); } };
}

function mountPick(ctx) {
  const { store } = ctx;
  const pick = (type) => {
    track('phone_pick_type', { type });
    writeFlow(store, { phoneType: type });
    ctx.next();
  };
  const cur = cleanType(store.project.flow?.phoneType);
  const btn = (t) => h('button', { class: 'gf-ps-pick', type: 'button', 'aria-pressed': String(cur === t.id), dataset: { ps: 'phone-pick', type: t.id }, onclick: () => pick(t.id) },
    h('b', null, t.label), h('span', null, t.hint));
  const el = h('div', { class: 'gf-ps gf-ps-picks', dataset: { ps: 'phone-pick-list' } }, ...PHONE_TYPE_ORDER.map((id) => btn(PHONE_TYPES[id])));
  return { el, hideNext: true, canNext: () => false };
}

// The Place step is the phone house screen (src/phone/house-ui.js): the same layout as the home page viewer on a phone.
function mountFit(ctx, { catalogue }) {
  const { store } = ctx;
  const type = cleanType(store.project.flow?.phoneType) || 'house';
  hold(true);
  injectHouseCss();
  let disposed = false;
  let busy = false;
  let viewer = null;
  let moving = false;
  let rotating = false;
  let aerial = null;
  let drag = null;
  let refits = 0;
  let statusTimer = 0;
  const view = h('div', { class: 'gf-ps-3d', dataset: { ps: 'phone-3d' } });
  const planHost = h('div', { class: 'gf-ps-plan', hidden: true, dataset: { ps: 'phone-move-plan' } });
  const busyEl = h('div', { class: 'gf-ps-busy', role: 'status', dataset: { ps: 'phone-placing' } }, 'Placing it on your lot');
  const stage = h('div', { class: 'gf-ps-stage' }, view, planHost, busyEl);
  const statusEl = h('p', { class: 'ph-status', role: 'status', 'aria-live': 'polite', hidden: true, dataset: { ps: 'phone-fit-status' } });
  const bar = createBottomBar({
    onChange: () => ctx.go(2), // back to the Pick step, the lot stays
    onMove: () => setMoving(!moving),
    onRotate: () => setRotating(!rotating),
    onTurn: (d) => { if (!busy && turnPlacedHouse(store, d)) paint(); },
    onPlans: () => ctx.go(4),
  });
  const pillText = h('span', { class: 'gf-ps-pilltext' });
  const pill = h('button', { class: 'ph-pill gf-ps-pill', type: 'button', 'aria-label': 'Change the address', dataset: { ps: 'phone-pill' }, onclick: () => ctx.go(1) }, pillText);
  const menuBtn = h('button', { class: 'ph-menu-btn', type: 'button', 'aria-label': 'Menu', dataset: { ps: 'phone-house-menu-btn' }, onclick: () => openMenu(), html: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>' });
  const top = h('div', { class: 'ph-top', dataset: { ps: 'phone-top' } }, pill, menuBtn);
  const el = h('div', { class: 'gf-ps gf-ps-fit ph-screen', dataset: { ps: 'phone-fit' } }, stage, top, statusEl, bar.el);

  // The status line is a notice: it shows for 3 seconds (NOTICE_MS) above the bottom bar, then hides. A real problem (outside the setbacks) stays.
  function say(text, state) {
    statusEl.textContent = text || '';
    statusEl.dataset.state = state || 'none';
    clearTimeout(statusTimer);
    if (!text) { statusEl.hidden = true; return; }
    statusEl.hidden = false;
    if (state !== 'outside') statusTimer = setTimeout(() => { statusEl.hidden = true; }, NOTICE_MS);
  }

  function paint() {
    const ph = store.project.placedHouse;
    bar.setName(ph?.name || '');
    pillText.textContent = housePillText(lotOf(store.project));
    const f = fitLine(store.project);
    if (moving) say(f.ok === false ? 'Too close to the boundary. Drag it back inside the green area.' : 'Drag the house to move it.', f.ok === false ? 'outside' : 'inside');
    else say(f.text, f.ok === true ? 'inside' : f.ok === false ? 'outside' : 'none');
    bar.setBusy(busy);
    bar.setMode(moving ? 'move' : rotating ? 'rotate' : null);
    ctx.refresh();
  }

  function setRotating(on) {
    rotating = !!on;
    if (rotating && moving) setMoving(false);
    bar.setMode(moving ? 'move' : rotating ? 'rotate' : null);
    sizeBar();
  }

  function openMenu() {
    const tabs = (() => { try { return listRoomTabs(store.project, null, { groupBedrooms: true }); } catch { return []; } })();
    const rows = houseMenuModel({
      aerial: { has: hasAerial(store.project), on: aerialOn(store.project), toggle: () => setAerial(store, !aerialOn(store.project)) },
      upload: () => runUpload(store, { catalogue }),
      rooms: tabs.filter((t) => t.id !== 'aerial').map((t) => ({ id: t.id, label: t.label })),
      tour: (id) => { try { viewer?.snapToRoom?.(id, { duration: 1.1 }); } catch { /* the viewer keeps its view */ } },
      northUp: () => { try { viewer?.snapToRoom?.('aerial', { duration: 1.1, site: true }); } catch { /* the viewer keeps its view */ } },
      extra: [['Open full editor', () => goFull(), 'phone-full-editor']],
    });
    let sheet = null;
    sheet = openSheet({ title: 'Menu', id: 'phone-house-menu', body: houseMenuBody(rows, { sheetButton, close: () => sheet?.close(), concept: CONCEPT_LINE }) });
  }

  // Move: the lot plan with the house on it, drag the house. Snaps to 50 mm on release; the status line says when it is too close.
  const drawPlan = (project) => { planHost.innerHTML = planWithHouseSvg(project, { aerial }); };
  function setMoving(on) {
    moving = !!on;
    if (moving && rotating) rotating = false;
    view.hidden = moving;
    planHost.hidden = !moving;
    if (moving) drawPlan(store.project);
    else { try { viewer?.setActive?.(true); } catch { /* none */ } }
    paint();
    sizeBar();
  }
  const toMm = (svg, ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const m = svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
  planHost.addEventListener('pointerdown', (ev) => {
    const svg = planHost.querySelector('svg');
    if (!svg || !moving || busy) return;
    ev.preventDefault();
    try { planHost.setPointerCapture(ev.pointerId); } catch { /* no capture */ }
    drag = { svg, start: toMm(svg, ev), dx: 0, dy: 0, raf: 0 };
  });
  planHost.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = toMm(drag.svg, ev);
    drag.dx = Math.round((p.x - drag.start.x) / 50) * 50;
    drag.dy = Math.round((p.y - drag.start.y) / 50) * 50;
    if (drag.raf) return;
    drag.raf = requestAnimationFrame(() => {
      if (!drag) return;
      drag.raf = 0;
      const prev = previewCopy(store.project);
      translateHouse(prev, drag.dx, drag.dy);
      drawPlan(prev);
      drag.svg = planHost.querySelector('svg') || drag.svg;
    });
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.dx || d.dy) nudgeHouse(store, d.dx, d.dy); else drawPlan(store.project);
  };
  planHost.addEventListener('pointerup', endDrag);
  planHost.addEventListener('pointercancel', endDrag);

  // The bar's height is published so the notices and the Map data chip sit above it, never over it.
  function sizeBar() {
    try { const bh = Math.round(bar.el.getBoundingClientRect().height); if (bh) el.style.setProperty('--ph-bar-h', `${bh}px`); } catch { /* not laid out */ }
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sizeBar) : null;
  ro?.observe(bar.el);

  async function goFull() {
    openFullEditorOnPhone(store, 'fit');
    await ctx.flow.editor();
  }

  const off = store.on('project', (e) => {
    if (disposed) return;
    // Setbacks that arrive late (the design's own storeys change the council envelope): a home nobody moved is fitted again.
    if (e?.label === 'setbacks' && !busy && !moving && placementStatus(store.project).state === 'outside' && refits < 2) { refits += 1; refit(); return; }
    paint();
    if (moving && !drag) drawPlan(store.project);
  });
  async function refit() {
    busy = true; stage.append(busyEl); paint();
    try { await placeOfType(store, catalogue, type, { wantId: store.project.placedHouse?.id || null }); } finally { busy = false; busyEl.remove(); }
    if (!disposed) paint();
  }

  return {
    el,
    hideNext: true,
    canNext: () => !busy && !!lotOf(store.project) && !!store.project.placedHouse,
    async onEnter() {
      const lot = lotOf(store.project);
      if (!lot) return;
      writeFlow(store, { phoneSimple: true });
      const placed = store.project.placedHouse;
      const keep = placed && PHONE_TYPES[type].ids.includes(placed.id) && buildingHull(store.project).length;
      if (!keep) {
        busy = true; stage.append(busyEl); paint();
        try {
          const r = await placeOfType(store, catalogue, type, { wantId: flowOf(store.project)?.designId || null });
          if (r) {
            writeFlow(store, { designId: r.design.id });
            track('phone_house_placed', { type, fits: r.fits === true ? 'yes' : r.fits === false ? 'no' : 'unknown' });
          }
        } catch (e) { console.warn('[phone] place failed', e); } finally { busy = false; busyEl.remove(); }
      }
      if (disposed) return;
      paint();
      sizeBar();
      (async () => { try { aerial = await aerialOf(lotOf(store.project)); if (!aerial) { await ensureFlowAerial(store); aerial = await aerialOf(lotOf(store.project)); } } catch { aerial = null; } })();
      viewer = await mount3dPreview(view, store, catalogue);
      if (disposed) { viewer?.dispose?.(); viewer = null; return; }
    },
    dispose() { disposed = true; hold(false); clearTimeout(statusTimer); ro?.disconnect(); off?.(); try { viewer?.dispose?.(); } catch { /* gone */ } },
  };
}

/** The sheet 1 preview, as markup: their lot and house on a drawing sheet, with a Preview watermark. Vector, so it stays sharp. */
export function planSheetPreview(project, { aerial = null } = {}) {
  const lot = lotOf(project);
  const name = project.placedHouse?.name || project.name || 'Your design';
  const address = lot?.address || lot?.lotLabel || '';
  const plan = planWithHouseSvg(project, { aerial }) || lotMapSvg(project, { aerial }) || '';
  return h('div', { class: 'gf-ps-sheet', role: 'img', 'aria-label': `Preview of sheet 1 of your plan set: ${name}${address ? `, ${address}` : ''}`, dataset: { ps: 'phone-sheet' } },
    h('div', { class: 'gf-ps-sheet-plan', html: plan }),
    h('div', { class: 'gf-ps-sheet-tb' }, h('b', null, 'Site plan'), h('span', null, name), address ? h('span', null, address) : null, h('span', null, 'Sheet 1')),
    h('div', { class: 'gf-ps-mark', 'aria-hidden': 'true' }, ...Array.from({ length: 6 }, () => h('span', null, 'Preview'))));
}

function mountPlans(ctx) {
  const { store } = ctx;
  hold(true);
  let disposed = false;
  let aerial = null;
  let busy = false;
  const prem = () => (typeof window !== 'undefined' ? window.__ps?.premium : null);
  // Homeowner plan sets are free for contact details while CONFIG.homeownerPlanSetFree is on; off, the button is the Plan Pack checkout again.
  const isFree = () => { const p = prem(); return p?.planSetFree ? !!p.planSetFree() : !!CONFIG.homeownerPlanSetFree; };
  const holder = h('div', { class: 'gf-ps-sheetwrap' });
  const paintSheet = () => holder.replaceChildren(planSheetPreview(store.project, { aerial }));
  paintSheet();
  const buy = h('button', { class: 'gf-btn gf-btn--primary gf-ps-buy', type: 'button', dataset: { ps: 'phone-buy' }, onclick: () => onBuy() }, isFree() ? GET_LABEL : buyLabel());
  const free = h('button', { class: 'gf-btn gf-ps-free', type: 'button', dataset: { ps: 'phone-free' }, onclick: () => ctx.flow.editor() }, 'Keep designing for free');
  const note = h('p', { class: 'gf-note gf-ps-note' }, CONCEPT_LINE);

  // The short form: name, email, suburb and the consent tick. It opens under the primary button; submitting saves the lead, then downloads.
  const mem = rememberedLead() || {};
  const input = (name, label, attrs = {}) => {
    const i = h('input', { id: `gfps-${name}`, type: attrs.type || 'text', autocomplete: attrs.autocomplete || 'off', maxlength: '120', value: mem[name] || '', required: true, dataset: { ps: `phone-lead-${name}` } });
    return { i, row: h('div', { class: 'gf-ps-field' }, h('label', { for: `gfps-${name}` }, label), i) };
  };
  const f = { name: input('name', 'Your name', { autocomplete: 'name' }), email: input('email', 'Email', { type: 'email', autocomplete: 'email' }), suburb: input('suburb', 'Suburb', { autocomplete: 'address-level2' }) };
  // Two short required questions as big tap chips (one screen on a phone).
  const chips = (name, question, opts) => {
    const radios = opts.map(([v, label]) => h('label', { class: 'gf-ps-chip2' }, h('input', { type: 'radio', name: `gfps-${name}`, value: v, dataset: { ps: `phone-lead-${name}` } }), h('span', null, label)));
    return { get value() { return radios.map((r) => r.firstChild).find((i) => i.checked)?.value || ''; }, row: h('fieldset', { class: 'gf-ps-q' }, h('legend', null, question), h('div', { class: 'gf-ps-chips' }, ...radios)) };
  };
  const timeframe = chips('timeframe', TIMEFRAME_Q, TIMEFRAMES);
  const ownership = chips('ownership', OWNERSHIP_Q, OWNERSHIPS);
  const builder = null; // no builder is named: leads are not forwarded to builders yet
  const shownConsent = consentText(builder);
  const consent = h('input', { type: 'checkbox', id: 'gfps-consent', dataset: { ps: 'phone-lead-consent' } });
  const err = h('p', { class: 'gf-note gf-note--bad', role: 'alert', hidden: true, dataset: { ps: 'phone-lead-error' } });
  const submit = h('button', { class: 'gf-btn gf-btn--primary gf-ps-buy', type: 'submit', dataset: { ps: 'phone-lead-submit' } }, GET_LABEL);
  const form = h('form', { class: 'gf-ps-form', hidden: true, novalidate: true, dataset: { ps: 'phone-lead-form' } },
    f.name.row, f.email.row, f.suburb.row, timeframe.row, ownership.row,
    h('label', { class: 'gf-ps-consent' }, consent, h('span', { dataset: { ps: 'phone-consent-text' } }, shownConsent)), err, submit,
    h('p', { class: 'gf-note', style: { margin: '0 0 6px' }, dataset: { ps: 'phone-no-email' } }, 'Nothing is emailed to you.'),
    h('p', { class: 'gf-note gf-ps-privacy', style: { margin: '0' } }, PRIVACY_LINE, ' ', h('a', { href: PRIVACY_PATH, target: '_blank', rel: 'noopener', dataset: { ps: 'phone-privacy' } }, 'Privacy policy')));
  const done = h('div', { class: 'gf-card gf-ps-done', hidden: true, role: 'status', dataset: { ps: 'phone-planset-done' } });
  const el = h('div', { class: 'gf-ps gf-ps-plans', dataset: { ps: 'phone-plans' } }, holder, buy, form, done, free, note);

  async function onBuy() {
    if (!isFree()) { startCheckout(); return; }
    const p = prem();
    if (!p) { toast('Not ready yet. Try again in a moment, or keep designing for free.', { kind: 'info', timeout: 6000 }); return; }
    if (p.isEntitled?.() || alreadyGave(store.project?.id)) { // a Plan Pack, or details already given for this design: straight to the download
      const r = p.isEntitled?.() ? p.openExports?.() : await p.exportAs?.('pdf');
      void r;
      return;
    }
    buy.hidden = true; form.hidden = false; el.classList.add('is-form'); // the form takes the screen: the sheet preview steps aside
    try { (f.name.i.value ? f.suburb.i.value ? consent : f.suburb.i : f.name.i).focus({ preventScroll: false }); } catch { /* no focus */ }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const lead = { name: f.name.i.value, email: f.email.i.value, suburb: f.suburb.i.value, timeframe: timeframe.value, ownership: ownership.value, designType: cleanType(store.project.flow?.phoneType) || typeOfDesign(store.project.placedHouse?.id) || '', consentText: shownConsent, builder, consent: consent.checked, surface: 'phone' };
    const bad = leadProblems(lead);
    err.hidden = !bad.length; err.textContent = bad[0]?.message || '';
    if (bad.length) return;
    busy = true; submit.disabled = true; submit.textContent = 'Preparing your plan set';
    try {
      const pm = prem();
      if (!pm?.submitFreePlanSet) throw new Error('The plan set is not ready yet. Try again in a moment.');
      const out = await pm.submitFreePlanSet(lead);
      form.hidden = true; done.hidden = false; el.classList.remove('is-form');
      done.replaceChildren(
        h('b', null, 'Your plan set has downloaded.'), out?.filename ? h('span', { class: 'gf-note', style: { display: 'block' } }, out.filename) : null,
        h('button', { class: 'gf-ps-link gf-ps-quote', type: 'button', dataset: { ps: 'phone-quote' }, onclick: () => prem()?.openOrderEngineering?.() }, QUOTE_LINE));
    } catch (e2) {
      err.hidden = false; err.textContent = e2?.message || 'That did not work. Try again.';
      submit.disabled = false; submit.textContent = GET_LABEL;
    } finally { busy = false; }
  });

  // The Plan Pack checkout, used when the free plan set is switched off: the Plan Pack dialog (ps_upgrade_click), the terms tick, then the secure checkout.
  function startCheckout() {
    const p = prem();
    if (!p) { toast('Checkout is not ready yet. Try again in a moment, or keep designing for free.', { kind: 'info', timeout: 6000 }); return; }
    if (p.isEntitled?.()) { p.openExports?.(); return; }
    p.openUpgrade({ source: 'phone-planset' });
  }

  return {
    el,
    hideNext: true,
    canNext: () => false,
    async onEnter() {
      writeFlow(store, { phoneSimple: true });
      track('phone_planset_preview', { type: cleanType(store.project.flow?.phoneType) || typeOfDesign(store.project.placedHouse?.id) || 'unknown' });
      try {
        aerial = await aerialOf(lotOf(store.project));
        if (!aerial) { await ensureFlowAerial(store); aerial = await aerialOf(lotOf(store.project)); }
      } catch { aerial = null; }
      if (!disposed && aerial) paintSheet();
      try {
        const p = prem();
        if (p?.isEntitled?.()) buy.textContent = 'Download the plan set';
        else buy.textContent = isFree() ? GET_LABEL : buyLabel();
      } catch { /* keep the label */ }
    },
    dispose() { disposed = true; hold(false); },
  };
}

/** The four phone steps (Address, Pick, Place, Free plans), in the same slots (lot, home, place, check) as the desktop steps. */
export function phoneStepDefs({ catalogue, store }) {
  void store;
  return [
    { title: 'Address', intro: 'Type the street address of the lot.', mount: (ctx) => mountAddress(ctx) },
    { title: 'Pick', intro: 'What do you want to add?', mount: (ctx) => mountPick(ctx) },
    { title: 'Place', intro: '', mount: (ctx) => mountFit(ctx, { catalogue }) },
    { title: 'Free plans', intro: '', mount: (ctx) => mountPlans(ctx) },
  ];
}

/** The desktop steps, each handing over to its phone step when the page is in phone mode as the step opens. Desktop is untouched. */
export function withPhoneSteps(desktop, { catalogue, store }) {
  const simpleOn = () => isPhoneMode() && CONFIG.phoneSimple !== false;
  const phone = phoneStepDefs({ catalogue, store });
  return desktop.map((d, i) => ({
    id: d.id,
    get title() { return simpleOn() && phone[i] ? phone[i].title : d.title; },
    get intro() { return simpleOn() && phone[i] ? phone[i].intro : d.intro; },
    mount: (ctx) => (simpleOn() && phone[i] ? phone[i].mount(ctx) : d.mount(ctx)),
  }));
}
