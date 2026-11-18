// What the commercial elevation and section sheets draw: one TARGET per catalogue building and one per strata unit row (a back to back pair is one
// target). A target carries its own frame, storeys, roof, props and the levels it is built to, so both sheets read one description. Pure, no PDF.
//
// Target frame: x runs along the frontage (u), y runs from the street face to the rear, z is up from the ground floor. World = o + u*x + rear*y.
// Front elevation looks at the face on y = 0, whose outward normal is -rear.

import * as G from '../../../model/geometry.js';
import { buildingsOf } from '../../../commercial/catalogue/buildings.js';
import { roofsOf } from '../../../commercial/catalogue/materialise.js';
import { buildingProps } from '../../../commercial/catalogue/planset.js';
import { constructionSpec, constructionLine } from '../../../commercial/catalogue/construction.js';
import { rowFrame, rowLength, rowPoint, mezzanineOf } from '../../../commercial/layout.js';
import { unitSpec } from '../../../commercial/schema.js';

const RAD = Math.PI / 180;

/** Local (x, y) of a target to a world point (mm). */
export const toWorld = (t, x, y) => ({ x: t.frame.o.x + t.frame.u.x * x + t.frame.rear.x * y, y: t.frame.o.y + t.frame.u.y * x + t.frame.rear.y * y });
/** World point to the target's local (x, y). */
export const toLocal = (t, p) => { const dx = p.x - t.frame.o.x; const dy = p.y - t.frame.o.y; return { x: dx * t.frame.u.x + dy * t.frame.u.y, y: dx * t.frame.rear.x + dy * t.frame.rear.y }; };

/** The roof of a building as the 3D builds it, in target terms: ridge 'x' (along the frontage) or 'y' (front to rear), fall toward 'rear' | 'front' | 'left' | 'right'. */
export function roofTerms(raw, L, D) {
  const type = raw?.type || 'flat';
  const pitchDeg = type === 'flat' ? 2 : Math.max(1, Math.min(60, Number(raw?.pitchDeg) || 22.5));
  const longX = L >= D;
  const ridge = raw?.ridge === 'x' || raw?.ridge === 'y' ? raw.ridge : longX ? 'x' : 'y';
  const fall = ['rear', 'front', 'left', 'right'].includes(raw?.fall) ? raw.fall : longX ? 'rear' : 'right';
  return { type, pitchDeg, ridge, fall, tan: Math.tan(pitchDeg * RAD) };
}

/** Height of the roof surface above the wall top at a local point (mm), 0 on the eave. Flat roofs fall as a skillion at 2 degrees. */
export function roofRiseAt(roof, L, D, x, y) {
  if (!roof || roof.type === 'flat') return 0;
  const t = roof.tan;
  if (roof.type === 'gable') return roof.ridge === 'x' ? (D / 2 - Math.abs(y - D / 2)) * t : (L / 2 - Math.abs(x - L / 2)) * t;
  if (roof.fall === 'rear') return (D - y) * t;
  if (roof.fall === 'front') return y * t;
  if (roof.fall === 'left') return x * t;
  return (L - x) * t;
}

const wallsOf = (level, b) => (level.walls || []).filter((w) => w.building === b.id);

