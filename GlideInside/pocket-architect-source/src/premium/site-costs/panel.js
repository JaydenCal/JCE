// The "Site costs" panel: the indicative estimate (low, likely, high) and the editable rates, each with its source note and date.
// Reset puts every default back. Rates are kept in this browser (see rates.js). Indicative only, not a quote.

import { el, clear } from '../util.js';
import { estimateSiteCosts, fmtAud, DISCLAIMER } from './estimate.js';
import { NOT_FOUND } from './council.js';
import { RATE_DEFS, REGIONS, RATES_DATE, loadSettings, saveSettings, resetSettings, regionOf, rateOf, isCustomised } from './rates.js';

export function openSiteCosts({ layer, getProject, onChange = null } = {}) {
  let settings = loadSettings();
  const out = el('div', null);
  const persist = () => { saveSettings(settings); onChange?.(settings); };

  // Re-render after the current event finishes: a field being edited is replaced, and replacing it inside its own change event upsets blur handling.
  const later = () => setTimeout(render, 0);
  function render() {
    clear(out);
    const project = getProject();
    const lot = project?.site?.lot;
    const region = regionOf(lot, settings);
    const est = estimateSiteCosts(project, { settings });
    const regionSel = el('select', { class: 'psp-input', 'aria-label': 'Rate region', onchange: (e) => { settings = { ...settings, region: e.target.value }; persist(); later(); } },
      ...[['auto', `Automatic (${REGIONS[regionOf(lot, { region: 'auto' })]})`], ['nsw', REGIONS.nsw], ['qld', REGIONS.qld]].map(([v, t]) => el('option', { value: v, selected: settings.region === v }, t)));
    const rock = el('input', { type: 'checkbox', id: 'sc-rock', checked: !!settings.rock?.enabled, onchange: (e) => { settings = { ...settings, rock: { ...settings.rock, enabled: e.target.checked } }; persist(); later(); } });
    out.append(el('p', { class: 'psp-sc-note' }, DISCLAIMER),
      el('div', { class: 'psp-sc-row' }, el('label', null, 'Rates for ', regionSel), el('label', null, rock, ' Allow for rock excavation')));
    if (!est.ok) { out.append(el('p', null, 'Find the lot first. The estimate needs a lot on the design.')); }
    else {
      const rows = [];
      let group = null;
      for (const l of [...est.lines, ...est.surcharges, est.contingency]) {
        if (l.group !== group) { group = l.group; rows.push(el('tr', { class: 'psp-sc-group' }, el('td', { colspan: '5' }, group))); }
        rows.push(el('tr', null, el('td', null, l.label, el('span', { class: 'psp-sc-src' }, l.note)), el('td', { class: 'psp-num' }, `${Math.round(l.qty * 10) / 10} ${l.unit}`), el('td', { class: 'psp-num' }, fmtAud(l.low)), el('td', { class: 'psp-num' }, fmtAud(l.likely)), el('td', { class: 'psp-num' }, fmtAud(l.high))));
      }
      rows.push(el('tr', { class: 'psp-sc-total' }, el('td', { colspan: '2' }, 'Total, GST excluded'), el('td', { class: 'psp-num' }, fmtAud(est.total.low)), el('td', { class: 'psp-num' }, fmtAud(est.total.likely)), el('td', { class: 'psp-num' }, fmtAud(est.total.high))));
      out.append(el('table', { class: 'psp-sc-table', 'aria-label': 'Indicative site costs' }, el('thead', null, el('tr', null, el('th', null, 'Item'), el('th', { class: 'psp-num' }, 'Quantity'), el('th', { class: 'psp-num' }, 'Low'), el('th', { class: 'psp-num' }, 'Likely'), el('th', { class: 'psp-num' }, 'High'))), el('tbody', null, ...rows)),
        ...est.assumptions.map((a) => el('p', { class: 'psp-sc-note' }, a)));
    }
    // Council rules for this lot's council, cited
    if (est.ok) {
      out.append(el('h3', { style: { margin: '14px 0 4px' } }, est.council.found ? `Council rules, ${est.council.council}` : 'Council rules'));
      if (!est.council.found) out.append(el('p', { class: 'psp-sc-note' }, `This lot's council is not in the council database. ${NOT_FOUND}.`));
      else out.append(el('p', { class: 'psp-sc-note' }, `The council's own wording, from its documents. Source: ${est.council.source}.`),
        el('table', { class: 'psp-sc-table', 'aria-label': 'Council rules' }, el('tbody', null, ...est.checks.map((c) => el('tr', null, el('td', null, c.label), el('td', { class: c.status === 'exceeds' ? 'psp-sc-custom' : '' }, c.status === 'not_found' ? NOT_FOUND : c.text, c.status === 'not_found' ? null : el('span', { class: 'psp-sc-src' }, `Council: ${c.council} (${c.cite}) "${c.quote}"`)))))));
    }
    // Rates
    out.append(el('h3', { style: { margin: '14px 0 4px' } }, `Rates, ${REGIONS[region]} (dollars, GST excluded)`), el('p', { class: 'psp-sc-note' }, `Defaults dated ${RATES_DATE}. Change a figure to use your own. Low and high follow from the likely rate.`));
    const rrows = [];
    let g = null;
    for (const d of RATE_DEFS) {
      if (d.group !== g) { g = d.group; rrows.push(el('tr', { class: 'psp-sc-group' }, el('td', { colspan: '3' }, g))); }
      const custom = isCustomised(settings, d.id, region);
      const input = el('input', { class: 'psp-input psp-sc-rate', type: 'number', min: '0', step: d.kind === 'factor' ? '0.05' : '1', value: String(rateOf(settings, d.id, region)), 'aria-label': `${d.label} rate`, dataset: { rate: d.id },
        onchange: (e) => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < 0) { e.target.value = String(rateOf(settings, d.id, region)); return; } settings = { ...settings, rates: { ...settings.rates, [d.id]: { ...(settings.rates[d.id] || {}), [region]: v } } }; persist(); later(); } });
      rrows.push(el('tr', null, el('td', null, el('span', { class: custom ? 'psp-sc-custom' : '' }, d.label), el('span', { class: 'psp-sc-src' }, `${d.source} Default dated ${RATES_DATE}.`)), el('td', null, input), el('td', { class: 'psp-num' }, `${d.unit}${custom ? ` (default ${d[region]})` : ''}`)));
    }
    out.append(el('table', { class: 'psp-sc-table', 'aria-label': 'Rates' }, el('tbody', null, ...rrows)),
      el('div', { class: 'psp-sc-row' }, el('button', { class: 'psp-btn', type: 'button', dataset: { action: 'reset' }, onclick: () => { settings = resetSettings(); onChange?.(settings); later(); } }, 'Reset all rates to the defaults')));
  }
  render();
  return layer.openModal({ title: 'Site costs, indicative', body: () => out, footer: (close) => el('button', { class: 'psp-btn', type: 'button', onclick: () => close('done') }, 'Close') });
}
