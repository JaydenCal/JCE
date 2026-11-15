// C104 ELEVATIONS for the commercial plan set: one elevation for each street facing facade (the front of every catalogue building and every
// strata row), seen from outside. It shows what the 3D model has: concrete panel joints (tilt-up, precast, concrete below metal cladding),
// blockwork coursing or metal sheet ribs, openings, parapet, feature band, accent panels and signage band. Levels are indicative: the floor level
// is shown as RL 100.00 on an assumed datum, there is no survey level in the model. Everything is concept only.

import { rowFrame, rowLength, rowPoint } from '../../../commercial/layout.js';
import { buildingsOf } from '../../../commercial/catalogue/buildings.js';
import { roofsOf } from '../../../commercial/catalogue/materialise.js';
import { panelEnds, panelWallLayout, layoutStats, JOINT_MM } from '../../../commercial/catalogue/panels.js';
import { constructionSpec, constructionLine, systemById, hexOfCladding, isPanelSystem } from '../../../commercial/catalogue/construction.js';
import { PEN, clean, haloText } from '../eng/kit.js';
import { VP } from './site.js';

export const ELEVATION_SCALES = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
export const DATUM_RL = 100;
const GREY = [120, 124, 132];
const SHEET_FILL = [236, 238, 241];
const MARGIN_MM = 2500; // ground line runs this far beyond the wall each side

const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0xdcdcd6; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lighten = (rgb, k) => rgb.map((c) => Math.round(c + (255 - c) * k));
const darken = (rgb, k) => rgb.map((c) => Math.round(c * (1 - k)));
const wlen = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

/** The street facing facades of the model: [{ id, label, wall, openings, level, spec, frame?, roof, params }]. */
export function elevationFacades(project) {
  const c = project.commercial;
  const level = project.levels?.[0];
  if (!c || !level) return [];
  const walls = (level.walls || []).filter((w) => w.kind === 'exterior');
  const out = [];
  // Catalogue buildings: the wall whose outward normal is the building's front (-v).
  for (const b of buildingsOf(c)) {
    const front = { x: -b.frame.v.x, y: -b.frame.v.y };
    const mine = walls.filter((w) => w.building === b.id && w.outside);
    const cands = mine.filter((w) => {
      const L = wlen(w) || 1;
      const nx = (-(w.b.y - w.a.y) / L) * w.outside;
      const ny = ((w.b.x - w.a.x) / L) * w.outside;
      return nx * front.x + ny * front.y > 0.9;
    }).sort((p, q) => wlen(q) - wlen(p));
    // Recessed dock walls give several short front segments: draw the one run (the longest, then the rest on the same elevation).
    if (!cands.length) continue;
    let roof = null;
    try { roof = roofsOf(b, project)[0] || null; } catch { roof = null; }
    out.push({ id: b.id, label: `B${b.n} ${b.planLabel}`, walls: cands.sort((p, q) => {
      const ax = (p.a.x + p.b.x) / 2 * front.y - (p.a.y + p.b.y) / 2 * front.x; const bx = (q.a.x + q.b.x) / 2 * front.y - (q.a.y + q.b.y) / 2 * front.x; return ax - bx;
    }), outward: front, level, spec: constructionSpec(b.params), roof, params: b.params, key: b.id, kind: 'building' });
  }
  // Strata rows: the wall that runs along the facade line.
  const rows = c.rows || [];
  let n = 0;
  for (const row of rows) {
    n += 1;
    const fr = rowFrame(row, rows);
    const L = rowLength(row, rows);
    const d = row.unit.depthMm;
    const a = rowPoint(fr, 0, d);
    const z = rowPoint(fr, L, d);
    const hit = walls.find((w) => !w.building && ((Math.hypot(w.a.x - a.x, w.a.y - a.y) < 6 && Math.hypot(w.b.x - z.x, w.b.y - z.y) < 6) || (Math.hypot(w.a.x - z.x, w.a.y - z.y) < 6 && Math.hypot(w.b.x - a.x, w.b.y - a.y) < 6)));
    if (!hit) continue;
    out.push({ id: row.id, label: `STRATA UNITS, ROW ${n}`, walls: [hit], outward: fr.f, level, spec: constructionSpec(row.unit), roof: { type: 'skillion', pitchDeg: 3, fall: 'rear' }, params: row.unit, key: '_rows', kind: 'row', depthMm: d, count: row.count });
  }
  return out;
}

