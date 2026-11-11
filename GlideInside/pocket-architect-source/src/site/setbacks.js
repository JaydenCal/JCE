// Setback rule picking and buildable-envelope construction. Pure ES module, no dependencies.
//
// Data shape: see setbacks-data/setback-rules.schema.json. One council file = { lga_slug, status, rules: [...] }.
// Fallback chain (owner decision 11/11/2026): council DCP rule for the zone -> Codes SEPP Inland Code (NSW councils
// with fallbackSet "NSW_INLAND") or Housing Code (other NSW) or QDC MP1.1 (QLD, lots up to 450 m2) -> null.
// All 69 inland LGAs of Codes SEPP cl 3D.1(4) carry fallbackSet "NSW_INLAND" (merge_research.py INLAND_LGAS). Every result carries `basis` ("Council DCP" | "Codes SEPP Housing Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)" | "QDC MP1.1 (default; council planning scheme or the Queensland Housing Code may vary)") and a source.
//
// Rule slot values (front, secondaryFront, side, rear, garage) are { minM, basis, note, rangeM, formula,
// percent, bands?: [...] }. A band is { lotWidthMinM?, lotWidthMaxM?, lotAreaMinM2?, lotAreaMaxM2?,
// buildingHeightMinM?, buildingHeightMaxM?, wallHeightMinM?, wallHeightMaxM?, storeys?, minM, note? }.
// Band and condition bounds are inclusive. A band or condition may also carry streetType ("access" | "collector",
// QDC MP1.1 Table A1); it is matched against input.streetType and is undecided (no value) when that is not supplied.

export const BASIS_LABELS = Object.freeze({ council: 'Council DCP', NSW: 'Codes SEPP Housing Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)', QLD: 'QDC MP1.1 (default; council planning scheme or the Queensland Housing Code may vary)',
  NSW_INLAND: 'Codes SEPP Inland Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)' });
const SLOTS = ['front', 'secondaryFront', 'side', 'rear', 'garage'];
const NON_RESIDENTIAL_ZONE = /^(B\d|IN\d|MU1|E1|E2|E5|SP\d|RE\d|W\d)$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const norm = (s) => String(s || '').trim().toUpperCase();

export function zoneMatches(ruleZones, zone) {
  const z = norm(zone);
  let explicit = false;
  let any = false;
  for (const rz of ruleZones || []) {
    if (rz === '*') {
      if (!NON_RESIDENTIAL_ZONE.test(z)) any = true;
    } else if (rz.endsWith('*')) {
      if (z.startsWith(rz.slice(0, -1))) { any = true; explicit = true; }
    } else if (norm(rz) === z) { any = true; explicit = true; }
  }
  return any ? { explicit } : null;
}

function useMatches(applies, use) {
  const a = applies && applies.length ? applies : ['any'];
  if (a.includes('any')) return { explicit: false };
  return a.includes(use) ? { explicit: true } : null;
}

// Tests a [min,max] numeric condition against an input value.
// Returns true | false | undefined (undefined = input missing, cannot be decided).
function inRange(min, max, v) {
  if (min == null && max == null) return true;
  if (!isNum(v)) return undefined;
  if (min != null && v < min) return false;
  if (max != null && v > max) return false;
  return true;
}

