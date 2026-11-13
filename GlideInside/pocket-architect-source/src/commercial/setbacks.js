// Commercial setbacks and buildable envelope. Council rule files are searched for rules whose appliesTo is industrial or
// commercial (use matched to the zone class). The residential fallbacks (Housing Code, Inland Code, QDC MP1.1) are NEVER used here.
// A slot the council file does not give comes from the indicative default table (src/commercial/rules.js). The lot carries the
// result in lot.setbacks and lot.envelope exactly as the housing stage does, so lotChecks and the envelope drawing work unchanged.

import { zoneMatches, findCouncil, buildEnvelope, classifyEdges } from '../site/setbacks.js';
import { loadRuleSet } from '../site/setback-data.js';
import { defaultRulesFor } from './rules.js';
import { effectiveClass } from './zones.js';

const SLOTS = ['front', 'secondaryFront', 'side', 'rear'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const COMMERCIAL_BASIS = Object.freeze({ council: 'Council DCP (commercial or industrial rule)', default: 'Indicative default table, check with council' });

/** The first plain council rule value for a slot: appliesTo includes `use`, zone matches, no bands or conditions. */
function councilSlot(council, slot, use, zoneCode, zoneName) {
  for (const rule of council?.rules || []) {
    const applies = rule.appliesTo || [];
    if (!applies.includes(use)) continue;
    if (!zoneMatches(rule.zones, zoneCode || '', zoneName)) continue;
    const v = rule[slot];
    if (!v || (Array.isArray(v.bands) && v.bands.length) || !isNum(v.minM)) continue;
    if (rule.conditions && Object.keys(rule.conditions).length) continue;
    return { minM: v.minM, basis: COMMERCIAL_BASIS.council, dcp: rule.dcp || council.dcp || null, clause: rule.clause || null, page: rule.page ?? null, flag: 'check_with_council' };
  }
  return null;
}

/**
 * siteLotCommercialSetbacks(lot, ruleSet, { cls }) -> { setbacks, envelope, attempts }. Pure. `ruleSet` is { councils: [council] }.
 * `cls` is 'industrial' or 'commercial'. Never reads ruleSet.fallbacks.
 */
export function siteLotCommercialSetbacks(lot, ruleSet, { cls = 'industrial' } = {}) {
  const none = (reason) => ({ setbacks: null, envelope: null, attempts: [{ basis: null, reason }] });
  if (!lot || !Array.isArray(lot.boundary) || lot.boundary.length < 3) return none('no lot boundary');
  const fronts = lot.frontEdges || [];
  if (!fronts.length) return none('street frontage not set');
  const kinds = classifyEdges(lot.boundary, fronts);
  const def = defaultRulesFor(cls);
  const council = String(lot.state || 'NSW').toUpperCase() === 'NSW' ? findCouncil(ruleSet?.councils, lot.lga) : null;
  const picked = { basis: COMMERCIAL_BASIS.default, state: lot.state || 'NSW', council: council ? council.council || council.lga_slug : null, source: { kind: 'default', name: def.label }, commercial: true, class: cls };
  const sources = {};
  for (const s of SLOTS) {
    const c = council ? councilSlot(council, s, cls, lot.zoning?.code, lot.zoning?.name) : null;
    if (c) { picked[s] = c; sources[s] = 'council'; continue; }
    const m = def.setbacks[s];
    picked[s] = isNum(m) ? { minM: m, basis: COMMERCIAL_BASIS.default, flag: 'check_with_council', note: def.note } : null;
    sources[s] = 'default';
  }
  if (Object.values(sources).includes('council')) picked.basis = COMMERCIAL_BASIS.council;
  picked.sources = sources;
  picked.flag = 'check_with_council';
  picked.flagReason = 'Commercial setbacks are indicative, check with council';
  picked.warnings = [];
  picked.ruleIds = [];
  picked.edgeKinds = kinds;
  if (!lot.cornerLot && !kinds.includes('secondaryFront')) picked.secondaryFront = null;
  const envelope = buildEnvelope(lot.boundary, fronts, picked);
  return { setbacks: picked, envelope, attempts: [{ basis: picked.basis, reason: 'used' }] };
}

/** Load the council file and compute (used by the setback stage in commercial mode). Never throws. */
export async function computeCommercialSetbacks(project, lot, { fetchImpl = null, base = null } = {}) {
  const cls = effectiveClass(project) || 'industrial';
  let ruleSet = { councils: [] };
  try {
    ruleSet = await loadRuleSet(lot, { fetchImpl, base });
  } catch { /* the default table is used */ }
  const r = siteLotCommercialSetbacks(lot, { councils: ruleSet.councils || [] }, { cls });
  return { ...r, councilNotFound: ruleSet.councilNotFound || null, cls };
}
