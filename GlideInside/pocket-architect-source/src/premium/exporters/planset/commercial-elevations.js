// ELEVATIONS for the commercial plan set (sheet family C200): for every catalogue building and strata unit row, four elevations (front, rear and both
// ends) in a 2 by 2 grid on one sheet, at the largest scale at which all four fit. Every storey is drawn (each level's exterior walls at its floor
// level), the real roof shape (gable end as a triangle, skillion and flat as a strip over the wall), the 3D props (canopies, pump islands, posts,
// dock seals, glazing bands), the natural and finished ground from the levels model, level tags with RLs, overall dimensions and a view title.
// What stays from the earlier single street elevation: concrete panel joints and marks, blockwork coursing, sheet ribs, openings, parapet, feature band,
// accent panels and the signage band. Levels are indicative (state 5 m DEM or an assumed datum). Everything is concept only.

import { buildingsOf } from '../../../commercial/catalogue/buildings.js';
import { panelEnds, panelWallLayout, layoutStats, JOINT_MM } from '../../../commercial/catalogue/panels.js';
import { systemById, hexOfCladding, isPanelSystem } from '../../../commercial/catalogue/construction.js';
import { PEN, clean, haloText, dimLine } from '../eng/kit.js';
import { VP } from './site.js';
import { viewTargets, toWorld, roofRiseAt, topOf } from './commercial-targets.js';
import { rlText } from './levels.js';

