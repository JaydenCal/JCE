// Where Pocket Architect and the portal live, and how a page links into the app with a house or project to open.

import { CONFIG } from '../config.js';

const isLocal = () => typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Base URL of Pocket Architect. Site config first (GI_CONFIG.portalAppUrl), then CONFIG.portal.appUrl. `?app=` works on localhost only. */
export function appBase() {
  if (typeof location === 'undefined') return CONFIG.portal.appUrl;
  const q = isLocal() ? new URLSearchParams(location.search).get('app') : null;
  return q || globalThis.GI_CONFIG?.portalAppUrl || CONFIG.portal.appUrl;
}

/** appLink({ house: id }) | { project: id } | { glide: id } | { signin: 1 } */
export function appLink(params = {}) {
  const url = new URL(appBase(), typeof location !== 'undefined' ? location.href : 'http://localhost/');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  return url.href;
}

/** Pocket Architect in client mode for builder staff: "Design on a lot" (new lot) or a client's saved project opened as that client sees it. */
export const designLink = ({ project = null } = {}) => appLink(project ? { design: 1, project } : { design: 'new' });

export const portalUrl = (query = '') => (typeof location !== 'undefined' ? new URL(`portal/${query}`, new URL('../', location.href)).href : `/portal/${query}`);

/** The portal sign in page, as seen from Pocket Architect. `?portal=` works on localhost only. */
export function signInUrl(query = '') {
  const q = isLocal() ? new URLSearchParams(location.search).get('portal') : null;
  const base = q || globalThis.GI_CONFIG?.portalSignInUrl || CONFIG.portal.signInUrl;
  return new URL(`${base}${query}`, location.href).href;
}
