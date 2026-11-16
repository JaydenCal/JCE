// Ready-made strata unit estates and the auto fit for the commercial lot card. A layout is an estate (estate.js): rows of units AND the one
// connected sealed pavement network that serves them (crossover from the street, entry drive, car park, main driveway, door aprons,
// footpaths, turning heads), laid out together in the lot frame so nothing is left unconnected. Families: a single row with the drive
// beside it, two rows facing a central driveway, back to back rows with a loop road (separate entry and exit), a U around a court, and a
// single row of large units. The block stands near the frontage; on a huge lot the rest is balance land. Pure: no DOM, no three.
//
//   chooseLayout(project, id)      -> { id, label, rows, extra, estate, fits, parkingOk, tooBig, gfa, units, ... }  ('best' searches every family and size)
//   applyLayout(store, choice)     one undo step: rows, estate, layout record, model
//   currentLayoutIndex / stepLayout / layoutPagerText   switcher helpers

import * as G from '../model/geometry.js';
import { lotOf } from '../model/placement.js';
import { normaliseCommercial, isCommercial } from './schema.js';
import { parkingLayout } from './parking.js';
import { commercialStats } from './stats.js';
import { materialise } from './materialise.js';
import { setbackStatusLine } from '../site/lot-checks.js';
import { describe, placeEstate, realise, balanceOf, SPECS, MAX_UNITS, rowsSignature, frameOf, yardPoly, fitsAt } from './estate.js';

export { rowsSignature, MAX_UNITS };
export const BEST_ID = 'best';
export const TOO_BIG_LAYOUT = 'Too big for this block';

const ROUND_DEG = 1000;
const COVER_CAP = 45;
const BF_WIDTHS = [6000, 7500, 9000];
const BF_DEPTHS = [12000, 15000, 18000, 20000];
const BF_FAMILIES = ['double', 'u', 'b2b', 'single'];

/** The ready-made layouts the switcher steps through, after Best fit. `n` is the units in each row. */
export const TEMPLATES = Object.freeze([
  { id: 'row-6', label: 'Single row, 6 units', family: 'single', size: 'std', count: 6 },
  { id: 'row-10', label: 'Single row, 10 units', family: 'single', size: 'std', count: 10 },
  { id: 'b2b-12', label: 'Back to back with loop road, 12 units', family: 'b2b', size: 'std', count: 6 },
  { id: 'court-20', label: 'Two rows facing a central driveway, 20 units', family: 'double', size: 'std', count: 10 },
  { id: 'u-court', label: 'U shape around a court, 17 units', family: 'u', size: 'std', count: 4 },
  { id: 'large-6', label: 'Large units, 6 x 300 m²', family: 'large', size: 'large', count: 6 },
]);
export const LAYOUT_LIST = Object.freeze([{ id: BEST_ID, label: 'Best fit' }, ...TEMPLATES]);
export const layoutById = (id) => LAYOUT_LIST.find((l) => l.id === id) || null;

/** The name of a layout built from a family, size and count (Best fit may land on a count no template has). `units` is the total. */
export function labelFor(family, size, count, units = null) {
  if (size === 'large') return `Large units, ${count} x 300 m²`;
  if (family === 'b2b') return `Back to back with loop road, ${count * 2} units`;
  if (family === 'double') return `Two rows facing a central driveway, ${count * 2} units`;
  if (family === 'u') return `U shape around a court, ${units ?? count * 2} units`;
  if (family === 'wide') return `Row across the frontage, ${count} unit${count === 1 ? '' : 's'}`;
  return `Single row, ${count} unit${count === 1 ? '' : 's'}`;
}

