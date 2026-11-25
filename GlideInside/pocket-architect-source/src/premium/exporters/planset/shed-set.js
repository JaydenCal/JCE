// Outbuilding plan set (kind 'shed'): the sheets for a shed, garage, carport or similar outbuilding on a residential or rural lot. It is NOT the
// commercial set: there is no yield summary, no development feasibility and no car park or bay notes. The sheets are
//   C000 cover and drawing index, C100 site plan on the aerial, C100A the same plan with no aerial, A100 floor plan (with the door schedule),
//   A150 roof plan, A200 elevations, A300 sections.
// The geometry is the commercial catalogue building (project.commercial.buildings) read through the same targets the commercial elevations and
// sections use, so every sheet agrees with the 3D model. Everything is indicative and says so.

import { buildingsOf } from '../../../commercial/catalogue/buildings.js';
import { effectiveClass } from '../../../commercial/zones.js';
import { PEN, clean, haloText, dimLine } from '../eng/kit.js';
import { VP } from './site.js';
import { viewTargets, toLocal, roofRiseAt } from './commercial-targets.js';
import { elevationScaleOf } from './commercial-elevations.js';
import { sectionScaleOf } from './commercial-sections.js';
import { rlText } from './levels.js';

const SCALES = [20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
const GREY = [120, 124, 132];
const INK_FILL = [58, 62, 70];

/**
 * True when the project is an outbuilding design: every building in the catalogue is of the 'sheds' category (shed, garage, carport), there are
 * no strata unit rows, and the zone is not an employment zone (industrial or commercial). A shed in an industrial zone is commercial work and keeps
 * the commercial set; so does a lot where the person chose a commercial zone class by hand. The account type plays no part.
 */
export function isOutbuildingSet(project) {
  const c = project?.mode === 'commercial' ? project.commercial : null;
  if (!c) return false;
  const bs = buildingsOf(c);
  if (!bs.length || (c.rows || []).length) return false;
  if (!bs.every((b) => b.def?.category === 'sheds')) return false;
  return effectiveClass(project) == null;
}

/** [{ id, code, title, scale, target? }] for the outbuilding set, without drawing anything. */
export function shedSheetPlan(project, lot, { levels = null, siteScale = 'NTS', has3d = false } = {}) {
  const out = [
    { id: 'cover', code: 'C000', title: 'COVER SHEET AND DRAWING INDEX', scale: 'AS SHOWN' },
    { id: 'site', code: 'C100', title: 'SITE PLAN', scale: siteScale },
    { id: 'siteclean', code: 'C100A', title: 'SITE PLAN NO AERIAL', scale: siteScale },
  ];
  const targets = viewTargets(project).filter((t) => t.kind === 'building');
  const many = targets.length > 1;
  targets.forEach((t, i) => out.push({ id: 'plan', code: `A${100 + i}`, title: many ? `FLOOR PLAN, ${t.tag}` : 'FLOOR PLAN', scale: `1:${planView(t).scale} @ A3`, target: t.key }));
  targets.forEach((t, i) => { if (hasRoofPlan(t)) out.push({ id: 'roofplan', code: `A${150 + i}`, title: many ? `ROOF PLAN, ${t.tag}` : 'ROOF PLAN', scale: `1:${planView(t).scale} @ A3`, target: t.key }); });
  targets.forEach((t, i) => {
    let scale = 'NTS';
    try { scale = elevationScaleOf(project, t, levels); } catch { /* NTS */ }
    out.push({ id: 'elev', code: `A${200 + i}`, title: many ? `ELEVATIONS, ${t.tag}` : 'ELEVATIONS', scale, target: t.key });
  });
  targets.forEach((t, i) => out.push({ id: 'sect', code: `A${300 + i}`, title: many ? `SECTIONS, ${t.tag}` : 'SECTIONS', scale: sectionScaleOf(t, levels), target: t.key }));
  if (has3d) out.push({ id: 'views3d', code: 'A400', title: '3D VIEWS', scale: 'NTS' });
  void lot;
  return out;
}

/** A roof plan is issued when the building has a sloping roof (a flat roof is shown on the floor plan and section). */
export const hasRoofPlan = (t) => !!t?.roof && t.roof.type !== 'flat' && !t.open;

/** The notes of the cover: the general notes of an outbuilding set (no car park, no yield). */
export function shedNotes() {
  return [
    'Concept only. This set shows a shed or outbuilding on a lot for discussion. It is not a development application, a construction certificate set or a structural design.',
    'Boundaries are from the cadastre (DCDB) and are not a survey. Dimensions and areas must be confirmed by a registered surveyor.',
    'Setbacks and planning controls shown are indicative. Exempt and complying development limits on size, height and setbacks vary, check with the council and a suitably qualified person.',
    'Structure, footings, bracing and wind rating are for the shed supplier and a structural engineer. Nothing here is a structural design.',
    'Existing buildings, where shown, are placed by the person who made the design and are not surveyed.',
  ];
}

// Plan view ----------------------------------------------------------------------------------------------------------------
/** The scale and mapping of the floor or roof plan: the building upright with its front at the bottom of the sheet, room around it for dimensions. */
export function planView(t) {
  const mx = 6500;
  const my = 7000;
  const vw = VP.x1 - VP.x0 - 6;
  const vh = VP.y1 - VP.y0 - 6;
  const scale = SCALES.find((s) => (t.L + 2 * mx) / s <= vw && (t.D + 2 * my) / s <= vh) || SCALES.at(-1) * 2;
  const cx = (VP.x0 + VP.x1) / 2;
  const cy = (VP.y0 + VP.y1) / 2;
  // The lot plan turned half a turn (never mirrored): the street face is at the bottom and local x runs to the left, so the doors read as they do in the front elevation.
  const S = (p) => ({ x: cx - (p.x - t.L / 2) / scale, y: cy + (t.D / 2 - p.y) / scale });
  return { scale, S, cx, cy };
}

const lenOf = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Walls and openings of a target in its own frame: [{ a, b, thickness, outside, ops: [{ kind, centre, width, height, sill, mark }] }] (a, b local mm). */
export function localWalls(t) {
  const level = t.levels[0].level;
  const walls = (level.walls || []).filter((w) => w.building === t.building.id && w.kind === 'exterior');
  return walls.map((w) => {
    const a = toLocal(t, w.a);
    const b = toLocal(t, w.b);
    // The model's `outside` is the side of (-dy, dx) in WORLD terms; the frame may flip handedness, so recompute from the footprint centre.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const L = lenOf(a, b) || 1;
    const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
    const out = n.x * (mid.x - t.L / 2) + n.y * (mid.y - t.D / 2) >= 0 ? n : { x: -n.x, y: -n.y };
    const ops = (level.openings || []).filter((o) => o.wallId === w.id).map((o) => ({ kind: o.kind, centre: o.offset, width: o.width, height: o.height, sill: o.sill || 0, mark: o.mark || '', style: o.style }));
    return { a, b, thickness: Number(w.thickness) || 200, out, ops, side: w.side || '' };
  });
}

const quad = (doc, pts, style) => {
  const lines = pts.slice(1).map((p, i) => [p.x - pts[i].x, p.y - pts[i].y]);
  doc.lines(lines, pts[0].x, pts[0].y, [1, 1], style, true);
};

/** The direction label of a wall for the schedule: front (high long wall), rear (low long wall) or an end. */
const wallName = (w, t) => {
  const horiz = Math.abs(w.b.y - w.a.y) < 1;
  if (horiz) return Math.abs(w.a.y) < 1 ? 'front wall' : 'rear wall';
  return Math.abs(w.a.x) < 1 ? 'left end wall' : 'right end wall';
};

/** The door schedule rows from the model: [{ mark, kind, width, height, wall, from }] (from: left edge in mm along the wall, left to right as seen from outside). */
export function doorSchedule(t) {
  const rows = [];
  for (const w of localWalls(t)) {
    const L = lenOf(w.a, w.b);
    const horiz = Math.abs(w.b.y - w.a.y) < 1;
    const front = horiz && Math.abs(w.a.y) < 1;
    for (const o of w.ops) {
      if (o.kind !== 'roller_door' && o.kind !== 'door') continue;
      let left;
      if (horiz) {
        const cx = w.b.x >= w.a.x ? w.a.x + o.centre : w.a.x - o.centre; // the opening centre in local x
        left = front ? t.L - cx - o.width / 2 : cx - o.width / 2; // seen from outside: the front is read from the high x end, the rear from the low x end
      } else left = w.b.y >= w.a.y ? w.a.y + o.centre - o.width / 2 : w.a.y - o.centre - o.width / 2;
      rows.push({ mark: o.mark || (o.kind === 'door' ? 'PA' : 'RD'), kind: o.kind, width: Math.round(o.width), height: Math.round(o.height), wall: wallName(w, t), from: Math.round(left), wallLen: Math.round(L) });
    }
  }
  return rows.sort((p, q) => (p.wall === q.wall ? p.from - q.from : p.wall < q.wall ? -1 : 1));
}

/** Gaps between roller doors side by side on one wall (the mullions): [{ wall, between: [markA, markB], widthMm }]. */
export function mullions(t) {
  const out = [];
  const rows = doorSchedule(t).filter((r) => r.kind === 'roller_door');
  for (const wall of [...new Set(rows.map((r) => r.wall))]) {
    const r = rows.filter((x) => x.wall === wall).sort((a, b) => a.from - b.from);
    for (let i = 0; i + 1 < r.length; i++) {
      const gap = r[i + 1].from - (r[i].from + r[i].width);
      if (gap > 0 && gap <= 1500) out.push({ wall, between: [r[i].mark, r[i + 1].mark], widthMm: gap });
    }
  }
  return out;
}

function drawWalls(doc, t, view) {
  const { S, scale } = view;
  const ws = localWalls(t);
  const half = (w) => Math.max(0.12, w.thickness / scale / 2);
  doc.setFillColor(...INK_FILL);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.12);
  for (const w of ws) {
    const A = S(w.a); const B = S(w.b);
    const d = { x: (B.x - A.x) / (lenOf(A, B) || 1), y: (B.y - A.y) / (lenOf(A, B) || 1) };
    const n = { x: -d.y, y: d.x };
    const h = half(w);
    // extend by the half thickness so the corners close
    const A2 = { x: A.x - d.x * h, y: A.y - d.y * h }; const B2 = { x: B.x + d.x * h, y: B.y + d.y * h };
    quad(doc, [{ x: A2.x + n.x * h, y: A2.y + n.y * h }, { x: B2.x + n.x * h, y: B2.y + n.y * h }, { x: B2.x - n.x * h, y: B2.y - n.y * h }, { x: A2.x - n.x * h, y: A2.y - n.y * h }], 'FD');
  }
  // Openings: clear the wall, then the symbol.
  const marks = [];
  for (const w of ws) {
    const A = S(w.a); const B = S(w.b);
    const Ls = lenOf(A, B) || 1;
    const d = { x: (B.x - A.x) / Ls, y: (B.y - A.y) / Ls };
    const n = { x: -d.y, y: d.x };
    const inward = { x: -(S({ x: w.a.x + w.out.x * 100, y: w.a.y + w.out.y * 100 }).x - S(w.a).x), y: -(S({ x: w.a.x + w.out.x * 100, y: w.a.y + w.out.y * 100 }).y - S(w.a).y) };
    const il = Math.hypot(inward.x, inward.y) || 1;
    const inn = { x: inward.x / il, y: inward.y / il };
    const h = half(w) + 0.05;
    for (const o of w.ops) {
      const c = o.centre / scale;
      const hw = o.width / scale / 2;
      const P = (s, k) => ({ x: A.x + d.x * (c + s * hw) + n.x * k, y: A.y + d.y * (c + s * hw) + n.y * k });
      doc.setFillColor(255, 255, 255);
      quad(doc, [P(-1, h), P(1, h), P(1, -h), P(-1, -h)], 'F');
      doc.setDrawColor(...PEN.ink);
      if (o.kind === 'roller_door') {
        doc.setLineWidth(0.2);
        doc.line(P(-1, h).x, P(-1, h).y, P(-1, -h).x, P(-1, -h).y);
        doc.line(P(1, h).x, P(1, h).y, P(1, -h).x, P(1, -h).y);
        doc.setLineWidth(0.18);
        doc.setLineDashPattern([2.2, 0.9, 0.5, 0.9], 0);
        doc.line(P(-1, 0).x, P(-1, 0).y, P(1, 0).x, P(1, 0).y);
        doc.setLineDashPattern([], 0);
      } else if (o.kind === 'door') {
        doc.setLineWidth(0.2);
        doc.line(P(-1, h).x, P(-1, h).y, P(-1, -h).x, P(-1, -h).y);
        doc.line(P(1, h).x, P(1, h).y, P(1, -h).x, P(1, -h).y);
        // leaf at the left hinge swung 90 degrees into the building, with the arc
        const r = o.width / scale;
        const hinge = P(-1, 0);
        const tip = { x: hinge.x + inn.x * r, y: hinge.y + inn.y * r };
        doc.setLineWidth(0.25);
        doc.line(hinge.x, hinge.y, tip.x, tip.y);
        doc.setLineWidth(0.1);
        let prev = tip;
        for (let k = 1; k <= 10; k++) {
          const a = (k / 10) * (Math.PI / 2);
          // from the leaf direction (inn) round to the wall direction (d): point = hinge + r * (inn cos a + d sin a)
          const q = { x: hinge.x + r * (inn.x * Math.cos(a) + d.x * Math.sin(a)), y: hinge.y + r * (inn.y * Math.cos(a) + d.y * Math.sin(a)) };
          doc.line(prev.x, prev.y, q.x, q.y);
          prev = q;
        }
      } else {
        doc.setLineWidth(0.14);
        doc.setFillColor(214, 232, 244);
        quad(doc, [P(-1, h * 0.55), P(1, h * 0.55), P(1, -h * 0.55), P(-1, -h * 0.55)], 'FD');
        doc.line(P(-1, 0).x, P(-1, 0).y, P(1, 0).x, P(1, 0).y);
      }
      if (o.mark) marks.push({ o, at: { x: A.x + d.x * c + inn.x * 3.2, y: A.y + d.y * c + inn.y * 3.2 } });
    }
  }
  for (const m of marks) {
    const size = 6.4;
    const txt = m.o.kind === 'roller_door' && m.o.width / scale > 30 ? `${m.o.mark}  ${Math.round(m.o.width)} x ${Math.round(m.o.height)}` : m.o.mark;
    haloText(doc, txt, m.at.x, m.at.y + 0.8, { size, bold: true, align: 'center', halo: 0.9 });
  }
  return ws;
}

