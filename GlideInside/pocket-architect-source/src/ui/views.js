// Switches the stage between the plan editor, the 3D viewer, both side by side (split) and the walk mode. The viewer (three.js) loads
// on first use. Also owns the split divider, the Back to plan button, Escape, and remembering the last view.

import { h, isTyping } from './dom.js';
import { icon } from './icons.js';
import { hasPlan, has3d, canReturnToPlan, escapeLeavesView, splitFromPointer, clampSplit, readSplit, writeSplit, writeLastView } from './view-mode.js';

const OWNER_KEY = 'ps.portal.owner'; // set by the portal layer for a signed in user

const ls = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

export function createViewManager({ store, refs, editor, catalogue }) {
  const { shell, planHost, host3d, stageNote, stage } = refs;
  let viewer = null;
  let loading = null;
  let seq = 0;
  let primed = false;

  // Split divider ---------------------------------------------------------------------------------------------------------------
  let frac = readSplit(ls());
  const stacked = () => !!globalThis.matchMedia?.('(max-width: 899.98px)').matches;
  const applyFrac = () => shell.style.setProperty('--ps-split', `${(frac * 100).toFixed(2)}%`);
  applyFrac();
  const bar = h('div', { class: 'ps-split-bar', role: 'separator', tabindex: '0', 'aria-label': 'Resize the plan and 3D panes', 'aria-orientation': 'vertical', hidden: true, dataset: { ps: 'split-bar' } }, h('span', { class: 'ps-split-grip', 'aria-hidden': 'true' }));
  let dragging = false;
  const move = (e) => {
    if (!dragging || !stage) return;
    frac = splitFromPointer(stage.getBoundingClientRect(), e.clientX, e.clientY, stacked());
    applyFrac();
  };
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('is-dragging');
    shell.classList.remove('is-splitting');
    writeSplit(ls(), frac);
  };
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    bar.setPointerCapture?.(e.pointerId);
    bar.classList.add('is-dragging');
    shell.classList.add('is-splitting'); // keeps the canvases from swallowing the drag
    e.preventDefault();
  });
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  bar.addEventListener('keydown', (e) => {
    const a = stacked() ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (e.key !== a[0] && e.key !== a[1]) return;
    e.preventDefault();
    frac = clampSplit(frac + (e.key === a[1] ? 0.03 : -0.03));
    applyFrac();
    writeSplit(ls(), frac);
  });
  bar.addEventListener('dblclick', () => {
    frac = clampSplit(0.5);
    applyFrac();
    writeSplit(ls(), frac);
  });
  const syncBarOrientation = () => bar.setAttribute('aria-orientation', stacked() ? 'horizontal' : 'vertical');

  // Back to plan: a clear way out of 3D, split and walk. Escape does the same.
  const backBtn = h('button', { class: 'ps-btn ps-btn--wide ps-backplan', type: 'button', hidden: true, dataset: { action: 'back-to-plan' }, title: 'Back to the plan (Esc)', 'aria-label': 'Back to the plan', onclick: () => store.setUI({ view: '2d' }) },
    icon('plan', { size: 16 }), h('span', { class: 'ps-btn-text' }, 'Back to plan'));
  stage?.append(bar, backBtn);
  globalThis.matchMedia?.('(max-width: 899.98px)')?.addEventListener?.('change', syncBarOrientation);

  const onEscape = (e) => {
    if (e.key !== 'Escape') return;
    const ok = escapeLeavesView({
      view: store.ui.view,
      tool: store.ui.tool,
      selection: store.ui.selection,
      editing: !!viewer?.editing || !!viewer?.ahead?.isArmed || !!viewer?.inCutaway?.(), // Escape in a room cutaway goes back to the aerial, not the plan
      modalOpen: !!document.querySelector('.ps-modal, .ps3d-picker:not([hidden]), .ps-level-menu:not([hidden])'),
      typing: isTyping(e.target),
      defaultPrevented: e.defaultPrevented,
    });
    if (ok) store.setUI({ view: '2d' });
  };
  // capture: read the tool and selection before the editors clear them on the same key press
  window.addEventListener('keydown', onEscape, true);

  function showNote(...kids) {
    stageNote.replaceChildren(h('div', null, ...kids));
    stageNote.hidden = false;
  }
  function hideNote() {
    stageNote.hidden = true;
    stageNote.replaceChildren();
  }

  function ensureViewer() {
    if (viewer) return Promise.resolve(viewer);
    if (!loading) {
      loading = import('../viewer3d/viewer.js')
        .then((m) => {
          if (typeof m.createViewer3D !== 'function') throw new Error('The 3D viewer module has no createViewer3D export');
          viewer = m.createViewer3D(host3d, store, { catalogue });
          return viewer;
        })
        .catch((err) => {
          loading = null;
          throw err;
        });
    }
    return loading;
  }

  async function apply() {
    const view = store.ui.view;
    const mine = ++seq;
    shell.dataset.view = view;
    planHost.hidden = !hasPlan(view);
    host3d.hidden = !has3d(view);
    bar.hidden = view !== 'split';
    backBtn.hidden = !canReturnToPlan(view);
    syncBarOrientation();
    editor?.setActive(hasPlan(view));
    if (!has3d(view)) {
      viewer?.setActive(false);
      hideNote();
      return;
    }
    if (!viewer) {
      showNote(h('div', { class: 'ps-spinner', role: 'progressbar', 'aria-label': 'Loading' }), h('p', null, 'Loading the 3D view'));
    }
    try {
      const v = await ensureViewer();
      if (mine !== seq || !has3d(store.ui.view)) return;
      hideNote();
      const walk = store.ui.view === 'walk';
      if (walk && !primed) {
        // Frame the orbit camera first, so leaving walk mode has a sensible view to return to.
        v.setMode?.('orbit');
        v.setActive?.(true);
      }
      primed = true;
      v.setMode?.(walk ? 'walk' : 'orbit');
      v.setActive?.(true);
    } catch (err) {
      console.warn('[3d] viewer unavailable', err);
      if (mine !== seq) return;
      showNote(
        h('p', null, h('strong', null, 'The 3D view could not be loaded.')),
        h('p', { class: 'ps-hint' }, 'Check your connection and try again. Your design is safe and the plan view still works.'),
        h('div', { class: 'ps-row', style: { justifyContent: 'center' } },
          h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: () => apply() }, 'Try again'),
          h('button', { class: 'ps-btn', type: 'button', onclick: () => store.setUI({ view: '2d' }) }, 'Back to the plan')));
    }
  }

  const off = store.on('ui', (patch = {}) => {
    if (!('view' in patch)) return;
    apply();
    let owner = null;
    try {
      owner = ls()?.getItem(OWNER_KEY) || null;
    } catch {
      owner = null;
    }
    writeLastView(globalThis.sessionStorage || null, store.ui.view, owner); // the choice lasts for this session only; a new session opens in Split
  });
  apply();

  const getViewer = () => viewer;
  getViewer.ensure = ensureViewer;
  return { getViewer, ensureViewer, apply, dispose: () => { off(); window.removeEventListener('keydown', onEscape, true); bar.remove(); backBtn.remove(); } };
}
