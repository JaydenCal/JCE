// The phone house screen pieces, shared by the home page viewer (src/lotcard/lot-card.js) and the Place step of the simple phone path
// (src/flow/phone-simple.js), so a phone sees one layout wherever it meets a house on its lot:
//
//   top      a slim 4 step bar (Address, Pick, Place, Free plans), one slim pill with the address and the lot number, and a menu button
//   middle   the 3D view only
//   bottom   the house name, three 44 px buttons (Change home, Move, Rotate) and one full width gold "Get my free plans" button
//
// Phones only (a coarse pointer and a narrow window, see src/phone/mode.js). Colours are the website's navy and gold. No DOM is touched
// by the pure helpers (housePillText, lotNumber, shortAddress, stepBarModel, NOTICE_MS), which are unit tested.

import { h } from '../ui/dom.js';
import { ringOf } from '../editor2d/draw-lotplan.js';
import { turnHouseBy } from '../site/site-items.js';

/** The four phone steps, in order. The simple phone path and the house screen both light the one the person is on. */
export const HOUSE_STEPS = Object.freeze(['Address', 'Pick', 'Place', 'Free plans']);
/** Notices (Auto fit done, Undo) hide themselves after this long. */
export const NOTICE_MS = 3000;
/** The turn of one Rotate step, in degrees. */
export const ROTATE_STEP_DEG = 15;

/** The state of each of the four steps when the person is on step `current` (1 to 4). */
export const stepBarModel = (current) => HOUSE_STEPS.map((title, i) => ({ title, n: i + 1, state: i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'todo' }));

/** A slim 4 step progress bar (markup only; the guided flow draws its own with the same classes). */
export function createStepBar(current, { onGo = null } = {}) {
  const items = stepBarModel(current).map((s) => {
    const inner = [h('i', { class: 'ph-seg', 'aria-hidden': 'true' }), h('span', { class: 'ph-lbl' }, s.title)];
    const li = h('li', { dataset: { step: String(s.n), state: s.state }, ...(s.state === 'current' ? { 'aria-current': 'step' } : {}) },
      s.state === 'done' && onGo ? h('button', { type: 'button', 'aria-label': `Go back to step ${s.n}, ${s.title}`, onclick: () => onGo(s.n) }, ...inner) : h('span', null, ...inner));
    return li;
  });
  return h('ol', { class: 'ph-steps', 'aria-label': 'Progress', dataset: { ps: 'phone-steps' } }, ...items);
}

/** "9 Andrew Cl, Taree NSW 2430" becomes "9 Andrew Cl, Taree": the state and the postcode are left off. */
export function shortAddress(address) {
  return String(address || '').replace(/\s+/g, ' ').trim().replace(/[,\s]+(?:NSW|QLD|ACT|VIC|TAS|SA|WA|NT)?\s*\d{4}$/i, '').replace(/[,\s]+(?:NSW|QLD|ACT|VIC|TAS|SA|WA|NT)$/i, '').trim();
}

/** The lot number of a lot ("Lot 51 DP 123456" gives "51"), or '' when it has none (the sample lot). */
export function lotNumber(lot) {
  if (!lot) return '';
  const m = /\blot\s+([A-Za-z0-9]+)/i.exec(String(lot.lotLabel || ''));
  if (m) return m[1];
  const n = lot.lot ?? lot.lotNumber;
  return n != null && n !== '' ? String(n) : '';
}

/** The text of the slim pill: "9 Andrew Cl, Taree · Lot 51". The sample lot says so and gives its size. */
export function housePillText(lot) {
  if (!lot) return '';
  const sample = !!(lot.demo || lot.lotLabel === 'Sample lot');
  if (sample) return `Sample lot${lot.areaM2 ? ` · ${Math.round(lot.areaM2).toLocaleString('en-AU')} m²` : ''}`;
  const addr = shortAddress(lot.address);
  const n = lotNumber(lot);
  return [addr || (n ? '' : String(lot.lotLabel || '')), n ? `Lot ${n}` : ''].filter(Boolean).join(' · ');
}

/** Turn the placed house by `deg` about its own centre, as one undo step. Returns true when it turned. */
export function turnPlacedHouse(store, deg) {
  const ring = ringOf(store.project);
  if (!ring) return false;
  store.apply('Rotate house', (q) => { turnHouseBy(q, deg, ring.centre); });
  return true;
}

/**
 * The bottom bar: the house name, three 44 px buttons and the gold button.
 * Returns { el, setName(text), setBusy(bool), setMode('move' | 'rotate' | null), rotate } where `rotate` is the 15 degree strip that rides
 * above the bar while Rotate is on.
 */
