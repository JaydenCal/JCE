// Concrete wall panel layout (tilt-up, precast and the concrete dado of the combination system). Pure: no DOM, no three. Everything that draws
// panels (the 3D module, the plan joints, the elevation sheet, the tests) reads the same layout from here, so they always agree.
//
// Coordinates along a wall are millimetres from the start of the wall's visible span (see wallSpan). Heights are millimetres above the wall base.
// A panel runs from joint centre line to joint centre line; the joint itself (JOINT_MM wide) is cut out of the panels on both sides of it when
// the panels are drawn, and there is no joint at a wall end. Panel lifting inserts are not modelled.

export const JOINT_MM = 20;
export const REVEAL_MM = 25;
export const REVEAL_DEPTH_MM = 15;
export const MIN_PANEL_MM = 800; // narrowest panel between joint centre lines
export const MIN_LEG_MM = 450; // concrete left each side of a window cut inside a panel
export const MIN_ABOVE_MM = 300; // least head or lintel depth worth a lintel panel
export const MAX_LINTEL_MM = 6000; // lintel and spandrel panels over a wide opening are split into equal parts no wider than this
const EPS = 1;

const r10 = (v) => Math.round(v / 10) * 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Heights (mm above the base) of the horizontal reveals for a mode and a panel top. */
export function revealHeights(mode, top) {
  if (!(top > 2000)) return [];
  if (mode === 'one') return [r10(Math.min(3000, top / 2))];
  if (mode === 'two') return [r10(top / 3), r10((2 * top) / 3)];
  if (mode === 'grooves') {
    const out = [];
    for (let y = 1200; y < top - 600; y += 1200) out.push(y);
    return out;
  }
  return [];
}

/** The feature band: the band of the wall in the accent colour, a recess between two reveals (null when the wall is too low). */
export function featureBandOf(top) {
  if (!(top >= 3600)) return null;
  const y1 = r10(top - 300);
  return { y0: y1 - 800, y1 };
}

/** Split a width into equal panels no wider than max: [x0, x1, ...] boundaries from a to b. */
function divide(a, b, max) {
  const w = b - a;
  const n = Math.max(1, Math.ceil((w - EPS) / max));
  return Array.from({ length: n + 1 }, (_, i) => a + (w * i) / n);
}

/** Carve holes (sorted by x) out of a panel rectangle into plain rectangles. */
function carve(x0, x1, y0, y1, holes) {
  const out = [];
  let cx = x0;
  for (const h of holes) {
    if (h.x0 > cx + EPS) out.push({ x0: cx, x1: h.x0, y0, y1 });
    if (h.y0 > y0 + EPS) out.push({ x0: h.x0, x1: h.x1, y0, y1: h.y0 });
    if (h.y1 < y1 - EPS) out.push({ x0: h.x0, x1: h.x1, y0: h.y1, y1 });
    cx = h.x1;
  }
  if (cx < x1 - EPS) out.push({ x0: cx, x1, y0, y1 });
  return out;
}

function placeJoints(a, b, holes, maxW) {
  // Initial equal joints, then move any joint that would cut through a window (or leave less than MIN_LEG_MM beside it).
  const base = divide(a, b, maxW);
  const J = base.slice(1, -1);
  for (const h of holes) {
    const z0 = h.x0 - MIN_LEG_MM;
    const z1 = h.x1 + MIN_LEG_MM;
    for (let i = 0; i < J.length; i++) {
      if (J[i] > z0 && J[i] < z1) J[i] = J[i] - z0 < z1 - J[i] ? z0 : z1;
    }
  }
  J.sort((p, q) => p - q);
  const cuts = [a, ...J, b];
  for (let i = 0; i < cuts.length - 1; i++) {
    const w = cuts[i + 1] - cuts[i];
    if (w < MIN_PANEL_MM - EPS || w > maxW + EPS) return null;
  }
  for (const h of holes) {
    const i = cuts.findIndex((c, k) => k < cuts.length - 1 && h.x0 >= c + MIN_LEG_MM - EPS && h.x1 <= cuts[k + 1] - MIN_LEG_MM + EPS);
    if (i < 0) return null;
  }
  return cuts;
}

/**
 * Lay out the panels of one wall face.
 * o: { length, top, openings: [{ id, kind, offset, width, height, sill }] (offset is the centre from the span start), maxWidth, frontage,
 *      accent: 'none'|'corners'|'entry'|'both', signage: boolean, reveals, featureBand }
 * Returns { length, top, panels: [{ id, kind: 'panel'|'lintel'|'spandrel', x0, x1, y0, y1, rects, holes, accent }], joints: [x], reveals: [y],
 *           band, signage: {x0,x1,y0,y1} | null, issues: [text] }.
 */
