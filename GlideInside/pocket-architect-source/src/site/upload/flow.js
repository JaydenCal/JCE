// The upload flow the lot cards and the editor call: open the dialog, apply the boundary, and for the embedded cards place a design or a
// layout the same way a looked up address does.

import { applyUploadedBoundary } from './apply-upload.js';
import { needsCustomRules } from '../custom-rules.js';
import { injectUploadCss } from './css.js';

export const FOOT_BASE = 'Concept only · Glide Inside · JCE Infrastructure';

/** Extra words for the foot of a card: the user boundary line, the Mapbox credit, or the no aerial line. */
export function creditText(lot) {
  if (!lot) return '';
  const bits = [];
  if (lot.source === 'upload') bits.push('Boundary supplied by user, not checked against title');
  if (/mapbox/i.test(`${lot.aerial?.source || ''} ${lot.aerial?.attribution || ''}`)) bits.push('Aerial: © Mapbox © OpenStreetMap');
  else if (lot.source === 'upload' && !lot.aerial && lot.aerialSource === 'none') bits.push('Aerial not available for this location');
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

/**
 * runUpload(store, { catalogue, viewer, openRules }) -> modal handle.
 * viewer true: the embedded card, which confirms the frontage guess and places the best design or layout at once (the frontage can be changed
 * afterwards in the editor). viewer false: the editor, which shows the frontage step as for a looked up lot.
 */
export async function runUpload(store, { catalogue = null, viewer = false, openRules = null, after = null } = {}) {
  injectUploadCss();
  // Loaded on use: the dialog and toast need a browser page, and the lot card modules are also loaded where there is none.
  const [{ openUploadDialog }, { toast }] = await Promise.all([import('./dialog.js'), import('../../ui/toast.js')]);
  const commercial = store.project.mode === 'commercial';
  return openUploadDialog({
    store, commercial,
    onApply: async (input, o) => {
      const { lot, warnings } = await applyUploadedBoundary(store, input, o);
      if (viewer) {
        const { confirmFrontage, placeBestDesign } = await import('../../ui/embed-viewer.js');
        confirmFrontage(store, true);
        if (commercial) { const { placeCommercial } = await import('../../commercial/place.js'); await placeCommercial(store); }
        else await placeBestDesign(store, catalogue, store.ui.placedDesign?.id || null, {});
      }
      for (const w of warnings) toast(w, { kind: 'warn', timeout: 7000 });
      try { after?.(lot); } catch { /* the caller's own follow up */ }
      if (needsCustomRules(lot) || input.customRules) {
        toast('Set the site rules for this site. They start as Australian defaults.', { kind: 'info', timeout: 15000, action: { label: 'Site rules', onClick: () => (openRules ? openRules() : import('./rules-panel.js').then((m) => m.openRulesPanel(store))) } });
      }
    },
  });
}
