// Where the Back button goes. Pure: the caller passes the facts, so it is unit tested.
// Order: an explicit ?back= on the same site, the page that launched the app (same site), the portal dashboard for a signed in
// builder or client, else the Glide Inside home page.

function parse(u, base) {
  try {
    return new URL(u, base);
  } catch {
    return null;
  }
}

const sameSite = (a, b) => !!a && !!b && a.origin === b.origin && /^https?:$/.test(a.protocol);
const samePage = (a, b) => a.origin === b.origin && a.pathname.replace(/index\.html$/, '') === b.pathname.replace(/index\.html$/, '');

/**
 * backTarget({ here, referrer, back, role, portalUrl, homeUrl }) -> { url, kind: 'param' | 'referrer' | 'portal' | 'home' }
 *   here       the app's own URL (location.href)
 *   referrer   document.referrer ('' when none)
 *   back       the ?back= parameter, if any
 *   role       the portal role (e.g. 'builder', 'client') when signed in, else null (null when signed out or not known)
 *   portalUrl  portal dashboard URL; homeUrl  Glide Inside home page URL (absolute or relative to `here`)
 */
export function backTarget({ here, referrer = '', back = null, role = null, portalUrl = '', homeUrl = '/index.html' }) {
  const me = parse(here);
  if (!me) return { url: homeUrl, kind: 'home' };
  if (back) {
    const b = parse(back, me);
    if (sameSite(me, b) && !samePage(me, b)) return { url: b.href, kind: 'param' };
  }
  if (referrer) {
    const r = parse(referrer);
    if (sameSite(me, r) && !samePage(me, r)) return { url: r.href, kind: 'referrer' };
  }
  if (role && portalUrl) {
    const p = parse(portalUrl, me);
    if (p) return { url: p.href, kind: 'portal' };
  }
  const home = parse(homeUrl, me);
  return { url: home ? home.href : homeUrl, kind: 'home' };
}

/** A short label for the button title. */
export const backLabel = (kind) => (kind === 'portal' ? 'Back to your dashboard' : kind === 'home' ? 'Back to Glide Inside' : 'Back to the previous page');
