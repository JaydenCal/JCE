// The setback stage: once the person has confirmed the street frontage, work out the indicative setbacks and the buildable
// envelope for the lot and keep them current as the design changes. Results go on site.lot.setbacks and site.lot.envelope
// (docs/SITE_LOOKUP.md). They are derived data: they are written without an undo step and recomputed after undo or a design change.

import { siteLotSetbacks } from './setbacks.js';
import { loadRuleSet } from './setback-data.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v) => Math.round(v * 100) / 100;

// Bounding box of a level's walls, plan mm.
function wallBox(level) {
  const xs = [];
  const ys = [];
  for (const w of level.walls || []) xs.push(w.a.x, w.b.x), ys.push(w.a.y, w.b.y);
  if (!xs.length) return null;
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

/**
 * What the design says about itself: storeys, top of wall height and an estimated overall height (top of wall plus the roof rise).
 * Returns { storeys, wallHeightM, buildingHeightM, roofNote } or null when nothing is drawn yet.
 */
export function designHeights(project) {
  const levels = (project.levels || []).filter((l) => (l.walls || []).length);
  if (!levels.length) return null;
  const top = levels.reduce((a, b) => ((b.elevation || 0) > (a.elevation || 0) ? b : a));
  const wallMm = (top.elevation || 0) + (top.height || 2550);
  const box = wallBox(top);
  const roof = top.roof || {};
  let riseMm = 0;
  if (box && roof.enabled !== false && roof.type !== 'flat') {
    const span = Math.min(box.w, box.d);
    const tan = Math.tan(((num(roof.pitch) ?? 22.5) * Math.PI) / 180);
    riseMm = roof.type === 'skillion' ? span * tan : (span / 2) * tan;
  }
  return { storeys: levels.length, wallHeightM: r2(wallMm / 1000), buildingHeightM: r2((wallMm + riseMm) / 1000), roofNote: 'estimated from the drawn roof' };
}

/** The inputs used: the design's own values, replaced field by field by anything the person typed in lot.setbackInputs. */
export function setbackInputsFor(project, lot) {
  const auto = designHeights(project) || {};
  const ov = lot.setbackInputs || {};
  const pick = (k) => (num(ov[k]) != null ? { value: ov[k], auto: false } : { value: auto[k] ?? null, auto: true });
  const storeys = pick('storeys');
  const wall = pick('wallHeightM');
  const height = pick('buildingHeightM');
  return {
    storeys: storeys.value, wallHeightM: wall.value, buildingHeightM: height.value, streetType: ov.streetType || null,
    auto: { storeys: storeys.auto, wallHeightM: wall.auto, buildingHeightM: height.auto },
  };
}

// Change key: when this is the same, the stored setbacks are still right.
export function setbackKey(lot, inputs) {
  return JSON.stringify([lot.origin?.e, lot.origin?.n, lot.lotLabel, lot.lga, lot.state, lot.zoning?.code || null, lot.frontEdges || [], !!lot.frontageConfirmed,
    inputs.storeys, inputs.wallHeightM, inputs.buildingHeightM, inputs.streetType, lot.boundary?.length || 0]);
}

/** Compute for one lot. Returns { setbacks, envelope, attempts, key, error? }. Never throws. */
export async function computeSetbacks(project, lot, { fetchImpl = null, base = null } = {}) {
  const inputs = setbackInputsFor(project, lot);
  const key = setbackKey(lot, inputs);
  try {
    const ruleSet = await loadRuleSet(lot, { fetchImpl, base });
    const design = { storeys: inputs.storeys ?? undefined, wallHeightM: inputs.wallHeightM ?? undefined, buildingHeightM: inputs.buildingHeightM ?? undefined };
    if (inputs.streetType) design.streetType = inputs.streetType;
    const r = siteLotSetbacks(lot, ruleSet, design);
    const setbacks = r.setbacks ? { ...r.setbacks, designInputs: { storeys: inputs.storeys, wallHeightM: inputs.wallHeightM, buildingHeightM: inputs.buildingHeightM, streetType: inputs.streetType, auto: inputs.auto } } : null;
    return { setbacks, envelope: r.envelope, attempts: r.attempts || [], key, councilNotFound: ruleSet.councilNotFound || null };
  } catch (e) {
    return { setbacks: null, envelope: null, attempts: [{ basis: null, reason: e?.message || 'Setback data could not be loaded.' }], key, error: e?.message || 'failed' };
  }
}

/**
 * Keep site.lot.setbacks current. Call once with the store. Recomputes (debounced) whenever the frontage, the lot, the design heights or
 * the typed inputs change, and after undo or redo. Returns { refresh, dispose }.
 */
export function attachSetbacks(store, { fetchImpl = null, base = null, delayMs = 250 } = {}) {
  let timer = null;
  let seq = 0;
  let disposed = false;

  async function run() {
    timer = null;
    const lot = store.project.site?.lot;
    if (!lot || !lot.frontageConfirmed || !(lot.frontEdges || []).length) {
      if (lot && (lot.setbacks || lot.envelope) && !lot.frontageConfirmed) setSilently(null, null, null, []);
      return;
    }
    const my = ++seq;
    const inputs = setbackInputsFor(store.project, lot);
    const key = setbackKey(lot, inputs);
    if (lot.setbacksKey === key) return;
    const res = await computeSetbacks(store.project, lot, { fetchImpl, base });
    if (disposed || my !== seq) return;
    const cur = store.project.site?.lot;
    if (!cur || setbackKey(cur, setbackInputsFor(store.project, cur)) !== res.key) return; // changed while loading: a newer run follows
    setSilently(res.setbacks, res.envelope, res.key, res.attempts, res.error || (res.councilNotFound ? `council not found: ${res.councilNotFound}` : null));
  }

  function setSilently(setbacks, envelope, key, attempts, error = null) {
    const lot = store.project.site?.lot;
    if (!lot) return;
    lot.setbacks = setbacks;
    lot.envelope = envelope;
    lot.setbacksKey = key;
    lot.setbacksStatus = setbacks ? 'ok' : error ? 'error' : 'none';
    lot.setbacksAttempts = setbacks ? [] : (attempts || []).map((a) => ({ basis: a.basis || null, reason: String(a.reason || '').slice(0, 400) }));
    store.emit('project', { label: 'setbacks' });
  }

  const schedule = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };
  const off = store.on('project', (e) => { if (e?.label !== 'setbacks') schedule(); });
  schedule();
  return { refresh: schedule, dispose() { disposed = true; clearTimeout(timer); off(); } };
}
