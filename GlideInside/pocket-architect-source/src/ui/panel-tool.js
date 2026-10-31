// Tool settings shown in the right panel while a drawing tool is armed.

import { DOOR_FAMILY, KIND_LABEL, DECK_TYPES, STATUS_LABEL, OPENING_TOOL_KIND, toolLabel } from '../editor2d/tools-meta.js';
import { getPresets, activePreset, tankChoices } from '../editor2d/presets.js';
import { setTool, setToolArg } from './toolstate.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { button, segmented, numberField, checkField, section, formBuilder } from './panel-forms.js';
import { drawItemPreview } from './preview.js';

function helpCard(title, lines) {
  return h('div', null, h('div', { class: 'ps-sel-title' }, h('strong', null, title)), h('ul', { class: 'ps-hint', style: { paddingLeft: '18px', margin: '0 0 10px' } }, lines.map((l) => h('li', { style: { marginBottom: '3px' } }, l))));
}

const radio = (selected, onclick, ...kids) => h('button', { class: 'ps-radio', type: 'button', 'aria-pressed': String(selected), onclick }, ...kids);

export function buildToolPanel(ctx, tool) {
  const { store, editor } = ctx;
  const fb = formBuilder();
  const root = h('div', { class: 'ps-form' });
  const body = h('div');
  root.append(body);
  const redo = () => {
    clear(body);
    render();
  };

  function openingPanel() {
    const kind = OPENING_TOOL_KIND[tool];
    body.append(h('div', { class: 'ps-sel-title' }, h('strong', null, `Place ${KIND_LABEL[kind].toLowerCase()}`)));
    if (DOOR_FAMILY.includes(tool)) {
      const seg = segmented({
        label: 'Door type',
        options: [['door', 'Single'], ['sliding_door', 'Sliding'], ['garage_door', 'Garage'], ['roller_door', 'Roller'], ['opening', 'Opening']],
        get: () => store.ui.tool,
        commit: (v) => setTool(store, v),
      });
      body.append(h('div', { class: 'ps-sec' }, h('div', { class: 'ps-sec-title' }, 'Type'), seg.el));
      fb.add(seg);
    }
    const presets = getPresets(ctx.catalogue, kind);
    const armed = activePreset(ctx.catalogue, kind, store.ui.toolArg);
    const list = h('div', { class: 'ps-radio-row' });
    for (const p of presets) {
      list.append(radio(p.id === armed.id, () => setToolArg(store, p.id),
        h('span', { style: { flex: 1 } }, p.name),
        h('span', { class: 'ps-mono', style: { fontSize: '12px', color: 'var(--ps-muted)' } }, `${p.width} × ${p.height}`)));
    }
    body.append(section('Size', list));
    body.append(h('ul', { class: 'ps-hint', style: { paddingLeft: '18px' } },
      h('li', null, 'Move over a wall to preview. Click to place.'),
      h('li', null, 'Red means it overlaps or does not fit.'),
      kind === 'door' ? h('li', null, 'Tab flips the swing. Shift and Tab flips the hinge.') : null,
      h('li', null, 'Hold Alt to ignore snapping.')));
  }

  function furniturePanel() {
    const def = store.ui.toolArg ? ctx.catalogue?.getFurniture?.(store.ui.toolArg) : null;
    body.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Furniture')));
    if (def) {
      const c = h('canvas', { width: 96, height: 96, 'aria-hidden': 'true' });
      body.append(h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px' } }, c,
        h('div', null, h('div', { style: { fontWeight: 600 } }, def.name), h('div', { class: 'ps-mono', style: { fontSize: '12px', color: 'var(--ps-muted)' } }, `${def.w} × ${def.d} mm`))));
      drawItemPreview(c, def, 84);
    } else body.append(h('p', { class: 'ps-hint' }, 'No item chosen yet.'));
    body.append(h('div', { class: 'ps-row', style: { marginBottom: '10px' } },
      button('Choose item', () => store.emit('plan:open-drawer'), { cls: 'ps-btn--primary' }),
      button('Stop placing', () => setTool(store, 'select'))));
    body.append(h('ul', { class: 'ps-hint', style: { paddingLeft: '18px' } },
      h('li', null, 'Click the plan to place. Keep clicking to place more.'),
      h('li', null, 'Comma and full stop rotate 90 degrees. Add Shift for 15 degrees, or hold Shift and scroll.'),
      h('li', null, 'Hold Q for the inventory wheel to pick another item without leaving the plan.')));
  }

  function tankPanel() {
    body.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Rainwater tank')));
    const cap = Number(store.ui.toolArg) || 5000;
    const list = h('div', { class: 'ps-radio-row' });
    for (const t of tankChoices(ctx.catalogue)) {
      list.append(radio(t.capacityL === cap, () => setToolArg(store, t.capacityL),
        h('span', { style: { flex: 1 } }, t.name),
        h('span', { class: 'ps-mono', style: { fontSize: '12px', color: 'var(--ps-muted)' } }, `Ø${t.diameter} × ${t.height}`)));
    }
    body.append(section('Capacity', list));
    body.append(h('p', { class: 'ps-hint' }, 'Click the plan to place a tank. Select it later to see the roof area on plan.'));
  }

  function deckPanel() {
    body.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Deck or patio')));
    const seg = segmented({ label: 'Outdoor type', options: DECK_TYPES, get: () => (DECK_TYPES.some((d) => d[0] === store.ui.toolArg) ? store.ui.toolArg : 'deck'), commit: (v) => setToolArg(store, v) });
    fb.add(seg);
    body.append(section('Type', seg.el), h('ul', { class: 'ps-hint', style: { paddingLeft: '18px' } },
      h('li', null, 'Drag a rectangle. Outdoor areas have no walls.'),
      h('li', null, 'Alfresco and verandah sit under the main roof.'),
      h('li', null, 'Balustrade and roofing are set when the area is selected.')));
  }

  function statusPanel() {
    body.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Status brush')));
    const cur = ['new', 'existing', 'demolish'].includes(store.ui.toolArg) ? store.ui.toolArg : 'existing';
    const list = h('div', { class: 'ps-radio-row' });
    for (const s of ['existing', 'new', 'demolish']) {
      list.append(radio(s === cur, () => setToolArg(store, s), h('span', { class: `ps-swatch ps-swatch--${s}` }), h('span', null, STATUS_LABEL[s])));
    }
    body.append(section('Apply', list));
    body.append(h('div', { class: 'ps-sec' }, button('Mark everything as existing', () => {
      if (ctx.run('set_status', { ids: ['*'], status: 'existing' })) ctx.toast('Everything is now marked existing.', { kind: 'ok', action: { label: 'Undo', onClick: () => store.undo() } });
    }, { icon: icon('check', { size: 16 }) })));
    body.append(h('ul', { class: 'ps-hint', style: { paddingLeft: '18px' } },
      h('li', null, 'Click a wall to mark it and its openings.'),
      h('li', null, 'Click a room to mark it with its own walls.'),
      h('li', null, 'Drag across several to paint them in one step.'),
      h('li', null, 'Use the Existing, Proposed and Both switch in the top bar to check the result.')));
  }

  function underlayPanel() {
    const u = store.project.site?.underlay;
    const st = editor?.getUnderlayStatus?.() || {};
    body.append(h('div', { class: 'ps-sel-title' }, h('strong', null, 'Underlay')));
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true, 'aria-label': 'Choose underlay image' });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) editor?.uploadUnderlay(f);
    });
    body.append(input);
    // PDF import belongs to the Plan Pack. The premium module supplies importPdf when it is loaded.
    const pdfBtn = () => h('div', { class: 'ps-sec' }, h('button', { class: 'ps-btn ps-btn--block', type: 'button', dataset: { action: 'import-pdf' }, onclick: importPdf },
      icon('plan', { size: 16 }), 'Import PDF plan', h('span', { class: 'ps-badge' }, 'Plan Pack')));
    function importPdf() {
      const premium = window.__ps?.premium;
      if (premium && typeof premium.importPdf === 'function') {
        try {
          const res = premium.importPdf();
          if (res && typeof res.catch === 'function') res.catch((e) => ctx.toast(e?.message || 'That PDF could not be imported.', { kind: 'warn' }));
        } catch (e) {
          ctx.toast(e?.message || 'That PDF could not be imported.', { kind: 'warn' });
        }
      } else ctx.toast('PDF import comes with the Plan Pack.', { kind: 'info' });
    }
    if (!u) {
      body.append(h('p', { class: 'ps-hint' }, 'Upload a PNG or JPG of an existing plan, then trace over it. The image stays in this browser and is not part of the saved project file.'));
      body.append(h('div', { class: 'ps-sec' }, button('Upload image', () => input.click(), { cls: 'ps-btn--primary', icon: icon('underlay', { size: 16 }) })));
      body.append(pdfBtn());
      return;
    }
    if (st.missing) {
      body.append(h('div', { class: 'ps-confirm' }, h('span', null, 'This project has an underlay, but its image is not stored in this browser. Upload it again to continue tracing.')));
    }
    body.append(pdfBtn());
    const calibrating = !!editor?.isCalibrating?.();
    body.append(h('div', { class: 'ps-row', style: { marginBottom: '10px' } },
      button(st.missing ? 'Upload image' : 'Replace image', () => input.click(), { icon: icon('underlay', { size: 16 }) }),
      button(calibrating ? 'Cancel calibration' : 'Calibrate', () => (calibrating ? editor.cancelCalibration() : editor.startCalibration()), { cls: calibrating ? '' : 'ps-btn--primary', icon: icon('measure', { size: 16 }) })));
    body.append(h('p', { class: 'ps-hint' }, calibrating
      ? 'Click two points a known distance apart on the image, then type the true distance.'
      : 'Calibrate by clicking two points a known distance apart, then entering the true distance in millimetres.'));
    const setU = (label, fn) => ctx.apply(label, (p) => fn(p.site.underlay));
    const opacity = h('input', { class: 'ps-range', type: 'range', min: '5', max: '100', step: '1', 'aria-label': 'Underlay opacity' });
    opacity.value = String(Math.round((u.opacity ?? 0.5) * 100));
    const opacityLabel = h('span', { class: 'ps-readout' }, `${opacity.value}%`);
    opacity.addEventListener('input', () => {
      opacityLabel.textContent = `${opacity.value}%`;
      editor?.previewProject?.((p) => { p.site.underlay.opacity = Number(opacity.value) / 100; });
    });
    opacity.addEventListener('change', () => {
      editor?.clearPreview?.();
      setU('Underlay opacity', (x) => { x.opacity = Number(opacity.value) / 100; });
    });
    body.append(h('div', { class: 'ps-field' }, h('label', null, 'Opacity'), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, opacity, opacityLabel)));
    const lock = checkField({ label: 'Lock underlay in place', get: () => store.project.site.underlay?.locked, commit: (v) => setU(v ? 'Lock underlay' : 'Unlock underlay', (x) => { x.locked = v; }) });
    const rot = numberField({ label: 'Rotation', unit: '°', step: 0.1, decimals: 1, get: () => store.project.site.underlay?.rotation, commit: (n) => setU('Rotate underlay', (x) => { x.rotation = n; }) });
    body.append(fb.add(lock), fb.add(rot));
    body.append(h('p', { class: 'ps-hint ps-mono', style: { fontSize: '12px' } }, `Scale ${u.mmPerPx.toFixed(2)} mm per pixel. Image ${st.width || '?'} × ${st.height || '?'} px.`));
    body.append(h('div', { class: 'ps-sec' }, button('Remove underlay', () => editor?.removeUnderlay(), { cls: 'ps-btn--danger', icon: icon('trash', { size: 16 }) })));
  }

  function render() {
    if (tool in OPENING_TOOL_KIND) openingPanel();
    else if (tool === 'furniture') furniturePanel();
    else if (tool === 'tank') tankPanel();
    else if (tool === 'deck') deckPanel();
    else if (tool === 'status') statusPanel();
    else if (tool === 'underlay') underlayPanel();
    else if (tool === 'room') body.append(helpCard('Room', ['Drag a rectangle on the plan.', 'Then choose the room type and name.', 'Rooms that touch share their wall.', 'Hold Alt to ignore snapping.']));
    else if (tool === 'wall') body.append(helpCard('Wall', ['Click to start, click again for each corner.', 'Double click, Enter or Esc finishes.', 'Hold Shift to lock to 15 degree steps.', 'Type a length and press Enter to set it exactly.', 'Backspace removes the last wall.']));
    else if (tool === 'stairs') body.append(helpCard('Stairs', ['Drag a rectangle along the run, from the bottom step to the top.', 'Click once for a standard 1.0 by 3.6 m flight.', 'The arrow shows the way up.']));
    else if (tool === 'measure') body.append(helpCard('Measure', ['Click two points to read a distance.', 'Or right click anywhere on the plan to start, then click to finish.', 'Nothing is saved to the design.', 'Esc clears the measurement.']));
    else body.append(helpCard(toolLabel(tool), ['Press V to go back to Select.']));
  }

  render();
  // Tool panels rebuild fully when the armed option or project changes (they hold no typed text).
  return { el: root, refresh: redo, key: `tool:${tool}` };
}
