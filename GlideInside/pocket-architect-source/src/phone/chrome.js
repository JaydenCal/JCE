// The phone editor's chrome: a bottom dock (Tools, Plan or 3D, Export, Details, Menu), a tools sheet, a quick move and turn bar for Move house,
// the Share button that appears once the design is saved, and the "Phone view" pill when Desktop view is on. Everything is hidden by CSS
// unless html[data-phone="1"], so the desktop layout is untouched.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setTool } from '../ui/toolstate.js';
import { hasPlan } from '../ui/view-mode.js';
import { TOOL_DEFS } from '../editor2d/tools-meta.js';
import { canMoveHouse } from '../editor2d/tool-movehouse.js';
import { houseCentre } from '../model/placement.js';
import { moveHouseBy, turnHouseBy } from '../site/site-items.js';
import { openSheet } from './sheet.js';
import { openExportSheet } from './export-entry.js';
import { buildMenuExtras } from './menu-extras.js';
import { showHintOnce } from './hint.js';
import { phoneApi, onPhoneChange, isPhoneMode } from './mode.js';
import { onSaveState, shareDesign, isSaved } from './actions.js';
import { track } from '../ui/analytics.js';
import { writeFlow } from '../flow/state.js';

// The five tools the phone leads with, then the rest behind "More tools".
export const MAIN_TOOLS = [['movehouse', 'Move house', 'Drag the house on the lot'], ['rotate', 'Rotate', 'Turn what you select'], ['room', 'Rooms', 'Draw or change rooms'], ['drivepi', 'Driveway', 'Bend and place the driveway'], ['furniture', 'Furniture', 'Add furniture to a room']];
export const MORE_TOOLS = ['select', 'wall', 'door', 'window', 'stairs', 'deck', 'tank', 'existing', 'pave', 'measure'];

const label = (id) => TOOL_DEFS.find((t) => t.id === id)?.label || id;
const iconOf = (id) => TOOL_DEFS.find((t) => t.id === id)?.icon || id;

