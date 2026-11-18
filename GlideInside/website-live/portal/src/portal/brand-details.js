// Builder details printed in the title block of every plan sheet (logo and name are separate: org.branding.displayName and logoDataUrl).
// One module for the server, the demo API, the Branding tab and the exporters, so all four agree on what is valid. Every field is optional.

export const DETAIL_KEYS = ['licence', 'abn', 'address', 'phone', 'email', 'website'];
export const DETAIL_LABELS = { licence: 'Builder licence number', abn: 'ABN', address: 'Business address', phone: 'Phone', email: 'Email', website: 'Website' };

const strip = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/** "12345678901" or "12 345 678 901" gives "12 345 678 901". Null when it is not 11 digits. */
export function formatAbn(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : null;
}
/** The ABN weighted checksum (subtract 1 from the first digit, weights 10 1 3 5 7 9 11 13 15 17 19, sum divisible by 89). */
export function abnChecksumOk(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const n = [...d].map(Number);
  n[0] -= 1;
  return n.reduce((a, x, i) => a + x * w[i], 0) % 89 === 0;
}

const BRACKETS = 'Remove the < and > characters.';
const CHECK = {
  licence: (v) => (v.length > 30 ? 'Licence number is too long (30 characters at most).' : !/^[A-Za-z0-9 ./-]+$/.test(v) ? 'Licence number can use letters, numbers, spaces, dots, slashes and hyphens.' : null),
  abn: (v) => (formatAbn(v) ? null : 'ABN must be 11 digits, for example 12 345 678 901.'),
  address: (v) => (v.length > 120 ? 'Address is too long (120 characters at most).' : null),
  phone: (v) => (!/^[0-9 +()-]+$/.test(v) || v.replace(/\D/g, '').length < 8 || v.replace(/\D/g, '').length > 15 ? 'Phone can use digits, spaces, + ( ) and hyphens, 8 to 15 digits.' : null),
  email: (v) => (v.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? 'Enter a valid email address.' : null),
  website: (v) => (v.length > 80 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/[^\s]*)?$/i.test(v) ? 'Enter a website such as www.samplehomes.com.au.' : null),
};

/**
 * Cleans and checks the details object. Missing or blank fields become null. Returns { ok, details, errors } where details always has all six keys.
 * The ABN is stored as "12 345 678 901" and the website without http(s)://.
 */
export function validateDetails(input) {
  const src = input && typeof input === 'object' ? input : {};
  const details = {};
  const errors = {};
  for (const k of DETAIL_KEYS) {
    let v = strip(src[k]);
    if (k === 'website') v = v.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!v) { details[k] = null; continue; }
    const bad = /[<>]/.test(v) ? BRACKETS : CHECK[k](v);
    if (bad) errors[k] = bad;
    details[k] = k === 'abn' && !bad ? formatAbn(v) : v;
  }
  return { ok: Object.keys(errors).length === 0, details, errors };
}

/** Details as the exporters read them from an org's branding block: only valid, non empty strings. */
export function cleanDetails(input) {
  const out = {};
  for (const k of DETAIL_KEYS) {
    const v = strip(input?.[k]);
    out[k] = v && !/[<>]/.test(v) && !CHECK[k](k === 'website' ? v.replace(/^https?:\/\//i, '') : v) ? (k === 'abn' ? formatAbn(v) : v) : null;
  }
  return out;
}