export function layoutWall(o) {
  const L = Math.max(0, Number(o.length) || 0);
  const top = Math.max(0, Number(o.top) || 0);
  const maxW = clamp(Number(o.maxWidth) || 4000, 2400, 9000);
  const issues = [];
  const ops = (o.openings || []).map((q, i) => ({
    id: q.id ?? `o${i}`, kind: q.kind || 'window',
    x0: clamp(q.offset - q.width / 2, 0, L), x1: clamp(q.offset + q.width / 2, 0, L),
    y0: Math.max(0, Number(q.sill) || 0), y1: Math.max(0, Number(q.sill) || 0) + (Number(q.height) || 0),
  })).filter((q) => q.x1 - q.x0 > EPS && q.y0 < top - 100).sort((a, b) => a.x0 - b.x0);
  const legMax = maxW - 2 * MIN_LEG_MM;
  const forced = new Set();
  let res = null;
  for (let guard = 0; guard <= ops.length + 1 && !res; guard++) {
    const r = attempt(L, top, maxW, ops, legMax, forced, issues);
    if (r.fail != null) forced.add(r.fail); else res = r;
  }
  if (!res) res = { panels: [], joints: [], issues: ['The panels could not be laid out.'] };
  const panels = res.panels.map((p, i) => ({ ...p, id: `P${i + 1}`, accent: false }));
  // Accent panels on the frontage: the corner end panels and the panels around the entry door.
  const acc = o.accent || 'none';
  if (o.frontage && acc !== 'none' && panels.length) {
    const wantCorners = acc === 'corners' || acc === 'both';
    const wantEntry = acc === 'entry' || acc === 'both';
    if (wantCorners) {
      const first = panels.filter((p) => p.kind === 'panel').sort((a, b) => a.x0 - b.x0)[0];
      const last = panels.filter((p) => p.kind === 'panel').sort((a, b) => b.x1 - a.x1)[0];
      if (first && first.x0 < EPS) first.accent = true;
      if (last && last.x1 > L - EPS) last.accent = true;
    }
    if (wantEntry) {
      const entry = ops.find((q) => q.kind === 'door' && q.y0 < 1) || ops.find((q) => q.kind === 'door');
      if (entry) {
        for (const p of panels) {
          const near = p.x1 >= entry.x0 - EPS && p.x0 <= entry.x1 + EPS;
          if (near || (p.kind === 'panel' && (Math.abs(p.x1 - entry.x0) < EPS || Math.abs(p.x0 - entry.x1) < EPS))) p.accent = true;
        }
      }
    }
  }
  const joints = [...new Set(res.joints.map((j) => Math.round(j * 10) / 10))].filter((j) => j > EPS && j < L - EPS).sort((a, b) => a - b);
  // Signage band on the frontage: centred, clear of every opening, only when the wall is tall enough.
  let signage = null;
  if (o.frontage && o.signage && top >= 4500 && L >= 6000) {
    const w = Math.min(12000, Math.round((L * 0.5) / 500) * 500);
    const y1 = r10(top - 700);
    const box = { x0: Math.round((L - w) / 2), x1: Math.round((L + w) / 2), y0: y1 - 900, y1 };
    if (!ops.some((q) => q.x1 > box.x0 && q.x0 < box.x1 && q.y1 > box.y0 - 200)) signage = box;
  }
  return {
    length: L, top, panels, joints, reveals: revealHeights(o.reveals, top), band: o.featureBand ? featureBandOf(top) : null, signage, issues: [...issues, ...(res.issues || [])],
  };
}

/** The solid rectangles of a column zone [x0, x1] x [0, top] once its openings are taken out, bands of equal x merged upward. */
function solidsOf(x0, x1, top, members) {
  const ys = [...new Set([0, top, ...members.flatMap((m) => [clamp(m.y0, 0, top), clamp(m.y1, 0, top)])])].sort((p, q) => p - q);
  const rects = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const ya = ys[i];
    const yb = ys[i + 1];
    if (yb - ya < 0.5) continue;
    const holes = members.filter((m) => m.y0 <= ya + 0.5 && m.y1 >= yb - 0.5).sort((p, q) => p.x0 - q.x0);
    let cx = x0;
    const row = [];
    for (const h of holes) {
      if (h.x0 > cx + EPS) row.push([cx, h.x0]);
      cx = Math.max(cx, h.x1);
    }
    if (cx < x1 - EPS) row.push([cx, x1]);
    for (const [a, b] of row) {
      const up = rects.find((r) => Math.abs(r.x0 - a) < 0.5 && Math.abs(r.x1 - b) < 0.5 && Math.abs(r.y1 - ya) < 0.5);
      if (up) up.y1 = yb; else rects.push({ x0: a, x1: b, y0: ya, y1: yb });
    }
  }
  return rects;
}

