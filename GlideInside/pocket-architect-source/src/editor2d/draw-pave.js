// 2D drawing for the drawn driveways and roads: each material fills with its own crisp plan hatch (the commercial pavement catalogue's, so
// both tools match), a darker outline, the crossover a shade darker, and a length and area label. In a commercial layout the hatch is
// already drawn by the hardstand areas the ways are mirrored as, so only the outline label and the selection are added.

import { worldToScreen } from './math.js';
import { drawPavementArea } from '../commercial/catalogue/pavements/draw2d.js';
import { getWays, wayGeometry, MATERIALS, KINDS } from '../site/pavedways.js';
import { paveState } from './pave-state.js';

const GOLD = '#c7a256';
const RED = '#e53935';
const BASE = { concrete: '#e9e6df', asphalt: '#c9cbce', gravel: '#e6dcc6', pavers: '#e7d9c8' };
const EDGE = { concrete: '#6f6b60', asphalt: '#3f4348', gravel: '#7d705a', pavers: '#6c5a49' };

const S = (st, p) => worldToScreen(st.view, p);
function path(ctx, st, ring) {
  ring.forEach((p, i) => { const s = S(st, p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
  ctx.closePath();
}

function halo(ctx, text, x, y, st) {
  ctx.lineWidth = 3.5; ctx.strokeStyle = st.theme.c.canvas; ctx.strokeText(text, x, y);
  ctx.fillStyle = st.theme.c.text; ctx.fillText(text, x, y);
}

/** One way's pieces: opaque base, hatch, outline. `alpha` fades a draft. */
export function paintWay(ctx, st, way, geom, { hatch = true, alpha = 1, warn = false } = {}) {
  const mat = MATERIALS[way.material];
  for (const pc of geom.pieces) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath(); path(ctx, st, pc.ring);
    if (hatch) { ctx.fillStyle = warn ? 'rgba(229,57,53,0.25)' : BASE[way.material]; ctx.fill(); }
    ctx.restore();
    if (hatch) { ctx.save(); ctx.globalAlpha = alpha; drawPavementArea(ctx, pc.ring.map((p) => S(st, p)), mat.type, st.view.scale); ctx.restore(); }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath(); path(ctx, st, pc.ring);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = warn ? RED : EDGE[way.material];
    ctx.lineWidth = pc.role === 'crossover' ? 1.8 : 1.3;
    ctx.stroke();
    if (pc.role === 'crossover') { ctx.fillStyle = 'rgba(80,80,80,0.12)'; ctx.fill(); }
    ctx.restore();
  }
}

function labelOf(way, geom) {
  const len = geom.lengthMm / 1000;
  return [`${MATERIALS[way.material].label} ${KINDS[way.kind].label.toLowerCase()} ${(way.widthMm / 1000).toFixed(1)} m wide`, `${len.toFixed(1)} m, ${geom.areaM2.toFixed(1)} m2`];
}

/** Label placed on the long part of the centreline, only when it fits. */
export function drawWayLabel(ctx, st, way, geom) {
  const c = geom.centre;
  if (c.length < 2) return;
  const total = geom.lengthMm;
  if (total * st.view.scale < 90) return;
  let acc = 0;
  let at = c[0];
  for (let i = 1; i < c.length; i++) { const d = Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y); if (acc + d >= total * 0.5) { const t = (total * 0.5 - acc) / (d || 1); at = { x: c[i - 1].x + (c[i].x - c[i - 1].x) * t, y: c[i - 1].y + (c[i].y - c[i - 1].y) * t }; break; } acc += d; }
  const s = S(st, at);
  ctx.save();
  ctx.font = `600 10.5px ${st.theme.f.ui}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = labelOf(way, geom);
  const fit = Math.min(...[geom.lengthMm * st.view.scale]) > 150;
  halo(ctx, lines[0], s.x, s.y - 7, st);
  if (fit) halo(ctx, lines[1], s.x, s.y + 7, st);
  ctx.restore();
}

/** The persistent layer: every drawn way. Called from drawSite. */
export function drawPavedWays(ctx, st) {
  const project = st.project;
  if (!project?.site?.paved?.length) return;
  const comm = project.mode === 'commercial';
  const sel = paveState.selected || null;
  for (const way of getWays(project)) {
    const geom = wayGeometry(project, way);
    if (!comm) paintWay(ctx, st, way, geom, { hatch: true });
    if (sel === way.id && st.tool === 'pave') {
      ctx.save();
      ctx.beginPath(); path(ctx, st, geom.outline);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4; ctx.setLineDash([8, 5]); ctx.stroke();
      ctx.restore();
    }
    drawWayLabel(ctx, st, way, geom);
  }
}
