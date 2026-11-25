// Free user profiles in the app: wires the controller (state and saving), the prompt policy (when to ask) and the screens together.
//   const profiles = await initProfiles(app, { refs });   app.profiles = profiles
// Does nothing in the embedded demo, the commercial viewer or the builder widget, and shows nothing at all when the server has no profile service. In the home page lot viewer it only offers the small Save your design card.

import { loadToken, saveToken } from '../premium/entitlement.js';
import { createProfileApi } from './api.js';
import { createProfileController } from './controller.js';
import { createPromptPolicy } from './policy.js';
import { initProfileUi, makeThumbnail } from './ui.js';
import { hasOtherAccount } from './accounts.js';
import { isPhoneMode } from '../phone/mode.js';
import { isSampleLot, placedLotKey, watchHousePlaced } from './placed.js';

export { isSampleLot, placedLotKey, watchHousePlaced };

const safeSession = () => {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
};

export async function initProfiles(app, { refs, viewer = false, fetchImpl = null, api = createProfileApi({ fetchImpl }) } = {}) {
  const { store, CONFIG } = app;
  const controller = createProfileController({
    api, store,
    thumbnail: (project) => makeThumbnail(project, refs.planHost),
    packToken: (projectId) => loadToken(projectId),
    acceptPack: (pack) => saveToken(pack.projectId, pack.token),
  });
  const policy = createPromptPolicy({
    status: () => (controller.state.status === 'in' ? 'in' : controller.state.status === 'out' ? 'out' : 'none'),
    otherAccount: () => hasOtherAccount(app),
    // Never mid drag (pointer is down), never over another dialog, never while walking through the 3D view.
    isBusy: () => pointerDown || !!refs.shell?.dataset?.viewonly || store.readOnly || !!document.querySelector('.ps-modal, .pso-card, .pso-pop:not([hidden]), .gf-root:not([hidden]):not([data-step="4"]), .tut-card:not([hidden])') || store.ui.view === 'walk', // also the first run tour
    show: (reason) => ui.showPrompt(reason),
    session: safeSession(),
  });
  let pointerDown = false;
  const down = () => { pointerDown = true; };
  const up = () => { setTimeout(() => { pointerDown = false; }, 150); };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', up);

  const ui = initProfileUi({ app, controller, policy, refs, store, config: CONFIG, otherAccount: () => hasOtherAccount(app), viewer });

  if (!viewer) {
    store.on('project', ({ label } = {}) => {
      controller.noteChange(label);
      policy.noteEdit(label);
    });
  }
  // A house placed on the person's own lot is the moment of value: a few seconds later the small Save your design card is offered
  // (the phone viewer, the home page frame and the phone guided flow; not on a desktop editor, where the first edit offers the full prompt).
  const offPlaced = watchHousePlaced(store, () => {
    if ((viewer || isPhoneMode()) && !store.readOnly && !refs.shell?.dataset?.viewonly) policy.noteHousePlaced();
  });
  // Leaving with work that is not saved to a profile: the browser asks, and if the person stays the prompt is offered. Only where the browser allows it.
  if (!viewer) window.addEventListener('beforeunload', (e) => { policy.onBeforeUnload(e); });
  // Keep the profile copy current when the tab goes to the background or closes inside the pause.
  const flush = () => { controller.flush(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  // Save and Share while signed out offer a profile (they carry on as usual).
  if (!viewer) refs.topbar?.querySelector('[data-action="share"]')?.addEventListener('click', () => policy.onSaveOrShare('share'), true);

  // The export gate remembers a profile so its sign up dialog is not shown again (this session or this device) once one was made or signed into.
  // Only an explicit sign out or deleting the account forgets it (a dropped session does not: the person still has a profile).
  import('../legal/terms-gate.js').then(({ planTermsGate }) => {
    const note = () => { if (controller.state.status === 'in') planTermsGate.noteAccount(true); };
    controller.subscribe(note); note();
    for (const name of ['signOut', 'deleteAccount']) {
      const orig = controller[name];
      if (typeof orig === 'function') controller[name] = async (...a) => { const r = await orig(...a); planTermsGate.noteAccount(false); return r; };
    }
  }).catch(() => { /* the gate asks as before */ });

  await controller.init();
  ui.refresh();
  // The builder sign in check and the Commercial login settle after the first frame: look again, the buttons hide for those accounts.
  for (const ms of [1500, 4000]) setTimeout(() => ui.refresh(), ms);

  return {
    controller, policy, ui, api,
    promptSave: () => policy.onSaveOrShare('save'),
    dispose() {
      offPlaced?.();
      ui.dispose();
      controller.dispose();
      policy.dispose();
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    },
  };
}
