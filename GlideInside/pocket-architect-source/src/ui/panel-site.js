// Site section of the summary panel: find a block by address, or show and adjust the lot already in the project.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { section, numberField, checkField, button, formBuilder } from './panel-forms.js';
import { createFindBlock } from './find-block.js';
import { removeSiteLot } from '../site/apply.js';
import { CONFIG } from '../config.js';
import { floorRLOf, defaultFloorRL, centroidRL } from '../site/model.js';
import { askConfirm } from './modal.js';

const LAYER_LABELS = [
  ['boundary', 'Lot boundary'], ['dimensions', 'Boundary lengths'], ['neighbours', 'Neighbouring lots'],
  ['labels', 'Lot and DP labels'], ['aerial', 'Aerial image'], ['contours', 'Contours'],
];

export function buildSiteSection(ctx) {
  const { store } = ctx;
  const root = h('div');
  let key = null;
  let fb = formBuilder();
  let finder = null;
  const lotOf = () => store.project.site?.lot || null;
  const keyOf = () => (lotOf() ? `lot:${lotOf().origin?.e}:${lotOf().lotLabel}` : 'none');

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
      crl != null ? fact('Ground RL at lot centre', `${crl.toFixed(2)} m`) : null);
    const sec = section('Site', h('table', { class: 'ps-table ps-site-facts' }, rows));
    if (!lot.zoning && lot.zoneNote) sec.append(h('p', { class: 'ps-hint' }, lot.zoneNote));
    sec.append(h('p', { class: 'ps-hint' }, `Coordinates are MGA2020 zone ${lot.zone}, plan up is grid north.`));

    const layers = h('div', { class: 'ps-sec', style: { marginTop: '8px' } }, h('h4', null, 'Layers'));
    for (const [id, label] of LAYER_LABELS) {
      if (id === 'aerial' && !lot.aerial) continue;
      if (id === 'contours' && !lot.contours?.length) continue;
      layers.append(fb.add(checkField({ label, get: () => lotOf()?.layers?.[id] !== false, commit: (v) => ctx.apply(`${v ? 'Show' : 'Hide'} ${label.toLowerCase()}`, (p) => { p.site.lot.layers[id] = v; }) })));
    }
    sec.append(layers);

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

    const prov = [];
    if (lot.provenance?.aerial?.attribution) prov.push(lot.provenance.aerial.attribution);
    if (lot.provenance?.lot?.attribution) prov.push(lot.provenance.lot.attribution);
    if (lot.provenance?.elevation?.note) prov.push(lot.provenance.elevation.note);
    prov.push('Boundaries are from the cadastre and are indicative. A registered survey is needed for any construction or approval.');
    if (lot.sample) prov.unshift('SAMPLE DATA: this lot is invented for testing.');
    sec.append(h('p', { class: 'ps-hint' }, prov.join(' ')));

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
