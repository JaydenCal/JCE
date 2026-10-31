// Select tool: click to select, drag to move, slide openings, reshape walls.

import * as G from '../model/geometry.js';
import * as M from './math.js';
import { moveEndpoint, patchStair } from './edit.js';
import { drawTag, fmtDim } from './draw-annot.js';
import { rotationStep } from './tools-meta.js';

const DRAG_START_PX = 4;
const GRIP_PX = 10;

export function createSelectTool(ed) {
  const { store } = ed;
  let drag = null;

  const levelOf = (p) => p.levels.find((l) => l.id === store.ui.activeLevelId) || p.levels[0];
  const rotNorm = (r) => ((Math.round(r * 100) / 100 % 360) + 360) % 360;

  function snapDelta(ev, orig) {
    const target = ed.snap({ x: orig.x + (ev.world.x - drag.start.x), y: orig.y + (ev.world.y - drag.start.y) }, { alt: ev.alt, endpoints: false });
    return { dx: Math.round(target.x - orig.x), dy: Math.round(target.y - orig.y) };
  }

  function begin(hit, ev) {
    const item = hit.item;
    const base = { hit, id: hit.id, start: ev.world, startScreen: ev.screen, moved: false };
    if (hit.kind === 'furniture' || hit.kind === 'stair' || hit.kind === 'tank') return { ...base, mode: 'item', orig: { x: item.x, y: item.y } };
    if (hit.kind === 'opening') {
      const wall = store.level().walls.find((w) => w.id === item.wallId);
      const along = G.projectToSegment(ev.world, wall.a, wall.b).tRaw * G.wallLength(wall);
      return { ...base, mode: 'slide', wallId: wall.id, grab: along - item.offset };
    }
    if (hit.kind === 'wall') return { ...base, mode: 'wall', dir: G.wallNormal(item) };
    if (hit.kind === 'room' && item.outdoor) return { ...base, mode: 'room', orig: G.polygonCentroid(item.polygon) };
    return { ...base, mode: 'none' };
  }

  function update(ev) {
    if (drag.mode === 'item' || drag.mode === 'room') {
      const { dx, dy } = snapDelta(ev, drag.orig);
      if (dx === drag.dx && dy === drag.dy) return;
      drag.dx = dx;
      drag.dy = dy;
      ed.previewOp('move', { id: drag.id, dx, dy });
    } else if (drag.mode === 'slide') {
      const wall = store.level().walls.find((w) => w.id === drag.wallId);
      const offset = Math.round(M.slideOffset(wall, ev.world, drag.grab, { snapMm: ed.snapMm(), snapOn: ed.snapOn(), alt: ev.alt }));
      if (offset === drag.offset) return;
      drag.offset = offset;
      drag.valid = !!ed.previewOp('update_opening', { id: drag.id, offset });
    } else if (drag.mode === 'wall') {
      const raw = G.dot(G.sub(ev.world, drag.start), drag.dir);
      const step = ed.snapOn() && !ev.alt ? ed.snapMm() : 1;
      const d = Math.round(raw / step) * step;
      if (d === drag.d) return;
      drag.d = d;
      drag.dx = Math.round(drag.dir.x * d);
      drag.dy = Math.round(drag.dir.y * d);
      ed.previewOp('move_wall', { id: drag.id, dx: drag.dx, dy: drag.dy });
    } else if (drag.mode === 'endpoint') {
      const wall = store.level().walls.find((w) => w.id === drag.id);
      const other = drag.end === 'a' ? wall.b : wall.a;
      let to = ed.snap(ev.world, { alt: ev.alt, extraPoints: [] });
      if (ev.shift) to = M.constrainPoint(other, ev.world, { stepDeg: 15, snapMm: ed.snapOn() && !ev.alt ? ed.snapMm() : 0 });
      if (drag.to && drag.to.x === to.x && drag.to.y === to.y) return;
      drag.to = to;
      ed.previewFn((p) => moveEndpoint(p, levelOf(p), drag.from, to));
    }
  }

  function commit(d) {
    if (d.mode === 'item') {
      if (!(d.dx || d.dy)) return;
      const it = d.hit.item;
      if (d.hit.kind === 'furniture') ed.run('update_furniture', { id: d.id, x: it.x + d.dx, y: it.y + d.dy });
      else if (d.hit.kind === 'tank') ed.run('update_tank', { id: d.id, x: it.x + d.dx, y: it.y + d.dy });
      else ed.run('move', { id: d.id, dx: d.dx, dy: d.dy });
    } else if (d.mode === 'room') {
      if (d.dx || d.dy) ed.run('move', { id: d.id, dx: d.dx, dy: d.dy });
    } else if (d.mode === 'slide') {
      if (d.offset != null && d.offset !== Math.round(d.hit.item.offset)) ed.run('update_opening', { id: d.id, offset: d.offset });
    } else if (d.mode === 'wall') {
      if (d.dx || d.dy) ed.run('move_wall', { id: d.id, dx: d.dx, dy: d.dy });
    } else if (d.mode === 'endpoint') {
      if (d.to && !(d.to.x === d.from.x && d.to.y === d.from.y)) ed.apply('Move wall end', (p) => moveEndpoint(p, levelOf(p), d.from, d.to));
    }
  }

  function rotateSelected(sel, step) {
    const it = sel.item;
    if (sel.kind === 'furniture') ed.run('update_furniture', { id: it.id, rotation: rotNorm((it.rotation || 0) + step) });
    else ed.apply('Rotate stairs', (p) => patchStair(p, it.id, { rotation: (it.rotation || 0) + step }));
  }

  const tool = {
    id: 'select',
    cursor: () => (drag?.moved ? 'grabbing' : ed.state.hover ? 'pointer' : 'default'),
    hint: () => 'Click to select. Drag to move. Drag a wall or its ends to reshape. Right drag pans, right click measures. Comma and full stop rotate. Hold Q for the inventory wheel.',
    // Shift and scroll rotates selected furniture or stairs.
    canRotate() {
      const sel = store.ui.selection ? store.find(store.ui.selection) : null;
      return !!sel && (sel.kind === 'furniture' || sel.kind === 'stair');
    },
    rotateBy(deg) {
      const sel = store.ui.selection ? store.find(store.ui.selection) : null;
      if (sel && (sel.kind === 'furniture' || sel.kind === 'stair')) rotateSelected(sel, deg);
    },

    pointerDown(ev) {
      const sel = store.ui.selection ? store.find(store.ui.selection) : null;
      if (sel?.kind === 'wall') {
        for (const end of ['a', 'b']) {
          const s = ed.toScreen(sel.item[end]);
          if (Math.hypot(s.x - ev.screen.x, s.y - ev.screen.y) <= GRIP_PX) {
            drag = { mode: 'endpoint', id: sel.item.id, end, from: { ...sel.item[end] }, startScreen: ev.screen, start: ev.world, moved: false };
            return;
          }
        }
      }
      const hit = ed.hit(ev.world);
      if (!hit) {
        ed.select(null);
        ed.startPan(ev);
        return;
      }
      ed.select(hit.id);
      drag = begin(hit, ev);
    },

    pointerMove(ev) {
      if (!drag || !(ev.raw.buttons & 1)) return;
      if (!drag.moved) {
        if (Math.hypot(ev.screen.x - drag.startScreen.x, ev.screen.y - drag.startScreen.y) < DRAG_START_PX) return;
        drag.moved = true;
        if (drag.mode === 'none') ed.setHint('Drag a wall to resize a room. Rooms with walls move with their walls.');
      }
      if (drag.mode !== 'none') update(ev);
    },

    pointerUp() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved) {
        try {
          commit(d);
        } finally {
          ed.clearPreview();
        }
      }
      ed.draw();
    },

    cancel() {
      if (!drag) return false;
      drag = null;
      ed.clearPreview();
      return true;
    },
    deactivate() {
      drag = null;
      ed.clearPreview();
    },

    keyDown(e) {
      const sel = store.ui.selection ? store.find(store.ui.selection) : null;
      if (!sel) return false;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const it = sel.item;
      const step = rotationStep(e);
      if (step && (sel.kind === 'furniture' || sel.kind === 'stair')) {
        rotateSelected(sel, step);
        return true;
      }
      if (k === 'Tab' && sel.kind === 'opening' && it.kind === 'door') {
        ed.run('update_opening', e.shiftKey ? { id: it.id, hinge: it.hinge === 'b' ? 'a' : 'b' } : { id: it.id, side: it.side === -1 ? 1 : -1 });
        return true;
      }
      if (k.startsWith('Arrow') && ['furniture', 'stair', 'tank'].includes(sel.kind)) {
        const step = (e.shiftKey ? 10 : 1) * ed.snapMm();
        const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
        const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
        ed.run('move', { id: it.id, dx, dy });
        return true;
      }
      return false;
    },

    draw(ctx, st) {
      if (!drag?.moved) return;
      const label = (txt, p) => {
        const s = ed.toScreen(p);
        drawTag(ctx, st, txt, s.x + 14, s.y - 16, { align: 'left' });
      };
      if (drag.mode === 'endpoint' && drag.to) {
        const s = ed.toScreen(drag.to);
        ctx.save();
        ctx.strokeStyle = st.theme.c.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const w = ed.project().levels.find((l) => l.id === store.ui.activeLevelId)?.walls.find((x) => x.id === drag.id);
        if (w) label(fmtDim(G.wallLength(w)), drag.to);
      } else if (drag.mode === 'wall' && drag.d) {
        label(`${drag.d > 0 ? '+' : ''}${fmtDim(drag.d)}`, drag.hit.item.a);
      } else if ((drag.mode === 'item' || drag.mode === 'room') && (drag.dx || drag.dy)) {
        label(`${fmtDim(drag.dx)}, ${fmtDim(drag.dy)}`, ed.state.pointer?.world || drag.start);
      }
    },
  };
  return { select: tool };
}
