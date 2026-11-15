// Moving a design between the two tools. A design belongs to the tool it was made in (project.mode, project.flow.kind); opening it in the
// other tool offers the switch rather than quietly changing it. The design travels in the same hand-off slot the home page viewer uses.

import { TOOL_INFO, toolOfProject, otherToolUrl, HANDOFF_KEY, PREV_AUTOSAVE_KEY } from '../toolmode.js';

export { HANDOFF_KEY, PREV_AUTOSAVE_KEY };

/** Leave the design for the other tool and open that tool on it. Returns false when the browser would not hold the hand-off. */
export function openInTool(project, tool, { loc = typeof location !== 'undefined' ? location : null, storage = typeof localStorage !== 'undefined' ? localStorage : null } = {}) {
  if (!loc) return false;
  try {
    if (project) storage.setItem(HANDOFF_KEY, JSON.stringify({ at: Date.now(), project }));
  } catch {
    return false;
  }
  const q = new URLSearchParams(loc.search || '');
  q.delete('address'); // the design already carries its lot
  loc.assign(otherToolUrl(tool, { pathname: loc.pathname, search: `?${q.toString()}` }));
  return true;
}

/** Wording of the offer. Pure. */
export function switchOffer(project, current) {
  const own = toolOfProject(project);
  const info = TOOL_INFO[own];
  return {
    tool: own,
    title: `Open this design in ${info.name}?`,
    message: `This design was made in ${info.name}, so it opens there with its own screens and plan set. Your work here stays as it is.`,
    confirmLabel: `Open in ${info.name}`,
    mismatch: own !== current,
  };
}

/** Ask, then switch. Resolves true when the person chose to switch. */
export async function offerSwitch(project, current, deps = {}) {
  const o = switchOffer(project, current);
  if (!o.mismatch) return false;
  const confirm = deps.confirm || (await import('./modal.js')).askConfirm; // loaded when asked: the dialog code needs a document
  const notify = deps.toast || (await import('./toast.js')).toast;
  const ok = await confirm({ title: o.title, message: o.message, confirmLabel: o.confirmLabel, cancelLabel: 'Stay here' });
  if (!ok) return false;
  if (!openInTool(project, o.tool, deps)) notify('This browser would not carry the design across. Save it as a file, then open it in the other tool.', { kind: 'warn' });
  return true;
}
