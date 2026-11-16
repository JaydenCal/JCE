#!/usr/bin/env node
// Development type matrix: places every catalogue building type on a set of test lots (pure node, no browser) with chooseBuilding and
// applyBuildingChoice, then records fit, setback status, site coverage, parking provided against required, whether the generated site layout
// reached every door, layout geometry outside the lot, and any warning or thrown error. Writes docs/DEV_TYPE_MATRIX.md and prints failures.
//
//   node tools/dev-type-matrix.mjs [--types garage-single,duplex] [--lots large,corner] [--out docs/DEV_TYPE_MATRIX.md] [--shaw /tmp/gi-rig/lot.json]
//
// Exit code 1 when any combination FAILs (a throw, an unreachable door, a layout outside the lot, a crossed boundary or a setback breach).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/model/store.js';
import { conadillyProject } from '../tests/helpers/conadilly-lot.mjs';
import { convertToCommercial } from '../src/commercial/mode.js';
import { materialise } from '../src/commercial/materialise.js';
import { normaliseCommercial } from '../src/commercial/schema.js';
import { buildSiteLot } from '../src/site/model.js';
import { migrate, createProject } from '../src/model/schema.js';
import { TYPES, STRATA_ID } from '../src/commercial/catalogue/types/index.js';
import { chooseBuilding } from '../src/commercial/catalogue/fit.js';
import { applyBuildingChoice } from '../src/commercial/catalogue/ops.js';
import { buildingsOf, presetsOf, newBuilding } from '../src/commercial/catalogue/buildings.js';
import { commercialStats } from '../src/commercial/stats.js';
import { commercialChecks } from '../src/commercial/checks.js';
import { lotChecks } from '../src/site/lot-checks.js';
import { lotOf } from '../src/model/placement.js';
import * as G from '../src/model/geometry.js';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const only = (k) => (opt(k) ? new Set(opt(k).split(',')) : null);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = opt('out', `${ROOT}docs/DEV_TYPE_MATRIX.md`);
const SHAW = opt('shaw', '/tmp/gi-rig/lot.json');

const IND = { front: 10, secondaryFront: 5, side: 3, rear: 3 };
const SMALL = { front: 6, secondaryFront: 3, side: 1.5, rear: 3 };

function conProject({ width, depth, corner = false, setbacks }) {
  const sb = { ...setbacks, edgeKinds: ['front', corner ? 'secondaryFront' : 'side', 'rear', 'side'] };
  if (!corner) sb.secondaryFront = null;
  const p = conadillyProject({ corner, width, depth, setbacks: sb });
  p.site.lot.zoning = { code: 'IN1', name: 'General Industrial' };
  p.site.lot.lga = 'TAMWORTH REGIONAL';
  p.site.lot.state = 'NSW';
  convertToCommercial(p, { useClass: 'industrial' });
  p.commercial.rows = [];
  p.commercial = normaliseCommercial(p.commercial);
  materialise(p);
  return p;
}

function shawProject() {
  if (!fs.existsSync(SHAW)) return null;
  const raw = JSON.parse(fs.readFileSync(SHAW, 'utf8'));
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  const lot = buildSiteLot({ lot: raw, address: '369 Shaw Road', source: 'api' });
  lot.setbacks = { ...IND, secondaryFront: null, edgeKinds: lot.boundary.map((_, i) => ((lot.frontEdges || []).includes(i) ? 'front' : 'side')) };
  lot.envelope = null;
  lot.zoning = { code: 'IN1', name: 'General Industrial' };
  p.site.lot = lot;
  convertToCommercial(p, { useClass: 'industrial' });
  p.commercial.rows = [];
  p.commercial = normaliseCommercial(p.commercial);
  materialise(p);
  return p;
}

export const LOTS = [
  { id: 'large', label: 'Large lot, one frontage (120 x 140 m)', make: () => conProject({ width: 120000, depth: 140000, setbacks: IND }) },
  { id: 'corner', label: 'Corner lot (90 x 100 m)', make: () => conProject({ width: 90000, depth: 100000, corner: true, setbacks: IND }) },
  { id: 'narrow12', label: 'Narrow 12 m frontage (12 x 60 m)', make: () => conProject({ width: 12000, depth: 60000, setbacks: SMALL }) },
  { id: 'small600', label: 'Small 600 m2 (20 x 30 m)', make: () => conProject({ width: 20000, depth: 30000, setbacks: SMALL }) },
  { id: 'huge14ha', label: 'Very large 14 ha (300 x 467 m)', make: () => conProject({ width: 300000, depth: 467000, setbacks: IND }) },
  { id: 'shaw', label: '369 Shaw Road (real lot, about 14.6 ha)', make: shawProject },
];

