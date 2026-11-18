// Left toolbox: one button per tool, with a key hint. Becomes a bottom bar on narrow screens (CSS).

import { h } from './dom.js';
import { icon } from './icons.js';
import { TOOL_DEFS } from '../editor2d/tools-meta.js';
import { setTool } from './toolstate.js';

const GROUPS = [['movehouse', 'select'], ['room', 'wall', 'door', 'window'], ['furniture', 'stairs', 'deck', 'tank'], ['pave', 'drivepi'], ['hardstand', 'carpark'], ['measure', 'underlay', 'status']];

// Options: onWheel() opens the inventory wheel from the button at the foot of the toolbox (for touch, where Q is not available).
export function createToolbox(el, store, { onWheel } = {}) {
  const buttons = new Map();
  const byId = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));
  const seps = new Map(); // group index to its separator, so a commercial only group can hide with its separator
  GROUPS.forEach((ids, gi) => {
    if (gi > 0) { const sep = h('span', { class: 'ps-tool-sep', role: 'separator', 'aria-orientation': 'horizontal' }); seps.set(gi, sep); el.append(sep); }
    for (const id of ids) {
      const def = byId[id];
      const btn = h('button', {
        class: 'ps-tool',
        type: 'button',
        title: def.tip ? `${def.label} (${def.key}). ${def.tip}` : `${def.label} (${def.key})`,
        'aria-label': def.label,
        'aria-keyshortcuts': def.key,
        'aria-pressed': 'false',
        dataset: { tool: id },
        onclick: () => {
          setTool(store, id);
          if (id === 'furniture') store.emit('plan:open-drawer');
        },
      }, icon(def.icon, { size: 22 }), h('span', { class: 'ps-tool-key', 'aria-hidden': 'true' }, def.key));
      buttons.set(id, btn);
      el.append(btn);
    }
  });

  // Add another building from the type picker (amenities block, office, warehouse, workshop, canopy, car wash, shed, kiosk ...).
  const addBld = h('button', {
    class: 'ps-tool ps-tool--add', type: 'button', title: 'Add building', 'aria-label': 'Add building', hidden: true, dataset: { action: 'add-building-tool' },
    onclick: () => { if (store.project?.mode === 'commercial') import('../commercial/ui/add-building.js').then((m) => m.openAddBuilding({ store })); else import('./add-outbuilding.js').then((m) => m.openAddOutbuilding({ store })); },
  }, icon('plus', { size: 22 }), h('span', { class: 'ps-tool-key', 'aria-hidden': 'true' }, '+'));
  el.append(addBld);

  if (onWheel) {
    el.append(h('button', {
      class: 'ps-tool ps-tool--wheel', type: 'button', title: 'Inventory wheel (hold Q)', 'aria-label': 'Inventory wheel', 'aria-keyshortcuts': 'Q', dataset: { action: 'wheel' },
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onWheel({ x: r.right + 190, y: Math.min(r.top, window.innerHeight - 230) });
      },
    }, icon('wheel', { size: 22 }), h('span', { class: 'ps-tool-key', 'aria-hidden': 'true' }, 'Q')));
  }

  function sync() {
    const tool = store.ui.tool;
    addBld.hidden = false; // commercial: the building catalogue; residential: garages, sheds, carport, machinery shed and granny flat
    for (const def of TOOL_DEFS) {
      const comm = store.project?.mode === 'commercial';
      const on = def.id === tool || !!def.family?.includes(tool) || (comm && def.id === 'movehouse' && tool === 'commercial');
      const btn = buttons.get(def.id);
      btn?.setAttribute('aria-pressed', String(on));
      if (def.residentialOnly && btn) btn.hidden = comm; // Driveway PIs edit the residential driveway only
      if (def.commercialOnly && btn) btn.hidden = !comm; // Hardstand is drawn in commercial layouts only
      if (def.id === 'movehouse' && btn) {
        const label = comm ? 'Move buildings' : def.label;
        btn.title = `${label} (${def.key})`;
        btn.setAttribute('aria-label', label);
      }
    }
  }
  const syncSeps = () => GROUPS.forEach((ids, gi) => { const sep = seps.get(gi); if (sep) sep.hidden = ids.every((id) => byId[id]?.commercialOnly) && store.project?.mode !== 'commercial'; });
  const syncAll = () => { sync(); syncSeps(); };
  const off = store.on('ui', (patch = {}) => {
    if ('tool' in patch) syncAll();
  });
  const offProject = store.on('project', syncAll);
  syncAll();
  return { sync: syncAll, dispose: () => { off(); offProject(); } };
}
