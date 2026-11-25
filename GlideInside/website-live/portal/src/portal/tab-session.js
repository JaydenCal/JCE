// Each browser tab keeps the portal account it signed in with. The server returns a session key at sign in (response header X-GI-Tab); the tab
// keeps it in its own sessionStorage (never shared with other tabs, gone when the tab closes) and sends it as X-GI-Tab on every portal and
// editor request. The shared HttpOnly cookie, which follows the most recent sign in in the whole browser, is used only to start a tab that has
// no key yet (see adoptTabKey). Signing out in one tab ends that tab's session only.

export const TAB_HEADER = 'X-GI-Tab';
const KEY = 'gi.portal.tab';
let memory = ''; // used when sessionStorage is blocked: still per tab, because every tab has its own module state

const store = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

export function getTabKey() {
  const ss = store();
  if (ss) { try { return ss.getItem(KEY) || ''; } catch { /* blocked: use the in memory key */ } }
  return memory;
}
export function setTabKey(v) {
  memory = String(v || '');
  const ss = store();
  if (!ss) return;
  try { if (memory) ss.setItem(KEY, memory); else ss.removeItem(KEY); } catch { /* blocked: the in memory key still works for this tab */ }
}
export const clearTabKey = () => setTabKey('');

/** Headers to add to a request: this tab's own session key, when it has one. */
export const tabHeaders = () => { const k = getTabKey(); return k ? { [TAB_HEADER]: k } : {}; };

/** Keeps the key a response carries (sign in, or a new tab key). */
export function keepTabKey(res) {
  try { const k = res?.headers?.get?.(TAB_HEADER); if (k) setTabKey(k); } catch { /* no headers */ }
}
