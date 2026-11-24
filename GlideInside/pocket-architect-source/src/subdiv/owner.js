// Subdivision check: the owner (Jayden) path. It reuses the existing owner sign in: the ADMIN_TOKEN that the private /portal/admin/ page takes. The same
// sessionStorage slot is read, and a token is only believed after the server accepts it (an admin route answers 200). No new login is built.
// Signed in as the owner, the lead form is skipped and the snapshot PDF is offered straight away.

import { createAdminApi } from '../portal/admin-api.js';

export const ADMIN_TOKEN_KEY = 'gi.admin.token'; // the key src/portal/ui/admin-app.js uses

const slot = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
export const savedToken = () => { try { return slot()?.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; } };
export const saveToken = (t) => { try { slot()?.setItem(ADMIN_TOKEN_KEY, t); } catch { /* kept in memory by the caller */ } };
export const clearToken = () => { try { slot()?.removeItem(ADMIN_TOKEN_KEY); } catch { /* nothing to clear */ } };

/** True when the server accepts this token. A rejected token (401) is false; a network failure throws so the caller can say so. */
export async function verifyOwner(token, { fetchImpl = null } = {}) {
  const t = String(token || '').trim();
  if (!t) return false;
  try {
    await createAdminApi({ token: t, fetchImpl }).listOrgs();
    return true;
  } catch (e) {
    if (e?.status === 401 || e?.code === 'UNAUTHORISED' || e?.details?.status === 401) return false;
    throw e;
  }
}