/** Every target of the project: [{ key, kind, label, short, tag, frame, L, D, levels, floors, wallTop, parapetMm, roof, props, spec, ... }]. */
export function viewTargets(project) {
  const c = project?.commercial;
  const out = [];
  if (!c) return out;
  const ground = project.levels?.[0];
  const g0 = Number(ground?.elevation) || 0;
  let bn = 0;
  for (const b of buildingsOf(c)) {
    bn += 1;
    const lv = (project.levels || []).map((l) => ({ l, mine: wallsOf(l, b) })).filter((x) => x.mine.length);
    if (!lv.length) continue;
    const ext = lv.filter((x) => x.mine.some((w) => w.kind === 'exterior'));
    const levels = ext.map(({ l }) => ({ name: l.name, z: (Number(l.elevation) || 0) - g0, h: Number(l.height) || 3000, level: l }));
    const floors = lv.map(({ l }) => ({ name: l.name, z: (Number(l.elevation) || 0) - g0, h: Number(l.height) || 3000, level: l, upper: (Number(l.elevation) || 0) - g0 > 1, hasExt: l === ext.find((e) => e.l === l)?.l }));
    const o = b.outline;
    const frame = { o: { x: b.frame.o.x, y: b.frame.o.y }, u: b.frame.u, rear: b.frame.v };
    const t0 = { frame };
    const xs = b.local.outline.map((q) => q.x);
    const ys = b.local.outline.map((q) => q.y);
    const L = Math.max(...xs) - Math.min(...xs);
    const D = Math.max(...ys) - Math.min(...ys);
    let raw = null;
    try { raw = roofsOf(b, project)[0] || null; } catch { raw = null; }
    const spec = constructionSpec(b.params);
    const wallTop = Math.max(...levels.map((x) => x.z + x.h));
    // An open canopy is a roof on posts: the model carries four plain walls for it, the drawings show posts and the roof instead.
    const open = b.type === 'canopy';
    const props = buildingProps(b);
    if (open) {
      const nx = Math.max(1, Math.ceil(L / 6000));
      for (let i = 0; i <= nx; i++) for (const y of [100, D - 100]) { const x = Math.min(L - 100, Math.max(100, (L * i) / nx)); props.push({ x0: x - 100, x1: x + 100, y0: y - 100, y1: y + 100, z0: 0, z1: wallTop, slot: 'steel' }); }
    }
    out.push({
      key: b.id, kind: 'building', n: bn, tag: `B${b.n}`, short: b.planLabel, label: `B${b.n} ${b.planLabel}`, building: b, frame, L, D, outline: o, levels, floors, wallTop,
      parapetMm: Number(spec.parapetMm) || 0, roof: roofTerms(raw, L, D), props, open, params: b.params, spec, constructionLine: constructionLine(b.params), fflKey: b.id, project, t0,
    });
  }
  const rows = c.rows || [];
  let rn = 0;
  for (const row of rows) {
    if (row.mirrorOf) continue;
    rn += 1;
    const fr = rowFrame(row, rows);
    const Lr = rowLength(row, rows);
    const d = row.unit.depthMm;
    const o = rowPoint(fr, 0, d);
    const frame = { o, u: fr.u, rear: { x: -fr.f.x, y: -fr.f.y } };
    const unit = unitSpec(row, 0);
    const H = Number(row.unit.heightMm) || 6000;
    const pair = rows.some((r) => r.mirrorOf === row.id);
    const spec = constructionSpec(row.unit);
    const mz = mezzanineOf({ ...unit, widthMm: unit.widthMm, depthMm: d });
    out.push({
      key: row.id, kind: 'row', n: rn, tag: `S${rn}`, short: 'STRATA UNITS', label: `S${rn} STRATA UNITS${pair ? ' (BACK TO BACK PAIR)' : ''}`, row, rows, pair, frame, L: Lr, D: d,
      outline: [rowPoint(fr, 0, 0), rowPoint(fr, Lr, 0), rowPoint(fr, Lr, d), rowPoint(fr, 0, d)], levels: [{ name: 'Ground', z: 0, h: H, level: project.levels?.[0] }],
      floors: [{ name: 'Ground', z: 0, h: H, level: project.levels?.[0], upper: false, hasExt: true }], wallTop: H, parapetMm: Number(spec.parapetMm) || 0,
      roof: { type: 'skillion', pitchDeg: 3, ridge: 'x', fall: 'rear', tan: Math.tan(3 * RAD) }, props: [], params: row.unit, spec, constructionLine: constructionLine(row.unit), fflKey: '_rows', unit, mezz: mz.enabled ? mz : null, project,
    });
  }
  void G;
  return out;
}

/** Overall roof peak above the ground floor (mm), or the parapet top when the roof is hidden behind a parapet. */
export function topOf(t) {
  let rise = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) rise = Math.max(rise, roofRiseAt(t.roof, t.L, t.D, (t.L * i) / 8, (t.D * j) / 8));
  const top = t.wallTop + Math.max(rise, 0) + (t.roof.type === 'flat' ? 140 : 0);
  return Math.max(top, t.wallTop + t.parapetMm);
}