// Evaluates a condition/band object against the lot. Returns { ok, undecided, keys[] }.
function evalConds(c, input, keys) {
  let ok = true;
  const undecided = [];
  const test = (r, name, key) => {
    if (r === false) ok = false;
    else if (r === undefined) undecided.push(name);
    else if (key) keys.push(key);
  };
  const has = (...ks) => ks.some((k) => c[k] != null);
  if (has('storeys')) test(isNum(input.storeys) ? c.storeys === input.storeys : undefined, 'storeys', 'storeys');
  if (has('storeysMin', 'storeysMax')) test(inRange(c.storeysMin, c.storeysMax, input.storeys), 'storeys', 'storeys');
  if (has('lotWidthMinM', 'lotWidthMaxM')) test(inRange(c.lotWidthMinM, c.lotWidthMaxM, input.lotWidthM), 'lotWidthM', 'width');
  if (has('lotAreaMinM2', 'lotAreaMaxM2')) test(inRange(c.lotAreaMinM2, c.lotAreaMaxM2, input.lotAreaM2), 'lotAreaM2', 'area');
  if (has('wallHeightMaxM', 'wallHeightOverM', 'wallHeightMinM')) {
    test(inRange(c.wallHeightMinM ?? c.wallHeightOverM, c.wallHeightMaxM, input.wallHeightM), 'wallHeightM', 'wall');
  }
  if (has('buildingHeightMinM', 'buildingHeightMaxM')) {
    test(inRange(c.buildingHeightMinM, c.buildingHeightMaxM, input.buildingHeightM), 'buildingHeightM', 'height');
  }
  if (c.cornerLot != null) {
    test(typeof input.cornerLot === 'boolean' ? c.cornerLot === input.cornerLot : undefined, 'cornerLot', 'corner');
  }
  if (c.streetType) test(input.streetType ? norm(c.streetType) === norm(input.streetType) : undefined, 'streetType', 'street');
  if (c.landSizeMap) test(input.landSizeMap ? norm(c.landSizeMap) === norm(input.landSizeMap) : undefined, 'landSizeMap', 'lsm');
  if (c.precinct) {
    const p = norm(input.precinct);
    // precinct rules never apply unless the caller names the precinct
    if (!p || !(norm(c.precinct).includes(p) || p.includes(norm(c.precinct)))) ok = false;
    else keys.push('precinct');
  }
  if (c.qualifiers && c.qualifiers.length) {
    const have = new Set((input.qualifiers || []).map(String));
    for (const q of c.qualifiers) { if (have.has(q)) keys.push('q:' + q); else ok = false; }
  }
  if (c.qualifiersNot && c.qualifiersNot.length) {
    const have = new Set((input.qualifiers || []).map(String));
    for (const q of c.qualifiersNot) { if (have.has(q)) ok = false; else keys.push('qn:' + q); }
  }
  if (c.level) keys.push('level');
  return { ok, undecided, keys };
}

// Expands a rule slot into entries (one per band, or one for the slot itself).
function entriesFor(rule, slot) {
  const s = rule[slot];
  if (!s) return [];
  if (Array.isArray(s.bands) && s.bands.length) {
    return s.bands.map((b, i) => ({ rule, slot, value: { ...s, ...b, bands: undefined }, band: b, bandIndex: i }));
  }
  return [{ rule, slot, value: s, band: null }];
}

function valueSig(v) {
  return JSON.stringify([v.minM ?? null, v.basis || 'fixed', v.percent ?? null, v.formula ?? null, v.rangeM ?? null]);
}

