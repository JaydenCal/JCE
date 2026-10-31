// Plan Studio onboarding: first-use tour, tool hint animations and the demo tips switch.

import { injectCss } from './css.js';
import { createHints } from './hints.js';
import { createTour } from './tour.js';
import { KEYS, h, isOff, stageEl, store as ls } from './util.js';

export function initOnboarding(ps = window.__ps) {
  if (!ps?.store) return null;
  ps.onboarding?.dispose?.();
  injectCss();

  const layer = h('div', { class: 'pso-layer' });
  document.body.append(layer);

  let enabled = !isOff();
  let tourActive = false;
  let autoTimer = 0;
  let disposed = false;

  const tour = createTour(ps, {
    layer,
    onActive: (on) => {
      tourActive = on;
      if (on) hints.close();
    },
    onFinish: () => ls.set(KEYS.tourDone, '1'),
  });
  const hints = createHints(ps, { isEnabled: () => enabled, isBusy: () => tourActive, layer });

  // Demo tips control: a small pill in the bottom-left corner of the stage with a popover.
  const stage = stageEl();
  const dock = h('div', { class: stage ? 'pso-dock' : 'pso-dock pso-dock--fixed', style: stage ? '' : 'left:12px;bottom:44px' });
  const pill = h('button', { class: 'pso-pill', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Demo tips' }, h('span', { class: 'pso-dot' }), 'Demo tips');
  const sw = h('button', { class: 'pso-switch', type: 'button', role: 'switch', 'aria-label': 'Demo tips' });
  const restart = h('button', { class: 'pso-link', type: 'button' }, 'Restart tour');
  const pop = h('div', { class: 'pso-pop', hidden: true },
    h('div', { class: 'pso-switchrow' }, h('span', null, 'Demo tips'), sw),
    h('p', null, 'Shows the guided tour on a first visit and a short animation the first time you use each tool.'),
    restart);
  dock.append(pill, pop);
  (stage || document.body).append(dock);

  function sync() {
    sw.setAttribute('aria-checked', String(enabled));
    pill.dataset.on = String(enabled);
    pill.lastChild.textContent = enabled ? 'Demo tips on' : 'Demo tips off';
  }
  function setEnabled(on) {
    enabled = !!on;
    if (enabled) ls.remove(KEYS.off);
    else {
      ls.set(KEYS.off, '1');
      clearTimeout(autoTimer);
      hints.close();
      if (tourActive) tour.stop();
    }
    sync();
  }
  const togglePop = (open = pop.hidden) => {
    pop.hidden = !open;
    pill.setAttribute('aria-expanded', String(open));
  };
  pill.addEventListener('click', () => togglePop());
  sw.addEventListener('click', () => setEnabled(!enabled));
  restart.addEventListener('click', () => {
    togglePop(false);
    api.startTour();
  });
  const onDoc = (e) => {
    if (!pop.hidden && !dock.contains(e.target)) togglePop(false);
  };
  const onEsc = (e) => {
    if (e.key === 'Escape' && !pop.hidden) togglePop(false);
  };
  document.addEventListener('pointerdown', onDoc);
  window.addEventListener('keydown', onEsc);
  sync();

  const api = {
    startTour() {
      clearTimeout(autoTimer);
      hints.close();
      tour.start();
    },
    showHint(id) {
      return hints.show(id, { force: true });
    },
    goToStep: (n) => tour.goTo(n),
    setEnabled,
    isEnabled: () => enabled,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(autoTimer);
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onEsc);
      tour.dispose();
      hints.dispose();
      dock.remove();
      layer.remove();
      if (ps.onboarding === api) ps.onboarding = null;
    },
  };
  ps.onboarding = api;

  if (enabled && ls.get(KEYS.tourDone) !== '1') {
    autoTimer = setTimeout(() => {
      if (!disposed && enabled && ls.get(KEYS.tourDone) !== '1') api.startTour();
    }, 900);
  }
  return api;
}

export default initOnboarding;
