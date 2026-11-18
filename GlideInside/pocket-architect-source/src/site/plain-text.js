// Council text is quoted exactly as the council wrote it, but en and em dashes (and the minus sign) never reach the screen or a printed sheet:
// each becomes a hyphen ("LSM –AA1" shows as "LSM -AA1"). plainDashes() for one string, plainDeep() for a whole rule object.
const DASHES = /[‐-―−]/g;
export const plainDashes = (s) => (typeof s === 'string' ? s.replace(DASHES, '-') : s);
export function plainDeep(v) {
  if (typeof v === 'string') return v.replace(DASHES, '-');
  if (Array.isArray(v)) return v.map(plainDeep);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = plainDeep(v[k]); return o; }
  return v;
}