const inLot = (pt, lot, tol = 60) => G.pointInPolygon(pt, lot.boundary) || lot.boundary.some((a, i) => {
  const b = lot.boundary[(i + 1) % lot.boundary.length];
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy) <= tol;
});

/** Vertices of the generated site layout (and the buildings) that lie outside the lot boundary. */
function outsideLot(project) {
  const lot = lotOf(project);
  const sw = project.commercial.siteWorks;
  const bad = [];
  const check = (name, poly, tol = 60) => { if (Array.isArray(poly) && poly.some((q) => !inLot(q, lot, tol))) bad.push(name); };
  for (const b of buildingsOf(project.commercial)) { check(`building ${b.type}`, b.outline); for (const e of b.extras) if (e.kind !== 'awning' && e.kind !== 'lean-to') check(`${b.type} ${e.kind}`, e.polygon); }
  if (sw) {
    // entry aisles run out to the street through the verge by design (up to about 4 m past the boundary)
    for (const k of ['aisles', 'pavedAisles', 'aprons', 'footpaths', 'forecourts']) for (const x of sw[k] || []) check(`${k} ${x.id || ''}`, x.polygon, k === 'aisles' || k === 'pavedAisles' ? 4200 : 60);
    for (const r of sw.bayRows || []) for (const s of r.slots || []) check('bay', s.poly);
  }
  return [...new Set(bad)];
}

/** True when the outline of at least one preset (with 1 m to spare) is smaller than the setback envelope of the lot, front on to the street. */
function shouldFit(def, lot) {
  const pts = Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : lot.boundary;
  const xs = pts.map((q) => q.x); const ys = pts.map((q) => q.y);
  const ew = Math.max(...xs) - Math.min(...xs); const ed = Math.max(...ys) - Math.min(...ys);
  const lotM2 = (Math.max(...lot.boundary.map((q) => q.x)) - Math.min(...lot.boundary.map((q) => q.x))) * (Math.max(...lot.boundary.map((q) => q.y)) - Math.min(...lot.boundary.map((q) => q.y))) / 1e6;
  return presetsOf(def).some((pr) => {
    const b = buildingsOf({ buildings: [newBuilding(def.id, { presetId: pr.id })] })[0];
    if (!b) return false;
    const w = b.bbox.maxX - b.bbox.minX; const d = b.bbox.maxY - b.bbox.minY;
    const fits = w + 1000 <= ew && d + 1000 <= ed; // front on to the street; a building turned side-on cannot be reached
    return fits && b.groundM2 / lotM2 < 0.15;
  });
}

function run(def, lotDef) {
  const t0 = Date.now();
  const res = { type: def.id, lot: lotDef.id, status: 'PASS', fit: null, setbacks: '', coveragePct: null, parking: '', required: null, provided: null, unreachable: [], outside: [], warnings: [], error: null, preset: '', ms: 0 };
  try {
    const project = lotDef.make();
    if (!project) { res.status = 'SKIP'; res.error = 'lot file not found'; return res; }
    const store = createStore(project, { autosaveKey: null });
    const choice = chooseBuilding(store.project, def.id);
    if (!choice) throw new Error('chooseBuilding returned null');
    applyBuildingChoice(store, choice);
    const p = store.project;
    res.fit = !choice.tooBig;
    res.preset = choice.presetId;
    const lc = lotChecks(p);
    res.setbacks = lc.messages.length ? `breach: ${lc.messages.map((m) => m.kind).join('+')}` : lc.status;
    const st = commercialStats(p);
    res.coveragePct = st.coveragePct;
    res.required = st.parking.required;
    res.provided = st.parking.provided;
    res.parking = `${st.parking.provided} of ${st.parking.required}`;
    const sw = p.commercial.siteWorks;
    res.unreachable = (sw?.summary?.unreachable || []).map(String);
    res.warnings = [...(sw?.warnings || []), ...commercialChecks(p).filter((c) => c.kind === 'warn').map((c) => c.text)].map((s) => s.replace(/\s+/g, ' ').slice(0, 140));
    if (res.fit) {
      res.outside = outsideLot(p);
      if (lc.crossesBoundary || lc.messages.length) { res.status = 'FAIL'; }
      if (res.unreachable.length) res.status = 'FAIL';
      if (res.outside.length) res.status = 'FAIL';
      if (res.status === 'PASS' && (st.parking.provided < st.parking.required || res.warnings.length)) res.status = 'WARN';
    } else {
      // A type whose smallest preset sits inside the envelope with room to spare and takes under 15 percent of the lot should always fit.
      res.status = shouldFit(def, lotOf(p)) ? 'FAIL' : 'NOFIT';
      if (res.status === 'FAIL') res.error = 'does not fit although a preset is clearly smaller than the setback envelope';
    }
  } catch (e) {
    res.status = 'FAIL';
    res.error = String(e?.stack || e).split('\n').slice(0, 3).join(' | ');
  }
  res.ms = Date.now() - t0;
  return res;
}

