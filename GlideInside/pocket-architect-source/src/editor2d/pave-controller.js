// The Driveway and road tool's behaviour, with no DOM and no canvas: pointer, key and double click events arrive in plan coordinates (mm),
// the controller snaps, builds a draft and commits each operation as ONE undo step (store.apply). The 2D plan tool drives it and draws its
// draft(), the panel calls its actions. Modes (paveState.mode): draw and edit. See pave-state.js for the hints.

import * as P from '../site/pavedways.js';
import { garageDoor } from '../site/lotplan.js';
import * as G from '../model/geometry.js';
import { paveState, setPaveState, currentWidth, PAVE_MODES } from './pave-state.js';

const DRAG_PX = 3;
const HANDLE_PX = 10;
const fmtM = (v) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;
const fmtM1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} m`;
const fmtA = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} m2`;
const dist = G.dist;

/** createPaveController({ store, scale, toast, redraw }): scale() is pixels per plan mm; toast(message, { kind, action }) reports. */
export function createPaveController({ store, scale, toast = () => {}, redraw = () => {} }) {
  let pts = []; // the draft, in plan mm
  let meta = []; // per point: { kerbEdge }
  let rubber = null;
  let hover = null;
  let drag = null; // { kind: 'vertex' | 'move', ... }
  let activeVertex = null;
  const cache = { key: '', value: null };

  const mmPerPx = () => 1 / Math.max(1e-6, scale());
  const project = () => store.project;
  const tolMm = () => HANDLE_PX * mmPerPx();
  const say = (msg, kind = 'ok', extra = {}) => { try { toast(msg, { kind, ...extra }); } catch { /* no toast host */ } };
  const kind = () => paveState.kind;
  const widthNow = () => currentWidth();
  const selectedWay = () => (paveState.selected ? P.getWay(project(), paveState.selected) : null);
  const snap = (w, mods, exclude = null) => P.snapWayPoint(project(), w, { mmPerPx: mmPerPx(), alt: !!mods?.alt, widthMm: widthNow(), exclude });

  function edit(label, fn) {
    try {
      let out = null;
      store.apply(label, (p) => { out = fn(p); });
      return out;
    } catch (e) {
      say(e?.message || 'That change was not possible.', 'warn');
      return null;
    }
  }

  // Committing --------------------------------------------------------------------------------------------------------------------

  function describe(way) {
    const g = P.wayGeometry(project(), way);
    return { g, text: `${P.MATERIALS[way.material].label} ${P.KINDS[way.kind].label.toLowerCase()}, ${fmtM1(way.widthMm / 1000)} wide, ${fmtM1(g.lengthMm / 1000)} long, ${fmtA(g.areaM2)}${g.crossoverM2 > 0 ? ' with the crossover' : ''}.` };
  }

  function finish() {
    if (pts.length < 2) { say('Pick at least two points.', 'warn'); return null; }
    const startKerb = meta[0]?.kerbEdge ?? null;
    const endKerb = startKerb == null ? meta.at(-1)?.kerbEdge ?? null : null;
    const spec = { kind: kind(), material: paveState.material || P.defaultMaterial(project(), kind()), widthMm: widthNow(), radiusMm: paveState.radiusMm, pts: pts.slice(), kerbEdge: startKerb, endKerbEdge: endKerb };
    const replaced = kind() === 'driveway' && (startKerb != null || endKerb != null) && !P.drivewayIsDrawn(project());
    const way = edit(`Add ${kind()}`, (p) => P.addWay(p, spec));
    if (!way) return null;
    pts = []; meta = []; rubber = null;
    setPaveState({ selected: way.id, mode: 'edit' });
    activeVertex = null;
    const d = describe(way);
    const parts = [`${d.text}`];
    if (replaced) parts.push('It replaces the automatic driveway.');
    if (way.kind === 'driveway' && way.kerbEdge == null) parts.push('It does not start at the kerb, so there is no crossover. Drag the first point to the street to add one.');
    say(parts.join(' '), way.kind === 'driveway' && way.kerbEdge == null ? 'warn' : 'ok');
    const j = P.joinCandidate(project(), way.id);
    if (j) say('It touches the end of another driveway or road.', 'info', { action: { label: 'Join them', onClick: () => joinWith(way.id, j.other) }, timeout: 9000 });
    redraw();
    return way;
  }

  function joinWith(a, b) {
    const w = edit('Join driveway and road', (p) => P.joinWays(p, a, b));
    if (w) { setPaveState({ selected: w.id }); say('Joined into one.', 'ok'); }
    redraw();
    return w;
  }
  function joinTouching() {
    const sel = selectedWay();
    if (!sel) return null;
    const j = P.joinCandidate(project(), sel.id);
    if (!j) { say('Nothing touches this one. Snap an end to the end of another driveway or road first.', 'warn'); return null; }
    return joinWith(sel.id, j.other);
  }

  function patchSelected(label, patch) {
    const sel = selectedWay();
    if (!sel) return null;
    const w = edit(label, (p) => P.updateWay(p, sel.id, patch));
    redraw();
    return w;
  }
  const setWidth = (mm) => {
    const k = selectedWay()?.kind || kind();
    const v = P.clampWidth(k, mm);
    setPaveState({ widthMm: { [k]: v } });
    if (selectedWay()) patchSelected('Change width', { widthMm: v }); else redraw();
  };
  const setMaterial = (m) => {
    if (!P.MATERIALS[m]) return;
    setPaveState({ material: m });
    if (selectedWay()) patchSelected('Change material', { material: m }); else redraw();
  };
  const setRadius = (mm) => {
    const v = P.clampRadius(mm);
    setPaveState({ radiusMm: v });
    if (selectedWay()) patchSelected('Change corner radius', { radiusMm: v }); else redraw();
  };
  function setKind(k) {
    if (!P.KINDS[k]) return;
    const sel = selectedWay();
    setPaveState({ kind: k, material: null });
    if (sel) patchSelected('Change to ' + k, { kind: k, widthMm: paveState.widthMm[k] });
    else redraw();
  }
  function addHead(end, type) {
    const sel = selectedWay();
    if (!sel) return null;
    const w = edit('Add turning head', (p) => P.addHead(p, sel.id, end, type));
    if (w) say(`${P.HEADS[type].label} added at the ${end === 'end' ? 'far' : 'near'} end.`, 'ok');
    redraw();
    return w;
  }
  function removeHead(end) {
    const sel = selectedWay();
    if (!sel) return;
    edit('Remove turning head', (p) => P.removeHead(p, sel.id, end));
    redraw();
  }
  function splitAtActive() {
    const sel = selectedWay();
    if (!sel) return null;
    if (activeVertex == null) { say('Click a corner on the line first, then split there.', 'warn'); return null; }
    const r = edit('Split driveway or road', (p) => P.splitWay(p, sel.id, activeVertex));
    if (r) { activeVertex = null; setPaveState({ selected: r[1].id }); say('Split in two. Each part can now have its own width and material.', 'ok'); }
    redraw();
    return r;
  }
  function remove(id = paveState.selected) {
    if (!id) return;
    const ok = edit('Delete driveway or road', (p) => { P.removeWay(p, id); return true; });
    if (ok) { if (paveState.selected === id) setPaveState({ selected: null }); activeVertex = null; }
    redraw();
  }
  function removeVertexOf(id, index) {
    edit('Remove corner', (p) => P.removeVertex(p, id, index));
    activeVertex = null;
    redraw();
  }
  function startAtDoor() {
    const door = garageDoor(project());
    if (!door) { say('This design has no garage door to start from.', 'warn'); return false; }
    pts = [{ x: Math.round(door.mid.x), y: Math.round(door.mid.y) }]; meta = [{ kerbEdge: null }]; rubber = null;
    setPaveState({ kind: 'driveway', mode: 'draw', selected: null });
    redraw();
    return true;
  }

  // Pointer -----------------------------------------------------------------------------------------------------------------------

  const withLock = (s, mods) => (mods?.shift && pts.length ? { ...s, ...P.lockAngle(s, pts.at(-1)), kind: 'free', text: 'Locked to 15 degrees' } : s);

  function pushPoint(s) {
    if (pts.length && dist(s, pts.at(-1)) < 20) return;
    pts.push({ x: s.x, y: s.y });
    meta.push({ kerbEdge: s.kerbEdge ?? null });
  }

  function wayAt(w) {
    const ways = P.getWays(project());
    const tol = tolMm();
    for (let i = ways.length - 1; i >= 0; i--) {
      const g = P.wayGeometry(project(), ways[i]);
      if (g.pieces.some((pc) => G.pointInPolygon(w, pc.ring))) return ways[i];
      for (let k = 0; k + 1 < g.centre.length; k++) if (G.projectToSegment(w, g.centre[k], g.centre[k + 1]).d <= ways[i].widthMm / 2 + tol * 0.5) return ways[i];
    }
    return null;
  }

  function pointerDown(w, mods = {}) {
    if (paveState.mode === 'draw') {
      let s = withLock(snap(w, mods), mods);
      hover = s;
      // Closing onto the first point of a draft with three or more points finishes it.
      if (pts.length >= 2 && dist(s, pts.at(-1)) <= tolMm() * 0.6) { finish(); return true; }
      pushPoint(s);
      // A click on the kerb ends a road or driveway that was started elsewhere (the house end first).
      if (pts.length >= 2 && s.kind === 'kerb' && meta[0]?.kerbEdge == null) { finish(); return true; }
      rubber = s;
      redraw();
      return true;
    }
    const sel = selectedWay();
    if (sel) {
      const tol = tolMm();
      const q = sel.pts;
      for (let i = 0; i < q.length; i++) {
        if (dist(w, q[i]) <= tol) { drag = { kind: 'vertex', id: sel.id, index: i, pts: q.map((p) => ({ ...p })), moved: false, screen: mods.screen || null }; activeVertex = i; redraw(); return true; }
      }
      for (let i = 0; i + 1 < q.length; i++) {
        const mid = { x: (q[i].x + q[i + 1].x) / 2, y: (q[i].y + q[i + 1].y) / 2 };
        if (dist(w, mid) <= tol * 0.85 && dist(q[i], q[i + 1]) > tol * 3) {
          const np = q.map((p) => ({ ...p }));
          np.splice(i + 1, 0, { x: Math.round(mid.x), y: Math.round(mid.y) });
          drag = { kind: 'vertex', id: sel.id, index: i + 1, pts: np, inserted: true, moved: false, screen: mods.screen || null };
          activeVertex = i + 1;
          return true;
        }
      }
    }
    const hit = wayAt(w);
    if (hit) {
      setPaveState({ selected: hit.id });
      activeVertex = null;
      drag = { kind: 'move', id: hit.id, start: w, pts: hit.pts.map((p) => ({ ...p })), dx: 0, dy: 0, moved: false, screen: mods.screen || null };
      redraw();
      return true;
    }
    if (paveState.selected) { setPaveState({ selected: null }); activeVertex = null; redraw(); }
    return false;
  }

  const movedEnough = (d, mods) => d.moved || !d.screen || !mods.screen || Math.hypot(mods.screen.x - d.screen.x, mods.screen.y - d.screen.y) >= DRAG_PX;

  function pointerMove(w, mods = {}) {
    if (drag) {
      if (!movedEnough(drag, mods)) return;
      drag.moved = true;
      if (drag.kind === 'vertex') {
        const s = snap(w, mods, drag.id);
        drag.pts = drag.pts.map((p, i) => (i === drag.index ? { x: s.x, y: s.y } : p));
        drag.snap = s; hover = s;
      } else {
        drag.dx = w.x - drag.start.x; drag.dy = w.y - drag.start.y;
        hover = null;
      }
      redraw();
      return;
    }
    if (paveState.mode === 'draw') {
      const s = withLock(snap(w, mods), mods);
      hover = s;
      rubber = pts.length ? s : null;
      redraw();
    } else if (hover) { hover = null; redraw(); }
  }

  function pointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) { redraw(); return; }
    if (d.kind === 'vertex') {
      const p = d.pts[d.index];
      if (d.inserted) edit('Add corner', (pr) => { P.insertVertex(pr, d.id, d.index - 1, d.pts[d.index]); P.moveVertex(pr, d.id, d.index, p); });
      else edit('Move corner', (pr) => P.moveVertex(pr, d.id, d.index, p));
      const way = P.getWay(project(), d.id);
      if (way && d.index === 0 && way.kerbEdge == null && d.snap?.kind === 'kerb') {
        edit('Start at the kerb', (pr) => { const e = pr.site.paved.find((x) => x.id === d.id); e.kerbEdge = d.snap.kerbEdge; P.updateWay(pr, d.id, {}); });
        say('Now starts at the kerb, with a crossover.', 'ok');
      }
    } else if (d.dx || d.dy) {
      edit('Move driveway or road', (pr) => {
        for (let i = 0; i < d.pts.length; i++) P.moveVertex(pr, d.id, i, { x: d.pts[i].x + d.dx, y: d.pts[i].y + d.dy });
      });
    }
    redraw();
  }

  function dblClick(w) {
    if (paveState.mode === 'draw') { if (pts.length >= 2) finishAfterDouble(); return; }
    const sel = selectedWay();
    if (!sel) return;
    const tol = tolMm();
    const vi = sel.pts.findIndex((p) => dist(p, w) <= tol);
    if (vi >= 0) { removeVertexOf(sel.id, vi); return; }
    for (let i = 0; i + 1 < sel.pts.length; i++) {
      if (G.projectToSegment(w, sel.pts[i], sel.pts[i + 1]).d <= Math.max(tol, sel.widthMm / 2)) {
        edit('Add corner', (pr) => P.insertVertex(pr, sel.id, i, w));
        redraw();
        return;
      }
    }
  }

  // The first click of a double click already added the point, and so did the second: drop the duplicate before finishing.
  function finishAfterDouble() {
    if (pts.length >= 2 && dist(pts.at(-1), pts.at(-2)) < 20) { pts.pop(); meta.pop(); }
    finish();
  }

  function cancel() {
    if (drag) { drag = null; redraw(); return true; }
    if (pts.length) { pts = []; meta = []; rubber = null; redraw(); return true; }
    return false;
  }

  /** Returns true when the key was used. */
  function keyDown(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') {
      if (cancel()) return true;
      if (paveState.selected) { setPaveState({ selected: null }); activeVertex = null; redraw(); return true; }
      return false;
    }
    if (k === 'Enter') { if (paveState.mode === 'draw' && pts.length >= 2) { finish(); return true; } return false; }
    if (k === 'a' && !e.altKey) { cancel(); setPaveState({ mode: 'draw', selected: null }); redraw(); return true; }
    if (k === 'e' && !e.altKey) { cancel(); setPaveState({ mode: 'edit' }); redraw(); return true; }
    if (k === '[' || k === ']') { setWidth(((selectedWay() || (pts.length ? { widthMm: widthNow() } : null))?.widthMm ?? widthNow()) + (k === ']' ? 250 : -250)); return true; }
    if (k === 'Backspace' && paveState.mode === 'draw' && pts.length) { pts.pop(); meta.pop(); rubber = pts.length ? rubber : null; redraw(); return true; }
    const sel = selectedWay();
    if (!sel || paveState.mode !== 'edit') return false;
    if (k === 'Delete' || k === 'Backspace') {
      if (activeVertex != null && sel.pts.length > 2) removeVertexOf(sel.id, activeVertex);
      else remove(sel.id);
      return true;
    }
    return false;
  }

  // Draft for the renderers ---------------------------------------------------------------------------------------------------

  function geomFor(way) {
    const key = JSON.stringify([way, project().site?.lot?.boundary?.length, project().updatedAt]);
    if (cache.key === key) return cache.value;
    const value = P.wayGeometry(project(), way);
    cache.key = key; cache.value = value;
    return value;
  }

  const segLabels = (ptsList) => ptsList.slice(0, -1).map((a, i) => ({ a, b: ptsList[i + 1] })).filter(({ a, b }) => dist(a, b) * scale() > 40).map(({ a, b }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: fmtM(dist(a, b) / 1000) }));

  /**
   * What to draw: { mode, kind, material, widthMm, draft: way | null, geom, readout, labels, snap, selected: { way, geom } | null, handles, ghost }
   * `draft` is the way being drawn or dragged (its geometry in `geom`); `selected` is the stored way that is selected.
   */
  function draft() {
    const out = { mode: paveState.mode, kind: kind(), material: paveState.material, widthMm: widthNow(), draft: null, geom: null, readout: '', labels: [], snap: null, selected: null, handles: [], ghost: null, warn: [] };
    const sel = selectedWay();
    const mat = paveState.material || P.defaultMaterial(project(), kind());
    out.material = mat;
    if (sel) out.selected = { way: sel, geom: geomFor(sel) };
    if (drag?.moved) {
      const base = sel || { kind: kind(), material: mat, widthMm: widthNow(), radiusMm: paveState.radiusMm, kerbEdge: null, heads: [] };
      const ptsNow = drag.kind === 'vertex' ? drag.pts : drag.pts.map((p) => ({ x: p.x + drag.dx, y: p.y + drag.dy }));
      const way = P.legalWay(project(), { ...base, pts: ptsNow });
      if (way?.pts?.length >= 2) { out.draft = way; out.geom = geomFor(way); out.ghost = sel ? out.selected.geom.outline : null; }
    } else if (paveState.mode === 'draw' && pts.length) {
      const ptsNow = rubber ? [...pts, { x: rubber.x, y: rubber.y }] : pts.slice();
      if (ptsNow.length >= 2) {
        const way = { id: 'draft', kind: kind(), material: mat, widthMm: widthNow(), radiusMm: paveState.radiusMm, pts: ptsNow, kerbEdge: meta[0]?.kerbEdge ?? null, heads: [] };
        const legal = P.legalWay(project(), way);
        if (legal?.pts?.length >= 2) { out.draft = legal; out.geom = geomFor(legal); }
      }
    }
    if (out.draft && out.geom) {
      out.readout = `${P.MATERIALS[out.draft.material].label} ${fmtM1(out.draft.widthMm / 1000)} wide, ${fmtM1(out.geom.lengthMm / 1000)} long, ${fmtA(out.geom.areaM2)}`;
      out.labels = segLabels(out.draft.pts);
      if (out.geom.minRadiusM != null && out.geom.minRadiusM < 4 && out.draft.radiusMm > 0 && out.draft.kind === 'driveway') out.warn.push(`Tight bend, ${fmtM1(out.geom.minRadiusM)} radius. Cars need about 4 m or more.`);
    } else if (paveState.mode === 'draw' && pts.length === 1 && rubber) {
      out.readout = fmtM(dist(pts[0], rubber) / 1000);
    }
    if (hover && (paveState.mode === 'draw' || drag)) out.snap = { x: hover.x, y: hover.y, kind: hover.kind, text: hover.text };
    if (paveState.mode === 'edit' && sel && !(drag?.kind === 'move' && drag.moved)) {
      const q = drag?.kind === 'vertex' ? drag.pts : sel.pts;
      q.forEach((p, i) => {
        out.handles.push({ x: p.x, y: p.y, kind: 'vertex', index: i, active: i === activeVertex, kerb: i === 0 && sel.kerbEdge != null });
        const n = q[i + 1];
        if (n && dist(p, n) * scale() > 36) out.handles.push({ x: (p.x + n.x) / 2, y: (p.y + n.y) / 2, kind: 'mid', index: i });
      });
    }
    if (paveState.mode === 'draw' && pts.length) pts.forEach((p, i) => out.handles.push({ x: p.x, y: p.y, kind: 'draft', index: i, kerb: !!meta[i]?.kerbEdge && meta[i].kerbEdge !== null }));
    return out;
  }

  function reset() { drag = null; pts = []; meta = []; rubber = null; hover = null; activeVertex = null; cache.key = ''; }

  function hint() {
    if (paveState.mode === 'edit') {
      const sel = selectedWay();
      return sel ? `Selected: ${P.MATERIALS[sel.material].label.toLowerCase()} ${P.KINDS[sel.kind].label.toLowerCase()}. Drag a point to move it, drag a dot to add a point, double click a point to remove it, Delete removes. A starts a new one.` : PAVE_MODES[1].hint;
    }
    if (!pts.length) return 'Click the first point. A click in the verge snaps to the kerb and adds the crossover. The garage door and the ends of other pavement snap too.';
    const g = pts.length >= 2 ? P.pathLength(pts) / 1000 : 0;
    return `${pts.length} point${pts.length === 1 ? '' : 's'}${g ? `, ${fmtM1(g)} so far` : ''}. Click the next point, a click on the kerb or double click or Enter finishes. Backspace removes the last. [ ] width ${fmtM1(widthNow() / 1000)}.`;
  }

  return {
    pointerDown, pointerMove, pointerUp, dblClick, keyDown, cancel, draft, reset, hint,
    finish, setWidth, setMaterial, setRadius, setKind, addHead, removeHead, splitAtActive, joinTouching, remove, removeVertexOf, startAtDoor,
    selectedWay,
    get busy() { return !!drag || pts.length > 0; },
    get activeVertex() { return activeVertex; },
    get draftPoints() { return pts.slice(); },
    dispose() {},
  };
}
