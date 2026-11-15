// The functions that run the commercial assistant tools. Each one is a pure edit on the project it is handed: the app calls them through
// store.runBatch (one undo step for the whole reply), so nothing here touches the store, the DOM or the network. Importing this file
// attaches the functions to the registry in commercial-schemas.js, which the Worker uses for the tool list only.

import { lotOf } from '../../model/placement.js';
import { isCommercial, DOOR_PRESETS, FRONT_WINDOWS } from '../../commercial/schema.js';
import { applyFinishes, CLADDING, DOORS, claddingById, doorById } from '../../commercial/finishes.js';
import { chooseLayout, BEST_ID } from '../../commercial/layouts.js';
import { COMMERCIAL_OPS, FEASIBILITY_KEYS, LAYOUT_IDS, GOALS } from './commercial-schemas.js';
import { typeById, resolveParams, commercialTypes } from './commercial-catalogue.js';
import {
  fail, measure, autoPlace, newBuildingId, regen, applyScheme, searchSchemes, pickBest, compareOptions, wantedBuildings,
} from './commercial-core.js';
import { explainChecks, draftBrief } from './commercial-brief.js';
import { money, pct1 } from '../../commercial/feasibility.js';

const need = (p) => {
  if (!isCommercial(p)) fail('This design is not in commercial mode.');
  return p.commercial;
};
const num = (v, name, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${name} must be a number.`);
  if (n < lo || n > hi) fail(`${name} must be between ${lo} and ${hi}.`);
  return n;
};
const m2 = (v) => `${Math.round(v).toLocaleString('en-AU')} m²`;

/** One sentence for the notes under the reply: what the lot holds now. */
export function summaryLine(p) {
  const ms = measure(p);
  const parts = [`${ms.units} unit${ms.units === 1 ? '' : 's'}`];
  if (ms.buildings.length) parts.push(`${ms.buildings.length} building${ms.buildings.length === 1 ? '' : 's'}`);
  parts.push(`${m2(ms.gfaM2)} GFA`);
  if (ms.coveragePct != null) parts.push(`${ms.coveragePct}% coverage`);
  parts.push(`${ms.parking.provided} of ${ms.parking.required} bays`);
  const line = `Now ${parts.join(', ')}.`;
  return ms.issues.length ? `${line} Check: ${ms.issues[0]}.` : line;
}

const findBuilding = (c, id) => {
  const b = (c.buildings || []).find((x) => x.id === id);
  if (!b) fail(`No building with id ${id}. Buildings on the lot: ${(c.buildings || []).map((x) => x.id).join(', ') || 'none'}.`);
  return b;
};
const typeOrFail = (id) => {
  const t = typeById(id);
  if (!t) fail(commercialTypes().length ? `There is no building type ${id}. Types available: ${commercialTypes().map((x) => x.id).join(', ')}.` : 'Building types are not available in this version, so only strata units can be planned.');
  return t;
};
const placeArg = (a, base = {}) => {
  const pl = a && typeof a === 'object' ? a : {};
  const out = { x: base.x ?? 0, y: base.y ?? 0, rotationDeg: base.rotationDeg ?? 0 };
  if (pl.x != null) out.x = Math.round(num(pl.x, 'x', -1e7, 1e7));
  if (pl.y != null) out.y = Math.round(num(pl.y, 'y', -1e7, 1e7));
  if (pl.rotationDeg != null) out.rotationDeg = num(pl.rotationDeg, 'rotationDeg', -720, 720);
  return out;
};

// The options of the most recent comparison, so the table can apply one. Replaced by every comparison.
let last = [];

const RUN = {
  set_layout(p, a) {
    const c = need(p);
    const id = a.layout === 'best_fit' ? BEST_ID : a.layout;
    if (!LAYOUT_IDS.includes(id)) fail(`layout must be one of: ${LAYOUT_IDS.join(', ')}`);
    const choice = chooseLayout(p, id);
    if (!choice) fail('A lot with its street frontage set is needed before a layout can be placed.');
    const keepBuildings = c.buildings || [];
    applyScheme(p, { rows: choice.rows, extra: choice.extra || [], buildings: keepBuildings, layout: { id: choice.id, label: choice.label }, label: choice.label, envKey: choice.envKey });
    p.commercial.layout.tooBig = !!choice.tooBig;
    return { changed: true, report: `${choice.tooBig ? `${choice.label} is too big for this block, placed centred and flagged. ` : ''}${summaryLine(p)}` };
  },

  add_building(p, a) {
    const c = need(p);
    const t = typeOrFail(String(a.type));
    const r = resolveParams(t, a.params || {}, null, lotOf(p));
    if (!r.ok) fail(r.error);
    const hasPlace = a.place && typeof a.place === 'object' && (a.place.x != null || a.place.y != null);
    let place;
    if (hasPlace) place = placeArg(a.place);
    else {
      place = autoPlace(p, t, r.params);
      if (!place) fail(`There is no room for ${t.label} inside the setbacks that keeps its apron clear of the units and bays. Try a smaller size, or use run_best_fit with mustInclude to rearrange the units around it.`);
    }
    const b = { id: newBuildingId(c.buildings), type: t.id, params: r.params, place };
    c.buildings = [...(c.buildings || []), b];
    regen(p);
    return { changed: true, id: b.id, report: `${t.label} added as ${b.id}. ${summaryLine(p)}` };
  },

  update_building(p, a) {
    const c = need(p);
    const b = findBuilding(c, a.id);
    const t = typeOrFail(b.type);
    const r = resolveParams(t, a.params || {}, b.params, lotOf(p));
    if (!r.ok) fail(r.error);
    b.params = r.params;
    regen(p);
    return { changed: true, report: `${t.label} updated. ${summaryLine(p)}` };
  },

  move_building(p, a) {
    const c = need(p);
    const b = findBuilding(c, a.id);
    b.place = placeArg(a.place, b.place);
    regen(p);
    return { changed: true, report: summaryLine(p) };
  },

  remove_building(p, a) {
    const c = need(p);
    findBuilding(c, a.id);
    c.buildings = c.buildings.filter((x) => x.id !== a.id);
    regen(p);
    return { changed: true, report: `Removed. ${summaryLine(p)}` };
  },

  set_unit_options(p, a) {
    const c = need(p);
    const o = a.options && typeof a.options === 'object' ? a.options : {};
    const rows = a.target === 'all' ? c.rows : c.rows.filter((r) => r.id === a.target);
    if (!rows.length) fail(a.target === 'all' ? 'There are no unit rows on the lot.' : `No row with id ${a.target}. Rows: ${c.rows.map((r) => r.id).join(', ') || 'none'}.`);
    const done = [];
    for (const row of rows) {
      const u = row.unit;
      if (o.widthMm != null) u.widthMm = num(o.widthMm, 'widthMm', 2500, 30000);
      if (o.depthMm != null) u.depthMm = num(o.depthMm, 'depthMm', 4000, 80000);
      if (o.heightMm != null) u.heightMm = num(o.heightMm, 'heightMm', 3000, 15000);
      if (o.doors != null) u.doors.count = Math.round(num(o.doors, 'doors', 1, 4));
      if (o.doorSize != null) {
        const d = DOOR_PRESETS.find((x) => x.id === o.doorSize);
        if (!d) fail(`doorSize must be one of: ${DOOR_PRESETS.map((x) => x.id).join(', ')}`);
        Object.assign(u.doors, { presetId: d.id, widthMm: d.w, heightMm: d.h });
      }
      if (o.mezzanine != null) { if (typeof o.mezzanine !== 'boolean') fail('mezzanine must be true or false.'); u.mezzanine.enabled = o.mezzanine; }
      if (o.office != null) { if (typeof o.office !== 'boolean') fail('office must be true or false.'); u.office.enabled = o.office; }
      if (o.windows != null) {
        if (!FRONT_WINDOWS.includes(o.windows)) fail(`windows must be one of: ${FRONT_WINDOWS.join(', ')}`);
        u.windows.front = o.windows;
      }
      row.perUnit = {}; // a change to the row replaces any single unit overrides, so the whole row reads the same
    }
    for (const k of Object.keys(o)) if (!['widthMm', 'depthMm', 'heightMm', 'doors', 'doorSize', 'mezzanine', 'office', 'windows'].includes(k)) fail(`Unknown unit option ${k}.`);
    done.push(`${rows.length} row${rows.length === 1 ? '' : 's'}`);
    regen(p);
    return { changed: true, report: `Unit options set on ${done[0]}. ${summaryLine(p)}` };
  },

  set_finishes(p, a) {
    need(p);
    if (a.cladding == null && a.doors == null) fail('Give a cladding, a door colour, or both.');
    if (a.cladding != null && !CLADDING.some((x) => x.id === a.cladding)) fail(`cladding must be one of: ${CLADDING.map((x) => x.id).join(', ')}`);
    if (a.doors != null && !DOORS.some((x) => x.id === a.doors)) fail(`doors must be one of: ${DOORS.map((x) => x.id).join(', ')}`);
    applyFinishes(p, { cladding: a.cladding, door: a.doors });
    const f = p.commercial.finishes;
    return { changed: true, report: `${claddingById(f.cladding).name} cladding, ${doorById(f.door).name} doors.` };
  },

  set_feasibility_inputs(p, a) {
    const c = need(p);
    const inputs = a.inputs && typeof a.inputs === 'object' ? a.inputs : {};
    c.feasibility ??= { area: null, v: {} };
    c.feasibility.v ??= {};
    for (const [k, v] of Object.entries(inputs)) {
      if (!FEASIBILITY_KEYS.includes(k)) fail(`Unknown feasibility input ${k}. Inputs: ${FEASIBILITY_KEYS.join(', ')}.`);
      if (v === null) { delete c.feasibility.v[k]; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) fail(`${k} must be zero or more.`);
      if (/Pct$/.test(k) && n > 100) fail(`${k} is a percentage, 0 to 100.`);
      c.feasibility.v[k] = n;
    }
    if (a.area != null) { c.feasibility.area = String(a.area) || null; }
    const ms = measure(p, { value: true });
    const v = ms.value;
    return { changed: true, report: v ? `Inputs set. Indicative gross realisation ${money(v.realisation)}, indicative cost ${money(v.cost)}, margin ${pct1(v.marginPct)} on cost. Indicative only, ex GST.` : 'Inputs set.' };
  },

  run_best_fit(p, a) {
    need(p);
    if (!GOALS.includes(a.goal)) fail(`goal must be one of: ${GOALS.join(', ')}`);
    const constraints = a.constraints && typeof a.constraints === 'object' ? a.constraints : {};
    wantedBuildings(constraints, lotOf(p)); // refuse unknown types before the search
    const pool = searchSchemes(p, constraints);
    const best = pickBest(pool, a.goal);
    if (!best) fail('No layout meets those limits inside the indicative setbacks and bay count. Relax one of them.');
    applyScheme(p, best.scheme);
    return { changed: true, report: `${best.scheme.label}. ${summaryLine(p)}` };
  },

  compare_options(p, a) {
    need(p);
    const opts = compareOptions(p, a.n);
    last = opts;
    const table = optionsTable(opts);
    return {
      changed: false,
      options: opts.map((o) => ({ id: o.id, label: o.label, scheme: o.scheme })),
      table,
      report: `${opts.length} options worked out. Choose one in the table to put it on the lot.`,
    };
  },

  apply_option(p, a) {
    need(p);
    const o = last.find((x) => x.id === a.optionId);
    if (!o) fail('That option is no longer available. Ask for the comparison again.');
    applyScheme(p, o.scheme);
    return { changed: true, report: summaryLine(p) };
  },

  explain_checks(p) {
    need(p);
    return { changed: false, report: explainChecks(p).report };
  },

  draft_brief(p) {
    need(p);
    const b = draftBrief(p);
    p.commercial.brief = { date: b.date, text: b.text, sections: b.sections };
    return { changed: true, brief: b, report: 'Development brief written and kept with the plan set.' };
  },
};

/** The comparison table: columns and rows of display strings. */
export function optionsTable(opts) {
  const columns = ['Option', 'GFA', 'Units', 'Coverage', 'Parking', 'Indicative value', 'Indicative margin'];
  const rows = opts.map((o) => {
    const v = o.m.value;
    return {
      id: o.id,
      cells: [
        `${o.id}. ${o.label}`,
        m2(o.m.gfaM2),
        String(o.m.units + (o.m.buildings.length ? ` + ${o.m.buildings.length} bldg` : '')),
        o.m.coveragePct != null ? `${o.m.coveragePct}%` : 'n/a',
        `${o.m.parking.provided} of ${o.m.parking.required}`,
        v ? money(v.realisation) : 'n/a',
        v ? `${money(v.margin)} (${pct1(v.marginPct)})` : 'n/a',
      ],
    };
  });
  return { columns, rows, note: 'Indicative only, ex GST, not a valuation. Check with council.' };
}

for (const [name, fn] of Object.entries(RUN)) {
  if (!COMMERCIAL_OPS[name]) throw new Error(`commercial-ops: no schema for ${name}`);
  COMMERCIAL_OPS[name].run = fn;
}

/** Options from the most recent compare_options. */
export const lastOptions = () => last;