/** Dimension chains round the building: along the front (wall to door, door widths, mullions), overall length and depth, and the personnel door on the rear. */
function drawDims(doc, t, view, ws) {
  const { S } = view;
  const front = ws.find((w) => Math.abs(w.a.y) < 1 && Math.abs(w.b.y) < 1);
  const rear = ws.find((w) => Math.abs(w.a.y - t.D) < 1 && Math.abs(w.b.y - t.D) < 1);
  const stops = (w) => {
    const xs = [0, t.L];
    for (const o of w.ops.filter((q) => q.kind === 'roller_door' || q.kind === 'door')) {
      const x0 = Math.min(w.a.x, w.b.x);
      const c = w.b.x >= w.a.x ? x0 + o.centre : x0 + lenOf(w.a, w.b) - o.centre;
      xs.push(c - o.width / 2, c + o.width / 2);
    }
    return [...new Set(xs.map((x) => Math.round(x)))].sort((p, q) => p - q);
  };
  const sorted = (a, b) => (a.x <= b.x ? [a, b] : [b, a]);
  const chain = (w, y, offset) => {
    const xs = stops(w);
    for (let i = 0; i + 1 < xs.length; i++) {
      const [a, b] = sorted(S({ x: xs[i], y }), S({ x: xs[i + 1], y }));
      if (lenOf(a, b) < 1.2) continue;
      dimLine(doc, a, b, String(xs[i + 1] - xs[i]), { colour: PEN.dim, size: 6, offset, textSide: 1 });
    }
  };
  if (front) chain(front, 0, 9);
  if (rear && rear.ops.length) chain(rear, t.D, -9);
  { const [a, b] = sorted(S({ x: 0, y: 0 }), S({ x: t.L, y: 0 })); dimLine(doc, a, b, String(Math.round(t.L)), { colour: PEN.dim, size: 7, offset: 17, textSide: 1 }); }
  dimLine(doc, S({ x: 0, y: 0 }), S({ x: 0, y: t.D }), String(Math.round(t.D)), { colour: PEN.dim, size: 7, offset: 14, textSide: 1 });
}