/** The facade drawn as data: wall run from the viewer's left, height, openings and the panel layout (when concrete panels). */
export function facadeGeometry(f, project) {
  const level = f.level;
  const wallsAll = (level.walls || []).filter((w) => w.panel);
  const ends = panelEnds(wallsAll);
  const flipOf = (w) => {
    // Viewed from outside: the viewer's right is (n.y, -n.x) of the outward normal; x runs along it.
    const L = wlen(w) || 1;
    const d = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const right = { x: f.outward.y, y: -f.outward.x };
    return d.x * right.x + d.y * right.y < 0;
  };
  // Order the runs left to right by the viewer's right axis.
  const right = { x: f.outward.y, y: -f.outward.x };
  const runs = f.walls.map((w) => {
    const e = ends.get(w.id) || { a: 0, b: 0 };
    const H = Number(w.height) || level.height;
    const ops = (level.openings || []).filter((o) => o.wallId === w.id);
    const flip = flipOf(w);
    const lo = Math.min(w.a.x * right.x + w.a.y * right.y, w.b.x * right.x + w.b.y * right.y);
    const concrete = w.panel && isPanelSystem(w.panel.system);
    const pl = concrete ? panelWallLayout(w, ops, { ends: e, wallHeightMm: H }) : null;
    return { w, H, ops, flip, lo, e, pl, span: concrete ? pl.span : { start: 0, length: wlen(w), wallLength: wlen(w) } };
  }).sort((p, q) => p.lo - q.lo);
  return { runs };
}

const roofRise = (f, depthMm, widthMm) => {
  const r = f.roof;
  if (!r || r.type === 'flat') return { kind: 'flat', rise: 0 };
  const tan = Math.tan(((Number(r.pitchDeg) || 3) * Math.PI) / 180);
  if (r.type === 'gable') return { kind: (r.ridge || (widthMm >= depthMm ? 'x' : 'y')) === 'y' ? 'gable-end' : 'gable-side', rise: ((r.ridge || (widthMm >= depthMm ? 'x' : 'y')) === 'y' ? widthMm : depthMm) / 2 * tan };
  return { kind: 'skillion', rise: depthMm * tan, fall: r.fall || 'rear' };
};

/** Total width and height of a facade drawing in mm (all runs side by side). */
export function facadeExtent(f, g) {
  let w = 0;
  for (const r of g.runs) w += r.span.length;
  const spec = f.spec;
  const H = Math.max(...g.runs.map((r) => r.H));
  const top = H + (spec.parapetMm || 0) + (f.roof && f.roof.type !== 'flat' && !spec.parapetMm ? 1500 : 0);
  return { width: w + 2 * MARGIN_MM * 0 + 2 * 1000, height: Math.max(top, H) + 1800 };
}

