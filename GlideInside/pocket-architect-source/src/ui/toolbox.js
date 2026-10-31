// Left toolbox: one button per tool, with a key hint. Becomes a bottom bar on narrow screens (CSS).

import { h } from './dom.js';
import { icon } from './icons.js';
import { TOOL_DEFS } from '../editor2d/tools-meta.js';
import { setTool } from './toolstate.js';

const GROUPS = [['select'], ['room', 'wall', 'door', 'window'], ['furniture', 'stairs', 'deck', 'tank'], ['measure', 'underlay', 'status']];

// Options: onWheel() opens the inventory wheel from the button at the foot of the toolbox (for touch, where Q is not available).
export function createToolbox(el, store, { onWheel } = {}) {
  const buttons = new Map();
  const byId = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));
  GROUPS.forEach((ids, gi) => {
    if (gi > 0) el.append(h('span', { class: 'ps-tool-sep', role: 'separator', 'aria-orientation': 'horizontal' }));
    for (const id of ids) {
      const def = byId[id];
      const btn = h('button', {
        class: 'ps-tool',
        type: 'button',
        title: `${def.label} (${def.key})`,
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
    for (const def of TOOL_DEFS) {
      const on = def.id === tool || !!def.family?.includes(tool);
      buttons.get(def.id)?.setAttribute('aria-pressed', String(on));
    }
  }
  const off = store.on('ui', (patch = {}) => {
    if ('tool' in patch) sync();
  });
  sync();
  return { sync, dispose: off };
}
