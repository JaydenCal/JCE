// A project restored from the autosave, a saved file or a handoff keeps its lot but not always the picture: the aerial lives in this browser's
// image store, which can be empty (cleared, another browser, a handoff from the embed) while the lot still says "Aerial: On". This asks the same
// service a fresh lookup uses for the missing aerial (ensureFlowAerial, /api/site/aerial) and the missing ground levels (fetchContours), once
// per lot and quietly. Never throws; a failure leaves the lot as it was.
import { ensureFlowAerial, lotBboxMga } from '../flow/flow-aerial.js';
import { fetchContours } from './client.js';
import { addContours } from './apply.js';
import { loadBitmap } from '../editor2d/underlay.js';

const done = new Set();
const idOf = (store) => { const l = store.project?.site?.lot; return l?.origin ? `${store.project.id}:${l.origin.e},${l.origin.n}:${l.lotLabel || ''}` : null; };
const eligible = (lot) => !!lot && ['NSW', 'QLD'].includes(lot.state) && !!lot.origin && lot.boundary?.length > 2 && !lot.sample && !lot.demo && lot.source !== 'upload';

/**
 * refreshRestoredSite(store, { onStep, fetchImpl }) -> { aerial: boolean, contours: boolean } (what was fetched and added).
 * onStep('aerial' | 'contours') lets a caller show the existing "Loading the aerial image" / "Loading ground levels" step.
 */
export async function refreshRestoredSite(store, { onStep = null, fetchImpl = undefined, force = false } = {}) {
  const out = { aerial: false, contours: false };
  try {
    const lot = store.project?.site?.lot;
    const id = idOf(store);
    if (!id || !eligible(lot) || (!force && done.has(id))) return out;
    done.add(id);
    if (!lot.aerial?.userSupplied && !(lot.aerial?.key && (await loadBitmap(lot.aerial.key)))) {
      onStep?.('aerial');
      out.aerial = await ensureFlowAerial(store, { fetchImpl });
    }
    const cur = store.project.site?.lot;
    if (cur && idOf(store) === id && !cur.contours?.length) { // missing or empty contours: fetched with the aerial
      onStep?.('contours');
      const resp = await fetchContours({ state: cur.state, srid: cur.srid, origin: cur.origin, lot: { bboxMga: lotBboxMga(cur) } }, { fetchImpl });
      out.contours = addContours(store, cur, resp);
    }
  } catch { /* the restored lot stays as it was */ }
  return out;
}

/** Run once for the project the app opened with and again whenever a project is opened into the store (store.replace emits 'Open project'). */
export function watchRestoredSite(store, opts = {}) {
  refreshRestoredSite(store, opts);
  return store.on('project', (e) => { if (e?.label === 'Open project') refreshRestoredSite(store, opts); });
}