function resolveSlot(rules, slot, input, zone, use) {
  const info = { value: null, reason: null, needsInput: [], conflictRules: [] };
  const entries = [];
  const levelsNeeded = isNum(input.storeys) && input.storeys >= 2 ? ['ground', 'upper'] : ['ground'];
  for (const rule of rules) {
    const zm = zoneMatches(rule.zones, zone);
    if (!zm) continue;
    const um = useMatches(rule.appliesTo, use);
    if (!um) continue;
    for (const e of entriesFor(rule, slot)) {
      const keys = [];
      if (zm.explicit) keys.push('zone');
      if (um.explicit) keys.push('use');
      const rc = evalConds(rule.conditions || {}, input, keys);
      let ok = rc.ok;
      const und = [...rc.undecided];
      if (e.band) {
        const bc = evalConds(e.band, input, keys);
        ok = ok && bc.ok;
        und.push(...bc.undecided);
      }
      if (!ok) continue;
      const ent = { ...e, keys: new Set(keys), undecided: und, level: (rule.conditions || {}).level || null };
      // band formula, e.g. (building height - 4.5) / 4 + 0.9, evaluated at input.buildingHeightM
      const fp = ent.value.formulaParams;
      if (fp && !isNum(ent.value.minM)) {
        if (isNum(input.buildingHeightM)) {
          ent.value = { ...ent.value, minM: Math.round(((input.buildingHeightM - fp.offsetM) / fp.divisor + fp.plusM) * 1000) / 1000, derived: ent.value.formula || 'band formula' };
        } else ent.undecided = [...ent.undecided, 'buildingHeightM'];
      }
      entries.push(ent);
    }
  }
  const decided = entries.filter((e) => e.undecided.length === 0);
  const undecided = entries.filter((e) => e.undecided.length > 0);
  if (undecided.length) {
    for (const e of undecided) for (const n of e.undecided) if (!info.needsInput.includes(n)) info.needsInput.push(n);
  }
  if (!decided.length) {
    info.reason = undecided.length ? 'inputs missing: ' + info.needsInput.join(', ') : 'no rule for this zone/use/lot';
    return info;
  }
  if (undecided.length) {
    // an undecidable entry could out-rank the decided ones: do not guess
    info.reason = 'ambiguous until inputs are supplied: ' + info.needsInput.join(', ');
    return info;
  }
  const perLevel = {};
  for (const L of levelsNeeded) {
    const cand = decided.filter((e) => !e.level || e.level === L);
    if (!cand.length) { info.reason = 'no rule for the ' + L + ' level'; return info; }
    const maximal = cand.filter((a) => !cand.some((b) => b !== a && b.keys.size > a.keys.size && [...a.keys].every((k) => b.keys.has(k))));
    const sigs = new Set(maximal.map((e) => valueSig(e.value)));
    if (sigs.size > 1) {
      info.reason = 'conflicting rules of equal specificity';
      info.conflictRules = [...new Set(maximal.map((e) => e.rule.id))];
      return info;
    }
    perLevel[L] = maximal;
  }
  const chosen = [];
  for (const L of levelsNeeded) for (const e of perLevel[L]) if (!chosen.includes(e)) chosen.push(e);
  // controlling value: the largest numeric across levels
  let ctrl = chosen[0];
  for (const e of chosen) if ((e.value.minM ?? -1) > (ctrl.value.minM ?? -1)) ctrl = e;
  const v = ctrl.value;
  const out = {
    minM: isNum(v.minM) ? v.minM : null,
    calc: v.basis || 'fixed',
    note: v.note || null,
    percent: v.percent ?? null,
    formula: v.formula ?? null,
    rangeM: v.rangeM ?? null,
    ruleIds: [...new Set(chosen.map((e) => e.rule.id))],
    sources: [...new Set(chosen.flatMap((e) => (e.value.sources && e.value.sources.length ? e.value.sources : e.rule.sources || [])))],
    quote: ctrl.rule.quote || null,
    clause: ctrl.rule.clause || null,
    page: ctrl.rule.page ?? null,
    source_file: ctrl.rule.source_file || null,
    confidence: ctrl.rule.confidence || null,
    needsReview: ctrl.rule.needsReview || null,
    dcp: ctrl.rule.dcp || null,
    edition: ctrl.rule.edition || null,
    flag: chosen.some((e) => e.rule.flag === 'check_with_council') ? 'check_with_council' : null,
    flagReason: (chosen.find((e) => e.rule.flag === 'check_with_council') || { rule: {} }).rule.flagReason || null,
  };
  if (levelsNeeded.length > 1) {
    out.perLevel = {};
    for (const L of levelsNeeded) out.perLevel[L] = perLevel[L][0].value.minM ?? null;
  }
  if (slot === 'garage' && ctrl.value.behindBuildingLineM != null) out.behindBuildingLineM = ctrl.value.behindBuildingLineM;
  info.value = out;
  return info;
}

function finishAverage(slotVal, input, frontVal) {
  if (!slotVal) return slotVal;
  if (slotVal.minM == null && slotVal.calc === 'average_neighbours') {
    const arr = (input.neighbourSetbacksM || []).filter(isNum);
    if (arr.length) {
      return { ...slotVal, minM: arr.reduce((a, b) => a + b, 0) / arr.length, derived: 'mean of neighbourSetbacksM' };
    }
  }
  if (slotVal.minM == null && slotVal.calc === 'percent_of_primary' && frontVal && isNum(frontVal.minM) && isNum(slotVal.percent)) {
    return { ...slotVal, minM: (frontVal.minM * slotVal.percent) / 100, derived: slotVal.percent + '% of the resolved front setback' };
  }
  return slotVal;
}