function attempt(L, top, maxW, ops, legMax, forced, issues) {
  // Openings are cut inside a panel (windows that fit) or sit in a column of their own: joints at both jambs, panels above (lintel) and below
  // (spandrel) and between stacked openings. Overlapping openings share one column.
  const isCut = (q) => q.y0 > 0 && q.y1 <= top - 250 && q.x1 - q.x0 <= legMax && !forced.has(q.id);
  const cuts = ops.filter(isCut);
  const cols = [];
  for (const q of ops.filter((x) => !isCut(x))) {
    const last = cols[cols.length - 1];
    if (last && q.x0 <= last.x1 + EPS) { last.x1 = Math.max(last.x1, q.x1); last.members.push(q); } else cols.push({ x0: q.x0, x1: q.x1, members: [q] });
  }
  const panels = [];
  const joints = [];
  const addJoint = (x) => { if (x > EPS && x < L - EPS) joints.push(x); };
  const spans = [];
  let cur = 0;
  for (const c of cols) {
    if (c.x0 > cur + EPS) spans.push({ type: 'fill', a: cur, b: c.x0 });
    spans.push({ type: 'col', c });
    cur = c.x1;
  }
  if (L > cur + EPS) spans.push({ type: 'fill', a: cur, b: L });
  const colPieces = new Map();
  spans.forEach((s, i) => {
    if (s.type !== 'col') return;
    const c = s.c;
    const pieces = [];
    for (const r of solidsOf(c.x0, c.x1, top, c.members)) {
      if (r.y1 >= top - 0.5 && r.y1 - r.y0 < MIN_ABOVE_MM) continue; // a head too shallow for a panel: the wall is open to the top there
      const kind = r.y0 < 0.5 ? 'spandrel' : 'lintel';
      const n = Math.max(1, Math.ceil((r.x1 - r.x0 - EPS) / MAX_LINTEL_MM));
      for (let k = 0; k < n; k++) {
        const xa = r.x0 + ((r.x1 - r.x0) * k) / n;
        const xb = r.x0 + ((r.x1 - r.x0) * (k + 1)) / n;
        pieces.push({ kind, x0: xa, x1: xb, y0: r.y0, y1: r.y1, rects: [{ x0: xa, x1: xb, y0: r.y0, y1: r.y1 }], holes: [] });
      }
    }
    colPieces.set(i, { c, pieces });
  });
  const fills = [];
  spans.forEach((s, i) => {
    if (s.type !== 'fill') return;
    const w = s.b - s.a;
    if (w >= MIN_PANEL_MM - EPS) { fills.push(s); return; }
    // A sliver narrower than a panel is carried by the panel beside it that reaches the top, as a leg.
    const hostOf = (cp, edge) => (cp ? cp.pieces.filter((p) => p.y1 >= top - 0.5 && Math.abs((edge === 'right' ? p.x1 : p.x0) - (edge === 'right' ? s.a : s.b)) < 0.5).sort((p, q) => p.y0 - q.y0)[0] : null);
    const host = hostOf(colPieces.get(i - 1), 'right') || hostOf(colPieces.get(i + 1), 'left');
    if (host) {
      host.rects.push({ x0: s.a, x1: s.b, y0: 0, y1: top });
      host.x0 = Math.min(host.x0, s.a);
      host.x1 = Math.max(host.x1, s.b);
    } else {
      issues.push(`A ${Math.round(w)} mm panel beside an opening is narrower than ${MIN_PANEL_MM} mm.`);
      fills.push(s);
    }
  });
  for (const cp of colPieces.values()) {
    for (const p of cp.pieces) { panels.push(p); addJoint(p.x0); addJoint(p.x1); }
    addJoint(cp.c.x0); addJoint(cp.c.x1);
  }
  // Filler segments, with the cut windows.
  for (const s of fills) {
    const holes = cuts.filter((q) => q.x0 >= s.a - EPS && q.x1 <= s.b + EPS);
    const bad = holes.find((h) => h.x0 - s.a < MIN_LEG_MM - EPS || s.b - h.x1 < MIN_LEG_MM - EPS);
    if (bad) return { fail: bad.id };
    const wholeJ = s.b - s.a < MIN_PANEL_MM ? [s.a, s.b] : placeJoints(s.a, s.b, holes, maxW);
    if (!wholeJ) {
      const h = holes[0];
      if (h) return { fail: h.id };
      issues.push('The panels do not fit the wall between the openings.');
      fillPanels(panels, joints, divide(s.a, s.b, maxW), holes, top, addJoint);
      continue;
    }
    fillPanels(panels, joints, wholeJ, holes, top, addJoint);
  }
  const placed = new Set(panels.flatMap((p) => p.holes.map((h) => h.id)));
  const lost = cuts.find((q) => !placed.has(q.id));
  if (lost) return { fail: lost.id };
  panels.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  return { panels, joints, issues: [] };
}

