// The fit card: when the house does not fit the lot it says what is wrong and where in plain words, and offers one tap fixes, each with
// Undo. Also the gentle slope note and "Driveway re-routed". The words and the fixes come from src/site/fit-advice.js; this is the DOM.
// Used by the guided flow (steps 3 and 4), the lot card (homepage embed and the editor's 3D view) and the editor's Move house tool.
// It never sits over the lot: each host puts `el` in its own panel. Everything can be dismissed.
//
//   const card = createFitCard({ store, theme: 'light' | 'glass', onDesigns, onNarrower, onEngineer, canEngineer, onSides })
//   host.append(card.el); card.update();   card.dispose()

import { h } from './dom.js';
import { fitCardModel, applyFix, ENGINEER_LABEL, NOTHING_FITS } from '../site/fit-advice.js';
import { onSiteNote } from '../site/site-items.js';

export const FIT_CARD_CSS = `
.fitc{box-sizing:border-box;border-radius:12px;padding:10px 12px;font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;gap:8px}
.fitc[hidden]{display:none!important}
.fitc--light{background:#fff7e8;border:1px solid #f0cf8f;color:#3a2a08}
.fitc--light[data-tone="ok"]{background:#eaf6ef;border-color:#b6dcc6;color:#12452f}
.fitc--light[data-tone="note"]{background:#f1f4fb;border-color:#cfd8ee;color:#1d2a44}
.fitc--glass{background:rgba(255,190,90,.14);border:1px solid rgba(255,200,110,.5);color:#fff}
.fitc--glass[data-tone="ok"]{background:rgba(111,211,154,.14);border-color:rgba(111,211,154,.5)}
.fitc--glass[data-tone="note"]{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25)}
.fitc-hd{display:flex;align-items:flex-start;gap:8px}
.fitc-t{flex:1;font-weight:700;font-size:14px;line-height:1.3;margin:0}
.fitc-x{flex:none;width:26px;height:26px;margin:-3px -4px 0 0;border-radius:13px;border:0;background:transparent;color:inherit;font:inherit;font-size:16px;line-height:1;cursor:pointer;opacity:.75}
.fitc-x:hover{opacity:1;background:rgba(127,127,127,.18)}
.fitc p{margin:0}
.fitc-acts{display:flex;flex-wrap:wrap;gap:6px}
.fitc-btn{font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;min-height:34px;padding:7px 12px;border-radius:9px;cursor:pointer;border:1px solid currentColor;background:transparent;color:inherit;text-align:left}
.fitc--light .fitc-btn{border-color:#c9a45a;background:#fff}
.fitc--light .fitc-btn.is-pri{background:#1b4fd1;border-color:#1b4fd1;color:#fff}
.fitc--glass .fitc-btn{border-color:rgba(255,255,255,.45)}
.fitc--glass .fitc-btn.is-pri{background:#fff;border-color:#fff;color:#14161a}
.fitc-btn:disabled{opacity:.55;cursor:default}
.fitc-done{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-weight:600}
.fitc-link{padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer}
.fitc-sub{font-size:12.5px;opacity:.92;border-top:1px solid rgba(127,127,127,.3);padding-top:7px}
.fitc-pill{align-self:flex-start;font:600 12.5px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;padding:6px 10px;border-radius:999px;cursor:pointer;border:1px solid currentColor;background:transparent;color:inherit}
.fitc.is-min{padding:6px 8px;background:transparent;border-color:transparent}
`;
// "Make it narrower" from the homepage viewer opens the full editor on another page: the guidance waits here for it (ten minutes at most).
export const GUIDANCE_KEY = 'gi.fit.guidance';
export function stashGuidance(text, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { storage?.setItem(GUIDANCE_KEY, JSON.stringify({ at: Date.now(), text: String(text).slice(0, 400) })); return true; } catch { return false; }
}
export function takeGuidance(storage = (typeof localStorage !== 'undefined' ? localStorage : null), now = Date.now()) {
  try {
    const raw = storage?.getItem(GUIDANCE_KEY);
    if (!raw) return '';
    storage.removeItem(GUIDANCE_KEY);
    const v = JSON.parse(raw);
    return v && typeof v.text === 'string' && now - Number(v.at) < 600000 ? v.text : '';
  } catch { return ''; }
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.id = 'fit-card-css';
  st.textContent = FIT_CARD_CSS;
  document.head.append(st);
}