// Picks within one rule set. Returns { picked, missing: [...], reasons: {...} }.
function pickFrom(rules, input, basisLabel, dcpName) {
  const zone = input.zone;
  const use = input.use || 'dwelling';
  const reasons = {};
  const res = {};
  const slotList = ['front', 'side', 'rear'];
  if (input.cornerLot === true) slotList.push('secondaryFront');
  slotList.push('garage');
  for (const s of slotList) {
    const r = resolveSlot(rules, s, input, zone, use);
    res[s] = r.value;
    if (r.reason) reasons[s] = r.reason + (r.conflictRules.length ? ' (' + r.conflictRules.join(', ') + ')' : '');
  }
  res.front = finishAverage(res.front, input, null);
  res.secondaryFront = finishAverage(res.secondaryFront, input, res.front);
  const missing = [];
  for (const s of ['front', 'side', 'rear']) if (!res[s] || !isNum(res[s].minM)) missing.push(s);
  if (input.cornerLot === true && (!res.secondaryFront || !isNum(res.secondaryFront.minM))) missing.push('secondaryFront');
  const picked = {};
  for (const s of SLOTS) {
    const v = res[s];
    if (!v || (s === 'secondaryFront' && input.cornerLot !== true)) { picked[s] = null; continue; }
    picked[s] = { ...v, basis: basisLabel, dcp: v.dcp || dcpName || null };
  }
  return { picked, missing, reasons };
}

/**
 * pickRules(rulesForCouncil, { zone, storeys, lotWidthM, lotAreaM2, cornerLot, use, ...optional }, options?)
 * Optional input: wallHeightM, buildingHeightM, precinct, landSizeMap, qualifiers[], neighbourSetbacksM[], state,
 * streetType ("access" | "collector"; needed for the QLD QDC front setback).
 * options.fallbacks = { NSW: <rule file>, QLD: <rule file> } enables the fallback chain; the state comes from
 * input.state (default "NSW").
 * Returns { basis, state, front, secondaryFront, side, rear, garage, ruleIds, attempts, warnings } or null.
 */
export function pickRules(rulesForCouncil, input, options = {}) {
  const d = pickRulesDetailed(rulesForCouncil, input, options);
  return d.picked;
}

export function pickRulesDetailed(rulesForCouncil, input, options = {}) {
  const attempts = [];
  const inp = { ...(input || {}) };
  if (!inp.zone) return { picked: null, attempts: [{ basis: null, reason: 'zone not supplied' }] };
  const state = norm(inp.state || 'NSW');
  const council = rulesForCouncil && Array.isArray(rulesForCouncil.rules) ? rulesForCouncil : null;
  const chain = [];
  if (state === 'QLD') {
    // owner decision 11/11/2026: QLD uses the QDC default for every council at launch (no planning scheme lookups yet)
  } else if (council && council.status !== 'none') chain.push({ label: BASIS_LABELS.council, data: council, kind: 'council' });
  else attempts.push({ basis: BASIS_LABELS.council, reason: council ? 'council status is none (no DCP setback rules)' : 'no council rule file' });
  const fbs = options.fallbacks || {};
  // councils in the Inland Code LGA list carry fallbackSet: "NSW_INLAND"
  const fbKey = state === 'NSW' && council && council.fallbackSet && fbs[council.fallbackSet] ? council.fallbackSet : state;
  const fb = fbs[fbKey];
  if (fb && Array.isArray(fb.rules)) chain.push({ label: BASIS_LABELS[fbKey] || 'Fallback', data: fb, kind: 'fallback' });
  else if (state && !chain.length) attempts.push({ basis: BASIS_LABELS[fbKey] || 'Fallback', reason: 'fallback rule set not loaded' });
  for (const step of chain) {
    const r = pickFrom(step.data.rules, inp, step.label, step.kind === 'council' ? council.dcp : (step.data.name || step.label));
    if (!r.missing.length) {
      const picked = {
        basis: step.label,
        state,
        council: council ? council.council || council.lga_slug : null,
        source: step.kind === 'council'
          ? { kind: 'council', dcp: council.dcp || null, lga_slug: council.lga_slug || null }
          : { kind: 'fallback', name: step.data.name || step.label, edition: step.data.edition || null },
        ...r.picked,
        ruleIds: [...new Set(SLOTS.flatMap((s) => (r.picked[s] ? r.picked[s].ruleIds : [])))],
        attempts: attempts.concat([{ basis: step.label, reason: 'used' }]),
        warnings: [],
      };
      for (const s of SLOTS) {
        const v = picked[s];
        if (v && v.needsReview) picked.warnings.push(s + ': ' + v.needsReview);
      }
      picked.flag = SLOTS.some((s) => picked[s] && picked[s].flag) ? 'check_with_council' : null;
      picked.flagReason = picked.flag ? SLOTS.filter((s) => picked[s] && picked[s].flag).map((s) => s + ': ' + picked[s].flagReason).join('; ') : null;
      return { picked, attempts: picked.attempts };
    }
    attempts.push({ basis: step.label, reason: 'not determinable: ' + r.missing.map((s) => s + (r.reasons[s] ? ' (' + r.reasons[s] + ')' : '')).join('; ') });
  }
  return { picked: null, attempts };
}

