// Which of the two tools this page is: Glide Inside Residential or Glide Inside Commercial. Pure and DOM free, so it is unit tested.
//
//   ?mode=residential   the residential tool: no commercial switch, panels or toasts
//   ?mode=commercial    the commercial tool: no house designs or residential templates
//   no ?mode=           follows the saved project (a commercial project opens in the commercial tool); a fresh start is residential
//
// The address stays /plan-studio/app/ for both. A project remembers its mode (project.mode, project.flow.kind).

/** Storage slots shared with the home page viewer (src/ui/embed-viewer.js). */
export const HANDOFF_KEY = 'ps.handoff.v1';
export const PREV_AUTOSAVE_KEY = 'ps.autosave.prev.v1';

export const TOOLS = Object.freeze(['residential', 'commercial']);

export const TOOL_INFO = Object.freeze({
  residential: Object.freeze({
    id: 'residential',
    name: 'Glide Inside Residential',
    tabTitle: 'Glide Inside Residential | Find your block and place a home',
    cta: 'AI design assistant',
    ctaText: 'AI design assistant',
    otherId: 'commercial',
  }),
  commercial: Object.freeze({
    id: 'commercial',
    name: 'Glide Inside Commercial',
    tabTitle: 'Glide Inside Commercial | Lay out a commercial site',
    cta: 'Commercial Developer subscription',
    ctaText: 'Subscribe',
    otherId: 'residential',
  }),
});

/** The tool the address asks for, or null when it does not say. */
export function toolFromSearch(search = '') {
  let v = null;
  try { v = new URLSearchParams(search).get('mode'); } catch { v = null; }
  v = String(v || '').toLowerCase();
  return TOOLS.includes(v) ? v : null;
}

/** The tool a project belongs to. */
export function toolOfProject(project) {
  return project?.mode === 'commercial' || project?.flow?.kind === 'commercial' ? 'commercial' : 'residential';
}

/** True when the project has something in it worth protecting (a lot, rooms or walls, a commercial layout). */
export function projectHasWork(project) {
  if (!project) return false;
  if (project.site?.lot) return true;
  if (project.commercial?.rows?.length || project.commercial?.buildings?.length) return true;
  return (project.levels || []).some((l) => (l.rooms || []).length || (l.walls || []).length);
}

/**
 * Pick the tool for this page load. `requested` is the explicit ?mode=; `project` is the one that would open (autosave or handoff).
 * `mismatch` is true when an explicit request disagrees with the project that is about to open: the person is offered the switch.
 */
export function resolveTool({ search = '', project = null, fromSaved = false } = {}) {
  const requested = toolFromSearch(search);
  const own = toolOfProject(project);
  const tool = requested || (fromSaved && projectHasWork(project) ? own : 'residential');
  return { tool, requested, projectTool: own, mismatch: !!requested && fromSaved && projectHasWork(project) && own !== requested };
}

/** The address of a tool, keeping the rest of the query (address, back, view). The share id is dropped unless keepShare. */
export function otherToolUrl(tool, { pathname = '/plan-studio/app/', search = '', keepShare = false } = {}) {
  const q = new URLSearchParams(search);
  q.set('mode', tool);
  if (!keepShare) q.delete('share');
  return `${pathname}?${q.toString()}`;
}

/** Shared mutable handle, set once by the app at start. */
export const toolMode = { current: 'residential' };
export const currentTool = () => toolMode.current;
export const isCommercialTool = () => toolMode.current === 'commercial';
export const toolName = (tool = toolMode.current) => TOOL_INFO[tool]?.name || TOOL_INFO.residential.name;
