// Guided start flow state, kept on the project (project.flow) so a refresh resumes at the same step. Pure: no DOM.
//
//   project.flow = { kind: 'residential' | 'commercial', step: 1..5, designId?: string }
//
// Step 5 means the person is in the full editor. A project with no flow record (every design made before the guided flow) opens in the
// editor as it always did. The record is derived UI state: it is written without an undo step.

export const FLOW_KINDS = ['residential', 'commercial'];

export const RESIDENTIAL_STEPS = Object.freeze([
  { id: 'lot', title: 'Find your lot', short: 'Lot' },
  { id: 'home', title: 'Choose a home', short: 'Home' },
  { id: 'place', title: 'Place it', short: 'Place' },
  { id: 'check', title: 'Check it', short: 'Check' },
  { id: 'edit', title: 'Edit and export', short: 'Edit' },
]);

// The simple phone path (src/flow/phone-simple.js): the same four slots as the residential steps, named for what the person does.
export const PHONE_STEPS = Object.freeze([
  { id: 'lot', title: 'Address', short: 'Address' },
  { id: 'home', title: 'Pick', short: 'Pick' },
  { id: 'place', title: 'Fit', short: 'Fit' },
  { id: 'check', title: 'Plans', short: 'Plans' },
  { id: 'edit', title: 'Edit', short: 'Edit' },
]);

export const COMMERCIAL_STEPS = Object.freeze([
  { id: 'lot', title: 'Find your lot', short: 'Lot' },
  { id: 'build', title: 'Choose what to build', short: 'Build' },
  { id: 'place', title: 'Place it', short: 'Place' },
  { id: 'check', title: 'Check it', short: 'Check' },
  { id: 'edit', title: 'Edit and export', short: 'Edit' },
]);

export const stepsFor = (kind) => (kind === 'commercial' ? COMMERCIAL_STEPS : RESIDENTIAL_STEPS);
export const EDIT_STEP = 5;

/** The flow record of a project, normalised, or null when the project has none. */
export function flowOf(project) {
  const f = project?.flow;
  if (!f || !FLOW_KINDS.includes(f.kind)) return null;
  const step = Math.min(EDIT_STEP, Math.max(1, Math.round(Number(f.step)) || 1));
  return { kind: f.kind, step, designId: typeof f.designId === 'string' ? f.designId : null };
}

/** True when the person is part way through the flow (the overlay should open). */
export const flowInProgress = (project, kind = null) => {
  const f = flowOf(project);
  return !!f && f.step < EDIT_STEP && (!kind || f.kind === kind);
};

/** Write the flow record on the live project without an undo step, then tell the autosave and the views. */
export function writeFlow(store, patch) {
  const cur = store.project.flow || {};
  const next = { ...cur, ...patch };
  if (Object.keys(next).every((k) => next[k] === cur[k]) && Object.keys(cur).every((k) => k in next)) return flowOf(store.project); // nothing changed (the phone path keeps phoneType and phoneSimple here too)
  store.project.flow = next;
  store.emit('project', { label: 'flow' });
  return flowOf(store.project);
}

export const clampStep = (n) => Math.min(EDIT_STEP, Math.max(1, Math.round(n)));

/** Where Next and Back go from a step. */
export const nextStep = (step) => clampStep(step + 1);
export const prevStep = (step) => clampStep(step - 1);

/** The step a project handed from a page or a link should open on: the saved one, else `fallback`. */
export const resumeStep = (project, kind, fallback = 1) => {
  const f = flowOf(project);
  return f && f.kind === kind ? f.step : fallback;
};

/**
 * A design opened from the builder portal (?project=, ?house= or ?glide=) already has its home and lot: it goes straight into the full editor,
 * never the guided steps. Pure, so it is unit tested.
 */
export function portalDeepLink(search = '') {
  const q = new URLSearchParams(search);
  return !!(q.get('project') || q.get('house') || q.get('glide'));
}

/** The project to load in the editor: a design saved part way through the guided flow is moved to the editing step so no step overlay opens. */
export function forEditing(project) {
  const f = flowOf(project);
  if (!f || f.step >= EDIT_STEP) return project;
  return { ...project, flow: { ...project.flow, kind: f.kind, step: EDIT_STEP } };
}