// ---------------------------------------------------------------- geometry
const r3 = (v) => Math.round(v * 1e6) / 1e6; // removes floating point noise from envelope coordinates
const fmtPoint = (arrFmt, x, y) => (arrFmt ? [r3(x), r3(y)] : { x: r3(x), y: r3(y) });
const px = (p) => (Array.isArray(p) ? p[0] : p.x);
const py = (p) => (Array.isArray(p) ? p[1] : p.y);

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c); const d2 = o(a, b, d); const d3 = o(c, d, a); const d4 = o(c, d, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

const SAME_FRONTAGE_DEG = 30; // road edges that turn less than this between them are one frontage (bends, curves)
const SPLAY_MAX_MM = 10000;   // a corner cut-off between two frontages is shorter than this

/**
 * Groups the road edges into frontages. Returns [{ edges: [i...], length, splay }].
 * Consecutive road edges that turn less than 30 degrees are one frontage (an extra survey vertex on a straight
 * frontage, or a curved cul-de-sac head). A short run with a longer frontage on both sides is a corner splay.
 */
export function frontageRuns(lotPolygonMm, roadEdgeIndices) {
  const pts = lotPolygonMm.map((p) => ({ x: px(p), y: py(p) }));
  const n = pts.length;
  const road = [...new Set(roadEdgeIndices || [])].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
  if (!road.length) return [];
  const vec = (i) => ({ x: pts[(i + 1) % n].x - pts[i].x, y: pts[(i + 1) % n].y - pts[i].y });
  const len = (i) => Math.hypot(vec(i).x, vec(i).y);
  const turnDeg = (i, j) => {
    const a = vec(i); const b = vec(j);
    const la = Math.hypot(a.x, a.y); const lb = Math.hypot(b.x, b.y);
    if (la < 1e-9 || lb < 1e-9) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)))) * 180) / Math.PI;
  };
  const isRoad = new Set(road);
  // start at a road edge whose previous edge is not a road edge, or turns away, so runs are not split at index 0
  let start = road.find((i) => !isRoad.has((i - 1 + n) % n) || turnDeg((i - 1 + n) % n, i) >= SAME_FRONTAGE_DEG);
  if (start == null) start = road[0];
  const runs = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!isRoad.has(i)) { cur = null; continue; }
    const prev = (i - 1 + n) % n;
    if (cur && k > 0 && isRoad.has(prev) && turnDeg(prev, i) < SAME_FRONTAGE_DEG) cur.edges.push(i);
    else { cur = { edges: [i], length: 0, splay: false, joinsPrev: k > 0 && isRoad.has(prev) }; runs.push(cur); }
    cur.length += len(i);
  }
  // a splay: joined to a road run on both ends, shorter than both and under 10 m
  for (let r = 0; r < runs.length; r++) {
    const R = runs[r];
    const before = runs[(r - 1 + runs.length) % runs.length];
    const after = runs[(r + 1) % runs.length];
    const first = R.edges[0]; const last = R.edges[R.edges.length - 1];
    const joinedBefore = runs.length > 2 && before !== R && before.edges[before.edges.length - 1] === (first - 1 + n) % n;
    const joinedAfter = runs.length > 2 && after !== R && after.edges[0] === (last + 1) % n;
    if (joinedBefore && joinedAfter && R.length < SPLAY_MAX_MM && R.length < before.length && R.length < after.length) R.splay = true;
  }
  return runs.map(({ edges, length, splay }) => ({ edges, length, splay }));
}

