// The default tutorial: a step by step coach for the guided flow and the editor. Pure data and helpers (no DOM), so the tests can check them.
//   step = { id, where: 'flow' | 'editor', flowStep?: 1..4 (the guided flow step the control lives in), target: CSS selector, text }
// A card is placed beside its target and never over the lot or the 3D view. Wording rule: no dashes, never the word "compliant".

export const TUTORIAL_KEY = 'gi.tutorial';

export const RESIDENTIAL_TUTORIAL = Object.freeze([
  { id: 'address', where: 'flow', flowStep: 1, target: '[data-ps="flow-address"]', text: 'Type your address here, or choose the sample lot to try it first.' },
  { id: 'lot', where: 'flow', flowStep: 1, target: '[data-ps="flow-setbacks"]', text: 'Check the lot, its frontage and the setbacks. The setbacks show where a house can go.' },
  { id: 'design', where: 'flow', flowStep: 2, target: '[data-ps="flow-homes"]', text: 'Pick a design. Use the filters and your lot width to narrow the list.' },
  { id: 'place', where: 'flow', flowStep: 3, target: '[data-ps="flow-place-status"]', text: 'Drag the house to move it and use the ring to rotate it. Auto fit helps, and the fit card tells you if it does not fit.' },
  { id: 'check', where: 'flow', flowStep: 4, target: '[data-ps="flow-summary"]', text: 'Look at it in 3D and walk inside to see how it feels.' },
  { id: 'save', where: 'editor', target: '[data-action="profile-save"]', text: 'Save design keeps your work in a free profile.' },
  { id: 'planset', where: 'editor', target: '[data-ps="lc-pdf"]', text: 'Get the plan set, or send it to a registered engineer.' },
]);

export const COMMERCIAL_TUTORIAL = Object.freeze([
  { id: 'address', where: 'flow', flowStep: 1, target: '[data-ps="flow-address"]', text: 'Type the address of the site here, or choose the sample lot.' },
  { id: 'type', where: 'flow', flowStep: 2, target: '[data-ps="flow-types"]', text: 'Choose a building type that suits the site.' },
  { id: 'layouts', where: 'flow', flowStep: 2, target: '[data-ps="flow-mix"]', text: 'Step through the layouts and add buildings to the mix.' },
  { id: 'place', where: 'flow', flowStep: 3, target: '[data-ps="flow-access-width"]', text: 'Drag the entry and exit handles on the plan to set where vehicles come in and out.' },
  { id: 'numbers', where: 'flow', flowStep: 4, target: '[data-ps="flow-summary"]', text: 'Check the numbers: the yield, parking and feasibility notes.' },
  { id: 'editor', where: 'editor', target: '[data-view="split"]', text: 'Customise the layout in the editor. Plan, split and 3D views are here.' },
  { id: 'planset', where: 'editor', target: '[data-action="profile-save"]', text: 'Save it, then get the plan set or send it to an engineer.' },
]);

export const tutorialFor = (kind) => (kind === 'commercial' ? COMMERCIAL_TUTORIAL : RESIDENTIAL_TUTORIAL);

const store = (s) => s ?? (typeof localStorage !== 'undefined' ? localStorage : null);
/** 'done' or 'skipped' once the visitor has finished or skipped the tutorial for this mode, else null. */
export function readTutorial(kind, storage) {
  try { const v = JSON.parse(store(storage)?.getItem(TUTORIAL_KEY) || '{}')[kind]; return v === 'done' || v === 'skipped' ? v : null; } catch { return null; }
}
export function writeTutorial(kind, value, storage) {
  try {
    const st = store(storage); if (!st) return false;
    let all = {}; try { all = JSON.parse(st.getItem(TUTORIAL_KEY) || '{}') || {}; } catch { all = {}; }
    if (value) all[kind] = value; else delete all[kind];
    st.setItem(TUTORIAL_KEY, JSON.stringify(all));
    return true;
  } catch { return false; }
}
/** Starts by default on the first visit of a mode; never again after it was finished or skipped. */
export const shouldStartTutorial = (kind, storage) => readTutorial(kind, storage) === null;

/** The first tutorial step that lives in guided flow step `n` (null when there is none). */
export const stepIndexForFlow = (steps, n) => { const i = steps.findIndex((s) => s.where === 'flow' && s.flowStep === n); return i < 0 ? null : i; };
