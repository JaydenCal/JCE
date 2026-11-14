// Putting a commercial layout on a freshly loaded lot for the embedded commercial card: convert the project, wait a moment for the
// council setbacks, then place the Best fit layout. Refits once or twice when later setbacks move the envelope and the person has not touched the layout.

import { lotOf } from '../model/placement.js';
import { convertToCommercial } from './mode.js';
import { effectiveClass } from './zones.js';
import { applyFinishes, DEFAULT_FINISH, finishesOf } from './finishes.js';
import { chooseLayout, applyLayout, layoutUntouched, setbacksMoved, BEST_ID } from './layouts.js';
import { isCommercial } from './schema.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait up to `ms` for the setback stage to stamp the lot (setbacksKey), then carry on with what is there. */
export async function waitForSetbacks(store, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const l = lotOf(store.project) ? store.project.site.lot : null;
    if (!l || l.setbacksKey || l.setbacksStatus === 'error') return;
    await sleep(100);
  }
}

/** Convert to commercial (keeping any colours already chosen) and place the Best fit layout. Returns the choice, or null without a lot. */
export async function placeCommercial(store, { wait = 4000, layoutId = BEST_ID } = {}) {
  if (!lotOf(store.project)) return null;
  const keep = isCommercial(store.project) ? finishesOf(store.project) : DEFAULT_FINISH;
  store.apply('Commercial layout', (p) => {
    convertToCommercial(p, { useClass: effectiveClass(p) || 'industrial', name: 'Commercial units' });
    applyFinishes(p, { cladding: keep.cladding, door: keep.door });
  });
  await waitForSetbacks(store, wait);
  const choice = chooseLayout(store.project, layoutId);
  if (choice) applyLayout(store, choice);
  return choice;
}

/** Refit on late setbacks while the layout is the one the card placed. Returns an unsubscribe function. */
export function watchRefit(store, { isBusy = () => false } = {}) {
  let t = 0;
  let key = null;
  let refits = 0;
  let since = 0;
  const run = () => {
    const p = store.project;
    const lot = lotOf(p);
    if (!lot || !isCommercial(p) || isBusy()) return;
    const id = `${lot.origin?.e}|${lot.origin?.n}|${lot.lotLabel}`;
    if (id !== key) { key = id; refits = 0; since = Date.now(); }
    if (refits >= 2 || Date.now() - since > 40000) return;
    if (!layoutUntouched(p) || !setbacksMoved(p)) return;
    refits += 1;
    const choice = chooseLayout(p, p.commercial.layout?.id || BEST_ID);
    if (choice) applyLayout(store, choice);
  };
  return store.on('project', (e) => { if (e?.label === 'setbacks') { clearTimeout(t); t = setTimeout(run, 400); } });
}
