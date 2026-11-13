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
const m1 = (v) => (v / 1000).toFixed(1);

export function createCommercialPanel({ store, host, editor }) {
  const dock = h('aside', { class: 'cm-dock', hidden: true, 'aria-label': 'Commercial layout', dataset: { ps: 'commercial-dock' } });
  const strip = h('div', { class: 'cm-strip', hidden: true, role: 'status', 'aria-label': 'Layout summary', dataset: { ps: 'commercial-strip' } });
  host.append(dock, strip);
  let scope = 'all';
  let raf = 0;
  let open = { Doors: true, Unit: true };
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
  const unitValue = (path) => { const r = rowOf(); return getPath(unitSpec(r, scope === 'all' ? 0 : Number(scope)), path); };

  const numField = (label, path, { unit = 'mm', min = 0, max = 1e6, step = 50, scale = 1, hint } = {}) => {
    const input = h('input', { type: 'number', min, max, step, value: Math.round(unitValue(path) / scale * 100) / 100, dataset: { path }, onchange: () => {
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
    const input = h('input', { type: 'number', min, max, step, value: cur == null ? '' : cur, placeholder: blank ? 'Auto' : null, onchange: () => {
      const raw = input.value;
      const v = raw === '' && blank ? null : Math.min(max, Math.max(min, Number(raw) || 0));
      edit(`Set ${label.toLowerCase()}`, (c) => set(c, v));
    } });
    return field(label, h('span', { class: 'cm-in' }, input, unit ? h('i', null, unit) : null));
  };
  const siteChk = (label, get, set) => {
    const input = h('input', { type: 'checkbox', checked: !!get(), onchange: () => edit(`Set ${label.toLowerCase()}`, (c) => set(c, input.checked)) });
    return h('label', { class: 'cm-chk' }, input, h('span', null, label));
  };
  function classField(c) {
    const sel = h('select', { dataset: { ps: 'ncc-class' }, title: facts('accessibleClass8').tip, onchange: () => edit('Set NCC class', (cc) => { cc.buildingClass = sel.value; }) }, NCC_CLASSES.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = c.buildingClass || 'class_8';
    return field('NCC class (accessible bays)', sel, 'Indicative, verify against NCC Part D4');
  }
  function mrvField(c) {
    const v = c.vehicle || {};
    const input = h('input', { type: 'number', min: 3, max: 30, step: 0.1, value: v.turningRadiusM ?? '', placeholder: 'Not set', dataset: { ps: 'mrv-radius' }, title: facts('mrvRadius').tip, onchange: () => edit('Set MRV turning radius', (cc) => { cc.vehicle = { ...cc.vehicle, turningRadiusM: input.value === '' ? null : Number(input.value) }; }) });
    return field(`${v.code || 'MRV'} turning radius`, h('span', { class: 'cm-in' }, input, h('i', null, 'm')), `${v.lengthM} x ${v.widthM} m, verify the radius against AS 2890.2`);
  }
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
    if (!on) return;
    const c = p.commercial;
    const row = rowOf();
    const a = analyse(p);
    clear(dock);
    // Header
    const z = zoneClass(p.site?.lot);
    const cls = effectiveClass(p);
    const lot = p.site?.lot;
    const zoneSel = h('select', { 'aria-label': 'Zone class', dataset: { ps: 'zone-class' }, onchange: () => edit('Set zone class', (cc) => { cc.zoneClass = zoneSel.value || null; }) },
      h('option', { value: '' }, z.employment ? `${ZONE_CLASS_LABEL[z.cls]} (from the zone)` : 'Choose zone class'), h('option', { value: 'industrial' }, 'Industrial'), h('option', { value: 'commercial' }, 'Commercial'));
    zoneSel.value = c.zoneClass || '';
    dock.append(h('header', { class: 'cm-head' },
      h('div', { class: 'cm-title' }, h('b', null, 'Commercial and industrial layout'), h('span', { class: 'cm-beta' }, 'Beta')),
      h('div', { class: 'cm-sub' }, lot ? `${lot.lotLabel || 'Lot'}${lot.zoning ? ` · ${lot.zoning.code || ''} ${lot.zoning.name || ''}` : ' · zone not looked up'}` : 'Find an address to place units on a lot'),
      h('div', { class: 'cm-zone' }, field('Zone class', zoneSel))));
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
      const scopeSel = h('select', { 'aria-label': 'Applies to', dataset: { ps: 'unit-scope' }, onchange: () => { scope = scopeSel.value; schedule(); } }, h('option', { value: 'all' }, 'All units in the row'),
        ...Array.from({ length: count }, (_, i) => h('option', { value: String(i) }, `Unit ${i + 1} only`)));
      scopeSel.value = scope;
      dock.append(
        field(`Units per row${mirrored ? ' (follows the first row)' : ''}`, h('span', { class: 'cm-in' }, countInput)),
        field('Edit', scopeSel),
        section('Unit',
          numField('Unit width', 'widthMm', { min: 2500, max: 30000, step: 100, hint: mirrored ? 'Widths follow the first row' : null }),
          numField('Unit depth', 'depthMm', { min: 4000, max: 80000, step: 500, hint: 'One depth per row' }),
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
          chkField('Office at the front', 'office.enabled'),
          numField('Office depth', 'office.depthMm', { min: 2000, max: 8000, step: 100 }),
          chkField('Accessible WC in the office', 'office.accessibleWc', 'Layout to be confirmed with an access consultant')),
        section('Mezzanine',
          chkField('Mezzanine', 'mezzanine.enabled'),
          selField('Sized by', 'mezzanine.mode', [['depth', 'Depth'], ['percent', 'Percent of floor']]),
          unitValue('mezzanine.mode') === 'percent' ? numField('Mezzanine floor share', 'mezzanine.percent', { unit: '%', min: 5, max: 90, step: 5 }) : numField('Mezzanine depth', 'mezzanine.depthMm', { min: 2000, max: 40000, step: 500 }),
          selField('Position', 'mezzanine.position', [['rear', 'Rear'], ['front', 'Front']]),
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
      siteNum('Aisle width', () => c.parking.aisleMm, (cc, v) => { cc.parking.aisleMm = v; }, { unit: 'mm', min: 3000, max: 30000, step: 500 }),
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

    // Stats strip
    const s = a.stats;
    const cell = (k, v, l, tip) => h('div', { class: 'cm-cell', dataset: { stat: k }, title: tip || null }, h('b', null, v), h('i', null, l));
    clear(strip);
    strip.title = 'Bays shown are indicative. The full parking layout is added in the next stage.';
    strip.append(
      cell('units', String(s.units), s.mix.map((x) => `${x.count} x ${x.label}`).join(', ') || 'units'),
      cell('gfa', `${s.gfaM2.toLocaleString('en-AU')} m²`, s.mezzGfaM2 ? `GFA incl. ${s.mezzGfaM2} m² mezzanine` : 'GFA'),
      cell('coverage', s.coveragePct == null ? 'n/a' : `${s.coveragePct}%`, 'site coverage'),
      cell('parking', String(s.parking.required), `bays needed, 1 per ${Math.round(1 / s.parking.ratePerM2)} m²${s.parking.officeSplit ? ', office 1 per 40 m²' : ''}`, `${facts('parkingUnits').tip}. ${s.parking.officeSplit ? 'Counting the office separately is a conservative reading, unverified. ' : ''}Indicative, check with council`),
      cell('provided', String(s.parking.provided), 'bays shown, indicative'),
      cell('accessible', `${s.parking.accessible.provided} / ${s.parking.accessible.required}`, 'accessible bays', `${facts('accessibleClass8').tip}. Bay 2.4 x 5.4 m with a 2.4 m shared zone, ${facts('bay').tip}`));
  }

  function inset() {
    const el = editor?.element;
    if (!el || dock.hidden) return;
    const r = el.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const sr = strip.getBoundingClientRect();
    editor.setInset({ left: Math.max(0, d.right - r.left + 8), bottom: Math.max(0, r.bottom - sr.top + 8) });
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { render(); inset(); }); };
  const offs = [store.on('project', schedule), store.on('ui', (p = {}) => { if ('commercialRow' in p) schedule(); })];
  render();
  requestAnimationFrame(inset);
  window.addEventListener('resize', inset);
  return { render, dispose() { offs.forEach((o) => o()); dock.remove(); strip.remove(); }, dock, strip };
}