/**
 * Options:
 *   theme        'light' (guided flow, editor panel) or 'glass' (over the dark lot card)
 *   onDesigns    () => true | false | Promise   show or place designs that fit; false means none of them fits
 *   onNarrower   () => void                     hand off to the floor plan editor
 *   onEngineer   () => void   canEngineer () => boolean
 *   onSides      (sides) => void                the breaching boundary edges, for the host to highlight ([] when it fits)
 *   compact      true: one line of text (phone and the lot card)
 */
export function createFitCard({ store, theme = 'light', onDesigns = null, onNarrower = null, onEngineer = null, canEngineer = () => true, canDesigns = () => true, onSides = null, compact = false, onChange = null }) {
  injectCss();
  const el = h('section', { class: `fitc fitc--${theme}`, hidden: true, role: 'status', 'aria-live': 'polite', 'aria-label': 'House fit', dataset: { ps: 'fit-card' } });
  let disposed = false;
  let done = null; // { text, stamp } after a fix: "Auto fit applied. Undo"
  let note = null; // { text, stamp } "Driveway re-routed to suit the new position. Undo"
  let minimised = false;
  let slopeOff = null; // lot key the slope note was dismissed for
  let nothingFits = false;
  let applying = false;
  let live = false;
  let timer = 0;
  let lastKey = '';
  let viewed = null; // the preview copy while a drag is in progress

  const lotKey = () => { const l = store.project.site?.lot; return l ? `${l.lotLabel || ''}|${l.areaM2 || ''}|${store.project.placedHouse?.id || ''}` : ''; };
  const stamp = () => store.project.updatedAt || '';
  const btn = (a) => h('button', { class: `fitc-btn${a.primary ? ' is-pri' : ''}`, type: 'button', dataset: { ps: `fit-act-${a.id}` }, onclick: () => act(a.id) }, a.label);
  const undoBtn = (ps) => h('button', { class: 'fitc-link', type: 'button', dataset: { ps }, onclick: () => { done = null; note = null; store.undo(); } }, 'Undo');

  async function act(id) {
    if (id === 'designs') {
      let r = true;
      try { r = await onDesigns?.(); } catch { r = true; }
      if (r === false) { nothingFits = true; paint(); }
      return;
    }
    if (id === 'narrower') { onNarrower?.(); return; }
    if (id === 'engineer') { onEngineer?.(); return; }
    applying = true;
    let r = null;
    try { r = applyFix(store, id); } finally { applying = false; }
    if (!r?.ok) return;
    minimised = false;
    done = r.changed ? { text: r.fits ? `${r.label} done. The house now meets the setbacks.` : `${r.label} done. This is the closest it gets on this lot.`, stamp: stamp() } : { text: 'The house is already in the best spot for this.', stamp: stamp(), noUndo: true };
    if (note) note.stamp = stamp();
    paint();
  }

  function paint() {
    if (disposed) return;
    const key = lotKey();
    if (key !== lastKey) { lastKey = key; nothingFits = false; minimised = false; }
    if (done && done.stamp !== stamp()) done = null;
    if (note && note.stamp !== stamp()) note = null;
    const engineerOk = !!onEngineer && !!canEngineer();
    const m = fitCardModel(viewed || store.project, { withPlan: !live, canDesigns: !!onDesigns && !!canDesigns(), canNarrower: !!onNarrower, canEngineer: engineerOk });
    onSides?.(m.show ? m.sides : []);
    const slope = m.slope && slopeOff !== key ? m.slope : null;
    const kids = [];
    let tone = 'note';
    if (m.show && minimised) {
      el.className = `fitc fitc--${theme} is-min`;
      el.dataset.tone = 'bad';
      el.hidden = false;
      el.replaceChildren(h('button', { class: 'fitc-pill', type: 'button', dataset: { ps: 'fit-show' }, onclick: () => { minimised = false; paint(); } }, 'The house does not fit. Show fixes'));
      onChange?.();
      return;
    }
    if (m.show) {
      tone = m.tone;
      kids.push(h('div', { class: 'fitc-hd' }, h('h3', { class: 'fitc-t', dataset: { ps: 'fit-title' } }, m.title), h('button', { class: 'fitc-x', type: 'button', 'aria-label': 'Hide this', title: 'Hide', dataset: { ps: 'fit-hide' }, onclick: () => { minimised = true; paint(); } }, '×')));
      const lines = compact ? m.lines.slice(0, 1) : m.lines;
      for (const t of lines) kids.push(h('p', { dataset: { ps: 'fit-line' } }, t));
      if (nothingFits) kids.push(h('p', { dataset: { ps: 'fit-nothing' } }, NOTHING_FITS));
      const acts = nothingFits ? m.actions.filter((a) => a.id !== 'designs').map((a) => (a.id === 'engineer' ? { ...a, primary: true } : a)) : m.actions;
      if (nothingFits && engineerOk && !acts.some((a) => a.id === 'engineer')) acts.push({ id: 'engineer', label: ENGINEER_LABEL, primary: true });
      if (acts.length && !live) kids.push(h('div', { class: 'fitc-acts' }, ...acts.map(btn)));
    }
    if (done) {
      if (!m.show) tone = 'ok';
      kids.push(h('div', { class: 'fitc-done', dataset: { ps: 'fit-done' } }, h('span', null, done.text), done.noUndo ? null : undoBtn('fit-undo')));
    }
    if (note) kids.push(h('div', { class: `fitc-done${kids.length ? ' fitc-sub' : ''}`, dataset: { ps: 'fit-driveway-note' } }, h('span', null, note.text), undoBtn('fit-driveway-undo')));
    else if (m.driveway?.routed && m.show) kids.push(h('p', { class: 'fitc-sub', dataset: { ps: 'fit-driveway' } }, m.driveway.text));
    if (slope) {
      kids.push(h('div', { class: kids.length ? 'fitc-sub' : '', dataset: { ps: 'fit-slope' } },
        h('span', null, slope.text, ' '),
        engineerOk ? h('button', { class: 'fitc-link', type: 'button', dataset: { ps: 'fit-slope-engineer' }, onclick: () => onEngineer?.() }, 'Send to a registered engineer') : null,
        !m.show && !done ? h('button', { class: 'fitc-link', type: 'button', style: { marginLeft: '10px', fontWeight: '600' }, dataset: { ps: 'fit-slope-hide' }, onclick: () => { slopeOff = key; paint(); } }, 'Hide') : null));
    }
    el.className = `fitc fitc--${theme}`;
    el.dataset.tone = tone;
    el.dataset.verdict = m.show ? m.verdict : 'fits';
    el.hidden = !kids.length;
    el.replaceChildren(...kids);
    onChange?.();
  }

  /** Repaint. `{ live: true }` while a drag is in progress: the words follow the house, the search and the buttons wait for the drop. */
  function update(opts = {}) {
    live = !!opts.live;
    viewed = live ? opts.project || null : null;
    clearTimeout(timer);
    if (opts.now || live) paint();
    else timer = setTimeout(paint, 60);
  }

  const offProject = store.on('project', () => { if (!applying) update(); });
  const offNote = onSiteNote((n) => { if (n?.kind === 'driveway') { note = { text: n.text, stamp: null }; setTimeout(() => { if (note && note.stamp == null) { note.stamp = stamp(); update({ now: true }); } }, 0); } });
  return {
    el, update,
    get model() { return fitCardModel(store.project, { withPlan: true }); },
    dispose() { disposed = true; clearTimeout(timer); offProject?.(); offNote?.(); el.remove(); },
  };
}