// Switcher ------------------------------------------------------------------------------------------------------------------
/** Index in LAYOUT_LIST of the layout the project was set to (-1 when it has none). */
export function currentLayoutIndex(project) {
  const id = project?.commercial?.layout?.id;
  return LAYOUT_LIST.findIndex((l) => l.id === id);
}
export const stepLayout = (i, dir, n = LAYOUT_LIST.length) => (i < 0 ? (dir > 0 ? 0 : n - 1) : (((i + dir) % n) + n) % n);
/** { name, n, of } for the pager: the name of the layout in place (Best fit shows what it chose), and "1 / 7". */
export function layoutPagerText(project) {
  const c = project?.commercial;
  const i = currentLayoutIndex(project);
  const name = c?.layout?.label || (i >= 0 ? LAYOUT_LIST[i].label : 'Layout');
  return { name, n: i < 0 ? null : i + 1, of: LAYOUT_LIST.length };
}

/** The turn (degrees) that puts the unit fronts toward the street frontage and the rows parallel to it, as firstRow does. */
export function naturalAngle(lot) {
  const n = lot.boundary.length;
  const e0 = (lot.frontEdges || [])[0] ?? 0;
  const a = lot.boundary[e0];
  const b = lot.boundary[(e0 + 1) % n];
  const el = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const e = { x: (b.x - a.x) / el, y: (b.y - a.y) / el };
  let nrm = { x: -e.y, y: e.x };
  const cx = lot.boundary.reduce((s, q) => s + q.x, 0) / n;
  const cy = lot.boundary.reduce((s, q) => s + q.y, 0) / n;
  if ((cx - a.x) * nrm.x + (cy - a.y) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y };
  const u = { x: -nrm.y, y: nrm.x };
  return Math.round(((Math.atan2(u.y, u.x) * 180) / Math.PI) * ROUND_DEG) / ROUND_DEG;
}

// Search --------------------------------------------------------------------------------------------------------------------------------
const nMaxFor = (family, w, d) => {
  if (family === 'single' || family === 'large' || family === 'wide') return Math.min(20, MAX_UNITS);
  if (family === 'u') return Math.max(1, Math.floor((MAX_UNITS - Math.ceil(18000 / w)) / 2));
  return MAX_UNITS / 2;
};

const verifier = (project) => {
  const t = structuredClone(project); // one working copy: each candidate sets the rows, then the generated model is rebuilt over it
  return (rows, extra) => {
    try {
      t.commercial.rows = rows;
      t.commercial.estate = null;
      t.commercial.parking = { ...t.commercial.parking, extra };
      t.commercial = normaliseCommercial(t.commercial);
      materialise(t, { site: false });
      return setbackStatusLine(t).state !== 'outside';
    } catch { return true; }
  };
};

/** One estate at fixed family, unit size, count and car park depth: the rows, the network and the parking figures, or null when it does not fit. */
function evaluate(project, lot, family, w, d, n, nb) {
  const base = project.commercial;
  const spec = family === 'large' ? SPECS.large() : SPECS.std(w, d);
  const pl = placeEstate(lot, { family, w: spec.w, d: spec.d, n, nb }, base.accessEdit);
  if (!pl) return null;
  const real = realise(pl.E, pl.sc, pl.f, spec, lot);
  const cc = normaliseCommercial({ ...base, rows: real.rows, waste: null, hydrant: null, estate: null, parking: { ...base.parking, extra: real.extra } });
  const st = commercialStats({ commercial: cc, site: project.site });
  const pk = parkingLayout(cc);
  const accOk = pk.accessible.provided >= pk.accessible.required;
  return { family, w: spec.w, d: spec.d, n, nb, pl, real, cc, st, parkingOk: st.parking.provided >= st.parking.required && accOk, units: pl.E.unitCount, gfa: st.gfaM2 };
}