export function createBottomBar({ onChange, onMove, onRotate, onTurn, onPlans, plansLabel = 'Get my free plans' }) {
  const nameEl = h('div', { class: 'ph-name', dataset: { ps: 'phone-house-name' } });
  const mk = (label, ps, fn) => h('button', { class: 'ph-btn', type: 'button', dataset: { ps }, onclick: () => fn?.() }, label);
  const bChange = mk('Change home', 'phone-change-home', onChange);
  const bMove = mk('Move', 'phone-move-house', onMove);
  const bRotate = mk('Rotate', 'phone-rotate-house', onRotate);
  bMove.setAttribute('aria-pressed', 'false');
  bRotate.setAttribute('aria-pressed', 'false');
  const plans = h('button', { class: 'ph-plans', type: 'button', dataset: { ps: 'phone-get-plans' }, onclick: () => onPlans?.() }, plansLabel);
  const left = h('button', { class: 'ph-turn', type: 'button', 'aria-label': `Rotate left ${ROTATE_STEP_DEG} degrees`, dataset: { ps: 'phone-rotate-left' }, onclick: () => onTurn?.(-ROTATE_STEP_DEG) }, `Left ${ROTATE_STEP_DEG}°`);
  const right = h('button', { class: 'ph-turn', type: 'button', 'aria-label': `Rotate right ${ROTATE_STEP_DEG} degrees`, dataset: { ps: 'phone-rotate-right' }, onclick: () => onTurn?.(ROTATE_STEP_DEG) }, `Right ${ROTATE_STEP_DEG}°`);
  const rotate = h('div', { class: 'ph-rotate', hidden: true, role: 'group', 'aria-label': 'Rotate the house', dataset: { ps: 'phone-rotate-strip' } }, left, right);
  const el = h('div', { class: 'ph-bar', dataset: { ps: 'phone-bar' } }, rotate, nameEl, h('div', { class: 'ph-row' }, bChange, bMove, bRotate), plans);
  return {
    el, rotate, plans,
    setName(t) { nameEl.textContent = t || ''; },
    setBusy(on) { for (const b of [bChange, bMove, bRotate, plans]) b.disabled = !!on; },
    setMode(m) {
      bMove.setAttribute('aria-pressed', String(m === 'move'));
      bRotate.setAttribute('aria-pressed', String(m === 'rotate'));
      rotate.hidden = m !== 'rotate';
    },
  };
}

/**
 * The menu list of the phone house screen. `parts` supplies what each entry does; entries with no handler are left out.
 *   aerial     { has: bool, on: bool, toggle() }       Aerial on or off
 *   upload     () => void                              Upload boundary
 *   rooms      [{ id, label }]  and  tour(id)          Room tour (the old room chips)
 *   northUp    () => void                              Compass: reset the view to the whole lot, north up
 *   extra      [[label, fn, ps?]]                      the viewer's other menu items (plan PDFs, the full editor ...)
 * Returns the rows as { label, hint?, ps, onClick, pressed?, rooms? } for the caller to draw (a bottom sheet).
 */
