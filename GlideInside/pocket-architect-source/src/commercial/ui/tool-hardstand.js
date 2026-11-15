// Hardstand tool for the 2D plan: draw a rectangle, a polygon or fill a space with a pavement type, then select, move and reshape what was
// drawn. The behaviour lives in hardstand-controller.js (shared with the top view); this file connects it to the plan canvas: pointer events,
// keys, and the draft drawn over the plan (hatch in the pavement type, dimensions, snap marker, live readout, corner handles).

import { worldToScreen } from '../../editor2d/math.js';
import { createHardstandController } from './hardstand-controller.js';
import { hsState, onHsState, setHsState } from './hardstand-state.js';
import { drawPavementArea } from '../catalogue/pavements/draw2d.js';
import { pavementById } from '../catalogue/pavements/pavements.js';

const GOLD = '#c7a256';
const RED = '#e53935';

export function createHardstandTool(ed) {
  const { store } = ed;
  const ctl = createHardstandController({ store, scale: () => ed.view.scale, toast: (m, o) => ed.toast(m, o), redraw: () => ed.draw() });
  let off = null;
  const isOn = () => store.project.mode === 'commercial' && !!store.project.commercial;
  const mods = (ev) => ({ alt: ev.alt, shift: ev.shift, screen: ev.screen });

  const tool = {
    id: 'hardstand',
    controller: ctl,
    cursor: () => (hsState.mode === 'edit' ? 'default' : 'crosshair'),
    hint: () => ctl.hint(),
    activate() {
      ctl.reset();
      off = onHsState(() => { ed.setHint(ctl.hint()); ed.canvas.style.cursor = tool.cursor(); ed.draw(); });
      if (!isOn()) ed.toast('Hardstand is for commercial layouts.', { kind: 'warn' });
    },
    deactivate() { off?.(); off = null; ctl.reset(); setHsState({ selected: null }); ed.draw(); },
    pointerDown(ev) {
      if (!isOn()) { ed.startPan(ev); return; }
      if (!ctl.pointerDown(ev.world, mods(ev))) ed.startPan(ev);
    },
    pointerMove(ev) { ctl.pointerMove(ev.world, mods(ev)); },
    pointerUp(ev) { ctl.pointerUp(ev.world, mods(ev)); },
    dblClick(ev) { ctl.dblClick(ev.world); },
    modifiersChanged() { ed.draw(); },
    cancel() { return ctl.cancel(); },
    keyDown(e) { return ctl.keyDown(e); },
    pointerLeave() { ed.draw(); },
    projectChanged() { if (hsState.selected && !ctl.selectedArea()) setHsState({ selected: null }); },
    draw(ctx, st) { drawDraft(ctx, st, ctl.draft()); },
  };
  return { hardstand: tool };
}

function path(ctx, st, ring, close = true) {
  ring.forEach((p, i) => { const s = worldToScreen(st.view, p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  if (close) ctx.closePath();
}

function pill(ctx, st, lines, x, y, { warn = false } = {}) {
  ctx.save();
  ctx.font = `600 12px ${st.theme.f.ui}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * 16 + 8;
  const bx = Math.min(Math.max(8, x), st.size.w - w - 8);
  const by = Math.min(Math.max(8, y), st.size.h - h - 8);
  ctx.fillStyle = 'rgba(20,22,26,0.88)';
  ctx.strokeStyle = warn ? RED : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 6); else ctx.rect(bx, by, w, h);
  ctx.fill(); ctx.stroke();
  lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#ffffff' : (warn && i > 0 && l.startsWith('Crosses') ? '#ffb4ad' : 'rgba(255,255,255,0.78)'); ctx.fillText(l, bx + 8, by + 12 + i * 16); });
  ctx.restore();
}

/** Draw a controller draft over the plan: the selected outline, the ghost, the new shape, labels, handles, snap marker and readout. */
export function drawDraft(ctx, st, d) {
  if (!d) return;
  ctx.save();
  ctx.lineJoin = 'round';
  if (d.selected && !d.ring) {
    ctx.beginPath(); path(ctx, st, d.selected);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (d.ghost) {
    ctx.beginPath(); path(ctx, st, d.ghost);
    ctx.strokeStyle = 'rgba(120,120,120,0.8)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  const warn = d.warn.length > 0;
  if (d.ring && d.ring.length >= 2) {
    const t = pavementById(d.type);
    if (d.ring.length >= 3 && t) drawPavementArea(ctx, d.ring.map((p) => worldToScreen(st.view, p)), d.type, st.view.scale);
    ctx.beginPath(); path(ctx, st, d.ring, !d.open);
    if (d.ring.length >= 3) { ctx.fillStyle = warn ? 'rgba(229,57,53,0.16)' : 'rgba(199,162,86,0.14)'; ctx.fill(); }
    ctx.strokeStyle = warn ? RED : GOLD; ctx.lineWidth = 2.2; ctx.setLineDash(d.open ? [7, 5] : []); ctx.stroke(); ctx.setLineDash([]);
    if (d.open) for (const p of d.ring.slice(0, -1)) { const s = worldToScreen(st.view, p); ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke(); }
  }
  ctx.font = `600 11px ${st.theme.f.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of d.labels) {
    const s = worldToScreen(st.view, l);
    ctx.lineWidth = 3.5; ctx.strokeStyle = st.theme.c.canvas; ctx.strokeText(l.text, s.x, s.y);
    ctx.fillStyle = st.theme.c.text; ctx.fillText(l.text, s.x, s.y);
  }
  for (const hd of d.handles) {
    const s = worldToScreen(st.view, hd);
    ctx.beginPath();
    if (hd.kind === 'vertex') { ctx.rect(s.x - 5, s.y - 5, 10, 10); ctx.fillStyle = hd.active ? GOLD : '#fff'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke(); }
    else { ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; ctx.stroke(); }
  }
  if (d.snap) {
    const s = worldToScreen(st.view, d.snap);
    ctx.beginPath();
    if (d.snap.kind === 'corner') ctx.rect(s.x - 6, s.y - 6, 12, 12); else if (d.snap.kind === 'edge') { ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x, s.y - 6); ctx.lineTo(s.x + 6, s.y); ctx.lineTo(s.x, s.y + 6); ctx.closePath(); } else ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.strokeStyle = d.snap.kind === 'grid' || d.snap.kind === 'free' ? 'rgba(80,80,80,0.8)' : '#1b8f4a'; ctx.lineWidth = 2; ctx.stroke();
    const lines = [d.readout || '', ...d.warn, d.snap.text].filter(Boolean);
    if (lines.length) pill(ctx, st, lines, s.x + 16, s.y + 16, { warn });
  } else if (d.readout) {
    const last = d.ring?.[d.ring.length - 1];
    if (last) { const s = worldToScreen(st.view, last); pill(ctx, st, [d.readout, ...d.warn], s.x + 16, s.y + 16, { warn }); }
  }
  ctx.restore();
}
