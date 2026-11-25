// Granny flat design with typed sizes (phones and desktop). A drawing of the rooms with boxes for the overall width and length in metres,
// the size of the tapped room, Add room presets and live checks (floor area against 60 m2, rooms below a usable size). The sizes go through
// src/model/granny-sizes.js, which uses the model's own wall and room operations. On a phone the keypad is the decimal one and each box is 44 px;
// on a desktop the boxes sit beside the drawing and dragging a room's east or south edge still resizes it.

import { h } from './dom.js';
import { openModal } from './modal.js';
import * as G from '../model/geometry.js';
import { ROOM_PRESETS, GRANNY_MAX_M2, overallOf, roomsOf, floorAreaM2, checkDesign, planOverall, setOverall, planRoomSize, setRoomSize, addPresetRoom, mmFromMetres, metresText } from '../model/granny-sizes.js';
import { isPhoneMode } from '../phone/mode.js';

const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'gd-style';
const CSS = `
.gd{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,1fr);gap:16px;align-items:start;font-family:var(--ps-font-ui,system-ui,sans-serif);color:var(--ps-text,#1c2430)}
.gd-draw{background:var(--ps-bg,#eef1f4);border:1px solid var(--ps-border,#cfd6de);border-radius:12px;padding:8px;min-width:0}
.gd-svg{display:block;width:100%;height:auto;max-height:60vh;touch-action:none;user-select:none;-webkit-user-select:none}
.gd-room{cursor:pointer}.gd-room polygon{stroke:#2c2f36;stroke-width:30;fill:#f4efe4}.gd-room.is-out polygon{fill:rgba(120,170,110,.45)}
.gd-room.is-sel polygon{fill:#f3e3b9;stroke:#a9842f;stroke-width:60}.gd-room.is-warn polygon{fill:#f6d5cf}
.gd-room text{font:600 260px system-ui,sans-serif;fill:#1c2430;pointer-events:none;text-anchor:middle}.gd-room text.gd-dim{font-weight:400;font-size:220px;fill:#4b5565}
.gd-edge{fill:transparent;stroke:#a9842f;stroke-width:0}.gd-edge.is-on{stroke-width:90}
.gd-side{display:flex;flex-direction:column;gap:12px;min-width:0}
.gd-sec{display:flex;flex-direction:column;gap:8px}.gd-sec h3{margin:0;font-size:15px;font-weight:700}
.gd-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.gd-f{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--ps-muted,#5a6575);flex:1 1 110px;min-width:96px}
.gd-f input{box-sizing:border-box;width:100%;min-height:44px;padding:0 12px;border:1px solid var(--ps-border-strong,#9aa5b4);border-radius:10px;font:600 17px var(--ps-font-ui,system-ui,sans-serif);background:#fff;color:#1c2430}
.gd-f input[aria-invalid="true"]{border-color:#c0392b}
.gd-area{padding:10px 12px;border-radius:10px;background:var(--ps-accent-soft,#e8f0fb);font-weight:700;font-size:15px}
.gd-area.is-over{background:#fbe3df;color:#8a1f12}
.gd-warns{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}.gd-warns li{padding:8px 10px;border-radius:10px;background:#fff4d6;color:#5b4300;font-size:13px;line-height:1.35}
.gd-err{margin:0;padding:8px 10px;border-radius:10px;background:#fbe3df;color:#8a1f12;font-size:13px}.gd-err[hidden]{display:none}
.gd-chips{display:flex;flex-wrap:wrap;gap:8px}
.gd-chip{min-height:44px;padding:0 14px;border:1px solid var(--ps-border-strong,#9aa5b4);border-radius:999px;background:var(--ps-panel,#fff);color:inherit;font:600 14px var(--ps-font-ui,system-ui,sans-serif)}
.gd-chip[aria-pressed="true"]{border-color:var(--ps-accent,#1f6feb);background:var(--ps-accent-soft,#e8f0fb);color:var(--ps-accent,#1f6feb)}
.gd-btn{min-height:44px;padding:0 16px;border:1px solid var(--ps-accent,#1f6feb);border-radius:10px;background:var(--ps-accent,#1f6feb);color:#fff;font:700 15px var(--ps-font-ui,system-ui,sans-serif)}
.gd-note{margin:0;font-size:12px;color:var(--ps-muted,#5a6575)}
@media (max-width:760px){.gd{grid-template-columns:minmax(0,1fr)}.gd-svg{max-height:34vh}}
`;