export function houseMenuModel(parts = {}) {
  const rows = [];
  if (parts.aerial) rows.push({ ps: 'phone-menu-aerial', label: `Aerial: ${parts.aerial.on ? 'On' : 'Off'}`, hint: parts.aerial.has ? 'Show or hide the aerial photo under the lot' : 'No aerial photo for this lot', pressed: !!parts.aerial.on, disabled: !parts.aerial.has, onClick: parts.aerial.toggle });
  if (parts.upload) rows.push({ ps: 'phone-menu-upload', label: 'Upload boundary', hint: 'Use your own lot boundary', onClick: parts.upload });
  if (parts.rooms?.length && parts.tour) rows.push({ ps: 'phone-menu-rooms', label: 'Room tour', hint: 'Look at the house from a room', rooms: parts.rooms, tour: parts.tour });
  if (parts.northUp) rows.push({ ps: 'phone-menu-north', label: 'Compass, north up', hint: 'Put the whole lot back in view, north at the top', onClick: parts.northUp });
  for (const [label, fn, ps] of parts.extra || []) rows.push({ ps: ps || `phone-menu-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label, onClick: fn });
  return rows;
}

/** Draw the menu model into a bottom sheet body. `close` closes the sheet; `openSheet` and `sheetButton` come from src/phone/sheet.js. */
export function houseMenuBody(rows, { sheetButton, close, concept = 'Concept only. Not for construction or approval.' }) {
  const kids = rows.map((r) => {
    if (r.rooms) {
      return h('div', { class: 'ph-menu-rooms', dataset: { ps: r.ps } }, h('b', null, r.label), h('div', { class: 'ph-chips' }, ...r.rooms.map((t) => h('button', { class: 'ph-chip', type: 'button', dataset: { ps: 'phone-room', room: t.id }, onclick: () => { close(); r.tour(t.id); } }, t.label))));
    }
    const b = sheetButton({ label: r.label, hint: r.hint || '', ps: r.ps, pressed: r.pressed ?? null, onClick: () => { close(); r.onClick?.(); } });
    if (r.disabled) b.disabled = true;
    return b;
  });
  return h('div', { class: 'ps-sheet-list ph-menu' }, ...kids, h('p', { class: 'ph-concept', dataset: { ps: 'phone-concept' } }, concept));
}

export const PHONE_HOUSE_CSS = `
/* The phone house screen (src/phone/house-ui.js): the website's navy and gold. */
html[data-phone="1"]{--ph-navy:#0a111e;--ph-navy-2:#121b2b;--ph-gold:#e9b66f;--ph-gold-2:#f3c98d;--ph-ink:#1c1407;--ph-on:#ffffff;--ph-on-2:#a9b3c4;--ph-line:rgba(255,255,255,.16)}
.ph-steps{display:flex;gap:6px;margin:0;padding:0;list-style:none;width:100%}
.ph-steps li{flex:1;min-width:0}
.ph-steps li>*{all:unset;display:flex;flex-direction:column;gap:3px;width:100%;box-sizing:border-box}
.ph-steps li button{cursor:pointer}
.ph-seg{display:block;height:4px;border-radius:2px;background:rgba(255,255,255,.2)}
.ph-lbl{font:600 10.5px/1.1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ph-on-2,#a9b3c4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ph-steps li[data-state="done"] .ph-seg{background:rgba(233,182,111,.55)}
.ph-steps li[data-state="current"] .ph-seg{background:var(--ph-gold,#e9b66f)}
.ph-steps li[data-state="current"] .ph-lbl{color:var(--ph-gold,#e9b66f)}
.ph-bar{position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--ph-navy-2,#121b2b);color:var(--ph-on,#fff);border-top:1px solid var(--ph-line);box-shadow:0 -8px 24px rgba(0,0,0,.35);font:14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.ph-bar *{box-sizing:border-box}
.ph-name{font:600 16px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ph-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.ph-bar .ph-btn{height:44px;min-height:44px;padding:0 6px;border-radius:12px;border:1px solid var(--ph-line);background:var(--ph-navy,#0a111e);color:var(--ph-on,#fff);font:600 14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ph-bar .ph-btn[aria-pressed="true"]{border-color:var(--ph-gold,#e9b66f);color:var(--ph-gold,#e9b66f);background:rgba(233,182,111,.12)}
.ph-bar .ph-btn:disabled,.ph-bar .ph-plans:disabled{opacity:.5}
.ph-bar .ph-plans{width:100%;height:52px;min-height:52px;border:0;border-radius:14px;background:var(--ph-gold,#e9b66f);color:var(--ph-ink,#1c1407);font:700 17px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer}
.ph-bar .ph-plans:active{background:var(--ph-gold-2,#f3c98d)}
.ph-bar button:focus-visible{outline:3px solid #fff;outline-offset:2px}
.ph-rotate{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ph-rotate[hidden]{display:none}
.ph-bar .ph-turn{height:44px;border-radius:12px;border:1px solid var(--ph-gold,#e9b66f);background:rgba(233,182,111,.12);color:var(--ph-gold,#e9b66f);font:700 15px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer}
.ph-pill{display:flex;align-items:center;gap:8px;height:40px;min-width:0;padding:0 14px;border-radius:20px;background:rgba(10,17,30,.88);border:1px solid var(--ph-line);color:var(--ph-on,#fff);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.ph-menu-btn{width:44px;height:44px;border-radius:22px;border:1px solid var(--ph-line);background:rgba(10,17,30,.88);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.ph-concept{margin:6px 2px 0;font-size:12px;color:var(--ph-on-2,#a9b3c4);text-align:center}
.ph-menu-rooms{display:flex;flex-direction:column;gap:8px;padding:10px 14px;border:1px solid var(--ps-border,#dcdde0);border-radius:12px}
.ph-chips{display:flex;flex-wrap:wrap;gap:8px}
.ph-chip{min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--ps-border,#dcdde0);background:transparent;color:inherit;font:600 14px system-ui,sans-serif;cursor:pointer}
/* The sheets that open from the phone house screen are navy too. */
html[data-phone="1"] .ps-sheet:has(.ph-menu){background:#121b2b;color:#fff}
html[data-phone="1"] .ps-sheet:has(.ph-menu) .ps-sheet-close{color:#e9b66f}
html[data-phone="1"] .ps-sheet:has(.ph-menu) .ps-sheet-item{background:#0a111e;color:#fff;border-color:rgba(255,255,255,.16)}
html[data-phone="1"] .ps-sheet:has(.ph-menu) .ps-sheet-item small{color:#a9b3c4}
html[data-phone="1"] .ps-sheet:has(.ph-menu) .ps-sheet-item[aria-pressed="true"]{border-color:#e9b66f;background:rgba(233,182,111,.14)}
html[data-phone="1"] .ps-sheet:has(.ph-menu) .ph-menu-rooms{border-color:rgba(255,255,255,.16);background:#0a111e}
html[data-phone="1"] .ps-sheet:has(.ph-menu) .ph-chip{border-color:rgba(255,255,255,.28)}
html[data-phone="1"] .ps-sheet:has(.ph-menu) .ph-chip:active{border-color:#e9b66f;color:#e9b66f}
`;

let injected = false;
/** Add the styles once (the phone house screen, wherever it is built). */
export function injectHouseCss() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const st = document.createElement('style');
  st.dataset.ps = 'phone-house-css';
  st.textContent = PHONE_HOUSE_CSS;
  document.head.append(st);
}