function fillPanels(panels, joints, cuts, holes, top, addJoint) {
  for (let i = 0; i < cuts.length - 1; i++) {
    const x0 = cuts[i];
    const x1 = cuts[i + 1];
    const hs = holes.filter((h) => h.x0 >= x0 - EPS && h.x1 <= x1 + EPS).map((h) => ({ id: h.id, x0: h.x0, x1: h.x1, y0: h.y0, y1: Math.min(h.y1, top) }));
    panels.push({ kind: 'panel', x0, x1, y0: 0, y1: top, rects: carve(x0, x1, 0, top, hs), holes: hs });
    addJoint(x0); addJoint(x1);
  }
}

// Walls: spans and corners ---------------------------------------------------------------------------------------------------

const wlen = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

/**
 * How each end of each exterior panel wall meets the next: the longer wall runs through the corner (its end extends half the other wall's
 * thickness), the shorter one stops at its inner face (retreat). Returns Map(wallId -> { a: mm, b: mm }), positive is an extension beyond the
 * centre line end, negative a retreat. Joints between the panels of the two walls therefore line up at the corner.
 */
export function panelEnds(walls, tol = 3) {
  const list = walls.filter((w) => w.panel && w.kind !== 'interior' && wlen(w) > 10);
  const out = new Map(list.map((w) => [w.id, { a: 0, b: 0 }]));
  const dirOf = (w, end) => { const L = wlen(w); const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L }; return end === 'a' ? d : { x: -d.x, y: -d.y }; };
  const ends = [];
  for (const w of list) { ends.push({ w, end: 'a', p: w.a }); ends.push({ w, end: 'b', p: w.b }); }
  for (let i = 0; i < ends.length; i++) {
    for (let k = i + 1; k < ends.length; k++) {
      const A = ends[i];
      const B = ends[k];
      if (A.w.id === B.w.id || Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y) > tol) continue;
      const da = dirOf(A.w, A.end);
      const db = dirOf(B.w, B.end);
      if (Math.abs(da.x * db.y - da.y * db.x) < 0.7) continue; // only near right angles
      const la = wlen(A.w);
      const lb = wlen(B.w);
      const aOwns = la > lb + 1 || (Math.abs(la - lb) <= 1 && String(A.w.id) < String(B.w.id));
      const own = aOwns ? A : B;
      const rec = aOwns ? B : A;
      const tOwn = own.w.panel.thicknessMm || 180;
      out.get(own.w.id)[own.end] = (rec.w.thickness || 200) / 2;
      out.get(rec.w.id)[rec.end] = -(tOwn - (own.w.thickness || 200) / 2);
    }
  }
  return out;
}

/**
 * The visible span of a panel wall along its centre line: { start, length } in mm from end a (start is negative when the wall runs through a
 * corner). ends is the entry of panelEnds for the wall.
 */
export function wallSpan(w, ends = { a: 0, b: 0 }) {
  const L = wlen(w);
  const start = -ends.a;
  return { start, length: L + ends.a + ends.b, wallLength: L };
}

/** Wall base to the top of the panels: the wall height, the parapet on top, or the dado height for the combination system. */
export function panelTop(spec, wallHeightMm, { topLevel = true } = {}) {
  if (spec.system === 'tilt_up_metal_upper') return Math.min(spec.dadoMm, wallHeightMm);
  return wallHeightMm + (topLevel && spec.parapetMm > 0 ? spec.parapetMm : 0);
}

/**
 * The whole layout of a model wall: { span, top, layout } with openings taken from the wall's openings (list of model openings).
 * wallHeightMm is the wall's own height; topLevel says whether the parapet goes on this wall.
 */
export function panelWallLayout(w, openings, { ends, wallHeightMm, topLevel = true } = {}) {
  const spec = w.panel;
  const span = wallSpan(w, ends || { a: 0, b: 0 });
  const top = panelTop(spec, wallHeightMm, { topLevel });
  const ops = (openings || []).map((o) => ({ id: o.id, kind: o.kind, offset: o.offset - span.start, width: o.width, height: o.height, sill: o.sill || 0 }));
  const layout = layoutWall({
    length: span.length, top, openings: ops, maxWidth: spec.maxWidthMm, frontage: !!spec.frontage, accent: spec.accent, signage: !!spec.signage, reveals: spec.reveals, featureBand: !!spec.featureBand,
  });
  return { span, top, layout };
}

/** Panels, joints and area of a layout, for the schedules and the tests. */
export function layoutStats(layout) {
  const n = layout.panels.length;
  const area = layout.panels.reduce((s, p) => s + p.rects.reduce((a, r) => a + ((r.x1 - r.x0) * (r.y1 - r.y0)) / 1e6, 0), 0);
  return { panels: n, joints: layout.joints.length, areaM2: Math.round(area * 100) / 100, jointM: Math.round((layout.joints.length * layout.top) / 10) / 100 };
}
