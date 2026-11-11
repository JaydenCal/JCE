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

export const portalUrl = (query = '') => (typeof location !== 'undefined' ? new URL(`portal/${query}`, new URL('../', location.href)).href : `/portal/${query}`);
