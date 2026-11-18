// UPPER LEVEL PLANS (sheet family C110) for catalogue buildings with more than one level (office first floor, homes above shops, townhouse and terrace
// rows, a warehouse with a mezzanine office): every upper level of one building on one sheet at one scale, with walls, doors and windows, room names
// and areas, the overall size, the finished floor level of each level and the existing ground contours outside the building. A building with no upper
// level gets no sheet (the strata mezzanine plan is drawn by drawMezzanine in commercial.js).

import * as G from '../../../model/geometry.js';
import { levelContent } from '../drawing.js';
import { planGeometry } from '../pdf.js';
import { PEN, LabelField, haloText, dimLine, clean } from '../eng/kit.js';
import { VP } from './site.js';
import { drawRoomLabels } from './labels.js';
import { drawGroundLayer, streamMark, intervalText } from './contours.js';
import { rlText } from './levels.js';
import { scaleBar } from '../pdf.js';
import { northPoint, northDegOf } from './site.js';
import { legendBlock } from './commercial.js';

const SCALES = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
const TXT = 5.6;

/** Distance from a point to a segment (mm). */
const distSeg = (q, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
};

/** The edge of an upper floor: a light fill under the walls, and a double (balustrade) line along every edge that has no wall on it. */
function drawFloorEdge(doc, polygon, walls, T) {
  if (!polygon || polygon.length < 3) return;
  const pts = polygon.map(T);
  doc.setFillColor(238, 243, 250);
  doc.setDrawColor(...PEN.light);
  doc.setLineWidth(0.1);
  doc.lines(pts.slice(1).map((q, i) => [q.x - pts[i].x, q.y - pts[i].y]), pts[0].x, pts[0].y, [1, 1], 'F', true);
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (walls.some((w) => distSeg(mid, w.a, w.b) < 300)) return;
    const A = T(a); const B = T(b);
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const nx = -(B.y - A.y) / len; const ny = (B.x - A.x) / len;
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.18);
    for (const o of [-0.45, 0.45]) doc.line(A.x + nx * o, A.y + ny * o, B.x + nx * o, B.y + ny * o);
  });
}
const TAG = 'Levels are indicative, interpolated from the state 5 m elevation model, not survey. A registered surveyor must confirm levels.';

/** True when a target has at least one upper level worth a plan. */
export const hasUpperPlans = (t) => t.kind === 'building' && t.floors.some((f) => f.upper && (f.level.walls || []).some((w) => w.building === t.building.id));

/** The level of one building, trimmed to that building: its walls, openings, rooms and stairs. */
function buildingLevel(t, f) {
  const id = t.building.id;
  const walls = (f.level.walls || []).filter((w) => w.building === id);
  const ids = new Set(walls.map((w) => w.id));
  const bb = G.bbox(t.outline);
  const inBox = (p) => p.x >= bb.minX - 2000 && p.x <= bb.maxX + 2000 && p.y >= bb.minY - 2000 && p.y <= bb.maxY + 2000;
  return { ...f.level, walls, openings: (f.level.openings || []).filter((o) => ids.has(o.wallId)), rooms: (f.level.rooms || []).filter((r) => r.building === id), stairs: (f.level.stairs || []).filter((s) => inBox({ x: Number(s.x ?? s.at?.x ?? s.a?.x), y: Number(s.y ?? s.at?.y ?? s.a?.y) }) || s.building === id), furniture: [] };
}

/** { scale, boxes, panels } for the upper levels of a target. */
export function upperLayout(t) {
  const floors = t.floors.filter((f) => f.upper && buildingLevel(t, f).walls.length);
  const vw = VP.x1 - VP.x0;
  const vh = VP.y1 - VP.y0;
  const panels = floors.map((f) => {
    const level = buildingLevel(t, f);
    const content = levelContent({}, level, false, null);
    // The sheet frames what is drawn on the upper level (rooms, walls, stairs), not the whole footprint: a mezzanine office in a big shed fills the sheet.
    const pts = [...level.rooms.flatMap((r) => r.polygon), ...level.walls.flatMap((w) => [w.a, w.b])];
    if (!pts.length) pts.push(...t.outline);
    return { f, level, content, bb: G.bbox(pts) };
  });
  let best = null;
  const n = panels.length;
  for (const cols of n <= 1 ? [1] : n === 2 ? [1, 2] : [1, 2, 3]) {
    const rows = Math.ceil(n / cols);
    const cw = vw / cols;
    const ch = vh / rows;
    const boxes = panels.map((_, i) => ({ x0: VP.x0 + (i % cols) * cw, x1: VP.x0 + ((i % cols) + 1) * cw, y0: VP.y0 + Math.floor(i / cols) * ch, y1: VP.y0 + (Math.floor(i / cols) + 1) * ch }));
    const scale = SCALES.find((s) => panels.every((p, i) => (p.bb.w + 9000) / s <= boxes[i].x1 - boxes[i].x0 - 6 && (p.bb.h + 7000) / s <= boxes[i].y1 - boxes[i].y0 - 22)) || SCALES.at(-1) * 2;
    if (!best || scale < best.scale) best = { scale, boxes };
  }
  return { ...best, panels };
}

export function upperScaleOf(t) {
  try { const l = upperLayout(t); return l.panels.length ? `1:${l.scale} @ A3` : 'NTS'; } catch { return 'NTS'; }
}

