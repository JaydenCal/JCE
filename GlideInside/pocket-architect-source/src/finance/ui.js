// The finance panel: headline cards, and a compact details section (breakdown, every assumption with its default and source, up to 3 saved
// scenarios side by side, the price against cost sensitivity grid, sources). It lives inside the page column it is given and never opens over the
// 3D view. Theme neutral (inherits colour, translucent fills) so it sits in the light flow card, the dark lot card and the editor dock.
import { h } from '../ui/dom.js';
import { GROUPS } from './adapters.js';
import { compute, compareScenarios, COMPARE_ROWS, setValue, resetAll, saveScenario, deleteScenario, loadScenario, readState, MAX_SCENARIOS, DISCLAIMER, kindOf } from './model.js';
import { FINANCE_DATA } from './engine.js';

export const fmt = (v) => `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-AU')}`;
export const pc = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
const STATUS = { VERIFIED_REPORT: 'Report', VERIFIED_SECONDARY: 'Report (secondary)', VERIFIED_LISTING: 'Listing', ESTIMATE: 'Estimate' };
const fmtVal = (kind, v) => (kind === 'money' ? fmt(v) : kind === 'pct' ? pc(v) : String(v));

const CSS = `
.fx{font:400 12.5px/1.4 system-ui,sans-serif;color:inherit;min-width:0}
.fx *{box-sizing:border-box}
.fx-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:10px 0 6px}
.fx-card{border:1px solid rgba(127,127,127,.35);border-radius:10px;padding:8px 10px;background:rgba(127,127,127,.08)}
.fx-card b{display:block;font:600 17px/1.2 system-ui,sans-serif;white-space:nowrap}
.fx-card span{display:block;opacity:.75;font-size:11.5px}
.fx-card i{display:block;font-style:normal;opacity:.6;font-size:11px;margin-top:1px}
.fx-card[data-neg="1"] b{color:#d0463b}
.fx-note{margin:4px 0;opacity:.8;font-size:11.5px}
.fx-warn{margin:4px 0;font-size:12px;color:#c0782a}
.fx-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.fx-btn{font:inherit;border:1px solid rgba(127,127,127,.5);background:rgba(127,127,127,.12);color:inherit;border-radius:8px;padding:5px 11px;cursor:pointer}
.fx-btn:hover:not(:disabled){background:rgba(127,127,127,.25)}
.fx-btn:disabled{opacity:.45;cursor:default}
.fx-btn[aria-pressed="true"]{background:rgba(127,127,127,.35);font-weight:600}
.fx-link{font:inherit;background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;padding:0;opacity:.8}
.fx-sec{border-top:1px solid rgba(127,127,127,.3);margin-top:8px;padding-top:2px}
.fx-sec>summary{cursor:pointer;font-weight:600;padding:6px 0;list-style:none}
.fx-sec>summary::before{content:'+ ';opacity:.6}
.fx-sec[open]>summary::before{content:'- '}
.fx table{width:100%;border-collapse:collapse}
.fx td,.fx th{padding:3px 4px;text-align:right;vertical-align:baseline;border-bottom:1px solid rgba(127,127,127,.15)}
.fx td:first-child,.fx th:first-child{text-align:left}
.fx tr.fx-tot td{font-weight:600;border-top:1px solid rgba(127,127,127,.5)}
.fx th{font-weight:600;opacity:.8;font-size:11.5px}
.fx-row{display:grid;grid-template-columns:minmax(0,1fr) 108px;gap:2px 8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(127,127,127,.12)}
.fx-row label{min-width:0}
.fx-row .fx-lab{font-weight:500}
.fx-row .fx-meta{grid-column:1 / -1;opacity:.65;font-size:11px;display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.fx-in{display:flex;gap:4px;align-items:center}
.fx-in input,.fx-in select,.fx-name{font:inherit;color:inherit;background:rgba(127,127,127,.1);border:1px solid rgba(127,127,127,.4);border-radius:6px;padding:3px 6px;width:100%;min-width:0}
.fx-in input{text-align:right}
.fx-in i{font-style:normal;opacity:.6;font-size:11px;white-space:nowrap}
.fx-chip{border:1px solid rgba(127,127,127,.4);border-radius:99px;padding:0 6px;font-size:10.5px}
.fx-chip[data-s="EDITED"]{border-color:#3b82c4;color:#3b82c4}
.fx-grp{font-weight:600;margin:10px 0 2px;opacity:.9}
.fx-grid td{text-align:center;min-width:64px}
.fx-grid td[data-neg="1"]{color:#d0463b}
.fx-grid td.fx-mid{font-weight:700;background:rgba(127,127,127,.15)}
.fx-scn{display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap}
.fx-scroll{overflow-x:auto}
.fx-src{font-size:11px;opacity:.75}
.fx-src p{margin:3px 0}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  document.head.append(h('style', { dataset: { fx: '1' } }, CSS));
}

/**
 * createFinance(store, { mode }) -> { el, update, dispose }.
 * mode 'step' (default): headline cards and a See details button that opens the details below the cards.
 * mode 'full': the details only, expanded (the lot card panel and the editor).
 */
export function createFinance(store, { mode = 'step', onChange } = {}) {
  ensureCss();
  const root = h('div', { class: 'fx', dataset: { ps: 'fin-root' } });
  const open = { details: mode === 'full', breakdown: true, assumptions: false, scenarios: false, sensitivity: false, sources: false };
  const groupOpen = {};
  let disposed = false;
  let draftName = '';
  const edit = (label, fn) => { store.apply(label, fn); onChange?.(); };

  function cards(c) {
    const r = c.result;
    if (!r) return h('p', { class: 'fx-note' }, c.notes[0] || 'Place a building to see the figures.');
    const res = r.residual;
    const hold = r.mode === 'hold';
    const tile = (key, v, label, sub, neg) => h('div', { class: 'fx-card', dataset: { ps: `fin-${key}`, neg: neg ? '1' : '0' } }, h('b', null, v), h('span', null, label), sub ? h('i', null, sub) : null);
    return h('div', { class: 'fx-cards', dataset: { ps: 'fin-cards' } },
      tile('profit', fmt(r.profit), `Indicative profit, ${hold ? 'hold and lease' : 'sell'}`, `on ${fmt(r.totalCost)} cost`, r.profit < 0),
      tile('margin', pc(r.marginOnCostPct), 'Margin on cost', `${pc(r.marginOnGdvPct)} on value`, r.marginOnCostPct < 0),
      tile('rlv', res.viable ? fmt(res.value) : 'Nil', `Residual land value at ${pc(res.targetPct)}`, res.viable ? 'most to pay for the land' : 'target not reached', false),
      tile('debt', fmt(r.peakDebt), 'Peak debt', `${fmt(r.peakEquity)} equity needed`, false));
  }

  function breakdown(c) {
    const r = c.result;
    const hold = r.mode === 'hold';
    const pct = (v) => (r.totalCost > 0 ? pc((v / r.totalCost) * 100) : '');
    const L = (label, v) => (Math.abs(v) < 0.5 ? null : h('tr', null, h('td', null, label), h('td', null, fmt(v)), h('td', null, pct(v))));
    const rows = [
      L('Land', r.land), L(`Transfer duty (${r.state})`, r.duty), L('Legal and acquisition', r.acquisition),
      L('Design and professional fees', r.professional), L('Approvals and DA fees', r.approvals), L('Council and infrastructure contributions', r.contributions),
      L('Building', r.build), L('Site works', r.siteWorks), L('Earthworks (cut and fill)', r.earthworks), L('Clearing and landscaping', r.landscape),
      L('Contingency', r.contingency), L('Holding costs (rates, insurance)', r.holding),
      L('Loan establishment fee', r.fee), L(`Capitalised interest (${r.months} months)`, r.interest), L(hold ? 'Leasing costs' : 'Selling costs', r.selling),
      h('tr', { class: 'fx-tot' }, h('td', null, 'Total cost'), h('td', null, fmt(r.totalCost)), h('td', null, '100%')),
    ];
    const rev = [
      hold ? ['Net rent a year', fmt(r.netRent)] : ['Gross sale value (GDV)', fmt(r.gdvQuoted)],
      !hold && r.gstPayable ? [r.gstMode === 'margin' ? 'GST payable (margin scheme)' : 'GST payable', fmt(-r.gstPayable)] : null,
      hold ? ['End value by capitalisation', fmt(r.endValue)] : ['Net revenue', fmt(r.revenue)],
      ['Profit', fmt(r.profit)], ['Margin on cost', pc(r.marginOnCostPct)], ['Margin on value', pc(r.marginOnGdvPct)], ['Development yield on cost', pc(r.yieldOnCostPct)],
      ['Residual land value', r.residual.viable ? fmt(r.residual.value) : 'Nil, target not reached'],
      ['Peak debt', fmt(r.peakDebt)], ['Equity needed', fmt(r.peakEquity)], ['Loan facility', fmt(r.facility)],
    ].filter(Boolean);
    const lines = r.revenueLines.length > 1 ? h('table', { dataset: { ps: 'fin-revenue-lines' } }, h('thead', null, h('tr', null, h('th', null, 'Revenue line'), h('th', null, 'm2'), h('th', null, 'Sale $/m2'), h('th', null, 'Rent $/m2'))),
      h('tbody', null, ...r.revenueLines.map((l) => h('tr', null, h('td', null, l.label), h('td', null, (Math.round(l.qty * 10) / 10).toLocaleString('en-AU')), h('td', null, Math.round(l.saleRate).toLocaleString('en-AU')), h('td', null, Math.round(l.rentRate).toLocaleString('en-AU')))))) : null;
    return [h('div', { class: 'fx-scroll' }, h('table', { dataset: { ps: 'fin-breakdown' } }, h('thead', null, h('tr', null, h('th', null, 'Cost'), h('th', null, '$'), h('th', null, '% of cost'))), h('tbody', null, ...rows))),
      h('table', { style: { marginTop: '8px' }, dataset: { ps: 'fin-outputs' } }, h('tbody', null, ...rev.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v))))), lines];
  }

  function assumptionRow(d) {
    const cur = d.kind === 'select'
      ? (() => { const s = h('select', { 'aria-label': d.label, dataset: { k: d.key, ps: `fin-in-${d.key}` }, onchange: () => edit(`Set ${d.label.toLowerCase()}`, (q) => setValue(q, d, s.value)) }, ...d.options.map(([v, l]) => h('option', { value: v }, l))); s.value = d.value; return s; })()
      : (() => {
        const i = h('input', { type: 'number', min: 0, max: d.max, step: d.step, value: d.value, 'aria-label': d.label, dataset: { k: d.key, ps: `fin-in-${d.key}` }, onchange: () => edit(`Set ${d.label.toLowerCase()}`, (q) => setValue(q, d, i.value === '' ? null : i.value)) });
        return i;
      })();
    const range = d.low != null && d.high != null ? `range ${Number(d.low).toLocaleString('en-AU')} to ${Number(d.high).toLocaleString('en-AU')}` : '';
    const defTxt = d.kind === 'select' ? '' : `default ${Number(d.defaultValue).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
    return h('div', { class: 'fx-row', dataset: { ps: 'fin-row', k: d.key, edited: d.edited ? '1' : '0' } },
      h('label', null, h('span', { class: 'fx-lab' }, d.label), d.unit ? h('span', { style: { opacity: .6 } }, ` (${d.unit})`) : null),
      h('div', { class: 'fx-in' }, cur),
      h('div', { class: 'fx-meta' },
        h('span', { class: 'fx-chip', dataset: { s: d.edited ? 'EDITED' : d.status }, title: d.source }, d.edited ? 'Edited' : (STATUS[d.status] || d.status)),
        defTxt ? h('span', null, defTxt) : null, range ? h('span', null, range) : null, h('span', null, d.asAt),
        d.edited ? h('button', { type: 'button', class: 'fx-link', dataset: { ps: `fin-reset-${d.key}` }, onclick: () => edit(`Reset ${d.label.toLowerCase()}`, (q) => setValue(q, d, null)) }, 'Reset') : null));
  }

  function assumptions(c) {
    const anyEdited = c.model.descs.some((d) => d.edited);
    const out = [h('div', { class: 'fx-bar' }, h('button', { type: 'button', class: 'fx-btn', disabled: !anyEdited, dataset: { ps: 'fin-reset-all' }, onclick: () => edit('Reset all finance assumptions', (q) => resetAll(q)) }, 'Reset all to defaults'), h('span', { class: 'fx-note' }, 'Every value is editable. Hover a status chip for its source.'))];
    for (const [gk, gl] of GROUPS) {
      const ds = c.model.descs.filter((d) => d.group === gk);
      if (!ds.length) continue;
      out.push(h('div', { class: 'fx-grp' }, gl), ...ds.map(assumptionRow));
    }
    return out;
  }

  function scenarios(project) {
    const st = readState(project);
    const full = st.scenarios.length >= MAX_SCENARIOS;
    const nameIn = h('input', { class: 'fx-name', type: 'text', maxlength: 24, placeholder: full ? 'Type a saved name to replace it' : 'Name, for example Sell, Hold, Staged', value: draftName, 'aria-label': 'Scenario name', dataset: { ps: 'fin-scn-name' }, oninput: () => { draftName = nameIn.value; } });
    const save = h('button', { type: 'button', class: 'fx-btn', dataset: { ps: 'fin-scn-save' }, onclick: () => {
      let ok = true;
      edit('Save scenario', (q) => { ok = saveScenario(q, draftName); });
      if (ok) { draftName = ''; render(); } else nameIn.placeholder = 'Three scenarios saved. Delete one first.';
    } }, 'Save current as scenario');
    const list = st.scenarios.map((s) => h('div', { class: 'fx-scn', dataset: { ps: 'fin-scn', id: s.id } },
      h('b', null, s.name),
      h('button', { type: 'button', class: 'fx-btn', dataset: { ps: 'fin-scn-load' }, onclick: () => edit('Load scenario', (q) => loadScenario(q, s.id)) }, 'Load'),
      h('button', { type: 'button', class: 'fx-btn', dataset: { ps: 'fin-scn-del' }, onclick: () => edit('Delete scenario', (q) => deleteScenario(q, s.id)) }, 'Delete')));
    const cols = compareScenarios(project);
    const table = h('div', { class: 'fx-scroll' }, h('table', { dataset: { ps: 'fin-compare' } },
      h('thead', null, h('tr', null, h('th', null, ''), ...cols.map((x) => h('th', null, x.name)))),
      h('tbody', null, ...COMPARE_ROWS.map(([k, label, get, kind]) => h('tr', null, h('td', null, label), ...cols.map((x) => h('td', { dataset: { neg: x.result && kind !== 'text' && (k === 'profit' || k === 'marginOnCostPct') && get(x.result) < 0 ? '1' : '0' } }, x.result ? fmtVal(kind, get(x.result)) : 'n/a')))))));
    return [h('p', { class: 'fx-note' }, `Change the assumptions, then save the set as a scenario. Up to ${MAX_SCENARIOS} per project. Load one to edit it again.`),
      h('div', { class: 'fx-scn' }, nameIn, save), ...list, table];
  }

  function sensitivity(c) {
    const g = c.result.sensitivity;
    const head = h('thead', null, h('tr', null, h('th', null, 'Margin on cost'), ...g.steps.map((k) => h('th', null, `Cost ${k > 0 ? '+' : ''}${k}%`))));
    const body = h('tbody', null, ...g.cells.map((row, i) => h('tr', null, h('td', null, `Price ${g.steps[i] > 0 ? '+' : ''}${g.steps[i]}%`), ...row.map((cell) => h('td', { class: cell.price === 0 && cell.cost === 0 ? 'fx-mid' : '', title: `Profit ${fmt(cell.profit)}`, dataset: { neg: cell.margin < 0 ? '1' : '0' } }, pc(cell.margin))))));
    return [h('div', { class: 'fx-scroll' }, h('table', { class: 'fx-grid', dataset: { ps: 'fin-sens' } }, head, body)),
      h('p', { class: 'fx-note' }, 'Price moves the sale value and the rent. Cost moves the building, site works and earthworks, and the fees that follow them. Hover a cell for the profit.')];
  }

  function sources(c) {
    const seen = new Set();
    const rows = [];
    for (const d of c.model.descs) {
      const key = d.source || '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(h('p', null, h('b', null, `${d.label}: `), `${STATUS[d.status] || d.status}, ${d.asAt}. ${key}`));
    }
    const duty = FINANCE_DATA.duty[c.model.state];
    return h('div', { class: 'fx-src', dataset: { ps: 'fin-sources' } }, ...rows, h('p', null, h('b', null, 'Transfer duty: '), `${duty.name}, as at ${duty.asAt}. ${duty.source}. ${duty.note}`));
  }

  const section = (key, title, body) => h('details', { class: 'fx-sec', open: open[key] === true, dataset: { ps: `fin-sec-${key}` }, ontoggle: (e) => { open[key] = e.currentTarget.open; } }, h('summary', null, title), body);

  function modeBar(c) {
    const cur = c.model.input.mode;
    const d = c.model.descs.find((x) => x.key === 'mode');
    const mk = (v, l) => h('button', { type: 'button', class: 'fx-btn', 'aria-pressed': String(cur === v), dataset: { ps: `fin-mode-${v}` }, onclick: () => edit('Set exit', (q) => setValue(q, d, v)) }, l);
    return h('div', { class: 'fx-bar' }, h('span', null, 'Exit:'), mk('sell', 'Sell'), mk('hold', 'Hold and lease'),
      h('span', { class: 'fx-note' }, `${c.model.areaLabel}, ${c.model.state}`));
  }

  function details(c, project) {
    if (!c.result) return h('div', { class: 'fx-det' }, h('p', { class: 'fx-note' }, c.notes[0] || 'Place a building to see the figures.'));
    return h('div', { class: 'fx-det', dataset: { ps: 'fin-details' } },
      modeBar(c),
      section('breakdown', 'Full breakdown', h('div', null, ...breakdown(c))),
      section('assumptions', 'Assumptions (every value editable)', h('div', null, ...assumptions(c))),
      section('scenarios', 'Scenarios, side by side', h('div', null, ...scenarios(project))),
      section('sensitivity', 'Sensitivity, price against cost', h('div', null, ...sensitivity(c))),
      section('sources', 'Sources and dates', sources(c)));
  }

  function render() {
    if (disposed) return;
    const project = store.project;
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const keep = active?.dataset?.ps ? { ps: active.dataset.ps, k: active.dataset.k } : null;
    const scrollTops = [...root.querySelectorAll('.fx-scroll')].map((e) => e.scrollLeft);
    let c;
    try { c = compute(project); } catch (e) { root.replaceChildren(h('p', { class: 'fx-note' }, 'The figures could not be worked out for this design.')); return; }
    const detailsEl = h('div', { class: 'fx-wrap' }, details(c, project));
    const notes = c.sanity || [];
    const parts = [];
    if (mode === 'step') {
      parts.push(cards(c));
      for (const t of notes) parts.push(h('p', { class: 'fx-warn', dataset: { ps: 'fin-note' } }, t));
      if (c.result) for (const t of c.model.notes) parts.push(h('p', { class: 'fx-note' }, t));
      parts.push(h('div', { class: 'fx-bar' }, h('button', { type: 'button', class: 'fx-btn', dataset: { ps: 'fin-details-toggle' }, 'aria-expanded': String(open.details), onclick: () => { open.details = !open.details; render(); } }, open.details ? 'Hide details' : 'See details'), h('span', { class: 'fx-note' }, 'Edit assumptions, compare scenarios, check sensitivity.')));
      if (open.details) parts.push(detailsEl);
    } else {
      parts.push(cards(c));
      for (const t of notes) parts.push(h('p', { class: 'fx-warn', dataset: { ps: 'fin-note' } }, t));
      parts.push(detailsEl);
    }
    parts.push(h('p', { class: 'fx-note', dataset: { ps: 'fin-disclaimer' } }, DISCLAIMER));
    root.replaceChildren(...parts);
    root.querySelectorAll('.fx-scroll').forEach((e, i) => { if (scrollTops[i]) e.scrollLeft = scrollTops[i]; });
    if (keep) {
      const el = root.querySelector(`[data-ps="${keep.ps}"]${keep.k ? `[data-k="${keep.k}"]` : ''}`);
      if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch { /* ignore */ } }
    }
  }

  render();
  const off = store.on('project', () => { if (!disposed) render(); });
  return { el: root, update: render, dispose() { disposed = true; off?.(); }, kind: () => kindOf(store.project) };
}