export const ELEVATION_SCALES = [20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
export const DATUM_RL = 100;
const GREY = [120, 124, 132];
const SHEET_FILL = [236, 238, 241];
const TAG_W = 40; // mm of sheet kept at the right of each elevation for the level tags
const TXT = 5.6; // smallest text on a paid sheet

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0xdcdcd6; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lighten = (rgb, k) => rgb.map((c) => Math.round(c + (255 - c) * k));
const darken = (rgb, k) => rgb.map((c) => Math.round(c * (1 - k)));
/** The cladding fill: a shed's own colour (rgb.own) is lightened much less, so the chosen colour reads on the sheet. */
const tone = (rgb, k) => lighten(rgb, rgb.own ? k * 0.2 : k);
const wlen = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;

const SLOT_FILL = { canopy: [222, 226, 230], steel: [96, 104, 114], concrete: [196, 198, 200], asphalt: [120, 122, 126], panel: [232, 235, 238], pump: [190, 196, 204], board: [58, 62, 70], glass: [190, 214, 228], furniture: [170, 150, 120], plant: [150, 156, 164], foliage: [130, 170, 120], seal: [50, 54, 58], bumper: [60, 64, 70] };
const slotFill = (s) => SLOT_FILL[s] || [190, 194, 200];

/** The four sides: outward direction in the target frame ('front' faces the street, -rear). */
export const SIDES = [
  { id: 'front', name: 'FRONT ELEVATION (STREET)', out: (t) => ({ x: -t.frame.rear.x, y: -t.frame.rear.y }) },
  { id: 'rear', name: 'REAR ELEVATION', out: (t) => ({ ...t.frame.rear }) },
  { id: 'left', name: 'LEFT END ELEVATION', out: (t) => ({ x: -t.frame.u.x, y: -t.frame.u.y }) },
  { id: 'right', name: 'RIGHT END ELEVATION', out: (t) => ({ ...t.frame.u }) },
];

const compassName = (project, v) => {
  const n = Number(project?.site?.northDeg) || 0; // plan angle of north, degrees clockwise from the top of the screen
  const a = (Math.atan2(v.x, -v.y) * 180) / Math.PI + n; // bearing the face looks toward
  const b = ((a % 360) + 360) % 360;
  return ['NORTH', 'NORTH EAST', 'EAST', 'SOUTH EAST', 'SOUTH', 'SOUTH WEST', 'WEST', 'NORTH WEST'][Math.round(b / 45) % 8];
};

/** The viewer's right axis (world) when looking at a face with outward normal n. */
const rightOf = (n) => ({ x: n.y, y: -n.x });
const localOf = (t, v) => ({ x: dot(v, t.frame.u), y: dot(v, t.frame.rear) });

/** The facade of one level on one side: its exterior wall runs, from the 3D model. [{ w, H, ops, flip, lo, e, pl, span }] sorted left to right. */
export function facadeGeometry(f, project) {
  const level = f.level;
  const wallsAll = (level.walls || []).filter((w) => w.panel);
  const ends = panelEnds(wallsAll);
  const right = rightOf(f.outward);
  const flipOf = (w) => {
    const L = wlen(w) || 1;
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    return d.x * right.x + d.y * right.y < 0;
  };
  const runs = f.walls.map((w) => {
    const e = ends.get(w.id) || { a: 0, b: 0 };
    const H = Number(w.height) || level.height;
    const ops = (level.openings || []).filter((o) => o.wallId === w.id);
    const flip = flipOf(w);
    const lo = Math.min(dot(w.a, right), dot(w.b, right));
    const concrete = w.panel && isPanelSystem(w.panel.system);
    const pl = concrete ? panelWallLayout(w, ops, { ends: e, wallHeightMm: H }) : null;
    return { w, H, ops, flip, lo, e, pl, span: concrete ? pl.span : { start: 0, length: wlen(w), wallLength: wlen(w) } };
  }).sort((p, q) => p.lo - q.lo);
  return { runs };
}

/** Exterior wall runs of a building target on one side, per storey: [{ z, h, level, walls }]. Rows: the real front wall; the other sides are plain. */
function sideLevels(t, side) {
  const n = side.out(t);
  const out = [];
  if (t.kind === 'building' && !t.open) {
    for (const lv of t.levels) {
      const cands = (lv.level.walls || []).filter((w) => w.building === t.building.id && w.kind === 'exterior' && w.outside && (() => {
        const L = wlen(w) || 1;
        const nx = (-(w.b.y - w.a.y) / L) * w.outside;
        const ny = ((w.b.x - w.a.x) / L) * w.outside;
        return nx * n.x + ny * n.y > 0.9;
      })());
      if (cands.length) out.push({ z: lv.z, h: lv.h, level: lv.level, walls: cands });
    }
  } else if (side.id === 'front') {
    const level = t.levels[0].level;
    const a = toWorld(t, 0, 0);
    const z = toWorld(t, t.L, 0);
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 6;
    const hit = (level.walls || []).find((w) => !w.building && ((near(w.a, a) && near(w.b, z)) || (near(w.a, z) && near(w.b, a))));
    if (hit) out.push({ z: 0, h: t.levels[0].h, level, walls: [hit] });
  }
  return out;
}

/** Roof (and parapet) silhouette over the wall top, seen from a side: [{ s, z }] along the side from its left, z above the ground floor. */
function roofSilhouette(t, side, n) {
  const rL = localOf(t, rightOf(n));
  const nL = localOf(t, n);
  const corners = [{ x: 0, y: 0 }, { x: t.L, y: 0 }, { x: t.L, y: t.D }, { x: 0, y: t.D }];
  const sOf = (p) => p.x * rL.x + p.y * rL.y;
  const sMin = Math.min(...corners.map(sOf));
  const sMax = Math.max(...corners.map(sOf));
  void nL;
  const N = 40;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const s = sMin + ((sMax - sMin) * i) / N;
    let rise = 0;
    for (let j = 0; j <= 20; j++) {
      // the point of the footprint at this s: walk across the depth axis
      const k = j / 20;
      // local point with sOf = s on the footprint: along the other axis
      const p = Math.abs(rL.x) > 0.5 ? { x: (s - rL.y * k * t.D) / rL.x, y: k * t.D } : { x: k * t.L, y: (s - rL.x * k * t.L) / rL.y };
      if (p.x < -1 || p.x > t.L + 1 || p.y < -1 || p.y > t.D + 1) continue;
      rise = Math.max(rise, roofRiseAt(t.roof, t.L, t.D, Math.min(t.L, Math.max(0, p.x)), Math.min(t.D, Math.max(0, p.y))));
    }
    pts.push({ s: s - sMin, z: t.wallTop + (t.roof.type === 'flat' ? 140 : rise) });
  }
  void side;
  return { pts, width: sMax - sMin };
}

const SCALE_LIST = ELEVATION_SCALES;

/** Per side data (without drawing): { side, n, levels, sil, width, ... } */
function sideData(t, side) {
  const n = side.out(t);
  const rL = localOf(t, rightOf(n));
  const nL = localOf(t, n);
  const corners = [{ x: 0, y: 0 }, { x: t.L, y: 0 }, { x: t.L, y: t.D }, { x: 0, y: t.D }];
  const sOf = (p) => p.x * rL.x + p.y * rL.y;
  const dOf = (p) => p.x * nL.x + p.y * nL.y;
  const sMin = Math.min(...corners.map(sOf));
  const sMax = Math.max(...corners.map(sOf));
  const dW = Math.max(...corners.map(dOf));
  const rW = rightOf(n);
  const wMin = Math.min(...corners.map((p) => dot(toWorld(t, p.x, p.y), rW)));
  const lv = sideLevels(t, side);
  const sil = roofSilhouette(t, side, n);
  const top = topOf(t);
  return { side, n, rL, nL, sOf, dOf, sMin, wMin, width: sMax - sMin, dW, lv, sil, top };
}

