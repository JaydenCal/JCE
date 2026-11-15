// The site rules panel: editable setbacks, site coverage, landscaping, parking and accessible bay rates, and the currency symbol. The values
// start as Australian defaults, each labelled "Australian default, set your local rule" until the person changes it.

import { h, clear } from '../../ui/dom.js';
import { openModal } from '../../ui/modal.js';
import { injectUploadCss } from './css.js';
import { FIELDS, CURRENCIES, DEFAULT_LABEL, customRulesOn, needsCustomRules, newCustomRules, applyCustomRules, isDefaultValue } from '../custom-rules.js';

/** openRulesPanel(store) -> modal handle, or null when there is no lot. */
export function openRulesPanel(store) {
  injectUploadCss();
  const lot0 = store.project.site?.lot;
  if (!lot0) return null;
  const commercial = store.project.mode === 'commercial';
  const body = h('div', { class: 'up-wrap', dataset: { ps: 'rules-panel' } });
  const lot = () => store.project.site?.lot;
  const rules = () => lot()?.customRules || newCustomRules({ commercial, cls: store.project.commercial?.useClass || 'industrial', on: false });

  function paint() {
    clear(body);
    const l = lot();
    const forced = needsCustomRules(l);
    const r = rules();
    const on = customRulesOn(l);
    body.append(h('p', { class: 'up-hint' }, forced
      ? 'There is no council lookup for this site. Set the rules that apply where it is. The setbacks, coverage, landscaping and parking checks use these values.'
      : 'Tick custom rules to use your own values instead of the council rules for this lot.'));
    if (!forced) body.append(h('label', { class: 'up-row' }, h('input', { type: 'checkbox', checked: on, dataset: { ps: 'rules-on' }, onchange: (e) => { applyCustomRules(store, { on: e.target.checked }); paint(); } }), h('span', null, 'Custom rules (no council lookup)')));
    if (forced || on) {
      const grid = h('div', { class: 'up-rules-grid' });
      for (const f of FIELDS) {
        if (f.commercialOnly && !commercial) continue;
        const val = r[f.key];
        const isDef = isDefaultValue(r, f.key);
        const input = h('input', { type: 'number', class: 'ps-input', min: String(f.min), max: String(f.max), step: String(f.step), value: String(val), 'aria-label': f.label, dataset: { rule: f.key } });
        input.addEventListener('keydown', (e) => e.stopPropagation());
        input.addEventListener('change', () => { applyCustomRules(store, { [f.key]: input.value }); paint(); });
        grid.append(h('label', null, f.label), input, h('span', { class: 'up-lbl' }, f.unit), h('div', { class: 'up-def' }, h('span', { class: `up-tag${isDef ? '' : ' is-set'}` }, isDef ? DEFAULT_LABEL : 'Set by you')));
      }
      body.append(grid);
      const cur = h('select', { class: 'ps-input', 'aria-label': 'Currency', dataset: { ps: 'rules-currency' } }, ...CURRENCIES.map((c) => h('option', { value: c.code }, c.label)));
      cur.value = r.currency || 'AUD';
      cur.addEventListener('change', () => { applyCustomRules(store, { currency: cur.value }); paint(); });
      const sym = h('input', { type: 'text', class: 'ps-input up-num', maxlength: '6', value: r.symbol ?? '', 'aria-label': 'Currency symbol', hidden: r.currency !== 'OTHER' });
      sym.addEventListener('keydown', (e) => e.stopPropagation());
      sym.addEventListener('change', () => { applyCustomRules(store, { symbol: sym.value }); });
      body.append(h('div', { class: 'up-sec' }, h('h3', null, 'Currency'), h('div', { class: 'up-row' }, cur, sym),
        h('p', { class: 'up-hint' }, 'The currency only changes the symbol. No exchange rate is applied. The land, sale, rent and build rates in the yield figures are Australian market figures, enter your own rates there. Units stay metric.')));
    }
  }
  paint();
  return openModal({ title: 'Site rules', size: 'md', body, footer: (close) => [h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: () => close('done') }, 'Done')] });
}