/** The floor plan sheet. Returns { kv, notes, blocks } for the title strip. */
export function drawShedPlan(doc, model, target, levels = null) {
  const t = target || viewTargets(model.project).find((x) => x.kind === 'building');
  if (!t) { haloText(doc, 'No building to draw.', VP.x0 + 10, VP.y0 + 12, { size: 8, halo: 0 }); return { kv: [], notes: [], blocks: [] }; }
  const view = planView(t);
  const { S, scale } = view;
  doc.setLineDashPattern([], 0);
  // Slab
  const corners = [{ x: 0, y: 0 }, { x: t.L, y: 0 }, { x: t.L, y: t.D }, { x: 0, y: t.D }].map(S);
  doc.setFillColor(246, 246, 248);
  doc.setDrawColor(...GREY);
  doc.setLineWidth(0.1);
  quad(doc, corners, 'FD');
  const ws = drawWalls(doc, t, view);
  drawDims(doc, t, view, ws);
  const c = S({ x: t.L / 2, y: t.D / 2 });
  haloText(doc, clean(t.building.planLabel), c.x, c.y - 1, { size: 9, bold: true, align: 'center', halo: 1 });
  haloText(doc, `${(t.L / 1000).toFixed(1)} x ${(t.D / 1000).toFixed(1)} m,  ${Math.round(t.building.gfaM2)} m2`, c.x, c.y + 4.4, { size: 7, align: 'center', halo: 1 });
  const ffl = levels?.fflOf ? levels.fflOf(t.outline) : 100;
  haloText(doc, `FFL RL ${rlText(ffl)}${levels?.has || levels?.floorSet ? '' : ' (ASSUMED DATUM)'}`, c.x, c.y + 9.2, { size: 6.4, align: 'center', halo: 1, colour: [70, 74, 82] });
  // Front and north marks: the street face is at the bottom of the sheet.
  const fb = S({ x: t.L / 2, y: 0 });
  haloText(doc, 'FRONT (STREET SIDE)', fb.x, fb.y + 33, { size: 6.4, bold: true, align: 'center', halo: 0.8, colour: [70, 74, 82] });
  const sched = doorSchedule(t);
  const mu = mullions(t);
  const own = t.building.def?.wallFinish ? t.building.def.wallFinish(t.params) : null;
  const kv = [
    ['Building', clean(t.label)],
    ['Size', `${(t.L / 1000).toFixed(2)} x ${(t.D / 1000).toFixed(2)} m`],
    ['Floor area', `${Math.round(t.building.gfaM2)} m2`],
    ['Scale', `1:${scale} @ A3`],
    ...(own ? [['Cladding', own.name]] : []),
    ...mu.map((m) => [`Mullion ${m.between.join(' / ')}`, `${m.widthMm} mm`]),
  ];
  const block = {
    title: 'DOOR SCHEDULE',
    h: 6 + Math.max(1, sched.length) * 3.6 + 2,
    draw(d, x, y) {
      d.setFontSize(6);
      d.setFont('helvetica', 'bold');
      d.setTextColor(...PEN.ink);
      d.text('MARK', x + 3, y + 3.2); d.text('W x H (mm)', x + 15, y + 3.2); d.text('WALL', x + 44, y + 3.2);
      d.setFont('helvetica', 'normal');
      sched.forEach((r, i) => {
        const ry = y + 3.2 + (i + 1) * 3.6;
        d.text(r.mark, x + 3, ry); d.text(`${r.width} x ${r.height}`, x + 15, ry); d.text(r.wall, x + 44, ry);
      });
    },
  };
  const notes = [
    'Dimensions are in millimetres.',
    'Door sizes are nominal. Confirm each door and the mullion between doors with the supplier before ordering.',
    'Concept only. Not a structural design, footings and bracing are by others.',
  ];
  return { kv, notes, blocks: sched.length ? [block] : [] };
}

