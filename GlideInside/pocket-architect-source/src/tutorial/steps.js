// The tutorial: chapters of short steps and a step by step coach for the guided flow and the editor. Pure data and helpers (no DOM), so the tests can check them.
//   step = { id, where: 'flow' | 'editor', flowStep?: 1..4 (the guided flow step the control lives in), target: CSS selector, text }
// A card is placed beside its target and never over the lot or the 3D view. Wording rule: no dashes, never a compliance claim.

export const TUTORIAL_KEY = 'gi.tutorial';

export const RESIDENTIAL_TUTORIAL = Object.freeze([
  { id: 'address', where: 'flow', flowStep: 1, target: '[data-ps="flow-address"]', text: 'Type your address here, or choose the sample lot to try it first.' },
  { id: 'lot', where: 'flow', flowStep: 1, target: '[data-ps="flow-setbacks"]', text: 'Check the lot, its frontage and the setbacks. The setbacks show where a house can go.' },
  { id: 'design', where: 'flow', flowStep: 2, target: '[data-ps="flow-homes"]', text: 'Pick a design. Use the filters and your lot width to narrow the list.' },
  { id: 'place', where: 'flow', flowStep: 3, target: '[data-ps="flow-place-status"]', text: 'Drag the house to move it and use the ring to rotate it. Auto fit helps, and the fit card tells you if it does not fit.' },
  { id: 'check', where: 'flow', flowStep: 4, target: '[data-ps="flow-summary"]', text: 'Look at it in 3D and walk inside to see how it feels.' },
  { id: 'save', where: 'editor', target: '[data-action="profile-save"]', text: 'Save design keeps your work in your profile. Saving is included, no payment needed.' },
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

/** The basics chapter is the original seven step tour. It starts by itself on a first visit and is the only chapter that does. */
export const BASICS_ID = 'basics';

const S = (id, where, flowStep, target, text, extra = {}) => ({ id, where, ...(where === 'flow' ? { flowStep } : {}), target, text, ...extra });
const F = (id, flowStep, target, text, extra) => S(id, 'flow', flowStep, target, text, extra);
const E = (id, target, text, extra) => S(id, 'editor', null, target, text, extra);

// Chapters: { id, title, blurb, steps[] }. Each step points at a real control. `arm` selects an editor tool first so its panel exists.
// Wording rule for every string here: no dashes, never the word "compliant". One or two short sentences per step.
const CHAPTERS_RESIDENTIAL = [
  { id: 'find', title: 'Find your lot', blurb: 'Search an address, check the lot and read the setbacks.', steps: [
    F('address', 1, '[data-ps="flow-address"]', 'Type your street address and choose it from the list. The lot outline loads from the cadastre.'),
    F('sample', 1, '[data-ps="flow-sample"]', 'No address handy? Choose the sample lot and try every step first.'),
    F('lot', 1, '[data-ps="flow-lot-label"]', 'Check the lot and plan number match your title, then press This is my lot.'),
    F('setbacks', 1, '[data-ps="flow-setbacks"]', 'The setbacks show how far a building must sit from each boundary. They are a guide only.'),
  ] },
  { id: 'design', title: 'Choose a design', blurb: 'Filter the designs by size and lot width, then pick one.', steps: [
    F('filters', 2, '[data-ps="flow-filter-bedrooms"]', 'Filter by bedrooms and storeys to narrow the list.'),
    F('frontage', 2, '[data-ps="flow-filter-frontage"]', 'Enter your lot width here. Designs that are too wide for it drop out of the list.'),
    F('fits', 2, '[data-ps="flow-filter-fits"]', 'Show only the designs that fit this lot inside its setbacks.'),
    F('homes', 2, '[data-ps="flow-homes"]', 'Each card shows size, bedrooms and fit. Click one to choose it, then press Place this home.'),
  ] },
  { id: 'place', title: 'Place and fit', blurb: 'Drag, rotate, Auto fit and fix a design that does not fit.', steps: [
    F('drag', 3, '[data-ps="flow-house"]', 'Drag the house to move it. It stays inside the setbacks.'),
    F('rotate', 3, '[data-ps="flow-handle"]', 'Drag the round gold ring to turn the house. Turn left, Turn right and Mirror do it in one click.'),
    F('autofit', 3, '[data-ps="flow-bestfit"]', 'Best fit is Auto fit. It puts the house in the best spot inside the setbacks, facing the street.'),
    F('status', 3, '[data-ps="flow-place-status"]', 'This line says whether the house meets the setbacks. If not, the fit card lists fixes.'),
    E('fitcard', '[data-ps="fit-shrink-toggle"]', 'The fit card offers other designs and shrink suggestions, such as a narrower garage, when a house is too big.'),
  ] },
  { id: 'edit', title: 'Edit rooms and walls', blurb: 'Change rooms, draw walls, add doors and windows.', steps: [
    E('room', '[data-ps="room-edit-arm"]', 'Edit room lets you drag a room edge to resize it. Walls and furniture move with it.'),
    E('wall', '[data-tool="wall"]', 'The Wall tool draws walls. Click the start, then click each corner.', { arm: 'wall' }),
    E('door', '[data-tool="door"]', 'The Door tool places a door. Click on a wall.', { arm: 'door' }),
    E('window', '[data-tool="window"]', 'The Window tool works the same way. Click on a wall to add a window.', { arm: 'window' }),
    E('select', '[data-tool="select"]', 'Select anything to change its size and type in the panel on the right. Undo is always one click away.', { arm: 'select' }),
  ] },
  { id: 'driveway', title: 'Driveway and roads', blurb: 'Shape the driveway, edit its PIs, then draw roads and paths with the Road or pavement tool.', steps: [
    F('entry', 3, '[data-ps="flow-drive-handle"]', 'Drag the round handle at the street to slide the driveway entry along the frontage.'),
    F('bend', 3, '[data-ps="flow-drive-bend"]', 'Add bend puts a corner in the driveway. Drag the new point to shape the path.'),
    E('drivepi', '[data-tool="drivepi"]', 'The Driveway PIs tool (I) edits the driveway bends in the editor. Click the centreline to add a PI and drag a square to move it.', { arm: 'drivepi' }),
    E('piradius', '[data-ps="drivepi-radius"]', 'Delete PI removes the selected bend. Choose a bend radius to round every PI, or Reset to auto to bring the automatic driveway back.', { arm: 'drivepi' }),
    E('pave', '[data-tool="pave"]', 'The Road or pavement tool (L) draws driveways, paths and roads. Click each PI, then double click to finish. Add curve (C) rounds each PI.', { arm: 'pave' }),
  ] },
  { id: 'view3d', title: '3D and Walk', blurb: 'See the design in 3D and walk through it.', steps: [
    F('check3d', 4, '[data-ps="flow-3d"]', 'This 3D view shows the house on your lot. Drag to look around and scroll to zoom.'),
    E('view', '[data-view="3d"]', '3D fills the screen. Split shows plan and 3D side by side.'),
    E('presets', '[data-ps="view3d-aerial"]', 'Preset views such as Street view, Front and Aerial jump the camera to a useful angle.'),
    E('walk', '[data-view="walk"]', 'Walk puts you inside at eye height. Use W A S D to move and drag to look.'),
  ] },
  { id: 'save', title: 'Save and profile', blurb: 'Keep your work in your profile, or as a file. Saving is included.', steps: [
    E('profile', '[data-action="profile-save"]', 'Save design keeps your work in your profile, with no payment needed. Open it on any device later.'),
    E('save', '[data-action="save"]', 'Save also downloads the design as a file you can keep.'),
    E('open', '[data-action="open"]', 'Open brings back a design you saved earlier.'),
    E('share', '[data-action="share"]', 'Share makes a link so someone else can view the design.'),
  ] },
  { id: 'planset', title: 'Plan set and export', blurb: 'Get the plan set PDF or send it to an engineer.', steps: [
    E('pdf', '[data-ps="lc-pdf"]', 'Site plan PDF gives you the plan set for this lot.', { openCard: true }),
    E('engineer', '[data-ps="lc-send-engineer"]', 'Send to engineer passes the design to a registered engineer for the next stage.', { openCard: true }),
    E('lotcard', '[data-ps="lot-card"]', 'The lot card shows the lot, the design and the key numbers while you work.'),
  ] },
];

const CHAPTERS_COMMERCIAL = [
  { id: 'find', title: 'Find your lot', blurb: 'Search the site address and check the lot and zoning.', steps: [
    F('address', 1, '[data-ps="flow-address"]', 'Type the site address and choose it from the list. The lot outline loads from the cadastre.'),
    F('sample', 1, '[data-ps="flow-sample"]', 'Choose the sample lot to try every step first.'),
    F('lot', 1, '[data-ps="flow-lot-label"]', 'Check the lot and plan number, then press This is my lot.'),
    F('setbacks', 1, '[data-ps="flow-setbacks"]', 'The setbacks show where a building can go. Zone controls are a guide only.'),
  ] },
  { id: 'type', title: 'Building type and layouts', blurb: 'Choose what to build and step through layouts.', steps: [
    F('types', 2, '[data-ps="flow-types"]', 'Choose a building type that suits the site, such as a warehouse, workshop or showroom.'),
    F('mix', 2, '[data-ps="flow-mix"]', 'Step through the layouts, then add more buildings to the mix.'),
    F('wall', 2, '[data-ps="flow-wall"]', 'Pick the wall finish. It changes the 3D view and the plan.'),
  ] },
  { id: 'place', title: 'Place, rotate, entry and exit', blurb: 'Position the building and set the driveway entry and exit.', steps: [
    F('drag', 3, '[data-ps="flow-building"]', 'Drag the building to slide it around the lot.'),
    F('rotate', 3, '[data-ps="flow-handle"]', 'Drag the round gold ring to turn the building. Parking and aisles follow.'),
    F('access', 3, '[data-ps="flow-access-handle"]', 'Drag the entry and exit handles along the frontage to set where vehicles come in and out.'),
    F('width', 3, '[data-ps="flow-access-width"]', 'Choose the width of the entry and exit.'),
    F('layout', 3, '[data-ps="flow-layout-name"]', 'Use the layout arrows to try another arrangement, or Best fit to reset the building.'),
  ] },
  { id: 'hardstand', title: 'Hardstand, roads and paving', blurb: 'Draw car parks, roads and paving areas.', steps: [
    E('tool', '[data-tool="hardstand"]', 'The Hardstand tool (P) draws car park and paving areas. Drag a rectangle or click a polygon.', { arm: 'hardstand' }),
    E('roads', '[data-ps="hardstand-roads"]', 'The Roads and paving buttons pick the kind of road, driveway or footpath to draw.', { arm: 'hardstand' }),
    E('pave', '[data-tool="pave"]', 'The Road or pavement tool (L) lays a road along PI points you click. Double click to finish. Add curve (C) rounds each PI.', { arm: 'pave' }),
    E('area', '[data-ps="hardstand-kind-area"]', 'Choose Area to draw a hardstand, car park or paving area as a rectangle or polygon.', { arm: 'hardstand' }),
    E('surface', '[data-ps="hardstand-type"]', 'Choose the pavement surface. Quantities and an indicative cost update as you draw.', { arm: 'hardstand' }),
  ] },
  { id: 'numbers', title: 'Numbers and feasibility', blurb: 'Read the yield, parking and feasibility notes.', steps: [
    F('summary', 4, '[data-ps="flow-summary"]', 'The check shows the floor area, site coverage and parking provided against the guide.'),
    F('yield', 4, '[data-ps="fin-cards"]', 'The finance cards show an indicative profit and yield for the layout. Figures are indicative only.'),
    F('estimates', 4, '[data-ps="flow-estimates"]', 'Rough estimates help you compare options. They are not a quote.'),
    E('feas', '[data-ps="cc-feas-open"]', 'See details opens the full feasibility numbers in the editor.'),
  ] },
  { id: 'editor', title: 'Editor', blurb: 'Customise the layout in plan, split and 3D.', steps: [
    E('views', '[data-view="split"]', 'Plan, Split and 3D change the view. Split shows both at once.'),
    E('dock', '[data-ps="commercial-dock"]', 'The commercial panel sets zone class, buildings, rows and units.'),
    E('add', '[data-ps="add-building"]', 'Add building puts another building on the lot.'),
    E('rerun', '[data-ps="rerun-site-layout"]', 'Re-run car park layout redraws the car park after you move a building. Areas you drew are kept.'),
  ] },
  { id: 'planset', title: 'Plan set', blurb: 'Save the layout, get the plan set or send it to an engineer.', steps: [
    E('save', '[data-action="profile-save"]', 'Save design keeps the layout in your profile. No payment needed.'),
    E('pdf', '[data-ps="cc-planset"]', 'The plan set button builds the PDF for this layout.', { openCard: true }),
    E('engineer', '[data-ps="lc-send-engineer"]', 'Send to engineer passes the layout to a registered engineer.'),
  ] },
];

const BASICS = {
  residential: { id: BASICS_ID, title: 'Basics', blurb: 'A quick tour of the whole tool, start to finish.', steps: RESIDENTIAL_TUTORIAL },
  commercial: { id: BASICS_ID, title: 'Basics', blurb: 'A quick tour of the whole tool, start to finish.', steps: COMMERCIAL_TUTORIAL },
};
const freeze = (list) => Object.freeze(list.map((c) => Object.freeze({ ...c, steps: Object.freeze(c.steps) })));

/** Every chapter of a mode, Basics first. Each carries the name of its how to video (file name without extension). */
export const CHAPTERS = Object.freeze({
  residential: freeze([BASICS.residential, ...CHAPTERS_RESIDENTIAL].map((c) => ({ ...c, video: c.id === BASICS_ID ? 'residential-overview' : `residential-${c.id}` }))),
  commercial: freeze([BASICS.commercial, ...CHAPTERS_COMMERCIAL].map((c) => ({ ...c, video: c.id === BASICS_ID ? 'commercial-overview' : `commercial-${c.id}` }))),
});
export const chaptersFor = (kind) => (kind === 'commercial' ? CHAPTERS.commercial : CHAPTERS.residential);
export const chapterById = (kind, id) => chaptersFor(kind).find((c) => c.id === id) || null;
export const VIDEO_BASE = '/help/videos/';
export const videoUrl = (chapter) => `${VIDEO_BASE}${chapter.video}.mp4`;
export const posterUrl = (chapter) => `${VIDEO_BASE}${chapter.video}.jpg`;

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
export const CHAPTERS_KEY = 'gi.tutorial.chapters';
/** Chapters finished in this browser, as { 'residential:place': true }. Never throws when storage is blocked. */
export function readChapters(storage) {
  try { const v = JSON.parse(store(storage)?.getItem(CHAPTERS_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export const chapterDone = (kind, id, storage) => !!readChapters(storage)[`${kind}:${id}`];
export function markChapter(kind, id, done = true, storage) {
  try {
    const st = store(storage); if (!st) return false;
    const all = readChapters(st);
    if (done) all[`${kind}:${id}`] = true; else delete all[`${kind}:${id}`];
    st.setItem(CHAPTERS_KEY, JSON.stringify(all));
    return true;
  } catch { return false; }
}
/** How many chapters of a mode are done: { done, total }. */
export const chapterProgress = (kind, storage) => { const all = chaptersFor(kind); return { done: all.filter((c) => chapterDone(kind, c.id, storage)).length, total: all.length }; };

/** Starts by default on the first visit of a mode; never again after it was finished or skipped. */
export const shouldStartTutorial = (kind, storage) => readTutorial(kind, storage) === null;

/** The first tutorial step that lives in guided flow step `n` (null when there is none). */
export const stepIndexForFlow = (steps, n) => { const i = steps.findIndex((s) => s.where === 'flow' && s.flowStep === n); return i < 0 ? null : i; };
