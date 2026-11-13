// Commercial row tool (2D). Press a unit and drag to slide its row, drag the gold ring to turn it (free, Shift snaps to 15 degrees,
// squares up within 3 degrees of a right angle). Rows snap their corners to other rows (within 300 mm) and to the 100 mm grid. A
// mirrored row follows its source. Arrow keys nudge 0.1 m (Shift 1 m), Q and E turn 1 degree, Delete removes the row. One undo step per drag.
// Follows src/editor2d/tool-movehouse.js.

import * as G from '../../model/geometry.js';
import { layoutUnits, rowPoly } from '../layout.js';
import { rowHandle } from '../draw2d.js';
import { regenerate, commercialEdit } from '../mode.js';
import { deleteRow } from './row-ops.js';

const DRAG_START_PX = 3;
const HANDLE_PX = 16;
const SNAP_MM = 300;

export const turnAngle = (deg, shift = false) => {
  if (shift) return Math.round(deg / 15) * 15;
  const r = Math.round(deg * 10) / 10;
  const q = Math.round(r / 90) * 90;
  return Math.abs(r - q) <= 3 ? q : r;
};

/** The source row id for a row id (a mirrored row is moved through its source). */
export const sourceId = (c, id) => { const r = c.rows.find((x) => x.id === id); return r?.mirrorOf && c.rows.some((x) => x.id === r.mirrorOf) ? r.mirrorOf : id; };

/** The row under a world point, or null. */
export function rowAt(project, p) {
  const c = project.commercial;
  if (!c) return null;
  for (const r of c.rows) if (G.pointInPolygon(p, rowPoly(r, c.rows))) return r;
  return null;
}

/** Snap a moved row origin so its corners meet other rows' corners, else the 100 mm grid. */
export function snapRowOrigin(project, rowId, o) {
  const c = project.commercial;
  const row = c.rows.find((r) => r.id === rowId);
  const others = c.rows.filter((r) => r.id !== rowId && r.mirrorOf !== rowId && rowId !== r.mirrorOf).flatMap((r) => rowPoly(r, c.rows));
  const trial = structuredClone(row);
  trial.x = o.x; trial.y = o.y;
  const mine = rowPoly(trial, c.rows.map((r) => (r.id === rowId ? trial : r)));
  let best = null;
  for (const a of mine) for (const b of others) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= SNAP_MM && (!best || d < best.d)) best = { d, dx: b.x - a.x, dy: b.y - a.y };
  }
  if (best) return { x: Math.round(o.x + best.dx), y: Math.round(o.y + best.dy), snapped: true };
  return { x: Math.round(o.x / 100) * 100, y: Math.round(o.y / 100) * 100, snapped: false };
}

