// Project glue for the finance model: where the edits and the saved scenarios live, computing a result for the working values or for a
// saved scenario, and the edit functions the UI calls inside store.apply. No DOM.
//   commercial: project.commercial.feasibility { area, v } (shared with the earlier panel) and project.commercial.finance { v, scenarios }
//   residential: project.finance { area, v, scenarios }
import { analyse, run, sanityNotes, INDICATIVE } from './engine.js';
import { commercialModel, residentialModel } from './adapters.js';
import { isCommercial } from '../commercial/mode.js';

export const MAX_SCENARIOS = 3;
export const CHECK_WITH = 'Check with a quantity surveyor, valuer and your accountant.';
export const DISCLAIMER = `Indicative figures, not a valuation, not advice. ${CHECK_WITH}`;

export const kindOf = (project) => (isCommercial(project) ? 'commercial' : 'residential');

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));

/** The working state: { area, fz, fin, scenarios }. Never null. */
export function readState(project) {
  if (isCommercial(project)) {
    const c = project.commercial || {};
    return { area: c.feasibility?.area ?? null, fz: c.feasibility?.v || {}, fin: c.finance?.v || {}, scenarios: c.finance?.scenarios || [] };
  }
  const f = project.finance || {};
  return { area: f.area ?? null, fz: {}, fin: f.v || {}, scenarios: f.scenarios || [] };
}

/** Builds the model (engine input and assumptions) for the project, with the working values or the given overrides { fz, fin, area }. */
export function buildModel(project, ov) {
  const st = ov || readState(project);
  const o = { fz: st.fz, fin: st.fin, area: st.area ?? null };
  const m = isCommercial(project) ? commercialModel(project, { ...o, area: o.area || undefined }) : residentialModel(project, o);
  return m;
}

/** The full result for the working values or for a scenario snapshot. */
export function compute(project, ov) {
  const m = buildModel(project, ov);
  const result = m.input.revenue.length ? analyse(m.input) : null;
  const sanity = result ? sanityNotes(result) : [];
  return { model: m, result, sanity, notes: [...m.notes, ...sanity] };
}

// Edits (call inside store.apply with the draft project) ---------------------------------------------------------------------------
function ensure(draft) {
  if (isCommercial(draft)) {
    const c = draft.commercial;
    c.feasibility ??= { area: null, v: {} };
    c.feasibility.v ??= {};
    c.finance ??= { v: {}, scenarios: [] };
    c.finance.v ??= {};
    c.finance.scenarios ??= [];
    return { fz: c.feasibility, fin: c.finance };
  }
  draft.finance ??= { area: null, v: {}, scenarios: [] };
  draft.finance.v ??= {};
  draft.finance.scenarios ??= [];
  return { fz: null, fin: draft.finance };
}

/** Sets one assumption (value null or '' clears it back to its default). d is the descriptor (it names the store). */
export function setValue(draft, d, value) {
  const { fz, fin } = ensure(draft);
  const bag = d.store === 'fz' ? fz.v : fin.v;
  const clear = value === null || value === '' || value === undefined || (d.kind === 'number' && !Number.isFinite(Number(value))) || (d.key === 'landPrice' && Number(value) <= 0);
  if (clear) { delete bag[d.key]; return; }
  bag[d.key] = d.kind === 'select' ? String(value) : Math.max(0, Math.min(d.max ?? Infinity, Number(value)));
}
export function resetAll(draft) {
  const { fz, fin } = ensure(draft);
  if (fz) fz.v = {};
  fin.v = {};
}
export function setArea(draft, key) {
  const { fz, fin } = ensure(draft);
  const holder = fz || fin;
  holder.area = key || null;
  if (fz) fz.v = {};
  fin.v = {};
}

// Scenarios -----------------------------------------------------------------------------------------------------------------------
const sid = () => `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
/** A snapshot of the working values. */
export const snapshot = (project) => { const s = readState(project); return clone({ area: s.area, fz: s.fz, fin: s.fin }); };

/** Saves the working values under a name. The same name replaces; at most 3 are kept, so a fourth name is refused (returns false). */
export function saveScenario(draft, name) {
  const { fin } = ensure(draft);
  const nm = String(name || '').trim().slice(0, 24) || `Scenario ${fin.scenarios.length + 1}`;
  const snap = snapshot(draft);
  const at = fin.scenarios.findIndex((s) => s.name.toLowerCase() === nm.toLowerCase());
  if (at >= 0) { fin.scenarios[at] = { ...fin.scenarios[at], ...snap, name: fin.scenarios[at].name }; return true; }
  if (fin.scenarios.length >= MAX_SCENARIOS) return false;
  fin.scenarios.push({ id: sid(), name: nm, ...snap });
  return true;
}
export function deleteScenario(draft, id) {
  const { fin } = ensure(draft);
  fin.scenarios = fin.scenarios.filter((s) => s.id !== id);
}
/** Makes a saved scenario the working values. */
export function loadScenario(draft, id) {
  const { fz, fin } = ensure(draft);
  const s = fin.scenarios.find((x) => x.id === id);
  if (!s) return false;
  const holder = fz || fin;
  holder.area = s.area ?? null;
  if (fz) fz.v = clone(s.fz);
  fin.v = clone(s.fin);
  return true;
}

/** The working values and each saved scenario side by side: [{ id, name, result }]. */
export function compareScenarios(project) {
  const cols = [{ id: 'current', name: 'Current', ...compute(project) }];
  for (const s of readState(project).scenarios) cols.push({ id: s.id, name: s.name, ...compute(project, { area: s.area ?? null, fz: s.fz || {}, fin: s.fin || {} }) });
  return cols;
}

export const COMPARE_ROWS = Object.freeze([
  ['mode', 'Exit', (r) => (r.mode === 'hold' ? 'Hold' : 'Sell'), 'text'],
  ['revenue', 'Gross value (GDV)', (r) => r.revenue, 'money'],
  ['totalCost', 'Total cost', (r) => r.totalCost, 'money'],
  ['profit', 'Profit', (r) => r.profit, 'money'],
  ['marginOnCostPct', 'Margin on cost', (r) => r.marginOnCostPct, 'pct'],
  ['marginOnGdvPct', 'Margin on GDV', (r) => r.marginOnGdvPct, 'pct'],
  ['yieldOnCostPct', 'Yield on cost', (r) => r.yieldOnCostPct, 'pct'],
  ['residual', 'Residual land value', (r) => r.residual.value, 'money'],
  ['peakDebt', 'Peak debt', (r) => r.peakDebt, 'money'],
  ['peakEquity', 'Equity needed', (r) => r.peakEquity, 'money'],
]);

export { run, analyse, INDICATIVE };
