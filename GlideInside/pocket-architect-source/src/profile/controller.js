// Free profile state and saving, with no DOM (covered by tests/free-profile.test.mjs).
//   status: 'loading' | 'unavailable' (no profile service here: nothing about profiles is shown) | 'out' | 'in'
//   saveState: 'idle' | 'saving' | 'saved' | 'error' | 'limit'
// Signed in: every change is saved to the profile after a short pause ("Saved" in the status bar). Creating a profile saves the design that is
// open straight away. Plan Packs held by this browser for a saved design are linked to the profile so they survive a change of device.

import { migrate, validate } from '../model/schema.js';
import { ProfileError } from './api.js';

/** Edits that are not a real change to the design (settings, titles, automatic checks). They never start a prompt or count as work. */
const TRIVIAL_LABELS = /^(Open project|Undo|Redo|Project details|Title block|Drawing settings|Site settings|Check setbacks|Suggest site position)/;
export const isMeaningfulLabel = (label) => !!label && !TRIVIAL_LABELS.test(String(label));

/** True when the design has something worth keeping: a room or wall, a commercial row, or a looked up lot. */
export function hasWork(project) {
  if (!project) return false;
  return !!(project.levels?.some((l) => l.rooms?.length || l.walls?.length) || project.commercial?.rows?.length || project.site?.lot);
}