export function createPhoneChrome({ store, refs, editor = null, openMore = () => {} }) {
  const dockBtn = (ps, ic, text, onClick) => h('button', { class: 'ps-dock-btn', type: 'button', dataset: { ps }, onclick: onClick }, icon(ic, { size: 22 }), h('span', null, text));
  // After the simple phone path (project.flow.phoneSimple) the advanced tools stay out of the way: this button reads Full editor and
  // opens the whole toolbox once tapped. Anywhere else it is the Tools button, as ever.
  const simple = () => isPhoneMode() && store.project?.flow?.phoneSimple === true;
  const toolsBtn = dockBtn('dock-tools', 'movehouse', 'Tools', () => {
    if (!simple()) { openTools(); return; }
    track('phone_full_editor', { from: 'editor' });
    writeFlow(store, { phoneSimple: false });
  });
  const viewBtn = dockBtn('dock-view', 'cube', '3D', () => store.setUI({ view: hasPlan(store.ui.view) ? '3d' : '2d' }));
  const detailsBtn = dockBtn('dock-details', 'info', 'Details', () => { refs.panel.dataset.open = refs.panel.dataset.open === 'true' ? 'false' : 'true'; syncDock(); });
  const exportBtn = dockBtn('dock-export', 'save', 'Export', () => openExportSheet());
  // Menu: the pieces that used to float over the 3D view (room tour, top view, Edit room, design switcher, lot label ...) are listed first, then the usual menu.
  const popOf = () => refs.topbar.querySelector('[data-ps="topbar-more-menu"]');
  const closeMenu = () => { const pop = popOf(); if (pop && !pop.hidden) refs.topbar.querySelector('[data-ps="topbar-more"]')?.click(); };
  const menuBtn = dockBtn('dock-menu', 'more', 'Menu', () => {
    const pop = popOf();
    if (pop) { pop.querySelector('.ps-pme')?.remove(); if (pop.hidden) pop.prepend(buildMenuExtras({ store, close: closeMenu })); }
    openMore();
  });
  const dock = h('nav', { class: 'ps-dock', 'aria-label': 'Design tools', dataset: { ps: 'phone-dock' } }, toolsBtn, viewBtn, exportBtn, detailsBtn, menuBtn);
  refs.shell.append(dock);

  // Move house: big nudge and turn buttons over the bottom of the plan.
  const nudge = (dx, dy) => store.apply('Move house', (p) => { moveHouseBy(p, dx, dy); });
  const turn = (deg) => store.apply('Rotate house', (p) => { turnHouseBy(p, deg, houseCentre(p)); });
  const qb = (aria, text, fn, ps) => h('button', { class: 'ps-quick-btn', type: 'button', 'aria-label': aria, title: aria, dataset: { ps }, onclick: fn }, text);
  const quick = h('div', { class: 'ps-quick', role: 'group', 'aria-label': 'Move and turn the house', hidden: true, dataset: { ps: 'phone-quick' } },
    qb('Nudge left', '←', () => nudge(-500, 0), 'quick-left'), qb('Nudge up', '↑', () => nudge(0, -500), 'quick-up'), qb('Nudge down', '↓', () => nudge(0, 500), 'quick-down'), qb('Nudge right', '→', () => nudge(500, 0), 'quick-right'),
    qb('Turn left 15 degrees', '↺', () => turn(-15), 'quick-turn-left'), qb('Turn right 15 degrees', '↻', () => turn(15), 'quick-turn-right'));
  refs.stage.append(quick);

  // Share: appears next to Save design once the design is saved to the profile.
  const shareBtn = h('button', { class: 'ps-btn ps-btn--icon ps-phone-share', type: 'button', hidden: true, title: 'Send the design link to yourself', 'aria-label': 'Share design link', dataset: { ps: 'phone-share' }, onclick: () => shareDesign() }, icon('link', { size: 20 }), h('span', { class: 'ps-phone-share-t' }, 'Share'));
  const placeShare = () => {
    if (shareBtn.isConnected) return;
    const save = refs.topbar.querySelector('[data-action="profile-save"]');
    if (save) save.after(shareBtn);
  };

  // The way back from Desktop view.
  const phoneView = h('button', { class: 'ps-phone-view', type: 'button', hidden: true, dataset: { ps: 'phone-view-pill' }, onclick: () => phoneApi()?.setDesktopView(false) }, 'Phone view');
  document.body.append(phoneView);

  function syncDock() {
    const v = store.ui.view;
    const plan = hasPlan(v);
    viewBtn.replaceChildren(icon(plan ? 'cube' : 'plan', { size: 22 }), h('span', null, plan ? '3D' : 'Plan'));
    viewBtn.setAttribute('aria-label', plan ? 'Show the 3D view' : 'Back to the plan');
    detailsBtn.setAttribute('aria-pressed', String(refs.panel.dataset.open === 'true'));
    const tool = store.ui.tool;
    toolsBtn.replaceChildren(icon(plan && !simple() ? iconOf(tool || 'movehouse') : 'movehouse', { size: 22 }), h('span', null, simple() ? 'Full editor' : 'Tools'));
    refs.shell.dataset.phoneSimple = simple() ? '1' : '0';
    quick.hidden = !(isPhoneMode() && plan && v !== 'split' && tool === 'movehouse' && canMoveHouse(store.project));
  }
  function syncShare() {
    placeShare();
    shareBtn.hidden = !isSaved();
  }

  function openTools() {
    let sheet = null;
    const pick = (id) => () => { sheet?.close(); setTool(store, id); if (id === 'furniture') store.emit('plan:open-drawer'); };
    const tile = (id, text, hint) => h('button', { class: 'ps-tool-tile', type: 'button', 'aria-pressed': String(store.ui.tool === id), dataset: { ps: `tool-${id}` }, onclick: pick(id) }, icon(iconOf(id), { size: 28 }), h('b', null, text), hint ? h('small', null, hint) : null);
    const more = h('div', { class: 'ps-tool-grid ps-tool-grid--more', hidden: true }, ...MORE_TOOLS.map((id) => tile(id, label(id).replace('Edit (select)', 'Edit and select'))));
    const moreBtn = h('button', { class: 'ps-sheet-item', type: 'button', 'aria-expanded': 'false', dataset: { ps: 'tools-more' }, onclick: () => { more.hidden = !more.hidden; moreBtn.setAttribute('aria-expanded', String(!more.hidden)); moreBtn.querySelector('b').textContent = more.hidden ? 'More tools' : 'Fewer tools'; } }, h('span', { class: 'ps-sheet-item-t' }, h('b', null, 'More tools')));
    sheet = openSheet({ title: 'Tools', id: 'tools-sheet', body: h('div', null, h('div', { class: 'ps-tool-grid' }, ...MAIN_TOOLS.map(([id, t, hint]) => tile(id, t, hint))), moreBtn, more) });
  }

  let lastView = store.ui.view;
  const offs = [
    store.on('ui', () => { syncDock(); if (store.ui.view !== lastView) { lastView = store.ui.view; if (lastView === '3d' && isPhoneMode()) setTimeout(() => { if (store.ui.view === '3d' && refs.shell.dataset.flow === 'editor' && ![...document.querySelectorAll('.gf-root')].some((e) => e.offsetParent)) showHintOnce({ host: refs.stage }); }, 700); } }),
    store.on('project', syncDock),
    onSaveState(syncShare),
    onPhoneChange(() => { syncDock(); syncDesktopPill(); }),
  ];
  new MutationObserver(syncDock).observe(refs.panel, { attributes: true, attributeFilter: ['data-open'] });
  // The plan was laid out while hidden behind the flow: frame the house when the editor appears and when the window changes shape.
  const frame = () => { if (isPhoneMode() && hasPlan(store.ui.view)) setTimeout(() => { try { (editor?.zoomToBuilding || editor?.zoomToFit)?.call(editor); } catch { /* the plan keeps its view */ } }, 250); };
  new MutationObserver(() => { syncDock(); frame(); }).observe(refs.shell, { attributes: true, attributeFilter: ['data-flow'] });
  globalThis.addEventListener?.('orientationchange', frame);
  offs.push(onPhoneChange(frame));
  function syncDesktopPill() { phoneView.hidden = !(document.documentElement.dataset.desktopView === '1' && (globalThis.matchMedia?.('(pointer: coarse)').matches)); }
  syncDock(); syncShare(); syncDesktopPill();
  setTimeout(syncShare, 900);
  return { dock, quick, shareBtn, openTools, sync: () => { syncDock(); syncShare(); }, dispose() { offs.forEach((o) => o?.()); dock.remove(); quick.remove(); shareBtn.remove(); phoneView.remove(); } };
}

