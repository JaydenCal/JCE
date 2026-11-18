// Site section of the summary panel: find a block by address, or show and adjust the lot already in the project.

import { writeAerialChoice } from '../site/aerial-pref.js';
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { section, numberField, checkField, selectField, button, formBuilder } from './panel-forms.js';
import { createFindBlock } from './find-block.js';
import { removeSiteLot, refreshOverlays } from '../site/apply.js';
import { constraintSummary, drawableLayers, overlayOn, OVERLAY_LAYER_KEY, OVERLAY_STYLE, CHECK_WITH_COUNCIL } from '../site/overlays.js';
import { CONFIG } from '../config.js';
import { planView } from './view-mode.js';
import { floorRLOf, defaultFloorRL, centroidRL } from '../site/model.js';
import { setbackInputsFor } from '../site/setback-stage.js';
import { askConfirm } from './modal.js';
import { plainSetbackReason, edgeWords } from '../site/lot-checks.js';
import { buildingRings, boundaryDims } from '../site/lotplan.js';
import { driveSiteCard } from './panel-drivepi.js';
import { siteCredits, INDICATIVE } from '../site/credits.js';

const LAYER_LABELS = [
  ['boundary', 'Lot boundary'], ['dimensions', 'Boundary lengths'], ['neighbours', 'Neighbouring lots'],
  ['labels', 'Lot and DP labels'], ['aerial', 'Aerial image'], ['contours', 'Contours'],
  ['setbacks', 'Setback envelope'], ['driveway', 'Driveway'],
  ['fences', 'Fences (3D)'], ['houses', 'Neighbour houses (3D)'],
];

