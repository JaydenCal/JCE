// Slug rules shared by the server, the sign in page and the tests. No builder names are listed here: a builder is "on Glide Inside" when an organisation with the same slug exists (GET /api/portal/brand/:slug).

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** "Sample Homes Pty Ltd" to "sample-homes-pty-ltd": lower case, letters and digits, single hyphens, at most 40 characters. */
export function slugify(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
/** A slug from the query string, or null when it is not a plain slug (so it is never sent to the server or used in markup). */
export const cleanSlug = (v) => (typeof v === 'string' && v.length <= 40 && SLUG_RE.test(v) ? v : null);
/** Reads ?builder= (or the short ?b=) and ?role= (also the older ?client=1). role is 'client', 'builder' or null. */
export function readPick(search) {
  const p = new URLSearchParams(search || '');
  const role = p.get('role') === 'builder' ? 'builder' : p.get('role') === 'client' || p.get('client') ? 'client' : null;
  return { builder: cleanSlug(p.get('builder') || p.get('b')), role };
}
