// Switches the stage between the plan editor and the 3D viewer. The viewer (three.js) loads on first use.

import { h } from './dom.js';

export function createViewManager({ store, refs, editor, catalogue }) {
  const { shell, planHost, host3d, stageNote } = refs;
  let viewer = null;
  let loading = null;
  let seq = 0;
  let primed = false;

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
    planHost.hidden = view !== '2d';
    host3d.hidden = view === '2d';
    editor?.setActive(view === '2d');
    if (view === '2d') {
      viewer?.setActive(false);
      hideNote();
      return;
    }
    if (!viewer) {
      showNote(h('div', { class: 'ps-spinner', role: 'progressbar', 'aria-label': 'Loading' }), h('p', null, 'Loading the 3D view'));
    }
    try {
      const v = await ensureViewer();
      if (mine !== seq || store.ui.view === '2d') return;
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
    if ('view' in patch) apply();
  });
  apply();

  const getViewer = () => viewer;
  getViewer.ensure = ensureViewer;
  return { getViewer, ensureViewer, apply, dispose: () => off() };
}
