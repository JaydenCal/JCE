// A lot opened with its house must open fitting cleanly: no "outside the buildable area" or "too big for this lot" on the sample lot or the
// default design. Auto fit first (move and turn inside the setbacks); when nothing fits and the person never chose a design, place the best
// fitting design instead (src/ui/embed-viewer.js placeBestDesign). A design the person chose is never swapped.
import { fitCardModel, applyFix } from '../site/fit-advice.js';
import { waitForEnvelope, placeBestDesign } from '../ui/embed-viewer.js';

const fits = (store) => { try { const m = fitCardModel(store.project, { withPlan: false }); return !m.show || m.verdict === 'fits' || m.verdict === 'tight' || m.tone === 'ok' || m.tone === 'note'; } catch { return true; } };

/**
 * Arrange now, and once more if the setbacks arrive or change in the next 30 s (they can land after the editor opens). The late pass only
 * moves a house that does not fit; it never touches one that does. Returns the first result.
 */
export async function arrangeOnLoadWatching(store, opts = {}) {
  const first = await arrangeOnLoad(store, opts);
  if (typeof store.on !== 'function') return first;
  let off = null;
  let busy = false;
  const stop = () => { try { off?.(); } catch { /* already off */ } off = null; };
  const t = setTimeout(stop, 30000);
  t.unref?.();
  off = store.on('project', async (e = {}) => {
    if (busy || e?.label !== 'setbacks') return;
    busy = true;
    try { await arrangeOnLoad(store, { ...opts, wait: async () => {} }); } catch { /* keep what is there */ } finally { busy = false; }
  });
  return first;
}

/** Pure-ish: returns 'fits' | 'moved' | 'swapped' | 'unfixed'. `placeBest` and `wait` can be injected for tests. */
export async function arrangeOnLoad(store, { catalogue = null, swap = true, wait = waitForEnvelope, placeBest = placeBestDesign } = {}) {
  const lot = store.project?.site?.lot;
  if (!lot || store.project.mode === 'commercial') return 'fits';
  await wait(store, 6000);
  if (fits(store)) return 'fits';
  try { applyFix(store, 'auto'); } catch { /* the swap below still runs */ }
  if (fits(store)) return 'moved';
  if (swap && catalogue && !store.ui?.placedDesign && !store.project.flow?.designId) {
    try { await placeBest(store, catalogue); } catch { /* keep what is there */ }
    if (fits(store)) return 'swapped';
    try { applyFix(store, 'auto'); } catch { /* keep what is there */ }
    if (fits(store)) return 'swapped';
  }
  return 'unfixed';
}