/** The common scale and the grid of cells for the facades: { scale, cols, rows, cell }. */
export function elevationLayout(facades, projectGeoms) {
  const n = facades.length;
  if (!n) return { scale: 100, cols: 1, rows: 1, cell: { w: VP.x1 - VP.x0, h: VP.y1 - VP.y0 } };
  const ext = facades.map((f, i) => facadeExtent(f, projectGeoms[i]));
  const vw = VP.x1 - VP.x0;
  const vh = VP.y1 - VP.y0;
  let best = null;
  for (let cols = 1; cols <= Math.min(3, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = vw / cols - 8;
    const ch = vh / rows - 22; // title and levels
    const scale = ELEVATION_SCALES.find((s) => ext.every((e) => e.width / s <= cw && e.height / s <= ch)) || ELEVATION_SCALES.at(-1) * 2;
    if (!best || scale < best.scale) best = { scale, cols, rows };
  }
  return { ...best, cell: { w: vw / best.cols, h: vh / best.rows } };
}

/** The scale label of the sheet, for the sheet list (works from the project only). */
export function elevationScaleOf(project) {
  const fs = elevationFacades(project);
  if (!fs.length) return 'NTS';
  const gs = fs.map((f) => facadeGeometry(f, project));
  return `1:${elevationLayout(fs, gs).scale} @ A3`;
}

const dash = (doc, on) => doc.setLineDashPattern(on ? [1.2, 0.9] : [], 0);

function drawFacade(doc, f, g, project, cellBox, scale, projectRgb) {
  const spec = f.spec;
  const wallRgb = spec.colour && spec.colour !== 'project' && spec.system !== 'metal_clad' ? hexRgb(hexOfCladding(spec.colour)) : projectRgb;
  const sys = systemById(spec.system);
  const X0 = cellBox.x0 + 6;
  const groundY = cellBox.y1 - 12;
  const Y = (mm) => groundY - mm / scale;
  const totalW = g.runs.reduce((s, r) => s + r.span.length, 0);
  const xAt = (run, x) => X0 + (g.runs.slice(0, g.runs.indexOf(run)).reduce((s, r) => s + r.span.length, 0) + x) / scale;
  const H = Math.max(...g.runs.map((r) => r.H));
  const parapet = spec.parapetMm || 0;
  const px = (n) => n / scale;
  // Title
  haloText(doc, `${f.label}  STREET ELEVATION`, cellBox.x0 + 6, cellBox.y0 + 5, { size: 8, bold: true, halo: 0 });
  haloText(doc, `${constructionLine(f.params)}   |   1:${scale} @ A3   |   CONCEPT ONLY`, cellBox.x0 + 6, cellBox.y0 + 9.2, { size: 5.8, colour: GREY, halo: 0 });

  // Ground line
  doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.5);
  doc.line(X0 - px(MARGIN_MM), groundY, X0 + px(totalW + MARGIN_MM), groundY);
  doc.setLineWidth(0.12);
  for (let x = X0 - px(MARGIN_MM); x < X0 + px(totalW + MARGIN_MM); x += 1.6) doc.line(x, groundY, x - 0.9, groundY + 1);

  for (const run of g.runs) {
    const L = run.span.length;
    const flip = run.flip;
    const X = (x) => xAt(run, flip ? L - x : x);
    const rect = (x0, x1, y0, y1) => { const a = X(x0); const b = X(x1); return { x: Math.min(a, b), y: Y(y1), w: Math.abs(b - a), h: px(y1 - y0) }; };
    const pl = run.pl;
    // Wall face
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
      // Joints as heavier lines over the panel edges (the gap is 20 mm, far under a sheet line at these scales).
      doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.16);
      for (const jx of pl.layout.joints) {
        const covered = (side) => pl.layout.panels.flatMap((p) => p.rects.filter((r) => (side === 'l' ? Math.abs(r.x1 - jx) < 1.5 : Math.abs(r.x0 - jx) < 1.5)).map((r) => [r.y0, r.y1]));
        for (const [a, b] of covered('l').flatMap((A) => covered('r').map((B) => [Math.max(A[0], B[0]), Math.min(A[1], B[1])])).filter(([a2, b2]) => b2 > a2)) doc.line(X(jx), Y(a), X(jx), Y(b));
      }
      // Reveals and the feature band
      doc.setDrawColor(...GREY); doc.setLineWidth(0.1);
      for (const ry of pl.layout.reveals) doc.line(X(0), Y(ry), X(L), Y(ry));
      if (pl.layout.band) { doc.setDrawColor(...darken(accRgb, 0.3)); doc.line(X(0), Y(pl.layout.band.y0), X(L), Y(pl.layout.band.y0)); doc.line(X(0), Y(pl.layout.band.y1), X(L), Y(pl.layout.band.y1)); }
      if (pl.layout.signage) {
        const s = pl.layout.signage; const q = rect(s.x0, s.x1, s.y0, s.y1);
        doc.setFillColor(48, 53, 59); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.12); doc.rect(q.x, q.y, q.w, q.h, 'FD');
        haloText(doc, 'SIGNAGE BAND (BLANK)', q.x + q.w / 2, q.y + q.h / 2 + 0.8, { size: 4.4, colour: [225, 225, 225], align: 'center', halo: 0 });
      }
      // Panel marks, when the sheet scale leaves room
      if (scale <= 200) {
        let k = 0;
        for (const p of pl.layout.panels) if (p.kind === 'panel' || p.kind === 'lintel') { k += 1; const q = rect(p.x0, p.x1, p.y0, p.y1); if (q.w > 7) haloText(doc, `P${k}`, q.x + q.w / 2, q.y + q.h - 1.6, { size: 3.8, colour: GREY, align: 'center', halo: 0 }); }
      }
      // Metal cladding above the concrete (combination system)
      if (spec.system === 'tilt_up_metal_upper') {
        const dado = Math.min(spec.dadoMm, run.H);
        const q = rect(0, L, dado, run.H);
        doc.setFillColor(...lighten(wallRgb, 0.35)); doc.setDrawColor(...GREY); doc.setLineWidth(0.1);
        doc.rect(q.x, q.y, q.w, q.h, 'FD');
        doc.setLineWidth(0.06);
        for (let x = q.x + 1.4; x < q.x + q.w; x += 1.4) doc.line(x, q.y, x, q.y + q.h);
        doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.14); doc.line(q.x, Y(dado), q.x + q.w, Y(dado));
      }
    } else {
      const q = rect(0, L, 0, run.H + (spec.system === 'blockwork' ? parapet : 0));
      doc.setFillColor(...(spec.system === 'blockwork' ? lighten(wallRgb, 0.15) : lighten(wallRgb, 0.35))); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.18);
      doc.rect(q.x, q.y, q.w, q.h, 'FD');
      doc.setDrawColor(...(spec.system === 'blockwork' ? darken(wallRgb, 0.3) : GREY)); doc.setLineWidth(0.05);
      if (spec.system === 'blockwork') for (let y = 200; y < run.H + parapet; y += 200) { const yy = Y(y); if (px(200) > 0.7) doc.line(q.x, yy, q.x + q.w, yy); }
      else for (let x = q.x + 1.4; x < q.x + q.w; x += 1.4) doc.line(x, q.y, x, q.y + q.h);
    }
    // Openings (drawn over the wall, so a window cut inside a panel and a door in its column both read)
    for (const o of run.ops) {
      const ox = o.offset - run.span.start;
      const q = rect(ox - o.width / 2, ox + o.width / 2, o.sill || 0, (o.sill || 0) + o.height);
      if (o.kind === 'window') { doc.setFillColor(214, 232, 244); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.14); doc.rect(q.x, q.y, q.w, q.h, 'FD'); doc.setLineWidth(0.06); doc.line(q.x, q.y + q.h, q.x + q.w, q.y); }
      else if (o.kind === 'roller_door' || o.kind === 'garage_door') {
        doc.setFillColor(...lighten(PEN.grey, 0.5)); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.16); doc.rect(q.x, q.y, q.w, q.h, 'FD');
        doc.setLineWidth(0.05); for (let y = q.y + 0.9; y < q.y + q.h; y += 0.9) doc.line(q.x, y, q.x + q.w, y);
      } else { doc.setFillColor(255, 255, 255); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.16); doc.rect(q.x, q.y, q.w, q.h, 'FD'); }
    }
    // Eave line when there is a parapet, and the parapet top
    if (parapet > 0 && pl) {
      doc.setDrawColor(...GREY); dash(doc, true); doc.setLineWidth(0.1);
      doc.line(X(0), Y(run.H), X(L), Y(run.H)); dash(doc, false);
    }
  }

  // Roof seen over the wall (no parapet): a gable end shows as a triangle, a skillion high edge as a strip above the eave.
  if (!parapet) {
    const depth = f.depthMm || (f.params?.depthMm ?? 0);
    const rr = roofRise(f, depth || 20000, totalW);
    doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.2);
    const yE = Y(H);
    if (rr.kind === 'gable-end') {
      doc.setFillColor(...lighten(wallRgb, 0.35));
      doc.triangle(X0, yE, X0 + px(totalW) / 2, Y(H + rr.rise), X0 + px(totalW), yE, 'FD');
    } else if (rr.kind === 'skillion' && rr.fall !== 'front') {
      doc.setFillColor(...lighten(wallRgb, 0.35));
      doc.rect(X0, Y(H + rr.rise), px(totalW), px(rr.rise), 'FD');
    } else if (rr.kind === 'gable-side') {
      doc.setDrawColor(...GREY); dash(doc, true); doc.line(X0, Y(H + rr.rise), X0 + px(totalW), Y(H + rr.rise)); dash(doc, false);
    }
  }

  // Levels (indicative) and overall dimensions
  const rl = (mm) => `RL ${(DATUM_RL + mm / 1000).toFixed(2)}`;
  const lx = X0 + px(totalW) + 4;
  const level = (mm, text) => {
    const y = Y(mm);
    doc.setDrawColor(...PEN.dim); doc.setLineWidth(0.12); doc.line(lx - 3, y, lx + 1, y);
    doc.setFillColor(...PEN.dim); doc.triangle(lx - 1.2, y, lx + 1, y - 0.9, lx + 1, y + 0.9, 'F');
    haloText(doc, text, lx + 2, y + 1, { size: 5.4, colour: PEN.dim, halo: 0 });
  };
  level(0, `${rl(0)} FFL`);
  level(H, `${rl(H)} EAVE`);
  if (parapet > 0) level(H + parapet, `${rl(H + parapet)} TOP OF PARAPET`);
  if (spec.system === 'tilt_up_metal_upper') level(Math.min(spec.dadoMm, H), `${rl(Math.min(spec.dadoMm, H))} TOP OF CONCRETE`);
  doc.setDrawColor(...PEN.dim); doc.setLineWidth(0.12);
  const dy = groundY + 6;
  doc.line(X0, dy, X0 + px(totalW), dy); doc.line(X0, dy - 1, X0, dy + 1); doc.line(X0 + px(totalW), dy - 1, X0 + px(totalW), dy + 1);
  haloText(doc, `${(totalW / 1000).toFixed(1)} m`, X0 + px(totalW) / 2, dy + 3.6, { size: 5.6, colour: PEN.dim, align: 'center', halo: 0 });
  haloText(doc, 'Levels are indicative on an assumed datum, no survey level is in the model', cellBox.x0 + 6, cellBox.y1 - 0.6, { size: 4.8, colour: GREY, halo: 0 });
  void sys;
}

