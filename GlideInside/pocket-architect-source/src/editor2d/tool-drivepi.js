// Driveway PI tool for the residential 2D plan: connects drivepi-controller.js to the canvas (pointer events, keys) and draws the editing
// overlay with the same handle look as the Road or pavement tool: gold dashed centreline, white squares with a gold edge for PIs,
// a gold fill for the selected PI, a green diamond for the kerb end, and the dark readout pill.

import { worldToScreen } from './math.js';
import { createDrivePIController } from './drivepi-controller.js';

const GOLD = '#c7a256';
const GREEN = '#1b8f4a';
const RED = '#e53935';

export function createDrivePITool(ed) {
  const { store } = ed;
  const ctl = createDrivePIController({ store, scale: () => ed.view.scale, toast: (m, o) => ed.toast(m, o), redraw: () => { ed.setHint(ctl.hint()); ed.draw(); } });
  const mods = (ev) => ({ alt: ev.alt, shift: ev.shift, screen: ev.screen });
  const tool = {
    id: 'drivepi',
    controller: ctl,
    cursor: () => 'default',
    hint: () => ctl.hint(),
    activate() { ctl.clear(); },
    deactivate() { ctl.clear(); ed.draw(); },
    pointerDown(ev) { if (!ctl.pointerDown(ev.world, mods(ev))) ed.startPan(ev); },
    pointerMove(ev) { ctl.pointerMove(ev.world, mods(ev)); },
    pointerUp(ev) { ctl.pointerUp(ev.world, mods(ev)); },
    dblClick(ev) { ctl.dblClick(ev.world); },
    rightClick(ev) { return ctl.rightClick(ev.world); },
    cancel() { return ctl.cancel(); },
    keyDown(e) { return ctl.keyDown(e); },
    pointerLeave() { ed.draw(); },
    projectChanged() { ed.setHint(ctl.hint()); },
    draw(ctx, st) { drawOverlay(ctx, st, ctl.draft()); },
  };
  return { drivepi: tool };
}

function trace(ctx, st, ring, close) {
  ring.forEach((p, i) => { const s = worldToScreen(st.view, p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  if (close) ctx.closePath();
}

function pill(ctx, st, lines, x, y, warn) {
  ctx.save();
  ctx.font = `600 12px ${st.theme.f.ui}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * 16 + 8;
  const bx = Math.min(Math.max(8, x), st.size.w - w - 8);
  const by = Math.min(Math.max(8, y), st.size.h - h - 8);
  ctx.fillStyle = 'rgba(20,22,26,0.9)';
  ctx.strokeStyle = warn ? RED : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 6); else ctx.rect(bx, by, w, h);
  ctx.fill(); ctx.stroke();
  lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#ffffff' : warn ? '#ffb4ad' : 'rgba(255,255,255,0.78)'; ctx.fillText(l, bx + 8, by + 12 + i * 16); });
  ctx.restore();
}

/** Draw a controller draft() over the plan. */
export function drawOverlay(ctx, st, d) {
  if (d?.drawing) { drawInProgress(ctx, st, d.drawing); return; }
  if (!d?.ok) return;
  ctx.save();
  ctx.lineJoin = 'round';
  if (d.ghost) {
    ctx.beginPath(); trace(ctx, st, d.ghost, true);
    ctx.strokeStyle = 'rgba(120,120,120,0.8)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (d.dragging) {
    ctx.beginPath(); trace(ctx, st, d.polygon, true);
    ctx.fillStyle = d.refused ? 'rgba(229,57,53,0.25)' : 'rgba(199,162,86,0.28)'; ctx.fill();
  }
  ctx.beginPath(); trace(ctx, st, d.centre, false);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.6; ctx.setLineDash([9, 5]); ctx.stroke(); ctx.setLineDash([]);
  // Hover over the line: a dot where a click adds a PI.
  if (d.hover?.kind === 'line' && !d.dragging) {
    const s = worldToScreen(st.view, d.hover.point);
    ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();
    pill(ctx, st, ['Click to add a PI'], s.x + 14, s.y + 14, false);
  }
  d.pis.forEach((q, i) => {
    const s = worldToScreen(st.view, q);
    const active = d.selected === i;
    ctx.beginPath(); ctx.rect(s.x - 5, s.y - 5, 10, 10);
    ctx.fillStyle = active ? GOLD : '#fff'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();
  });
  {
    const s = worldToScreen(st.view, d.kerb);
    ctx.beginPath(); ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x, s.y - 7); ctx.lineTo(s.x + 7, s.y); ctx.lineTo(s.x, s.y + 7); ctx.closePath();
    ctx.fillStyle = GREEN; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (d.hover?.kind === 'pi' && !d.dragging) {
    const s = worldToScreen(st.view, d.pis[d.hover.index]);
    pill(ctx, st, ['PI', 'Drag to move. Delete or right click removes it.'], s.x + 14, s.y + 14, false);
  } else if (d.dragging) {
    const anchor = worldToScreen(st.view, d.kerb);
    pill(ctx, st, d.refused ? [d.readout, d.reason] : [d.readout], anchor.x + 16, anchor.y + 16, d.refused);
  }
  ctx.restore();
}

/** A driveway being drawn: gold dashed line through the clicked points to the pointer, white squares at the points, the start on the kerb in green. */
function drawInProgress(ctx, st, dr) {
  const pts = dr.cursor ? [...dr.pts, dr.cursor] : dr.pts;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath(); trace(ctx, st, pts, false);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.8; ctx.setLineDash([9, 5]); ctx.stroke(); ctx.setLineDash([]);
  dr.pts.forEach((q, i) => {
    const s = worldToScreen(st.view, q);
    ctx.beginPath(); ctx.rect(s.x - 5, s.y - 5, 10, 10);
    ctx.fillStyle = i === 0 ? GREEN : '#fff'; ctx.fill(); ctx.strokeStyle = i === 0 ? '#fff' : GOLD; ctx.lineWidth = 2; ctx.stroke();
  });
  if (dr.cursor) {
    const s = worldToScreen(st.view, dr.cursor);
    pill(ctx, st, ['Click to add a PI', 'Double click or Enter at the building to finish'], s.x + 14, s.y + 14, false);
  }
  ctx.restore();
}
