// The Grading panel: a compact card at the lower left of the stage (never over the middle of the 3D view). Pad level per pad in 50 mm steps,
// batter 1 in 3 or 1 in 4, the cut and fill heat map, the indicative volumes and the grade check lines, and Auto reset. The controls write
// project.site.grading = { pads: { 'pad:0': metres }, batter: 3 | 4, heat: bool }; removing it is the automatic design exactly.
// Wording is indicative. No dashes in text.
import { h } from './dom.js';
import { gradingReport } from '../viewer3d/grading-report.js';

export const GRADING_CSS = `
.ps-grading{position:absolute;left:12px;bottom:124px;z-index:15;font:500 12px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#fff}
.ps-grading-btn{height:30px;padding:0 12px;border-radius:15px;border:1px solid rgba(255,255,255,.28);background:rgba(10,10,12,.76);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);color:#fff;cursor:pointer;font:inherit}
.ps-grading-card{margin-top:6px;width:232px;max-height:46vh;overflow:auto;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.22);background:rgba(10,10,12,.86);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}
.ps-grading-card[hidden],.ps-grading[hidden]{display:none!important}
.ps-grading-card h4{margin:8px 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.7;font-weight:600}
.ps-grading-card h4:first-child{margin-top:0}
.ps-grading-row{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:3px 0}
.ps-grading-row button{min-width:26px;height:24px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font:inherit}
.ps-grading-row button[aria-pressed=true]{background:#fff;color:#111}
.ps-grading-note{opacity:.85;margin:3px 0}
.ps-grading-note.warn{color:#ffd27a}
`;
let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style'); st.id = 'ps-grading-css'; st.textContent = GRADING_CSS; document.head.append(st);
}

const mm = (m) => `${m >= 0 ? '+' : ''}${Math.round(m * 1000)} mm`;

/** Write the grading controls. patch(g) edits a copy of project.site.grading. */
export function setGrading(store, patch) {
  store.apply('Grading', (p) => {
    const g = { ...(p.site.grading || {}) };
    g.pads = { ...(g.pads || {}) };
    patch(g);
    const empty = !g.heat && !g.batter && !Object.values(g.pads).some((v) => v);
    if (empty) delete p.site.grading; else p.site.grading = g;
  });
}
export const autoReset = (store) => store.apply('Grading reset', (p) => { delete p.site.grading; });

/** @returns {{ el, sync, dispose }} */
export function createGradingPanel({ store }) {
  injectCss();
  const card = h('div', { class: 'ps-grading-card', hidden: true });
  const btn = h('button', { class: 'ps-grading-btn', type: 'button', 'aria-expanded': 'false', onclick: () => { card.hidden = !card.hidden; btn.setAttribute('aria-expanded', String(!card.hidden)); if (!card.hidden) sync(); } }, 'Grading');
  const el = h('div', { class: 'ps-grading', dataset: { ps: 'grading-panel' }, hidden: true }, btn, card);
  let timer = null;
  function render() {
    const p = store.project; const lot = p?.site?.lot;
    el.hidden = !lot?.terrain;
    if (el.hidden || card.hidden) return;
    const rep = gradingReport(p);
    const g = p.site.grading || {};
    const kids = [];
    if (!rep) { card.replaceChildren(h('p', { class: 'ps-grading-note' }, 'Grading needs ground levels for this lot.')); return; }
    kids.push(h('h4', null, 'Pad level'));
    for (const pad of rep.pads) {
      const user = Number(g.pads?.[pad.id]) || 0;
      const label = `Pad ${Number(pad.id.split(':')[1]) + 1}: ${mm(pad.dy)}${user ? ` (${mm(user)} set)` : ' auto'}`;
      kids.push(h('div', { class: 'ps-grading-row' }, h('span', null, label), h('span', null,
        h('button', { type: 'button', title: 'Lower 50 mm', onclick: () => setGrading(store, (n) => { n.pads[pad.id] = Math.round(((Number(n.pads[pad.id]) || 0) - 0.05) * 100) / 100; }) }, '-'),
        h('button', { type: 'button', title: 'Raise 50 mm', onclick: () => setGrading(store, (n) => { n.pads[pad.id] = Math.round(((Number(n.pads[pad.id]) || 0) + 0.05) * 100) / 100; }) }, '+'))));
    }
    kids.push(h('h4', null, 'Batter'));
    kids.push(h('div', { class: 'ps-grading-row' }, h('span', null, 'Slope'), h('span', null,
      h('button', { type: 'button', 'aria-pressed': String(g.batter !== 4), onclick: () => setGrading(store, (n) => { delete n.batter; }) }, '1 in 3'),
      h('button', { type: 'button', 'aria-pressed': String(g.batter === 4), onclick: () => setGrading(store, (n) => { n.batter = 4; }) }, '1 in 4'))));
    kids.push(h('h4', null, 'Cut and fill'));
    kids.push(h('div', { class: 'ps-grading-row' }, h('span', null, 'Heat map (red cut, blue fill)'), h('button', { type: 'button', 'aria-pressed': String(!!g.heat), onclick: () => setGrading(store, (n) => { if (n.heat) delete n.heat; else n.heat = true; }) }, g.heat ? 'On' : 'Off')));
    const v = rep.volumes;
    kids.push(h('p', { class: 'ps-grading-note' }, `Cut ${v.cutM3} m³, fill ${v.fillM3} m³, net ${v.netM3 >= 0 ? 'fill' : 'cut'} ${Math.abs(v.netM3)} m³. Deepest cut ${v.deepestCutM} m, fill ${v.deepestFillM} m. Indicative.`));
    kids.push(h('h4', null, 'Grade check'));
    for (const l of rep.lines) kids.push(h('p', { class: `ps-grading-note${l.within ? '' : ' warn'}` }, l.text));
    kids.push(h('div', { class: 'ps-grading-row' }, h('span', null, ''), h('button', { type: 'button', onclick: () => autoReset(store) }, 'Auto reset')));
    card.replaceChildren(...kids);
  }
  function sync() { clearTimeout(timer); timer = setTimeout(render, 250); el.hidden = !store.project?.site?.lot?.terrain; }
  const off = store.on('project', sync);
  sync();
  return { el, sync, render, dispose: () => { clearTimeout(timer); off?.(); } };
}