export function createCommercialTool(ed) {
  const { store } = ed;
  let drag = null;
  let over = null;
  const isOn = () => store.project.mode === 'commercial' && !!store.project.commercial;
  const setSel = (id) => { store.setUI({ commercialRow: id }); ed.draw(); };
  const selected = () => store.project.commercial?.rows.find((r) => r.id === store.ui.commercialRow) || null;
  const ringHit = (ev) => {
    const row = selected();
    if (!row || row.mirrorOf) return null;
    const h = rowHandle(row, store.project.commercial.rows);
    const s = ed.toScreen(h.handle);
    return Math.hypot(s.x - ev.screen.x, s.y - ev.screen.y) <= HANDLE_PX ? h : null;
  };
  const angleAt = (ev, centre) => { const c = ed.toScreen(centre); return (Math.atan2(ev.screen.y - c.y, ev.screen.x - c.x) * 180) / Math.PI; };

  const moveRow = (p, id, x, y) => { const r = p.commercial.rows.find((q) => q.id === id); r.x = x; r.y = y; regenerate(p); };
  const turnRow = (p, id, deg, base) => {
    const r = p.commercial.rows.find((q) => q.id === id);
    r.rotationDeg = base + deg; regenerate(p);
  };

  const tool = {
    id: 'commercial',
    cursor: () => (drag?.moved ? 'grabbing' : over === 'ring' ? 'grab' : over === 'row' ? 'move' : 'default'),
    hint: () => 'Drag a unit to slide its row, drag the gold ring to turn it, Shift for 15 degree steps. Arrow keys nudge 0.1 m (Shift 1 m), Q and E turn 1 degree, Delete removes the row.',
    activate() { ed.state.selectedRow = store.ui.commercialRow || null; },
    deactivate() { drag = null; over = null; ed.clearPreview(); },
    pointerDown(ev) {
      if (!isOn()) { ed.startPan(ev); return; }
      const ring = ringHit(ev);
      const row = selected();
      if (ring && row) {
        drag = { mode: 'turn', id: row.id, base: row.rotationDeg || 0, centre: ring.centre, a0: angleAt(ev, ring.centre), total: 0, prev: null, deg: 0, moved: false, startScreen: ev.screen };
        return;
      }
      const hit = rowAt(store.project, ev.world);
      if (hit) {
        const id = sourceId(store.project.commercial, hit.id);
        setSel(hit.id);
        const src = store.project.commercial.rows.find((r) => r.id === id);
        drag = { mode: 'move', id, start: ev.world, ox: src.x, oy: src.y, x: src.x, y: src.y, moved: false, startScreen: ev.screen };
        return;
      }
      setSel(null);
      ed.startPan(ev);
    },
    pointerMove(ev) {
      if (!isOn()) return;
      if (!drag) {
        const next = ringHit(ev) ? 'ring' : rowAt(ed.project(), ev.world) ? 'row' : null;
        if (next !== over) { over = next; ed.canvas.style.cursor = tool.cursor(); }
        return;
      }
      if (!(ev.raw.buttons & 1)) return;
      if (!drag.moved) {
        if (Math.hypot(ev.screen.x - drag.startScreen.x, ev.screen.y - drag.startScreen.y) < DRAG_START_PX) return;
        drag.moved = true;
        ed.canvas.style.cursor = 'grabbing';
      }
      if (drag.mode === 'move') {
        const s = snapRowOrigin(store.project, drag.id, { x: drag.ox + (ev.world.x - drag.start.x), y: drag.oy + (ev.world.y - drag.start.y) });
        if (s.x === drag.x && s.y === drag.y) return;
        drag.x = s.x; drag.y = s.y;
        ed.previewFn((p) => moveRow(p, drag.id, s.x, s.y));
      } else {
        let d = angleAt(ev, drag.centre) - drag.a0;
        d = ((d + 540) % 360) - 180;
        drag.total = drag.prev == null ? d : drag.total + (((d - drag.prev + 540) % 360) - 180);
        drag.prev = d;
        const deg = ev.shift ? turnAngle(drag.base + drag.total, true) - drag.base : turnAngle(drag.base + drag.total) - drag.base;
        if (deg === drag.deg) return;
        drag.deg = deg;
        ed.previewFn((p) => turnRow(p, drag.id, deg, drag.base));
      }
    },
    pointerUp() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) {
        try {
          if (d.mode === 'move' && (d.x !== d.ox || d.y !== d.oy)) ed.apply('Move row', (p) => moveRow(p, d.id, d.x, d.y));
          else if (d.mode === 'turn' && d.deg) ed.apply('Rotate row', (p) => turnRow(p, d.id, d.deg, d.base));
        } finally { ed.clearPreview(); }
      }
      ed.canvas.style.cursor = tool.cursor();
      ed.draw();
    },
    cancel() { if (!drag) return false; drag = null; ed.clearPreview(); return true; },
    keyDown(e) {
      if (!isOn()) return false;
      const row = selected();
      if (!row) return false;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const id = sourceId(store.project.commercial, row.id);
      if (k === 'Delete' || k === 'Backspace') { deleteRow(store, row.id); store.setUI({ commercialRow: null }); return true; }
      if (k === 'q' || k === 'e') { ed.apply('Rotate row', (p) => turnRow(p, id, k === 'e' ? 1 : -1, p.commercial.rows.find((r) => r.id === id).rotationDeg || 0)); return true; }
      if (k.startsWith('Arrow')) {
        const step = e.shiftKey ? 1000 : 100;
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        ed.apply('Move row', (p) => { const r = p.commercial.rows.find((q) => q.id === id); moveRow(p, id, r.x + dx, r.y + dy); });
        return true;
      }
      return false;
    },
  };
  store.on('ui', (patch = {}) => { if ('commercialRow' in patch) ed.state.selectedRow = patch.commercialRow; });
  return { commercial: tool };
}

export { layoutUnits, commercialEdit };
