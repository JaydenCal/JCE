// The fit card: when the house does not fit the lot it says what is wrong and where in plain words, and offers one tap fixes, each with
// Undo; then other sizes that fit (with a thumbnail, one tap to swap) and ways to make this house smaller with their rough savings.
// Also the gentle slope note and "Driveway re-routed". The words and the fixes come from src/site/fit-advice.js and fit-suggest.js; this
// is the DOM. Used by the guided flow (steps 3 and 4) and the lot card (homepage embed and the editor).
// It never sits over the lot: each host puts `el` in its own panel. Everything can be dismissed, and the lists start folded.
//
//   const card = createFitCard({ store, theme: 'light' | 'glass', getDesigns, onSwapped, onGuide, onEngineer, canEngineer, onSides })
//   host.append(card.el); card.update();   card.dispose()

import { h } from './dom.js';
import { fitCardModel, applyFix, ENGINEER_LABEL, NOTHING_FITS, narrowerGuidance } from '../site/fit-advice.js';
import { shrinkSuggestions, narrowerDesignSuggestion, applyShrink, sizeAlternatives, swapKeeping } from '../site/fit-suggest.js';
import { onSiteNote } from '../site/site-items.js';
import { projectToSvg, svgDataUri } from '../portal/thumbnail.js';

export const FIT_CARD_CSS = `
.fitc{box-sizing:border-box;border-radius:12px;padding:10px 12px;font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;gap:8px}
.fitc[hidden]{display:none!important}
.fitc--light{background:#fff7e8;border:1px solid #f0cf8f;color:#3a2a08}
.fitc--light[data-tone="ok"]{background:#eaf6ef;border-color:#b6dcc6;color:#12452f}
.fitc--light[data-tone="note"]{background:#f1f4fb;border-color:#cfd8ee;color:#1d2a44}
.fitc--glass{background:rgba(255,190,90,.14);border:1px solid rgba(255,200,110,.5);color:#fff;max-height:32vh;overflow:auto}
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
.fitc--glass .fitc-btn{border:1px solid rgba(255,255,255,.5)!important;background:rgba(255,255,255,.06)!important;color:#fff!important;padding:7px 12px!important;border-radius:9px!important}
.fitc--glass .fitc-btn.is-pri{background:#fff!important;border-color:#fff!important;color:#14161a!important}
.fitc--glass .fitc-link{color:#fff!important;text-decoration:underline!important}
.fitc--glass .fitc-x{color:#fff!important}
.fitc-btn:disabled{opacity:.55;cursor:default}
.fitc-done{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-weight:600}
.fitc-link{padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer;text-align:left}
.fitc-sub{font-size:12.5px;opacity:.95;border-top:1px solid rgba(127,127,127,.3);padding-top:7px}
.fitc-pill{align-self:flex-start;font:600 12.5px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;padding:6px 10px;border-radius:999px;cursor:pointer;border:1px solid currentColor;background:transparent;color:inherit}
.fitc.is-min{padding:6px 8px;background:transparent;border-color:transparent}
.fitc-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.fitc-alt{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:5px 8px 5px 5px;border-radius:9px;cursor:pointer;font:600 12.5px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left;color:inherit}
.fitc--light .fitc-alt{border:1px solid #c9a45a;background:#fff}
.fitc--glass .fitc-alt{border:1px solid rgba(255,255,255,.4)!important;background:rgba(255,255,255,.06)!important;color:#fff!important}
.fitc-alt img{flex:none;width:54px;height:40px;border-radius:5px;background:#f3f4ef;object-fit:contain}
.fitc-alt span{flex:1;min-width:0}
.fitc-alt small{display:block;font-weight:500;opacity:.8;font-size:11.5px}
.fitc-row{display:flex;align-items:center;gap:8px;font-size:12.5px}
.fitc-row span{flex:1;min-width:0}
.fitc-row .fitc-btn{flex:none;min-height:28px;padding:4px 9px!important;font-size:12px}
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

const thumbs = new Map();
function thumbOf(d) {
  if (!thumbs.has(d.id)) { let uri = ''; try { uri = svgDataUri(projectToSvg(d.project, { width: 108, height: 80 })); } catch { uri = ''; } thumbs.set(d.id, uri); }
  return thumbs.get(d.id);
}

/**
 * Options:
 *   theme        'light' (guided flow) or 'glass' (over the dark lot card)
 *   getDesigns   () => [{ id, name, project, frontageM?, fit? }]   the catalogue that is loaded, for the other sizes (may be empty at first)
 *   onSwapped    (design) => void               after a one tap swap, so the host can note which design is placed
 *   onGuide      (text) => void                 hand off to the floor plan editor with a short guide
 *   onEngineer   () => void   canEngineer () => boolean
 *   onSides      (sides) => void                the breaching boundary edges, for the host to highlight ([] when it fits)
 *   compact      true: one line of text (phone and the lot card)
 */
export function createFitCard({ store, theme = 'light', getDesigns = null, onSwapped = null, onGuide = null, onEngineer = null, canEngineer = () => true, onSides = null, compact = false, onChange = null, doneMs = null }) {
  injectCss();
  const el = h('section', { class: `fitc fitc--${theme}`, hidden: true, role: 'status', 'aria-live': 'polite', 'aria-label': 'House fit', dataset: { ps: 'fit-card' } });
  let disposed = false;
  let done = null; // { text, stamp } after a fix: "Auto fit done. Undo"
  let note = null; // { text, stamp } "Driveway re-routed to suit the new position. Undo"
  let minimised = false;
  let slopeOff = null; // lot key the slope note was dismissed for
  let tightOff = null;
  let openAlts = false;
  let openShrink = false;
  let applying = false;
  let live = false;
  let timer = 0;
  let lastKey = '';
  let viewed = null; // the preview copy while a drag is in progress

  const lotKey = () => { const l = store.project.site?.lot; return l ? `${l.lotLabel || ''}|${l.areaM2 || ''}|${store.project.placedHouse?.id || ''}` : ''; };
  const stamp = () => store.project.updatedAt || '';
  const btn = (a) => h('button', { class: `fitc-btn${a.primary ? ' is-pri' : ''}`, type: 'button', dataset: { ps: `fit-act-${a.id}` }, onclick: () => act(a.id) }, a.label);
  const undoBtn = (ps) => h('button', { class: 'fitc-link', type: 'button', dataset: { ps }, onclick: () => { done = null; note = null; store.undo(); } }, 'Undo');
  const applied = (fn) => { applying = true; try { return fn(); } finally { applying = false; } };
  let doneTimer = 0;
  // doneMs() > 0 (the phone house screen): the "done" notice hides itself after that long. The fit state itself is never hidden.
  const afterApply = (text) => {
    minimised = false; done = { text, stamp: stamp() }; if (note) note.stamp = stamp(); paint();
    clearTimeout(doneTimer);
    const ms = Number(doneMs?.()) || 0;
    if (ms > 0) { const mine = done; doneTimer = setTimeout(() => { if (done === mine && !disposed) { done = null; paint(); } }, ms); }
  };

  function act(id) {
    if (id === 'narrower') { onGuide?.(narrowerGuidance(store.project)); return; }
    if (id === 'engineer') { onEngineer?.(); return; }
    const r = applied(() => applyFix(store, id));
    if (!r?.ok) return;
    if (r.changed) afterApply(r.fits ? `${r.label} done. The house now meets the setbacks.` : 'Moved to the closest fit. It still overhangs on this lot.');
    else { done = { text: 'The house is already in the best spot for this.', stamp: stamp(), noUndo: true }; paint(); }
  }
  function swap(a) {
    const r = applied(() => swapKeeping(store, a.design));
    try { onSwapped?.(a.design); } catch { /* the host's own note */ }
    openAlts = false;
    afterApply(r.fits === false ? `${a.name} placed. It still does not fit here.` : `${a.name} placed${r.kept ? ' in the same spot, facing the same way' : ''}.`);
  }
  function shrink(s) {
    if (s.designId) { openAlts = true; paint(); return; }
    if (!s.oneTap) { onGuide?.(`${s.text} ${s.guide}`.trim()); return; }
    const r = applied(() => applyShrink(store, s.id));
    if (r?.ok) afterApply(`${r.label}.`);
  }

  function paint() {
    if (disposed) return;
    const key = lotKey();
    if (key !== lastKey) { lastKey = key; minimised = false; openAlts = false; openShrink = false; }
    if (done && done.stamp !== stamp()) done = null;
    if (note && note.stamp !== stamp()) note = null;
    const project = viewed || store.project;
    const engineerOk = !!onEngineer && !!canEngineer();
    const m = fitCardModel(project, { withPlan: !live, canDesigns: false, canNarrower: !!onGuide, canEngineer: engineerOk });
    onSides?.(m.show && m.tone === 'bad' ? m.sides : []);
    const tight = m.verdict === 'tight';
    const show = m.show && !(tight && tightOff === key);
    const slope = m.slope && slopeOff !== key ? m.slope : null;
    const kids = [];
    let tone = 'note';
    if (show && minimised) {
      el.className = `fitc fitc--${theme} is-min`;
      el.dataset.tone = m.tone;
      el.dataset.verdict = m.verdict;
      el.hidden = false;
      el.replaceChildren(h('button', { class: 'fitc-pill', type: 'button', dataset: { ps: 'fit-show' }, onclick: () => { minimised = false; paint(); } }, tight ? 'A tight fit. Show options' : 'The house does not fit. Show fixes'));
      onChange?.();
      return;
    }
    if (show) {
      tone = m.tone;
      kids.push(h('div', { class: 'fitc-hd' }, h('h3', { class: 'fitc-t', dataset: { ps: 'fit-title' } }, m.title), h('button', { class: 'fitc-x', type: 'button', 'aria-label': 'Hide this', title: 'Hide', dataset: { ps: 'fit-hide' }, onclick: () => { if (tight) tightOff = key; else minimised = true; paint(); } }, '×')));
      for (const t of compact ? m.lines.slice(0, 1) : m.lines) kids.push(h('p', { dataset: { ps: 'fit-line' } }, t));
      // Other sizes and ways to shrink: for a house that cannot fit, or only just fits. Worked out on the drop, never while dragging.
      let alts = null;
      let ways = [];
      if (!live && (m.verdict === 'none' || tight)) {
        const designs = getDesigns ? getDesigns() || [] : [];
        try { alts = designs.length ? sizeAlternatives(project, designs) : null; } catch { alts = null; }
        const need = m.verdict === 'none' ? { needWideM: m.plan?.tooWideM || 0, needDeepM: m.plan?.tooDeepM || 0 } : {};
        try { ways = shrinkSuggestions(project, need); } catch { ways = []; }
        const nd = alts ? narrowerDesignSuggestion(project, alts) : null;
        if (nd) ways.push(nd);
      }
      const fitting = alts ? alts.list.filter((a) => a.fit > 0) : [];
      const altBtn = (a) => h('button', { class: 'fitc-alt', type: 'button', title: `Swap to ${a.name}`, dataset: { ps: 'fit-alt', id: a.id }, onclick: () => swap(a) },
        thumbOf(a.design) ? h('img', { src: thumbOf(a.design), alt: `Plan of ${a.name}`, loading: 'lazy' }) : null,
        h('span', null, a.label, a.similar ? h('small', null, a.name) : null));
      if (m.verdict === 'none' && alts && !fitting.length) kids.push(h('p', { dataset: { ps: 'fit-nothing' } }, NOTHING_FITS));
      if (fitting.length) {
        kids.push(h('ul', { class: 'fitc-list', dataset: { ps: 'fit-alts' } }, ...(openAlts ? fitting : fitting.slice(0, 1)).map((a) => h('li', null, altBtn(a)))));
        if (fitting.length > 1) kids.push(h('button', { class: 'fitc-link', type: 'button', 'aria-expanded': String(openAlts), dataset: { ps: 'fit-alts-all' }, onclick: () => { openAlts = !openAlts; paint(); } }, openAlts ? 'Show fewer designs' : `Show all designs that fit this lot (${fitting.length})`));
      }
      if (ways.length) {
        kids.push(h('button', { class: 'fitc-link', type: 'button', 'aria-expanded': String(openShrink), dataset: { ps: 'fit-shrink-toggle' }, onclick: () => { openShrink = !openShrink; paint(); } }, openShrink ? 'Hide ways to make this house smaller' : `Ways to make this house smaller (${ways.length})`));
        if (openShrink) {
          kids.push(h('ul', { class: 'fitc-list', dataset: { ps: 'fit-shrink' } }, ...ways.map((s) => h('li', { class: 'fitc-row', dataset: { ps: 'fit-shrink-item', id: s.id } },
            h('span', null, s.text),
            s.oneTap ? h('button', { class: 'fitc-btn', type: 'button', dataset: { ps: `fit-shrink-do-${s.id}` }, onclick: () => shrink(s) }, 'Do it')
              : s.designId ? h('button', { class: 'fitc-btn', type: 'button', dataset: { ps: `fit-shrink-do-${s.id}` }, onclick: () => shrink(s) }, 'Show')
                : onGuide ? h('button', { class: 'fitc-btn', type: 'button', dataset: { ps: `fit-shrink-do-${s.id}` }, onclick: () => shrink(s) }, 'How') : null))));
        }
      }
      let acts = m.actions;
      if (ways.length) acts = acts.filter((a) => a.id !== 'narrower'); // the list above says how, with the savings
      if (compact) acts = acts.filter((a) => !a.extra);
      if (m.verdict === 'none' && alts && !fitting.length) acts = acts.map((a) => (a.id === 'engineer' ? { ...a, primary: true } : a));
      if (m.verdict === 'none' && fitting.length) acts = acts.map((a) => ({ ...a, primary: false }));
      if (m.verdict === 'none' && engineerOk && !acts.some((a) => a.id === 'engineer')) acts = [...acts, { id: 'engineer', label: ENGINEER_LABEL }];
      if (acts.length && !live) kids.push(h('div', { class: 'fitc-acts' }, ...acts.map(btn)));
    }
    if (done) {
      if (!show) tone = 'ok';
      kids.push(h('div', { class: 'fitc-done', dataset: { ps: 'fit-done' } }, h('span', null, done.text), done.noUndo ? null : undoBtn('fit-undo')));
    }
    if (note) kids.push(h('div', { class: `fitc-done${kids.length ? ' fitc-sub' : ''}`, dataset: { ps: 'fit-driveway-note' } }, h('span', null, note.text), undoBtn('fit-driveway-undo')));
    else if (m.driveway?.blocked && show && m.tone === 'bad') kids.push(h('p', { class: 'fitc-sub', dataset: { ps: 'fit-driveway' } }, m.driveway.text));
    else if (m.driveway?.routed && show && !compact) kids.push(h('p', { class: 'fitc-sub', dataset: { ps: 'fit-driveway' } }, m.driveway.text));
    // In a small card one thing at a time: the slope note waits until the house fits.
    if (slope && !(compact && show)) {
      kids.push(h('div', { class: kids.length ? 'fitc-sub' : '', dataset: { ps: 'fit-slope' } },
        h('span', null, compact ? slope.short : slope.text, ' '),
        engineerOk ? h('button', { class: 'fitc-link', type: 'button', dataset: { ps: 'fit-slope-engineer' }, onclick: () => onEngineer?.() }, 'Send to a registered engineer') : null,
        !show && !done ? h('button', { class: 'fitc-link', type: 'button', style: { marginLeft: '10px', fontWeight: '600' }, dataset: { ps: 'fit-slope-hide' }, onclick: () => { slopeOff = key; paint(); } }, 'Hide') : null));
    }
    el.className = `fitc fitc--${theme}`;
    el.dataset.tone = tone;
    el.dataset.verdict = show ? m.verdict : 'fits';
    el.hidden = !kids.length;
    el.replaceChildren(...kids);
    onChange?.();
  }

  /** Repaint. `{ live: true, project }` while a drag is in progress: the words follow the house, the search and the buttons wait for the drop. */
  function update(opts = {}) {
    live = !!opts.live;
    viewed = live ? opts.project || null : null;
    clearTimeout(timer);
    if (opts.now || live) paint();
    else timer = setTimeout(paint, 220); // a live drag in the top view applies many small moves: the search waits for a pause
  }

  const offProject = store.on('project', () => { if (!applying) update(); });
  const offNote = onSiteNote((n) => { if (n?.kind === 'driveway') { note = { text: n.text, stamp: null }; setTimeout(() => { if (note && note.stamp == null) { note.stamp = stamp(); update({ now: true }); } }, 0); } });
  return {
    el, update,
    dispose() { disposed = true; clearTimeout(timer); offProject?.(); offNote?.(); el.remove(); },
  };
}