/** Where the elevations of a target sit: { scale, cols, rows, cell } at the largest scale at which every side fits its cell. */
export function elevationLayout(t, levels) {
  const datas = SIDES.map((s) => sideData(t, s));
  const vw = VP.x1 - VP.x0;
  const vh = VP.y1 - VP.y0;
  const ground = groundRange(t, levels, datas);
  const need = datas.map((d) => ({ w: d.width + 1800, h: d.top + 600 - ground.lo + 400 }));
  // 2 by 2, four rows, or two sides across and two full rows: the arrangement that gives the larger scale wins (ties go to 2 by 2).
  let best = null;
  for (const rowCols of [[2, 2], [2, 1, 1], [1, 1, 2], [1, 1, 1, 1]]) {
    const rows = rowCols.length;
    const rh = vh / rows;
    const boxes = [];
    rowCols.forEach((cols, r) => { for (let c = 0; c < cols; c++) boxes.push({ x0: VP.x0 + (c * vw) / cols, x1: VP.x0 + ((c + 1) * vw) / cols, y0: VP.y0 + r * rh, y1: VP.y0 + (r + 1) * rh, strip: cols === 1 && rows > 2 }); });
    const fits = (s) => boxes.every((b, k) => {
      const aw = b.x1 - b.x0 - TAG_W - 12;
      const ah = b.y1 - b.y0 - (b.strip ? 4 + 14 : 10 + 22) - 10;
      return need[k].w / s <= aw && need[k].h / s <= ah;
    });
    const scale = SCALE_LIST.find(fits) || SCALE_LIST.at(-1) * 2;
    if (!best || scale < best.scale) best = { scale, boxes };
  }
  return { ...best, datas, ground };
}

const groundRange = (t, levels, datas) => {
  let lo = -400;
  if (levels?.has) {
    for (const d of datas) for (const f of groundLine(t, d, levels, -1800, d.width + 1800, 12)) { lo = Math.min(lo, f.nat ?? 0, f.des ?? 0); }
  }
  return { lo: lo - 150 };
};

const fflOfTarget = (t, levels) => (levels?.fflOf ? levels.fflOf(t.outline) : DATUM_RL);

/** Natural and finished ground heights (mm above this target's floor level) along a side, from s0 to s1 (mm from the left end of the face). */
function groundLine(t, d, levels, s0, s1, steps = 24) {
  const ffl = fflOfTarget(t, levels);
  const face = [{ x: 0, y: 0 }, { x: t.L, y: 0 }, { x: t.L, y: t.D }, { x: 0, y: t.D }].filter((p) => Math.abs(d.dOf(p) - d.dW) < 1).sort((a, b) => d.sOf(a) - d.sOf(b))[0];
  const nW = d.n;
  const rW = rightOf(nW);
  const base = toWorld(t, face.x, face.y);
  const s0w = d.sOf(face) - d.sMin;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((s1 - s0) * i) / steps;
    const k = s - s0w;
    const p = { x: base.x + rW.x * k + nW.x * 600, y: base.y + rW.y * k + nW.y * 600 };
    const nat = levels?.natural ? levels.natural(p) : null;
    const des = levels?.design ? levels.design(p) : null;
    out.push({ s, nat: nat == null ? null : (nat - ffl) * 1000, des: des == null ? null : (des - ffl) * 1000 });
  }
  return out;
}

/** The sheet scale label (works from the project only). */
export function elevationScaleOf(project, target = null, levels = null) {
  const t = target || viewTargets(project)[0];
  if (!t) return 'NTS';
  try { return `1:${elevationLayout(t, levels).scale} @ A3`; } catch { return 'NTS'; }
}

const dash = (doc, on) => doc.setLineDashPattern(on ? [1.2, 0.9] : [], 0);