/** The upper level sheet of one building. Returns { kv, notes, blocks, bounds } for the title strip. */
export function drawUpperPlans(doc, model, t, levels) {
  const lay = upperLayout(t);
  const ffl0 = levels?.fflOf ? levels.fflOf(t.outline) : 100;
  const assumed = !levels?.has && !levels?.floorSet;
  const bounds = [];
  const field0 = new LabelField(VP);
  let ground = null;
  lay.panels.forEach((p, i) => {
    const box = lay.boxes[i];
    const ds = lay.scale;
    const cx = (p.bb.minX + p.bb.maxX) / 2;
    const cy = (p.bb.minY + p.bb.maxY) / 2;
    const mx = (box.x0 + box.x1) / 2;
    const my = (box.y0 + box.y1) / 2 - 3;
    const T = (q) => ({ x: mx + (q.x - cx) / ds, y: my + (q.y - cy) / ds });
    const Ti = (q) => ({ x: cx + (q.x - mx) * ds, y: cy + (q.y - my) * ds });
    const rect = { x0: box.x0 + 1, y0: box.y0 + 1, x1: box.x1 - 1, y1: box.y1 - 1 };
    const mark = streamMark(doc);
    for (const rm of p.level.rooms) drawFloorEdge(doc, rm.polygon, p.level.walls, T);
    planGeometry(doc, { ...p.content, scale: ds }, T, true, null);
    const field = new LabelField(rect);
    drawRoomLabels(doc, { content: p.content, T, catalogue: null, bounds: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 - 18 }, extra: [] });
    const poly = [{ x: p.bb.minX, y: p.bb.minY }, { x: p.bb.maxX, y: p.bb.minY }, { x: p.bb.maxX, y: p.bb.maxY }, { x: p.bb.minX, y: p.bb.maxY }].map(T);
    const bx = G.bbox(poly);
    // The building outline below, when it fits on the panel (dashed, light); the floor edge of each upper room with a balustrade on its open sides.
    const out = t.outline.map(T);
    if (out.every((q) => q.x >= rect.x0 && q.x <= rect.x1 && q.y >= rect.y0 && q.y <= rect.y1 - 14)) {
      doc.setDrawColor(...PEN.light); doc.setLineWidth(0.2); doc.setLineDashPattern([2, 1.2], 0);
      out.forEach((q, k) => { const n2 = out[(k + 1) % out.length]; doc.line(q.x, q.y, n2.x, n2.y); });
      doc.setLineDashPattern([], 0);
    }
    field.addBox({ x0: bx.minX - 1, y0: bx.minY - 1, x1: bx.maxX + 1, y1: bx.maxY + 1 });
    if (levels?.has && t.project?.site?.lot) {
      const g = drawGroundLayer(doc, { lot: t.project.site.lot, levels, S: T, Si: Ti, rect, field, masks: [poly], light: true, mark });
      if (g.drawn) ground = g;
    }
    // overall dimensions
    dimLine(doc, { x: bx.minX, y: bx.maxY + 4 }, { x: bx.maxX, y: bx.maxY + 4 }, `${(p.bb.w / 1000).toFixed(1)} m`, { size: TXT, textSide: 1 });
    dimLine(doc, { x: bx.maxX + 9, y: bx.minY }, { x: bx.maxX + 9, y: bx.maxY }, `${(p.bb.h / 1000).toFixed(1)} m`, { size: TXT, textSide: 1 });
    const ffl = ffl0 + p.f.z / 1000;
    haloText(doc, `FFL ${rlText(ffl)}${assumed ? ' (ASSUMED)' : ''}`, bx.minX, bx.minY - 2.6, { size: 6.4, bold: true, colour: PEN.dim, halo: 0.9 });
    haloText(doc, `${t.tag} ${String(p.f.name).toUpperCase()} FLOOR PLAN`, box.x0 + 3, box.y1 - 6, { size: 8, bold: true, halo: 0 });
    haloText(doc, `1:${ds} @ A3`, box.x0 + 3, box.y1 - 2, { size: TXT, colour: PEN.grey, halo: 0 });
    doc.setDrawColor(...PEN.tag); doc.setLineWidth(0.5); doc.line(box.x0 + 3, box.y1 - 4.4, box.x0 + 40, box.y1 - 4.4);
    bounds.push({ x0: bx.minX - 4, y0: bx.minY - 4, x1: bx.maxX + 10, y1: bx.maxY + 8 });
  });
  // One scale bar and north point for the sheet
  const r = 12;
  northPoint(doc, VP.x1 - r - 2, VP.y0 + r + 2, northDegOf(t.project, null));
  doc.setDrawColor(...PEN.ink);
  scaleBar(doc, VP.x0 + 6, VP.y1 + 4.2, lay.scale, lay.scale);
  void field0;
  const kv = [
    ['Building', clean(t.label)],
    ['Upper levels', String(lay.panels.length)],
    ['Scale', `1:${lay.scale} @ A3`],
    ...(ground?.interval ? [['Contours', intervalText(ground.interval)]] : []),
  ];
  const noStair = lay.panels.every((q) => !(q.level.stairs || []).length);
  const notes = ['Concept only. Floor plans are indicative and not for construction.', 'Room names and areas are indicative, to internal wall faces.', `A double line is the balustrade on an open floor edge. The floor below is open under the upper floor${noStair ? ', and the access stair is not modelled in the concept' : ''}.`, ...(ground?.note ? [ground.note] : levels?.has ? [TAG] : ['Levels are on an assumed datum (floor level RL 100.00).'])];
  // The legend names the contours when (and only when) they were stroked on this sheet.
  return { kv, notes, blocks: ground?.legend?.length ? [legendBlock(ground.legend)] : [], bounds };
}