/**
 * Classifies each edge i (from vertex i to i+1) as 'front' | 'secondaryFront' | 'side' | 'rear'.
 * frontEdgeIndices: edges touching a road. They are grouped into frontages (see frontageRuns). With more than one
 * frontage the shortest is the primary frontage and the others are secondary frontages (corner lot), unless
 * secondaryEdgeIndices is given. A corner splay takes the primary (larger) road setback and is never the primary
 * frontage itself. With no usable road edge every entry is null.
 */
export function classifyEdges(lotPolygonMm, frontEdgeIndices, secondaryEdgeIndices = null) {
  const pts = lotPolygonMm.map((p) => ({ x: px(p), y: py(p) }));
  const n = pts.length;
  const len = (i) => Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y);
  const valid = (arr) => [...new Set(arr || [])].filter((i) => Number.isInteger(i) && i >= 0 && i < n);
  let fronts = valid(frontEdgeIndices);
  let secondaries = [];
  const kinds = new Array(n).fill(null);
  if (secondaryEdgeIndices) {
    secondaries = valid(secondaryEdgeIndices);
    fronts = fronts.filter((i) => !secondaries.includes(i));
  } else {
    const runs = frontageRuns(lotPolygonMm, fronts);
    const main = runs.filter((r) => !r.splay);
    if (main.length > 1) {
      const primary = main.reduce((a, b) => (b.length < a.length ? b : a));
      fronts = [...primary.edges, ...runs.filter((r) => r.splay).flatMap((r) => r.edges)];
      secondaries = main.filter((r) => r !== primary).flatMap((r) => r.edges);
    }
  }
  if (!fronts.length && !secondaries.length) return kinds;
  fronts.forEach((i) => { kinds[i] = 'front'; });
  secondaries.forEach((i) => { kinds[i] = 'secondaryFront'; });
  const road = new Set([...fronts, ...secondaries]);
  // reference direction: the longest primary frontage edge
  const ref = fronts.length ? fronts : secondaries;
  let best = ref[0];
  for (const i of ref) if (len(i) > len(best)) best = i;
  const fx = (pts[(best + 1) % n].x - pts[best].x) / (len(best) || 1);
  const fy = (pts[(best + 1) % n].y - pts[best].y) / (len(best) || 1);
  const open = [];
  for (let i = 0; i < n; i++) {
    if (kinds[i]) continue;
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const adjacent = fronts.length ? (fronts.includes(prev) || fronts.includes(next)) : (road.has(prev) || road.has(next));
    const L = len(i) || 1;
    const dx = (pts[(i + 1) % n].x - pts[i].x) / L;
    const dy = (pts[(i + 1) % n].y - pts[i].y) / L;
    const parallel = Math.abs(dx * fx + dy * fy) >= Math.SQRT1_2 - 1e-9;
    kinds[i] = adjacent ? 'side' : (parallel ? 'rear' : 'side');
    if (!adjacent) open.push(i);
  }
  // A skewed rear boundary is not parallel to the frontage. When nothing was classed as rear, the boundary not
  // touching the frontage whose midpoint is farthest from it is the rear (a three-sided lot has none).
  if (!kinds.includes('rear') && open.length) {
    const o = pts[best];
    const dist = (i) => Math.abs(((pts[i].x + pts[(i + 1) % n].x) / 2 - o.x) * -fy + ((pts[i].y + pts[(i + 1) % n].y) / 2 - o.y) * fx);
    kinds[open.reduce((a, b) => (dist(b) > dist(a) ? b : a))] = 'rear';
  }
  return kinds;
}

// Clips a polygon to the half plane { p : (p - o) . nrm >= 0 } (Sutherland-Hodgman, one plane).
function clipHalfPlane(poly, o, nrm) {
  const out = [];
  const side = (p) => (p.x - o.x) * nrm.x + (p.y - o.y) * nrm.y;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const sa = side(a); const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function isConvex(pts, sgn) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]; const b = pts[(i + 1) % n]; const c = pts[(i + 2) % n];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const scale = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) || 1;
    if ((cr * sgn) / scale < -1e-6) return false;
  }
  return true;
}

