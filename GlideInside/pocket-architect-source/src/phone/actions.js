// Phone actions that reach the running app: Save design (the existing profile button) and Share (the design link through the share sheet).
import { h } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { openSheet } from './sheet.js';
import { shareOrCopy } from './share.js';

const app = () => (typeof window !== 'undefined' ? window.__ps : null) || {};
const saveButton = () => document.querySelector('[data-action="profile-save"]');

/** Tap the real Save design button (signed out it offers a profile, signed in it saves). */
export function saveDesign() {
  const b = saveButton();
  if (b) { b.click(); return true; }
  return false;
}

/** The design is saved to the person's profile, so a link can be sent. */
export function isSaved() {
  const c = app().profiles?.controller?.state;
  return !!c && c.status === 'in' && c.saveState === 'saved';
}

/** Subscribe to the profile save state (for the Share button). Returns an unsubscribe. */
export function onSaveState(fn) {
  let off = () => {}; let stopped = false; let tries = 0;
  const attach = () => {
    if (stopped) return;
    const c = app().profiles?.controller;
    if (c?.subscribe) { off = c.subscribe(() => fn(isSaved())) || (() => {}); fn(isSaved()); return; }
    if (++tries < 120) setTimeout(attach, 500);
  };
  attach();
  return () => { stopped = true; off(); };
}

function showManual(url) {
  const input = h('input', { class: 'ps-sheet-link', type: 'text', readonly: true, value: url, 'aria-label': 'Design link', onfocus: (e) => e.target.select() });
  openSheet({ title: 'Copy your design link', id: 'phone-share-manual', body: h('div', null, h('p', { class: 'ps-sheet-note' }, 'Press and hold the link, copy it, then paste it into a message to yourself.'), input) });
  input.focus(); input.select();
}

/** Share the design link: share sheet first, copy as the fallback. */
export async function shareDesign({ nav = navigator } = {}) {
  const share = app().share;
  if (!share?.ensureLink) { toast('Sharing is not available here.', { kind: 'warn' }); return null; }
  let url = '';
  try { url = await share.ensureLink(); } catch (e) { toast(e?.message || 'The link could not be made. Try again.', { kind: 'warn' }); return null; }
  const r = await shareOrCopy({ url, nav });
  if (r.how === 'copied') toast('Link copied. Paste it into a message to yourself.', { kind: 'ok', timeout: 7000 });
  else if (r.how === 'manual') showManual(url);
  return r;
}
