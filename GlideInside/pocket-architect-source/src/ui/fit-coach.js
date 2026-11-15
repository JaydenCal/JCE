// First placement guidance: one short line at a time, in a slim strip beside the plan (never over the lot). Each step waits for the
// person to do the thing (move, turn) or press "Got it"; "Skip tips" ends it. Shown once per browser (localStorage, in try/catch).
//
//   const coach = createCoach({ theme: 'light' | 'glass', steps: [{ id, text, until: 'move' | 'turn' | null }] })
//   host.append(coach.el); coach.start(); coach.did('move')

import { h } from './dom.js';

export const COACH_KEY = 'gi.fit.coach';
export const FLOW_COACH = [
  { id: 'placed', text: 'Your house is on the lot. Drag it to move it.', until: 'move' },
  { id: 'turn', text: 'Drag the yellow dot to turn it.', until: 'turn' },
  { id: 'area', text: 'The shaded area is where a house can go. Keep the house inside it to meet the setbacks.', until: null },
];
export const TOPVIEW_COACH = [
  { id: 'placed', text: 'Your house is on the lot. In the top view, drag it to move it, use the ring to rotate.', until: 'move' },
  { id: 'area', text: 'The dashed area is where a house can go. Keep the house inside it to meet the setbacks.', until: null },
];

export const coachSeen = (storage = (typeof localStorage !== 'undefined' ? localStorage : null)) => { try { return storage?.getItem(COACH_KEY) === 'done'; } catch { return false; } };
export const coachDone = (storage = (typeof localStorage !== 'undefined' ? localStorage : null)) => { try { storage?.setItem(COACH_KEY, 'done'); return true; } catch { return false; } };

/** The next step index after `event` ('move', 'turn', 'ok'): a step waits for its own event, "ok" (Got it) always moves on. Pure. */
export function coachNext(steps, i, event) {
  const s = steps[i];
  if (!s) return i;
  return event === 'ok' || s.until === event ? i + 1 : i;
}

export const COACH_CSS = `
.fitcoach{box-sizing:border-box;display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;border-radius:10px;padding:7px 10px;font:600 13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
.fitcoach[hidden]{display:none!important}
.fitcoach--light{background:#eef3ff;border:1px solid #c5d3f5;color:#16254d}
.fitcoach--glass{background:rgba(10,10,12,.72);border:1px solid rgba(255,255,255,.28);color:#fff;backdrop-filter:blur(8px)}
.fitcoach-n{flex:none;font-size:11.5px;opacity:.7;font-weight:700;letter-spacing:.03em}
.fitcoach-t{flex:1;min-width:150px}
.fitcoach button{font:inherit;cursor:pointer;color:inherit;border-radius:8px;min-height:30px}
.fitcoach-ok{padding:4px 10px;border:1px solid currentColor;background:transparent}
.fitcoach-skip{padding:4px 2px;border:0;background:none;text-decoration:underline;font-weight:500;font-size:12px;opacity:.85}
`;
let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.id = 'fit-coach-css';
  st.textContent = COACH_CSS;
  document.head.append(st);
}

export function createCoach({ theme = 'light', steps = FLOW_COACH, storage, onChange = null } = {}) {
  injectCss();
  let i = -1;
  const n = h('span', { class: 'fitcoach-n' });
  const t = h('span', { class: 'fitcoach-t', dataset: { ps: 'fit-coach-text' } });
  const ok = h('button', { class: 'fitcoach-ok', type: 'button', dataset: { ps: 'fit-coach-ok' }, onclick: () => did('ok') }, 'Got it');
  const skip = h('button', { class: 'fitcoach-skip', type: 'button', dataset: { ps: 'fit-coach-skip' }, onclick: () => finish() }, 'Skip tips');
  const el = h('div', { class: `fitcoach fitcoach--${theme}`, hidden: true, role: 'note', 'aria-live': 'polite', dataset: { ps: 'fit-coach' } }, n, t, ok, skip);
  function paint() {
    const s = steps[i];
    el.hidden = !s;
    if (s) { n.textContent = `Tip ${i + 1} of ${steps.length}`; t.textContent = s.text; skip.hidden = i >= steps.length - 1; }
    onChange?.();
  }
  function finish() { i = steps.length; coachDone(storage); paint(); }
  function did(event) {
    if (i < 0 || i >= steps.length) return;
    const next = coachNext(steps, i, event);
    if (next === i) return;
    i = next;
    if (i >= steps.length) finish(); else paint();
  }
  return {
    el, did,
    /** Show the first step unless the tips were finished before in this browser. */
    start() { if (i >= 0 || coachSeen(storage)) return false; i = 0; paint(); return true; },
    get active() { return i >= 0 && i < steps.length; },
    dispose() { el.remove(); },
  };
}
