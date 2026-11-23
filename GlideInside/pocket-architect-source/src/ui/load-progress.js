// The loading bar: a slim determinate bar with the name of the step in progress. It follows a load tracker (src/site/load-steps.js), so it
// advances only when a real step has completed, never sits at 100 before the load is done, and turns to an error state on failure.
//   variant 'bottom'  along the bottom edge of a view (the viewer, the widget)
//   variant 'inline'  a block inside a card (the guided flow, the Find my block dialog)

import { h } from './dom.js';
import { createLoadTracker } from '../site/load-steps.js';

const HIDE_DONE_MS = 900;
const HIDE_ERROR_MS = 6000; // an error bar fades out after a few seconds (the page or toast carries the message on)

/**
 * createProgressBar(parent, { variant, labels, steps, onChange }) -> { el, tracker, dispose }.
 * Hidden until the tracker starts. After done it shows "Done" briefly, then hides; an error stays until the next start.
 * onChange(state) is also called on every change (the viewer forwards it to the page as gi:status).
 */
export function createProgressBar(parent, { variant = 'inline', labels = {}, steps, onChange = null } = {}) {
  const label = h('span', { class: 'ps-lp-label', dataset: { ps: 'load-label' } });
  const count = h('span', { class: 'ps-lp-count', 'aria-hidden': 'true' });
  const fill = h('span', { class: 'ps-lp-fill' });
  const track = h('span', { class: 'ps-lp-track', 'aria-hidden': 'true' }, fill);
  const el = h('div', { class: `ps-lp ps-lp--${variant}`, hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Loading your block', dataset: { ps: 'load-progress' } }, track, h('span', { class: 'ps-lp-row' }, label, count));
  parent?.append(el);
  let hideT = 0;
  const paint = (s) => {
    clearTimeout(hideT);
    el.hidden = s.status === 'idle';
    el.dataset.state = s.status;
    const pct = Math.round(s.fraction * 100);
    fill.style.width = `${pct}%`;
    el.setAttribute('aria-valuenow', String(pct));
    const text = s.status === 'error' ? (s.message || 'Could not load the block.') : s.label;
    el.setAttribute('aria-valuetext', text);
    label.textContent = text;
    count.textContent = s.status === 'running' ? `${Math.min(s.index, s.total - 1) + 1} of ${s.total}` : '';
    el.dataset.step = String(s.index);
    label.title = text;
    if (s.status === 'done') hideT = setTimeout(() => { el.hidden = true; }, HIDE_DONE_MS);
    else if (s.status === 'error') hideT = setTimeout(() => { el.dataset.fading = '1'; hideT = setTimeout(() => { el.hidden = true; delete el.dataset.fading; }, 400); }, HIDE_ERROR_MS);
    else delete el.dataset.fading;
  };
  const tracker = createLoadTracker({ steps, labels, onChange: (s) => { paint(s); onChange?.(s); } });
  return { el, tracker, paint, dispose() { clearTimeout(hideT); el.remove(); } };
}