/** C104: every street facing elevation, one scale, indicative levels. Returns { kv, notes, blocks } for the title strip. */
export function drawElevations(doc, model) {
  const project = model.project;
  const facades = elevationFacades(project);
  const geoms = facades.map((f) => facadeGeometry(f, project));
  const lay = elevationLayout(facades, geoms);
  const wallRgb = hexRgb(project.finishes?.externalWalls?.colour || '#e8e5da');
  doc.setLineDashPattern([], 0);
  const cell = lay.cell;
  facades.forEach((f, i) => {
    const col = i % lay.cols;
    const row = Math.floor(i / lay.cols);
    const box = { x0: VP.x0 + col * cell.w, y0: VP.y0 + row * cell.h, x1: VP.x0 + (col + 1) * cell.w, y1: VP.y0 + (row + 1) * cell.h };
    doc.setDrawColor(...PEN.light); doc.setLineWidth(0.12); doc.setFillColor(...SHEET_FILL);
    drawFacade(doc, f, geoms[i], project, box, lay.scale, wallRgb);
  });
  if (!facades.length) haloText(doc, 'No building or unit row to draw an elevation of.', VP.x0 + 10, VP.y0 + 12, { size: 8, halo: 0 });
  const stats = facades.map((f, i) => ({ f, g: geoms[i] }));
  const panelFacades = stats.filter((s) => s.g.runs.some((r) => r.pl));
  const kv = [
    ['Elevations', String(facades.length)],
    ['Scale', `1:${lay.scale} @ A3`],
    ['Datum', `RL ${DATUM_RL.toFixed(2)} FFL, assumed`],
    ...(panelFacades.length ? [['Concrete panels (street facades)', String(panelFacades.reduce((s, x) => s + x.g.runs.reduce((a, r) => a + (r.pl ? layoutStats(r.pl.layout).panels : 0), 0), 0))]] : []),
  ];
  const notes = [
    'Concept only. Elevations are indicative and not for construction.',
    'Levels are on an assumed datum (floor level RL 100.00), there is no survey level in the model. Check with a registered surveyor.',
    'Panel joints are 20 mm. Panel sizes, lifting and bracing are for the structural engineer, lifting inserts are not shown.',
    ...stats.map((s) => `${clean(s.f.label)}: ${clean(constructionLine(s.f.params))}.`),
  ];
  return { kv, notes, blocks: [] };
}
