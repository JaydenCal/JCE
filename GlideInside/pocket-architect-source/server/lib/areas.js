// Builder areas for free plan set leads (owner decision 25/11/2026). Each builder org holds a list of areas (4 digit postcodes, and suburb
// names) and a builder type (house or shed). One org of each type holds an area, first come first served. Pure functions, no storage.

export const BUILDER_TYPES = ['house', 'shed'];
export const MAX_AREAS = 200;

/** The org's builder type: 'shed' or 'house' (the default). */
export const builderTypeOf = (org) => (org?.builderType === 'shed' ? 'shed' : 'house');

/** One area as a comparison key: a 4 digit postcode, or a lower case suburb name with single spaces. Null when it is neither. */
export function areaKey(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/^\d{4}$/.test(s)) return s;
  if (/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(s)) return s.toLowerCase();
  return null;
}

/** Cleans a list (array, or text split on commas and line breaks) to unique area strings. Throws a plain Error naming the first bad entry. */
export function cleanAreas(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n]+/);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const t = String(item ?? '').trim();
    if (!t) continue;
    const k = areaKey(t);
    if (!k) throw new Error(`"${t.slice(0, 40)}" is not a 4 digit postcode or a suburb name.`);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(/^\d{4}$/.test(t) ? t : t.replace(/\s+/g, ' '));
  }
  if (out.length > MAX_AREAS) throw new Error(`Hold at most ${MAX_AREAS} areas.`);
  return out;
}

export const areasOf = (org) => (Array.isArray(org?.areas) ? org.areas : []);

/** The first area `areas` shares with another org of the same type, as { orgId, orgName, area }, or null. */
export function findAreaConflict(orgs, orgId, type, areas) {
  const mine = new Set(areas.map(areaKey).filter(Boolean));
  for (const o of orgs) {
    if (o.id === orgId || builderTypeOf(o) !== type) continue;
    for (const a of areasOf(o)) if (mine.has(areaKey(a))) return { orgId: o.id, orgName: o.name, area: a };
  }
  return null;
}

/** The postcode of a free plan set enquiry: given directly, or the last 4 digits of the lot address or suburb text. */
export function postcodeOf(e) {
  const direct = String(e?.postcode || '').trim();
  if (/^\d{4}$/.test(direct)) return direct;
  for (const t of [e?.lot?.address, e?.suburb]) {
    const m = /\b(\d{4})\b(?!.*\b\d{4}\b)/.exec(String(t || ''));
    if (m) return m[1];
  }
  return null;
}

/** 'shed' for sheds and outbuildings, else 'house' (houses and granny flats). */
export function leadTypeOf(e) {
  return /shed|outbuild/i.test(`${e?.designType || ''}`) ? 'shed' : 'house';
}

/** The org that holds the lead's area for the lead's type, or null. Postcode first, then suburb name. Orgs that cannot take leads are skipped. */
export function matchOrgForLead(orgs, e) {
  const type = leadTypeOf(e);
  const pc = postcodeOf(e);
  const sub = areaKey(String(e?.suburb || '').replace(/\b\d{4}\b/g, ''));
  const eligible = orgs.filter((o) => builderTypeOf(o) === type && !['trial_ended', 'read_only'].includes(o.status));
  const byKey = (key) => (key ? eligible.find((o) => areasOf(o).some((a) => areaKey(a) === key)) || null : null);
  return byKey(pc) || byKey(sub && !/^\d{4}$/.test(sub) ? sub : null);
}