/** The first (largest) count of the family at this unit size that fits and parks. `fixed` pins the count (a template). */
function search(project, lot, family, w, d, { fixed = null, verify = null } = {}) {
  let fallback = null;
  const top = fixed ?? nMaxFor(family, w, d);
  for (let n = top; n >= (fixed ?? 1); n--) {
    let seen = null;
    for (let nb = 0; nb <= 3; nb++) {
      const c = evaluate(project, lot, family, w, d, n, nb);
      if (!c) continue;
      if (c.units > MAX_UNITS) break;
      seen = c;
      if (c.parkingOk && (!verify || verify(c.real.rows, c.real.extra))) return { cand: c, ok: true };
      if (!fallback || c.st.parking.provided - c.st.parking.required > fallback.st.parking.provided - fallback.st.parking.required) fallback = fixed != null ? c : fallback;
    }
    void seen;
    if (fixed != null && fallback) return { cand: fallback, ok: false };
  }
  return fallback ? { cand: fallback, ok: false } : null;
}

const labelOf = (c, id) => (id === BEST_ID ? labelBest(c) : labelFor(c.family === 'large' ? 'single' : c.family, c.family === 'large' ? 'large' : 'std', c.n, c.units));
function labelBest(c) {
  const k = c.family === 'single' || c.family === 'large' ? 1 : c.family === 'u' ? 3 : 2;
  const what = { single: 'Single row', large: 'Single row', wide: 'Row across the frontage', double: 'Two rows facing a central driveway', b2b: 'Back to back with loop road', u: 'U shape around a court' }[c.family];
  void k;
  return `${what}, ${c.units} units`;
}

function result(c, id, fits, lot, project) {
  const f = c.pl.f;
  const window = c.real.network.window;
  const bal = balanceOf(window, f, lot);
  const sig = rowsSignature(c.real.rows);
  const estate = {
    v: 1, family: c.family, sig, aisleMm: c.pl.E.aisleMm, network: { ...c.real.network, window }, balance: bal.polygons.length ? bal : null,
    units: c.units,
  };
  void project;
  return {
    id, label: labelOf(c, id), family: c.family === 'large' ? 'single' : c.family, size: c.family === 'large' ? 'large' : 'std', count: c.n, rows: c.real.rows, extra: c.real.extra, estate,
    fits, tooBig: !fits, parkingOk: c.parkingOk, parkingShort: Math.max(0, c.st.parking.required - c.st.parking.provided), gfa: c.gfa, units: c.units,
    coveragePct: c.st.coveragePct, parking: { provided: c.st.parking.provided, required: c.st.parking.required }, deg: 0,
  };
}

const envKeyOf = (lot) => JSON.stringify((lot.envelope || []).map((q) => [Math.round(q.x / 10), Math.round(q.y / 10)]));

/** Where a block that does not fit stands: the smallest single row on the spine at the middle of the frontage, so the card can show it red. */
function fallbackChoice(project, lot, id) {
  const base = project.commercial;
  const spec = SPECS.std(6000, 15000);
  const f = frameOf(lot);
  const E = describe({ family: 'single', w: spec.w, d: spec.d, n: 2, nb: 0 });
  const fp = lot.boundary.map((q) => ({ s: (q.x - f.o.x) * f.u.x + (q.y - f.o.y) * f.u.y }));
  const sc = (Math.min(...fp.map((q) => q.s)) + Math.max(...fp.map((q) => q.s))) / 2;
  const real = realise(E, sc, f, spec, lot);
  const cc = normaliseCommercial({ ...base, rows: real.rows, waste: null, hydrant: null, estate: null, parking: { ...base.parking, extra: real.extra } });
  const st = commercialStats({ commercial: cc, site: project.site });
  const c = { family: 'single', w: spec.w, d: spec.d, n: 2, nb: 0, pl: { E, sc, f }, real, cc, st, parkingOk: false, units: 2, gfa: st.gfaM2 };
  return result(c, id, false, lot, project);
}

/**
 * The layout to put on the lot: `id` is 'best' (the most floor area that stands inside the setbacks, parks at the indicative rate, keeps
 * the coverage near 45 percent and is capped at 40 units, over every family and unit size) or a template id. When nothing fits the
 * layout is placed at the middle of the frontage and flagged tooBig, so the card reads "Too big for this block". Returns null when there
 * is no lot or no commercial spec.
 */
