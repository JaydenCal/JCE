// Zone classification shared by the setback rules, the lot card and the commercial mode. Pure, no dependencies.
//
// NSW 2022 employment zones reform: E1 Local Centre, E2 Commercial Centre, E3 Productivity Support, E4 General Industrial,
// E5 Heavy Industrial. The old environmental zones are C1 to C4 (C4 Environmental Living). Older data may still carry the
// legacy "E4 Environmental Living" name, so the zone NAME is read first and the code is only a fallback when the name is missing.

const EMPLOYMENT_NAME = /industr|business|commercial|centre|center|productivity|enterprise|employment|warehouse/i;

/** 'residential' | 'mixed' | 'employment' | 'environmental' | 'other' | 'unknown' for a zone code and name. */
export function classifyZone(code, name) {
  const c = String(code || '').trim().toUpperCase();
  const n = String(name || '').trim();
  if (n) {
    if (/environmental living/i.test(n)) return 'residential';
    if (/mixed use/i.test(n)) return 'mixed';
    if (/residential|village|\bliving\b/i.test(n)) return 'residential';
    if (EMPLOYMENT_NAME.test(n)) return 'employment';
    if (/environmental|conservation|national park|nature reserve|scenic/i.test(n)) return 'environmental';
    return 'other';
  }
  if (!c) return 'unknown';
  if (/^(R[1-5]|RU5|LLR|C4)$/.test(c)) return 'residential';
  if (c === 'MU1') return 'mixed';
  if (/^(B\d|IN\d|E[1-5]|SP\d)$/.test(c)) return 'employment';
  if (/^C[1-3]$/.test(c)) return 'environmental';
  return 'other';
}

/** True when a dwelling may not be permitted: employment, special purpose, recreation, waterway and the rural and environmental zones. */
export function isNonDwellingZone(code, name) {
  const k = classifyZone(code, name);
  return k !== 'residential' && k !== 'mixed' && k !== 'unknown';
}

/** True for the zones a council wildcard ("*") setback rule must not match: employment, mixed use, special purpose, recreation, waterway. */
export function isNonResidentialZone(code, name) {
  const k = classifyZone(code, name);
  return k === 'employment' || k === 'mixed' || /^(RE\d|W\d|SP\d)$/i.test(String(code || '').trim());
}