/** Draws the wall face of one level (runs) and returns the extents drawn. Y maps mm above the ground floor to sheet mm. */
function drawLevelRuns(doc, f, g, ctx) {
  const { spec, wallRgb, X, Y, px, base } = ctx;
  const parapet = ctx.parapet;
  const L0 = base;
  for (const run of g.runs) {
    const L = run.span.length;
    const flip = run.flip;
    const wallLen = run.w ? wlen(run.w) : L;
    const left = run.lo + (flip ? wallLen - run.span.start - L : run.span.start);
    const XL = (x) => X(left + (flip ? L - x : x));
    const rect = (x0, x1, y0, y1) => { const a = XL(x0); const b = XL(x1); return { x: Math.min(a, b), y: Y(L0 + y1), w: Math.abs(b - a), h: px(y1 - y0) }; };
    const pl = run.pl;
    const open = run.ops.some((o) => o.kind === 'opening' && o.width >= 0.8 * wallLen);
    if (open) {
      // An open sided building (carport, shelter): the wall is not there. The roof and posts are drawn from the props.
      doc.setDrawColor(...GREY); doc.setLineWidth(0.1); dash(doc, true);
      doc.line(XL(0), Y(L0 + run.H), XL(L), Y(L0 + run.H)); dash(doc, false);
      continue;
    }
    if (pl) {
      const joints = new Set(pl.layout.joints.map((j) => Math.round(j)));
      const fillRgb = spec.finish === 'painted' ? wallRgb : spec.finish === 'offform' ? [176, 177, 173] : spec.finish === 'aggregate' ? [170, 168, 162] : [188, 187, 181];
      const accRgb = hexRgb(hexOfCladding(spec.accentColour, '#464a4f'));
      for (const p of pl.layout.panels) {
        for (const r of p.rects) {
          const x0 = r.x0 + (Math.abs(r.x0 - p.x0) < 1.5 && joints.has(Math.round(p.x0)) ? JOINT_MM / 2 : 0);
          const x1 = r.x1 - (Math.abs(r.x1 - p.x1) < 1.5 && joints.has(Math.round(p.x1)) ? JOINT_MM / 2 : 0);
          const q = rect(x0, x1, r.y0, r.y1);
          doc.setFillColor(...(p.accent ? accRgb : fillRgb));
          doc.setDrawColor(...darken(p.accent ? accRgb : fillRgb, 0.45)); doc.setLineWidth(0.1);
          doc.rect(q.x, q.y, q.w, q.h, 'FD');
        }
      }
      doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.16);
      for (const jx of pl.layout.joints) {
        const covered = (side) => pl.layout.panels.flatMap((p) => p.rects.filter((r) => (side === 'l' ? Math.abs(r.x1 - jx) < 1.5 : Math.abs(r.x0 - jx) < 1.5)).map((r) => [r.y0, r.y1]));
        for (const [a, b] of covered('l').flatMap((A) => covered('r').map((B) => [Math.max(A[0], B[0]), Math.min(A[1], B[1])])).filter(([a2, b2]) => b2 > a2)) doc.line(XL(jx), Y(L0 + a), XL(jx), Y(L0 + b));
      }
      doc.setDrawColor(...GREY); doc.setLineWidth(0.1);
      for (const ry of pl.layout.reveals) doc.line(XL(0), Y(L0 + ry), XL(L), Y(L0 + ry));
      if (pl.layout.band) { doc.setDrawColor(...darken(accRgb, 0.3)); doc.line(XL(0), Y(L0 + pl.layout.band.y0), XL(L), Y(L0 + pl.layout.band.y0)); doc.line(XL(0), Y(L0 + pl.layout.band.y1), XL(L), Y(L0 + pl.layout.band.y1)); }
      if (pl.layout.signage) {
        const s = pl.layout.signage; const q = rect(s.x0, s.x1, s.y0, s.y1);
        doc.setFillColor(48, 53, 59); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.12); doc.rect(q.x, q.y, q.w, q.h, 'FD');
        if (q.w > 24) haloText(doc, 'SIGNAGE BAND', q.x + q.w / 2, q.y + q.h / 2 + 0.9, { size: TXT, colour: [225, 225, 225], align: 'center', halo: 0 });
      }
      if (ctx.scale <= 200) {
        let k = 0;
        for (const p of pl.layout.panels) if (p.kind === 'panel' || p.kind === 'lintel') { k += 1; const q = rect(p.x0, p.x1, p.y0, p.y1); if (q.w > 9) haloText(doc, `P${k}`, q.x + q.w / 2, q.y + q.h - 1.6, { size: TXT, colour: GREY, align: 'center', halo: 0 }); }
      }
      if (spec.system === 'tilt_up_metal_upper') {
        const dado = Math.min(spec.dadoMm, run.H);
        const q = rect(0, L, dado, run.H);
        doc.setFillColor(...tone(wallRgb, 0.35)); doc.setDrawColor(...GREY); doc.setLineWidth(0.1);
        doc.rect(q.x, q.y, q.w, q.h, 'FD');
        doc.setLineWidth(0.06);
        for (let x = q.x + 1.4; x < q.x + q.w; x += 1.4) doc.line(x, q.y, x, q.y + q.h);
        doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.14); doc.line(q.x, Y(L0 + dado), q.x + q.w, Y(L0 + dado));
      }
    } else {
      const q = rect(0, L, 0, run.H + (spec.system === 'blockwork' ? parapet : 0));
      doc.setFillColor(...(spec.system === 'blockwork' ? tone(wallRgb, 0.15) : tone(wallRgb, 0.35))); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.18);
      doc.rect(q.x, q.y, q.w, q.h, 'FD');
      doc.setDrawColor(...(spec.system === 'blockwork' ? darken(wallRgb, 0.3) : GREY)); doc.setLineWidth(0.05);
      if (spec.system === 'blockwork') for (let y = 200; y < run.H + parapet; y += 200) { const yy = Y(L0 + y); if (px(200) > 0.7) doc.line(q.x, yy, q.x + q.w, yy); }
      else for (let x = q.x + 1.4; x < q.x + q.w; x += 1.4) doc.line(x, q.y, x, q.y + q.h);
    }
    // Openings, in the wall's own run (a window sits where the 3D has it: offset is the centre along the wall).
    for (const o of run.ops) {
      const ox = o.offset - run.span.start;
      const q = rect(ox - o.width / 2, ox + o.width / 2, o.sill || 0, (o.sill || 0) + o.height);
      if (o.kind === 'opening') { doc.setFillColor(250, 250, 250); doc.setDrawColor(...GREY); doc.setLineWidth(0.1); doc.rect(q.x, q.y, q.w, q.h, 'FD'); }
      else if (o.kind === 'window' || o.kind === 'sliding_door') { doc.setFillColor(214, 232, 244); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.14); doc.rect(q.x, q.y, q.w, q.h, 'FD'); doc.setLineWidth(0.06); doc.line(q.x, q.y + q.h, q.x + q.w, q.y); }
      else if (o.kind === 'roller_door' || o.kind === 'garage_door') {
        doc.setFillColor(...lighten(PEN.grey, 0.5)); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.16); doc.rect(q.x, q.y, q.w, q.h, 'FD');
        doc.setLineWidth(0.05); for (let y = q.y + 0.9; y < q.y + q.h; y += 0.9) doc.line(q.x, y, q.x + q.w, y);
      } else { doc.setFillColor(255, 255, 255); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.16); doc.rect(q.x, q.y, q.w, q.h, 'FD'); }
      // Door marks (RD1, RD2, PA1) with the size when the door is wide enough on the sheet.
      if (o.mark && (o.kind === 'roller_door' || o.kind === 'door')) {
        const lab = q.w > 40 ? `${o.mark}  ${Math.round(o.width)} x ${Math.round(o.height)}` : q.w > 4.5 ? o.mark : '';
        if (lab) haloText(doc, lab, q.x + q.w / 2, q.y + q.h / 2 + 0.8, { size: TXT, bold: true, align: 'center', halo: 0.7 });
      }
    }
    if (parapet > 0 && pl) { doc.setDrawColor(...GREY); dash(doc, true); doc.setLineWidth(0.1); doc.line(XL(0), Y(L0 + run.H), XL(L), Y(L0 + run.H)); dash(doc, false); }
  }
}

