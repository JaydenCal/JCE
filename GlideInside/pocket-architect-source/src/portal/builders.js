// The builders named on the Glide Inside home page picker, and the slug rules shared by the server, the sign in page and the tests.
// Names are plain text only. A builder is "on Glide Inside" when an organisation with the same slug exists (GET /api/portal/brand/:slug).

export const BUILDERS = [
  { slug: 'mcdonald-jones', name: 'McDonald Jones Homes' },
  { slug: 'hunter-homes', name: 'Hunter Homes' },
  { slug: 'masterton', name: 'Masterton Homes' },
  { slug: 'coral-homes', name: 'Coral Homes' },
  { slug: 'hotondo', name: 'Hotondo Homes' },
  { slug: 'mojo', name: 'MOJO Homes' },
  { slug: 'montgomery', name: 'Montgomery Homes' },
  { slug: 'allworth', name: 'Allworth Homes' },
  { slug: 'tulliplan', name: 'Tulliplan Homes' },
  { slug: 'gj-gardner', name: 'G.J. Gardner Homes' },
];
export const builderName = (slug) => BUILDERS.find((b) => b.slug === slug)?.name || null;

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** "Hunter Homes Pty Ltd" to "hunter-homes-pty-ltd": lower case, letters and digits, single hyphens, at most 40 characters. */
export function slugify(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
/** A slug from the query string, or null when it is not a plain slug (so it is never sent to the server or used in markup). */
export const cleanSlug = (v) => (typeof v === 'string' && v.length <= 40 && SLUG_RE.test(v) ? v : null);
/** Reads ?builder= and ?role= (also the older ?client=1). role is 'client', 'builder' or null. */
export function readPick(search) {
  const p = new URLSearchParams(search || '');
  const role = p.get('role') === 'builder' ? 'builder' : p.get('role') === 'client' || p.get('client') ? 'client' : null;
  return { builder: cleanSlug(p.get('builder')), role };
}
