// The Aerial on/off choice. The lot's own switch is site.lot.layers.aerial (the 2D plan, the 3D ground, the mini map and the PDF sheets all read
// it, off only when it is false). This module adds the rest:
//   * the choice is remembered per browser (localStorage, every access in try/catch) and applied to each lot that is loaded afterwards,
//   * a builder's portal setting "Show aerial by default" is the default until the person makes their own choice,
//   * setAerial(store, on) flips the layer as one undo step.
// No DOM, so it is unit tested in node.

const KEY = 'gi.aerial.v1';
let portalDefault = true;

/** The builder's "Show aerial by default" setting (true when not set). Called when a portal login is read. */
export function setAerialDefault(on) { portalDefault = on !== false; }
export const aerialDefault = () => portalDefault;

/** The remembered choice in this browser: true, false, or null when the person never chose. */
export function readAerialChoice() {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch { return null; }
}
export function writeAerialChoice(on) {
  try { globalThis.localStorage?.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode or storage blocked */ }
}
export function clearAerialChoice() {
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* ignore */ }
}

/** Whether a newly loaded lot shows its aerial: the person's own choice first, else the builder default, else on. */
export function initialAerial() {
  const c = readAerialChoice();
  return c === null ? portalDefault : c;
}

/** True unless the lot's aerial layer is switched off. */
export const aerialOn = (project) => project?.site?.lot?.layers?.aerial !== false;
/** True when the lot has an aerial picture to switch. */
export const hasAerial = (project) => !!project?.site?.lot?.aerial?.extent;

/** Switch the aerial on or off for the lot in the store (one undo step). `remember` stores the choice for this browser. */
export function setAerial(store, on, { remember = true } = {}) {
  const want = on !== false;
  if (remember) writeAerialChoice(want);
  if (!store?.project?.site?.lot || aerialOn(store.project) === want) return false;
  store.apply(want ? 'Show aerial' : 'Hide aerial', (p) => { p.site.lot.layers = { ...(p.site.lot.layers || {}), aerial: want }; });
  return true;
}

/** A copy of the project with the aerial layer off (used for PDF export when "Include aerial underlay" is unticked). */
export function withoutAerial(project) {
  const lot = project?.site?.lot;
  if (!lot) return project;
  return { ...project, site: { ...project.site, lot: { ...lot, layers: { ...(lot.layers || {}), aerial: false } } } };
}