const fmtM = (mm) => `${(mm / 1000).toFixed(1)} m`;
const area1 = (m2) => `${m2.toFixed(1)} m2`;

/** The drawing: rooms as polygons with names and typed sizes. `sel` is the selected room id. */
export function drawingSvg(project, { sel = null, warnRooms = [] } = {}) {
  const rooms = roomsOf(project);
  const ground = [...(project.levels || [])].sort((a, b) => (a.elevation || 0) - (b.elevation || 0))[0];
  const polys = new Map((ground?.rooms || []).map((r) => [r.id, r.polygon]));
  const all = [...polys.values()].flat();
  const b = all.length ? G.bbox(all) : { minX: 0, minY: 0, maxX: 6000, maxY: 6000 };
  const pad = 600;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'gd-svg');
  svg.setAttribute('viewBox', `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Plan of the granny flat. Tap a room to type its size.');
  for (const r of rooms) {
    const poly = polys.get(r.id);
    if (!poly) continue;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `gd-room${r.outdoor ? ' is-out' : ''}${r.id === sel ? ' is-sel' : ''}${warnRooms.includes(r.id) ? ' is-warn' : ''}`);
    g.dataset.room = r.id;
    g.dataset.ps = 'gd-room';
    const pg = document.createElementNS(NS, 'polygon');
    pg.setAttribute('points', poly.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '));
    g.append(pg);
    const c = G.polygonCentroid(poly);
    const t1 = document.createElementNS(NS, 'text'); t1.setAttribute('x', Math.round(c.x)); t1.setAttribute('y', Math.round(c.y) - 40); t1.textContent = r.name;
    const t2 = document.createElementNS(NS, 'text'); t2.setAttribute('class', 'gd-dim'); t2.setAttribute('x', Math.round(c.x)); t2.setAttribute('y', Math.round(c.y) + 240); t2.textContent = `${(r.width / 1000).toFixed(1)} x ${(r.depth / 1000).toFixed(1)}`;
    g.append(t1, t2);
    svg.append(g);
  }
  return svg;
}

/**
 * Open the designer on the store's current design. Resolves nothing; each change is one undo step on the store.
 * `host` is for tests (a container to render into instead of a modal).
 */
export function openGrannyDesigner({ store, host = null } = {}) {
  if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st); }
  let sel = null;
  let preview = null; // a project copy while a value is being typed or an edge dragged
  let presetId = ROOM_PRESETS[0].id;
  const proj = () => preview || store.project;

  const err = h('p', { class: 'gd-err', role: 'alert', hidden: true, dataset: { ps: 'gd-error' } });
  const showErr = (t) => { err.textContent = t || ''; err.hidden = !t; };
  const num = (ps, label, value, onType, onCommit) => {
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', value: metresText(value), 'aria-label': label, dataset: { ps } });
    input.addEventListener('input', () => onType(input));
    input.addEventListener('change', () => onCommit(input));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } }); // blur fires the change event once, so a value is applied once
    input.addEventListener('focus', () => { try { input.select(); } catch { /* none */ } });
    return h('label', { class: 'gd-f' }, h('span', null, label), input);
  };

  const drawHost = h('div', { class: 'gd-draw', dataset: { ps: 'gd-draw' } });
  const side = h('div', { class: 'gd-side', dataset: { ps: 'gd-side' } });
  const root = h('div', { class: 'gd', dataset: { ps: 'granny-designer' } }, drawHost, side);

  const finish = (fn, label) => {
    try { store.apply(label, fn); showErr(''); } catch (e) { showErr(e.message || 'That change could not be made.'); }
    preview = null;
    paint();
  };

  function livePreview(planFn) {
    const r = planFn();
    if (!r.ok) { showErr(r.error); preview = null; paintDrawing(); return; }
    showErr('');
    preview = r.result;
    paintDrawing(); paintChecks();
  }

  function paintDrawing() {
    const p = proj();
    const chk = checkDesign(p);
    const svg = drawingSvg(p, { sel, warnRooms: chk.rooms.map((r) => r.id) });
    drawHost.replaceChildren(svg);
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('click', (e) => { const g = e.target.closest?.('[data-room]'); if (g && !dragged) { sel = g.dataset.room; preview = null; paint(); } });
  }

  // Dragging: a room's east or south edge, from inside the last 18 per cent of the room, resizes it in 100 mm steps (desktop and phone).
  let drag = null; let dragged = false;
  function onDown(e) {
    const g = e.target.closest?.('[data-room]');
    dragged = false;
    if (!g || g.dataset.room !== sel) return;
    const svg = e.currentTarget;
    const r = roomsOf(store.project).find((x) => x.id === sel);
    const m = svg.getScreenCTM();
    if (!r || !m) return;
    const toMm = (ev) => { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(m.inverse()); };
    const p0 = toMm(e);
    const nearEast = p0.x > r.x + r.width * 0.82;
    const nearSouth = p0.y > r.y + r.depth * 0.82;
    if (!nearEast && !nearSouth) return;
    drag = { toMm, p0, r, nearEast, nearSouth };
    try { svg.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp, { once: true });
    svg.addEventListener('pointercancel', onUp, { once: true });
  }
  function onMove(e) {
    if (!drag) return;
    const p = drag.toMm(e);
    const dx = p.x - drag.p0.x; const dy = p.y - drag.p0.y;
    if (!dragged && Math.hypot(dx, dy) < 120) return;
    dragged = true;
    const width = drag.nearEast ? Math.max(500, Math.round((drag.r.width + dx) / 100) * 100) : drag.r.width;
    const depth = drag.nearSouth ? Math.max(500, Math.round((drag.r.depth + dy) / 100) * 100) : drag.r.depth;
    drag.size = { width, depth };
    const r = planRoomSize(store.project, sel, { width, depth });
    if (r.ok) { preview = r.result; showErr(''); paintDrawingKeep(); paintChecks(); } else showErr(r.error);
  }
  function paintDrawingKeep() { // redraw without replacing the node under the pointer capture
    const svg = drawHost.querySelector('svg');
    const fresh = drawingSvg(proj(), { sel, warnRooms: checkDesign(proj()).rooms.map((r) => r.id) });
    svg.setAttribute('viewBox', fresh.getAttribute('viewBox'));
    svg.replaceChildren(...[...fresh.childNodes]);
  }
  function onUp() {
    const d = drag; drag = null;
    const svg = drawHost.querySelector('svg');
    svg?.removeEventListener('pointermove', onMove);
    if (d?.size && dragged) finish((p) => setRoomSize(p, sel, d.size), 'Resize room'); else { preview = null; paint(); }
    setTimeout(() => { dragged = false; }, 0);
  }

  let areaEl; let warnEl;
  function paintChecks() {
    const p = proj();
    const chk = checkDesign(p);
    if (areaEl) {
      areaEl.textContent = `Floor area ${area1(chk.areaM2)} of ${GRANNY_MAX_M2} m2`;
      areaEl.classList.toggle('is-over', chk.overArea);
      areaEl.dataset.over = String(chk.overArea);
    }
    if (warnEl) warnEl.replaceChildren(...chk.warnings.map((w) => h('li', { dataset: { ps: 'gd-warning' } }, w)));
  }

  function paintSide() {
    const o = overallOf(store.project);
    const rooms = roomsOf(store.project);
    areaEl = h('div', { class: 'gd-area', role: 'status', 'aria-live': 'polite', dataset: { ps: 'gd-area' } });
    warnEl = h('ul', { class: 'gd-warns', dataset: { ps: 'gd-warnings' } });
    const ow = o ? num('gd-width', 'Overall width (m)', o.width, () => {
      const w = mmFromMetres(ow.querySelector('input').value); const l = mmFromMetres(ol.querySelector('input').value);
      if (w && l) livePreview(() => planOverall(store.project, { width: w, length: l }));
    }, () => {
      const w = mmFromMetres(ow.querySelector('input').value); const l = mmFromMetres(ol.querySelector('input').value);
      if (!w || !l) { showErr('Type the size in metres, for example 6.0.'); return; }
      finish((p) => setOverall(p, { width: w, length: l }), 'Resize outline');
    }) : null;
    const ol = o ? num('gd-length', 'Overall length (m)', o.length, () => ow.querySelector('input').dispatchEvent(new Event('input')), () => ow.querySelector('input').dispatchEvent(new Event('change'))) : null;
    const selRoom = rooms.find((r) => r.id === sel);
    let roomSec = null;
    if (selRoom) {
      const rw = num('gd-room-width', 'Width (m)', selRoom.width, () => typeRoom(), () => commitRoom());
      const rd = num('gd-room-length', 'Length (m)', selRoom.depth, () => typeRoom(), () => commitRoom());
      const read = () => ({ width: mmFromMetres(rw.querySelector('input').value), depth: mmFromMetres(rd.querySelector('input').value) });
      function typeRoom() { const s = read(); if (s.width && s.depth) livePreview(() => planRoomSize(store.project, sel, s)); }
      function commitRoom() { const s = read(); if (!s.width || !s.depth) { showErr('Type the size in metres, for example 3.0.'); return; } finish((p) => setRoomSize(p, sel, s), 'Resize room'); }
      roomSec = h('div', { class: 'gd-sec', dataset: { ps: 'gd-room-sec' } }, h('h3', null, selRoom.name), h('div', { class: 'gd-row' }, rw, rd), h('p', { class: 'gd-note' }, 'The walls this room shares with its neighbours move with it, so they adjust.'));
    }
    const preset = ROOM_PRESETS.find((x) => x.id === presetId);
    const aw = num('gd-add-width', 'New room width (m)', preset.width, () => {}, () => {});
    const ad = num('gd-add-length', 'New room length (m)', preset.depth, () => {}, () => {});
    const chips = h('div', { class: 'gd-chips', role: 'group', 'aria-label': 'Room type' }, ...ROOM_PRESETS.map((x) => h('button', { class: 'gd-chip', type: 'button', 'aria-pressed': String(x.id === presetId), dataset: { ps: 'gd-preset', preset: x.id }, onclick: () => { presetId = x.id; aw.querySelector('input').value = metresText(x.width); ad.querySelector('input').value = metresText(x.depth); chips.querySelectorAll('.gd-chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === x.id))); } }, `${x.label} ${(x.width / 1000).toFixed(1)} x ${(x.depth / 1000).toFixed(1)}`)));
    const addBtn = h('button', { class: 'gd-btn', type: 'button', dataset: { ps: 'gd-add' }, onclick: () => {
      const width = mmFromMetres(aw.querySelector('input').value); const depth = mmFromMetres(ad.querySelector('input').value);
      if (!width || !depth) { showErr('Type the new room size in metres, for example 3.0.'); return; }
      let newId = null;
      finish((p) => { newId = addPresetRoom(p, presetId, { width, depth }); }, 'Add room');
      if (newId) { sel = newId; paint(); }
    } }, 'Add room');
    side.replaceChildren(
      h('div', { class: 'gd-sec' }, h('h3', null, 'Overall size'), h('div', { class: 'gd-row' }, ow, ol)),
      areaEl, warnEl, err,
      roomSec || h('p', { class: 'gd-note', dataset: { ps: 'gd-tap-hint' } }, 'Tap a room in the drawing to type its width and length.'),
      h('div', { class: 'gd-sec' }, h('h3', null, 'Add room'), chips, h('div', { class: 'gd-row' }, aw, ad, addBtn)),
      h('p', { class: 'gd-note' }, 'Concept sizes only. The 60 m2 check and the room sizes are guides, not an approval.'));
    paintChecks();
  }

  function paint() { paintDrawing(); paintSide(); }
  paint();
  const off = store.on('project', () => { if (!preview && !drag && root.isConnected) paint(); });
  if (host) { host.append(root); return { el: root, close() { off?.(); root.remove(); } }; }
  const phone = isPhoneMode();
  const m = openModal({ title: 'Size and rooms', size: 'lg', sheet: phone, body: root, onClose: () => off?.() });
  return { el: root, close: m.close };
}
