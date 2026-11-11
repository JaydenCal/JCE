// Site section of the summary panel: find a block by address, or show and adjust the lot already in the project.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { section, numberField, checkField, selectField, button, formBuilder } from './panel-forms.js';
import { createFindBlock } from './find-block.js';
import { removeSiteLot } from '../site/apply.js';
import { CONFIG } from '../config.js';
import { floorRLOf, defaultFloorRL, centroidRL } from '../site/model.js';
import { setbackInputsFor } from '../site/setback-stage.js';
import { askConfirm } from './modal.js';
import { siteCredits, INDICATIVE } from '../site/credits.js';

const LAYER_LABELS = [
  ['boundary', 'Lot boundary'], ['dimensions', 'Boundary lengths'], ['neighbours', 'Neighbouring lots'],
  ['labels', 'Lot and DP labels'], ['aerial', 'Aerial image'], ['contours', 'Contours'], ['setbacks', 'Setback envelope'],
];

export function buildSiteSection(ctx) {
  const { store } = ctx;
  const root = h('div');
  let key = null;
  let fb = formBuilder();
  let finder = null;
  const lotOf = () => store.project.site?.lot || null;
  const keyOf = () => (lotOf() ? `lot:${lotOf().origin?.e}:${lotOf().lotLabel}:${(lotOf().frontEdges || []).join(',')}:${!!lotOf().frontageConfirmed}:${lotOf().setbacksKey || ''}:${lotOf().setbacksStatus || ''}` : 'none');

  const fact = (k, v) => h('tr', null, h('td', null, k), h('td', { class: 'num', style: { textAlign: 'right' } }, v));

  function build() {
    finder?.dispose();
    finder = null;
    clear(root);
    fb = formBuilder();
    key = keyOf();
    const lot = lotOf();
    if (!CONFIG.siteLookupEnabled) return;
    if (!lot) {
      finder = createFindBlock(store, { compact: true });
      root.append(section('Site', h('p', { class: 'ps-hint', style: { marginTop: 0 } }, 'Type your street address to draw the real lot, its neighbours, an aerial image and ground contours to scale.'), finder.el));
      return;
    }
    const rl = floorRLOf(lot);
    const crl = centroidRL(lot);
    const rows = h('tbody', null,
      fact('Address', lot.address || 'Not stated'),
      fact('Lot and plan', lot.lotLabel),
      fact('Area', `${lot.areaM2.toLocaleString('en-AU', { maximumFractionDigits: 1 })} m²`),
      fact('Council', lot.lga || 'Not found'),
      fact('Zone', lot.zoning ? `${lot.zoning.code} ${lot.zoning.name}` : 'Not looked up'),
      crl != null ? fact('Ground RL at lot centre', `${crl.toFixed(2)} m`) : null,
      fact('Street frontage', (lot.frontEdges || []).length ? `Edge${lot.frontEdges.length > 1 ? 's' : ''} ${lot.frontEdges.map((i) => i + 1).join(', ')}${lot.cornerLot ? ' (corner lot)' : ''}${lot.frontageConfirmed ? '' : ', not confirmed'}` : 'Not set'));
    const sec = section('Site', h('table', { class: 'ps-table ps-site-facts' }, rows));
    if (!lot.zoning && lot.zoneNote) sec.append(h('p', { class: 'ps-hint' }, lot.zoneNote));
    sec.append(h('p', { class: 'ps-hint' }, `Coordinates are MGA2020 zone ${lot.zone}, plan up is grid north.`));

    sec.append(h('div', { class: 'ps-sec' }, button('Confirm street frontage', () => store.setUI({ view: '2d', frontageEdit: true }), { title: 'Click the edges of your lot that face the street' })));
    const layers = h('div', { class: 'ps-sec', style: { marginTop: '8px' } }, h('h4', null, 'Layers'));
    for (const [id, label] of LAYER_LABELS) {
      if (id === 'aerial' && !lot.aerial) continue;
      if (id === 'contours' && !lot.contours?.length) continue;
      if (id === 'setbacks' && !lot.envelope) continue;
      layers.append(fb.add(checkField({ label, get: () => lotOf()?.layers?.[id] !== false, commit: (v) => ctx.apply(`${v ? 'Show' : 'Hide'} ${label.toLowerCase()}`, (p) => { p.site.lot.layers[id] = v; }) })));
    }
    sec.append(layers);
    sec.append(setbackBlock(lot));

    if (lot.aerial) {
      const op = h('input', { type: 'range', min: '10', max: '100', step: '5', 'aria-label': 'Aerial opacity', style: { width: '100%' } });
      const syncOp = () => { if (document.activeElement !== op) op.value = String(Math.round((store.project.site.underlay?.opacity ?? 0.85) * 100)); };
      op.addEventListener('input', () => ctx.editor?.previewProject?.((p) => { if (p.site.underlay) p.site.underlay.opacity = Number(op.value) / 100; }));
      op.addEventListener('change', () => ctx.apply('Aerial opacity', (p) => { if (p.site.underlay) p.site.underlay.opacity = Number(op.value) / 100; }));
      syncOp();
      sec.append(h('div', { class: 'ps-field' }, h('label', null, 'Aerial opacity'), op));
      fb.add({ el: document.createElement('span'), refresh: syncOp });
    }

    sec.append(fb.add(numberField({
      label: 'Floor level (RL)', unit: 'm', step: 0.05, decimals: 2,
      get: () => floorRLOf(lotOf()),
      commit: (n) => ctx.apply('Set floor level', (p) => { p.site.lot.floorRL = n; p.site.lot.floorRLAuto = false; }),
    })));
    if (crl != null) {
      sec.append(h('p', { class: 'ps-hint' }, `Starts at the lot centre RL plus 0.15 m (${defaultFloorRL(lot)?.toFixed(2)} m). The 3D view sits the house at this level.`));
    }

    const credits = siteCredits(lot).map((c) => c.text);
    credits.push(INDICATIVE);
    if (lot.sample) credits.unshift('SAMPLE DATA: this lot is invented for testing.');
    sec.append(h('div', { class: 'ps-hint' }, ...credits.map((t) => h('p', { style: { margin: '0 0 4px' } }, t))));

    // Searching again replaces the lot (one undo step).
    finder = createFindBlock(store, { compact: true });
    sec.append(
      h('div', { class: 'ps-field ps-field--stack', style: { marginTop: '8px' } }, h('label', null, 'Find a different address'), finder.el),
      h('div', { class: 'ps-sec' },
        button('Remove lot', async () => {
          const ok = await askConfirm({ title: 'Remove the lot?', message: 'The lot boundary, neighbours, aerial image and contours are taken off this design. You can undo this.', confirmLabel: 'Remove lot', danger: true });
          if (ok) removeSiteLot(store);
        }, { cls: 'ps-btn--danger', icon: icon('trash', { size: 16 }) })));
    root.append(sec);
  }

  const fmtM = (v, slot) => (typeof v === 'number' ? `${v.toLocaleString('en-AU', { maximumFractionDigits: 2 })} m` : (slot && slot.behindBuildingLineM != null ? 'behind the building line' : 'see note'));
  const SLOT_LABELS = [['front', 'Front'], ['secondaryFront', 'Secondary street'], ['side', 'Side'], ['rear', 'Rear'], ['garage', 'Garage']];

  // Indicative setbacks for the lot: what was found, where it came from, and the design inputs the rules need.
  function setbackBlock(lot) {
    const box = h('div', { class: 'ps-sec ps-setbacks', dataset: { ps: 'setbacks' } }, h('h4', null, 'Setbacks (indicative)'));
    if (!lot.frontageConfirmed) {
      box.append(h('p', { class: 'ps-hint' }, 'Confirm the street frontage and the setbacks for this lot are worked out from the council rules, or the NSW and Queensland default codes.'));
      return box;
    }
    const sb = lot.setbacks;
    const inp = setbackInputsFor(store.project, lot);
    const setInput = (patch, label) => ctx.apply(label, (p) => { p.site.lot.setbackInputs = { ...(p.site.lot.setbackInputs || {}), ...patch }; });
    // Inputs the rules may need. Blank means "use the drawn design".
    box.append(
      fb.add(numberField({ label: 'Storeys', unit: '', step: 1, min: 1, max: 3, allowBlank: true, placeholder: inp.auto.storeys ? 'from design' : '', get: () => lotOf()?.setbackInputs?.storeys ?? null, commit: (n) => setInput({ storeys: n == null ? null : Math.round(n) }, 'Set storeys for setbacks') })),
      fb.add(numberField({ label: 'Wall height', unit: 'm', step: 0.1, min: 2, max: 12, decimals: 2, allowBlank: true, placeholder: inp.wallHeightM != null ? String(inp.wallHeightM) : '', get: () => lotOf()?.setbackInputs?.wallHeightM ?? null, commit: (n) => setInput({ wallHeightM: n }, 'Set wall height for setbacks') })),
      fb.add(numberField({ label: 'Overall height', unit: 'm', step: 0.1, min: 2, max: 14, decimals: 2, allowBlank: true, placeholder: inp.buildingHeightM != null ? String(inp.buildingHeightM) : '', get: () => lotOf()?.setbackInputs?.buildingHeightM ?? null, commit: (n) => setInput({ buildingHeightM: n }, 'Set overall height for setbacks') })));
    box.append(h('p', { class: 'ps-hint' }, `Blank fields use your drawn design (${inp.storeys ?? '?'} storey${inp.storeys === 1 ? '' : 's'}, wall ${inp.wallHeightM ?? '?'} m, overall ${inp.buildingHeightM ?? '?'} m, roof height estimated).`));
    if (lot.state === 'QLD') {
      box.append(fb.add(selectField({ label: 'Street type', options: [['', 'Choose'], ['access', 'Access street'], ['collector', 'Collector street or higher']], get: () => lotOf()?.setbackInputs?.streetType || '', commit: (v) => setInput({ streetType: v || null }, 'Set street type for setbacks') })));
    }
    if (lot.setbacksKey == null && !sb && lot.setbacksStatus == null) {
      box.append(h('p', { class: 'ps-hint', role: 'status' }, 'Working out the setbacks'));
      return box;
    }
    if (!sb) {
      const why = (lot.setbacksAttempts || []).map((a) => a.reason).filter(Boolean)[0];
      box.append(h('p', { class: 'ps-hint', role: 'status', dataset: { ps: 'setbacks-none' } }, 'Setbacks could not be worked out for this lot from the rules loaded. Check them with the council before you rely on any distance.'),
        lot.state === 'QLD' && lot.areaM2 > 450 ? h('p', { class: 'ps-hint' }, 'The Queensland default setbacks cover lots up to 450 m². This lot is larger, so check the council planning scheme or the Queensland Housing Code.') : null,
        why ? h('p', { class: 'ps-hint' }, why) : null);
      return box;
    }
    const rows = [];
    for (const [k, label] of SLOT_LABELS) {
      const slot = sb[k];
      if (!slot) continue;
      const flag = slot.flag === 'check_with_council' || sb.flag === 'check_with_council';
      rows.push(h('tr', null,
        h('td', null, label, slot.clause ? h('div', { class: 'ps-hint', style: { margin: 0 } }, slot.clause) : null),
        h('td', { class: 'num', style: { textAlign: 'right' } }, fmtM(slot.minM, slot), flag ? h('div', { class: 'ps-hint', style: { margin: 0 } }, 'check with council') : null)));
    }
    box.append(h('table', { class: 'ps-table ps-site-facts', dataset: { ps: 'setbacks-table' } }, h('tbody', null, ...rows)));
    const src = sb.source?.kind === 'council' ? (sb.source.dcp || sb.council || 'Council DCP') : `${sb.source?.name || sb.basis}${sb.source?.edition ? `, ${sb.source.edition}` : ''}`;
    box.append(h('p', { class: 'ps-hint', dataset: { ps: 'setbacks-basis' } }, `Basis: ${sb.basis}.`), h('p', { class: 'ps-hint', dataset: { ps: 'setbacks-source' } }, `Source: ${src}.`),
      h('p', { class: 'ps-hint' }, 'Indicative only. These distances are not a planning or building approval and are not a compliance check. Confirm with the council or a certifier.'));
    return box;
  }

  build();
  return {
    el: root,
    refresh() {
      if (keyOf() !== key) build();
      else fb.refresh();
    },
    dispose: () => finder?.dispose(),
  };
}
