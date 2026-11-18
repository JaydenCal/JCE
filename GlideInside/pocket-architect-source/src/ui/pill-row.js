// One row of small pills along the lower left of the stage (Aerial on or off, Use my own aerial, Grading), so they sit side by side below the
// commercial panel and never over each other or over "Back to placement". The Grading card opens upward from its pill.
import { h } from './dom.js';

export const PILLROW_CSS = `
.ps-pillrow{position:absolute;left:12px;bottom:44px;z-index:15;display:flex;flex-wrap:nowrap;align-items:flex-end;gap:8px;pointer-events:none}
.ps-pillrow>*{pointer-events:auto;position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;margin:0!important}
.ps-pillrow .ps-grading-card{position:absolute;left:0;bottom:calc(100% + 6px);margin:0;z-index:20}
.ps-pillrow .ps-grading{display:block}
`;
let cssDone = false;
export function pillRow(stage) {
  if (typeof document !== 'undefined' && !cssDone) { cssDone = true; const st = document.createElement('style'); st.id = 'ps-pillrow-css'; st.textContent = PILLROW_CSS; document.head.append(st); }
  let row = stage.querySelector(':scope > .ps-pillrow');
  if (!row) { row = h('div', { class: 'ps-pillrow', dataset: { ps: 'pill-row' } }); stage.append(row); }
  return row;
}
