// Placement tools: doors and windows (snap to walls), furniture and rainwater tanks.

import * as G from '../model/geometry.js';
import * as M from './math.js';
import { drawOpeningSymbol, drawFurnitureSymbol, drawTank } from './draw-items.js';
import { drawTag, fmtDim } from './draw-annot.js';
import { OPENING_TOOL_KIND, KIND_LABEL, rotationStep } from './tools-meta.js';
import { drawClashOverlay } from './draw-items.js';
import { furnitureClashes } from '../model/ops.js';
import { activePreset, tankDims } from './presets.js';

export function createPlaceTools(ed) {
  const { store } = ed;
  const out = {};

  // Doors, windows and the other opening kinds ----------------------------------------------------------
  function openingTool(id, kind) {
    let ghost = null;
    let side = 1;
    let flip = 1;
    let hingeFlip = false;
    const spec = () => activePreset(ed.catalogue, kind, store.ui.toolArg);
    const hinge = () => (hingeFlip ? 'b' : 'a');

    // Exterior walls swing the door inwards. Interior walls swing towards the pointer.
    function autoSide(wall, world, point) {
      if (wall.outside) return -wall.outside * flip;
      const n = G.wallNormal(wall);
      return (G.dot(G.sub(world, point), n) >= 0 ? 1 : -1) * flip;
    }

    function locate(ev) {
      const s = spec();
      ghost = M.placeOpening(store.level(), ev.world, { kind, width: s.width }, {
        snapMm: ed.snapMm(),
        snapOn: ed.snapOn(),
        alt: ev.alt,
        reachMm: 26 / ed.view.scale,
        visible: (w) => ed.visible(w.status),
      });
      if (ghost) side = autoSide(ghost.wall, ev.world, ghost.point);
      ed.draw();
    }

    function place() {
      if (!ghost) {
        ed.toast(`Move the pointer over a wall to place the ${KIND_LABEL[kind].toLowerCase()}.`, { kind: 'info' });
        return;
      }
      if (!ghost.valid) {
        ed.toast(ghost.reason, { kind: 'warn' });
        return;
      }
      const s = spec();
      const args = { wall: ghost.wall.id, kind, offset: Math.round(ghost.offset), width: s.width, height: s.height, sill: s.sill, style: s.style, side };
      if (kind === 'door') args.hinge = hinge();
      ed.run('add_opening', args);
    }

    return {
      id,
      cursor: () => 'crosshair',
      hint: () => (kind === 'door' ? 'Click a wall to place a door. Tab flips the swing, Shift and Tab the hinge. Esc stops.' : `Click a wall to place a ${KIND_LABEL[kind].toLowerCase()}. Esc stops.`),
      pointerDown: locate,
      pointerMove: locate,
      pointerUp(ev) {
        locate(ev);
        place();
      },
      pointerLeave() {
        ghost = null;
        ed.draw();
      },
      keyDown(e) {
        if (e.key !== 'Tab' || kind !== 'door') return false;
        if (e.shiftKey) hingeFlip = !hingeFlip;
        else flip = -flip;
        if (ghost) side = -side * (e.shiftKey ? -1 : 1);
        ed.draw();
        return true;
      },
      deactivate() {
        ghost = null;
      },
      draw(ctx, st) {
        if (!ghost) return;
        const s = spec();
        const tmp = { kind, offset: ghost.offset, width: s.width, height: s.height, sill: s.sill, style: s.style, hinge: hinge(), side };
        const frame = M.openingFrame(ghost.wall, tmp);
        const t = (ghost.wall.thickness || 100) / 2;
        // clear the wall under the ghost so the symbol reads
        ctx.save();
        ctx.beginPath();
        [frame.at(frame.u0, -t), frame.at(frame.u1, -t), frame.at(frame.u1, t), frame.at(frame.u0, t)].map((p) => ed.toScreen(p)).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = st.theme.c.canvas;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.restore();
        drawOpeningSymbol(ctx, st.view, st.theme, ghost.wall, tmp, { tint: ghost.valid ? st.theme.c.accent : st.theme.c.danger });
        const c = ed.toScreen(ghost.point);
        drawTag(ctx, st, ghost.valid ? `${fmtDim(s.width)} wide` : ghost.reason, c.x, c.y - 28, { colour: ghost.valid ? undefined : st.theme.c.danger });
      },
    };
  }
  for (const [id, kind] of Object.entries(OPENING_TOOL_KIND)) out[id] = openingTool(id, kind);

  // Furniture -------------------------------------------------------------------------------------------------
  out.furniture = (() => {
    let rot = 0;
    let pos = null;
    const armed = () => (store.ui.toolArg ? ed.def(store.ui.toolArg) : null);
    const at = (ev) => {
      pos = ed.snap(ev.world, { alt: ev.alt, endpoints: false });
      ed.draw();
    };
    const turn = (step) => {
      rot = (((rot + step) % 360) + 360) % 360;
      ed.draw();
    };
    // Would the item clip a wall where the ghost is?
    const clips = (d) => {
      const level = store.level();
      const probe = { levels: [{ id: level.id, walls: level.walls, furniture: [{ id: 'ghost', item: d.id, x: pos.x, y: pos.y, rotation: rot, w: null, d: null }] }] };
      return furnitureClashes(probe, (id) => ed.def(id)).length > 0;
    };
    return {
      id: 'furniture',
      cursor: () => 'crosshair',
      activate() {
        if (!store.ui.toolArg) store.emit('plan:open-drawer');
      },
      hint() {
        const d = armed();
        return d ? `Click to place ${d.name}. Comma and full stop rotate 90 degrees, with Shift 15 degrees, or Shift and scroll. Hold Q to pick another item. Esc stops.` : 'Choose an item from the furniture drawer, or hold Q for the inventory wheel, then click the plan to place it.';
      },
      pointerDown: at,
      pointerMove: at,
      pointerUp(ev) {
        at(ev);
        const d = armed();
        if (!d) {
          ed.toast('Choose an item from the furniture drawer first.', { kind: 'info' });
          store.emit('plan:open-drawer');
          return;
        }
        ed.run('add_furniture', { item: d.id, x: pos.x, y: pos.y, rotation: rot });
      },
      pointerLeave() {
        pos = null;
        ed.draw();
      },
      keyDown(e) {
        const step = rotationStep(e);
        if (!step) return false;
        turn(step);
        return true;
      },
      canRotate: () => true,
      rotateBy: (deg) => turn(deg),
      deactivate() {
        pos = null;
      },
      draw(ctx, st) {
        const d = armed();
        if (!d || !pos) return;
        const ghost = { item: d.id, x: pos.x, y: pos.y, rotation: rot, w: null, d: null };
        const bad = clips(d);
        drawFurnitureSymbol(ctx, st.view, st.theme, d, ghost, { alpha: 0.75, tint: bad ? st.theme.c.danger : st.theme.c.accent });
        if (bad) drawClashOverlay(ctx, st.view, st.theme, d, ghost);
        const s = ed.toScreen(pos);
        drawTag(ctx, st, bad ? `${rot}°  clips a wall` : `${rot}°`, s.x, s.y - Math.max(24, (Math.max(d.w, d.d) / 2) * st.view.scale + 14), { colour: bad ? st.theme.c.danger : undefined });
      },
    };
  })();

  // Rainwater tank ---------------------------------------------------------------------------------------------
  out.tank = (() => {
    let pos = null;
    const capacity = () => Number(store.ui.toolArg) || 5000;
    const at = (ev) => {
      pos = ed.snap(ev.world, { alt: ev.alt, endpoints: false });
      ed.draw();
    };
    return {
      id: 'tank',
      cursor: () => 'crosshair',
      hint: () => (ed.isGround() ? `Click to place a ${capacity().toLocaleString('en-AU')} L rainwater tank. Choose the size in the panel.` : 'Rainwater tanks sit at ground level. Switch to the ground floor to place one.'),
      pointerDown: at,
      pointerMove: at,
      pointerUp(ev) {
        at(ev);
        if (!ed.isGround()) {
          ed.toast('Rainwater tanks sit at ground level. Switch to the ground floor to place one.', { kind: 'warn' });
          return;
        }
        ed.run('add_tank', { x: pos.x, y: pos.y, capacity_l: capacity() });
      },
      pointerLeave() {
        pos = null;
        ed.draw();
      },
      deactivate() {
        pos = null;
      },
      draw(ctx, st) {
        if (!pos) return;
        const d = tankDims(capacity());
        drawTank(ctx, st, { x: pos.x, y: pos.y, capacityL: capacity(), diameter: d.diameter, status: 'new' }, { alpha: 0.7, tint: st.theme.c.accent });
      },
    };
  })();

  return out;
}
