// Design summary shown when nothing is selected: project and level settings, area schedules,
// extension totals, door and window schedule and soft warnings.

import { ROOF_TYPES } from '../model/schema.js';
import { hasExtensionContent } from '../editor2d/math.js';
import { areaSchedule, extensionTotals, openingSchedule, computeWarnings, roofPlanAreaM2, OPENING_LABELS, STYLE_LABELS } from './schedules.js';
import { setNorth } from '../editor2d/edit.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { numberField, textField, selectField, checkField, button, section, formBuilder, presetChips } from './panel-forms.js';
import { WALL_PRESETS } from './wall-presets.js';
import { openTitleBlockForm } from './titleblock.js';
import { DRAWING_SCALES, PAPER_SIZES } from '../model/schema.js';
import { deleteLevelWithConfirm } from './level-actions.js';
import { DESIGN_TYPES, designTypeOf, changeDesignType } from './design-type.js';

const ROOF_LABEL = { hip: 'Hip', gable: 'Gable', skillion: 'Skillion', flat: 'Flat' };
const m2 = (v) => `${v.toFixed(2)} m²`;

export function buildSummary(ctx) {
  const { store } = ctx;
  const fb = formBuilder();
  const level = () => store.level();
  const root = h('div', { class: 'ps-form' });

  // Design type: swaps the design for a generic template of that type after an in-page confirmation (one undo step).
  function designTypeField() {
    const extension = () => designTypeOf(store.project) === 'extension';
    const options = [...DESIGN_TYPES.map((d) => [d.id, d.label]), ...(extension() ? [['extension', 'Extension']] : [])];
    const field = selectField({
      label: 'Design type', options, get: () => designTypeOf(store.project),
      commit: (v) => {
        changeDesignType(store, v, ctx.catalogue).then(() => field.refresh());
      },
    });
    field.select.dataset.action = 'design-type';
    return fb.add(field);
  }

  // Design and level settings (kept in place so typing is never interrupted) ------------------------------
  const design = section('Design');
  design.append(
    designTypeField(),
    fb.add(numberField({
      label: 'North', unit: '°', min: 0, max: 359, get: () => store.project.site.northDeg,
      commit: (n) => ctx.apply('Set north', (p) => setNorth(p, n)),
    })),
  );

  // Default wall thickness. Walls without their own thickness follow these (set_wall_defaults).
  const walls = section('Wall thickness');
  const wallRow = (label, key, field) => {
    const num = numberField({ label, min: 50, max: field === 'internal' ? 400 : 600, step: 10, get: () => store.project.settings[key], commit: (n) => ctx.run('set_wall_defaults', { [field]: n }) });
    const chips = presetChips({ label: `${label} wall presets`, values: WALL_PRESETS, get: () => store.project.settings[key], commit: (n) => ctx.run('set_wall_defaults', { [field]: n }) });
    walls.append(fb.add(num), h('div', { class: 'ps-field ps-field--chips' }, h('span', { class: 'ps-field-label' }, 'Presets'), fb.add(chips)));
  };
  wallRow('External', 'extWall', 'external');
  wallRow('Internal', 'intWall', 'internal');
  walls.append(h('p', { class: 'ps-hint' }, 'Applies to every wall that has not been given its own thickness. Select a wall to set it on its own.'));

  // Drawing setup for exported plan sheets: scale, paper and the title block form.
  const drawing = section('Drawings');
  const scaleLabel = (v) => (v === 'auto' ? 'Auto' : `1:${v}`);
  drawing.append(
    fb.add(selectField({ label: 'Scale', options: DRAWING_SCALES.map((v) => [v, scaleLabel(v)]), get: () => store.project.drawing?.scale ?? 'auto', commit: (v) => ctx.run('set_drawing', { scale: v }) })),
    fb.add(selectField({ label: 'Paper', options: PAPER_SIZES.map((v) => [v, v]), get: () => store.project.drawing?.paper ?? 'A3', commit: (v) => ctx.run('set_drawing', { paper: v }) })),
    h('div', { class: 'ps-field ps-field--chips' }, h('span', { class: 'ps-field-label' }, 'Sheet details'),
      h('button', { class: 'ps-btn', type: 'button', dataset: { action: 'title-block' }, onclick: () => openTitleBlockForm(store) }, icon('plan', { size: 16 }), 'Title block')),
    h('p', { class: 'ps-hint' }, 'Auto picks the largest scale that fits the plan on the paper.'));

  const lv = section('Level');
  const levelBlock = h('div');
  lv.append(levelBlock);
  let builtFor = null;
  const levelKey = () => `${level().id}|${store.project.levels.length}`;
  function buildLevelForm() {
    clear(levelBlock);
    const id = level().id;
    builtFor = levelKey();
    const lfb = formBuilder();
    const add = (f) => levelBlock.append(lfb.add(f));
    add(textField({ label: 'Name', maxlength: 40, get: () => level().name, commit: (v) => ctx.run('update_level', { id, name: v }) }));
    add(numberField({ label: 'Ceiling', min: 2100, max: 8000, step: 50, get: () => level().height, commit: (n) => ctx.run('update_level', { id, ceiling_height: n }) }));
    if (level().elevation !== 0 || store.project.levels.length > 1) {
      add(numberField({ label: 'Floor level', min: -5000, max: 30000, step: 50, get: () => level().elevation, commit: (n) => ctx.run('update_level', { id, elevation: n }) }));
    }
    add(checkField({ label: 'Roof on this level', get: () => level().roof.enabled !== false, commit: (v) => ctx.run('set_roof', { level: id, enabled: v }) }));
    add(selectField({ label: 'Roof type', options: ROOF_TYPES.map((t) => [t, ROOF_LABEL[t]]), get: () => level().roof.type, commit: (v) => ctx.run('set_roof', { level: id, type: v }) }));
    add(numberField({ label: 'Pitch', unit: '°', min: 1, max: 60, step: 0.5, decimals: 1, get: () => level().roof.pitch, commit: (n) => ctx.run('set_roof', { level: id, pitch: n }) }));
    add(numberField({ label: 'Eaves', min: 0, max: 1500, step: 50, get: () => level().roof.overhang, commit: (n) => ctx.run('set_roof', { level: id, overhang: n }) }));
    if (store.project.levels.length > 1) {
      levelBlock.append(h('div', { class: 'ps-sec', style: { marginTop: '6px' } },
        button('Delete this level', () => deleteLevelWithConfirm(store, id), { cls: 'ps-btn--danger', icon: icon('trash', { size: 16 }) })));
    }
    levelBlock.refresh = () => lfb.refresh();
  }

  // Tables --------------------------------------------------------------------------------------------------------
  const dyn = h('div');
  const pick = (levelId, id) => {
    if (store.ui.activeLevelId !== levelId) store.setUI({ activeLevelId: levelId });
    store.select(id);
  };

  function areasSection() {
    const sched = areaSchedule(store.project);
    const sec = section('Rooms and areas');
    for (const l of sched) {
      const block = h('div', { class: 'ps-level-block' });
      if (sched.length > 1) block.append(h('h4', null, l.name));
      if (!l.rooms.length) block.append(h('p', { class: 'ps-hint' }, 'No rooms on this level yet.'));
      else {
        const t = h('table', { class: 'ps-table' }, h('thead', null, h('tr', null, h('th', null, 'Room'), h('th', { class: 'num' }, 'Area'))));
        const body = h('tbody');
        for (const r of l.rooms) {
          body.append(h('tr', { class: 'clickable', tabindex: '0', onclick: () => pick(l.levelId, r.id), onkeydown: (e) => { if (e.key === 'Enter') pick(l.levelId, r.id); } },
            h('td', null, r.name, r.status !== 'new' ? h('span', { class: 'ps-tag', style: { marginLeft: '6px' } }, r.status) : null),
            h('td', { class: 'num' }, m2(r.area))));
        }
        const total = (label, v) => v > 0.004 && body.append(h('tr', { class: 'total' }, h('td', null, label), h('td', { class: 'num' }, m2(v))));
        total('Indoor floor area', l.indoor);
        total('Garage', l.garage);
        total('Outdoor', l.outdoor);
        t.append(body);
        block.append(t);
      }
      sec.append(block);
    }
    if (sched.length > 1) {
      const all = sched.reduce((s, l) => s + l.indoor, 0);
      sec.append(h('table', { class: 'ps-table' }, h('tbody', null, h('tr', { class: 'total' }, h('td', null, 'Indoor, all levels'), h('td', { class: 'num' }, m2(all))))));
    }
    return sec;
  }

  function extensionSection() {
    if (store.project.type !== 'extension' && !hasExtensionContent(store.project)) return null;
    const t = extensionTotals(store.project);
    return section('Extension floor areas', h('table', { class: 'ps-table' }, h('tbody', null,
      h('tr', null, h('td', null, 'Existing'), h('td', { class: 'num' }, m2(t.existing))),
      h('tr', null, h('td', null, 'New'), h('td', { class: 'num' }, m2(t.new))),
      h('tr', null, h('td', null, 'Demolish'), h('td', { class: 'num' }, m2(t.demolish))))));
  }

  function scheduleSection() {
    const rows = openingSchedule(store.project);
    const sec = section('Door and window schedule');
    if (!rows.length) {
      sec.append(h('p', { class: 'ps-hint' }, 'No doors or windows yet.'));
      return sec;
    }
    const body = h('tbody');
    for (const r of rows) {
      const type = r.kind === 'window' ? `Window, ${(STYLE_LABELS[r.style] || r.style || '').toLowerCase()}` : OPENING_LABELS[r.kind];
      body.append(h('tr', null,
        h('td', { class: 'ps-mono' }, r.mark),
        h('td', null, type, r.kind === 'window' ? h('div', { class: 'ps-mono', style: { fontSize: '11px', color: 'var(--ps-muted)' } }, `sill ${r.sill}`) : null),
        h('td', { class: 'num' }, `${r.width} × ${r.height}`),
        h('td', { class: 'num' }, r.count)));
    }
    sec.append(h('table', { class: 'ps-table' }, h('thead', null, h('tr', null, h('th', null, 'Mark'), h('th', null, 'Type'), h('th', { class: 'num' }, 'Size'), h('th', { class: 'num' }, 'Qty'))), body));
    return sec;
  }

  function warningsSection() {
    const warns = computeWarnings(store.project, { catalogue: ctx.catalogue });
    const sec = section('Checks');
    if (!warns.length) {
      sec.append(h('div', { class: 'ps-ok-note' }, icon('check', { size: 16 }), 'No overlaps, stray openings, unreachable rooms or furniture clipping walls found.'));
      return sec;
    }
    const list = h('div', { class: 'ps-warns' });
    for (const w of warns) list.append(h('button', { class: 'ps-warn', type: 'button', onclick: () => pick(w.levelId, w.target) }, icon('warning', { size: 16 }), w.message));
    sec.append(list, h('p', { class: 'ps-hint', style: { marginTop: '6px' } }, 'These are reminders only. They do not stop you working.'));
    return sec;
  }

  function roofSection() {
    const area = roofPlanAreaM2(store.project);
    if (!area) return null;
    return section('Roof', h('table', { class: 'ps-table' }, h('tbody', null, h('tr', null, h('td', null, 'Roof area on plan, with eaves (approx.)'), h('td', { class: 'num' }, m2(area))))));
  }

  function renderTables() {
    clear(dyn);
    dyn.append(...[areasSection(), extensionSection(), scheduleSection(), roofSection(), warningsSection()].filter(Boolean));
  }

  root.append(design, walls, drawing, lv, dyn);
  buildLevelForm();
  fb.refresh();
  renderTables();
  return {
    el: root,
    refresh() {
      if (builtFor !== levelKey()) buildLevelForm();
      fb.refresh();
      levelBlock.refresh?.();
      renderTables();
    },
  };
}
