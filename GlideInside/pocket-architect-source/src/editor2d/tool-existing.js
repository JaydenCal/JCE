// Existing building tool: click or tap to place a rectangle (default 12 by 9 m, named "Existing dwelling"), then change its name, size and rotation in the
// panel. Drag a building to move it, Delete removes it. Every change is one undo step through the registry operations.

import { existingBuildingsOf, pointInExisting, existingPoly } from '../site/existing-buildings.js';
import { worldToScreen } from './math.js';

export const DEFAULT_EXISTING = Object.freeze({ name: 'Existing dwelling', widthMm: 12000, depthMm: 9000 });

export function createExistingTool(ed) {
  const { store } = ed;
  let drag = null; // { id, start, origin:{x,y}, moved }
  let ghost = null;

  const selected = () => store.ui.existingSel || null;
  const select = (id) => store.setUI({ existingSel: id || null });
  const list = () => existingBuildingsOf(store.project);
  const hitAt = (world) => {
    const all = list();
    for (let i = all.length - 1; i >= 0; i--) if (pointInExisting(all[i], world)) return all[i];
    return null;
  };

  const tool = {
    id: 'existing',
    cursor: () => 'crosshair',
    hint: () => 'Existing building: click to place a rectangle, then set the name, size and rotation in the panel. Drag one to move it. Delete removes it.',
    pointerDown(ev) {
      const hit = hitAt(ev.world);
      if (hit) {
        select(hit.id);
        drag = { id: hit.id, start: ev.world, origin: { x: hit.x, y: hit.y }, moved: false };
        ed.draw();
        return;
      }
      const p = ed.snap(ev.world, { alt: ev.alt });
      const r = ed.run('add_existing_building', { name: DEFAULT_EXISTING.name, x: Math.round(p.x), y: Math.round(p.y), width: DEFAULT_EXISTING.widthMm, depth: DEFAULT_EXISTING.depthMm, rotation: 0 });
      if (r?.id) select(r.id);
      ghost = null;
      ed.draw();
    },
    pointerMove(ev) {
      if (drag) {
        const dx = ev.world.x - drag.start.x;
        const dy = ev.world.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * ed.view.scale < 5) return;
        drag.moved = true;
        drag.to = { x: Math.round(drag.origin.x + dx), y: Math.round(drag.origin.y + dy) };
        ed.previewOp('update_existing_building', { id: drag.id, x: drag.to.x, y: drag.to.y });
        return;
      }
      ghost = hitAt(ev.world) ? null : ed.snap(ev.world, { alt: ev.alt });
      ed.draw();
    },
    pointerUp() {
      if (!drag) return;
      const d = drag;
      drag = null;
      ed.clearPreview();
      if (d.moved && d.to) ed.run('update_existing_building', { id: d.id, x: d.to.x, y: d.to.y });
    },
    pointerLeave() { ghost = null; ed.draw(); },
    keyDown(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected() && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) {
        tool.removeSelected();
        return true;
      }
      return false;
    },
    removeSelected() {
      const id = selected();
      if (!id) return false;
      const r = ed.run('remove_existing_building', { id });
      select(null);
      return !!r;
    },
    cancel() {
      if (drag) { drag = null; ed.clearPreview(); return true; }
      if (selected()) { select(null); ed.draw(); return true; }
      return false;
    },
    deactivate() { drag = null; ghost = null; },
    draw(ctx, st) {
      const view = st.view;
      const trace = (poly) => { poly.forEach((p, i) => { const s = worldToScreen(view, p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.closePath(); };
      const sel = list().find((e) => e.id === selected());
      if (sel) {
        ctx.save();
        ctx.beginPath();
        trace(sel.poly);
        ctx.strokeStyle = st.theme.c.accent;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.restore();
      }
      if (ghost && !drag) {
        const g = { x: ghost.x, y: ghost.y, widthMm: DEFAULT_EXISTING.widthMm, depthMm: DEFAULT_EXISTING.depthMm, rotationDeg: 0 };
        ctx.save();
        ctx.beginPath();
        trace(existingPoly(g));
        ctx.strokeStyle = st.theme.c.accent;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.restore();
      }
    },
  };
  return { existing: tool };
}