export function createProfileController({
  api, store, thumbnail = async () => null, packToken = () => null, acceptPack = () => {}, debounceMs = 2500, retryMs = 15000,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), now = () => Date.now(),
} = {}) {
  const state = { status: 'loading', profile: null, saveState: 'idle', savedAt: null, message: '', designId: null, limit: 10, resetNote: '' };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error('[profile] listener failed', e); } });
  const set = (patch) => { Object.assign(state, patch); emit(); };

  let timer = null;
  let retryTimer = null;
  let inFlight = null;
  let again = false;
  let dirty = false;
  let retries = 0;
  const linked = new Set(); // project ids whose Plan Pack was linked in this session

  const signedIn = () => state.status === 'in';
  const apply = (profile) => set({ status: 'in', profile, limit: profile?.designLimit ?? state.limit, saveState: 'idle', message: '' });

  async function init() {
    try {
      const res = await api.me();
      if (res.limits?.designs) state.limit = res.limits.designs;
      state.resetNote = res.resetNote || '';
      if (res.profile) apply(res.profile);
      else set({ status: 'out', profile: null });
    } catch (e) {
      // 404, 503 or a page instead of JSON: this server has no profile service. Show nothing about profiles.
      set({ status: e instanceof ProfileError && ['NETWORK', 'TIMEOUT'].includes(e.code) ? 'out' : 'unavailable', profile: null });
    }
    return state.status;
  }

  function clearTimers() {
    clearTimer(timer);
    clearTimer(retryTimer);
    timer = retryTimer = null;
  }

  async function linkPackFor(project) {
    if (!project?.id || linked.has(project.id)) return;
    const token = packToken(project.id);
    if (!token) return;
    try {
      await api.linkPack(token);
      linked.add(project.id);
    } catch {
      /* the pack stays on this device as before; the next save tries again */
    }
  }

  /** Save the open design to the profile now. Resolves { ok, created?, code?, message? }. */
  async function saveNow({ migrating = false } = {}) {
    if (!signedIn()) return { ok: false, code: 'SIGNED_OUT' };
    if (store.readOnly) return { ok: false, code: 'READ_ONLY' };
    if (inFlight) {
      again = true;
      return inFlight;
    }
    clearTimer(timer);
    timer = null;
    const project = store.project;
    if (migrating && !hasWork(project)) return { ok: false, code: 'NOTHING_TO_SAVE' };
    set({ saveState: 'saving', message: '' });
    dirty = false;
    inFlight = (async () => {
      try {
        const thumb = await thumbnail(project).catch(() => null);
        const out = await api.saveDesign(project, thumb);
        retries = 0;
        set({ saveState: 'saved', savedAt: now(), designId: out.design.id, message: '' });
        await linkPackFor(project);
        return { ok: true, created: !!out.created, design: out.design };
      } catch (e) {
        if (e instanceof ProfileError && e.code === 'UNAUTHORISED') {
          set({ status: 'out', profile: null, saveState: 'idle', message: '' });
          return { ok: false, code: 'UNAUTHORISED' };
        }
        const limit = e instanceof ProfileError && e.code === 'DESIGN_LIMIT_REACHED';
        dirty = true;
        set({ saveState: limit ? 'limit' : 'error', message: limit ? e.message : e instanceof ProfileError && e.code === 'PROJECT_TOO_LARGE' ? 'This design is too large to keep in a profile. Use Save to keep a file.' : 'Not saved to your profile yet. We will try again.' });
        if (!limit && !(e instanceof ProfileError && ['PROJECT_TOO_LARGE', 'BAD_PROJECT', 'RATE_LIMITED'].includes(e.code)) && retries < 5) {
          retries += 1;
          retryTimer = setTimer(() => { if (dirty) saveNow(); }, retryMs);
        }
        return { ok: false, code: e?.code || 'ERROR', message: e?.message };
      } finally {
        inFlight = null;
        if (again) {
          again = false;
          setTimer(() => saveNow(), 0);
        }
      }
    })();
    return inFlight;
  }

  /** Called on every project change (store 'project' event). Signed in: saves after a pause. */
  function noteChange(label) {
    if (!signedIn() || store.readOnly || /^Open project/.test(String(label || ''))) return;
    dirty = true;
    set({ saveState: 'saving' });
    clearTimer(timer);
    timer = setTimer(() => { timer = null; saveNow(); }, debounceMs);
  }

  const flush = () => (dirty && signedIn() ? saveNow() : Promise.resolve({ ok: true, code: 'NOTHING_PENDING' }));

  // The person was looking at a design when they made a profile: keep it. A design with nothing in it is not saved.
  async function afterSignIn(profile) {
    apply(profile);
    return saveNow({ migrating: true });
  }

  // The server answers a sign up the same way whether or not the email already has a profile (it never reveals who is registered) and sets no
  // session, so this signs in with the details just typed: that works for a new profile and fails with the usual sign in message for an existing one.
  async function signUp(form) {
    await api.signUp(form);
    let res;
    try {
      res = await api.signIn({ email: form.email, password: form.password });
    } catch (e) {
      if (e instanceof ProfileError && e.code === 'INVALID_CREDENTIALS') {
        throw new ProfileError('SIGNUP_NOT_SIGNED_IN', 'We could not sign you in with those details. If you already have a profile with this email address, use Sign in with your original password.', { status: e.status });
      }
      throw e;
    }
    const saved = await afterSignIn(res.profile);
    return { profile: res.profile, saved };
  }
  async function signIn(form) {
    const res = await api.signIn(form);
    // Signing in on a device that has unsaved work keeps that work as a new design (it never replaces a saved one: designs are matched by their own id).
    const edited = store.canUndo();
    apply(res.profile);
    const saved = edited ? await saveNow({ migrating: true }) : { ok: false, code: 'NOTHING_TO_SAVE' };
    return { profile: res.profile, saved };
  }
  async function signOut() {
    await flush();
    try {
      await api.signOut();
    } finally {
      clearTimers();
      linked.clear();
      dirty = false;
      set({ status: 'out', profile: null, saveState: 'idle', savedAt: null, designId: null, message: '' });
    }
  }
  async function deleteAccount(password) {
    await api.deleteAccount({ password });
    clearTimers();
    linked.clear();
    dirty = false;
    set({ status: 'out', profile: null, saveState: 'idle', savedAt: null, designId: null, message: '' });
  }
  async function setMarketing(on) {
    const res = await api.setMarketing(on);
    set({ profile: res.profile });
    return res.profile;
  }
  const changePassword = (current, next) => api.changePassword({ current, next });

  // My designs ------------------------------------------------------------------------------------------------------------
  const listDesigns = async () => {
    const res = await api.listDesigns();
    set({ limit: res.limit ?? state.limit });
    return res;
  };
  /** Fetch a saved design. A Plan Pack linked to it hands its token back, which is stored before the design opens so it unlocks at once. */
  async function openDesign(id, { replaceProject }) {
    await flush();
    const res = await api.getDesign(id);
    const project = migrate(res.project);
    const problems = validate(project);
    if (problems.length) throw new ProfileError('BAD_PROJECT', 'That design has problems and cannot be opened.');
    if (res.pack?.token) acceptPack(res.pack);
    if (!replaceProject(project)) throw new ProfileError('OPEN_FAILED', 'That design could not be opened.');
    set({ designId: res.design.id, saveState: 'saved', savedAt: now() });
    return res.design;
  }
  const renameDesign = (id, name) => api.renameDesign(id, name);
  const duplicateDesign = (id) => api.duplicateDesign(id);
  const removeDesign = async (id) => {
    await api.deleteDesign(id);
    if (state.designId === id) set({ designId: null });
  };

  return {
    state, init, signUp, signIn, signOut, deleteAccount, setMarketing, changePassword, saveNow, noteChange, flush,
    listDesigns, openDesign, renameDesign, duplicateDesign, removeDesign,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    dispose: () => { clearTimers(); listeners.clear(); },
  };
}