/**
 * buildEnvelope(lotPolygonMm, frontEdgeIndices, picked, options?)
 * Offsets each edge inward by its own setback (metres in `picked`, polygon in millimetres).
 * Convex lots (the usual case, including extra vertices on straight boundaries and corner splays): the envelope is
 * the lot clipped by every edge's setback line, which is exact and copes with short edges that vanish.
 * Concave lots: adjacent offset lines are joined and the result is validated.
 * Returns the envelope polygon (same point format as the input) or null when there is no road edge, the setbacks
 * consume the lot, the offset is invalid, or a required setback is missing. Never throws on bad edge indices.
 */
export function buildEnvelope(lotPolygonMm, frontEdgeIndices, picked, options = {}) {
  if (!picked || !Array.isArray(lotPolygonMm) || lotPolygonMm.length < 3) return null;
  const arrFmt = Array.isArray(lotPolygonMm[0]);
  const pts = lotPolygonMm.map((p) => ({ x: px(p), y: py(p) }));
  const n = pts.length;
  if (pts.some((p) => !isNum(p.x) || !isNum(p.y))) return null;
  const kinds = classifyEdges(lotPolygonMm, frontEdgeIndices || [], options.secondaryEdgeIndices || null);
  if (!kinds.includes('front') && !kinds.includes('secondaryFront')) return null;
  const need = { front: picked.front, secondaryFront: picked.secondaryFront, side: picked.side, rear: picked.rear };
  const d = kinds.map((k) => {
    const s = need[k];
    return s && isNum(s.minM) && s.minM >= 0 ? s.minM * 1000 : null;
  });
  if (d.some((v) => v == null)) return null;
  const area = signedArea(pts);
  if (Math.abs(area) < 1e-6) return null;
  const sgn = area > 0 ? 1 : -1; // CCW positive: inward normal is the left of the direction
  if (isConvex(pts, sgn)) {
    let poly = pts;
    for (let i = 0; i < n && poly.length >= 3; i++) {
      const a = pts[i]; const b = pts[(i + 1) % n];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-9) continue; // repeated vertex: no boundary, no constraint
      const nrm = { x: (-(b.y - a.y) / L) * sgn, y: ((b.x - a.x) / L) * sgn };
      poly = clipHalfPlane(poly, { x: a.x + nrm.x * d[i], y: a.y + nrm.y * d[i] }, nrm);
    }
    // drop repeated points left by the clipping
    poly = poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6; });
    if (poly.length < 3 || Math.abs(signedArea(poly)) < 1) return null; // under 1 mm2: consumed
    return poly.map((p) => fmtPoint(arrFmt, p.x, p.y));
  }
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]; const b = pts[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-9) return null;
    const dx = (b.x - a.x) / L; const dy = (b.y - a.y) / L;
    const nx = -dy * sgn; const ny = dx * sgn;
    lines.push({ p: { x: a.x + nx * d[i], y: a.y + ny * d[i] }, d: { x: dx, y: dy }, n: { x: nx, y: ny }, off: d[i] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n]; const B = lines[i];
    const cross = A.d.x * B.d.y - A.d.y * B.d.x;
    if (Math.abs(cross) < 1e-9) {
      const v = pts[i];
      out.push({ x: v.x + A.n.x * A.off, y: v.y + A.n.y * A.off });
      if (Math.abs(A.off - B.off) > 1e-6) out.push({ x: v.x + B.n.x * B.off, y: v.y + B.n.y * B.off });
      continue;
    }
    const t = ((B.p.x - A.p.x) * B.d.y - (B.p.y - A.p.y) * B.d.x) / cross;
    out.push({ x: A.p.x + A.d.x * t, y: A.p.y + A.d.y * t });
  }
  if (out.length < 3) return null;
  const a2 = signedArea(out);
  if (a2 * sgn <= 1e-6 || selfIntersects(out)) return null;
  // every inset vertex must lie inside the original lot (guards against inverted offsets on concave lots)
  const inside = (p) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = pts[i].y; const yj = pts[j].y;
      if ((yi > p.y) !== (yj > p.y) && p.x < ((pts[j].x - pts[i].x) * (p.y - yi)) / (yj - yi) + pts[i].x) c = !c;
    }
    return c;
  };
  if (!out.every((p) => inside(p) || Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) < 1e-6)) return null;
  // each inset edge must still run the same way as its boundary (an edge that flipped has been consumed)
  for (let i = 0; i < n; i++) {
    const p = out[i]; const q = out[(i + 1) % out.length];
    if (out.length === n && (q.x - p.x) * lines[i].d.x + (q.y - p.y) * lines[i].d.y < -1e-6) return null;
  }
  return out.map((p) => fmtPoint(arrFmt, p.x, p.y));
}

