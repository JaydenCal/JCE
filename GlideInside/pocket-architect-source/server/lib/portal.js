// Builder and client portal API (docs/PORTAL_API.md): sessions, houses, Glide library, clients, projects, billing, AI credits,
// team, branding and org settings, plus the admin-token jobs (create an organisation, run month end invoicing).
// Web-standard Request in, Response out, like app.js. Mounted by createApp under /api/portal/* and /api/billing/run-month.

import { migrate, validate } from '../../src/model/schema.js';
import { GLIDE_LIBRARY } from '../../src/portal/glide-library.generated.js';
import { houseStats } from '../../src/portal/house-stats.js';
import { validateColours } from '../../src/portal/theme.js';
import { slugify, cleanSlug } from '../../src/portal/builders.js';
import { projectToSvg } from '../../src/portal/thumbnail.js';
import { generateUsername, generatePassword, passwordProblem } from '../../src/portal/credentials.js';
import { monthKey, NEW_LOGIN_FEE_CENTS, priceForNthLoginThisMonth, loginRateInfo, formatAud, LOGIN_TIER_2_MAX } from '../../src/portal/billing.js';
import { HttpError, json, readJson, clientIp, bearerToken } from './http.js';
import { hashPassword, verifyPassword, dummyVerify, newSessionToken, sha256Hex, secretEqual } from './password.js';
import { aiSnapshot, addTopUp, aiToken, reconcileTopUps, orgPoolIds } from './portal-ai.js';
import { usageForMonth, runMonth, isMonthlyRunTime, contactComplete, topUpRows, stripeCall, ensureCustomer, MONTH_RE } from './portal-billing.js';
import { readTrialConfig, orgState, accountView, trialEndFor, extendedEnd, parseTrialRequest, notifyOwner, trialNoClients, trialNoTopUps, readOnlyError, TRIAL_EXTENSION_DAYS, TERMS_VERSION } from './trial.js';

export const COOKIE = 'gi_session';
const DAY = 86400000;
export const TEMP_PASSWORD_DAYS = 7;
export const LOCKOUT_MS = 15 * 60000;
const SESSION_ABSOLUTE_DAYS = 90;
const SESSION_TOUCH_MS = 10 * 60000;
const MAX_PROJECTS_PER_USER = 200;
const MAX_HOUSES_PER_ORG = 500;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const PERMS = {
  admin: ['houses.write', 'clients.read', 'clients.write', 'billing.read', 'billing.write', 'team.read', 'team.write', 'branding.write', 'projects.read'],
  designer: ['houses.write', 'clients.read', 'projects.read'],
  client: [],
};

const rid = (prefix) => `${prefix}_${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isStaff = (u) => u.role !== 'client';
const cookies = (request) => Object.fromEntries((request.headers.get('cookie') || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));

function text(v, name, { max = 120, required = false } = {}) {
  if (v != null && typeof v !== 'string') throw new HttpError('BAD_REQUEST', `${name} must be text.`);
  const s = (v || '').trim();
  if (required && !s) throw new HttpError('BAD_REQUEST', `${name} is required.`);
  if (s.length > max) throw new HttpError('BAD_REQUEST', `${name} is too long.`);
  return s;
}

/** ABN checksum (ATO algorithm): subtract 1 from the first digit, weight, sum, divisible by 89. */
export function abnValid(abn) {
  const d = String(abn || '').replace(/\s+/g, '');
  if (!/^\d{11}$/.test(d)) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const digits = [...d].map(Number);
  digits[0] -= 1;
  return digits.reduce((s, n, i) => s + n * w[i], 0) % 89 === 0;
}
const fmtAbn = (d) => `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;

