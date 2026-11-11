// Move house tool: the default plan tool once a lot is loaded and the house is placed. Press anywhere on the house (rooms, alfresco,
// garage) and drag to slide the whole house; drag the gold ring handle to turn it about its centre (free by default, Shift snaps to
// 15 degrees). Arrow keys nudge 0.1 m (Shift 1 m), Q and E turn 1 degree. Clearances to the boundaries and the breach colouring come
// from the lot plan drawing and follow the preview live. One undo step per drag. Walls and rooms are reshaped with the Select tool.

import * as G from '../model/geometry.js';
import { translateHouse, rotateHouse, houseCentre, lotOf, footprint } from '../model/placement.js';
import { ringOf } from './draw-lotplan.js';

const DRAG_START_PX = 3;
const HANDLE_PX = 16;
const HINT_KEY = 'ps.movehouse.hinted';

/** Angle snap: free (to 0.1 degree) by default, 15 degree steps with Shift. */
export const turnAngle = (deg, shift = false) => (shift ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10);

/** True when the world point is on the house: inside a room on any level, or on an exterior wall body. */
export function onHouse(project, p) {
  for (const l of project.levels || []) {
    for (const r of l.rooms || []) {
      if (r.status === 'demolish' || !Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      if (G.pointInPolygon(p, r.polygon)) return true;
    }
    for (const w of l.walls || []) {
      if (w.kind !== 'exterior' || w.status === 'demolish') continue;
      try { if (G.pointInPolygon(p, G.wallPolygon(w))) return true; } catch { /* degenerate wall */ }
    }
  }
  return false;
}

/** The tool applies when a lot is loaded and there is a building on it. */
export const canMoveHouse = (project) => !!lotOf(project) && !!footprint(project);

export function createMoveHouseTool(ed) {
  const { store } = ed;
  let drag = null;
  let rot = 0; // degrees the ring handle has turned this session (only positions the handle)
  let over = null; // 'house' | 'ring' | null, for the cursor
  let chip = null;

  const hinted = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
  const markHinted = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked */ } };
  const hideChip = () => { chip?.remove(); chip = null; };
  const showChip = () => {
    if (chip || hinted() || !canMoveHouse(store.project)) return;
    chip = document.createElement('div');
    chip.className = 'ps-movehint';
    chip.dataset.ps = 'movehouse-hint';
    chip.textContent = 'Drag to move, ring to rotate';
    ed.overlay.append(chip);
  };
  const setOverlay = (r) => { ed.state.overlay = r == null ? null : { arrange: true, rotation: r }; ed.draw(); };
  const ringHit = (ev, project) => {
    const ring = ringOf(project, rot);
    if (!ring) return null;
    const s = ed.toScreen(ring.handle);
    return Math.hypot(s.x - ev.screen.x, s.y - ev.screen.y) <= HANDLE_PX ? ring : null;
  };
  const angleAt = (ev, centre) => {
    const c = ed.toScreen(centre);
    return (Math.atan2(ev.screen.y - c.y, ev.screen.x - c.x) * 180) / Math.PI;
  };

  function update(ev) {
    if (drag.mode === 'move') {
      const dx = Math.round(ev.world.x - drag.start.x);
      const dy = Math.round(ev.world.y - drag.start.y);
      if (dx === drag.dx && dy === drag.dy) return;
      drag.dx = dx;
      drag.dy = dy;
      ed.previewFn((p) => translateHouse(p, dx, dy));
    } else {
      let d = angleAt(ev, drag.centre) - drag.a0;
      d = ((d + 540) % 360) - 180; // shortest way round, so crossing the top does not jump
      drag.total = drag.prev == null ? d : drag.total + (((d - drag.prev + 540) % 360) - 180);
      drag.prev = d;
      const deg = turnAngle(drag.total, ev.shift);
      if (deg === drag.deg) return;
      drag.deg = deg;
      setOverlay(rot + deg);
      ed.previewFn((p) => rotateHouse(p, deg, drag.centre));
    }
  }

  function commit(d) {
    if (d.mode === 'move' && (d.dx || d.dy)) ed.apply('Move house', (p) => translateHouse(p, d.dx, d.dy));
    else if (d.mode === 'turn' && d.deg) {
      ed.apply('Rotate house', (p) => rotateHouse(p, d.deg, d.centre));
      rot = (((rot + d.deg) % 360) + 360) % 360;
      setOverlay(rot);
    }
  }

  const tool = {
    id: 'movehouse',
    cursor: () => (drag?.moved ? 'grabbing' : over === 'ring' ? 'grab' : over === 'house' ? 'move' : 'default'),
    hint: () => 'Drag the house to move it. Drag the gold ring to turn it, Shift for 15 degree steps. Arrow keys nudge 0.1 m (Shift 1 m), Q and E turn 1 degree. Choose Select (V) to reshape walls and rooms.',
    activate() {
      rot = 0;
      setOverlay(rot);
      showChip();
    },
    deactivate() {
      drag = null;
      over = null;
      hideChip();
      ed.clearPreview();
      setOverlay(null);
    },
    pointerDown(ev) {
      const project = store.project;
      if (!canMoveHouse(project)) { ed.startPan(ev); return; }
      const ring = ringHit(ev, project);
      if (ring) {
        drag = { mode: 'turn', centre: ring.centre, a0: angleAt(ev, ring.centre), total: 0, prev: null, deg: 0, moved: false, startScreen: ev.screen };
        return;
      }
      if (onHouse(project, ev.world)) {
        drag = { mode: 'move', start: ev.world, dx: 0, dy: 0, moved: false, startScreen: ev.screen };
        return;
      }
      ed.select(null);
      ed.startPan(ev);
    },
    pointerMove(ev) {
      if (!drag) {
        const next = ringHit(ev, ed.project()) ? 'ring' : onHouse(ed.project(), ev.world) ? 'house' : null;
        if (next !== over) {
          over = next;
          ed.canvas.style.cursor = tool.cursor();
        }
        return;
      }
      if (!(ev.raw.buttons & 1)) return;
      if (!drag.moved) {
        if (Math.hypot(ev.screen.x - drag.startScreen.x, ev.screen.y - drag.startScreen.y) < DRAG_START_PX) return;
        drag.moved = true;
        hideChip();
        markHinted();
        ed.canvas.style.cursor = 'grabbing';
      }
      update(ev);
    },
    pointerUp() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) {
        try { commit(d); } finally { ed.clearPreview(); }
      }
      ed.canvas.style.cursor = tool.cursor();
      ed.draw();
    },
    cancel() {
      if (!drag) return false;
      drag = null;
      ed.clearPreview();
      setOverlay(rot);
      return true;
    },
    keyDown(e) {
      if (!canMoveHouse(store.project)) return false;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'q' || k === 'e') {
        const deg = k === 'e' ? 1 : -1;
        ed.apply('Rotate house', (p) => rotateHouse(p, deg, houseCentre(p)));
        rot = (((rot + deg) % 360) + 360) % 360;
        setOverlay(rot);
        return true;
      }
      if (k.startsWith('Arrow')) {
        const step = e.shiftKey ? 1000 : 100;
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        ed.apply('Move house', (p) => translateHouse(p, dx, dy));
        return true;
      }
      return false;
    },
  };
  return { movehouse: tool };
}
