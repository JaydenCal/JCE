// Commercial setbacks and buildable envelope. Council rule files are searched for rules whose appliesTo is industrial or
// commercial (use matched to the zone class). The residential fallbacks (Housing Code, Inland Code, QDC MP1.1) are NEVER used here.
// A slot the council file does not give comes from the indicative default table (src/commercial/rules.js). The lot carries the
// result in lot.setbacks and lot.envelope exactly as the housing stage does, so lotChecks and the envelope drawing work unchanged.

import { zoneMatches, findCouncil, buildEnvelope, classifyEdges } from '../site/setbacks.js';
import { loadRuleSet } from '../site/setback-data.js';
import { defaultRulesFor } from './rules.js';
import { effectiveClass } from './zones.js';

import { classifyZone } from '../site/zone-class.js';

const SLOTS = ['front', 'secondaryFront', 'side', 'rear'];

// NSW 2022 employment zones reform. Many council rule files still name the zones their DCP was written for (IN1, B5 and so on),
// while the lot now carries the reformed code (E4 General Industrial and so on), and the other way round. A rule written for an
// equivalent zone is tried after the lot's own code. Only used when the zone reads as an employment or mixed use zone, so a
// legacy "E4 Environmental Living" lot never picks up an industrial rule.
const ZONE_EQUIVALENTS = Object.freeze({
  E1: ['B1', 'B2'], E2: ['B3'], E3: ['B5', 'B6', 'B7'], E4: ['IN1', 'IN2'], E5: ['IN3'], MU1: ['B4'], SP4: ['B7'], W4: ['IN4'],
  B1: ['E1'], B2: ['E1'], B3: ['E2'], B4: ['MU1'], B5: ['E3'], B6: ['E3'], B7: ['E3', 'SP4'], IN1: ['E4'], IN2: ['E4'], IN3: ['E5'], IN4: ['W4'],
});

/** The zone codes to try for a lot, its own first: ['E4', 'IN1', 'IN2'] for an E4 General Industrial lot. */
export function zoneCandidates(zoneCode, zoneName) {
  const code = String(zoneCode || '').trim().toUpperCase();
  if (!code) return [''];
  const k = classifyZone(code, zoneName);
  return k === 'employment' || k === 'mixed' ? [code, ...(ZONE_EQUIVALENTS[code] || [])] : [code];
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const COMMERCIAL_BASIS = Object.freeze({ council: 'Council DCP (commercial or industrial rule)', default: 'Indicative default table, check with council' });

/** The first plain council rule value for a slot: appliesTo includes `use`, zone matches, no bands or conditions. */
function councilSlot(council, slot, use, zoneCode, zoneName) {
  const [own, ...legacy] = zoneCandidates(zoneCode, zoneName);
  for (const code of [own, ...legacy]) {
    for (const rule of council?.rules || []) {
      const applies = rule.appliesTo || [];
      if (!applies.includes(use)) continue;
      // The zone name belongs to the lot's own code; an equivalent code is matched on the code alone.
      if (!zoneMatches(rule.zones, code, code === own ? zoneName : null)) continue;
      const v = rule[slot];
      if (!v || (Array.isArray(v.bands) && v.bands.length) || !isNum(v.minM)) continue;
      if (rule.conditions && Object.keys(rule.conditions).length) continue;
      return { minM: v.minM, basis: COMMERCIAL_BASIS.council, dcp: rule.dcp || council.dcp || null, clause: rule.clause || null, page: rule.page ?? null, flag: 'check_with_council', ...(code === own ? {} : { zoneUsed: code }) };
    }
  }
  return null;
}

export const BCA_BASIS = 'Per the BCA, check with council';
export const BCA_FIRE_NOTE = 'No DCP minimum for this edge, it is set by the BCA (NCC). A wall on or near a boundary needs fire rated construction and the neighbour\'s wall and openings count, check with council and the certifier.';

/**
 * True when the council's rule for this use and zone leaves a side or rear slot to the BCA: the slot is empty in the data and the rule's
 * own text says so ("side and rear per BCA", or a table cell reading BCA). Tamworth and Gunnedah industrial are written this way.
 */
function bcaSlot(council, slot, use, zoneCode, zoneName) {
  if (slot !== 'side' && slot !== 'rear') return false;
  const [own, ...legacy] = zoneCandidates(zoneCode, zoneName);
  for (const code of [own, ...legacy]) {
    for (const rule of council?.rules || []) {
      if (!(rule.appliesTo || []).includes(use)) continue;
      if (!zoneMatches(rule.zones, code, code === own ? zoneName : null)) continue;
      if (rule[slot] && isNum(rule[slot].minM)) continue;
      const text = [rule.front?.note, rule.quote, rule.conditionText, ...(rule.evidence || []).map((e) => e.quote)].filter(Boolean).join(' ');
      if (/\bBCA\b|building code of australia|\bNCC\b/i.test(text)) return true;
    }
  }
  return false;
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
    if (council && bcaSlot(council, s, cls, lot.zoning?.code, lot.zoning?.name)) {
      // The council gives no figure here: it defers to the BCA. A 3 m default would be invented, so the minimum is 0 m with the fire wall note.
      picked[s] = { minM: 0, basis: BCA_BASIS, flag: 'check_with_council', bca: true, note: BCA_FIRE_NOTE };
      sources[s] = 'bca';
      continue;
    }
    const m = def.setbacks[s];
    picked[s] = isNum(m) ? { minM: m, basis: COMMERCIAL_BASIS.default, flag: 'check_with_council', note: def.note } : null;
    sources[s] = 'default';
  }
  if (Object.values(sources).some((v) => v === 'council' || v === 'bca')) picked.basis = COMMERCIAL_BASIS.council;
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
