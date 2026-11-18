// Rotate tool (residential and commercial plan): select the building, then turn it about a visible pivot. The ring handle turns it (free,
// Shift snaps to 15 degrees), the cross is the pivot (drag it, it starts at the building centre), the gold arc shows the angle swept and
// a pill reads it out. The panel has the typed angle and the align buttons. Behaviour lives in rotate-controller.js; this file is the
// canvas side: pointer events, the selection in a commercial layout, the overlay, and the setback question after a house turn.

import { worldToScreen } from './math.js';
import { createRotateController, fmtDeg } from './rotate-controller.js';
import { lotChecks } from '../site/lot-checks.js';
import { confirmBreach, statusFromMessages } from '../flow/breach.js';
import { buildingUnder, rowAt, sourceId } from '../commercial/ui/tool-commercial.js';

const GOLD = '#c7a256';
const DARK = '#1b1b1b';

const worstShort = (project) => Math.max(0, ...lotChecks(project).messages.filter((m) => m.kind === 'envelope').map((m) => Number(m.shortByM) || 0));

export function createRotateTool(ed) {
  const { store } = ed;
  const commercial = () => store.project.mode === 'commercial' && !!store.project.commercial;
  const ctl = createRotateController({ store, scale: () => ed.view.scale, toast: (m, o) => ed.toast(m, o), redraw: () => { ed.setHint(ctl.hint()); ed.draw(); } });
  let before = 0;
  const mods = (ev) => ({ shift: ev.shift, screen: ev.screen });

  async function confirmIfBreach(was) {
    if (commercial()) return;
    try {
      const status = statusFromMessages(lotChecks(store.project).messages);
      if (!status || worstShort(store.project) <= was + 0.05) return;
      if (!(await confirmBreach(status, { what: 'house' }))) store.undo();
    } catch { /* checks need a loaded lot */ }
  }

  const tool = {
    id: 'rotate',
    controller: ctl,
    cursor: () => 'default',
    hint: () => ctl.hint(),
    activate() {
      ctl.clear();
      ed.state.selectedRow = store.ui.commercialRow || null;
    },
    deactivate() { ctl.clear(); ed.canvas.style.cursor = ''; ed.draw(); },
    pointerDown(ev) {
      if (ctl.target()) {
        before = commercial() ? 0 : safeWorst();
        if (ctl.pointerDown(ev.world, mods(ev))) return;
      }
      if (commercial()) {
        const b = buildingUnder(store.project, ev.world);
        if (b) { store.setUI({ commercialBuilding: b.id, commercialRow: null }); ed.state.selectedRow = null; ed.draw(); return; }
        const row = rowAt(store.project, ev.world);
        if (row) { const id = sourceId(store.project.commercial, row.id); store.setUI({ commercialRow: id, commercialBuilding: null }); ed.state.selectedRow = id; ed.draw(); return; }
        store.setUI({ commercialRow: null, commercialBuilding: null });
        ed.state.selectedRow = null;
      }
      ed.startPan(ev);
    },
    pointerMove(ev) {
      if (ctl.active() && !(ev.raw.buttons & 1)) return;
      ctl.pointerMove(ev.world, mods(ev));
      const h = ctl.draft()?.hover;
      ed.canvas.style.cursor = ctl.active() ? 'grabbing' : h === 'pivot' ? 'move' : h === 'handle' ? 'grab' : 'default';
    },
    pointerUp() {
      const r = ctl.pointerUp();
      ed.canvas.style.cursor = '';
      if (r?.ok && r.deg) confirmIfBreach(before);
    },
    cancel() { return ctl.cancel(); },
    keyDown(e) { return ctl.keyDown(e); },
    pointerLeave() { ed.draw(); },
    projectChanged() { ed.setHint(ctl.hint()); },
    draw(ctx, st) { drawOverlay(ctx, st, ctl.draft()); },
  };
  function safeWorst() { try { return worstShort(store.project); } catch { return 0; } }
  return { rotate: tool };
}

const S = (st, p) => worldToScreen(st.view, p);

function pill(ctx, st, text, x, y) {
  ctx.save();
  ctx.font = `700 13px ${st.theme.f.ui}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 18;
  const bx = Math.min(Math.max(8 + w / 2, x), st.size.w - w / 2 - 8);
  const by = Math.min(Math.max(20, y), st.size.h - 20);
  ctx.fillStyle = 'rgba(20,22,26,0.92)';
  ctx.beginPath();
  ctx.roundRect(bx - w / 2, by - 12, w, 24, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, bx, by + 0.5);
  ctx.restore();
}

export function drawOverlay(ctx, st, d) {
  if (!d) return;
  const c = S(st, d.pivot);
  const R = d.R * st.view.scale;
  ctx.save();
  // The building being turned.
  ctx.beginPath();
  d.target.ring.forEach((q, i) => { const s = S(st, q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  ctx.closePath();
  ctx.setLineDash([7, 4]);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);
  // The ring, with 15 degree ticks while a turn is under way.
  ctx.beginPath();
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(199,162,86,0.7)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  if (d.live) {
    ctx.strokeStyle = 'rgba(199,162,86,0.55)';
    ctx.lineWidth = 1.2;
    for (let a = 0; a < 360; a += 15) {
      const r = (a * Math.PI) / 180;
      const len = a % 90 === 0 ? 11 : 6;
      ctx.beginPath();
      ctx.moveTo(c.x + Math.cos(r) * R, c.y + Math.sin(r) * R);
      ctx.lineTo(c.x + Math.cos(r) * (R - len), c.y + Math.sin(r) * (R - len));
      ctx.stroke();
    }
  }
  // The swept arc: from where the handle started to where it is now.
  if (d.arc) {
    const a0 = (d.arc.from * Math.PI) / 180;
    const a1 = ((d.arc.from + d.arc.deg) * Math.PI) / 180;
    const ccw = d.arc.deg < 0;
    const ra = Math.max(18, R * 0.82);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, ra, a0, a1, ccw);
    ctx.closePath();
    ctx.fillStyle = 'rgba(199,162,86,0.22)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x, c.y, ra, a0, a1, ccw);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    for (const a of [a0, a1]) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(a) * ra, c.y + Math.sin(a) * ra);
      ctx.strokeStyle = a === a1 ? GOLD : 'rgba(199,162,86,0.6)';
      ctx.lineWidth = a === a1 ? 2 : 1.2;
      ctx.stroke();
    }
    const mid = a0 + (a1 - a0) / 2;
    pill(ctx, st, fmtDeg(d.arc.deg), c.x + Math.cos(mid) * (ra * 0.55), c.y + Math.sin(mid) * (ra * 0.55));
  }
  // The handle.
  const h = S(st, d.handle);
  ctx.beginPath();
  ctx.arc(h.x, h.y, d.hover === 'handle' || d.live ? 12 : 10, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.fillStyle = DARK;
  ctx.font = `700 13px ${st.theme.f.ui}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⟳', h.x, h.y + 0.5);
  // The pivot: a cross in a ring, filled when it has been moved off the centre.
  ctx.beginPath();
  ctx.arc(c.x, c.y, d.hover === 'pivot' ? 11 : 9, 0, Math.PI * 2);
  ctx.fillStyle = d.custom ? 'rgba(199,162,86,0.95)' : 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x - 14, c.y);
  ctx.lineTo(c.x + 14, c.y);
  ctx.moveTo(c.x, c.y - 14);
  ctx.lineTo(c.x, c.y + 14);
  ctx.stroke();
  ctx.restore();
}