export function createPortal({ store, pstore, config, fetchImpl, env = {}, now = () => Date.now(), loadTemplates = () => import('../../src/catalogue/templates.js') }) {
  const iso = (ms = now()) => new Date(ms).toISOString();
  const trialConfig = readTrialConfig(env);

  // Cookies, CSRF, sessions -------------------------------------------------------------------------------------------------
  const sessionCookie = (token, maxAgeSec) => `${COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

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

  async function startSession(r, user) {
    const { token, idHash } = await newSessionToken();
    const nowMs = now();
    await pstore.createSession({ idHash, userId: user.id, createdAt: iso(nowMs), lastSeenAt: iso(nowMs), expiresAt: iso(nowMs + config.sessionDays * DAY) });
    r.setCookie = sessionCookie(token, Math.round(config.sessionDays * 86400));
    return idHash;
  }

  /** The signed in user and org, or throws. `need` is a permission; the forced password change blocks everything else. */
  async function auth(r, { need = null, allowChange = false, allowReadOnly = false } = {}) {
    const token = cookies(r.request)[COOKIE];
    if (!token || token.length > 100) throw new HttpError('UNAUTHORISED', 'Please sign in.');
    const idHash = await sha256Hex(token);
    const session = await pstore.getSession(idHash);
    const nowMs = now();
    if (!session || Date.parse(session.expiresAt) <= nowMs || Date.parse(session.createdAt) + SESSION_ABSOLUTE_DAYS * DAY <= nowMs) {
      if (session) await pstore.deleteSession(idHash);
      throw new HttpError('UNAUTHORISED', 'Please sign in.');
    }
    const user = await pstore.getUser(session.userId);
    if (!user || user.status !== 'active') {
      await pstore.deleteSession(idHash);
      throw new HttpError('UNAUTHORISED', 'Please sign in.');
    }
    const org = await pstore.getOrg(user.orgId);
    if (!org) throw new HttpError('UNAUTHORISED', 'Please sign in.');
    if (nowMs - Date.parse(session.lastSeenAt) > SESSION_TOUCH_MS) {
      await pstore.touchSession(idHash, iso(nowMs), iso(nowMs + config.sessionDays * DAY)); // sliding expiry
      r.setCookie = sessionCookie(token, Math.round(config.sessionDays * 86400));
    }
    if (user.mustChangePassword && !allowChange) throw new HttpError('PASSWORD_CHANGE_REQUIRED', 'Choose a new password before you continue.');
    if (need && !PERMS[user.role].includes(need)) throw new HttpError('FORBIDDEN', 'Your role does not allow that.');
    // After the free trial (or when the owner sets it) an account is read only: reads work, every state changing request is refused.
    const state = orgState(org, nowMs);
    if (state.readOnly && !allowReadOnly && !SAFE_METHODS.has(r.request.method)) throw readOnlyError(state);
    return { user, org, idHash, state };
  }

  // Views -------------------------------------------------------------------------------------------------------------------
  const coloursOf = (o) => (o.brandPrimary ? { primary: o.brandPrimary, accent: o.brandAccent || null, darkInk: o.brandDarkInk || null, darkBg: o.brandDarkBg || null } : null);
  const publicOrg = (o, role) => ({
    id: o.id, name: o.name, shortCode: o.shortCode, branding: { displayName: o.displayName || o.name, logoDataUrl: o.logoDataUrl || null, colours: coloursOf(o) },
    allowClientTopUps: !!o.allowClientTopUps, allowClientEnquiries: o.allowClientEnquiries !== false, showGlideToClients: o.showGlideToClients === true,
    showGlideLibrary: o.showGlideToClients === true, allowClientCadExports: !!o.allowClientCadExports, aiMonthlyCap: o.aiMonthlyCap,
    ...(role === 'admin' ? { billingContact: billingContact(o) } : {}),
  });
  const billingContact = (o) => ({ name: o.billingName || '', email: o.billingEmail || '', phone: o.billingPhone || '', legalName: o.legalName || '', abn: o.abn || '' });
  const publicUser = (u, ai) => ({
    id: u.id, name: u.name, email: u.email || '', username: u.username, role: u.role, status: u.status, mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt, lastSignInAt: u.lastSignInAt || null, tempPasswordExpiresAt: u.mustChangePassword ? u.tempPasswordExpiresAt || null : null, ...(ai ? { ai } : {}),
  });
  const exportsFor = (user, org) => (orgState(org, now()).canExport ? (isStaff(user) || org.allowClientCadExports ? ['pdf', 'dxf', 'glb', 'obj', 'html'] : ['pdf']) : []);
  const houseView = (h) => ({
    id: h.id, orgId: h.orgId, name: h.name, description: h.description || '', source: h.sourceType === 'glide' ? { type: 'glide', ref: h.sourceRef } : { type: 'saved' },
    createdAt: h.createdAt, updatedAt: h.updatedAt, createdBy: h.createdBy, archived: !!h.archived, ...(h.stats || {}), stats: h.stats || null, thumbnail: h.thumbnail || null,
    hasProject: !!h.project || h.hasProject === true,
  });
  const visibleHouse = (user, h) => !h.archived && (user.houseAccess === 'all' || (Array.isArray(user.houseAccess) && user.houseAccess.includes(h.id)));
  const projectView = (p, ownerName) => ({ id: p.id, orgId: p.orgId, ownerId: p.ownerId, name: p.name, lotAddress: p.lotAddress || '', houseNames: p.houseNames || [], createdAt: p.createdAt, updatedAt: p.updatedAt, ownerName: ownerName || '' });

  const aiFor = (org, user, opts = {}) => aiSnapshot({ store, config, org, user, nowMs: now(), ...opts });
  /** Client rows only read the pools (no creation, no expiry work) so a long list stays cheap. */
  async function aiLight(org, user) {
    const nowMs = now();
    const { monthlyId, topUpId } = orgPoolIds(org.id, user.id, monthKey(nowMs));
    const m = await store.getEntitlement(monthlyId);
    const t = await store.getEntitlement(topUpId);
    const cap = m?.creditsTotal ?? org.aiMonthlyCap ?? config.orgMonthlyCredits;
    const used = m ? m.creditsUsed + (m.creditsReserved || 0) : 0;
    const monthlyRemaining = Math.max(0, cap - used);
    const topUpBalance = t ? Math.max(0, t.creditsTotal - t.creditsUsed - (t.creditsReserved || 0)) : 0;
    return { month: monthKey(nowMs), monthlyCap: cap, used, monthlyRemaining, topUpBalance, remaining: monthlyRemaining + topUpBalance, total: cap + topUpBalance };
  }

  async function clientView(org, u, { projectCounts, billedIds, light = true } = {}) {
    const counts = projectCounts || (await pstore.countProjectsByOwner(org.id));
    const billed = billedIds ? billedIds.has(u.id) : !!(await pstore.getLoginIssue(u.id));
    return { ...publicUser(u, light ? await aiLight(org, u) : await aiFor(org, u)), lotAddress: u.lotAddress || '', houseAccess: u.houseAccess, projectCount: counts[u.id] || 0, billed };
  }

  // Accounts ----------------------------------------------------------------------------------------------------------------
  async function createAccount(org, { firstName, email, role, lotAddress = '', houseAccess = 'all' }) {
    const name = text(firstName, 'First name', { required: true, max: 60 });
    const mail = text(email, 'Email', { max: 120 }).toLowerCase();
    if (!emailOk(mail)) throw new HttpError('BAD_REQUEST', 'That email address does not look right.');
    if (mail && (await pstore.emailExists(mail))) throw new HttpError('CONFLICT', 'That email address already has a login.');
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const username = generateUsername(name, []);
      if (await pstore.usernameExists(username)) continue;
      const user = {
        id: rid('u'), orgId: org.id, role, name, email: mail || null, username, passwordHash, mustChangePassword: true,
        tempPasswordExpiresAt: iso(now() + TEMP_PASSWORD_DAYS * DAY), status: 'active', lotAddress: text(lotAddress, 'Lot address', { max: 200 }),
        houseAccess: role === 'client' ? houseAccess : 'all', firstSignInAt: null, lastSignInAt: null, createdAt: iso(),
      };
      if (await pstore.createUser(user)) return { user, credentials: { username, password } };
      if (mail && (await pstore.emailExists(mail))) throw new HttpError('CONFLICT', 'That email address already has a login.');
    }
    throw new HttpError('INTERNAL_ERROR', 'Could not generate a unique username. Try again.');
  }

  async function issueTemp(user) {
    const password = generatePassword();
    await pstore.updateUser(user.id, { passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: iso(now() + TEMP_PASSWORD_DAYS * DAY) });
    await pstore.deleteUserSessions(user.id);
    await pstore.clearFailure(`u:${user.username}`);
    return { credentials: { username: user.username, password } };
  }

  async function cleanAccess(orgId, access) {
    if (access === 'all' || access == null) return 'all';
    if (!Array.isArray(access) || access.length > 500) throw new HttpError('BAD_REQUEST', 'houseAccess must be "all" or a list of house ids.');
    const ids = new Set((await pstore.listHouses(orgId)).map((h) => h.id));
    return access.filter((id) => typeof id === 'string' && ids.has(id));
  }

  // Session -----------------------------------------------------------------------------------------------------------------
  async function signIn(r) {
    const body = await readJson(r.request, 4096);
    const identifier = text(body.identifier, 'Email or username', { required: true, max: 200 }).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password || password.length > 512) throw new HttpError('INVALID_CREDENTIALS', 'That sign in did not work. Check the details and try again.');
    const nowMs = now();
    const ip = clientIp(r.request);
    const userKey = `u:${identifier}`;
    const ipKey = `ip:${ip}`;
    for (const [key, code] of [[userKey, 'ACCOUNT_LOCKED'], [ipKey, 'RATE_LIMITED']]) {
      const f = await pstore.getFailure(key);
      if (f?.lockedUntil && f.lockedUntil > nowMs) {
        const retryAfter = Math.ceil((f.lockedUntil - nowMs) / 1000);
        throw new HttpError(code, code === 'ACCOUNT_LOCKED' ? `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.` : 'Too many attempts. Try again later.', { retryAfter });
      }
    }
    const user = await pstore.findUserByLogin(identifier);
    const check = user ? await verifyPassword(password, user.passwordHash) : (await dummyVerify(password), { ok: false });
    if (!check.ok) {
      const u = await pstore.addFailure(userKey, nowMs, { windowMs: LOCKOUT_MS, max: config.loginMaxFailures, lockMs: LOCKOUT_MS });
      await pstore.addFailure(ipKey, nowMs, { windowMs: LOCKOUT_MS, max: config.loginIpMaxFailures, lockMs: LOCKOUT_MS });
      if (u.lockedUntil) throw new HttpError('ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${Math.ceil(LOCKOUT_MS / 60000)} minutes.`, { retryAfter: Math.ceil(LOCKOUT_MS / 1000) });
      throw new HttpError('INVALID_CREDENTIALS', 'That sign in did not work. Check the details and try again.');
    }
    if (user.status !== 'active') throw new HttpError('ACCOUNT_DISABLED', 'This login has been disabled. Contact your builder.');
    if (user.mustChangePassword && user.tempPasswordExpiresAt && Date.parse(user.tempPasswordExpiresAt) <= nowMs) {
      throw new HttpError('PASSWORD_EXPIRED', `This temporary password expired after ${TEMP_PASSWORD_DAYS} days. Ask your builder for a new one.`);
    }
    await pstore.clearFailure(userKey);
    const patch = { lastSignInAt: iso(nowMs) };
    if (!user.firstSignInAt) patch.firstSignInAt = iso(nowMs);
    if (check.needsRehash) patch.passwordHash = await hashPassword(password);
    await pstore.updateUser(user.id, patch);
    // The charge for a client login is created here, once: login_issues.login_id is its primary key. Its price depends on how many logins
    // of this org have already first signed in this Sydney month (1 to 15 A$30, 16 to 50 A$25, or the org's custom rate).
    if (user.role === 'client' && !user.firstSignInAt) {
      const orgRow = await pstore.getOrg(user.orgId);
      const month = monthKey(nowMs);
      const nth = (await pstore.listLoginIssues(user.orgId)).filter((i) => i.month === month).length + 1;
      await pstore.addLoginIssue({ loginId: user.id, id: rid('li'), orgId: user.orgId, clientName: user.name, issuedAt: iso(nowMs), month, amountCents: priceForNthLoginThisMonth(nth, orgRow) });
    }
    await pstore.purgeSessions(iso(nowMs));
    await startSession(r, user);
    const org = await pstore.getOrg(user.orgId);
    return json(await meBody({ ...user, ...patch }, org));
  }

  async function signOut(r) {
    const token = cookies(r.request)[COOKIE];
    if (token && token.length <= 100) await pstore.deleteSession(await sha256Hex(token));
    r.setCookie = sessionCookie('', 0);
    return json({ ok: true });
  }

  async function meBody(user, org) {
    const ai = await aiFor(org, user);
    const st = orgState(org, now());
    return {
      user: publicUser(user, ai), org: publicOrg(org, user.role), permissions: [...PERMS[user.role]], houseAccess: user.houseAccess, lotAddress: user.lotAddress || '', ai,
      canTopUp: st.canTopUp && (isStaff(user) || !!org.allowClientTopUps), plansIncluded: true, enquiry: !st.readOnly && (isStaff(user) || org.allowClientEnquiries !== false), exports: exportsFor(user, org),
      account: accountView(org, now()),
      exportWatermark: orgState(org, now()).isTrial, // server decided: exports carry the free trial mark until a card is added
    };
  }

  async function me(r) {
    const { user, org } = await auth(r, { allowChange: true });
    return json(await meBody(user, org));
  }

  async function changePassword(r) {
    const { user, idHash } = await auth(r, { allowChange: true, allowReadOnly: true });
    const body = await readJson(r.request, 4096);
    const key = `u:${user.username}`;
    const f = await pstore.getFailure(key);
    if (f?.lockedUntil && f.lockedUntil > now()) throw new HttpError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { retryAfter: Math.ceil((f.lockedUntil - now()) / 1000) });
    const cur = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    if (!(await verifyPassword(cur, user.passwordHash)).ok) {
      await pstore.addFailure(key, now(), { windowMs: LOCKOUT_MS, max: config.loginMaxFailures, lockMs: LOCKOUT_MS });
      throw new HttpError('INVALID_CREDENTIALS', 'The current password is not right.');
    }
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (next.length > 512) throw new HttpError('BAD_REQUEST', 'That password is too long.');
    const problem = next === cur ? 'Choose a new password, not the current one.' : passwordProblem(next, { username: user.username, email: user.email, temporary: cur });
    if (problem) throw new HttpError('BAD_REQUEST', problem);
    await pstore.updateUser(user.id, { passwordHash: await hashPassword(next), mustChangePassword: false, tempPasswordExpiresAt: null });
    await pstore.clearFailure(key);
    await pstore.deleteUserSessions(user.id, idHash); // other sessions are signed out
    return json({ ok: true });
  }

  // No email is sent by this server, so there is no self service reset link: staff ask an admin for a new temporary password.
  const resetRequest = async (r) => (await readJson(r.request, 2048), json({ ok: true }));
  const resetComplete = async (r) => {
    await readJson(r.request, 4096);
    throw new HttpError('BAD_REQUEST', 'This reset link has expired. Ask your admin for a new password.');
  };

  // Houses and Glide library ------------------------------------------------------------------------------------------------
  async function resolveGlideProject(ref, name) {
    const g = GLIDE_LIBRARY.find((x) => x.id === ref);
    if (!g) throw new HttpError('NOT_FOUND', 'Unknown Glide Inside model.');
    const { createFromTemplate } = await loadTemplates();
    const p = createFromTemplate(g.templateId);
    if (name) p.name = name;
    return p;
  }
  const glideStats = (g) => {
    const { id, name, thumbnail, templateId, description, type, category, ...stats } = g;
    return { stats, thumbnail };
  };
  function parseProject(raw) {
    let p;
    try {
      p = migrate(raw);
    } catch (e) {
      throw new HttpError('BAD_REQUEST', e.message || 'That is not a Pocket Architect design.');
    }
    if (JSON.stringify(p).length > config.portalProjectMaxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'That design is too large to save. Remove the underlay image and try again.');
    return p;
  }

  async function listHouses(r) {
    const { user } = await auth(r);
    const includeArchived = r.url.searchParams.get('includeArchived') === 'true';
    const list = await pstore.listHouses(user.orgId);
    return json(list.filter((h) => (isStaff(user) ? includeArchived || !h.archived : visibleHouse(user, h))).map(houseView));
  }
  async function getHouse(r, id) {
    const { user } = await auth(r);
    const h = await pstore.getHouse(user.orgId, id);
    if (!h || (!isStaff(user) && !visibleHouse(user, h))) throw new HttpError('NOT_FOUND', 'That house design was not found.');
    const project = h.project ? clone(h.project) : await resolveGlideProject(h.sourceRef, h.name);
    project.name = h.name;
    return json({ ...houseView(h), project });
  }
  async function saveHouse(r) {
    const { user, org } = await auth(r, { need: 'houses.write' });
    const body = await readJson(r.request, config.portalProjectMaxBytes + 200000);
    const { id, name, project, fromGlideId, description } = body;
    let h = id ? await pstore.getHouse(org.id, String(id)) : null;
    if (id && !h) throw new HttpError('NOT_FOUND', 'That house design was not found.');
    const patch = {};
    if (fromGlideId) {
      const g = GLIDE_LIBRARY.find((x) => x.id === fromGlideId);
      if (!g) throw new HttpError('NOT_FOUND', 'Unknown Glide Inside model.');
      const gs = glideStats(g);
      Object.assign(patch, { stats: gs.stats, thumbnail: gs.thumbnail, sourceType: 'glide', sourceRef: fromGlideId, project: null });
    } else if (project) {
      const p = parseProject(project);
      const problems = validate(p);
      if (problems.length) throw new HttpError('BAD_REQUEST', `That design has problems: ${problems.slice(0, 3).join('; ')}.`);
      Object.assign(patch, { project: p, stats: houseStats(p), thumbnail: projectToSvg(p) });
      if (!h) Object.assign(patch, { sourceType: 'saved', sourceRef: null });
    } else if (!h) throw new HttpError('BAD_REQUEST', 'Send a project or fromGlideId.');
    const glideName = fromGlideId ? GLIDE_LIBRARY.find((x) => x.id === fromGlideId)?.name : null;
    const label = text(name ?? glideName ?? h?.name ?? patch.project?.name, 'Name', { required: true, max: 80 });
    const all = await pstore.listHouses(org.id);
    if (all.some((x) => x.id !== h?.id && !x.archived && x.name.toLowerCase() === label.toLowerCase())) throw new HttpError('CONFLICT', 'A house design with that name already exists.');
    if (!h && all.length >= MAX_HOUSES_PER_ORG) throw new HttpError('BAD_REQUEST', 'This organisation has reached its limit of house designs. Archive or delete some.');
    const base = { name: label, description: description === undefined ? h?.description || '' : text(description, 'Description', { max: 500 }), updatedAt: iso() };
    if (!h) {
      h = { id: rid('h'), orgId: org.id, createdBy: user.id, createdAt: iso(), archived: false, project: null, ...base, ...patch };
      await pstore.saveHouse(h);
    } else {
      h = { ...h, ...base, ...patch };
      await pstore.saveHouse(h);
    }
    return json(houseView({ ...h, hasProject: !!h.project }));
  }
  async function duplicateHouse(r, id) {
    const { user, org } = await auth(r, { need: 'houses.write' });
    const h = await pstore.getHouse(org.id, id);
    if (!h) throw new HttpError('NOT_FOUND', 'That house design was not found.');
    const names = new Set((await pstore.listHouses(org.id)).map((x) => x.name.toLowerCase()));
    let n = 2;
    let label = `${h.name} copy`;
    while (names.has(label.toLowerCase())) label = `${h.name} copy ${n++}`;
    const copy = { ...clone(h), id: rid('h'), name: label.slice(0, 80), createdBy: user.id, createdAt: iso(), updatedAt: iso(), archived: false };
    await pstore.saveHouse(copy);
    return json(houseView(copy));
  }
  async function archiveHouse(r, id) {
    const { org } = await auth(r, { need: 'houses.write' });
    const body = await readJson(r.request, 1024).catch(() => ({}));
    const h = await pstore.getHouse(org.id, id);
    if (!h) throw new HttpError('NOT_FOUND', 'That house design was not found.');
    h.archived = body.archived !== false;
    h.updatedAt = iso();
    await pstore.saveHouse(h);
    return json(houseView(h));
  }
  async function listGlide(r) {
    const { user, org } = await auth(r);
    if (!isStaff(user) && org.showGlideToClients !== true) return json([]);
    return json(GLIDE_LIBRARY.map((g) => ({ ...g })));
  }
  async function getGlide(r, id) {
    const { user, org } = await auth(r);
    const g = GLIDE_LIBRARY.find((x) => x.id === id);
    if (!g || (!isStaff(user) && org.showGlideToClients !== true)) throw new HttpError('NOT_FOUND', 'Unknown Glide Inside model.');
    return json({ ...g, project: await resolveGlideProject(id, g.name) });
  }

  // Clients -----------------------------------------------------------------------------------------------------------------
  async function ownClient(org, id) {
    const u = await pstore.getUser(id);
    if (!u || u.orgId !== org.id || u.role !== 'client') throw new HttpError('NOT_FOUND', 'That client login was not found.');
    return u;
  }
  async function listClients(r) {
    const { org } = await auth(r, { need: 'clients.read' });
    const users = await pstore.listUsers(org.id, false);
    const projectCounts = await pstore.countProjectsByOwner(org.id);
    const billedIds = new Set((await pstore.listLoginIssues(org.id)).map((i) => i.loginId));
    return json(await Promise.all(users.map((u) => clientView(org, u, { projectCounts, billedIds }))));
  }
  async function issueClient(r) {
    const { org, state } = await auth(r, { need: 'clients.write' });
    if (!state.canIssueClients) throw trialNoClients();
    const b = await readJson(r.request, 8192);
    const access = await cleanAccess(org.id, b.houseAccess);
    const { user, credentials } = await createAccount(org, { firstName: b.firstName, email: b.email, role: 'client', lotAddress: b.lotAddress, houseAccess: access });
    const monthNow = monthKey(now());
    const rate = priceForNthLoginThisMonth((await pstore.listLoginIssues(org.id)).filter((i) => i.month === monthNow).length + 1, org);
    return json({ client: await clientView(org, user, { billedIds: new Set() }), credentials, charge: { amountCents: rate, trigger: 'first_sign_in', note: `${formatAud(rate)} incl. GST is charged on your monthly invoice once your client first signs in.` } }, 201);
  }
  async function updateClient(r, id) {
    const { org } = await auth(r, { need: 'clients.write' });
    const u = await ownClient(org, id);
    const b = await readJson(r.request, 8192);
    const patch = {};
    if (b.firstName !== undefined) patch.name = text(b.firstName, 'First name', { required: true, max: 60 });
    if (b.email !== undefined) {
      const mail = text(b.email, 'Email', { max: 120 }).toLowerCase();
      if (!emailOk(mail)) throw new HttpError('BAD_REQUEST', 'That email address does not look right.');
      if (mail && (await pstore.emailExists(mail, u.id))) throw new HttpError('CONFLICT', 'That email address already has a login.');
      patch.email = mail || null;
    }
    if (b.lotAddress !== undefined) patch.lotAddress = text(b.lotAddress, 'Lot address', { max: 200 });
    if (b.houseAccess !== undefined) patch.houseAccess = await cleanAccess(org.id, b.houseAccess);
    await pstore.updateUser(u.id, patch);
    return json(await clientView(org, { ...u, ...patch }));
  }
  async function resetClient(r, id) {
    const { org, state } = await auth(r, { need: 'clients.write' });
    if (!state.canIssueClients) throw trialNoClients();
    return json(await issueTemp(await ownClient(org, id)));
  }
  async function deleteClient(r, id) {
    const { org } = await auth(r, { need: 'clients.write' });
    const u = await ownClient(org, id);
    const charged = !!(await pstore.getLoginIssue(u.id)); // the billing row stays: it is the financial record
    const { removedProjects } = await pstore.deleteUser(org.id, u.id);
    return json({ ok: true, removedProjects, charged });
  }
  async function exportClient(r, id) {
    const { org } = await auth(r, { need: 'clients.read' });
    const u = await ownClient(org, id);
    const projects = [];
    for (const meta of await pstore.listProjects(org.id, u.id)) {
      const p = await pstore.getProject(org.id, meta.id);
      projects.push({ id: p.id, name: p.name, lotAddress: p.lotAddress || '', updatedAt: p.updatedAt, project: p.project });
    }
    return json({ exportedAt: iso(), client: { id: u.id, name: u.name, username: u.username, email: u.email || '', lotAddress: u.lotAddress || '' }, projects });
  }
  async function setStatus(r, id, kind, status) {
    const { user: me, org, state } = await auth(r, { need: kind === 'client' ? 'clients.write' : 'team.write' });
    if (kind === 'client' && status === 'active' && !state.canIssueClients) throw trialNoClients();
    const u = kind === 'client' ? await ownClient(org, id) : await ownStaff(org, id);
    if (status === 'disabled' && u.id === me.id) throw new HttpError('CONFLICT', 'You cannot disable your own login.');
    if (status === 'disabled' && u.role === 'admin' && !(await pstore.countActiveAdmins(org.id, u.id))) throw new HttpError('CONFLICT', 'There must be at least one active admin.');
    await pstore.updateUser(u.id, { status });
    if (status === 'disabled') await pstore.deleteUserSessions(u.id); // sessions end at once
    const next = { ...u, status };
    return json(kind === 'client' ? await clientView(org, next) : publicUser(next, await aiLight(org, next)));
  }

  // Projects ----------------------------------------------------------------------------------------------------------------
  async function listProjects(r) {
    const { user, org } = await auth(r);
    const clientId = r.url.searchParams.get('clientId');
    const list = await pstore.listProjects(org.id, isStaff(user) ? clientId || null : user.id);
    const names = new Map([...(await pstore.listUsers(org.id, false)), ...(await pstore.listUsers(org.id, true))].map((u) => [u.id, u.name]));
    return json(list.map((p) => projectView(p, names.get(p.ownerId))));
  }
  async function openProject(r, id) {
    const { user, org } = await auth(r);
    const p = await pstore.getProject(org.id, id);
    if (!p || (!isStaff(user) && p.ownerId !== user.id)) throw new HttpError('NOT_FOUND', 'That project was not found.');
    const owner = await pstore.getUser(p.ownerId);
    const project = clone(p.project);
    project.id = project.id || p.id;
    return json({ ...projectView(p, owner?.name), project });
  }
  async function saveProject(r) {
    const { user, org } = await auth(r);
    const b = await readJson(r.request, config.portalProjectMaxBytes + 200000);
    let p = b.id ? await pstore.getProject(org.id, String(b.id)) : null;
    if (b.id && (!p || (!isStaff(user) && p.ownerId !== user.id))) throw new HttpError('NOT_FOUND', 'That project was not found.');
    const proj = parseProject(b.project);
    if (!p) {
      const counts = await pstore.countProjectsByOwner(org.id);
      if ((counts[user.id] || 0) >= MAX_PROJECTS_PER_USER) throw new HttpError('BAD_REQUEST', 'You have reached the limit of saved projects. Delete some first.');
      p = { id: rid('pr'), orgId: org.id, ownerId: user.id, createdAt: iso() };
    }
    p = {
      ...p, name: text(b.name ?? proj.name, 'Name', { required: true, max: 80 }), updatedAt: iso(), project: proj,
      lotAddress: b.lotAddress !== undefined ? text(b.lotAddress, 'Lot address', { max: 200 }) : p.lotAddress || '',
      houseNames: Array.isArray(b.houseNames) ? b.houseNames.slice(0, 20).map((x) => String(x).slice(0, 80)) : p.houseNames || [],
    };
    await pstore.saveProject(p);
    return json(projectView(p, user.name));
  }

  // Billing -----------------------------------------------------------------------------------------------------------------
  async function userNames(orgId) {
    return new Map((await pstore.listUsers(orgId, false)).map((u) => [u.id, u.name]));
  }
  async function monthUsage(r) {
    const { org } = await auth(r, { need: 'billing.read' });
    const month = r.url.searchParams.get('month') || monthKey(now());
    if (!MONTH_RE.test(month)) throw new HttpError('BAD_REQUEST', 'month must be YYYY-MM.');
    return json(await usageForMonth({ pstore, store, orgId: org.id, month, names: await userNames(org.id) }));
  }
  const invoiceRow = (i) => ({ id: i.id, number: i.number, month: i.month, issuedAt: i.issuedAt, dueAt: i.dueAt, status: i.status, loginsCount: i.loginsCount, topUpsCount: i.topUpsCount, totalCents: i.totalCents });
  const issued = (i) => ['due', 'paid', 'void'].includes(i.status);
  async function listInvoices(r) {
    const { org } = await auth(r, { need: 'billing.read' });
    return json((await pstore.listInvoices(org.id)).filter(issued).map(invoiceRow));
  }
  async function getInvoice(r, id) {
    const { org } = await auth(r, { need: 'billing.read' });
    const i = await pstore.getInvoice(org.id, id);
    if (!i || !issued(i)) throw new HttpError('NOT_FOUND', 'That invoice was not found.');
    return json({ ...i.snapshot, ...invoiceRow(i), hostedInvoiceUrl: i.stripeHostedUrl || null });
  }
  async function getContact(r) {
    const { org } = await auth(r, { need: 'billing.read' });
    return json(billingContact(org));
  }
  async function setContact(r) {
    const { org } = await auth(r, { need: 'billing.write', allowReadOnly: true });
    const b = await readJson(r.request, 4096);
    const mail = text(b.email, 'Billing email', { required: true, max: 120 }).toLowerCase();
    if (!emailOk(mail)) throw new HttpError('BAD_REQUEST', 'That email address does not look right.');
    const digits = String(b.abn || '').replace(/\s+/g, '');
    if (!abnValid(digits)) throw new HttpError('BAD_REQUEST', 'Enter the 11 digit ABN for your business.');
    const patch = { billingName: text(b.name, 'Contact name', { required: true, max: 120 }), billingEmail: mail, billingPhone: text(b.phone, 'Phone', { max: 30 }), legalName: text(b.legalName, 'Legal business name', { required: true, max: 120 }), abn: fmtAbn(digits) };
    await pstore.updateOrg(org.id, patch);
    return json(billingContact({ ...org, ...patch }));
  }

  // AI credits --------------------------------------------------------------------------------------------------------------
  async function aiBalance(r) {
    const { user, org } = await auth(r);
    return json(await aiFor(org, user));
  }
  async function aiTopUp(r) {
    const { user, org, state } = await auth(r);
    if (state.isTrial) throw trialNoTopUps();
    if (!isStaff(user) && !org.allowClientTopUps) throw new HttpError('TOPUPS_DISABLED', 'Your builder has turned off AI credit top-ups.');
    if ((await store.hitRate(`topup:${org.id}:${user.id}`, 3600, now())) > 10) throw new HttpError('RATE_LIMITED', 'Too many top-ups in the last hour.', { retryAfter: 600 });
    const topUp = await addTopUp({ store, config, org, user, nowMs: now(), randomId: rid });
    return json({ topUp, ai: await aiFor(org, user) });
  }
  async function aiTokenRoute(r) {
    const { user, org } = await auth(r);
    await reconcileTopUps({ store, org, user, nowMs: now() });
    return json(await aiToken({ config, org, user, nowMs: now() }));
  }

  // Team --------------------------------------------------------------------------------------------------------------------
  async function ownStaff(org, id) {
    const u = await pstore.getUser(id);
    if (!u || u.orgId !== org.id || u.role === 'client') throw new HttpError('NOT_FOUND', 'That team member was not found.');
    return u;
  }
  async function listTeam(r) {
    const { org } = await auth(r, { need: 'team.read' });
    const users = await pstore.listUsers(org.id, true);
    return json(await Promise.all(users.map(async (u) => publicUser(u, await aiLight(org, u)))));
  }
  async function inviteStaff(r) {
    const { org } = await auth(r, { need: 'team.write' });
    const b = await readJson(r.request, 4096);
    if (!['admin', 'designer'].includes(b.role)) throw new HttpError('BAD_REQUEST', 'Role must be admin or designer.');
    const { user, credentials } = await createAccount(org, { firstName: b.firstName, email: b.email, role: b.role });
    return json({ user: publicUser(user, await aiLight(org, user)), credentials }, 201);
  }
  async function updateStaff(r, id) {
    const { org } = await auth(r, { need: 'team.write' });
    const u = await ownStaff(org, id);
    const b = await readJson(r.request, 4096);
    const patch = {};
    if (b.role !== undefined) {
      if (!['admin', 'designer'].includes(b.role)) throw new HttpError('BAD_REQUEST', 'Role must be admin or designer.');
      if (u.role === 'admin' && b.role !== 'admin' && !(await pstore.countActiveAdmins(org.id, u.id))) throw new HttpError('CONFLICT', 'There must be at least one admin.');
      patch.role = b.role;
    }
    if (b.firstName !== undefined) patch.name = text(b.firstName, 'First name', { required: true, max: 60 });
    if (b.email !== undefined) {
      const mail = text(b.email, 'Email', { max: 120 }).toLowerCase();
      if (!emailOk(mail)) throw new HttpError('BAD_REQUEST', 'That email address does not look right.');
      if (mail && (await pstore.emailExists(mail, u.id))) throw new HttpError('CONFLICT', 'That email address already has a login.');
      patch.email = mail || null;
    }
    await pstore.updateUser(u.id, patch);
    if (patch.role) await pstore.deleteUserSessions(u.id); // a role change takes effect at once
    return json(publicUser({ ...u, ...patch }, await aiLight(org, { ...u, ...patch })));
  }
  async function resetStaff(r, id) {
    const { org } = await auth(r, { need: 'team.write' });
    return json(await issueTemp(await ownStaff(org, id)));
  }

  // Branding and settings ---------------------------------------------------------------------------------------------------
  const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff] };
  async function setBranding(r) {
    const { org } = await auth(r, { need: 'branding.write' });
    const b = await readJson(r.request, config.portalLogoMaxBytes + 20000);
    const patch = { displayName: text(b.displayName, 'Name for plans', { required: true, max: 60 }) };
    if (b.logoDataUrl !== undefined) {
      if (b.logoDataUrl === null) patch.logoDataUrl = null;
      else {
        const m = typeof b.logoDataUrl === 'string' && /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.logoDataUrl);
        if (!m) throw new HttpError('BAD_REQUEST', 'The logo must be a PNG or JPG image.');
        if (b.logoDataUrl.length > config.portalLogoMaxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'That logo is too large. Use an image under 300 KB.');
        let head;
        try {
          head = [...atob(m[2].slice(0, 16))].map((c) => c.charCodeAt(0));
        } catch {
          throw new HttpError('BAD_REQUEST', 'The logo must be a PNG or JPG image.');
        }
        if (!MAGIC[m[1]].every((x, i) => head[i] === x)) throw new HttpError('BAD_REQUEST', 'The logo must be a PNG or JPG image.');
        patch.logoDataUrl = b.logoDataUrl;
      }
    }
    // Colour scheme: undefined leaves it alone, null (or no primary) goes back to the Glide Inside look, an object replaces all four.
    if (b.colours !== undefined) {
      if (b.colours === null) Object.assign(patch, { brandPrimary: null, brandAccent: null, brandDarkInk: null, brandDarkBg: null });
      else {
        const v = validateColours(b.colours);
        if (!v.ok) throw new HttpError('BAD_REQUEST', Object.values(v.errors)[0]);
        Object.assign(patch, { brandPrimary: v.colours.primary, brandAccent: v.colours.accent, brandDarkInk: v.colours.darkInk, brandDarkBg: v.colours.darkBg });
      }
    }
    await pstore.updateOrg(org.id, patch);
    const after = { ...org, ...patch };
    return json({ displayName: patch.displayName, logoDataUrl: 'logoDataUrl' in patch ? patch.logoDataUrl : org.logoDataUrl || null, colours: coloursOf(after) });
  }
  async function setSettings(r) {
    const { org, user } = await auth(r, { need: 'billing.write' });
    const b = await readJson(r.request, 2048);
    if (b.showGlideLibrary !== undefined && b.showGlideToClients === undefined) b.showGlideToClients = b.showGlideLibrary;
    const map = { allowClientTopUps: 'allowClientTopUps', allowClientEnquiries: 'allowClientEnquiries', showGlideToClients: 'showGlideToClients', allowClientCadExports: 'allowClientCadExports', allowClientCad: 'allowClientCadExports' };
    const patch = {};
    for (const [from, to] of Object.entries(map)) {
      if (b[from] === undefined) continue;
      if (typeof b[from] !== 'boolean') throw new HttpError('BAD_REQUEST', `${from} must be true or false.`);
      patch[to] = b[from];
    }
    await pstore.updateOrg(org.id, patch);
    return json(publicOrg({ ...org, ...patch }, user.role));
  }

  // Admin token jobs --------------------------------------------------------------------------------------------------------
  async function adminAuth(request) {
    if (!config.adminToken) throw new HttpError('PORTAL_NOT_CONFIGURED', 'ADMIN_TOKEN is not set.');
    if ((await store.hitRate(`admin:${clientIp(request)}`, 600, now())) > 30) throw new HttpError('RATE_LIMITED', 'Too many attempts.', { retryAfter: 600 });
    const given = bearerToken(request);
    if (!given || !(await secretEqual(given, config.adminToken))) throw new HttpError('UNAUTHORISED', 'Not authorised.');
  }
  /** Creates the organisation row only (a unique short code is picked). Returns the org, or throws CONFLICT. */
  async function makeOrg({ name, shortCode, extra = {} }) {
    const base = (shortCode || name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ORG';
    let code = base;
    for (let n = 2; await pstore.getOrgByShortCode(code); n += 1) code = `${base}${n}`;
    let slug = cleanSlug(slugify(name)) || 'builder';
    const slugBase = slug;
    for (let n = 2; await pstore.getOrgBySlug(slug); n += 1) slug = `${slugBase}-${n}`;
    const org = { id: rid('org'), name, shortCode: code, slug, displayName: name, logoDataUrl: null, allowClientTopUps: true, allowClientEnquiries: true, showGlideToClients: false, allowClientCadExports: false, aiMonthlyCap: config.orgMonthlyCredits, createdAt: iso(), ...extra };
    if (!(await pstore.createOrg(org))) throw new HttpError('CONFLICT', 'That organisation already exists.');
    return org;
  }
  /** GET /portal/brand/:slug (public). Only the name, logo and colours of an existing organisation, for the branded sign in page. */
  async function brandBySlug(r, slug) {
    if ((await store.hitRate(`brand:ip:${clientIp(r.request)}`, 600, now())) > 120) throw new HttpError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { retryAfter: 600 });
    const clean = cleanSlug(slug);
    const org = clean ? await pstore.getOrgBySlug(clean) : null;
    if (!org) throw new HttpError('NOT_FOUND', 'That builder is not on Glide Inside.');
    const res = json({ name: org.displayName || org.name, logoUrl: org.logoDataUrl || null, colours: coloursOf(org) });
    res.headers.set('cache-control', 'public, max-age=60');
    return res;
  }
  // Owner sets the builder slug the home page picker uses: { slug: "hunter-homes" } or { slug: null } to clear it.
  async function adminSlug(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const b = await readJson(r.request, 512).catch(() => ({}));
    const slug = b.slug === null ? null : cleanSlug(typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '');
    if (b.slug !== null && !slug) throw new HttpError('BAD_REQUEST', 'Use lower case letters, digits and single hyphens, up to 40 characters.');
    const other = slug ? await pstore.getOrgBySlug(slug) : null;
    if (other && other.id !== org.id) throw new HttpError('CONFLICT', 'Another organisation already uses that slug.');
    await pstore.updateOrg(org.id, { slug });
    return json({ id: org.id, slug });
  }
  async function createOrg(r) {
    await adminAuth(r.request);
    const b = await readJson(r.request, 4096);
    const name = text(b.name, 'name', { required: true, max: 120 });
    const org = await makeOrg({ name, shortCode: text(b.shortCode, 'shortCode', { max: 6 }) });
    const { user, credentials } = await createAccount(org, { firstName: b.adminFirstName, email: b.adminEmail, role: 'admin' });
    return json({ org: publicOrg(org, 'admin'), admin: publicUser(user), credentials }, 201);
  }

  // Free trial: the public request form and the owner's admin routes ----------------------------------------------------------
  const requestView = (q) => ({ id: q.id, createdAt: q.createdAt, status: q.status === 'deciding' ? 'pending' : q.status, companyLegalName: q.companyLegalName, abn: q.abn, tradingName: q.tradingName || '', firstName: q.firstName, lastName: q.lastName, email: q.email, mobile: q.mobile, region: q.region, homesPerYear: q.homesPerYear ?? null, howHeard: q.howHeard || '', consentAt: q.consentAt, termsVersion: q.termsVersion || '', notifyStatus: q.notifyStatus || '', decidedAt: q.decidedAt || null, decisionNote: q.decisionNote || '', orgId: q.orgId || null });

  /** POST /portal/trial-request (public). Honeypot field `website`, validated, rate limited, stored as pending, owner notified (never the builder). */
  async function trialRequest(r) {
    const body = await readJson(r.request, 8192);
    const done = { ok: true, message: 'Thanks, we will be in touch within one business day.' };
    if (typeof body.website === 'string' && body.website.trim()) return json(done); // bots fill the hidden field: pretend it worked
    const t = parseTrialRequest(body, { abnValid });
    const nowMs = now();
    const ip = clientIp(r.request);
    if ((await store.hitRate(`trial:ip:${ip}`, 3600, nowMs)) > 5 || (await store.hitRate(`trial:email:${t.email}`, 86400, nowMs)) > 3) {
      throw new HttpError('RATE_LIMITED', 'You have sent several requests already. Please wait before sending another, or email hello@glideinside.com.au.', { retryAfter: 3600 });
    }
    if (await pstore.findOpenTrialRequestByAbn(t.abn)) return json(done); // already received: no duplicate row and no second email
    const q = { id: rid('tr'), createdAt: iso(nowMs), status: 'pending', ...t, consentAt: iso(nowMs), termsVersion: TERMS_VERSION, ipHash: (await sha256Hex(`gi-trial:${ip}`)).slice(0, 16), notifyStatus: null, decidedAt: null, decisionNote: null, orgId: null };
    await pstore.createTrialRequest(q);
    const n = await notifyOwner({ request: q, trialConfig, config, fetchImpl });
    await pstore.updateTrialRequest(q.id, { notifyStatus: n.sent ? 'sent' : n.skipped ? 'skipped' : 'failed' });
    return json(done, 201);
  }

  async function adminRequests(r) {
    await adminAuth(r.request);
    const status = r.url.searchParams.get('status');
    if (status && !['pending', 'approved', 'declined'].includes(status)) throw new HttpError('BAD_REQUEST', 'status must be pending, approved or declined.');
    return json((await pstore.listTrialRequests(status || null)).map(requestView));
  }

  async function adminApprove(r, id) {
    await adminAuth(r.request);
    const q = await pstore.getTrialRequest(id);
    if (!q) throw new HttpError('NOT_FOUND', 'No such trial request.');
    if (q.status !== 'pending') throw new HttpError('CONFLICT', `That request is already ${q.status === 'deciding' ? 'being approved' : q.status}.`);
    if (await pstore.emailExists(q.email.toLowerCase())) throw new HttpError('CONFLICT', 'That email address already has a login. Decline this request or ask the builder for a different email address.');
    const nowMs = now();
    if (!(await pstore.claimTrialRequest(id, { decidedAt: iso(nowMs) }))) throw new HttpError('CONFLICT', 'That request has just been decided.');
    try {
      const name = q.tradingName || q.companyLegalName;
      const org = await makeOrg({ name, extra: { legalName: q.companyLegalName, abn: q.abn, billingName: `${q.firstName} ${q.lastName}`, billingEmail: q.email.toLowerCase(), billingPhone: q.mobile } });
      await pstore.saveOrgAccount(org.id, { status: 'trial', trialStartedAt: iso(nowMs), trialEndsAt: trialEndFor(nowMs), trialExtendedDays: 0, requestId: q.id });
      const { user, credentials } = await createAccount(org, { firstName: q.firstName, email: q.email, role: 'admin' });
      await pstore.updateTrialRequest(id, { status: 'approved', orgId: org.id });
      const full = await pstore.getOrg(org.id);
      return json({ request: requestView({ ...q, status: 'approved', orgId: org.id, decidedAt: iso(nowMs) }), org: await adminOrgView(full), admin: publicUser(user), credentials, signInUrl: `${config.siteUrl || r.url.origin}/portal/` }, 201);
    } catch (e) {
      await pstore.updateTrialRequest(id, { status: 'pending', decidedAt: null });
      throw e;
    }
  }

  async function adminDecline(r, id) {
    await adminAuth(r.request);
    const b = await readJson(r.request, 2048).catch(() => ({}));
    const q = await pstore.getTrialRequest(id);
    if (!q) throw new HttpError('NOT_FOUND', 'No such trial request.');
    if (q.status !== 'pending') throw new HttpError('CONFLICT', `That request is already ${q.status === 'deciding' ? 'being approved' : q.status}.`);
    const patch = { status: 'declined', decidedAt: iso(), decisionNote: text(b.note, 'Note', { max: 500 }) };
    await pstore.updateTrialRequest(id, patch);
    return json(requestView({ ...q, ...patch }));
  }

  /** One row for the owner's admin page: state, first admin, client logins issued, AI use this month and invoices. */
  async function adminOrgView(org) {
    const nowMs = now();
    const month = monthKey(nowMs);
    const staff = await pstore.listUsers(org.id, true);
    const clients = await pstore.listUsers(org.id, false);
    const issues = await pstore.listLoginIssues(org.id);
    let used = 0;
    for (const u of [...staff, ...clients]) used += (await aiLight(org, u)).used;
    const topUps = (await topUpRows(store, org.id)).filter((t) => monthKey(t.createdAt) === month).length;
    const admin = staff.filter((u) => u.role === 'admin').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return {
      id: org.id, name: org.name, shortCode: org.shortCode, legalName: org.legalName || '', abn: org.abn || '', createdAt: org.createdAt, requestId: org.requestId || null,
      account: accountView(org, nowMs), trialExtendedDays: org.trialExtendedDays || 0, convertedAt: org.convertedAt || null, convertedHow: org.convertedHow || null,
      admin: admin ? { id: admin.id, name: admin.name, username: admin.username, email: admin.email || '', mustChangePassword: !!admin.mustChangePassword, lastSignInAt: admin.lastSignInAt || null } : null,
      billingContact: billingContact(org), staffCount: staff.length,
      clientLogins: { generated: clients.length, issued: issues.length, firstSignedIn: clients.filter((c) => c.firstSignInAt).length },
      loginPricing: { month, ...loginRateInfo(issues.filter((i) => i.month === month).length, org), over50Flag: issues.filter((i) => i.month === month).length > LOGIN_TIER_2_MAX && !(Number.isInteger(org.customLoginCents) && org.customLoginCents > 0) ? 'over 50 this month, set custom rate' : null },
      ai: { month, monthlyCap: org.aiMonthlyCap, creditsUsed: used, topUps },
      invoices: (await pstore.listInvoices(org.id)).map((i) => ({ id: i.id, number: i.number, month: i.month, status: i.status, totalCents: i.totalCents, issuedAt: i.issuedAt, error: i.error || null })),
    };
  }
  async function adminOrgs(r) {
    await adminAuth(r.request);
    return json(await Promise.all((await pstore.listOrgs()).map(adminOrgView)));
  }
  async function adminOrg(r, id) {
    const org = await pstore.getOrg(id);
    if (!org) throw new HttpError('NOT_FOUND', 'No such organisation.');
    return org;
  }
  async function adminExtend(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    if (org.status === 'active') throw new HttpError('CONFLICT', 'That organisation is already on a paid account, so there is no trial to extend.');
    const nowMs = now();
    const patch = { status: 'trial', trialEndsAt: extendedEnd(org, nowMs), trialExtendedDays: (org.trialExtendedDays || 0) + TRIAL_EXTENSION_DAYS, trialStartedAt: org.trialStartedAt || iso(nowMs) };
    await pstore.updateOrg(org.id, patch);
    return json(await adminOrgView({ ...org, ...patch }));
  }
  /** Set or clear the org's custom per-login price. It applies to every login that first signs in this month (rows already charged are repriced). */
  // Owner sets or clears an org's colour scheme: { colours: { primary, accent, darkInk, darkBg } } or { colours: null }.
  async function adminBrandColours(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const b = await readJson(r.request, 2048).catch(() => ({}));
    if (b.colours === undefined) throw new HttpError('BAD_REQUEST', 'Send colours as { primary, accent, darkInk, darkBg } or null for the Glide Inside look.');
    let patch = { brandPrimary: null, brandAccent: null, brandDarkInk: null, brandDarkBg: null };
    if (b.colours !== null) {
      const v = validateColours(b.colours);
      if (!v.ok) throw new HttpError('BAD_REQUEST', Object.values(v.errors)[0]);
      patch = { brandPrimary: v.colours.primary, brandAccent: v.colours.accent, brandDarkInk: v.colours.darkInk, brandDarkBg: v.colours.darkBg };
    }
    await pstore.updateOrg(org.id, patch);
    return json({ id: org.id, colours: coloursOf({ ...org, ...patch }) });
  }
  async function adminLoginRate(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const b = await readJson(r.request, 1024).catch(() => ({}));
    let cents = b.cents === undefined ? undefined : b.cents;
    if (cents === undefined) throw new HttpError('BAD_REQUEST', 'Send cents as a whole number of cents including GST, or null to clear the custom rate.');
    if (cents !== null) {
      cents = typeof cents === 'string' && /^\d+$/.test(cents.trim()) ? Number(cents) : cents;
      if (!Number.isInteger(cents) || cents < 100 || cents > 100000) throw new HttpError('BAD_REQUEST', 'The custom rate must be between 100 and 100000 cents (A$1 to A$1,000) including GST.');
    }
    const nowMs = now();
    const month = monthKey(nowMs);
    const next = { ...org, customLoginCents: cents };
    await pstore.updateOrg(org.id, { customLoginCents: cents });
    // Reprice this month's logins in first sign in order: the custom rate for all of them, or the standard tiers when it is cleared.
    const rows = (await pstore.listLoginIssues(org.id)).filter((i) => i.month === month).sort((a, c) => a.issuedAt.localeCompare(c.issuedAt) || a.id.localeCompare(c.id));
    for (let i = 0; i < rows.length; i += 1) {
      const price = priceForNthLoginThisMonth(i + 1, next);
      if (rows[i].amountCents !== price) await pstore.updateLoginIssue(rows[i].loginId, { amountCents: price });
    }
    return json(await adminOrgView(next));
  }
  async function adminConvert(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const b = await readJson(r.request, 2048).catch(() => ({}));
    const patch = { status: 'active', convertedAt: org.convertedAt || iso(), convertedHow: org.convertedHow || 'manual', ownerNote: text(b.note, 'Note', { max: 500 }) || org.ownerNote || null };
    await pstore.updateOrg(org.id, patch);
    return json(await adminOrgView({ ...org, ...patch }));
  }
  /** A new temporary password for the org's first admin (the first one is shown once, so this is the way out if it is lost). */
  async function adminResetAdmin(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const admin = (await pstore.listUsers(org.id, true)).filter((u) => u.role === 'admin').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!admin) throw new HttpError('NOT_FOUND', 'That organisation has no admin login.');
    return json({ admin: publicUser(admin), ...(await issueTemp(admin)) });
  }

  // Card details: Stripe Checkout in setup mode (TEST keys only until the owner approves live billing) -----------------------------
  async function billingSetup(r) {
    const { org } = await auth(r, { need: 'billing.write', allowReadOnly: true });
    if (!contactComplete(org)) throw new HttpError('BAD_REQUEST', 'Save your legal business name, ABN and billing email first. They are needed on your tax invoices.');
    const customer = await ensureCustomer({ config, pstore, fetchImpl, org });
    const origin = config.siteOrigin || r.url.origin;
    const session = await stripeCall({
      config, fetchImpl, path: '/checkout/sessions',
      form: {
        mode: 'setup', customer, 'payment_method_types[0]': 'card', client_reference_id: org.id, locale: 'en-AU',
        'metadata[org_id]': org.id, 'metadata[purpose]': 'gi_card_setup', 'setup_intent_data[metadata][org_id]': org.id,
        success_url: `${origin}/portal/?billing=success&session_id={CHECKOUT_SESSION_ID}#/billing`, cancel_url: `${origin}/portal/?billing=cancel#/billing`,
      },
    });
    if (!session?.url) throw new HttpError('BILLING_UNAVAILABLE', 'Stripe did not return a payment page. Try again shortly.');
    return json({ url: session.url, id: session.id });
  }

  /**
   * checkout.session.completed with mode "setup": store the card as the customer's default payment method and make the org active.
   * Called by the webhook (app.js) and by /billing/setup/confirm. Idempotent.
   */
  async function completeCardSetup(session) {
    const orgId = session?.metadata?.org_id || session?.client_reference_id;
    const org = orgId ? await pstore.getOrg(orgId) : null;
    if (!org) return 'ignored: no organisation on the session';
    const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!customer || org.stripeCustomerId !== customer) return 'ignored: customer does not match the organisation'; // billingSetup saved this customer on the org
    const siId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
    if (!siId) return 'ignored: no setup intent';
    const si = await stripeCall({ config, fetchImpl, method: 'GET', path: `/setup_intents/${encodeURIComponent(siId)}?expand[]=payment_method` });
    if (si?.status !== 'succeeded') return `ignored: setup intent ${si?.status}`;
    const pm = si.payment_method;
    const pmId = typeof pm === 'string' ? pm : pm?.id;
    if (!pmId) return 'ignored: no payment method';
    await stripeCall({ config, fetchImpl, path: `/customers/${encodeURIComponent(customer)}`, form: { 'invoice_settings[default_payment_method]': pmId }, idempotencyKey: `gi-defpm-${customer}-${pmId}` });
    const d = session.customer_details || {};
    const patch = {
      status: 'active', paymentMethodId: pmId, cardBrand: pm?.card?.brand || null, cardLast4: pm?.card?.last4 || null, cardAddedAt: iso(),
      convertedAt: org.convertedAt || iso(), convertedHow: org.convertedHow || 'card', stripeCustomerId: org.stripeCustomerId || customer,
      // Billing contact: what Stripe collected fills any gap; the details the builder saved are never overwritten.
      billingName: org.billingName || d.name || null, billingEmail: org.billingEmail || d.email || null, billingPhone: org.billingPhone || d.phone || null,
    };
    await pstore.updateOrg(org.id, patch);
    return 'card saved, account active';
  }
  async function billingSetupConfirm(r) {
    const { org } = await auth(r, { need: 'billing.write', allowReadOnly: true });
    const b = await readJson(r.request, 1024);
    const id = typeof b.sessionId === 'string' ? b.sessionId : '';
    if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(id)) throw new HttpError('BAD_REQUEST', 'sessionId is not valid.');
    const session = await stripeCall({ config, fetchImpl, method: 'GET', path: `/checkout/sessions/${id}` }).catch((e) => {
      if (e?.extra?.status === 404) return null;
      throw e;
    });
    if (session?.mode !== 'setup' || session?.status !== 'complete' || (session.metadata?.org_id || session.client_reference_id) !== org.id) throw new HttpError('NOT_FOUND', 'That card setup was not found or is not finished.');
    const outcome = await completeCardSetup(session);
    return json({ ok: true, outcome, account: accountView(await pstore.getOrg(org.id), now()) });
  }

  /** For app.js: refuse AI and top-up requests of an org that is read only (or, for top-ups, still on the free trial). */
  async function gate(orgId, kind) {
    const org = orgId ? await pstore.getOrg(orgId) : null;
    if (!org) return;
    const st = orgState(org, now());
    if (st.readOnly) throw readOnlyError(st);
    if (kind === 'topup' && st.isTrial) throw trialNoTopUps();
  }

  async function runMonthRoute(r) {
    await adminAuth(r.request);
    const b = await readJson(r.request, 1024).catch(() => ({}));
    return json(await runMonth({ pstore, store, config, fetchImpl, now, month: typeof b.month === 'string' ? b.month : undefined, orgId: typeof b.orgId === 'string' ? b.orgId : undefined }));
  }

  // Router ------------------------------------------------------------------------------------------------------------------
  const ID = '([A-Za-z0-9_:.%-]{1,120})';
  const decode = (v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      throw new HttpError('NOT_FOUND', 'No such endpoint.');
    }
  };
  const ROUTES = [
    ['POST', '/session', signIn, { open: true }], ['DELETE', '/session', signOut, { open: true }], ['GET', '/me', me], ['POST', '/password', changePassword],
    ['POST', '/password/reset-request', resetRequest, { open: true }], ['POST', '/password/reset', resetComplete, { open: true }],
    ['GET', '/houses', listHouses], ['POST', '/houses', saveHouse], ['GET', `/houses/${ID}`, getHouse], ['POST', `/houses/${ID}/duplicate`, duplicateHouse], ['POST', `/houses/${ID}/archive`, archiveHouse],
    ['GET', '/glide-library', listGlide], ['GET', `/glide-library/${ID}`, getGlide],
    ['GET', '/clients', listClients], ['POST', '/clients', issueClient], ['PATCH', `/clients/${ID}`, updateClient], ['DELETE', `/clients/${ID}`, deleteClient],
    ['POST', `/clients/${ID}/reset-password`, resetClient], ['GET', `/clients/${ID}/export`, exportClient],
    ['POST', `/clients/${ID}/disable`, (r, id) => setStatus(r, id, 'client', 'disabled')], ['POST', `/clients/${ID}/enable`, (r, id) => setStatus(r, id, 'client', 'active')],
    ['GET', '/projects', listProjects], ['POST', '/projects', saveProject], ['GET', `/projects/${ID}`, openProject],
    ['GET', '/billing/usage', monthUsage], ['GET', '/billing/invoices', listInvoices], ['GET', `/billing/invoices/${ID}`, getInvoice], ['GET', '/billing/contact', getContact], ['PUT', '/billing/contact', setContact],
    ['GET', '/ai', aiBalance], ['POST', '/ai/top-up', aiTopUp], ['POST', '/ai/token', aiTokenRoute],
    ['GET', '/team', listTeam], ['POST', '/team', inviteStaff], ['PATCH', `/team/${ID}`, updateStaff], ['POST', `/team/${ID}/reset-password`, resetStaff],
    ['POST', `/team/${ID}/disable`, (r, id) => setStatus(r, id, 'staff', 'disabled')], ['POST', `/team/${ID}/enable`, (r, id) => setStatus(r, id, 'staff', 'active')],
    ['PUT', '/org/branding', setBranding], ['PATCH', '/org/settings', setSettings],
    ['POST', '/admin/orgs', createOrg, { token: true }],
    ['POST', '/billing/setup', billingSetup], ['POST', '/billing/setup/confirm', billingSetupConfirm],
    ['POST', '/trial-request', trialRequest, { noCsrf: true }], ['GET', `/brand/${ID}`, brandBySlug, { noCsrf: true }], ['POST', `/admin/orgs/${ID}/slug`, adminSlug, { token: true }],
    ['GET', '/admin/trial-requests', adminRequests, { token: true }], ['POST', `/admin/trial-requests/${ID}/approve`, adminApprove, { token: true }], ['POST', `/admin/trial-requests/${ID}/decline`, adminDecline, { token: true }],
    ['GET', '/admin/orgs', adminOrgs, { token: true }], ['POST', `/admin/orgs/${ID}/extend-trial`, adminExtend, { token: true }], ['POST', `/admin/orgs/${ID}/convert`, adminConvert, { token: true }], ['POST', `/admin/orgs/${ID}/login-rate`, adminLoginRate, { token: true }], ['POST', `/admin/orgs/${ID}/brand-colours`, adminBrandColours, { token: true }], ['POST', `/admin/orgs/${ID}/reset-admin`, adminResetAdmin, { token: true }],
  ].map(([method, p, handler, opts]) => ({ method, re: new RegExp(`^${p}$`), handler, opts: opts || {} }));

  /** Handles /portal/* (path is the part after /api). Returns null when the path is not a portal path. */
  async function route(request, url, path) {
    if (path === '/billing/run-month') {
      if (request.method !== 'POST') throw new HttpError('BAD_REQUEST', 'Use POST for this endpoint.', {}, 405);
      return runMonthRoute({ request, url });
    }
    if (!path.startsWith('/portal/')) return null;
    const sub = path.slice('/portal'.length);
    // Builder and client logins stay closed until PORTAL_ENABLED=1 (public launch first). Creating organisations is an admin job and stays open.
    const alwaysOpen = sub === '/trial-request' || sub.startsWith('/brand/') || sub.startsWith('/admin/'); // requests are collected, and the owner works, before logins open
    if (!config.portalEnabled && !alwaysOpen) throw new HttpError('PORTAL_NOT_CONFIGURED', 'The builder portal is not open yet.');
    const r = { request, url, setCookie: null };
    let matchedPath = false;
    for (const rt of ROUTES) {
      const m = rt.re.exec(sub);
      if (!m) continue;
      matchedPath = true;
      if (rt.method !== request.method) continue;
      if (!rt.opts.token && !rt.opts.noCsrf) checkCsrf(request, url); // bearer token routes carry no cookie, so there is nothing to forge
      const res = await rt.handler(r, ...m.slice(1).map(decode));
      if (r.setCookie) res.headers.append('set-cookie', r.setCookie);
      return res;
    }
    if (matchedPath) throw new HttpError('BAD_REQUEST', 'That method is not allowed for this endpoint.', {}, 405);
    throw new HttpError('NOT_FOUND', 'No such endpoint.');
  }

  /** The Worker cron handler. Runs at 06:00 on the 1st, Sydney time; the Worker is triggered at 19:00 and 20:00 UTC to cover daylight saving. */
  async function scheduled() {
    if (!isMonthlyRunTime(now())) return null;
    if (!config.stripeSecretKey) return { skipped: 'STRIPE_SECRET_KEY is not set' };
    return runMonth({ pstore, store, config, fetchImpl, now });
  }

  /**
   * For POST /api/portal/export/:type. Signed in session only; the watermark flag comes from the org account state, never the request.
   * Returns { user, org, allowed, watermark }.
   */
  async function exportContext(request, url, type) {
    checkCsrf(request, url);
    const { user, org, state } = await auth({ request, url, setCookie: null }, { allowReadOnly: true });
    const allowed = exportsFor(user, org);
    if (state.readOnly) throw readOnlyError(state);
    if (!allowed.includes(type)) throw new HttpError('FORBIDDEN', 'Your builder has not turned that file type on for your login.', {}, 403);
    return { user, org, allowed, watermark: state.isTrial };
  }

  return { route, scheduled, exportContext, gate, completeCardSetup, runMonth: (opts = {}) => runMonth({ pstore, store, config, fetchImpl, now, ...opts }), contactComplete };
}
