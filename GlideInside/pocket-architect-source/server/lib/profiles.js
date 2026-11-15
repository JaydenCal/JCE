// Free user profiles. A visitor creates a free profile (name, email, a password they type) to keep designs on our server and open them on
// any device. It is also how the owner builds a contact list: marketing is opt in (Spam Act 2003), the consent is stored with its time and
// the exact wording version, and only consenting, not unsubscribed contacts can be exported for marketing.
//
//   POST   /api/profile/signup            { name, email, password, phone?, postcode?, role?, acceptTerms, acceptPrivacy, marketing? }  -> 201 { profile }
//   POST   /api/profile/session           { email, password }                       -> { profile }   sign in
//   DELETE /api/profile/session                                                      -> { ok }        sign out
//   GET    /api/profile/me                                                           -> { profile } or { profile: null }
//   POST   /api/profile/password          { current, next }                          -> { ok }
//   PUT    /api/profile/preferences       { marketing }                              -> { profile }   email preferences
//   DELETE /api/profile                   { password }                               -> { ok }        delete the account and its designs
//   GET    /api/profile/designs                                                      -> { designs, limit, count }
//   POST   /api/profile/designs           { project, thumbnail? }                    -> 201 { design } (the same project id is updated, not duplicated)
//   GET    /api/profile/designs/:id                                                  -> { design, project, pack? }
//   PUT    /api/profile/designs/:id       { project, thumbnail? }                    -> { design }    autosave
//   PATCH  /api/profile/designs/:id       { name }                                   -> { design }    rename
//   POST   /api/profile/designs/:id/duplicate                                        -> 201 { design }
//   DELETE /api/profile/designs/:id                                                  -> { ok }
//   POST   /api/profile/packs             Authorization: Bearer <Plan Pack token>    -> { linked }    link a Plan Pack to the profile
//   Owner (Authorization: Bearer ADMIN_TOKEN):
//   GET    /api/profile/admin/contacts           ?consent&type&from&to&designs&mode&suburb&q       -> { contacts, total }
//   GET    /api/profile/admin/contacts.csv       ?scope=marketing|all (+ the same filters)         -> CSV
//   POST   /api/profile/admin/contacts/:id/unsubscribe  { unsubscribed }                           -> { contact }
//
// Nothing here sends email and no mailing service is connected. A password reset by email is a TODO (see resetNote below): until it exists
// the sign in form offers "Contact us". Errors never say whether an email has a profile (generic messages, equal timing, rate limits).
// The password is hashed with PBKDF2 (lib/password.js) and is never logged, returned or kept in clear.

import { HttpError, json, readJson, readText, bearerToken, clientIp } from './http.js';
import { hashPassword, verifyPassword, dummyVerify, newSessionToken, sha256Hex, secretEqual } from './password.js';
import { passwordProblem } from '../../src/portal/credentials.js';
import { TERMS_VERSION, MARKETING_TEXTS, MARKETING_TEXT_VERSION, ROLE_IDS, DESIGN_KINDS } from '../../src/profile/wording.js';

export const PROFILE_COOKIE = 'gi_profile';
const DAY = 86400000;
const SESSION_ABSOLUTE_DAYS = 90;
const SESSION_TOUCH_MS = 10 * 60000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_THUMB = 60000; // characters in the thumbnail data URL
const THUMB_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GENERIC_SIGNIN = 'The email or password is not right. Check both and try again.';
const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';
// TODO(email): a password reset by email link needs a mail provider. No mail is wired in this build, so nobody can reset a forgotten password
// themselves yet. The app shows "Contact us" and the owner sets a new password for the person by hand. Do not add sending here without an owner decision.
export const RESET_NOTE = 'Forgot your password? Contact us at hello@glideinside.com.au and we will help you get back in.';