/** The roof plan sheet: the roof outline over the building, the fall arrow, the high and low edges and the pitch. */
export function drawShedRoof(doc, model, target, levels = null) {
  const t = target || viewTargets(model.project).find((x) => x.kind === 'building');
  if (!t) return { kv: [], notes: [], blocks: [] };
  const view = planView(t);
  const { S, scale } = view;
  const o = 300;
  const outline = [{ x: -o, y: -o }, { x: t.L + o, y: -o }, { x: t.L + o, y: t.D + o }, { x: -o, y: t.D + o }].map(S);
  doc.setLineDashPattern([], 0);
  doc.setFillColor(240, 242, 245);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.3);
  quad(doc, outline, 'FD');
  const walls = [{ x: 0, y: 0 }, { x: t.L, y: 0 }, { x: t.L, y: t.D }, { x: 0, y: t.D }].map(S);
  doc.setLineDashPattern([2.2, 1.1], 0);
  doc.setLineWidth(0.2);
  quad(doc, walls, 'S');
  doc.setLineDashPattern([], 0);
  // Fall arrow from the high edge to the low edge, with sheeting ribs drawn along it.
  const fall = t.roof.fall;
  const vec = { rear: { x: 0, y: 1 }, front: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[fall] || { x: 0, y: 1 };
  const mid = { x: t.L / 2, y: t.D / 2 };
  const span = Math.abs(vec.y) ? t.D : t.L;
  const a0 = S({ x: mid.x - vec.x * span * 0.32, y: mid.y - vec.y * span * 0.32 });
  const b0 = S({ x: mid.x + vec.x * span * 0.32, y: mid.y + vec.y * span * 0.32 });
  doc.setDrawColor(...PEN.dim);
  doc.setFillColor(...PEN.dim);
  doc.setLineWidth(0.5);
  doc.line(a0.x, a0.y, b0.x, b0.y);
  const dl = lenOf(a0, b0) || 1;
  const ux = (b0.x - a0.x) / dl; const uy = (b0.y - a0.y) / dl;
  doc.triangle(b0.x, b0.y, b0.x - ux * 4 - uy * 1.6, b0.y - uy * 4 + ux * 1.6, b0.x - ux * 4 + uy * 1.6, b0.y - uy * 4 - ux * 1.6, 'F');
  const m = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  haloText(doc, `SKILLION ROOF, ${t.roof.pitchDeg} DEGREE FALL`, m.x + 6, m.y, { size: 7.4, bold: true, halo: 1, colour: PEN.dim });
  const edge = (p, text, dy) => { const q = S(p); haloText(doc, text, q.x, q.y + dy, { size: 6.4, bold: true, align: 'center', halo: 0.9, colour: [70, 74, 82] }); };
  const high = { rear: { x: t.L / 2, y: 0 }, front: { x: t.L / 2, y: t.D }, left: { x: t.L, y: t.D / 2 }, right: { x: 0, y: t.D / 2 } }[fall];
  const low = { rear: { x: t.L / 2, y: t.D }, front: { x: t.L / 2, y: 0 }, left: { x: 0, y: t.D / 2 }, right: { x: t.L, y: t.D / 2 } }[fall];
  const hs = S(high); const ls = S(low);
  haloText(doc, 'HIGH EDGE', hs.x, hs.y + (fall === 'rear' ? -4 : fall === 'front' ? 6.5 : 0.8), { size: 6.4, bold: true, align: 'center', halo: 0.9, colour: [70, 74, 82] });
  haloText(doc, 'LOW EDGE, GUTTER', ls.x, ls.y + (fall === 'rear' ? 6.5 : fall === 'front' ? -4 : 0.8), { size: 6.4, bold: true, align: 'center', halo: 0.9, colour: [70, 74, 82] });
  void edge;
  dimLine(doc, S({ x: t.L, y: t.D }), S({ x: 0, y: t.D }), String(Math.round(t.L)), { colour: PEN.dim, size: 7, offset: -12, textSide: 1 });
  dimLine(doc, S({ x: 0, y: 0 }), S({ x: 0, y: t.D }), String(Math.round(t.D)), { colour: PEN.dim, size: 7, offset: 12, textSide: 1 });
  const rise = roofRiseAt(t.roof, t.L, t.D, t.L / 2, 0);
  const ffl = levels?.fflOf ? levels.fflOf(t.outline) : 100;
  const rl = (mm) => rlText(ffl + mm / 1000);
  const kv = [
    ['Building', clean(t.label)],
    ['Roof', `Skillion, ${t.roof.pitchDeg} degrees`],
    ['Low eave', `RL ${rl(t.wallTop)}`],
    ['High edge', `RL ${rl(t.wallTop + Math.max(rise, roofRiseAt(t.roof, t.L, t.D, t.L / 2, t.D)))}`],
    ['Scale', `1:${scale} @ A3`],
  ];
  return { kv, notes: ['Roof sheeting, purlins and gutter sizes are by the shed supplier.', 'Levels are indicative and on the floor level shown on the floor plan.'], blocks: [] };
}

