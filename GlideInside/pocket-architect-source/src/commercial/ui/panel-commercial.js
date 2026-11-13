// The commercial dock: row list, parameter form (per row, with per unit overrides), site items, the checks list and the live stats
// strip. Shown only while the design is in commercial mode. Every change is one undo step (commercialEdit).

import { h, clear } from '../../ui/dom.js';
import { DOOR_PRESETS, FRONT_WINDOWS, REAR_WINDOWS, unitSpec, defaultUnit } from '../schema.js';
import { commercialEdit, isCommercial } from '../mode.js';
import { addRow, mirrorRow, deleteRow } from './row-ops.js';
import { analyse } from '../analyse.js';
import { effectiveClass, zoneClass, ZONE_CLASS_LABEL } from '../zones.js';
import { rowLength } from '../layout.js';
import { facts, NCC_CLASSES, PARKING_M2_PER_SPACE } from '../dataset.js';

const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, path, v) {
  const ks = path.split('.');
  let t = o;
  for (const k of ks.slice(0, -1)) t = t[k] ??= {};
  t[ks.at(-1)] = v;
}
/** The tooltip split of the parking figure: office area (ground office/amenity and mezzanine offices) at the office rate, the rest at the general rate, rounded once. */
const parkingSplitTip = (s) => {
  const p = s.parking;
  const per = (r) => Math.round(1 / r);
  if (!p.officeSplit) return `All ${s.gfaM2} m² GFA at 1 per ${per(p.ratePerM2)} m² = ${p.split.otherSpaces} spaces, rounded up once to ${p.required}. `;
  return `Office area ${p.split.officeM2} m² (ground office/amenity ${Math.round((s.officeM2 - s.officeMezzM2) * 10) / 10} m² plus mezzanine office ${s.officeMezzM2} m²) at 1 per ${per(p.officeRatePerM2)} m² = ${p.split.officeSpaces} spaces. Remaining GFA ${p.split.otherM2} m² at 1 per ${per(p.ratePerM2)} m² = ${p.split.otherSpaces} spaces. Rounded up once on the total (${p.split.officeSpaces} + ${p.split.otherSpaces}) to ${p.required}. `;
};
const m1 = (v) => (v / 1000).toFixed(1);
const ACCESS_FACT = { class_5: 'accessibleClass5', class_6: 'accessibleClass6', class_7: 'accessibleClass7', class_8: 'accessibleClass8' };