/** Draws one elevation into its cell and returns its sheet bounds. */
function drawSide(doc, t, d, box, scale, levels, wallRgb) {
  const px = (mm) => mm / scale;
  const aw = box.x1 - box.x0 - TAG_W - 8;
  const wMm = d.width;
  const X0 = box.x0 + 4 + Math.max(0, (aw - px(wMm + 1800)) / 2) + px(900);
  const ground = groundRange(t, levels, [d]);
  const topMm = d.top + 700;
  const hMm = topMm - ground.lo;
  const strip = !!box.strip;
  const areaTop = box.y0 + (strip ? 4 : 10);
  const areaBot = box.y1 - (strip ? 14 : 22) - 7;
  const drawH = Math.min(areaBot - areaTop, px(hMm));
  const zeroY = (strip ? areaTop + (areaBot - areaTop - drawH) / 2 : areaBot - drawH) + px(topMm);
  const Y = (mm) => zeroY - px(mm);
  const X = (s) => X0 + px(s - d.sMin);
  const spec = t.spec;
  const ffl = fflOfTarget(t, levels);
  const bounds = { x0: X0 - px(900), x1: X0 + px(wMm + 900), y0: Y(topMm), y1: Y(ground.lo) };

  // Ground: natural dashed, finished solid with ground ticks. Without ground data the line is level at the floor.
  const gl = groundLine(t, d, levels, -900, wMm + 900, 28);
  const hasG = levels?.has && gl.some((p) => p.des != null || p.nat != null);
  doc.setLineDashPattern([], 0);
  if (hasG) {
    doc.setDrawColor(...PEN.grey); doc.setLineWidth(0.18); dash(doc, true);
    const nat = gl.filter((p) => p.nat != null);
    for (let i = 0; i + 1 < nat.length; i++) doc.line(X0 + px(nat[i].s), Y(nat[i].nat), X0 + px(nat[i + 1].s), Y(nat[i + 1].nat));
    dash(doc, false);
    const des = gl.filter((p) => p.des != null);
    doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.5);
    for (let i = 0; i + 1 < des.length; i++) doc.line(X0 + px(des[i].s), Y(des[i].des), X0 + px(des[i + 1].s), Y(des[i + 1].des));
    doc.setLineWidth(0.1);
    for (let i = 0; i < des.length; i++) for (let k = 0; k < 4; k++) { const x = X0 + px(des[i].s) + k * ((px(des[Math.min(i + 1, des.length - 1)].s - des[i].s) || 1) / 4); doc.line(x, Y(des[i].des), x - 0.9, Y(des[i].des) + 1); }
  } else {
    doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.5);
    doc.line(X0 - px(900), Y(0), X0 + px(wMm + 900), Y(0));
    doc.setLineWidth(0.1);
    for (let x = X0 - px(900); x < X0 + px(wMm + 900); x += 1.6) doc.line(x, Y(0), x - 0.9, Y(0) + 1);
  }
  // Slab edge under the building
  doc.setFillColor(205, 207, 210); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.15);
  doc.rect(X(d.sMin), Y(0), px(wMm), px(150), 'FD');

  const f0 = { outward: d.n };
  const ctx0 = { spec, wallRgb, px, scale, parapet: t.parapetMm };
  // Props behind the building (not hidden by it) are drawn lighter, before the walls
  const nearProps = [];
  for (const p of t.props) {
    const cx = (p.x0 + p.x1) / 2; const cy = (p.y0 + p.y1) / 2;
    const inside = cx > 0 && cx < t.L && cy > 0 && cy < t.D;
    if (inside && p.z1 <= t.wallTop && !t.open) continue;
    const dep = d.dOf({ x: cx, y: cy });
    if (dep < d.dW - 1 && !t.open) continue; // on the far side of the building: hidden by it
    const sv = [d.sOf({ x: p.x0, y: p.y0 }), d.sOf({ x: p.x1, y: p.y0 }), d.sOf({ x: p.x0, y: p.y1 }), d.sOf({ x: p.x1, y: p.y1 })];
    const s0 = Math.min(...sv) - d.sMin; const s1 = Math.max(...sv) - d.sMin;
    if (s1 < 0 || s0 > d.width) continue; // beside the building, not in front of it
    nearProps.push({ p, dep, s0: Math.max(0, s0), s1: Math.min(d.width, s1) });
  }
  nearProps.sort((a, b) => a.dep - b.dep);
  const drawProp = ({ p, s0, s1 }) => {
    const x = X0 + px(s0); const w = Math.max(0.25, px(s1 - s0));
    const y1 = Y(p.z1); const h = Math.max(0.25, px(p.z1 - p.z0));
    const f = slotFill(p.slot);
    doc.setFillColor(...f); doc.setDrawColor(...(p.slot === 'steel' || p.slot === 'seal' || p.slot === 'bumper' || p.slot === 'board' ? PEN.ink : GREY)); doc.setLineWidth(p.slot === 'canopy' ? 0.3 : 0.14);
    doc.rect(x, y1, w, h, 'FD');
  };
  void f0;

  // Walls per storey
  for (const lv of d.lv) {
    const fl = { outward: d.n, level: lv.level, walls: lv.walls };
    const g = facadeGeometry(fl, t.project);
    drawLevelRuns(doc, fl, g, { ...ctx0, X: (sw) => X0 + px(sw - d.wMin), Y, base: lv.z });
  }
  if (t.kind === 'row' && d.side.id !== 'front') {
    // Rows: the rear and end walls are plain sheet.
    const w = d.width; const H = t.levels[0].h;
    doc.setFillColor(...tone(wallRgb, 0.35)); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.18); doc.rect(X(d.sMin), Y(H), px(w), px(H), 'FD');
    doc.setDrawColor(...GREY); doc.setLineWidth(0.05);
    for (let x = X(d.sMin) + 1.4; x < X(d.sMin) + px(w); x += 1.4) doc.line(x, Y(H), x, Y(0));
  }
  // Floor lines on multi storey walls
  for (const lv of t.levels.slice(1)) {
    doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.16);
    doc.line(X(d.sMin), Y(lv.z), X(d.sMin) + px(wMm), Y(lv.z));
  }
  // Props in front of the wall, far to near
  for (const q of nearProps) drawProp(q);

  // Roof over the wall top
  const sil = d.sil.pts.map((q) => ({ x: X0 + px(q.s), y: Y(q.z) }));
  const rise = Math.max(...d.sil.pts.map((q) => q.z - t.wallTop));
  if (rise > Math.max(80, t.parapetMm) + 1) {
    const poly = [{ x: X0, y: Y(t.wallTop) }, ...sil, { x: X0 + px(wMm), y: Y(t.wallTop) }];
    const lines = poly.map((q, i) => (i === 0 ? [q.x, q.y] : [q.x - poly[i - 1].x, q.y - poly[i - 1].y]));
    doc.setFillColor(...tone(wallRgb, 0.55)); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.22);
    doc.lines(lines.slice(1), lines[0][0], lines[0][1], [1, 1], 'FD', true);
    if (t.roof.type === 'gable' && ((t.roof.ridge === 'y') === (d.side.id === 'front' || d.side.id === 'rear'))) {
      // seen from the gable end: sheeting lines up the roof slope are not shown, the verge is the outline
    } else {
      doc.setDrawColor(...GREY); doc.setLineWidth(0.06);
      for (let x = X0 + 1.6; x < X0 + px(wMm); x += 1.6) doc.line(x, Y(t.wallTop), x, Y(t.wallTop + rise) + 0.2);
    }
  } else if (t.roof.type !== 'flat' && rise > 80) {
    doc.setDrawColor(...GREY); dash(doc, true); doc.setLineWidth(0.1);
    doc.line(X0, Y(t.wallTop + rise), X0 + px(wMm), Y(t.wallTop + rise)); dash(doc, false);
  }
  if (t.parapetMm > 0 && t.kind === 'building' && spec.system !== 'blockwork' && !d.lv.some((l) => l.walls.some((w) => w.panel))) {
    doc.setFillColor(...tone(wallRgb, 0.3)); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.18);
    doc.rect(X0, Y(t.wallTop + t.parapetMm), px(wMm), px(t.parapetMm), 'FD');
  }

  // Level tags at the right
  const lx = X0 + px(wMm) + px(900) + 4;
  const rl = (mm) => `RL ${rlText(ffl + mm / 1000)}`;
  const assumed = !levels?.has && !levels?.floorSet;
  const tagList = [];
  tagList.push([0, `${rl(0)} FFL${assumed ? ' (ASSUMED)' : ''}`]);
  for (const lv of t.levels.slice(1)) tagList.push([lv.z, `${rl(lv.z)} FFL LEVEL ${t.levels.indexOf(lv)}`]);
  tagList.push([t.wallTop, `${rl(t.wallTop)} ${t.parapetMm ? 'EAVE' : t.roof.type === 'skillion' || t.roof.type === 'flat' ? 'LOW EAVE' : 'EAVE'}`]);
  if (t.parapetMm > 0) tagList.push([t.wallTop + t.parapetMm, `${rl(t.wallTop + t.parapetMm)} TOP OF PARAPET`]);
  else if (rise > 80) tagList.push([t.wallTop + rise, `${rl(t.wallTop + rise)} ${t.roof.type === 'gable' ? 'RIDGE' : 'HIGH EDGE OF ROOF'}`]);
  tagList.sort((a, b) => a[0] - b[0]);
  let lastY = Infinity;
  for (const [mm, text] of tagList) {
    const y = Y(mm);
    doc.setDrawColor(...PEN.dim); doc.setLineWidth(0.12); doc.line(X0 + px(wMm) + px(500), y, lx - 1, y);
    doc.setFillColor(...PEN.dim); doc.triangle(lx - 1, y, lx + 1.2, y - 0.9, lx + 1.2, y + 0.9, 'F');
    const ty = Math.min(y + 1, lastY - 2.4);
    haloText(doc, text, lx + 2.2, ty, { size: TXT, colour: PEN.dim, halo: 0 });
    lastY = ty - 1.4;
  }
  if (hasG) {
    haloText(doc, 'NATURAL SURFACE (INDICATIVE), DASHED', X0 - px(900), Y(ground.lo) + 2.8, { size: TXT, colour: GREY, halo: 0.9 });
    haloText(doc, 'FINISHED SURFACE (INDICATIVE)', X0 + px(wMm + 900), Y(ground.lo) + 2.8, { size: TXT, colour: PEN.ink, halo: 0.9, align: 'right' });
  }
  // Overall dimensions
  const dy = Y(ground.lo) + 6.5;
  dimLine(doc, { x: X(d.sMin), y: dy }, { x: X(d.sMin) + px(wMm), y: dy }, `${(wMm / 1000).toFixed(1)} m`, { size: TXT, textSide: 1 });
  const top = Math.max(t.wallTop + t.parapetMm, t.wallTop + rise);
  dimLine(doc, { x: X0 - px(300) - 6, y: Y(0) }, { x: X0 - px(300) - 6, y: Y(top) }, `${(top / 1000).toFixed(1)} m`, { size: TXT, textSide: -1 });
  // View title under the drawing
  const compass = compassName(t.project, d.n);
  haloText(doc, `${t.tag} ${d.side.name}`, box.x0 + 4, box.y1 - 6.2, { size: 8, bold: true, halo: 0 });
  haloText(doc, `${compass} FACING   |   1:${scale} @ A3`, box.x0 + 4, box.y1 - 2.2, { size: TXT, colour: GREY, halo: 0 });
  doc.setDrawColor(...PEN.tag); doc.setLineWidth(0.5); doc.line(box.x0 + 4, box.y1 - 4.8, box.x0 + 4 + 40, box.y1 - 4.8);
  return bounds;
}