export function buildSiteSection(ctx) {
  const { store } = ctx;
  const root = h('div');
  let key = null;
  let fb = formBuilder();
  let finder = null;
  const lotOf = () => store.project.site?.lot || null;
  const keyOf = () => (lotOf() ? `lot:${lotOf().origin?.e}:${lotOf().lotLabel}:${(lotOf().frontEdges || []).join(',')}:${!!lotOf().frontageConfirmed}:${lotOf().setbacksKey || ''}:${lotOf().setbacksStatus || ''}:${lotOf().overlays ? lotOf().overlays.retrieved || 'o' : ''}` : 'none');

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
      fact('Street frontage', (lot.frontEdges || []).length ? `${lot.frontEdges.map((i) => { const d = boundaryDims(lot)[i]; return d ? `${edgeWords(lot, i)}, ${d.length} m` : ''; }).filter(Boolean).join('; ')}${lot.cornerLot ? ' (corner lot)' : ''}${lot.frontageConfirmed ? '' : ', not confirmed'}` : 'Not set'));
    const sec = section('Site', h('table', { class: 'ps-table ps-site-facts' }, rows));
    if (!lot.zoning && lot.zoneNote) sec.append(h('p', { class: 'ps-hint' }, lot.zoneNote));
    if (lot.zone) sec.append(h('p', { class: 'ps-hint' }, `Coordinates are MGA2020 zone ${lot.zone}, plan up is grid north.`));

    sec.append(h('div', { class: 'ps-sec' }, button('Confirm street frontage', () => store.setUI({ view: planView(store.ui.view), frontageEdit: true }), { title: 'Click the edges of your lot that face the street' })));
    // The builder's lot planner controls: drag, turn, mirror, face the garage to the street, live clearances.
    if (store.project.mode === 'commercial') {
      // A commercial lot holds buildings, not a house: add more, arrange them on the lot, and lay the car park out again.
      sec.append(h('div', { class: 'ps-sec' },
        button('Add building', async () => { const m = await import('../commercial/ui/add-building.js'); m.openAddBuilding({ store }); }, { title: 'Add another building: amenities block, office, warehouse, workshop, canopy, car wash, shed, kiosk and more' }),
        button('Arrange buildings on lot', async () => {
          try {
            const { startArrange } = await import('../portal/arrange.js');
            startArrange({ store, editor: ctx.editor });
          } catch (e) { sec.append(h('p', { class: 'ps-hint' }, e.message || 'Could not start.')); }
        }, { title: 'Drag, turn and mirror the buildings on the lot and see the clearance to each boundary' }),
        button('Re-run car park layout', async () => { const m = await import('../commercial/catalogue/ops.js'); m.rerunSiteLayout(store); }, { title: 'Lay out the driveway, aisles, bays, footpaths and landscaping again' })));
    } else {
    sec.append(h('div', { class: 'ps-sec' }, button('Arrange house on lot', async () => {
      try {
        const { startArrange } = await import('../portal/arrange.js');
        startArrange({ store, editor: ctx.editor });
      } catch (e) { sec.append(h('p', { class: 'ps-hint' }, e.message || 'Could not start.')); }
    }, { title: 'Drag, turn and mirror the house on the lot and see the clearance to each boundary' })));
    sec.append(driveSiteCard(ctx));
    }
    const layers = h('div', { class: 'ps-sec', style: { marginTop: '8px' } }, h('h4', null, 'Layers'));
    for (const [id, label0] of LAYER_LABELS) {
      const label = id === 'houses' && store.project.mode === 'commercial' ? 'Neighbouring buildings (3D)' : label0;
      if (id === 'aerial' && !lot.aerial) continue;
      if (id === 'contours' && !lot.contours?.length) continue;
      if (id === 'setbacks' && !lot.envelope) continue;
      layers.append(fb.add(checkField({ label, get: () => (id === 'houses' && lotOf()?.source !== 'sample' ? lotOf()?.layers?.houses === true : lotOf()?.layers?.[id] !== false), commit: (v) => { if (id === 'aerial') writeAerialChoice(v); ctx.apply(`${v ? 'Show' : 'Hide'} ${label.toLowerCase()}`, (p) => { p.site.lot.layers[id] = v; }); } })));
    }
    // Site constraint overlays: off until switched on. Only layers that have mapped features are offered.
    for (const l of drawableLayers(lot)) {
      layers.append(fb.add(checkField({ label: `${l.label} (overlay)`, get: () => overlayOn(lotOf(), l.id), commit: (v) => ctx.apply(`${v ? 'Show' : 'Hide'} ${l.label.toLowerCase()} overlay`, (p) => { p.site.lot.layers[OVERLAY_LAYER_KEY(l.id)] = v; }) })));
    }
    sec.append(layers);
    sec.append(constraintsBlock(lot));
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
      sec.append(h('p', { class: 'ps-hint' }, `Starts at the lot centre RL plus 0.15 m (${defaultFloorRL(lot)?.toFixed(2)} m). The 3D view sits the ${store.project.mode === 'commercial' ? 'building' : 'house'} at this level.`));
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

  // "Site constraints (indicative)": one row per overlay with the answer, what was found, and where it came from.
  function constraintsBlock(lot) {
    const box = h('div', { class: 'ps-sec ps-constraints', dataset: { ps: 'constraints' } }, h('h4', null, 'Site constraints (indicative)'));
    if (!lot.overlays) {
      box.append(h('p', { class: 'ps-hint', role: 'status', dataset: { ps: 'constraints-none' } }, 'Flood planning, bushfire prone land, heritage and easements have not been looked up for this lot.'),
        h('div', { class: 'ps-sec' }, button('Check site constraints', async (e) => {
          const b = e?.currentTarget; if (b) b.disabled = true;
          const ok = await refreshOverlays(store, lot);
          if (!ok) { if (b) b.disabled = false; box.append(h('p', { class: 'ps-hint', role: 'status' }, 'The map services did not answer. Try again later.')); }
        }, { title: 'Look up open government mapping for this lot' })));
      return box;
    }
    const rows = constraintSummary(lot).map((r) => h('div', { class: 'ps-constraint', dataset: { ps: `constraint-${r.id}` }, style: { padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.2)' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
        h('span', null, h('span', { class: 'ps-swatch', style: { display: 'inline-block', width: '9px', height: '9px', marginRight: '6px', background: `rgb(${OVERLAY_STYLE[r.id].rgb.join(',')})`, opacity: r.hit ? '1' : '0.35' } }), r.title),
        h('strong', null, r.answer)),
      r.detail ? h('div', { class: 'ps-hint', style: { margin: '2px 0 0' } }, r.detail) : null,
      r.source ? h('div', { class: 'ps-hint', style: { margin: '2px 0 0' } }, `Source: ${r.source}${r.date ? `, data dated ${r.date}` : ''}.`) : null));
    box.append(h('div', { dataset: { ps: 'constraints-table' } }, ...rows));
    for (const w of lot.overlays.warnings || []) box.append(h('p', { class: 'ps-hint' }, w));
    box.append(h('p', { class: 'ps-hint', dataset: { ps: 'constraints-note' } }, `${CHECK_WITH_COUNCIL} A mapped area is context for your own planning enquiry, not a planning decision, and an area with none mapped is not an all clear.`),
      h('div', { class: 'ps-sec' }, button('Refresh', () => refreshOverlays(store, lot), { title: 'Look the constraints up again' })));
    return box;
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
    const hasHouse = buildingRings(store.project).length > 0;
    const num = (v) => (Number.isFinite(v) ? String(v) : null);
    box.append(h('p', { class: 'ps-hint' }, hasHouse && inp.storeys != null && num(inp.wallHeightM) && num(inp.buildingHeightM)
      ? `Blank fields use your drawn design (${inp.storeys} storey${inp.storeys === 1 ? '' : 's'}, wall ${inp.wallHeightM} m, overall ${inp.buildingHeightM} m, roof height estimated).`
      : `Blank fields use your drawn design once a ${store.project.mode === 'commercial' ? 'building' : 'house'} is placed.`));
    if (lot.state === 'QLD') {
      box.append(fb.add(selectField({ label: 'Street type', options: [['', 'Choose'], ['access', 'Access street'], ['collector', 'Collector street or higher']], get: () => lotOf()?.setbackInputs?.streetType || '', commit: (v) => setInput({ streetType: v || null }, 'Set street type for setbacks') })));
    }
    if (lot.setbacksKey == null && !sb && lot.setbacksStatus == null) {
      box.append(h('p', { class: 'ps-hint', role: 'status' }, 'Working out the setbacks'));
      return box;
    }
    if (!sb) {
      const why = (lot.setbacksAttempts || []).map((a) => plainSetbackReason(a.reason)).filter(Boolean)[0];
      const kids = [
        h('p', { class: 'ps-hint', role: 'status', dataset: { ps: 'setbacks-none' } }, !buildingRings(store.project).length && (lot.setbacksAttempts || []).some((a) => /storey|height|house|design/i.test(a.reason || '')) ? 'Setbacks appear once a house is placed.' : 'Setbacks not available for this lot, check with council.'),
        lot.state === 'QLD' && lot.areaM2 > 450 ? h('p', { class: 'ps-hint' }, 'The Queensland default setbacks cover lots up to 450 m². This lot is larger, so check the council planning scheme or the Queensland Housing Code.') : null,
        why && !/^Setbacks not available/.test(why) ? h('p', { class: 'ps-hint' }, why) : null,
      ].filter(Boolean);
      box.append(...kids);
      return box;
    }
    const rows = [];
    for (const [k, label] of SLOT_LABELS) {
      const slot = sb[k];
      if (!slot) continue;
      const flag = slot.flag === 'check_with_council' || sb.flag === 'check_with_council';
      rows.push(h('tr', null,
        h('td', null, label, slot.clause ? h('div', { class: 'ps-hint', style: { margin: 0 } }, slot.clause) : null),
        h('td', { class: 'num', style: { textAlign: 'right' } }, fmtM(slot.minM, slot), flag ? h('div', { class: 'ps-hint', style: { margin: 0 } }, slot.bca ? slot.basis : 'check with council') : null,
          slot.bca && slot.note ? h('div', { class: 'ps-hint', style: { margin: 0 }, dataset: { ps: 'setbacks-bca-note' } }, slot.note) : null)));
    }
    box.append(h('table', { class: 'ps-table ps-site-facts', dataset: { ps: 'setbacks-table' } }, h('tbody', null, ...rows)));
    const src = sb.source?.kind === 'council' ? (sb.source.dcp || sb.council || 'Council DCP') : `${sb.source?.name || sb.basis}${sb.source?.edition ? `, ${sb.source.edition}` : ''}`;
    box.append(h('p', { class: 'ps-hint', dataset: { ps: 'setbacks-basis' } }, `Basis: ${sb.basis}.`), h('p', { class: 'ps-hint', dataset: { ps: 'setbacks-source' } }, `Source: ${String(src).replace(/[.\s]+$/, '')}.`),
      h('p', { class: 'ps-hint' }, 'Indicative only, check with council. These distances are not a planning or building approval. Confirm with the council or a certifier.'));
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
