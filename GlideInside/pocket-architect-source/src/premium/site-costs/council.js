// Council rules for the lot's council, from the JCESite council parameter database (derived JSON, tools/build-council-rules.py).
// Used by the site cost estimate and the siting report: the council's own value is shown with its clause, source file and page.
// Where the council has no record the text is "council value not found, default used". Setbacks are not read from here (the app has its own).
// Pure and Node compatible. No dashes in generated text.

import RULES from './council-rules.json' with { type: 'json' };
import { plainDashes } from '../../site/plain-text.js';

export const NOT_FOUND = 'council value not found, default used';

const STOP = new Set(['council', 'shire', 'city', 'municipal', 'regional', 'of', 'the', 'and']);
export const normName = (s) => (String(s || '').toLowerCase().match(/[a-z]+/g) || []).filter((w) => !STOP.has(w)).join('');

/** { slug, name, rules } for the lot's council (lot.lga text such as "TAMWORTH REGIONAL"), or null. */
export function councilFor(lga, data = RULES) {
  const k = normName(lga);
  if (!k) return null;
  for (const [slug, c] of Object.entries(data.councils)) if (c.k === k) return { slug, name: c.n, rules: c.r };
  return null;
}

/** The rules the estimate and report cite: key, label, what it feeds. */
export const RULE_KEYS = [
  { key: 'osd_required', label: 'On site detention, when required', area: 'Stormwater' },
  { key: 'osd_psd', label: 'Permissible site discharge', area: 'Stormwater' },
  { key: 'driveway_width_residential', label: 'Residential driveway crossing width', area: 'Driveway' },
  { key: 'driveway_grade_max', label: 'Maximum driveway grade', area: 'Driveway' },
  { key: 'driveway_distance_from_intersection', label: 'Driveway distance from an intersection', area: 'Driveway' },
  { key: 'cut_fill_max_dcp', label: 'Cut and fill limit', area: 'Earthworks' },
  { key: 'retaining_wall_max_height_exempt', label: 'Retaining wall height trigger', area: 'Retaining' },
  { key: 's711_plan', label: 'Developer contributions', area: 'Contributions' },
];

const fmtNum = (n) => (Math.round(n * 100) / 100).toString();
/** Short text for a record's value: "3 to 4.5 m", "1.2 m", or the council's own words. */
export function valueText(r) {
  if (!r) return '';
  const u = r.u && r.u !== 'text' ? ` ${r.u}` : '';
  if (r.lo != null && r.hi != null) return `${fmtNum(r.lo)} to ${fmtNum(r.hi)}${u}`;
  if (r.v != null) return `${fmtNum(r.v)}${u}${r.t ? `. ${r.t}` : ''}`;
  return r.t || '';
}
/** The record converted to metres where the unit is mm or m, else null. */
export function metres(r) {
  if (!r) return null;
  const f = r.u === 'mm' ? 0.001 : r.u === 'm' ? 1 : null;
  if (f == null) return null;
  const pick = (v) => (v == null ? null : v * f);
  return { v: pick(r.v), lo: pick(r.lo), hi: pick(r.hi) };
}

/** Citation text: "Gunnedah Shire Council, clause 3.10.3.4, page 92, Engineering Design Guidelines.pdf". */
export const citation = (council, r) => `${council.name}, clause ${r.cl || 'not given'}, page ${r.p}, ${r.f}`;

/**
 * councilRules(lot) -> { found, council, items: [{ key, label, area, found, text, cite, quote, rec }] }
 * Every RULE_KEYS entry is present: found false items carry the text "council value not found, default used".
 */
export function councilRules(lot, data = RULES) {
  const c = councilFor(lot?.lga, data);
  const items = RULE_KEYS.map((k) => {
    const recs = c?.rules?.[k.key];
    const rec = recs?.[0] || null;
    return rec
      ? { ...k, found: true, text: valueText(rec), cite: citation(c, rec), quote: plainDashes(rec.q), condition: rec.c, rec, conflict: !!rec.x }
      : { ...k, found: false, text: NOT_FOUND, cite: '', quote: '', condition: '', rec: null };
  });
  return { found: !!c, council: c ? c.name : null, lga: lot?.lga || '', items, source: data.source, built: data.built };
}