/** Sheet (elevation family): the four elevations of one target. Returns { kv, notes, blocks, bounds, fill } for the title strip. */
export function drawElevations(doc, model, target, levels = null) {
  const project = model.project;
  const t = target || viewTargets(project)[0];
  const lv = levels || model.levels || null;
  if (!t) {
    haloText(doc, 'No building or unit row to draw an elevation of.', VP.x0 + 10, VP.y0 + 12, { size: 8, halo: 0 });
    return { kv: [], notes: [], blocks: [] };
  }
  const lay = elevationLayout(t, lv);
  const own = t.building?.def?.wallFinish ? t.building.def.wallFinish(t.params) : null; // a shed's own cladding colour
  const wallRgb = hexRgb(own?.colour || project.finishes?.externalWalls?.colour || '#e8e5da');
  if (own) wallRgb.own = true;
  doc.setLineDashPattern([], 0);
  const bounds = [];
  SIDES.forEach((side, i) => {
    const box = lay.boxes[i];
    doc.setFillColor(...SHEET_FILL);
    bounds.push(drawSide(doc, t, lay.datas[i], box, lay.scale, lv, wallRgb));
  });
  const area = (VP.x1 - VP.x0) * (VP.y1 - VP.y0);
  const fill = bounds.reduce((s, b) => s + Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0), 0) / area;
  const ffl = fflOfTarget(t, lv);
  const assumed = !lv?.has && !lv?.floorSet;
  const kv = [
    ['Building', clean(t.label)],
    ['Elevations', '4'],
    ['Scale', `1:${lay.scale} @ A3`],
    ['Storeys', String(t.levels.length)],
    ['Floor level', `RL ${rlText(ffl)}${assumed ? ' (assumed)' : ''}`],
    ['Datum', lv?.datumNote || `Assumed RL ${rlText(DATUM_RL)}`],
  ];
  const notes = [
    'Concept only. Elevations are indicative and not for construction.',
    assumed ? 'Levels are on an assumed datum (floor level RL 100.00), there is no survey level in the model. Check with a registered surveyor.' : 'Levels are indicative, interpolated from the state 5 m elevation model, not survey. A registered surveyor must confirm levels.',
    'Panel joints are 20 mm. Panel sizes, lifting and bracing are for the structural engineer, lifting inserts are not shown.',
    `${clean(t.label)}: ${clean(t.constructionLine)}.`,
  ];
  void systemById; void buildingsOf; void layoutStats;
  return { kv, notes, blocks: [], bounds, fill };
}
