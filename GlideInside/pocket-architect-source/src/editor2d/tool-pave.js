// Driveway and road tool for the 2D plan (residential and commercial): click points along a polyline, with optional rounded bends, a width and
// a material, then select it to drag points, split, join and add turning heads. The behaviour lives in pave-controller.js; this file connects
// it to the plan canvas: pointer events, keys, and the draft drawn over the plan (hatched strip, centreline, point handles, snap marker, readout).

import { worldToScreen } from './math.js';
import { createPaveController } from './pave-controller.js';
import { paveState, onPaveState } from './pave-state.js';
import { paintWay } from './draw-pave.js';
import { MATERIALS } from '../site/pavedways.js';

const GOLD = '#c7a256';
const RED = '#e53935';

export function createPaveTool(ed) {
  const { store } = ed;
  let off = null;
  const ctl = createPaveController({ store, scale: () => ed.view.scale, toast: (m, o) => ed.toast(m, o), redraw: () => { ed.setHint(ctl.hint()); ed.draw(); } });
  const mods = (ev) => ({ alt: ev.alt, shift: ev.shift, screen: ev.screen });
  const tool = {
    id: 'pave',
    controller: ctl,
    cursor: () => (paveState.mode === 'edit' ? 'default' : 'crosshair'),
    hint: () => ctl.hint(),
    activate() {
      ctl.reset();
      off = onPaveState(() => { ed.setHint(ctl.hint()); ed.canvas.style.cursor = tool.cursor(); ed.draw(); });
      if (!store.project.site?.lot?.boundary?.length) ed.toast('Load a lot first so the driveway can start at the street and stay inside the boundary.', { kind: 'info' });
    },
    deactivate() { off?.(); off = null; ctl.reset(); ed.draw(); },
    pointerDown(ev) { if (!ctl.pointerDown(ev.world, mods(ev))) ed.startPan(ev); },
    pointerMove(ev) { ctl.pointerMove(ev.world, mods(ev)); },
    pointerUp(ev) { ctl.pointerUp(ev.world, mods(ev)); },
    dblClick(ev) { ctl.dblClick(ev.world); },
    modifiersChanged() { ed.draw(); },
    cancel() { return ctl.cancel(); },
    keyDown(e) { return ctl.keyDown(e); },
    pointerLeave() { ed.draw(); },
    projectChanged() { ed.setHint(ctl.hint()); },
    draw(ctx, st) { drawDraft(ctx, st, ctl.draft()); },
  };
  return { pave: tool };
}

function path(ctx, st, ring, close = true) {
  ring.forEach((p, i) => { const s = worldToScreen(st.view, p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  if (close) ctx.closePath();
}

function pill(ctx, st, lines, x, y, { warn = false } = {}) {
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
  lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#ffffff' : warn && i > 0 ? '#ffb4ad' : 'rgba(255,255,255,0.78)'; ctx.fillText(l, bx + 8, by + 12 + i * 16); });
  ctx.restore();
}

/** Draw a controller draft over the plan. */
export function drawDraft(ctx, st, d) {
  if (!d) return;
  ctx.save();
  ctx.lineJoin = 'round';
  if (d.ghost) {
    ctx.beginPath(); path(ctx, st, d.ghost);
    ctx.strokeStyle = 'rgba(120,120,120,0.8)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (d.draft && d.geom) {
    paintWay(ctx, st, d.draft, d.geom, { alpha: 0.9, warn: !!d.warn.length });
    // centreline
    ctx.beginPath(); path(ctx, st, d.geom.centre, false);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 1.6; ctx.setLineDash([9, 5]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.font = `600 11px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of d.labels) {
    const s = worldToScreen(st.view, l);
    ctx.lineWidth = 3.5; ctx.strokeStyle = st.theme.c.canvas; ctx.strokeText(l.text, s.x, s.y);
    ctx.fillStyle = st.theme.c.text; ctx.fillText(l.text, s.x, s.y);
  }
  for (const a of d.arcs || []) {
    const sa = worldToScreen(st.view, a.A); const sc = worldToScreen(st.view, a.C);
    for (const t of [sa, sc]) { ctx.beginPath(); ctx.moveTo(t.x - 3.5, t.y - 3.5); ctx.lineTo(t.x + 3.5, t.y + 3.5); ctx.moveTo(t.x + 3.5, t.y - 3.5); ctx.lineTo(t.x - 3.5, t.y + 3.5); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke(); }
  }
  if (d.areaLabel) {
    const s = worldToScreen(st.view, d.areaLabel);
    ctx.font = `700 12px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = st.theme.c.canvas; ctx.strokeText(d.areaLabel.text, s.x, s.y - 12);
    ctx.fillStyle = st.theme.c.text; ctx.fillText(d.areaLabel.text, s.x, s.y - 12);
    ctx.font = `600 11px ${st.theme.f.ui}`;
  }
  for (const hd of d.handles) {
    const s = worldToScreen(st.view, hd);
    ctx.beginPath();
    if (hd.kind === 'vertex') { ctx.rect(s.x - 5, s.y - 5, 10, 10); ctx.fillStyle = hd.active ? GOLD : hd.kerb ? '#1b8f4a' : '#fff'; ctx.fill(); ctx.strokeStyle = hd.kerb ? '#1b8f4a' : GOLD; ctx.lineWidth = 2; ctx.stroke(); }
    else if (hd.kind === 'curve') {
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fillStyle = '#c7a256'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      const tx = `R ${(Math.round(hd.radiusMm / 100) / 10).toFixed(1)} m`;
      ctx.font = `700 11px ${st.theme.f.ui}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = st.theme.c.canvas; ctx.strokeText(tx, s.x + 11, s.y); ctx.fillStyle = st.theme.c.text; ctx.fillText(tx, s.x + 11, s.y);
      continue;
    }
    else if (hd.kind === 'draft') { ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = hd.kerb ? '#1b8f4a' : '#fff'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke(); }
    else { ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke(); }
  }
  if (d.snap) {
    const s = worldToScreen(st.view, d.snap);
    ctx.beginPath();
    if (d.snap.kind === 'corner' || d.snap.kind === 'door') ctx.rect(s.x - 6, s.y - 6, 12, 12);
    else if (d.snap.kind === 'kerb' || d.snap.kind === 'end' || d.snap.kind === 'edge') { ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x, s.y - 7); ctx.lineTo(s.x + 7, s.y); ctx.lineTo(s.x, s.y + 7); ctx.closePath(); }
    else ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.strokeStyle = d.snap.kind === 'grid' || d.snap.kind === 'free' ? 'rgba(80,80,80,0.8)' : '#1b8f4a'; ctx.lineWidth = 2; ctx.stroke();
    const lines = [d.readout || '', ...d.warn, d.snap.text].filter(Boolean);
    if (lines.length) pill(ctx, st, lines, s.x + 16, s.y + 16, { warn: d.warn.length > 0 });
  } else if (d.readout && d.draft) {
    const last = d.draft.pts.at(-1);
    const s = worldToScreen(st.view, last);
    pill(ctx, st, [d.readout, ...d.warn], s.x + 16, s.y + 16, { warn: d.warn.length > 0 });
  }
  ctx.restore();
}
void MATERIALS;
