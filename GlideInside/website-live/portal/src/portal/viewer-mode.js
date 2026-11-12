// The home page lot viewer (?embed=1) for a signed in builder or client. No strip and no dialogs: the viewer keeps its own layout, and this only
// gives it the person's own designs (the lot card carousel) and the builder's name (the card line and the "Prepared for <builder>" PDF watermark).
// With no portal session it does nothing, so the public viewer stays on the generic sample designs.

import { CONFIG } from '../config.js';
import { getPortalApi } from './api.js';
import { createDesignSource } from './design-source.js';

export async function initPortalViewer(app, { api = getPortalApi() } = {}) {
  if (!CONFIG.portalEnabled) return null;
  let me;
  try { me = await api.me(); } catch { return null; }
  if (!me?.user || me.user.mustChangePassword || !me.org) return null;
  const brand = me.org.branding || {};
  const source = createDesignSource({ api, me, params: new URLSearchParams(), clientLike: me.user.role === 'client' });
  app.builder = { name: brand.displayName || me.org.name, logo: brand.logoDataUrl || null };
  app.lotDesigns = (project) => source.lotDesigns(project);
  app.lotCard?.refresh?.();
  return { me, source };
}
