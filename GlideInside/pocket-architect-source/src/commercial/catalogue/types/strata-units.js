// 'strata-units': the existing strata workshop rows (src/commercial/layout.js, materialise.js) behind the catalogue interface. An adapter,
// no behaviour change: the rows code builds the walls, openings, rooms, mezzanine and stair exactly as it does for project.commercial.rows,
// and this module hands them to the framework. The lot card keeps using rows for this type (chooseLayout and the layout switcher).

import * as S from '../../../model/schema.js';
import { defaultRow, normaliseCommercial } from '../../schema.js';
import { layoutUnits, mezzanineOf, officeOf } from '../../layout.js';
import { materialise as materialiseRows, MEZZ_LEVEL_ID } from '../../materialise.js';
import { rect } from '../frame.js';
import { CONSTRUCTION_KEYS } from '../construction.js';

const num = (key, label, unit, min, max, step, def) => ({ key, label, type: 'number', unit, min, max, step, default: def });

const rowFor = (params, place = { x: 0, y: 0, rotationDeg: 0 }, origin = null) => {
  const row = defaultRow({ id: 'row_strata', count: params.count, x: origin?.x ?? 0, y: origin?.y ?? 0, rotationDeg: place.rotationDeg || 0 });
  row.unit.widthMm = params.widthMm;
  row.unit.depthMm = params.depthMm;
  row.unit.heightMm = params.heightMm;
  row.unit.office.enabled = !!params.office;
  row.unit.mezzanine.enabled = !!params.mezzanine;
  for (const k of CONSTRUCTION_KEYS) if (params[k] !== undefined) row.unit[k] = params[k];
  return row;
};
const scratchOf = (params, place, origin) => {
  const c = normaliseCommercial({ rows: [rowFor(params, place, origin)], parking: { enabled: false } });
  return { mode: 'commercial', commercial: c, levels: [S.createLevel({ name: 'Ground', elevation: 0, height: params.heightMm })] };
};

function qty(p) {
  const units = layoutUnits(scratchOf(p).commercial);
  let ground = 0;
  let mezz = 0;
  let office = 0;
  for (const u of units) {
    ground += (u.w * u.d) / 1e6;
    office += officeOf(u.spec).areaM2;
    const m = mezzanineOf(u.spec);
    if (m.enabled) { mezz += m.areaM2; if (m.use === 'office') office += m.areaM2; }
  }
  const W = p.count * p.widthMm;
  return {
    gfaM2: ground + mezz, groundM2: ground, upperM2: mezz, roofM2: (W * p.depthMm) / 1e6, wallM2: (2 * (W + p.depthMm) * p.heightMm) / 1e6,
    glazingM2: 0, doors: { roller: p.count, personnel: p.count, dock: 0 }, perUse: { 'strata units': ground + mezz - office, office },
  };
}

export default {
  id: 'strata-units',
  label: 'Strata units',
  category: 'industrial',
  zonesHint: ['E4', 'E5', 'IN1', 'IN2'],
  planLabel: 'PROPOSED UNIT',
  params: [
    num('count', 'Units in the row', '', 1, 20, 1, 6),
    num('widthMm', 'Unit width', 'mm', 2500, 30000, 100, 6000),
    num('depthMm', 'Unit depth', 'mm', 4000, 80000, 500, 18000),
    num('heightMm', 'Unit height', 'mm', 3000, 15000, 100, 6000),
    { key: 'office', label: 'Ground office/amenity', type: 'bool', default: true },
    { key: 'mezzanine', label: 'Mezzanine office', type: 'bool', default: true },
  ],
  defaults() { return { count: 6, widthMm: 6000, depthMm: 18000, heightMm: 6000, office: true, mezzanine: true }; },
  presets: [
    { id: 'row-6', label: 'Single row, 6 units', params: { count: 6 } },
    { id: 'row-10', label: 'Single row, 10 units', params: { count: 10 } },
    { id: 'large-6', label: 'Large units, 6 x 300 m²', params: { count: 6, widthMm: 10000, depthMm: 30000, heightMm: 8000, office: false, mezzanine: false } },
  ],
  footprint(p) {
    const W = p.count * p.widthMm;
    return { outline: rect(0, 0, W, p.depthMm), extras: [{ kind: 'apron', polygon: rect(0, -12000, W, 0), label: 'TRUCK APRON' }] };
  },
  materialise(p, place, ctx) {
    // The rows code works in a row frame whose fronts face +v; ours face -v, so the row is turned half a turn and its origin (rear left)
    // is the back right corner of the building as we draw it.
    const W = p.count * p.widthMm;
    const o = ctx.at(W, p.depthMm);
    const sc = scratchOf(p, { ...place, rotationDeg: (place.rotationDeg || 0) + 180 }, o);
    materialiseRows(sc);
    const g = sc.levels[0];
    const mz = sc.levels.find((l) => l.id === MEZZ_LEVEL_ID) || null;
    for (const w of g.walls) w.height = w.height ?? p.heightMm;
    return {
      walls: g.walls.map((w) => ({ ...w, level: 'Ground' })),
      openings: g.openings.map((x) => ({ ...x, level: 'Ground' })),
      rooms: [...g.rooms.map((r) => ({ ...r, level: 'Ground' })), ...(mz ? mz.rooms.map((r) => ({ ...r, level: 'Mezzanine' })) : [])],
      stairs: g.stairs.map((s) => ({ ...s, level: 'Ground' })),
      levels: mz ? [{ name: 'Mezzanine', elevationMm: mz.elevation, heightMm: mz.height }] : [],
      roofs: [{ polygon: rect(0, 0, W, p.depthMm).map((q) => ctx.at(q.x, q.y)), type: 'skillion', pitchDeg: 3, baseMm: p.heightMm, overhangMm: 300 }],
    };
  },
  quantities: qty,
  site(p) {
    const q = qty(p);
    return { parking: { ratePerM2: [{ use: 'strata units', per: 75, m2: q.gfaM2 }], accessible: true }, vehicles: { design: 'MRV', apronDepthMm: 12000, docks: 0 }, landscapeFrontMm: 3000, notes: ['Rows of strata units use the layout switcher on the lot card.'] };
  },
  costHints: { buildRateKey: 'strata-units', notes: 'Uses the strata workshop build rate of the feasibility panel.' },
  rows: true, // marks the type that the lot card and the editor keep on project.commercial.rows
};