const ICON = { PASS: 'pass', WARN: 'warn', FAIL: 'FAIL', NOFIT: 'no fit', SKIP: 'skip' };

export function toMarkdown(results, types, lots) {
  const by = new Map(results.map((r) => [`${r.type}|${r.lot}`, r]));
  const count = (s) => results.filter((r) => r.status === s).length;
  const lines = ['# Development type matrix', '',
    `Generated by \`node tools/dev-type-matrix.mjs\` (pure node, no browser). ${types.length} building types on ${lots.length} lots, ${results.length} combinations: **${count('PASS')} pass**, ${count('WARN')} warn, ${count('NOFIT')} no fit (too big for the lot), **${count('FAIL')} FAIL**, ${count('SKIP')} skipped.`, '',
    'Each type is placed with `chooseBuilding` (biggest preset that fits, else the smallest parked and marked too big) and `applyBuildingChoice`, then the automatic site layout is read back.', '',
    '- pass: fits, no setback breach, every door reached, layout inside the lot, parking provided meets the indicative requirement, no warnings',
    '- warn: fits and reached, but parking provided is below the requirement or the layout raised a warning (the car park is limited by space, not a defect)',
    '- no fit: even the smallest preset is too big for the lot (expected for large types on small lots)',
    '- FAIL: a thrown error, an unreachable door, a setback breach on a building that "fits", site layout outside the lot, or a small type that does not fit a lot it should',
    '', '## Lots', '', ...lots.map((l) => `- **${l.id}**: ${l.label}`), '', '## Grid', '', `| Type | ${lots.map((l) => l.id).join(' | ')} |`, `|---|${lots.map(() => '---').join('|')}|`];
  for (const t of types) lines.push(`| ${t.id} | ${lots.map((l) => ICON[by.get(`${t.id}|${l.id}`)?.status] || '-').join(' | ')} |`);
  lines.push('', '## Detail', '', '| Type | Lot | Result | Preset | Setbacks | Coverage % | Parking provided of required | Unreachable | Outside lot | Notes |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const notes = [r.error, ...r.warnings.slice(0, 2)].filter(Boolean).join('; ').replace(/\|/g, '/');
    lines.push(`| ${r.type} | ${r.lot} | ${ICON[r.status]} | ${r.preset || ''} | ${r.setbacks || ''} | ${r.coveragePct == null ? '' : Number(r.coveragePct).toFixed(1)} | ${r.parking} | ${r.unreachable.join(', ')} | ${r.outside.join(', ')} | ${notes} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const tf = only('types');
  const lf = only('lots');
  const types = TYPES.filter((t) => t.id !== STRATA_ID && (!tf || tf.has(t.id)));
  const lots = LOTS.filter((l) => !lf || lf.has(l.id));
  const results = [];
  for (const t of types) for (const l of lots) { const r = run(t, l); results.push(r); if (r.status === 'FAIL') console.log(`FAIL ${t.id} on ${l.id}: ${r.error || [r.setbacks, r.unreachable.length ? `unreachable ${r.unreachable}` : '', r.outside.length ? `outside ${r.outside}` : ''].filter(Boolean).join('; ')}`); }
  fs.mkdirSync(new URL('.', `file://${OUT}`).pathname, { recursive: true });
  fs.writeFileSync(OUT, toMarkdown(results, types, lots));
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${results.length} combinations: ${n('PASS')} pass, ${n('WARN')} warn, ${n('NOFIT')} no fit, ${n('FAIL')} FAIL, ${n('SKIP')} skip. Written ${OUT}`);
  process.exitCode = n('FAIL') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