export function chooseLayout(project, id = BEST_ID) {
  const lot = lotOf(project);
  if (!lot || !isCommercial(project) || !Array.isArray(lot.boundary) || lot.boundary.length < 3 || !(lot.frontEdges || []).length) return null;
  const stamp = { envKey: envKeyOf(lot) };
  const verify = verifier(project);
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (tpl) {
    const r = search(project, lot, tpl.family, 6000, tpl.family === 'large' ? 30000 : 18000, { fixed: tpl.count, verify });
    if (!r) return { ...fallbackChoice(project, lot, tpl.id), label: tpl.label, ...stamp };
    const out = result(r.cand, tpl.id, true, lot, project);
    return { ...out, label: tpl.family === 'u' ? out.label : tpl.label.replace(/\d+ units/, `${r.cand.units} units`), parkingOk: r.ok, ...stamp };
  }
  const lotM2 = Math.abs(G.polygonArea(lot.boundary)) / 1e6 || lot.areaM2 || 1;
  const found = [];
  const t0 = Date.now();
  for (const family of BF_FAMILIES) {
    for (const d of BF_DEPTHS) for (const w of BF_WIDTHS) {
      if (Date.now() - t0 > 9000) break;
      const r = search(project, lot, family, w, d, { verify });
      if (r?.ok) found.push(r.cand);
    }
  }
  // Nothing stood beside a drive (a narrow lot): try the row across the frontage before saying the block is too small.
  if (!found.length) {
    for (const d of BF_DEPTHS) for (const w of BF_WIDTHS) {
      if (Date.now() - t0 > 9000) break;
      const r = search(project, lot, 'wide', w, d, { verify });
      if (r?.ok) found.push(r.cand);
    }
  }
  if (!found.length) return { ...fallbackChoice(project, lot, BEST_ID), ...stamp };
  const cover = (c) => (c.units * c.w * c.d) / 1e6 / lotM2 * 100;
  found.sort((a, b) => (cover(a) <= COVER_CAP ? 0 : 1) - (cover(b) <= COVER_CAP ? 0 : 1) || b.gfa - a.gfa || BF_FAMILIES.indexOf(a.family) - BF_FAMILIES.indexOf(b.family));
  return { ...result(found[0], BEST_ID, true, lot, project), ...stamp };
}

/**
 * Put the chosen layout on the project as one undo step. The rows replace the old ones; parking, rates, finishes and every other
 * setting stay. The choice is remembered (c.layout) so the card can say which layout it is and refit when the council setbacks arrive.
 */
export function applyLayout(store, choice) {
  if (!choice) return false;
  store.apply('Change layout', (p) => {
    if (!isCommercial(p)) throw new Error('This design is not in commercial mode.');
    const lot = lotOf(p);
    p.commercial.rows = choice.rows;
    p.commercial.estate = choice.estate || null;
    p.commercial.buildings = []; // a strata layout replaces any catalogue building the card put on the lot
    p.commercial.parking = { ...p.commercial.parking, extra: choice.extra || [] };
    p.commercial.layout = { id: choice.id, label: choice.label, tooBig: !!choice.tooBig, envKey: lot ? envKeyOf(lot) : null, sig: rowsSignature(choice.rows) };
    p.commercial = normaliseCommercial(p.commercial);
    materialise(p);
    p.name = choice.label;
  });
  return true;
}

/** True when the rows are still the ones the layout choice put there (nothing was moved or edited since). */
export function layoutUntouched(project) {
  const l = project?.commercial?.layout;
  return !!l && !l.typeId && l.sig === rowsSignature(project.commercial.rows);
}

/** True when the council setbacks have changed since the layout was placed, so the choice should be made again. */
export function setbacksMoved(project) {
  const lot = lotOf(project);
  const l = project?.commercial?.layout;
  return !!(lot && l && l.envKey !== envKeyOf(lot));
}