export function createCommercialPanel({ store, host, editor }) {
  const dock = h('aside', { class: 'cm-dock', hidden: true, 'aria-label': 'Commercial layout', dataset: { ps: 'commercial-dock' } });
  const strip = h('div', { class: 'cm-strip', hidden: true, role: 'status', 'aria-label': 'Layout summary', dataset: { ps: 'commercial-strip' } });
  host.append(dock, strip);
  let scope = 'all';
  let raf = 0;
  let wasOn = false;
  let open = { Doors: true, Unit: true };
  // At phone width the dock is a bottom sheet: collapsed to its title bar so the plan is visible, opened with the toggle. Wide screens ignore it.
  let sheetOpen = !(typeof matchMedia === 'function' && matchMedia('(max-width: 899.98px)').matches);
  const rowOf = () => { const c = store.project.commercial; return c?.rows.find((r) => r.id === store.ui.commercialRow) || c?.rows[0] || null; };

  // Field builders ------------------------------------------------------------------------------------------------------
  const field = (label, control, hint) => h('label', { class: 'cm-field' }, h('span', { class: 'cm-l' }, label), control, hint ? h('span', { class: 'cm-hint' }, hint) : null);
  const edit = (label, fn) => { try { commercialEdit(store, label, fn); } catch (e) { console.warn(e); } };

  function unitTarget(c) {
    const row = c.rows.find((r) => r.id === rowOf().id);
    if (scope === 'all') return row.unit;
    const k = Number(scope);
    row.perUnit[k] ??= {};
    return row.perUnit[k];
  }
  // The whole row shows the row's own settings (not unit 1 with its overrides); one unit shows its settings with its overrides.
  const unitValue = (path) => { const r = rowOf(); return getPath(scope === 'all' ? r.unit : unitSpec(r, Number(scope)), path); };

  const numField = (label, path, { unit = 'mm', min = 0, max = 1e6, step = 50, scale = 1, hint, disabled = false } = {}) => {
    const input = h('input', { type: 'number', min, max, step, disabled, value: Math.round(unitValue(path) / scale * 100) / 100, dataset: { path }, onchange: () => {
      const v = Math.min(max, Math.max(min, Number(input.value) || 0)) * scale;
      edit(`Set ${label.toLowerCase()}`, (c) => setPath(unitTarget(c), path, v));
    } });
    return field(label, h('span', { class: 'cm-in' }, input, h('i', null, unit)), hint);
  };
  const selField = (label, path, options) => {
    const sel = h('select', { dataset: { path }, onchange: () => {
      const raw = sel.value;
      const v = /^-?\d+(\.\d+)?$/.test(raw) && path !== 'doors.presetId' ? Number(raw) : raw;
      edit(`Set ${label.toLowerCase()}`, (c) => {
        const t = unitTarget(c);
        setPath(t, path, v);
        if (path === 'doors.presetId') { const p = DOOR_PRESETS.find((x) => x.id === v); if (p) { setPath(t, 'doors.widthMm', p.w); setPath(t, 'doors.heightMm', p.h); } }
      });
    } }, options.map(([val, text]) => h('option', { value: val }, text)));
    sel.value = String(unitValue(path));
    return field(label, sel);
  };
  const chkField = (label, path, hint) => {
    const input = h('input', { type: 'checkbox', checked: !!unitValue(path), dataset: { path }, onchange: () => edit(`Set ${label.toLowerCase()}`, (c) => setPath(unitTarget(c), path, input.checked)) });
    return h('label', { class: 'cm-chk' }, input, h('span', null, label), hint ? h('span', { class: 'cm-hint' }, hint) : null);
  };
  const siteNum = (label, get, set, { unit = '', min = 0, max = 1e6, step = 1, blank = false } = {}) => {
    const cur = get();
    const input = h('input', { type: 'number', min, max, step, value: cur == null ? '' : cur, placeholder: blank ? 'Auto' : null, dataset: { k: label }, onchange: () => {
      const raw = input.value;
      const v = raw === '' && blank ? null : Math.min(max, Math.max(min, Number(raw) || 0));
      edit(`Set ${label.toLowerCase()}`, (c) => set(c, v));
    } });
    return field(label, h('span', { class: 'cm-in' }, input, unit ? h('i', null, unit) : null));
  };
  const siteChk = (label, get, set) => {
    const input = h('input', { type: 'checkbox', checked: !!get(), dataset: { k: label }, onchange: () => edit(`Set ${label.toLowerCase()}`, (c) => set(c, input.checked)) });
    return h('label', { class: 'cm-chk' }, input, h('span', null, label));
  };
  function classField(c) {
    const sel = h('select', { dataset: { ps: 'ncc-class' }, title: facts(ACCESS_FACT[c.buildingClass] || 'accessibleClass8').tip, onchange: () => edit('Set NCC class', (cc) => { cc.buildingClass = sel.value; }) }, NCC_CLASSES.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = c.buildingClass || 'class_8';
    return field('NCC class (accessible bays)', sel, 'Indicative, verify against NCC Part D4');
  }
  function mrvField(c) {
    const v = c.vehicle || {};
    const input = h('input', { type: 'number', min: 3, max: 30, step: 0.1, value: v.turningRadiusM ?? '', placeholder: 'Not set', dataset: { ps: 'mrv-radius' }, title: facts('mrvRadius').tip, onchange: () => edit('Set MRV turning radius', (cc) => { cc.vehicle = { ...cc.vehicle, turningRadiusM: input.value === '' ? null : Number(input.value) }; }) });
    return field(`${v.code || 'MRV'} turning radius`, h('span', { class: 'cm-in' }, input, h('i', null, 'm')), `${v.lengthM} x ${v.widthM} m, verify the radius against AS 2890.2`);
  }
  // Drops the per unit overrides of the unit being edited, so it follows the row settings again. One undo step.
  const clearButton = (row) => {
    const k = Number(scope);
    const has = Object.keys((row.perUnit || {})[k] || {}).length > 0;
    return h('button', { type: 'button', class: 'cm-btn cm-clear', dataset: { action: 'clear-unit' }, disabled: !has, title: has ? 'Put this unit back to the row settings' : 'This unit has no changes of its own', onclick: () => edit(`Clear unit ${k + 1} changes`, (c) => { const r = c.rows.find((x) => x.id === row.id); if (r?.perUnit) delete r.perUnit[k]; }) }, `Clear this unit's changes`);
  };
  const section = (title, ...kids) => {
    const d = h('details', { class: 'cm-sec', open: open[title] === true, ontoggle: () => { open[title] = d.open; } }, h('summary', null, title), h('div', { class: 'cm-body' }, ...kids));
    return d;
  };

  // Render ---------------------------------------------------------------------------------------------------------------
  function render() {
    raf = 0;
    const p = store.project;
    const on = isCommercial(p);
    dock.hidden = !on;
    strip.hidden = !on;
    host.dataset.commercial = on ? '1' : '0';
    // Entering commercial mode from the split view goes to the plan: the dock would cover most of the half width plan, and the
    // parking, bays and bollards are drawn on the plan only at this stage. The person can still choose Split afterwards.
    if (on && !wasOn && store.ui.view === 'split') store.setUI({ view: '2d' });
    wasOn = on;
    if (!on) return;
    const c = p.commercial;
    const row = rowOf();
    const a = analyse(p);
    // The dock is rebuilt on every change: keep the scroll position and put the focus back on the same control, so tabbing through
    // the form and editing far down the list are not thrown back to the top.
    const keep = { top: dock.scrollTop, sel: null };
    const act = document.activeElement;
    if (act && dock.contains(act)) {
      const d = act.dataset || {};
      keep.sel = d.path ? `[data-path="${d.path}"]` : d.k ? `[data-k="${d.k}"]` : d.ps ? `[data-ps="${d.ps}"]` : null;
    }
    clear(dock);
    dock.dataset.sheet = sheetOpen ? 'open' : 'closed';
    host.dataset.sheet = sheetOpen ? 'open' : 'closed';
    // Header
    const z = zoneClass(p.site?.lot);
    const cls = effectiveClass(p);
    const lot = p.site?.lot;
    const zoneSel = h('select', { 'aria-label': 'Zone class', dataset: { ps: 'zone-class' }, onchange: () => edit('Set zone class', (cc) => { cc.zoneClass = zoneSel.value || null; }) },
      h('option', { value: '' }, z.employment ? `${ZONE_CLASS_LABEL[z.cls]} (from the zone)` : 'Choose the zone class'), h('option', { value: 'industrial' }, 'Industrial'), h('option', { value: 'commercial' }, 'Commercial'));
    zoneSel.value = c.zoneClass || '';
    dock.append(h('header', { class: 'cm-head' },
      h('div', { class: 'cm-title' }, h('b', null, h('span', { class: 'cm-full' }, 'Commercial and industrial layout'), h('span', { class: 'cm-short' }, 'Commercial layout')), h('span', { class: 'cm-beta' }, 'Beta'),
        h('button', { type: 'button', class: 'cm-sheet-toggle', dataset: { action: 'sheet-toggle' }, 'aria-expanded': String(sheetOpen), 'aria-label': sheetOpen ? 'Collapse the layout panel' : 'Open the layout panel', onclick: () => { sheetOpen = !sheetOpen; schedule(); } }, sheetOpen ? 'Hide' : 'Edit')),
      h('div', { class: 'cm-sub' }, lot ? `${lot.lotLabel || 'Lot'}${lot.zoning ? ` · ${lot.zoning.code || ''} ${lot.zoning.name || ''}` : ' · zone not looked up'}` : 'Find an address to place units on a lot'),
      h('label', { class: 'cm-field cm-stack' }, h('span', { class: 'cm-l' }, 'Zone class'), zoneSel)));
    // Rows
    const rowsBox = h('div', { class: 'cm-rows', role: 'tablist', 'aria-label': 'Rows' });
    c.rows.forEach((r, i) => {
      const n = r.mirrorOf ? c.rows.find((x) => x.id === r.mirrorOf)?.count : r.count;
      rowsBox.append(h('button', { type: 'button', role: 'tab', class: 'cm-chip', 'aria-selected': String(r.id === row?.id), dataset: { row: r.id }, onclick: () => { scope = 'all'; store.setUI({ commercialRow: r.id }); } }, `Row ${i + 1}${r.mirrorOf ? ' mirrored' : ''}`, h('i', null, `${n} units`)));
    });
    dock.append(rowsBox, h('div', { class: 'cm-actions' },
      h('button', { type: 'button', class: 'cm-btn', dataset: { action: 'add-row' }, onclick: () => addRow(store, row?.id) }, 'Add row'),
      h('button', { type: 'button', class: 'cm-btn', dataset: { action: 'mirror-row' }, disabled: !row || !!row.mirrorOf || c.rows.some((r) => r.mirrorOf === row?.id), title: 'Add a back to back row sharing the party wall', onclick: () => mirrorRow(store, row.id) }, 'Mirror row'),
      h('button', { type: 'button', class: 'cm-btn cm-danger', dataset: { action: 'delete-row' }, disabled: !row, onclick: () => deleteRow(store, row.id) }, 'Delete row')));
    if (row) {
      const mirrored = !!row.mirrorOf;
      const count = mirrored ? c.rows.find((r) => r.id === row.mirrorOf)?.count : row.count;
      const countInput = h('input', { type: 'number', min: 1, max: 40, step: 1, value: count, disabled: mirrored, dataset: { path: 'count' }, onchange: () => edit('Set units per row', (cc) => { cc.rows.find((r) => r.id === row.id).count = Math.max(1, Math.min(40, Math.round(Number(countInput.value) || 1))); }) });
      if (scope !== 'all' && !(Number(scope) < count)) scope = 'all';
      const scopeSel = h('select', { 'aria-label': 'Applies to', title: 'Which units the settings below change', dataset: { ps: 'unit-scope' }, onchange: () => { scope = scopeSel.value; schedule(); } }, h('option', { value: 'all' }, 'Whole row'),
        ...Array.from({ length: count }, (_, i) => h('option', { value: String(i) }, `Unit ${i + 1} only`)));
      scopeSel.value = scope;
      dock.append(
        field(`Units per row${mirrored ? ' (follows the first row)' : ''}`, h('span', { class: 'cm-in' }, countInput)),
        field('Settings apply to', scopeSel),
        ...(scope !== 'all' ? [clearButton(row)] : []),
        section('Unit',
          numField('Unit width', 'widthMm', { min: 2500, max: 30000, step: 100, disabled: mirrored, hint: mirrored ? 'Widths follow the row it mirrors' : null }),
          numField('Unit depth', 'depthMm', { min: 4000, max: 80000, step: 500, disabled: scope !== 'all', hint: scope !== 'all' ? 'One depth per row, choose Whole row to change it' : 'One depth per row' }),
          numField('Unit height', 'heightMm', { min: 3000, max: 15000, step: 100 })),
        section('Doors',
          selField('Roller doors', 'doors.count', [[1, '1 at the front'], [2, '2 at the front']]),
          selField('Roller door size', 'doors.presetId', [...DOOR_PRESETS.map((d) => [d.id, `${d.id.replace('x', ' x ')} m`]), ['custom', 'Custom']]),
          unitValue('doors.presetId') === 'custom' ? numField('Door width', 'doors.widthMm', { min: 2000, max: 6000, step: 100 }) : null,
          unitValue('doors.presetId') === 'custom' ? numField('Door height', 'doors.heightMm', { min: 2000, max: 7000, step: 100 }) : null,
          numField('Door offset in the facade', 'doors.offsetMm', { min: -3000, max: 6000, step: 50, hint: 'From the left margin' }),
          chkField('Motorised doors', 'doors.motorised'),
          chkField('Personnel door beside the roller door', 'doors.personnel'),
          chkField('Rear roller door (through units)', 'doors.rear')),
        section('Windows',
          selField('Front windows', 'windows.front', [['none', 'None'], ['highlight', 'High light strip'], ['office', 'Office window'], ['shopfront', 'Full glazed shopfront']]),
          selField('Rear windows', 'windows.rear', [['none', 'None'], ['highlight', 'High light strip'], ['office', 'Office window']]),
          numField('Window width', 'windows.widthMm', { min: 600, max: 6000, step: 100 }),
          numField('Window height', 'windows.heightMm', { min: 300, max: 3000, step: 100 }),
          numField('Window sill', 'windows.sillMm', { min: 0, max: 4000, step: 50 }),
          chkField('Side windows on end units', 'windows.side', 'No windows on party walls')),
        section('Office',
          chkField('Ground office/amenity at the front', 'office.enabled', 'Beside the roller door, under the mezzanine'),
          numField('Office/amenity depth', 'office.depthMm', { min: 2000, max: 8000, step: 100 }),
          chkField('Accessible WC in the office', 'office.accessibleWc', 'Layout to be confirmed with an access consultant')),
        section('Mezzanine',
          chkField('Mezzanine', 'mezzanine.enabled', 'Over the front bay, stair behind it'),
          selField('Mezzanine use', 'mezzanine.use', [['office', 'Office'], ['storage', 'Storage']]),
          selField('Sized by', 'mezzanine.mode', [['depth', 'Depth'], ['percent', 'Percent of floor']]),
          unitValue('mezzanine.mode') === 'percent' ? numField('Mezzanine floor share', 'mezzanine.percent', { unit: '%', min: 5, max: 90, step: 5 }) : numField('Mezzanine depth', 'mezzanine.depthMm', { min: 2000, max: 40000, step: 500 }),
          selField('Position', 'mezzanine.position', [['front', 'Front, over the bay beside the roller door'], ['rear', 'Rear, full width']]),
          selField('Stair type', 'mezzanine.stairType', [['straight', 'Straight'], ['L', 'L shaped']]),
          selField('Stair side', 'mezzanine.stairSide', [['left', 'Left wall'], ['right', 'Right wall']]),
          chkField('Balustrade', 'mezzanine.balustrade'),
          numField('Mezzanine floor level', 'mezzanine.levelMm', { min: 2400, max: 8000, step: 50 }),
          numField('Min clear height above', 'mezzanine.minClearMm', { min: 2000, max: 3500, step: 50, hint: '2.4 m for rooms, check with council and the NCC' }),
          numField('Min clear height below', 'mezzanine.minClearBelowMm', { min: 1800, max: 3500, step: 50, hint: '2.1 m for storerooms, unverified for mezzanines' })),
      );
    }
    dock.append(section('Site',
      siteChk('Parking rows (indicative)', () => c.parking.enabled, (cc, v) => { cc.parking.enabled = v; }),
      siteNum('Car aisle width', () => c.parking.aisleMm, (cc, v) => { cc.parking.aisleMm = v; }, { unit: 'mm', min: 3000, max: 30000, step: 100 }),
      siteNum('Truck apron depth', () => c.parking.apronMm, (cc, v) => { cc.parking.apronMm = v; }, { unit: 'mm', min: 0, max: 40000, step: 500 }),
      siteNum('GFA per parking space', () => Math.round(1 / c.rates.parkingPerM2Gfa), (cc, v) => { cc.rates.parkingPerM2Gfa = 1 / Math.max(10, v); }, { unit: 'm²', min: 10, max: 500, step: 5 }),
      siteChk('Count office area at 1 per 40 m²', () => c.rates.officeSeparate !== false, (cc, v) => { cc.rates.officeSeparate = v; }),
      classField(c),
      siteNum('Accessible bays', () => c.parking.accessibleOverride, (cc, v) => { cc.parking.accessibleOverride = v == null ? null : Math.round(v); }, { min: 0, max: 50, step: 1, blank: true }),
      siteChk('Bollards', () => c.bollards.enabled, (cc, v) => { cc.bollards.enabled = v; }),
      mrvField(c),
      siteNum('Downpipe every N units', () => c.bollards.downpipeEvery, (cc, v) => { cc.bollards.downpipeEvery = Math.round(v); }, { min: 0, max: 20, step: 1 }),
      siteChk('Waste enclosure', () => !!c.waste, (cc, v) => {
        const r0 = cc.rows[0];
        cc.waste = v ? { x: Math.round((r0?.x || 0) - 6000), y: Math.round((r0?.y || 0) + 4000), widthMm: 4000, depthMm: 3000, rotationDeg: r0?.rotationDeg || 0 } : null;
      }),
      siteChk('Hydrant or booster', () => !!c.hydrant, (cc, v) => {
        const r0 = cc.rows[0];
        cc.hydrant = v ? { x: Math.round((r0?.x || 0) - 4000), y: Math.round((r0?.y || 0) + (r0?.unit.depthMm || 0) + 3000) } : null;
      })));
    // Checks and schedule
    const checks = h('div', { class: 'cm-checks', dataset: { ps: 'commercial-checks' } }, h('b', null, 'Checks'),
      ...(a.checks.length ? a.checks.map((k) => h('p', { class: `cm-check cm-${k.kind}`, dataset: { id: k.id, status: k.status || '' }, title: k.tip || null }, k.text)) : [h('p', { class: 'cm-check' }, 'Nothing to flag yet.')]));
    const sched = h('details', { class: 'cm-sec', dataset: { ps: 'bollard-schedule' } }, h('summary', null, `Bollard schedule (${a.schedule.total})`),
      h('div', { class: 'cm-body' }, ...a.schedule.byKind.map((r) => h('p', { class: 'cm-line' }, h('span', null, r.label), h('b', null, String(r.count)))), h('p', { class: 'cm-hint' }, a.schedule.note)));
    dock.append(sched, checks);
    dock.scrollTop = keep.top;
    if (keep.sel) { try { dock.querySelector(keep.sel)?.focus({ preventScroll: true }); } catch { /* the control is gone */ } }

    // Stats strip
    const s = a.stats;
    const cell = (k, v, l, tip) => h('div', { class: 'cm-cell', dataset: { stat: k }, title: tip || null }, h('b', null, v), h('i', null, l));
    clear(strip);
    strip.title = 'Bays shown are indicative. The full parking layout is added in the next stage.';
    strip.append(
      cell('units', String(s.units), s.mix.map((x) => `${x.count} x ${x.label}`).join(', ') || 'units'),
      cell('gfa', `${s.gfaM2.toLocaleString('en-AU')} m²`, s.mezzGfaM2 ? `GFA incl. ${s.mezzGfaM2} m² mezzanine` : 'GFA'),
      cell('coverage', s.coveragePct == null ? 'n/a' : `${s.coveragePct}%`, 'site coverage'),
      cell('parking', String(s.parking.required), `bays needed, 1 per ${Math.round(1 / s.parking.ratePerM2)} m²${s.parking.officeSplit ? ', office 1 per 40 m²' : ''}`, `${parkingSplitTip(s)}${facts('parkingUnits').tip}. ${s.parking.officeSplit ? 'Counting the office separately is a conservative reading, unverified. ' : ''}Indicative, check with council`),
      cell('provided', String(s.parking.provided), 'bays shown, indicative'),
      cell('accessible', `${s.parking.accessible.provided} / ${s.parking.accessible.required}`, 'accessible bays', `${facts(ACCESS_FACT[c.buildingClass] || 'accessibleClass8').tip}. Bay 2.4 x 5.4 m with a 2.4 m shared zone, ${facts('bay').tip}`));
  }

  function inset() {
    const el = editor?.element;
    if (!el || dock.hidden) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return; // the plan is not on screen (3D or walk)
    const d = dock.getBoundingClientRect();
    const sr = strip.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    // Only what really lies over the plan counts. Wide: the dock on its left and the strip along the bottom. Phone: the dock is a sheet along
    // the bottom and the strip moves to the top.
    const sheet = d.width > r.width * 0.8;
    let left = 0;
    let top = 0;
    let bottom = 0;
    if (d.width && d.left < r.right) {
      if (sheet) bottom = Math.max(0, r.bottom - d.top + 8);
      else left = Math.max(0, Math.min(d.right, r.right) - r.left + 8);
    }
    if (sr.height && sr.left < r.right) {
      if (sr.top > mid) bottom = Math.max(bottom, r.bottom - sr.top + 8);
      else top = Math.max(0, sr.bottom - r.top + 8);
    }
    editor.setInset({ left: left < r.width - 160 ? left : 0, top, bottom });
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { render(); inset(); }); };
  const offs = [store.on('project', schedule), store.on('ui', (p = {}) => { if ('commercialRow' in p || 'view' in p) schedule(); })];
  render();
  requestAnimationFrame(inset);
  window.addEventListener('resize', inset);
  return { render, dispose() { offs.forEach((o) => o()); dock.remove(); strip.remove(); }, dock, strip };
}
