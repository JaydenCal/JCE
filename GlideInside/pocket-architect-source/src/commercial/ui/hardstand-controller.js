// The Hardstand tool's behaviour, with no DOM and no canvas: pointer, key and double click events arrive in plan coordinates (mm), the
// controller snaps, draws a draft, and commits each operation as ONE undo step (store.apply through commercialEdit). The 2D plan tool and the
// top view both drive it and draw its draft(), so the two behave the same.
//
// Modes (hsState.mode): rect, poly, fill, edit. Alt turns snapping off. See hardstand-state.js for the hints shown to the person.

import { commercialEdit } from '../mode.js';
import * as HS from '../catalogue/pavements/hardstand.js';
import { pavementById } from '../catalogue/pavements/pavements.js';
import * as R from '../catalogue/pavements/roads.js';
import { hsState, setHsState, HS_MODES, typeLabel } from './hardstand-state.js';

const isSw = (id) => String(id || '').startsWith('sw:');

const DRAG_PX = 3;
const HANDLE_PX = 10;
const MIN_M2 = 0.5;
const fmtM = (v) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;
const fmtA = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} m2`;

/**
 * createHardstandController({ store, scale, toast, redraw }): scale() is pixels per plan mm; toast(message, { kind, action }) reports;
 * redraw() asks the host to repaint after the draft changes.
 */
export function createHardstandController({ store, scale, toast = () => {}, redraw = () => {} }) {
  let drag = null; // { kind: 'rect' | 'vertex' | 'move', ... }
  let pts = []; // polygon in progress
  let hover = null; // last snap result
  let rubber = null;
  let activeVertex = null; // index of the vertex last clicked on the selected area
  let cache = null;
  let warnCache = { key: '', value: null };
  const offProject = store.on?.('project', () => { cache = null; rcache = null; });

  const mmPerPx = () => 1 / Math.max(1e-6, scale());
  const project = () => store.project;
  const lotOf = () => project().site?.lot?.boundary || null;
  const lotRing = () => { const b = lotOf(); return Array.isArray(b) && b.length >= 3 ? b : null; };
  function ctxFor(exclude = null) {
    if (cache && cache.exclude === exclude && cache.proj === store.project) return cache.ctx;
    const ctx = HS.hsContext(store.project, { exclude });
    cache = { exclude, proj: store.project, ctx };
    return ctx;
  }
  const isOn = () => store.project.mode === 'commercial' && !!store.project.commercial;
  const list = () => HS.hardstandList(store.project.commercial);
  const selectedArea = () => (hsState.selected ? list().find((a) => a.id === hsState.selected) || null : null);
  const snap = (w, mods, exclude = null) => HS.snapPoint(w, ctxFor(exclude), { mmPerPx: mmPerPx(), alt: !!mods?.alt });
  let rcache = null;
  const roadCtx = (exclude = null) => {
    if (rcache && rcache.exclude === exclude && rcache.proj === store.project) return rcache.ctx;
    rcache = { exclude, proj: store.project, ctx: R.roadSnapContext(store.project, { exclude }) };
    return rcache.ctx;
  };
  const snapRoad = (w, mods, exclude = null) => R.snapRoadPoint(w, roadCtx(exclude), { mmPerPx: mmPerPx(), alt: !!mods?.alt });
  const roadOf = (id) => (id ? R.roadById(store.project.commercial, id) : null);
  /** The generated site works item selected (hsState.selected is a sw: id), or null. */
  const selectedGenerated = () => (isSw(hsState.selected) ? R.siteItemById(store.project.commercial, hsState.selected) : null);
  let roadPts = []; // road in progress
  let roadRubber = null;

  function say(msg, kind = 'ok', extra = {}) { try { toast(msg, { kind, ...extra }); } catch { /* no toast host */ } }

  function edit(label, fn) {
    let result = null;
    try {
      commercialEdit(store, label, (c) => { result = fn(c); });
    } catch (e) {
      say(e?.message || 'That change was not possible', 'warn');
      return null;
    }
    cache = null; rcache = null;
    return result;
  }

  // Committing --------------------------------------------------------------------------------------------------------------------

  function afterAdd(polys, res, ctx) {
    const ids = res.ids;
    if (!ids.length) { say('That is outside the lot, so nothing was added.', 'warn'); return; }
    setHsState({ selected: ids[0] });
    const m2 = polys.reduce((s, p) => s + HS.areaM2(p), 0);
    const parts = [`Hardstand added, ${fmtA(m2)} of ${typeLabel(hsState.type)}.`];
    if (res.clipped) parts.push('Cut off at the lot boundary.');
    const w = polys.flatMap((p) => HS.drawnWarnings(p, ctx).buildings);
    if (w.length) parts.push(`Crosses ${[...new Set(w)].join(', ')}. It is not blocked, check the layout.`);
    say(parts.join(' '), w.length ? 'warn' : 'ok');
    const prompts = HS.markingPrompts(store.project.commercial, ids);
    if (prompts[0]) {
      const pr = prompts[0];
      say(pr.text, 'info', { action: { label: 'Add marking', onClick: () => edit('Add line marking', (c) => HS.addPromptMarking(c, pr)) }, timeout: 9000 });
    }
  }

  /** Add one or more polygons of the current type as one undo step. */
  function create(polys, label = 'Add hardstand') {
    if (!isOn()) return null;
    const ctx = ctxFor();
    const lot = lotRing();
    const res = edit(label, (c) => {
      const all = { ids: [], clipped: false };
      for (const polygon of polys) {
        const r = HS.addHardstand(c, { type: hsState.type, polygon, lot });
        all.ids.push(...r.ids); all.clipped = all.clipped || r.clipped;
      }
      return all;
    });
    if (res) afterAdd(polys, res, ctx);
    redraw();
    return res;
  }

  function fillAt(w) {
    const r = HS.fillRegion(w, ctxFor());
    if (r.error) { say(r.error, 'warn'); return null; }
    return create(r.pieces, 'Fill hardstand');
  }

  function finishPoly() {
    if (pts.length < 3) { say('A polygon needs at least three corners.', 'warn'); return null; }
    const poly = pts.slice();
    if (HS.areaM2(poly) < MIN_M2) { say('That area is too small. Pick corners further apart.', 'warn'); return null; }
    pts = []; rubber = null;
    const r = create([poly], 'Add hardstand polygon');
    redraw();
    return r;
  }

  function commitEdit(id, polygon, label) {
    const lot = lotRing();
    const res = edit(label, (c) => HS.setHardstandPolygon(c, id, polygon, lot));
    if (res) {
      if (res.outside) say('That would leave the lot, so the area was not changed.', 'warn');
      else {
        const w = HS.drawnWarnings(polygon, ctxFor(id));
        const msgs = [];
        if (res.clipped) msgs.push('Cut off at the lot boundary.');
        if (w.buildings.length) msgs.push(`Crosses ${w.buildings.join(', ')}. It is not blocked, check the layout.`);
        if (msgs.length) say(msgs.join(' '), 'warn');
      }
    }
    redraw();
  }

  function retype(id, type) { edit('Change hardstand type', (c) => HS.setHardstandType(c, id, type)); redraw(); }
  function duplicate(id = hsState.selected) {
    if (!id) return null;
    const res = edit('Duplicate hardstand', (c) => HS.duplicateHardstand(c, id, lotRing()));
    if (res?.ids?.length) { setHsState({ selected: res.ids[0] }); say('Copy made, 2 m across and down.', 'ok'); }
    redraw();
    return res;
  }
  function remove(id = hsState.selected) {
    if (!id) return;
    if (isSw(id)) { removeGenerated(id); return; }
    const done = edit('Delete hardstand', (c) => { HS.removeHardstand(c, id); return true; });
    if (done) { if (hsState.selected === id || !selectedArea()) setHsState({ selected: null }); activeVertex = null; }
    redraw();
  }
  function finishRoad() {
    const kind = R.roadKind(hsState.roadKind);
    if (roadPts.length < 2) { say('A road needs at least two points.', 'warn'); return null; }
    const centre = roadPts.slice();
    if (R.centreLengthM(centre) < R.MIN_ROAD_MM / 1000) { say('That is too short. Pick points further apart.', 'warn'); return null; }
    roadPts = []; roadRubber = null;
    const lot = lotRing();
    const ctx = ctxFor();
    const res = edit(`Add ${kind.label.toLowerCase()}`, (c) => R.addRoad(c, { kind: kind.id, centre, widthMm: hsState.roadWidth, type: hsState.type, lot }));
    if (res) {
      if (!res.ids.length) say('That is outside the lot, so nothing was added.', 'warn');
      else {
        setHsState({ selected: res.ids[0] });
        const road = roadOf(res.ids[0]);
        const parts = [`${kind.label} added, ${(road.widthMm / 1000).toFixed(1)} m wide, ${R.centreLengthM(road.centre).toFixed(1)} m long.`];
        if (res.clipped) parts.push('Cut off at the lot boundary.');
        const w = HS.drawnWarnings(road.polygon, ctx).buildings;
        if (w.length && kind.id !== 'pavement') parts.push(`Crosses ${[...new Set(w)].join(', ')}. It is not blocked, check the layout.`);
        say(parts.join(' '), w.length ? 'warn' : 'ok');
      }
    }
    redraw();
    return res;
  }

  function commitRoad(id, patch, label) {
    const lot = lotRing();
    const res = edit(label, (c) => R.setRoad(c, id, patch, lot));
    if (res?.outside) say('That would leave the lot, so the road was not changed.', 'warn');
    else if (res?.clipped) say('Cut off at the lot boundary.', 'warn');
    redraw();
    return res;
  }
  function setRoadWidth(id, widthMm) { return commitRoad(id, { widthMm }, 'Change road width'); }
  function setRoadKind(id, kind) {
    const k = R.roadKind(kind);
    return commitRoad(id, { kind: k.id, widthMm: k.widthMm, type: k.type }, `Change to ${k.label.toLowerCase()}`);
  }

  /** Remove a generated road, aisle, footpath, apron or entry through siteRemoved.ids (one undo step). */
  function removeGenerated(id = hsState.selected) {
    if (!isSw(id)) return false;
    const done = edit('Remove site works item', (c) => { R.removeGenerated({ commercial: c }, id); return true; });
    if (done) { setHsState({ selected: null }); }
    redraw();
    return !!done;
  }
  /** Turn the selected generated aisle into a road that can be reshaped. */
  function makeEditable(id = hsState.selected) {
    if (!isSw(id)) return null;
    const lot = lotRing();
    const res = edit('Make aisle editable', (c) => R.makeEditable(c, id, lot));
    if (res?.id) { setHsState({ selected: res.id }); say('Now a road you can reshape: drag its points, midpoint dots and width dot.', 'ok'); }
    else say('That item cannot be turned into a road.', 'warn');
    redraw();
    return res;
  }

  function removeVertexOf(id, index) {
    edit('Remove hardstand corner', (c) => HS.removeVertex(c, id, index));
    activeVertex = null;
    redraw();
  }
  function nudge(dx, dy) {
    const a = selectedArea();
    if (!a) return;
    edit('Move hardstand', (c) => HS.moveHardstand(c, a.id, dx, dy, lotRing()));
    redraw();
  }

  // Pointer -----------------------------------------------------------------------------------------------------------------------

  const tolMm = () => HANDLE_PX * mmPerPx();
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function lockAngle(p, from, mods) {
    if (!mods?.shift || !from) return p;
    const d = { x: p.x - from.x, y: p.y - from.y };
    const l = Math.hypot(d.x, d.y);
    const a = Math.round(Math.atan2(d.y, d.x) / (Math.PI / 12)) * (Math.PI / 12);
    return { x: Math.round(from.x + Math.cos(a) * l), y: Math.round(from.y + Math.sin(a) * l) };
  }

  /** Mouse or pen press at plan point w. Returns false when the press is not for the tool (the host may pan). */
  function pointerDown(w, mods = {}) {
    if (!isOn()) return false;
    const mode = hsState.mode;
    if (mode === 'road') {
      let s = snapRoad(w, mods);
      s = { ...s, ...R.lockTo15(s, roadPts[roadPts.length - 1], mods.shift && s.kind !== 'door' && s.kind !== 'frontage') };
      hover = s;
      if (!roadPts.length || dist(s, roadPts[roadPts.length - 1]) > 1) roadPts.push({ x: s.x, y: s.y });
      roadRubber = s;
      redraw();
      return true;
    }
    if (mode === 'rect') {
      const s = snap(w, mods);
      drag = { kind: 'rect', p0: s, along: HS.edgeDirection(s), p1: s, moved: false, screen: mods.screen || null };
      hover = s;
      return true;
    }
    if (mode === 'poly') {
      let s = snap(w, mods);
      s = lockAngle(s, pts[pts.length - 1], mods);
      hover = s;
      if (pts.length >= 3 && dist(s, pts[0]) <= tolMm()) { finishPoly(); return true; }
      if (!pts.length || dist(s, pts[pts.length - 1]) > 1) pts.push({ x: s.x, y: s.y });
      rubber = s;
      redraw();
      return true;
    }
    if (mode === 'fill') {
      fillAt(w);
      return true;
    }
    // edit
    const sel = selectedArea();
    const road = sel?.road ? roadOf(sel.id) : null;
    if (road) {
      const tol = tolMm();
      for (const hd of R.roadHandles(road)) {
        if (dist(w, hd) > tol * (hd.kind === 'mid' ? 0.8 : 1)) continue;
        if (hd.kind === 'point') { drag = { kind: 'rpoint', id: road.id, index: hd.index, centre: road.centre.map((q) => ({ ...q })), moved: false, screen: mods.screen || null }; activeVertex = hd.index; return true; }
        if (hd.kind === 'mid') {
          const centre = road.centre.map((q) => ({ ...q }));
          centre.splice(hd.index + 1, 0, { x: Math.round(hd.x), y: Math.round(hd.y) });
          drag = { kind: 'rpoint', id: road.id, index: hd.index + 1, centre, moved: false, inserted: true, screen: mods.screen || null }; activeVertex = hd.index + 1; return true;
        }
        if (hd.kind === 'width') { drag = { kind: 'rwidth', id: road.id, seg: hd.index, widthMm: road.widthMm, moved: false, screen: mods.screen || null }; return true; }
      }
    }
    if (sel && !road) {
      const tol = tolMm();
      const poly = sel.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]; const b = poly[(i + 1) % poly.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (dist(w, a) <= tol) { drag = { kind: 'vertex', id: sel.id, index: i, polygon: poly.map((q) => ({ ...q })), moved: false, screen: mods.screen || null }; activeVertex = i; return true; }
        if (dist(w, mid) <= tol * 0.8 && dist(a, b) > tol * 3) {
          const np = poly.map((q) => ({ ...q }));
          np.splice(i + 1, 0, { x: Math.round(mid.x), y: Math.round(mid.y) });
          drag = { kind: 'vertex', id: sel.id, index: i + 1, polygon: np, moved: false, inserted: true, screen: mods.screen || null };
          activeVertex = i + 1;
          return true;
        }
      }
    }
    const hit = HS.hardstandAt(store.project.commercial, w);
    if (hit) {
      setHsState({ selected: hit.id });
      activeVertex = null;
      // snap the move through the corner of the area nearest the press
      let ref = hit.polygon[0];
      for (const v of hit.polygon) if (dist(v, w) < dist(ref, w)) ref = v;
      drag = { kind: 'move', id: hit.id, start: w, ref, polygon: hit.polygon.map((q) => ({ ...q })), dx: 0, dy: 0, moved: false, screen: mods.screen || null };
      redraw();
      return true;
    }
    const gen = R.siteItemAt(store.project.commercial, w);
    if (gen) { setHsState({ selected: gen.id }); activeVertex = null; redraw(); return true; }
    if (hsState.selected) { setHsState({ selected: null }); activeVertex = null; redraw(); }
    return false;
  }

  const movedEnough = (d, mods) => d.moved || !d.screen || !mods.screen || Math.hypot(mods.screen.x - d.screen.x, mods.screen.y - d.screen.y) >= DRAG_PX;

  function pointerMove(w, mods = {}) {
    if (!isOn()) return;
    const mode = hsState.mode;
    if (drag) {
      if (drag.kind === 'rect') {
        if (!movedEnough(drag, mods)) return;
        drag.moved = true;
        let s = snap(w, mods);
        if (mods.shift) {
          const u = drag.along || { x: 1, y: 0 };
          const v = { x: -u.y, y: u.x };
          const d = { x: s.x - drag.p0.x, y: s.y - drag.p0.y };
          const a = d.x * u.x + d.y * u.y; const b = d.x * v.x + d.y * v.y;
          const m = Math.max(Math.abs(a), Math.abs(b));
          const sa = Math.sign(a) * m; const sb = Math.sign(b) * m;
          s = { ...s, x: Math.round(drag.p0.x + u.x * sa + v.x * sb), y: Math.round(drag.p0.y + u.y * sa + v.y * sb) };
        }
        drag.p1 = s; hover = s;
      } else if (drag.kind === 'vertex') {
        if (!movedEnough(drag, mods)) return;
        drag.moved = true;
        const s = snap(w, mods, drag.id);
        drag.polygon[drag.index] = { x: s.x, y: s.y };
        hover = s;
      } else if (drag.kind === 'rpoint') {
        if (!movedEnough(drag, mods)) return;
        drag.moved = true;
        const s = snapRoad(w, mods, drag.id);
        drag.centre[drag.index] = { x: s.x, y: s.y };
        hover = s;
      } else if (drag.kind === 'rwidth') {
        if (!movedEnough(drag, mods)) return;
        drag.moved = true;
        const r = roadOf(drag.id);
        if (r) drag.widthMm = R.widthFromPoint(r, drag.seg, w);
        hover = null;
      } else if (drag.kind === 'move') {
        if (!movedEnough(drag, mods)) return;
        drag.moved = true;
        const want = { x: drag.ref.x + (w.x - drag.start.x), y: drag.ref.y + (w.y - drag.start.y) };
        const s = snap(want, mods, drag.id);
        drag.dx = s.x - drag.ref.x; drag.dy = s.y - drag.ref.y;
        hover = s;
      }
      redraw();
      return;
    }
    if (mode === 'road') {
      let s = snapRoad(w, mods);
      if (roadPts.length) s = { ...s, ...R.lockTo15(s, roadPts[roadPts.length - 1], mods.shift && s.kind !== 'door' && s.kind !== 'frontage') };
      hover = s; roadRubber = roadPts.length ? s : null;
      redraw();
    } else if (mode === 'rect' || mode === 'poly') {
      let s = snap(w, mods);
      if (mode === 'poly') { s = lockAngle(s, pts[pts.length - 1], mods); rubber = pts.length ? s : null; }
      hover = s;
      redraw();
    } else if (hover) { hover = null; redraw(); }
  }

  function pointerUp(w, mods = {}) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) { redraw(); return; }
    if (d.kind === 'rect') {
      const poly = HS.rectPolygon(d.p0, d.p1, d.along);
      if (HS.areaM2(poly) < MIN_M2) { say('That area is too small. Drag across a larger area.', 'warn'); redraw(); return; }
      create([poly], 'Add hardstand rectangle');
    } else if (d.kind === 'vertex') {
      commitEdit(d.id, d.polygon, d.inserted ? 'Add hardstand corner' : 'Reshape hardstand');
    } else if (d.kind === 'rpoint') {
      commitRoad(d.id, { centre: d.centre }, d.inserted ? 'Add road point' : 'Reshape road');
    } else if (d.kind === 'rwidth') {
      commitRoad(d.id, { widthMm: d.widthMm }, 'Change road width');
    } else if (d.kind === 'move') {
      if (!d.dx && !d.dy) { redraw(); return; }
      if (roadOf(d.id)) { edit('Move road', (c) => HS.moveHardstand(c, d.id, d.dx, d.dy, lotRing())); redraw(); return; }
      commitEdit(d.id, d.polygon.map((q) => ({ x: q.x + d.dx, y: q.y + d.dy })), 'Move hardstand');
    }
  }

  function dblClick(w) {
    if (!isOn()) return;
    if (hsState.mode === 'poly') { if (pts.length >= 3) finishPoly(); return; }
    if (hsState.mode === 'road') { if (roadPts.length >= 2) finishRoad(); return; }
    if (hsState.mode !== 'edit') return;
    const sel = selectedArea();
    if (!sel) return;
    if (sel.road) {
      const road = roadOf(sel.id);
      const pt = road && R.roadHandles(road).find((hd) => hd.kind === 'point' && dist(hd, w) <= tolMm());
      if (pt && road.centre.length > 2) { edit('Remove road point', (c) => R.removeRoadPoint(c, sel.id, pt.index, lotRing())); activeVertex = null; redraw(); }
      return;
    }
    const part = HS.pickPart(sel.polygon, w, tolMm());
    if (!part) return;
    if (part.kind === 'vertex') removeVertexOf(sel.id, part.index);
    else {
      const poly = sel.polygon.map((q) => ({ ...q }));
      poly.splice(part.index + 1, 0, { x: Math.round(part.point.x), y: Math.round(part.point.y) });
      commitEdit(sel.id, poly, 'Add hardstand corner');
    }
  }

  function cancel() {
    if (drag) { drag = null; redraw(); return true; }
    if (pts.length) { pts = []; rubber = null; redraw(); return true; }
    if (roadPts.length) { roadPts = []; roadRubber = null; redraw(); return true; }
    return false;
  }

  /** Returns true when the key was used. */
  function keyDown(e) {
    if (!isOn()) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') {
      if (cancel()) return true;
      if (hsState.selected) { setHsState({ selected: null }); activeVertex = null; redraw(); return true; }
      return false;
    }
    if (k === 'Enter') {
      if (hsState.mode === 'poly' && pts.length) { finishPoly(); return true; }
      if (hsState.mode === 'road' && roadPts.length) { finishRoad(); return true; }
      return false;
    }
    if (k === 'l' && !e.altKey) return false; // L opens the Road or pavement tool (its own button), handled by the editor
    const mode = HS_MODES.find((m) => m.key.toLowerCase() === k);
    if (mode && !e.altKey) { cancel(); setHsState({ mode: mode.id }); redraw(); return true; }
    if (k === 'Backspace' && hsState.mode === 'poly' && pts.length) { pts.pop(); rubber = pts.length ? rubber : null; redraw(); return true; }
    if (k === 'Backspace' && hsState.mode === 'road' && roadPts.length) { roadPts.pop(); roadRubber = roadPts.length ? roadRubber : null; redraw(); return true; }
    if (isSw(hsState.selected) && selectedGenerated()) {
      if (k === 'Delete' || k === 'Backspace') { removeGenerated(); return true; }
      return false;
    }
    const sel = selectedArea();
    if (!sel) return false;
    if (k === 'Delete' || k === 'Backspace') {
      const nPts = sel.road ? roadOf(sel.id)?.centre.length : sel.polygon.length;
      if (activeVertex != null && nPts > (sel.road ? 2 : 3) && !sel.road) removeVertexOf(sel.id, activeVertex);
      else if (sel.road && activeVertex != null && nPts > 2) { edit('Remove road point', (c) => R.removeRoadPoint(c, sel.id, activeVertex, lotRing())); activeVertex = null; redraw(); }
      else remove(sel.id);
      return true;
    }
    if (k === 'd') { duplicate(sel.id); return true; }
    if (k.startsWith('Arrow')) {
      const step = e.shiftKey ? 1000 : 100;
      nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
      return true;
    }
    return false;
  }

  // Draft for the renderers ---------------------------------------------------------------------------------------------------

  function warnFor(ring, exclude) {
    const key = ring.map((p) => `${p.x},${p.y}`).join(';');
    if (warnCache.key === key) return warnCache.value;
    const value = HS.drawnWarnings(ring, ctxFor(exclude));
    warnCache = { key, value };
    return value;
  }

  const sideLabels = (ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })).filter(({ a, b }) => dist(a, b) * scale() > 46).map(({ a, b }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: fmtM(dist(a, b) / 1000) }));

  /**
   * What to draw: { mode, type, ring, open, readout, warn: [text], labels: [{ x, y, text }], snap: { x, y, kind, text } | null,
   *   selected: ring | null, handles: [{ x, y, kind: 'vertex' | 'mid', active }], ghost: ring | null }
   * `ring` is the draft being drawn or edited; `selected` is the stored outline of the selected area (drawn under the draft).
   */
  function draft() {
    const out = { mode: hsState.mode, type: hsState.type, centre: null, generated: null, ring: null, open: false, readout: '', warn: [], labels: [], snap: null, selected: null, handles: [], ghost: null };
    if (!isOn()) return out;
    const sel = selectedArea();
    if (sel) out.selected = sel.polygon;
    const gen = selectedGenerated();
    if (gen) out.generated = gen.polygon;
    const kindDef = R.roadKind(hsState.roadKind);
    const selRoad = sel?.road ? roadOf(sel.id) : null;
    if (hsState.mode === 'road' && roadPts.length) {
      const centre = roadRubber ? [...roadPts, roadRubber] : roadPts.slice();
      out.centre = centre;
      out.ring = centre.length >= 2 ? R.corridor(centre, hsState.roadWidth || kindDef.widthMm) : null;
      if (!out.ring?.length) out.ring = null;
      out.open = false;
      out.readout = `${kindDef.label}, ${((hsState.roadWidth || kindDef.widthMm) / 1000).toFixed(1)} m wide, ${R.centreLengthM(centre).toFixed(1)} m`;
    } else if (drag?.kind === 'rpoint' && drag.moved && selRoad) {
      out.centre = drag.centre; out.ring = R.corridor(drag.centre, selRoad.widthMm); out.ghost = selRoad.polygon; out.type = selRoad.type;
      out.readout = `${R.centreLengthM(drag.centre).toFixed(1)} m long`;
    } else if (drag?.kind === 'rwidth' && drag.moved && selRoad) {
      out.centre = selRoad.centre; out.ring = R.corridor(selRoad.centre, drag.widthMm); out.ghost = selRoad.polygon; out.type = selRoad.type;
      out.readout = `${(drag.widthMm / 1000).toFixed(1)} m wide`;
    }
    if (drag?.kind === 'rect' && drag.moved) {
      out.ring = HS.rectPolygon(drag.p0, drag.p1, drag.along);
      const m = HS.measure(out.ring);
      out.readout = `${fmtM(m.w)} x ${fmtM(m.d)}, ${fmtA(m.areaM2)}`;
      out.labels = sideLabels(out.ring);
    } else if (drag?.kind === 'vertex' && drag.moved) {
      out.ring = drag.polygon; out.ghost = sel?.polygon || null;
      out.readout = fmtA(HS.areaM2(out.ring));
      out.labels = sideLabels(out.ring);
    } else if (drag?.kind === 'move' && drag.moved) {
      out.ring = drag.polygon.map((q) => ({ x: q.x + drag.dx, y: q.y + drag.dy })); out.ghost = sel?.polygon || null;
      out.readout = fmtA(HS.areaM2(out.ring));
    } else if (hsState.mode === 'poly' && pts.length) {
      const ring = rubber ? [...pts, rubber] : pts.slice();
      out.ring = ring; out.open = true;
      if (ring.length >= 3) { out.readout = `${fmtA(HS.areaM2(ring))}, ${pts.length} corners`; }
      else if (rubber) out.readout = fmtM(dist(pts[0], rubber) / 1000);
      out.labels = ring.length >= 2 ? sideLabels(ring).slice(0, ring.length - 1) : [];
    }
    if (out.ring && out.ring.length >= 3 && !(out.centre && kindDef.id === 'pavement' && hsState.mode === 'road')) {
      const w = warnFor(out.ring, drag && drag.id ? drag.id : null);
      out.warn = w.text;
    }
    if (hover && (hsState.mode === 'rect' || hsState.mode === 'poly' || hsState.mode === 'road' || drag)) out.snap = { x: hover.x, y: hover.y, kind: hover.kind, text: R.roadSnapLabel(hover) || HS.snapLabel(hover) };
    if (hsState.mode === 'edit' && selRoad && !(drag && drag.moved && drag.kind === 'move')) {
      const live = drag?.kind === 'rpoint' ? { ...selRoad, centre: drag.centre } : drag?.kind === 'rwidth' ? { ...selRoad, widthMm: drag.widthMm } : selRoad;
      out.centre = out.centre || live.centre;
      for (const hd of R.roadHandles(live)) {
        if (hd.kind === 'mid' && dist(live.centre[hd.index], live.centre[hd.index + 1]) * scale() < 36) continue;
        out.handles.push({ x: hd.x, y: hd.y, kind: hd.kind === 'point' ? 'vertex' : hd.kind, index: hd.index, active: hd.kind === 'point' && hd.index === activeVertex });
      }
    } else if (hsState.mode === 'edit' && sel && !sel.road && !(drag && drag.moved && drag.kind === 'move')) {
      const poly = drag?.kind === 'vertex' ? drag.polygon : sel.polygon;
      poly.forEach((p, i) => {
        out.handles.push({ x: p.x, y: p.y, kind: 'vertex', index: i, active: i === activeVertex });
        const q = poly[(i + 1) % poly.length];
        if (dist(p, q) * scale() > 36) out.handles.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, kind: 'mid', index: i });
      });
    }
    return out;
  }

  function reset() { drag = null; pts = []; rubber = null; roadPts = []; roadRubber = null; hover = null; activeVertex = null; cache = null; }

  return {
    pointerDown, pointerMove, pointerUp, dblClick, keyDown, cancel, draft, reset,
    create, fillAt, finishPoly, finishRoad, commitRoad, setRoadWidth, setRoadKind, removeGenerated, makeEditable, selectedGenerated, roadOf, retype, duplicate, remove, removeVertexOf, nudge,
    selectedArea, list,
    get busy() { return !!drag || pts.length > 0 || roadPts.length > 0; },
    get activeVertex() { return activeVertex; },
    hint: () => HS_MODES.find((m) => m.id === hsState.mode)?.hint || '',
    typeInfo: () => pavementById(hsState.type),
    dispose() { offProject?.(); },
  };
}
