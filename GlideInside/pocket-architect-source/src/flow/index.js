// Starts the guided flow for the app shell. Residential and commercial are separate flows with the same framework (guided.js).
//
//   Opens when:  the person is part way through a flow (project.flow, step 1 to 4: a refresh, or the home page card handed one over), or
//                the app opens on a fresh design (no autosave) for the first time.
//   Never when:  the embedded viewer, the demo, a shared design link, ?flow=0, or a returning visitor whose saved design has no flow record
//                (they go straight to the editor as before).
//   After step 4 the editor opens with the placed design and a "Back to placement" link brings the flow back at step 3.

import { h } from '../ui/dom.js';
import { createGuidedFlow } from './guided.js';
import { createTutorial } from '../tutorial/coach.js';
import { flowOf, flowInProgress, writeFlow, EDIT_STEP, portalDeepLink } from './state.js';
import { residentialSteps, RESIDENTIAL_BRAND } from './residential.js';
import { commercialSteps, COMMERCIAL_BRAND } from './commercial.js';

/** Which flow this project belongs to. */
export const kindOf = (project, wantCommercial = false) => (project?.mode === 'commercial' || flowOf(project)?.kind === 'commercial' || wantCommercial ? 'commercial' : 'residential');

/** The one tutorial coach of this page (created on first use). */
export const tutorialOf = (api) => (api.tutorial ||= createTutorial({ getFlow: () => api.flow }));

/** Whether a fresh app open should start the flow (pure, so it can be tested). */
export function shouldStart({ project, search = '', viewer = false, demo = false, shareId = null, fromAutosave = false }) {
  if (viewer || demo || shareId) return false;
  const q = new URLSearchParams(search);
  if (q.get('flow') === '0' || q.get('template')) return false;
  if (portalDeepLink(search)) return false; // opened from the builder portal: the design and lot are known, so straight into the editor
  if (flowInProgress(project)) return true;
  if (flowOf(project)) return false; // already in the editor from the flow (step 5)
  if (fromAutosave && commercialAddressAsked(search)) return true; // a commercial address link goes through the steps, never straight to a kept layout
  return !fromAutosave;
}

/** ?mode=commercial&address=...: the link asks for one lot in the commercial tool. */
export const commercialAddressAsked = (search = '') => {
  const q = new URLSearchParams(search);
  return q.get('mode') === 'commercial' && !!(q.get('address') || '').trim();
};

export async function initGuidedFlow({ api, store, refs, catalogue, viewer = false, demo = false, shareId = null, fromAutosave = false, wantCommercial = false, hasAddress = false }) {
  const search = typeof location !== 'undefined' ? location.search : '';
  if (!shouldStart({ project: store.project, search, viewer, demo, shareId, fromAutosave })) {
    attachBackPill({ api, store, refs, catalogue, wantCommercial });
    return null;
  }
  const kind = kindOf(store.project, wantCommercial);
  const flow = makeFlow({ api, store, refs, catalogue, kind });
  api.flow = flow;
  const f = flowOf(store.project);
  // A kept design with its lot already found (a commercial address link over an autosave) opens at step 2; a fresh open starts at step 1.
  const kept = fromAutosave && !f && kind === 'commercial' && !!store.project.site?.lot;
  const step = f && f.kind === kind && f.step < EDIT_STEP ? f.step : kept ? 2 : 1;
  if (kept) writeFlow(store, { kind, step });
  await flow.open(step);
  tutorialOf(api).startIfFirst(kind, step);
  attachBackPill({ api, store, refs, catalogue, wantCommercial });
  void hasAddress;
  return flow;
}

/** Open the flow of `kind` at `step` on the current design (the commercial tool's New, the switch offers). */
export async function openFlow({ api, store, refs, catalogue, kind, step = 1 }) {
  writeFlow(store, { kind, step });
  const flow = makeFlow({ api, store, refs, catalogue, kind });
  api.flow = flow;
  await flow.open(step);
  tutorialOf(api).startIfFirst(kind, step);
  attachBackPill({ api, store, refs, catalogue, wantCommercial: kind === 'commercial' });
  return flow;
}

function makeFlow({ api, store, refs, catalogue, kind }) {
  if (api.flows?.[kind]) return api.flows[kind];
  const steps = kind === 'commercial' ? commercialSteps({ catalogue, store, api }) : residentialSteps({ catalogue, store });
  const flow = createGuidedFlow({
    store, kind, steps, host: document.body,
    brand: kind === 'commercial' ? COMMERCIAL_BRAND : RESIDENTIAL_BRAND,
    onHelp: () => tutorialOf(api).restart(kind),
    onEditor: async () => {
      // The editor opens with the placed design. A residential home is selected on the plan so Move house is ready.
      store.setUI({ frontageEdit: false });
      if (kind === 'commercial') api.commercialReady?.();
      refs.shell.dataset.flow = 'editor';
    },
  });
  (api.flows ||= {})[kind] = flow;
  return flow;
}

/** The "Back to placement" pill in the editor, shown once the person has come through the flow. */
export function attachBackPill({ api, store, refs, catalogue, wantCommercial }) {
  if (api.flowPill) return api.flowPill;
  const pill = h('button', { class: 'gf-backpill', type: 'button', hidden: true, dataset: { ps: 'flow-back-to-placement' }, onclick: async () => {
    const f = flowOf(store.project);
    const kind = f?.kind || kindOf(store.project, wantCommercial);
    const flow = makeFlow({ api, store, refs, catalogue, kind });
    api.flow = flow;
    await flow.open(3);
  } }, 'Back to placement');
  const sync = () => {
    const f = flowOf(store.project);
    const lot = store.project.site?.lot;
    pill.hidden = !(f && f.step >= EDIT_STEP && lot);
  };
  refs.stage.append(pill);
  // Sit just above the lot card (never over its links), at the card's left edge; the CSS default applies when there is no card.
  const place = () => {
    if (pill.hidden) return;
    const card = refs.stage.querySelector('.lc-card');
    const sr = refs.stage.getBoundingClientRect();
    const cr = card && !card.hidden && getComputedStyle(card).display !== 'none' ? card.getBoundingClientRect() : null;
    if (!cr || cr.width < 2 || sr.height < 2) { pill.style.bottom = ''; pill.style.left = ''; return; }
    pill.style.left = `${Math.max(12, Math.round(cr.left - sr.left))}px`;
    pill.style.bottom = `${Math.max(12, Math.round(sr.bottom - cr.top + 10))}px`;
  };
  try { const ro = new ResizeObserver(place); ro.observe(refs.stage); const c = refs.stage.querySelector('.lc-card'); if (c) ro.observe(c); } catch { /* no ResizeObserver */ }
  store.on('ui', () => requestAnimationFrame(place));
  store.on('project', () => requestAnimationFrame(place));
  setTimeout(place, 600);
  store.on('project', sync);
  store.on('ui', sync);
  sync();
  api.flowPill = pill;
  return pill;
}

export { writeFlow, flowOf };
