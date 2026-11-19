// The "Site costs" panel: the indicative estimate (low, likely, high) and the editable rates, each with its source note and date.
// Reset puts every default back. Rates are kept with the design, as the builder default, or in this browser (see rates.js). Indicative only, not a quote.

import { el, clear } from '../util.js';
import { plainDashes } from '../../site/plain-text.js';
import { estimateSiteCosts, fmtAud, DISCLAIMER } from './estimate.js';
import { NOT_FOUND } from './council.js';
import { RATE_DEFS, REGIONS, RATES_DATE, saveSettings, resetSettings, regionOf, rateOf, isCustomised, effectiveSettings, mergeSettings, diffSettings, builderDefaults, defaultSettings, settingsSource } from './rates.js';
import { gstOf, GST_NOTE } from './gst.js';

const SOURCE_TEXT = { design: 'This design has its own rates.', builder: 'Rates come from your builder default.', browser: 'Rates are the ones saved in this browser.', default: 'Rates are the standard defaults.' };

// setDesign(overrides|null) saves rates with the design (store.apply on the project). The builder default lives in the portal: globalThis.__ps.siteCostDefaults.
export function openSiteCosts({ layer, getProject, setDesign = null, onChange = null } = {}) {
  let settings = effectiveSettings(getProject());
  const out = el('div', null);
  let msg = '';
  let confirmingRemove = false;
  const hasBuilder = () => !!globalThis.__ps?.siteCostDefaults?.set;
  // With no builder account the rates are kept in this browser, as before. With one, edits are held until saved for the design or as the builder default.
  const persist = () => { if (!hasBuilder() && !getProject()?.siteCosts) saveSettings(settings); onChange?.(settings); };
  const saveDesign = () => { const d = diffSettings(builderDefaults() ? mergeSettings(defaultSettings(), builderDefaults()) : defaultSettings(), settings); setDesign?.(d); msg = d ? 'Saved with this design.' : 'This design now uses the base rates.'; later(); };
  const saveBuilder = async () => {
    try { await globalThis.__ps.siteCostDefaults.set(diffSettings(defaultSettings(), settings) || {}); setDesign?.(null); settings = effectiveSettings(getProject()); msg = 'Saved as your builder default.'; } catch (e) { msg = `Could not save the default: ${e?.message || 'try again'}`; }
    later();
  };

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
      const g = ['low', 'likely', 'high'].map((k) => gstOf(est.total[k]));
      rows.push(el('tr', null, el('td', { colspan: '2' }, 'GST, 10 percent'), ...g.map((x) => el('td', { class: 'psp-num' }, fmtAud(x.gst)))),
        el('tr', { class: 'psp-sc-total' }, el('td', { colspan: '2' }, 'Total, GST included'), ...g.map((x) => el('td', { class: 'psp-num' }, fmtAud(x.incl)))));
      const i = est.inputs || {};
      if (i.earthworksRead) out.append(el('p', { class: 'psp-sc-note', 'data-testid': 'cutfill' }, `Cut ${Math.round(i.cutM3)} cubic metres, fill ${Math.round(i.fillM3)} cubic metres, pad ${Math.round(i.padAreaM2)} square metres, slope ${Math.round((i.slopePct || 0) * 10) / 10} percent.`));
      out.append(el('table', { class: 'psp-sc-table', 'aria-label': 'Indicative site costs' }, el('thead', null, el('tr', null, el('th', null, 'Item'), el('th', { class: 'psp-num' }, 'Quantity'), el('th', { class: 'psp-num' }, 'Low'), el('th', { class: 'psp-num' }, 'Likely'), el('th', { class: 'psp-num' }, 'High'))), el('tbody', null, ...rows)),
        ...est.assumptions.map((a) => el('p', { class: 'psp-sc-note' }, a)), el('p', { class: 'psp-sc-note', 'data-testid': 'gst-note' }, GST_NOTE));
    }
    // Council rules for this lot's council, cited
    if (est.ok) {
      out.append(el('h3', { style: { margin: '14px 0 4px' } }, est.council.found ? `Council rules, ${est.council.council}` : 'Council rules'));
      if (!est.council.found) out.append(el('p', { class: 'psp-sc-note' }, `This lot's council is not in the council database. ${NOT_FOUND}.`));
      else out.append(el('p', { class: 'psp-sc-note' }, `The council's own wording, from its documents. Source: ${est.council.source}.`),
        el('table', { class: 'psp-sc-table', 'aria-label': 'Council rules' }, el('tbody', null, ...est.checks.map((c) => el('tr', null, el('td', null, c.label), el('td', { class: c.status === 'exceeds' ? 'psp-sc-custom' : '' }, c.status === 'not_found' ? NOT_FOUND : c.text, c.status === 'not_found' ? null : el('span', { class: 'psp-sc-src' }, plainDashes(`Council: ${c.council} (${c.cite}) "${c.quote}"`))))))));
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
      el('p', { class: 'psp-sc-note', 'data-testid': 'rate-source' }, SOURCE_TEXT[settingsSource(getProject())], msg ? ` ${msg}` : ''),
      el('div', { class: 'psp-sc-row' },
        setDesign ? el('button', { class: 'psp-btn', type: 'button', dataset: { action: 'save-design' }, onclick: saveDesign }, 'Save rates for this design') : null,
        hasBuilder() ? el('button', { class: 'psp-btn', type: 'button', dataset: { action: 'save-builder' }, onclick: saveBuilder }, 'Save as my builder default') : null,
        // Reset only touches this design and this screen. It never changes the builder default, which every designer and client of the builder uses.
        el('button', { class: 'psp-btn', type: 'button', dataset: { action: 'reset' }, onclick: () => { setDesign?.(null); settings = builderDefaults() ? effectiveSettings(getProject()) : resetSettings(); msg = ''; confirmingRemove = false; onChange?.(settings); later(); } }, hasBuilder() ? 'Reset to the builder rates' : 'Reset all rates to the defaults'),
        hasBuilder() && builderDefaults() && !confirmingRemove ? el('button', { class: 'psp-btn', type: 'button', dataset: { action: 'remove-builder' }, onclick: () => { confirmingRemove = true; later(); } }, 'Remove my builder default') : null),
      hasBuilder() && builderDefaults() && confirmingRemove ? el('div', { class: 'psp-sc-row', role: 'alertdialog', 'aria-label': 'Remove the builder default', dataset: { testid: 'remove-builder-confirm' } },
        el('p', { class: 'psp-sc-note' }, 'This removes the default rates for every designer and client of your builder, in every design that does not carry its own rates. It cannot be undone.'),
        el('button', { class: 'psp-btn', type: 'button', dataset: { action: 'remove-builder-yes' }, onclick: async () => { try { await globalThis.__ps.siteCostDefaults.clear(); setDesign?.(null); settings = effectiveSettings(getProject()); msg = 'The builder default was removed.'; } catch (e) { msg = `Could not remove the default: ${e?.message || 'try again'}`; } confirmingRemove = false; onChange?.(settings); later(); } }, 'Remove it'),
        el('button', { class: 'psp-btn', type: 'button', dataset: { action: 'remove-builder-no' }, onclick: () => { confirmingRemove = false; later(); } }, 'Keep it')) : null);
  }
  render();
  return layer.openModal({ title: 'Site costs, indicative', body: () => out, footer: (close) => el('button', { class: 'psp-btn', type: 'button', onclick: () => close('done') }, 'Close') });
}