export function envelopeArea(polyMm) {
  const pts = polyMm.map((p) => ({ x: px(p), y: py(p) }));
  return Math.abs(signedArea(pts));
}

// ---------------------------------------------------------------- site.lot adapter
// Agreed shape (docs/SITE_LOOKUP.md, "Setbacks and envelope on site.lot"):
//   site.lot.frontEdges  number[]   every boundary edge that faces a street (edge i = boundary[i] to boundary[i + 1]);
//                                   written by src/site/frontage.js and confirmed by the person
//   site.lot.setbacks    null | the pickRules result plus { edgeKinds: ['front'|'secondaryFront'|'side'|'rear', ...]
//                                   (one per boundary edge), inputs: {...what was asked} }
//   site.lot.envelope    null | [{ x, y }] in plan mm (buildEnvelope)
//   flags                `flag: 'check_with_council' | null` and `flagReason` on the result and on each of
//                        front / secondaryFront / side / rear / garage

const lgaKey = (name) => String(name || '').toLowerCase().replace(/-/g, ' ')
  .replace(/\b(the|council|of|city|shire|regional|municipal|municipality)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** The council rule file for an LGA name as the cadastre gives it ("TAMWORTH REGIONAL"), or null. */
export function findCouncil(councils, lgaName) {
  const k = lgaKey(lgaName);
  if (!k) return null;
  const hits = (councils || []).filter((c) => lgaKey(c.lga_slug) === k || lgaKey(c.council) === k);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * siteLotSetbacks(lot, ruleSet, design?) -> { setbacks, envelope, attempts }
 * lot: project.site.lot (src/site/model.js). ruleSet: setback-rules.json ({ councils, fallbacks }).
 * design: what the lot cannot tell us: { storeys, wallHeightM, buildingHeightM, streetType, precinct, landSizeMap,
 * qualifiers, neighbourSetbacksM, use }. Nothing is assumed for a missing value: a rule that needs it gives no result.
 * setbacks and envelope are null when nothing can be determined; assign both to site.lot as returned.
 */
export function siteLotSetbacks(lot, ruleSet, design = {}) {
  const none = (reason) => ({ setbacks: null, envelope: null, attempts: [{ basis: null, reason }] });
  if (!lot || !Array.isArray(lot.boundary) || lot.boundary.length < 3) return none('no lot boundary');
  const edgeKinds = classifyEdges(lot.boundary, lot.frontEdges || []);
  if (!edgeKinds.includes('front')) return none('street frontage not set');
  const n = lot.boundary.length;
  const len = (i) => Math.hypot(px(lot.boundary[(i + 1) % n]) - px(lot.boundary[i]), py(lot.boundary[(i + 1) % n]) - py(lot.boundary[i]));
  const splay = new Set(frontageRuns(lot.boundary, lot.frontEdges || []).filter((r) => r.splay).flatMap((r) => r.edges));
  const widthMm = edgeKinds.reduce((s, k, i) => (k === 'front' && !splay.has(i) ? s + len(i) : s), 0);
  const state = norm(lot.state || 'NSW');
  const inputs = {
    state,
    // Queensland zones are not looked up; the QDC default is not zone based
    zone: (lot.zoning && lot.zoning.code) || (state === 'QLD' ? 'QLD' : null),
    lotAreaM2: isNum(lot.areaM2) ? lot.areaM2 : undefined,
    lotWidthM: Math.round(widthMm) / 1000, // primary street frontage, used as the lot width
    cornerLot: edgeKinds.includes('secondaryFront'),
    use: 'dwelling',
    ...design,
  };
  const council = state === 'NSW' ? findCouncil(ruleSet && ruleSet.councils, lot.lga) : null;
  const d = pickRulesDetailed(council, inputs, { fallbacks: (ruleSet && ruleSet.fallbacks) || {} });
  if (!d.picked) return { setbacks: null, envelope: null, attempts: d.attempts };
  return { setbacks: { ...d.picked, edgeKinds, inputs }, envelope: buildEnvelope(lot.boundary, lot.frontEdges || [], d.picked), attempts: d.attempts };
}