const rid = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const cookiesOf = (request) => Object.fromEntries((request.headers.get('cookie') || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));
const cleanText = (v, max) => String(v ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Sydney calendar date as DD/MM/YYYY. */
export function ddmmyyyy(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/** One CSV cell. Leading = + - @ are defused so a spreadsheet never runs a typed value as a formula. */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function createProfiles({ store, pstore, config, now = () => Date.now() }) {
  const iso = (ms = now()) => new Date(ms).toISOString();
  const sessionMs = () => config.sessionDays * DAY;
  const sessionCookie = (token, maxAgeSec) => `${PROFILE_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

  /** State changing requests need the custom header (a cross-site form cannot send it) and a matching Origin when one is sent. */
  function checkCsrf(request, url) {
    if (SAFE_METHODS.has(request.method)) return;
    if (request.headers.get('x-gi-request') !== '1') throw new HttpError('FORBIDDEN', 'That request was blocked.');
    const origin = request.headers.get('origin');
    const allowed = config.siteOrigin || url.origin;
    if (origin && origin !== allowed) throw new HttpError('FORBIDDEN', 'That request was blocked.');
    const site = request.headers.get('sec-fetch-site');
    if (!origin && site && !['same-origin', 'same-site', 'none'].includes(site)) throw new HttpError('FORBIDDEN', 'That request was blocked.');
  }

  async function limit(key, max, windowSec, message = TOO_MANY) {
    if ((await store.hitRate(key, windowSec, now())) > max) throw new HttpError('RATE_LIMITED', message, { retryAfter: Math.min(windowSec, 600) });
  }
  const ipKey = async (request) => (await sha256Hex(`${config.ipHashSalt}${clientIp(request)}`)).slice(0, 32);

  async function startSession(r, profile) {
    const { token, idHash } = await newSessionToken();
    const nowMs = now();
    await pstore.createSession({ idHash, profileId: profile.id, createdAt: iso(nowMs), lastSeenAt: iso(nowMs), expiresAt: iso(nowMs + sessionMs()) });
    r.setCookie = sessionCookie(token, Math.round(config.sessionDays * 86400));
    return idHash;
  }

  /** The signed in profile, or null (when `required` is false). Throws UNAUTHORISED otherwise. */
  async function auth(r, { required = true } = {}) {
    const token = cookiesOf(r.request)[PROFILE_COOKIE];
    const fail = () => {
      if (required) throw new HttpError('UNAUTHORISED', 'Please sign in.');
      return null;
    };
    if (!token || token.length > 100) return fail();
    const idHash = await sha256Hex(token);
    const session = await pstore.getSession(idHash);
    const nowMs = now();
    if (!session || Date.parse(session.expiresAt) <= nowMs || Date.parse(session.createdAt) + SESSION_ABSOLUTE_DAYS * DAY <= nowMs) {
      if (session) await pstore.deleteSession(idHash);
      return fail();
    }
    const profile = await pstore.getProfile(session.profileId);
    if (!profile) {
      await pstore.deleteSession(idHash);
      return fail();
    }
    if (nowMs - Date.parse(session.lastSeenAt) > SESSION_TOUCH_MS) {
      await pstore.touchSession(idHash, iso(nowMs), iso(nowMs + sessionMs())); // sliding expiry
      r.setCookie = sessionCookie(token, Math.round(config.sessionDays * 86400));
    }
    return { profile, idHash };
  }

  const view = async (p) => ({
    id: p.id, name: p.name, email: p.email, phone: p.phone || '', postcode: p.postcode || '', role: p.role || '',
    marketing: !!p.marketingConsent && !p.unsubscribed, createdAt: p.createdAt,
    designCount: await pstore.countDesigns(p.id), designLimit: config.freeProfileMaxDesigns,
  });

  // Sign up, in, out, password, preferences, delete ----------------------------------------------------------------------
  function validateSignup(b) {
    const name = cleanText(b.name, 80);
    if (name.length < 1) throw new HttpError('BAD_REQUEST', 'Enter your name.');
    const email = cleanText(b.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError('BAD_REQUEST', 'Enter a valid email address.');
    const password = b.password;
    if (typeof password !== 'string' || password.length > 200) throw new HttpError('BAD_REQUEST', 'Choose a password of 10 to 200 characters.');
    const problem = passwordProblem(password, { email });
    if (problem) throw new HttpError('BAD_REQUEST', problem);
    if (b.acceptTerms !== true || b.acceptPrivacy !== true) throw new HttpError('BAD_REQUEST', 'Please accept the site terms and the privacy policy to create a profile.');
    let phone = null;
    if (b.phone != null && String(b.phone).trim() !== '') {
      phone = cleanText(b.phone, 30);
      const digits = phone.replace(/\D/g, '');
      if (!/^[0-9 +()\-]+$/.test(phone) || digits.length < 6 || digits.length > 15) throw new HttpError('BAD_REQUEST', 'Enter a valid phone number or leave it blank.');
    }
    let postcode = null;
    if (b.postcode != null && String(b.postcode).trim() !== '') {
      postcode = cleanText(b.postcode, 60);
      if (!/^[\p{L}0-9 '.\-]{2,60}$/u.test(postcode)) throw new HttpError('BAD_REQUEST', 'Enter a postcode or suburb, or leave it blank.');
    }
    let role = null;
    if (b.role != null && String(b.role) !== '') {
      if (!ROLE_IDS.includes(b.role)) throw new HttpError('BAD_REQUEST', 'Choose one of the options for "I am a".');
      role = b.role;
    }
    if (b.marketing != null && typeof b.marketing !== 'boolean') throw new HttpError('BAD_REQUEST', 'Marketing must be true or false.');
    return { name, email, password, phone, postcode, role, marketing: b.marketing === true };
  }

  // M3: one answer for every valid request. A new email gets a profile; an email that already has one gets nothing changed. Both receive the same
  // 202 body and NO session cookie, so the response cannot be used to find out who is registered. The browser then signs in with the details the
  // person just typed (src/profile/controller.js): that works for a new profile and fails with the generic sign in message for an existing one.
  // Marketing consent is stored UNVERIFIED (no email is sent yet, so nobody has confirmed the address belongs to the person who typed it).
  // TODO(double opt in): when the owner approves email sending, send a confirmation link here and set marketingConsentVerified only when it is
  // clicked; until then the marketing export leaves unverified contacts out. Do not add sending without an owner decision.
  const SIGNUP_ACCEPTED = { ok: true, signedIn: false, message: 'Thanks. If this email address does not already have a profile, one has been created. Sign in with your email address and password to continue.' };
  async function signUp(r) {
    const b = await readJson(r.request, 8192);
    const v = validateSignup(b); // a form that fails validation costs nothing (no hashing, nothing stored), so only complete attempts are counted
    await limit(`profile:signup:ip:${await ipKey(r.request)}`, config.profileSignupRateMax, 3600);
    await limit(`profile:signup:email:${(await sha256Hex(v.email)).slice(0, 32)}`, 3, 86400);
    // The password is hashed before the email is looked up, so a taken email costs the same time as a new one.
    const passwordHash = await hashPassword(v.password);
    const nowMs = now();
    const at = iso(nowMs);
    const profile = {
      id: rid('prof'), email: v.email, name: v.name, phone: v.phone, postcode: v.postcode, role: v.role, passwordHash,
      termsVersion: TERMS_VERSION, termsAcceptedAt: at,
      marketingConsent: v.marketing, marketingConsentAt: v.marketing ? at : null, marketingTextVersion: v.marketing ? MARKETING_TEXT_VERSION : null, marketingConsentVerified: false,
      unsubscribed: false, unsubscribedAt: null, lastSignInAt: null, createdAt: at, updatedAt: at,
    };
    if (await pstore.createProfile(profile)) {
      if (v.marketing) await pstore.addConsentEvent({ id: rid('cons'), profileId: profile.id, at, consent: true, textVersion: MARKETING_TEXT_VERSION, text: MARKETING_TEXTS[MARKETING_TEXT_VERSION], source: 'signup' });
      await pstore.purgeSessions(at);
    }
    return json(SIGNUP_ACCEPTED, 202);
  }

  async function signIn(r) {
    const b = await readJson(r.request, 4096);
    const email = cleanText(b.email, 254).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    await limit(`profile:signin:ip:${await ipKey(r.request)}`, config.profileSigninIpMax, 600);
    // M4: the throttle is keyed on email plus address, so someone guessing at a known email only throttles their own address; a higher ceiling per
    // email across all addresses (PROFILE_SIGNIN_EMAIL_GLOBAL_MAX) slows guessing that is spread over many addresses. Counted before the password is checked (atomic).
    const emailHash = (await sha256Hex(email)).slice(0, 32);
    await limit(`profile:signin:emailip:${emailHash}:${await ipKey(r.request)}`, config.profileSigninEmailMax, 900);
    await limit(`profile:signin:email:${emailHash}`, config.profileSigninEmailGlobalMax, 900);
    if (!email || !password || password.length > 200) {
      await dummyVerify(password);
      throw new HttpError('INVALID_CREDENTIALS', GENERIC_SIGNIN);
    }
    const profile = await pstore.getProfileByEmail(email);
    if (!profile) {
      await dummyVerify(password);
      throw new HttpError('INVALID_CREDENTIALS', GENERIC_SIGNIN);
    }
    const check = await verifyPassword(password, profile.passwordHash);
    if (!check.ok) throw new HttpError('INVALID_CREDENTIALS', GENERIC_SIGNIN);
    const at = iso();
    const patch = { lastSignInAt: at };
    if (check.needsRehash) patch.passwordHash = await hashPassword(password);
    await pstore.updateProfile(profile.id, patch);
    await pstore.purgeSessions(at);
    await startSession(r, profile);
    return json({ profile: await view({ ...profile, ...patch }) });
  }

  async function signOut(r) {
    const token = cookiesOf(r.request)[PROFILE_COOKIE];
    if (token && token.length <= 100) await pstore.deleteSession(await sha256Hex(token));
    r.setCookie = sessionCookie('', 0);
    return json({ ok: true });
  }

  async function me(r) {
    const a = await auth(r, { required: false });
    return json({ profile: a ? await view(a.profile) : null, limits: { designs: config.freeProfileMaxDesigns }, resetNote: RESET_NOTE });
  }

  async function changePassword(r) {
    const { profile, idHash } = await auth(r);
    const b = await readJson(r.request, 4096);
    await limit(`profile:pw:${profile.id}`, 10, 3600);
    const current = typeof b.current === 'string' ? b.current : '';
    const next = typeof b.next === 'string' ? b.next : '';
    if (!(await verifyPassword(current, profile.passwordHash)).ok) throw new HttpError('INVALID_CREDENTIALS', 'Your current password is not right.');
    if (next.length > 200) throw new HttpError('BAD_REQUEST', 'Choose a password of 10 to 200 characters.');
    const problem = next === current ? 'Choose a new password, not the current one.' : passwordProblem(next, { email: profile.email });
    if (problem) throw new HttpError('BAD_REQUEST', problem);
    await pstore.updateProfile(profile.id, { passwordHash: await hashPassword(next), updatedAt: iso() });
    await pstore.deleteProfileSessions(profile.id, idHash); // other devices are signed out
    return json({ ok: true });
  }

  /** Email preferences. Turning marketing on is a fresh opt in (clears an unsubscribe) and is recorded with the current wording; off is an unsubscribe. */
  async function setPreferences(r) {
    const { profile } = await auth(r);
    const b = await readJson(r.request, 1024);
    if (typeof b.marketing !== 'boolean') throw new HttpError('BAD_REQUEST', 'marketing must be true or false.');
    const at = iso();
    const patch = b.marketing
      ? { marketingConsent: true, marketingConsentAt: at, marketingTextVersion: MARKETING_TEXT_VERSION, marketingConsentVerified: false, unsubscribed: false, unsubscribedAt: null, updatedAt: at }
      : { marketingConsent: false, unsubscribed: true, unsubscribedAt: at, updatedAt: at };
    await pstore.updateProfile(profile.id, patch);
    await pstore.addConsentEvent({ id: rid('cons'), profileId: profile.id, at, consent: b.marketing, textVersion: b.marketing ? MARKETING_TEXT_VERSION : null, text: b.marketing ? MARKETING_TEXTS[MARKETING_TEXT_VERSION] : null, source: 'preferences' });
    return json({ profile: await view({ ...profile, ...patch }) });
  }

  async function deleteAccount(r) {
    const { profile } = await auth(r);
    const b = await readJson(r.request, 1024);
    await limit(`profile:del:${profile.id}`, 5, 3600);
    if (!(await verifyPassword(typeof b.password === 'string' ? b.password : '', profile.passwordHash)).ok) throw new HttpError('INVALID_CREDENTIALS', 'Your password is not right.');
    // L6: the consent record outlives the account, anonymised (salted hash of the address, no name or email), so the Spam Act 2003 evidence and an
    // unsubscribe survive. Purged after CONSENT_ARCHIVE_YEARS by the scheduled cleanup. The privacy policy should say so.
    const at = iso();
    await pstore.archiveConsent({ profileId: profile.id, emailHash: await sha256Hex(`${config.ipHashSalt}consent:${profile.email}`), archivedAt: at, finalConsent: !!profile.marketingConsent && !profile.unsubscribed, newId: rid('cons') });
    await pstore.deleteProfile(profile.id);
    r.setCookie = sessionCookie('', 0);
    return json({ ok: true });
  }

  // Designs --------------------------------------------------------------------------------------------------------------
  const kindOf = (p) => (p?.mode === 'commercial' ? 'commercial' : 'residential');
  const addressOf = (p) => cleanText(p?.site?.lot?.address || p?.site?.address || '', 200) || null;
  const designView = (d) => ({
    id: d.id, projectId: d.projectId, name: d.name, address: d.address || '', kind: d.kind, thumbnail: d.thumbnail || null, bytes: d.bytes,
    createdAt: d.createdAt, updatedAt: d.updatedAt,
  });

  async function readDesignBody(request) {
    const cap = config.portalProjectMaxBytes;
    let raw;
    try {
      raw = await readText(request, cap + MAX_THUMB + 8192);
    } catch (e) {
      if (e?.code === 'PAYLOAD_TOO_LARGE') throw new HttpError('PROJECT_TOO_LARGE', 'This design is too large to keep in a profile.', { maxBytes: cap });
      throw e;
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError('BAD_REQUEST', 'Bad request.');
    }
    const p = body?.project;
    if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.schema !== 'number' || !Array.isArray(p.levels) || !p.levels.length || typeof p.id !== 'string' || !p.id || p.id.length > 80) {
      throw new HttpError('BAD_PROJECT', 'That is not a Glide Inside design.');
    }
    if (p.site && typeof p.site === 'object') p.site.underlay = null; // the tracing underlay is an image kept in the browser
    const text = JSON.stringify(p);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > cap) throw new HttpError('PROJECT_TOO_LARGE', 'This design is too large to keep in a profile.', { maxBytes: cap, bytes });
    const thumb = typeof body.thumbnail === 'string' && body.thumbnail.length <= MAX_THUMB && THUMB_RE.test(body.thumbnail) ? body.thumbnail : null;
    return { project: p, text, bytes, thumbnail: thumb, name: cleanText(p.name, 80) || 'Untitled design', address: addressOf(p), kind: kindOf(p) };
  }

  const limitMessage = () => `A free profile keeps up to ${config.freeProfileMaxDesigns} designs. Delete one to save another.`;

  async function listDesigns(r) {
    const { profile } = await auth(r);
    const designs = (await pstore.listDesigns(profile.id)).map(designView);
    return json({ designs, count: designs.length, limit: config.freeProfileMaxDesigns });
  }

  async function createDesign(r) {
    const { profile } = await auth(r);
    await limit(`profile:save:${profile.id}`, config.profileSaveRateMax, 3600);
    const b = await readDesignBody(r.request);
    const at = iso();
    const existing = await pstore.getDesignByProject(profile.id, b.project.id);
    if (existing) { // the same design id again is an update, so autosave on a design that is already kept never counts twice
      await pstore.updateDesign(profile.id, existing.id, { name: b.name, address: b.address, kind: b.kind, thumbnail: b.thumbnail ?? existing.thumbnail, project: b.text, bytes: b.bytes, updatedAt: at });
      return json({ design: designView({ ...existing, name: b.name, address: b.address, kind: b.kind, thumbnail: b.thumbnail ?? existing.thumbnail, bytes: b.bytes, updatedAt: at }), created: false });
    }
    if ((await pstore.countDesigns(profile.id)) >= config.freeProfileMaxDesigns) throw new HttpError('DESIGN_LIMIT_REACHED', limitMessage(), { limit: config.freeProfileMaxDesigns });
    const d = { id: rid('des'), profileId: profile.id, projectId: b.project.id, name: b.name, address: b.address, kind: b.kind, thumbnail: b.thumbnail, project: b.text, bytes: b.bytes, createdAt: at, updatedAt: at };
    if (!(await pstore.createDesign(d))) throw new HttpError('CONFLICT', 'That design is already saved. Try again.');
    return json({ design: designView(d), created: true }, 201);
  }

  async function getDesign(r, id) {
    const { profile } = await auth(r);
    const d = await pstore.getDesign(profile.id, id);
    if (!d) throw new HttpError('NOT_FOUND', 'That design was not found.');
    const out = { design: designView(d), project: JSON.parse(d.project) };
    out.pack = (await linkedPackFor(profile.id, d.projectId)) || undefined;
    return json(out);
  }

  async function updateDesign(r, id) {
    const { profile } = await auth(r);
    await limit(`profile:save:${profile.id}`, config.profileSaveRateMax, 3600);
    const d = await pstore.getDesign(profile.id, id);
    if (!d) throw new HttpError('NOT_FOUND', 'That design was not found.');
    const b = await readDesignBody(r.request);
    if (b.project.id !== d.projectId) throw new HttpError('BAD_PROJECT', 'That is a different design.');
    const at = iso();
    await pstore.updateDesign(profile.id, id, { name: b.name, address: b.address, kind: b.kind, thumbnail: b.thumbnail ?? d.thumbnail, project: b.text, bytes: b.bytes, updatedAt: at });
    return json({ design: designView({ ...d, name: b.name, address: b.address, kind: b.kind, thumbnail: b.thumbnail ?? d.thumbnail, bytes: b.bytes, updatedAt: at }) });
  }

  async function renameDesign(r, id) {
    const { profile } = await auth(r);
    const d = await pstore.getDesign(profile.id, id);
    if (!d) throw new HttpError('NOT_FOUND', 'That design was not found.');
    const b = await readJson(r.request, 1024);
    const name = cleanText(b.name, 80);
    if (!name) throw new HttpError('BAD_REQUEST', 'Enter a name for the design.');
    const project = JSON.parse(d.project);
    project.name = name;
    const text = JSON.stringify(project);
    const at = iso();
    await pstore.updateDesign(profile.id, id, { name, project: text, bytes: new TextEncoder().encode(text).length, updatedAt: at });
    return json({ design: designView({ ...d, name, updatedAt: at }) });
  }

  async function duplicateDesign(r, id) {
    const { profile } = await auth(r);
    const d = await pstore.getDesign(profile.id, id);
    if (!d) throw new HttpError('NOT_FOUND', 'That design was not found.');
    if ((await pstore.countDesigns(profile.id)) >= config.freeProfileMaxDesigns) throw new HttpError('DESIGN_LIMIT_REACHED', limitMessage(), { limit: config.freeProfileMaxDesigns });
    const project = JSON.parse(d.project);
    const at = iso();
    project.id = rid('p');
    project.name = `${cleanText(d.name, 70)} (copy)`;
    project.createdAt = project.updatedAt = at;
    const text = JSON.stringify(project);
    const copy = { ...d, id: rid('des'), projectId: project.id, name: project.name, project: text, bytes: new TextEncoder().encode(text).length, createdAt: at, updatedAt: at };
    if (!(await pstore.createDesign(copy))) throw new HttpError('CONFLICT', 'The copy could not be made. Try again.');
    return json({ design: designView(copy) }, 201);
  }

  async function deleteDesign(r, id) {
    const { profile } = await auth(r);
    if (!(await pstore.deleteDesign(profile.id, id))) throw new HttpError('NOT_FOUND', 'That design was not found.');
    return json({ ok: true });
  }

  // Plan Packs ---------------------------------------------------------------------------------------------------------------
  // A Plan Pack is one entitlement row for one project id (lib/entitlement.js). Linking records "this profile owns that entitlement", checked
  // with the pack's own token, so a profile cannot claim a pack it does not hold. Opening a design on another device then hands back a fresh
  // token for the pack linked to that design's project id. The entitlement model itself is unchanged.
  async function linkPack(r, { authenticate, issueToken }) {
    const { profile } = await auth(r);
    await limit(`profile:pack:${profile.id}`, 30, 3600);
    const ent = await authenticate(r.request);
    if (ent.projectId === '*') throw new HttpError('BAD_REQUEST', 'Testing codes cannot be linked to a profile.');
    await pstore.linkPack({ profileId: profile.id, entitlementId: ent.id, projectId: ent.projectId, linkedAt: iso() });
    return json({ linked: true, projectId: ent.projectId, receipt: ent.id, token: await issueToken(ent) });
  }
  let packDeps = null;
  async function linkedPackFor(profileId, projectId) {
    if (!packDeps) return null;
    const links = (await pstore.listPacks(profileId)).filter((p) => p.projectId === projectId);
    for (const l of links) {
      const ent = await store.getEntitlement(l.entitlementId);
      if (!ent || ent.status !== 'active' || (ent.expiresAt && Date.parse(ent.expiresAt) <= now())) continue;
      return { projectId, token: await packDeps.issueToken(ent), receipt: ent.id, expiresAt: ent.expiresAt };
    }
    return null;
  }

  // Owner contacts -------------------------------------------------------------------------------------------------------------
  async function adminAuth(request) {
    if (!config.adminToken) throw new HttpError('PROFILES_NOT_CONFIGURED', 'ADMIN_TOKEN is not set.');
    await limit(`admin:${clientIp(request)}`, 30, 600);
    const given = bearerToken(request);
    if (!given || !(await secretEqual(given, config.adminToken))) throw new HttpError('UNAUTHORISED', 'Not authorised.');
  }
  // M3: consent only counts for marketing once the address has been verified (double opt in, not built yet), unless the owner asks for unverified too.
  const consented = (c) => !!c.marketingConsent && !c.unsubscribed;
  const marketable = (c) => consented(c) && !!c.marketingConsentVerified;
  const statusOf = (c) => (c.unsubscribed ? 'unsubscribed' : c.marketingConsent ? (c.marketingConsentVerified ? 'consented' : 'consented (unverified)') : 'no consent');
  const contactView = (c) => ({
    id: c.id, name: c.name, email: c.email, phone: c.phone || '', postcode: c.postcode || '', role: c.role || '', createdAt: c.createdAt, lastSignInAt: c.lastSignInAt || null,
    designs: c.designs, residentialDesigns: c.residentialDesigns, commercialDesigns: c.commercialDesigns,
    marketingConsent: !!c.marketingConsent, marketingConsentAt: c.marketingConsentAt || null, marketingTextVersion: c.marketingTextVersion || null,
    unsubscribed: !!c.unsubscribed, unsubscribedAt: c.unsubscribedAt || null, marketingStatus: statusOf(c), marketingConsentVerified: !!c.marketingConsentVerified, marketable: marketable(c), consentedUnverified: consented(c) && !c.marketingConsentVerified,
  });
  /** consent=yes|no (yes means marketable), type, from and to (YYYY-MM-DD, Sydney date), designs=none|some, mode=residential|commercial|both, suburb, q. */
  function applyFilters(list, q) {
    const sydneyDay = (iso) => ddmmyyyy(iso).split('/').reverse().join('-');
    const suburb = String(q.get('suburb') || '').trim().toLowerCase();
    const text = String(q.get('q') || '').trim().toLowerCase();
    return list.filter((c) => {
      const consent = q.get('consent');
      if (consent === 'yes' && !marketable(c)) return false;
      if (consent === 'no' && marketable(c)) return false;
      const type = q.get('type');
      if (type && (type === 'unspecified' ? c.role : c.role !== type)) return false;
      const from = q.get('from');
      const to = q.get('to');
      if (from && sydneyDay(c.createdAt) < from) return false;
      if (to && sydneyDay(c.createdAt) > to) return false;
      const designs = q.get('designs');
      if (designs === 'none' && c.designs > 0) return false;
      if (designs === 'some' && c.designs < 1) return false;
      const mode = q.get('mode');
      if (mode === 'residential' && c.residentialDesigns < 1) return false;
      if (mode === 'commercial' && c.commercialDesigns < 1) return false;
      if (mode === 'both' && (c.residentialDesigns < 1 || c.commercialDesigns < 1)) return false;
      if (suburb && !String(c.postcode || '').toLowerCase().includes(suburb)) return false;
      if (text && !`${c.name} ${c.email}`.toLowerCase().includes(text)) return false;
      return true;
    });
  }
  async function adminContacts(r) {
    await adminAuth(r.request);
    const all = await pstore.listContacts();
    const list = applyFilters(all, r.url.searchParams);
    return json({ contacts: list.map(contactView), total: all.length, matching: list.length, marketable: all.filter(marketable).length, consentedUnverified: all.filter((c) => consented(c) && !c.marketingConsentVerified).length });
  }
  const CSV_COLUMNS = ['Name', 'Email', 'Phone', 'Postcode or suburb', 'I am a', 'Joined (DD/MM/YYYY)', 'Designs saved', 'Residential designs', 'Commercial designs', 'Marketing status', 'Consent date (DD/MM/YYYY)', 'Consent wording version'];
  async function adminCsv(r) {
    await adminAuth(r.request);
    const scope = r.url.searchParams.get('scope') === 'all' ? 'all' : 'marketing';
    // M3: the marketing scope leaves out contacts whose consent is unverified. includeUnverified=1 is the owner's explicit, labelled override.
    const includeUnverified = scope === 'marketing' && ['1', 'true', 'yes'].includes(String(r.url.searchParams.get('includeUnverified') || '').toLowerCase());
    let list = applyFilters(await pstore.listContacts(), r.url.searchParams);
    if (scope === 'marketing') list = list.filter(includeUnverified ? consented : marketable); // consenting and not unsubscribed, always, whatever the filters
    const header = scope === 'all' ? [...CSV_COLUMNS, 'Note'] : includeUnverified ? [...CSV_COLUMNS, 'Consent verified'] : CSV_COLUMNS;
    const rows = list.map((c) => {
      const cells = [c.name, c.email, c.phone, c.postcode, c.role, ddmmyyyy(c.createdAt), c.designs, c.residentialDesigns, c.commercialDesigns, statusOf(c), c.marketingConsentAt ? ddmmyyyy(c.marketingConsentAt) : '', c.marketingTextVersion || ''];
      if (includeUnverified) return [...cells, c.marketingConsentVerified ? 'yes' : 'NO, UNVERIFIED'].map(csvCell).join(',');
      return (scope === 'all' ? [...cells, 'NOT FOR MARKETING'] : cells).map(csvCell).join(',');
    });
    const day = ddmmyyyy(iso()).replace(/\//g, '-');
    const filename = scope === 'all' ? `glide-inside-all-contacts-NOT-FOR-MARKETING-${day}.csv` : includeUnverified ? `glide-inside-marketing-contacts-INCLUDES-UNVERIFIED-CONSENT-${day}.csv` : `glide-inside-marketing-contacts-${day}.csv`;
    const headers = { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store', 'x-contact-count': String(rows.length) };
    if (includeUnverified) headers['x-spam-act-warning'] = 'This export includes contacts whose marketing consent is UNVERIFIED. The Spam Act 2003 requires consent to be demonstrable; an unverified tick box is not.';
    return new Response(`\uFEFF${[header.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`, { status: 200, headers });
  }
  async function adminUnsubscribe(r, id) {
    await adminAuth(r.request);
    const b = await readJson(r.request, 1024);
    if (typeof b.unsubscribed !== 'boolean') throw new HttpError('BAD_REQUEST', 'unsubscribed must be true or false.');
    const p = await pstore.getProfile(id);
    if (!p) throw new HttpError('NOT_FOUND', 'No such contact.');
    const at = iso();
    // Marking unsubscribed removes the consent. Clearing the flag does NOT give consent back: only the person opting in again does.
    const patch = b.unsubscribed ? { marketingConsent: false, unsubscribed: true, unsubscribedAt: at, updatedAt: at } : { unsubscribed: false, unsubscribedAt: null, updatedAt: at };
    await pstore.updateProfile(id, patch);
    if (b.unsubscribed) await pstore.addConsentEvent({ id: rid('cons'), profileId: id, at, consent: false, textVersion: null, text: null, source: 'admin' });
    const fresh = (await pstore.listContacts()).find((c) => c.id === id);
    return json({ contact: contactView(fresh) });
  }

  // Routing ------------------------------------------------------------------------------------------------------------------
  const ID = '([A-Za-z0-9_-]{4,60})';
  const ROUTES = [
    ['POST', '/signup', signUp, {}], ['POST', '/session', signIn, {}], ['DELETE', '/session', signOut, {}], ['GET', '/me', me, {}],
    ['POST', '/password', changePassword, {}], ['PUT', '/preferences', setPreferences, {}], ['DELETE', '', deleteAccount, {}],
    ['GET', '/designs', listDesigns, {}], ['POST', '/designs', createDesign, {}],
    ['GET', `/designs/${ID}`, getDesign, {}], ['PUT', `/designs/${ID}`, updateDesign, {}], ['PATCH', `/designs/${ID}`, renameDesign, {}], ['DELETE', `/designs/${ID}`, deleteDesign, {}],
    ['POST', `/designs/${ID}/duplicate`, duplicateDesign, {}],
    ['POST', '/packs', (r) => linkPack(r, packDeps), {}],
    ['GET', '/admin/contacts', adminContacts, { token: true }], ['GET', '/admin/contacts.csv', adminCsv, { token: true }],
    ['POST', `/admin/contacts/${ID}/unsubscribe`, adminUnsubscribe, { token: true }],
  ].map(([method, p, handler, opts]) => ({ method, re: new RegExp(`^${p}$`), handler, opts }));

  return {
    /** Wire in the Plan Pack helpers (authenticate a pack token, issue a token) from app.js. Optional: without it packs are not linked. */
    setPackDeps(deps) {
      packDeps = deps;
    },
    /** Handles /profile and /profile/* (path is the part after /api). */
    async route(request, url, path) {
      const sub = path.slice('/profile'.length);
      const r = { request, url, setCookie: null };
      let matchedPath = false;
      for (const rt of ROUTES) {
        const m = rt.re.exec(sub);
        if (!m) continue;
        matchedPath = true;
        if (rt.method !== request.method) continue;
        if (!rt.opts.token) checkCsrf(request, url); // the owner routes carry a bearer token and no cookie, so there is nothing to forge
        if (/\/packs$/.test(sub) && !packDeps) throw new HttpError('PROFILES_NOT_CONFIGURED', 'Plan Packs cannot be linked on this server.');
        const res = await rt.handler(r, ...m.slice(1).map(decodeURIComponent));
        if (r.setCookie) res.headers.append('set-cookie', r.setCookie);
        return res;
      }
      if (matchedPath) throw new HttpError('BAD_REQUEST', 'That method is not allowed for this endpoint.', {}, 405);
      throw new HttpError('NOT_FOUND', 'No such endpoint.');
    },
    DESIGN_KINDS,
  };
}