/** The cover thumbnail: the building outline with its doors, upright. */
export function shedThumbnail(model) {
  const t = viewTargets(model.project).find((x) => x.kind === 'building');
  return {
    title: 'SHED PLAN (OUTLINE)',
    draw(doc, rect) {
      if (!t) return;
      const bw = rect.x1 - rect.x0 - 14;
      const bh = rect.y1 - rect.y0 - 26;
      const ds = SCALES.find((s) => t.L / s <= bw && t.D / s <= bh) || 600;
      const ox = rect.x0 + (rect.x1 - rect.x0 - t.L / ds) / 2;
      const oy = rect.y0 + 8 + (bh - t.D / ds) / 2;
      const S = (p) => ({ x: ox + (t.L - p.x) / ds, y: oy + (t.D - p.y) / ds });
      const view = { S, scale: ds };
      doc.setFillColor(246, 246, 248);
      doc.setDrawColor(...PEN.ink);
      doc.setLineWidth(0.18);
      quad(doc, [{ x: 0, y: 0 }, { x: t.L, y: 0 }, { x: t.L, y: t.D }, { x: 0, y: t.D }].map(S), 'FD');
      drawWalls(doc, { ...t }, view);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...PEN.ink);
      doc.text(clean(`${(t.L / 1000).toFixed(1)} x ${(t.D / 1000).toFixed(1)} m, ${Math.round(t.building.gfaM2)} m2`), rect.x0 + 4, rect.y1 - 4);
      doc.setFontSize(6);
      doc.setTextColor(90, 94, 102);
      doc.text(`Outline at 1:${ds} @ A3`, rect.x1 - 4, rect.y0 + 5.5, { align: 'right' });
    },
  };
}
