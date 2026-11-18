// Builder and client portal API (docs/PORTAL_API.md): sessions, houses, Glide library, clients, projects, billing, AI credits,
// team, branding and org settings, plus the admin-token jobs (create an organisation, run month end invoicing).
// Web-standard Request in, Response out, like app.js. Mounted by createApp under /api/portal/* and /api/billing/run-month.

import { migrate, validate } from '../../src/model/schema.js';
import { GLIDE_LIBRARY } from '../../src/portal/glide-library.generated.js';
import { houseStats } from '../../src/portal/house-stats.js';
import { validateColours } from '../../src/portal/theme.js';
import { validateDetails, cleanDetails } from '../../src/portal/brand-details.js';
import { slugify, cleanSlug } from '../../src/portal/builders.js';
import { projectToSvg } from '../../src/portal/thumbnail.js';
import { generateUsername, generatePassword, passwordProblem } from '../../src/portal/credentials.js';
import { monthKey, priceForNthLoginThisMonth, formatAud, JOB_FEE_CENTS, jobPlanOf, jobPriceFor, summariseJobs } from '../../src/portal/billing.js';
import { HttpError, json, readJson, clientIp, bearerToken } from './http.js';
import { hashPassword, verifyPassword, dummyVerify, newSessionToken, sha256Hex, secretEqual } from './password.js';
import { countLoginAttempt, clearLoginCounters, LOCKOUT_MS as GUARD_LOCKOUT_MS } from './login-guard.js';
import { enforceClientTopUpCap } from './credits.js';
import { aiSnapshot, addTopUp, aiToken, reconcileTopUps, orgPoolIds } from './portal-ai.js';
import { usageForMonth, runMonth, isMonthlyRunTime, contactComplete, topUpRows, stripeCall, ensureCustomer, gstTaxRate, jobBillingReadiness, jobPlansView, planPriceId, chargeJob, MONTH_RE } from './portal-billing.js';
import { readTrialConfig, orgState, accountView, trialEndFor, extendedEnd, parseTrialRequest, notifyOwner, trialNoClients, trialNoTopUps, readOnlyError, TRIAL_EXTENSION_DAYS, TERMS_VERSION } from './trial.js';

export const COOKIE = 'gi_session';
const DAY = 86400000;
export const TEMP_PASSWORD_DAYS = 7;
export const LOCKOUT_MS = GUARD_LOCKOUT_MS;
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
  const detailsOf = (o) => cleanDetails({ licence: o.brandLicence, abn: o.brandAbn, address: o.brandAddress, phone: o.brandPhone, email: o.brandEmail, website: o.brandWebsite });
  const publicOrg = (o, role) => ({
    id: o.id, name: o.name, shortCode: o.shortCode, branding: { displayName: o.displayName || o.name, logoDataUrl: o.logoDataUrl || null, colours: coloursOf(o), details: detailsOf(o) },
    allowClientTopUps: !!o.allowClientTopUps, allowClientEnquiries: o.allowClientEnquiries !== false, showGlideToClients: o.showGlideToClients === true,
    showGlideLibrary: o.showGlideToClients === true, allowClientCadExports: !!o.allowClientCadExports, showAerialDefault: o.showAerialDefault !== false, showAiAssistant: o.showAiAssistant !== false, directoryListed: o.directoryListed === true, directoryRegion: o.directoryRegion || '', aiMonthlyCap: o.aiMonthlyCap,
    ...(o.internal === true ? { internal: true } : {}),
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
  const INTERNAL_NOTE = 'Internal test, no charge.';
  const NO_LOGIN_CHARGE_NOTE = 'No charge for client logins.';
  const visibleHouse = (user, h) => !h.archived && (user.houseAccess === 'all' || (Array.isArray(user.houseAccess) && user.houseAccess.includes(h.id)));
  const projectView = (p, ownerName) => ({ id: p.id, orgId: p.orgId, ownerId: p.ownerId, name: p.name, lotAddress: p.lotAddress || '', houseNames: p.houseNames || [], createdAt: p.createdAt, updatedAt: p.updatedAt, ownerName: ownerName || '',
    editedByStaff: !!p.editedById, editedByName: p.editedById ? p.editedByName || '' : '', editedByStaffAt: p.editedById ? p.editedByStaffAt || null : null });

  const aiFor = (org, user, opts = {}) => aiSnapshot({ store, config, org, user, nowMs: now(), ...opts });
  /** Client rows only read the pools (no creation, no expiry work) so a long list stays cheap. */
  async function aiLight(org, user) {
    const nowMs = now();
    const { monthlyId, topUpId } = orgPoolIds(org.id, user.id, monthKey(nowMs));
    const m = await store.getEntitlement(monthlyId);
    const t = await store.getEntitlement(topUpId);
    const cap = m?.creditsTotal ?? (org.internal === true ? config.internalAiMonthly : org.aiMonthlyCap ?? config.orgMonthlyCredits);
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

  /** End every session of a login AND invalidate the AI bearer tokens issued so far (security review M2: the epoch rides in the token). */
  async function endSessions(userId, exceptHash = '') {
    await pstore.deleteUserSessions(userId, exceptHash);
    await pstore.bumpSessionEpoch(userId);
  }

  async function issueTemp(user) {
    const password = generatePassword();
    await pstore.updateUser(user.id, { passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: iso(now() + TEMP_PASSWORD_DAYS * DAY) });
    await endSessions(user.id);
    await clearLoginCounters(pstore, { subject: user.username });
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
    const user = await pstore.findUserByLogin(identifier);
    // The attempt is counted BEFORE the password is checked (atomic, so parallel guesses cannot exceed the limit), per username AND address.
    // One account is one subject whether it was named by email or by username.
    const attempt = await countLoginAttempt(pstore, { subject: user ? user.username : identifier, request: r.request, nowMs, config });
    const check = user ? await verifyPassword(password, user.passwordHash) : (await dummyVerify(password), { ok: false });
    if (!check.ok) throw attempt.failed();
    await attempt.succeeded();
    if (user.status !== 'active') throw new HttpError('ACCOUNT_DISABLED', 'This login has been disabled. Contact your builder.');
    if (user.mustChangePassword && user.tempPasswordExpiresAt && Date.parse(user.tempPasswordExpiresAt) <= nowMs) {
      throw new HttpError('PASSWORD_EXPIRED', `This temporary password expired after ${TEMP_PASSWORD_DAYS} days. Ask your builder for a new one.`);
    }
    const patch = { lastSignInAt: iso(nowMs) };
    if (!user.firstSignInAt) patch.firstSignInAt = iso(nowMs);
    if (check.needsRehash) patch.passwordHash = await hashPassword(password);
    await pstore.updateUser(user.id, patch);
    // Client logins are no longer charged (owner decision 18/11/2026): no login_issues row is created at first sign in. Rows made before then stay as history.
    await pstore.purgeSessions(iso(nowMs));
    await startSession(r, user);
    const org = await pstore.getOrg(user.orgId);
    return json(await meBody({ ...user, ...patch }, org));
  }

  async function signOut(r) {
    const token = cookies(r.request)[COOKIE];
    if (token && token.length <= 100) {
      const idHash = await sha256Hex(token);
      const session = await pstore.getSession(idHash);
      await pstore.deleteSession(idHash);
      if (session) await pstore.bumpSessionEpoch(session.userId); // AI bearer tokens issued to this login stop working
    }
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
    const cur = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const attempt = await countLoginAttempt(pstore, { subject: user.username, request: r.request, nowMs: now(), config });
    if (!(await verifyPassword(cur, user.passwordHash)).ok) {
      const e = attempt.failed();
      throw e.code === 'ACCOUNT_LOCKED' ? e : new HttpError('INVALID_CREDENTIALS', 'The current password is not right.');
    }
    await attempt.succeeded();
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (next.length > 512) throw new HttpError('BAD_REQUEST', 'That password is too long.');
    const problem = next === cur ? 'Choose a new password, not the current one.' : passwordProblem(next, { username: user.username, email: user.email, temporary: cur });
    if (problem) throw new HttpError('BAD_REQUEST', problem);
    await pstore.updateUser(user.id, { passwordHash: await hashPassword(next), mustChangePassword: false, tempPasswordExpiresAt: null });
    await endSessions(user.id, idHash); // other sessions are signed out, and AI tokens issued so far stop working
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
      throw new HttpError('BAD_REQUEST', e.message || 'That is not a Glide Inside design.');
    }
    if (JSON.stringify(p).length > config.portalProjectMaxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'That design is too large to save. Remove the underlay image and try again.');
    return p;
  }

  async function listHouses(r) {
    const { user, org } = await auth(r);
    const includeArchived = r.url.searchParams.get('includeArchived') === 'true';
    const list = await pstore.listHouses(user.orgId);
    const mine = list.filter((h) => (isStaff(user) ? includeArchived || !h.archived : visibleHouse(user, h)));
    if (org.internal !== true) return json(mine.map(houseView)); // an ordinary builder or client only ever sees its own org's designs
    // The owner's internal test account browses every builder's designs, grouped by builder, read only.
    const names = new Map((await pstore.listOrgs()).map((o) => [o.id, o.displayName || o.name]));
    const others = (await pstore.listAllHouses()).filter((h) => h.orgId !== org.id && !h.archived && (isStaff(user) || user.houseAccess === 'all'));
    return json([
      ...mine.map((h) => ({ ...houseView(h), builder: { id: org.id, name: names.get(org.id) || org.name }, readOnly: false })),
      ...others.map((h) => ({ ...houseView(h), builder: { id: h.orgId, name: names.get(h.orgId) || '' }, readOnly: true })),
    ].sort((a, b) => a.builder.name.localeCompare(b.builder.name) || a.name.localeCompare(b.name)));
  }
  /** A design from another builder, for the internal test account: no title block details, so a plan set never carries that builder's branding. */
  const stripBranding = (project) => {
    const tb = project?.titleBlock;
    if (tb && typeof tb === 'object') for (const k of Object.keys(tb)) tb[k] = '';
    return project;
  };
  async function getHouse(r, id) {
    const { user, org } = await auth(r);
    let h = await pstore.getHouse(user.orgId, id);
    let foreign = false;
    if (!h && org.internal === true) {
      h = await pstore.getHouseAny(id);
      foreign = !!h && !h.archived && h.orgId !== org.id && (isStaff(user) || user.houseAccess === 'all');
      if (!foreign) h = null;
    }
    if (!h || (!foreign && !isStaff(user) && !visibleHouse(user, h))) throw new HttpError('NOT_FOUND', 'That house design was not found.');
    const project = h.project ? clone(h.project) : await resolveGlideProject(h.sourceRef, h.name);
    project.name = h.name;
    if (foreign) {
      stripBranding(project);
      const owner = await pstore.getOrg(h.orgId);
      return json({ ...houseView(h), builder: { id: h.orgId, name: owner?.displayName || owner?.name || '' }, readOnly: true, project });
    }
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
      const g = org.internal === true ? GLIDE_LIBRARY.find((x) => x.id === fromGlideId) : null; // builders: own designs only
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
    let h = await pstore.getHouse(org.id, id);
    // The internal test account may duplicate another builder's design. The copy is made in the internal org only; the original is untouched.
    if (!h && org.internal === true) {
      const other = await pstore.getHouseAny(id);
      if (other && !other.archived && other.orgId !== org.id) {
        h = { ...other, project: other.project ? stripBranding(clone(other.project)) : null };
        if (!h.project && h.sourceType !== 'glide') h = null;
      }
    }
    if (!h) throw new HttpError('NOT_FOUND', 'That house design was not found.');
    const names = new Set((await pstore.listHouses(org.id)).map((x) => x.name.toLowerCase()));
    let n = 2;
    let label = `${h.name} copy`;
    while (names.has(label.toLowerCase())) label = `${h.name} copy ${n++}`;
    const copy = { ...clone(h), orgId: org.id, id: rid('h'), name: label.slice(0, 80), createdBy: user.id, createdAt: iso(), updatedAt: iso(), archived: false };
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
    // Builders and their clients see only their own designs (owner 18/11/2026). The Glide Inside library is for the internal account only.
    if (org.internal !== true) return json([]);
    return json(GLIDE_LIBRARY.map((g) => ({ ...g })));
  }
  async function getGlide(r, id) {
    const { user, org } = await auth(r);
    const g = GLIDE_LIBRARY.find((x) => x.id === id);
    if (!g || org.internal !== true) throw new HttpError('NOT_FOUND', 'Unknown Glide Inside model.');
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
    // Client logins are free (18/11/2026), so no billing details are needed before one is generated.
    const b = await readJson(r.request, 8192);
    const access = await cleanAccess(org.id, b.houseAccess);
    const { user, credentials } = await createAccount(org, { firstName: b.firstName, email: b.email, role: 'client', lotAddress: b.lotAddress, houseAccess: access });
    return json({ client: await clientView(org, user, { billedIds: new Set() }), credentials, charge: { amountCents: 0, trigger: 'none', note: org.internal === true ? INTERNAL_NOTE : NO_LOGIN_CHARGE_NOTE } }, 201);
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
    if (status === 'disabled') await endSessions(u.id); // sessions end at once, and so do the AI bearer tokens
    const next = { ...u, status };
    return json(kind === 'client' ? await clientView(org, next) : publicUser(next, await aiLight(org, next)));
  }

  // Builder jobs (owner decision 18/11/2026) -----------------------------------------------------------------------------------
  // Every NEW project a builder staff login starts is one job. The first save of a new project must carry confirmJob: true (the screen shows
  // the price and what it covers first); the charge is taken off session from the saved card BEFORE the project is created, so a declined card
  // creates nothing. Client logins are never charged. A trial is free, an internal test account is never charged, a capped plan counts down.
  const JOB_COVERS = 'One job is one new project. It covers all the design work, edits, saves and exports on that project. Opening and saving the same project again is free.';
  const AFTER_TRIAL = `After the trial each new job is ${formatAud(JOB_FEE_CENTS)} incl. GST, or included in a capped monthly plan.`;
  const cardText = (o) => (o.cardLast4 ? `your card ending ${o.cardLast4}` : 'your saved card');

  /** What starting a new job costs this org right now, and the words the confirm step shows. Never charges. */
  async function jobQuote(org, state) {
    const ready = jobBillingReadiness(config);
    const month = monthKey(now());
    const rows = await pstore.listJobCharges(org.id, month);
    const plan = jobPlanOf(org.jobPlan);
    const base = { priceCents: JOB_FEE_CENTS, priceText: `${formatAud(JOB_FEE_CENTS)} incl. GST`, covers: JOB_COVERS, month, charging: ready.ready, cardOnFile: !!org.paymentMethodId, cardLast4: org.cardLast4 || null, plan: plan ? { id: plan.id, name: plan.name, jobs: plan.jobs, used: rows.filter((j) => j.kind === 'plan_included').length } : null };
    if (org.internal === true) return { ...base, kind: 'internal', cents: 0, needsCard: false, message: 'Internal test account. No charge.' };
    if (state.isTrial) return { ...base, kind: 'trial_free', cents: 0, needsCard: false, message: `This job is free during your trial. ${AFTER_TRIAL}` };
    const pr = jobPriceFor({ planId: org.jobPlan, planJobsUsed: rows.filter((j) => j.kind === 'plan_included').length });
    if (pr.kind === 'plan_included') return { ...base, kind: pr.kind, cents: 0, needsCard: false, planJobsLeftAfter: pr.remaining, message: `Included in your ${plan.name} plan. ${pr.remaining} of ${plan.jobs} jobs left this month after this one.` };
    const lead = pr.kind === 'plan_extra' ? `You have used all ${plan.jobs} jobs in your ${plan.name} plan this month. This extra job is ${formatAud(JOB_FEE_CENTS)} incl. GST` : `This job is ${formatAud(JOB_FEE_CENTS)} incl. GST`;
    if (!ready.ready) return { ...base, kind: pr.kind, cents: JOB_FEE_CENTS, needsCard: false, message: `${lead}. Job billing is not switched on yet, so this job will not be charged.` };
    return { ...base, kind: pr.kind, cents: JOB_FEE_CENTS, needsCard: !org.paymentMethodId, message: org.paymentMethodId ? `${lead}, charged to ${cardText(org)} when you confirm.` : `${lead}. Add a card under Billing first.` };
  }

  /**
   * Confirm and charge the job for a new project. Throws before anything is created or charged unless the request confirms it. Idempotent on
   * jobRequestId: a retry of a confirmed request returns the earlier outcome and never charges twice.
   */
  async function settleJob({ b, org, state, user, p }) {
    const given = typeof b.jobRequestId === 'string' ? b.jobRequestId : '';
    if (given && !/^[A-Za-z0-9_-]{8,64}$/.test(given)) throw new HttpError('BAD_REQUEST', 'jobRequestId is not valid.');
    const prior = given ? await pstore.getJobByRequest(org.id, given) : null;
    if (prior) return { row: prior, existing: prior.projectId ? await pstore.getProject(org.id, prior.projectId) : null, projectId: prior.projectId };
    const q = await jobQuote(org, state);
    if (b.confirmJob !== true) throw new HttpError('JOB_CONFIRM_REQUIRED', 'Confirm the new job before it is created.', { quote: q });
    const requestId = given || rid('job');
    const charge = q.cents > 0 && q.charging;
    let stripeInvoiceId = null;
    if (charge) {
      if (!org.paymentMethodId) throw new HttpError('JOB_CARD_REQUIRED', 'Add a card under Billing before you start a new job. Your account admin can do this.', { quote: q });
      ({ stripeInvoiceId } = await chargeJob({ config, pstore, fetchImpl, org, requestId }));
    }
    const unbilled = q.cents > 0 && !q.charging;
    const row = {
      id: rid('jc'), requestId, orgId: org.id, userId: user.id, userName: user.name, projectId: p.id, projectName: p.name, month: monthKey(now()), createdAt: iso(),
      kind: unbilled ? 'unbilled' : q.kind, amountCents: charge ? q.cents : 0, plan: q.plan?.id || null, stripeInvoiceId,
      note: unbilled ? 'Job billing was not configured, so nothing was charged.' : null,
    };
    await pstore.addJobCharge(row);
    return { row, existing: null, projectId: p.id };
  }
  const jobView = (j) => ({ id: j.id, projectId: j.projectId || null, projectName: j.projectName || '', userName: j.userName || '', createdAt: j.createdAt, kind: j.kind, amountCents: j.amountCents, plan: j.plan || null, note: j.note || null });

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
    const { user, org, state } = await auth(r);
    const b = await readJson(r.request, config.portalProjectMaxBytes + 200000);
    let p = b.id ? await pstore.getProject(org.id, String(b.id)) : null;
    if (b.id && (!p || (!isStaff(user) && p.ownerId !== user.id))) throw new HttpError('NOT_FOUND', 'That project was not found.');
    const proj = parseProject(b.project);
    const isNew = !p;
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
    // A new project started by builder staff is a job: confirm and pay first (see settleJob). Client logins design for free.
    let job = null;
    if (isNew && isStaff(user)) {
      const settled = await settleJob({ b, org, state, user, p });
      if (settled.existing) return json({ ...projectView(settled.existing, user.name), job: jobView(settled.row) }); // a retried request that already created the project
      if (settled.projectId) p.id = settled.projectId;
      job = settled.row;
    }
    // Staff adjusting a client's project (Open as client view): the project stays the client's, and the save is recorded as edited by staff.
    // Nothing here touches the AI pools, so a staff login designing a client's existing project never bills anyone.
    const byStaff = isStaff(user) && p.ownerId !== user.id;
    Object.assign(p, byStaff ? { editedById: user.id, editedByName: user.name, editedByStaffAt: iso() } : { editedById: null, editedByName: null, editedByStaffAt: null });
    await pstore.saveProject(p);
    return json({ ...projectView(p, user.name), ...(job ? { job: jobView(job) } : {}) });
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

  // Jobs and capped plans: this month's jobs, the cost of the next one, and the plans a builder can buy.
  const planView = (org) => {
    const plan = jobPlanOf(org.jobPlan);
    return plan ? { id: plan.id, name: plan.name, jobs: plan.jobs, monthlyCents: plan.monthlyCents, since: org.jobPlanSince || null } : null;
  };
  async function jobsView(org, state) {
    const month = monthKey(now());
    const rows = await pstore.listJobCharges(org.id, month);
    const plans = jobPlansView(config).map((x) => ({ id: x.id, name: x.name, monthlyCents: x.monthlyCents, jobs: x.jobs, available: x.available, current: org.jobPlan === x.id }));
    return { month, feeCents: JOB_FEE_CENTS, quote: await jobQuote(org, state), summary: summariseJobs(rows), items: rows.map(jobView), plan: planView(org), plans };
  }
  async function jobsRoute(r) {
    const { org, state } = await auth(r, { need: 'billing.read' });
    return json(await jobsView(org, state));
  }
  /** Start Stripe Checkout (subscription mode) for a capped plan. Only possible once the owner has set that plan's price id. */
  async function jobPlanStart(r) {
    const { org } = await auth(r, { need: 'billing.write' });
    if (org.internal === true) throw new HttpError('BAD_REQUEST', 'An internal test account has no billing.');
    const b = await readJson(r.request, 1024).catch(() => ({}));
    const plan = jobPlanOf(b.plan);
    if (!plan) throw new HttpError('BAD_REQUEST', 'Choose Builder Starter, Builder Pro or Builder Teams.');
    const priceId = planPriceId(config, plan.id);
    if (!priceId || !config.stripeSecretKey) throw new HttpError('JOB_PLAN_UNAVAILABLE', `${plan.name} is coming soon. Until then each new job is ${formatAud(JOB_FEE_CENTS)} incl. GST with no monthly fee.`);
    if (org.jobPlan) throw new HttpError('CONFLICT', 'You already have a plan. Cancel it first if you want a different one.');
    if (!contactComplete(org)) throw new HttpError('BAD_REQUEST', 'Save your legal business name, ABN and billing email first. They are needed on your tax invoices.');
    const customer = await ensureCustomer({ config, pstore, fetchImpl, org });
    const taxRate = await gstTaxRate({ config, pstore, fetchImpl });
    const origin = config.siteOrigin || r.url.origin;
    const session = await stripeCall({
      config, fetchImpl, path: '/checkout/sessions',
      form: {
        mode: 'subscription', customer, client_reference_id: org.id, locale: 'auto', 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
        'metadata[org_id]': org.id, 'metadata[purpose]': 'gi_job_plan', 'metadata[plan]': plan.id,
        'subscription_data[metadata][org_id]': org.id, 'subscription_data[metadata][purpose]': 'gi_job_plan', 'subscription_data[metadata][plan]': plan.id, 'subscription_data[default_tax_rates][0]': taxRate,
        success_url: `${origin}/portal/?billing=plan_success&session_id={CHECKOUT_SESSION_ID}#/billing`, cancel_url: `${origin}/portal/?billing=plan_cancel#/billing`,
      },
    });
    if (!session?.url) throw new HttpError('BILLING_UNAVAILABLE', 'Stripe did not return a payment page. Try again shortly.');
    return json({ url: session.url, id: session.id });
  }
  /** checkout.session.completed for a job plan: the plan starts. Called by the webhook and by /billing/job-plan/confirm. Idempotent. */
  async function completeJobPlanSession(session) {
    const orgId = session?.metadata?.org_id || session?.client_reference_id;
    const org = orgId ? await pstore.getOrg(orgId) : null;
    if (!org) return 'ignored: no organisation on the session';
    const plan = jobPlanOf(session?.metadata?.plan);
    if (!plan || session?.metadata?.purpose !== 'gi_job_plan') return 'ignored: not a job plan session';
    const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!customer || org.stripeCustomerId !== customer) return 'ignored: customer does not match the organisation';
    const sub = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!sub) return 'ignored: no subscription';
    if (session.payment_status && !['paid', 'no_payment_required'].includes(session.payment_status)) return `ignored: payment ${session.payment_status}`;
    if (org.jobPlan === plan.id && org.jobPlanSubscriptionId === sub) return 'plan already active';
    await pstore.updateOrg(org.id, { jobPlan: plan.id, jobPlanSubscriptionId: sub, jobPlanSince: iso() });
    return `job plan ${plan.id} active`;
  }
  async function jobPlanConfirm(r) {
    const { org } = await auth(r, { need: 'billing.write' });
    const b = await readJson(r.request, 1024);
    const id = typeof b.sessionId === 'string' ? b.sessionId : '';
    if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(id)) throw new HttpError('BAD_REQUEST', 'sessionId is not valid.');
    const session = await stripeCall({ config, fetchImpl, method: 'GET', path: `/checkout/sessions/${id}` }).catch((e) => {
      if (e?.extra?.status === 404) return null;
      throw e;
    });
    if (session?.mode !== 'subscription' || session?.status !== 'complete' || (session.metadata?.org_id || session.client_reference_id) !== org.id) throw new HttpError('NOT_FOUND', 'That plan checkout was not found or is not finished.');
    const outcome = await completeJobPlanSession(session);
    return json({ ok: true, outcome, plan: planView(await pstore.getOrg(org.id)) });
  }
  /** Ends the plan at the end of the period already paid for. Stripe tells the webhook when it is over; until then the allowance still applies. */
  async function jobPlanCancel(r) {
    const { org } = await auth(r, { need: 'billing.write' });
    if (!org.jobPlan || !org.jobPlanSubscriptionId) throw new HttpError('NOT_FOUND', 'You are not on a capped plan.');
    await stripeCall({ config, fetchImpl, path: `/subscriptions/${encodeURIComponent(org.jobPlanSubscriptionId)}`, idempotencyKey: `gi-planend-${org.jobPlanSubscriptionId}`, form: { cancel_at_period_end: 'true' } });
    return json({ ok: true, note: 'Your plan ends at the end of the period you have paid for. Until then your included jobs still apply.' });
  }
  /** For app.js: job plan events from Stripe. Returns an outcome string, or null when the event is not about a builder job plan. */
  async function handleBillingEvent(event) {
    const obj = event?.data?.object || {};
    if (event?.type === 'checkout.session.completed' || event?.type === 'checkout.session.async_payment_succeeded') {
      return obj.mode === 'subscription' && obj.metadata?.purpose === 'gi_job_plan' ? completeJobPlanSession(obj) : null;
    }
    if (event?.type === 'customer.subscription.deleted' || event?.type === 'customer.subscription.updated') {
      const org = obj.id ? await pstore.getOrgByJobPlanSubscription(obj.id) : null;
      if (!org) return null;
      const over = event.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status);
      if (!over) return 'job plan still running';
      await pstore.updateOrg(org.id, { jobPlan: null, jobPlanSubscriptionId: null, jobPlanSince: null });
      return 'job plan ended';
    }
    return null;
  }

  // AI credits --------------------------------------------------------------------------------------------------------------
  async function aiBalance(r) {
    const { user, org } = await auth(r);
    return json(await aiFor(org, user));
  }
  async function aiTopUp(r) {
    const { user, org, state } = await auth(r);
    if (state.internal) throw new HttpError('NOT_ENTITLED', 'An internal test account has a generous monthly AI allowance and no top-ups.', {}, 403);
    if (state.isTrial) throw trialNoTopUps();
    if (!isStaff(user) && !org.allowClientTopUps) throw new HttpError('TOPUPS_DISABLED', 'Your builder has turned off AI top-ups.');
    if ((await store.hitRate(`topup:${org.id}:${user.id}`, 3600, now())) > 10) throw new HttpError('RATE_LIMITED', 'Too many top-ups in the last hour.', { retryAfter: 600 });
    // L2: a client login spends the builder's money, so it also has a monthly ceiling (CLIENT_TOPUP_MONTHLY_MAX); builder staff are not capped.
    if (!isStaff(user)) await enforceClientTopUpCap({ store, config, orgId: org.id, loginId: user.id, nowMs: now(), HttpError });
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
    if (patch.role) await endSessions(u.id); // a role change takes effect at once
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
    // Title block details: undefined leaves them alone, an object replaces all six (blank fields clear).
    if (b.details !== undefined) {
      const v = validateDetails(b.details);
      if (!v.ok) throw new HttpError('BAD_REQUEST', Object.values(v.errors)[0]);
      Object.assign(patch, { brandLicence: v.details.licence, brandAbn: v.details.abn, brandAddress: v.details.address, brandPhone: v.details.phone, brandEmail: v.details.email, brandWebsite: v.details.website });
    }
    await pstore.updateOrg(org.id, patch);
    const after = { ...org, ...patch };
    return json({ displayName: patch.displayName, logoDataUrl: 'logoDataUrl' in patch ? patch.logoDataUrl : org.logoDataUrl || null, colours: coloursOf(after), details: detailsOf(after) });
  }
  async function setSettings(r) {
    const { org, user } = await auth(r, { need: 'billing.write' });
    const b = await readJson(r.request, 2048);
    if (b.showGlideLibrary !== undefined && b.showGlideToClients === undefined) b.showGlideToClients = b.showGlideLibrary;
    const map = { allowClientTopUps: 'allowClientTopUps', allowClientEnquiries: 'allowClientEnquiries', showGlideToClients: 'showGlideToClients', allowClientCadExports: 'allowClientCadExports', allowClientCad: 'allowClientCadExports', showAerialDefault: 'showAerialDefault', showAiAssistant: 'showAiAssistant' };
    const patch = {};
    for (const [from, to] of Object.entries(map)) {
      if (b[from] === undefined) continue;
      if (typeof b[from] !== 'boolean') throw new HttpError('BAD_REQUEST', `${from} must be true or false.`);
      patch[to] = b[from];
    }
    // Builder finder (migration 0022): opt in to the public search, and the region shown beside the name and logo.
    if (b.directoryListed !== undefined) {
      if (typeof b.directoryListed !== 'boolean') throw new HttpError('BAD_REQUEST', 'directoryListed must be true or false.');
      patch.directoryListed = b.directoryListed;
    }
    if (b.directoryRegion !== undefined) patch.directoryRegion = text(b.directoryRegion, 'Region', { max: 60 });
    await pstore.updateOrg(org.id, patch);
    return json(publicOrg({ ...org, ...patch }, user.role));
  }

  // Local builder finder and client access requests (migration 0022) --------------------------------------------------------
  // A visitor searches for a builder who opted in to being listed (name, region, logo only, never an id, email or any private data),
  // then asks THAT builder for a client login. The request waits in the builder's own queue. Nothing is emailed to anyone.
  const dirRef = async (org) => (await sha256Hex(`gi-dir:${org.id}`)).slice(0, 24);
  const listable = (o) => o.directoryListed === true && o.internal !== true && !orgState(o, now()).readOnly;
  const REQUESTS_PER_BUILDER_MAX = 300;

  /** GET /portal/builders/search?q= (public). At least 2 letters; up to 8 listed builders whose name contains the text. */
  async function searchBuilders(r) {
    if ((await store.hitRate(`dirsearch:ip:${clientIp(r.request)}`, 600, now())) > 90) throw new HttpError('RATE_LIMITED', 'Too many searches. Please wait a moment.', { retryAfter: 600 });
    const q = String(r.url.searchParams.get('q') || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
    if (q.length < 2) return json({ builders: [] });
    const hits = (await pstore.listOrgs()).filter((o) => listable(o) && `${o.displayName || ''} ${o.name || ''}`.toLowerCase().includes(q)).slice(0, 8);
    const builders = await Promise.all(hits.map(async (o) => ({ ref: await dirRef(o), name: o.displayName || o.name, region: o.directoryRegion || '', logoUrl: o.logoDataUrl || null })));
    const res = json({ builders });
    res.headers.set('cache-control', 'no-store');
    return res;
  }

  const clientRequestView = (q) => ({ id: q.id, createdAt: q.createdAt, status: q.status === 'approving' ? 'pending' : q.status, name: q.name, email: q.email, phone: q.phone, lotAddress: q.lotAddress || '', designName: q.designName || '', consentAt: q.consentAt, decidedAt: q.decidedAt || null, decisionNote: q.decisionNote || '', clientId: q.clientId || null });

  /** POST /portal/client-access-request (public, CSRF header required). Honeypot `website`, validated, rate limited, stored for that builder only. */
  async function clientAccessRequest(r) {
    const body = await readJson(r.request, 4096);
    if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true }); // bots fill the hidden field: pretend it worked
    if (body.consent !== true) throw new HttpError('BAD_REQUEST', 'Please tick the box so we can pass your details to the builder.');
    const ref = text(body.builder, 'Builder', { required: true, max: 40 });
    const name = text(body.name, 'Name', { required: true, max: 100 }).replace(/\s+/g, ' ');
    const email = text(body.email, 'Email', { required: true, max: 160 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError('BAD_REQUEST', 'That email address does not look right.');
    const phone = text(body.phone, 'Phone', { required: true, max: 30 });
    if (!/^\d{8,15}$/.test(phone.replace(/[\s()+-]/g, ''))) throw new HttpError('BAD_REQUEST', 'That phone number does not look right.');
    const lotAddress = text(body.lotAddress, 'Lot address', { max: 200 });
    const designName = text(body.designName, 'Design', { max: 120 });
    const designId = text(body.designId, 'Design', { max: 120 });
    const nowMs = now();
    const ip = clientIp(r.request);
    if ((await store.hitRate(`car:ip:${ip}`, 3600, nowMs)) > 6 || (await store.hitRate(`car:email:${email}`, 86400, nowMs)) > 4) {
      throw new HttpError('RATE_LIMITED', 'You have sent several requests already. Please wait before sending another.', { retryAfter: 3600 });
    }
    let org = null;
    for (const o of await pstore.listOrgs()) if (listable(o) && (await dirRef(o)) === ref) { org = o; break; }
    if (!org) throw new HttpError('NOT_FOUND', 'That builder is not listed on Glide Inside.');
    const builderName = org.displayName || org.name;
    if (await pstore.findOpenClientRequest(org.id, email)) return json({ ok: true, builderName }); // already waiting: no duplicate row
    if ((await pstore.countPendingClientRequests(org.id)) >= REQUESTS_PER_BUILDER_MAX) throw new HttpError('RATE_LIMITED', `${builderName} has a lot of requests waiting. Please try again later.`, { retryAfter: 86400 });
    await pstore.createClientRequest({ id: rid('car'), orgId: org.id, createdAt: iso(nowMs), status: 'pending', name, email, phone, lotAddress, designId, designName, consentAt: iso(nowMs), ipHash: (await sha256Hex(`gi-car:${ip}`)).slice(0, 16), decidedAt: null, decisionNote: null, clientId: null });
    return json({ ok: true, builderName }, 201);
  }

  async function listClientRequests(r) {
    const { org } = await auth(r, { need: 'clients.read' });
    const status = r.url.searchParams.get('status');
    if (status && !['pending', 'approved', 'declined'].includes(status)) throw new HttpError('BAD_REQUEST', 'status must be pending, approved or declined.');
    return json((await pstore.listClientRequests(org.id, status || null)).map(clientRequestView));
  }
  /** Approve issues the client login through the same account flow as Generate account (client logins are free). The builder passes the details on. */
  async function approveClientRequest(r, id) {
    const { org, state } = await auth(r, { need: 'clients.write' });
    if (!state.canIssueClients) throw trialNoClients();
    const q = await pstore.getClientRequest(org.id, id);
    if (!q) throw new HttpError('NOT_FOUND', 'That request was not found.');
    if (q.status !== 'pending') throw new HttpError('CONFLICT', `That request is already ${q.status === 'approving' ? 'being approved' : q.status}.`);
    if (await pstore.emailExists(q.email.toLowerCase())) throw new HttpError('CONFLICT', 'That email address already has a login. Decline this request, or ask the person to use a different email address.');
    if (!(await pstore.claimClientRequest(org.id, id))) throw new HttpError('CONFLICT', 'That request has just been decided.');
    try {
      const { user, credentials } = await createAccount(org, { firstName: q.name.split(' ')[0].slice(0, 60), email: q.email, role: 'client', lotAddress: q.lotAddress || '', houseAccess: 'all' });
      const patch = { status: 'approved', decidedAt: iso(), clientId: user.id };
      await pstore.updateClientRequest(org.id, id, patch);
      return json({ request: clientRequestView({ ...q, ...patch }), client: await clientView(org, user, { billedIds: new Set() }), credentials, charge: { amountCents: 0, trigger: 'none', note: org.internal === true ? INTERNAL_NOTE : NO_LOGIN_CHARGE_NOTE } }, 201);
    } catch (e) {
      await pstore.updateClientRequest(org.id, id, { status: 'pending' });
      throw e;
    }
  }
  async function declineClientRequest(r, id) {
    const { org } = await auth(r, { need: 'clients.write' });
    const b = await readJson(r.request, 2048).catch(() => ({}));
    const q = await pstore.getClientRequest(org.id, id);
    if (!q) throw new HttpError('NOT_FOUND', 'That request was not found.');
    if (q.status !== 'pending') throw new HttpError('CONFLICT', `That request is already ${q.status === 'approving' ? 'being approved' : q.status}.`);
    const patch = { status: 'declined', decidedAt: iso(), decisionNote: text(b.note, 'Note', { max: 300 }) };
    await pstore.updateClientRequest(org.id, id, patch);
    return json(clientRequestView({ ...q, ...patch }));
  }
  /** Owner's admin view: every builder's requests with the builder name, newest first. */
  async function adminClientRequests(r) {
    await adminAuth(r.request);
    const names = new Map((await pstore.listOrgs()).map((o) => [o.id, o.displayName || o.name]));
    return json((await pstore.listAllClientRequests()).map((q) => ({ ...clientRequestView(q), orgId: q.orgId, builderName: names.get(q.orgId) || '' })));
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
    // The check and the insert are separate statements, so two organisations created together can pick the same short code or slug. The unique
    // index decides (createOrg returns false) and the loser picks the next free code and tries again.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let code = base;
      for (let n = 2; await pstore.getOrgByShortCode(code); n += 1) code = `${base}${n}`;
      let slug = cleanSlug(slugify(name)) || 'builder';
      const slugBase = slug;
      for (let n = 2; await pstore.getOrgBySlug(slug); n += 1) slug = `${slugBase}-${n}`;
      const org = { id: rid('org'), name, shortCode: code, slug, displayName: name, logoDataUrl: null, allowClientTopUps: false, allowClientEnquiries: true, showGlideToClients: false, allowClientCadExports: false, showAerialDefault: true, showAiAssistant: true, aiMonthlyCap: config.orgMonthlyCredits, createdAt: iso(), ...extra };
      if (await pstore.createOrg(org)) return org;
    }
    throw new HttpError('CONFLICT', 'That organisation already exists.');
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

  /**
   * POST /portal/admin/internal-orgs (bearer ADMIN_TOKEN): { orgName?, username, password }. The owner's internal test account: an org flagged
   * internal with one builder admin. The owner types the username and password himself; the password is hashed here and is never generated,
   * returned or logged. No billing contact, no trial, no Stripe customer.
   */
  async function adminCreateInternal(r) {
    await adminAuth(r.request);
    const b = await readJson(r.request, 4096);
    const name = text(b.orgName, 'Organisation name', { max: 120 }) || 'Glide Inside Internal Test';
    const username = text(b.username, 'Username', { required: true, max: 40 }).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new HttpError('BAD_REQUEST', 'The username needs 3 to 40 letters, numbers, dots, dashes or underscores.');
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length > 512) throw new HttpError('BAD_REQUEST', 'That password is too long.');
    const problem = passwordProblem(password, { username });
    if (problem) throw new HttpError('BAD_REQUEST', problem);
    if (await pstore.usernameExists(username)) throw new HttpError('CONFLICT', 'That username is already taken.');
    const org = await makeOrg({ name, shortCode: 'INT' });
    await pstore.saveOrgAccount(org.id, { status: 'active', internal: true });
    const user = {
      id: rid('u'), orgId: org.id, role: 'admin', name: 'Internal Test', email: null, username, passwordHash: await hashPassword(password), mustChangePassword: false,
      tempPasswordExpiresAt: null, status: 'active', lotAddress: '', houseAccess: 'all', firstSignInAt: null, lastSignInAt: null, createdAt: iso(),
    };
    if (!(await pstore.createUser(user))) throw new HttpError('CONFLICT', 'That username is already taken.');
    return json({ org: await adminOrgView(await pstore.getOrg(org.id)), admin: publicUser(user), signInUrl: `${config.siteUrl || r.url.origin}/portal/` }, 201);
  }
  /** POST /portal/admin/orgs/:id/internal { internal: true|false }: mark an existing org as an internal test account, or back to an ordinary one. */
  async function adminSetInternal(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const b = await readJson(r.request, 512).catch(() => ({}));
    if (typeof b.internal !== 'boolean') throw new HttpError('BAD_REQUEST', 'internal must be true or false.');
    await pstore.saveOrgAccount(org.id, { internal: b.internal });
    return json(await adminOrgView(await pstore.getOrg(org.id)));
  }

  // Free trial: the public request form and the owner's admin routes ----------------------------------------------------------
  const requestView = (q) => ({ id: q.id, createdAt: q.createdAt, status: q.status === 'deciding' ? 'pending' : q.status, companyLegalName: q.companyLegalName, abn: q.abn, tradingName: q.tradingName || '', firstName: q.firstName, lastName: q.lastName, email: q.email, mobile: q.mobile, region: q.region, abnNeeded: !q.abn, homesPerYear: q.homesPerYear ?? null, howHeard: q.howHeard || '', consentAt: q.consentAt, termsVersion: q.termsVersion || '', notifyStatus: q.notifyStatus || '', decidedAt: q.decidedAt || null, decisionNote: q.decisionNote || '', orgId: q.orgId || null });

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
    if (t.abn && await pstore.findOpenTrialRequestByAbn(t.abn)) return json(done); // already received: no duplicate row and no second email
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

  // Saved "send plans to a registered engineer" requests, newest first, without the PDF bytes (so the owner can read them before email is set up).
  async function adminEnquiries(r) {
    await adminAuth(r.request);
    const rows = (await store.listEnquiries()).map((e) => ({
      reference: e.reference, createdAt: e.createdAt, name: e.name, phone: e.phone, email: e.email, need: e.need, notes: e.notes || '', lot: e.lot || {},
      source: e.source, orgName: e.orgName || '', projectName: e.projectName || '', pdfBytes: e.pdfBytes || 0, hasProject: !!(e.hasProject),
      emailStatus: e.emailStatus, emailError: e.emailError ?? null, emailedAt: e.emailedAt ?? null,
    }));
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.reference).localeCompare(String(a.reference)));
    return json(rows);
  }
  async function adminEnquiryPdf(r, ref) {
    await adminAuth(r.request);
    const row = (await store.listEnquiries()).find((e) => e.reference === ref);
    const b64 = row ? await store.getEnquiryPdf(ref) : null;
    if (!b64) throw new HttpError('NOT_FOUND', 'No plan set PDF is saved for that reference.');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${ref}-plans.pdf"`, 'content-length': String(bytes.byteLength), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
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
      const org = await makeOrg({ name, extra: { legalName: q.companyLegalName, abn: q.abn, billingName: [q.firstName, q.lastName].filter(Boolean).join(' '), billingEmail: q.email.toLowerCase(), billingPhone: q.mobile } });
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
    const jobRows = await pstore.listJobCharges(org.id, month);
    const ready = jobBillingReadiness(config);
    let used = 0;
    for (const u of [...staff, ...clients]) used += (await aiLight(org, u)).used;
    const topUps = (await topUpRows(store, org.id)).filter((t) => monthKey(t.createdAt) === month).length;
    const admin = staff.filter((u) => u.role === 'admin').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return {
      id: org.id, internal: org.internal === true, name: org.name, slug: org.slug || null, shortCode: org.shortCode, legalName: org.legalName || '', abn: org.abn || '', createdAt: org.createdAt, requestId: org.requestId || null,
      account: accountView(org, nowMs), trialExtendedDays: org.trialExtendedDays || 0, convertedAt: org.convertedAt || null, convertedHow: org.convertedHow || null,
      admin: admin ? { id: admin.id, name: admin.name, username: admin.username, email: admin.email || '', mustChangePassword: !!admin.mustChangePassword, lastSignInAt: admin.lastSignInAt || null } : null,
      directoryListed: org.directoryListed === true, pendingClientRequests: await pstore.countPendingClientRequests(org.id),
      billingContact: billingContact(org), billingReady: org.internal === true || contactComplete(org) || !!org.paymentMethodId,
      billingSkipRisk: org.internal !== true && accountView(org, nowMs).status === 'active' && !contactComplete(org) && !org.paymentMethodId && (topUps > 0 || issues.some((i) => i.month === month)), // something is billable at month end (AI top-ups, or logins charged before they became free) but there is no way to invoice it staffCount: staff.length,
      clientLogins: { generated: clients.length, issued: issues.length, firstSignedIn: clients.filter((c) => c.firstSignInAt).length },
      // Client logins are no longer charged (18/11/2026); `issued` counts the legacy rows charged before then.
      loginPricing: null,
      // Jobs charged per org this month (A$20 each, plan included, trial free, internal, or unbilled when the Stripe price is not configured).
      jobs: { month, ...summariseJobs(jobRows), feeCents: JOB_FEE_CENTS, plan: planView(org), billingReady: ready.ready, billingMessage: ready.message, items: jobRows.slice(-25).reverse().map(jobView) },
      // An internal test account is left out of usage, revenue and trial reporting: no usage figures, no invoices.
      ai: org.internal === true ? { month, monthlyCap: org.aiMonthlyCap, creditsUsed: 0, topUps: 0 } : { month, monthlyCap: org.aiMonthlyCap, creditsUsed: used, topUps },
      invoices: org.internal === true ? [] : (await pstore.listInvoices(org.id)).map((i) => ({ id: i.id, number: i.number, month: i.month, status: i.status, totalCents: i.totalCents, issuedAt: i.issuedAt, error: i.error || null })),
    };
  }
  async function adminOrgs(r) {
    await adminAuth(r.request);
    return json(await Promise.all((await pstore.listOrgs()).map(adminOrgView)));
  }
  /**
   * POST /portal/admin/orgs/:id/houses (bearer admin token): { houses: [{ name, description?, project }] }.
   * Owner import of a builder's own designs into that org's house library. Each house goes through the same checks as saveHouse
   * (migrate, validate, size cap, name rules, stats, thumbnail). Idempotent by name: a design with the same name (any case) in THIS org is
   * replaced in place (same id, unarchived), otherwise a new one is added. Only the org in the URL is read or written.
   * Answers 200 { orgId, created, replaced, failed, results: [{ name, status, id?, error? }] }; a bad house fails alone.
   */
  async function adminImportHouses(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const body = await readJson(r.request, 8000000);
    if (!Array.isArray(body.houses) || !body.houses.length) throw new HttpError('BAD_REQUEST', 'Send houses as a non-empty array of { name, project }.');
    if (body.houses.length > 50) throw new HttpError('BAD_REQUEST', 'Send at most 50 houses per request.');
    const existing = await pstore.listHouses(org.id);
    const byName = new Map(existing.map((h) => [h.name.toLowerCase(), h]));
    let count = existing.length;
    const seen = new Set();
    const results = [];
    for (const item of body.houses) {
      let label = typeof item?.name === 'string' ? item.name.trim() : '';
      try {
        if (!item || typeof item !== 'object') throw new HttpError('BAD_REQUEST', 'Each house must be an object.');
        label = text(item.name ?? item.project?.name, 'Name', { required: true, max: 80 });
        if (seen.has(label.toLowerCase())) throw new HttpError('CONFLICT', 'The same name appears twice in this request.');
        seen.add(label.toLowerCase());
        if (!item.project) throw new HttpError('BAD_REQUEST', 'Send a project.');
        const p = parseProject(item.project);
        const problems = validate(p);
        if (problems.length) throw new HttpError('BAD_REQUEST', `That design has problems: ${problems.slice(0, 3).join('; ')}.`);
        const description = text(item.description, 'Description', { max: 500 });
        const prior = byName.get(label.toLowerCase());
        if (!prior && count >= MAX_HOUSES_PER_ORG) throw new HttpError('BAD_REQUEST', 'This organisation has reached its limit of house designs.');
        const patch = { name: label, description, updatedAt: iso(), archived: false, sourceType: 'saved', sourceRef: null, project: p, stats: houseStats(p), thumbnail: projectToSvg(p) };
        const h = prior ? { ...prior, ...patch } : { id: rid('h'), orgId: org.id, createdBy: 'owner-import', createdAt: iso(), ...patch };
        await pstore.saveHouse(h);
        if (!prior) count += 1;
        byName.set(label.toLowerCase(), h);
        results.push({ name: label, status: prior ? 'replaced' : 'created', id: h.id });
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        results.push({ name: label, status: 'failed', error: e.message });
      }
    }
    const n = (k) => results.filter((x) => x.status === k).length;
    return json({ orgId: org.id, created: n('created'), replaced: n('replaced'), failed: n('failed'), results });
  }
  async function adminOrg(r, id) {
    const org = await pstore.getOrg(id);
    if (!org) throw new HttpError('NOT_FOUND', 'No such organisation.');
    return org;
  }
  async function adminExtend(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    if (org.internal === true) throw new HttpError('BAD_REQUEST', 'Trials do not apply to an internal test account.');
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
    for (let i = 0; i < rows.length && org.internal !== true; i += 1) {
      const price = priceForNthLoginThisMonth(i + 1, next);
      if (rows[i].amountCents !== price) await pstore.updateLoginIssue(rows[i].loginId, { amountCents: price });
    }
    return json(await adminOrgView(next));
  }
  /** GET /portal/admin/orgs/:id/jobs?month=YYYY-MM (bearer admin token): every job row of one org for a month (default this month). */
  async function adminJobs(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    const month = r.url.searchParams.get('month') || monthKey(now());
    if (!MONTH_RE.test(month)) throw new HttpError('BAD_REQUEST', 'month must be YYYY-MM.');
    const rows = await pstore.listJobCharges(org.id, month);
    return json({ orgId: org.id, month, ...summariseJobs(rows), feeCents: JOB_FEE_CENTS, items: rows.map(jobView), billingReady: jobBillingReadiness(config).ready, billingMessage: jobBillingReadiness(config).message });
  }
  /** POST /portal/admin/orgs/:id/job-plan { plan: 'starter' | 'pro' | 'teams' | null }: the owner puts an org on a capped plan, or takes it off. */
  async function adminJobPlan(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    if (org.internal === true) throw new HttpError('BAD_REQUEST', 'An internal test account is never charged, so it has no plan.');
    const b = await readJson(r.request, 1024).catch(() => ({}));
    if (b.plan === undefined) throw new HttpError('BAD_REQUEST', 'Send plan as starter, pro, teams or null.');
    const plan = b.plan === null ? null : jobPlanOf(b.plan);
    if (b.plan !== null && !plan) throw new HttpError('BAD_REQUEST', 'plan must be starter, pro, teams or null.');
    const patch = plan ? { jobPlan: plan.id, jobPlanSince: org.jobPlanSince || iso() } : { jobPlan: null, jobPlanSubscriptionId: null, jobPlanSince: null };
    await pstore.updateOrg(org.id, patch);
    return json(await adminOrgView({ ...org, ...patch }));
  }
  async function adminConvert(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    if (org.internal === true) throw new HttpError('BAD_REQUEST', 'An internal test account is never converted to a paid account.');
    const b = await readJson(r.request, 2048).catch(() => ({}));
    const patch = { status: 'active', convertedAt: org.convertedAt || iso(), convertedHow: org.convertedHow || 'manual', ownerNote: text(b.note, 'Note', { max: 500 }) || org.ownerNote || null };
    await pstore.updateOrg(org.id, patch);
    return json(await adminOrgView({ ...org, ...patch }));
  }
  /** A new temporary password for the org's first admin (the first one is shown once, so this is the way out if it is lost). */
  async function adminResetAdmin(r, id) {
    await adminAuth(r.request);
    const org = await adminOrg(r, id);
    if (org.internal === true) throw new HttpError('BAD_REQUEST', 'Set the internal test login again with the Create internal test account form. No password is generated for it.');
    const admin = (await pstore.listUsers(org.id, true)).filter((u) => u.role === 'admin').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!admin) throw new HttpError('NOT_FOUND', 'That organisation has no admin login.');
    return json({ admin: publicUser(admin), ...(await issueTemp(admin)) });
  }

  // Card details: Stripe Checkout in setup mode (TEST keys only until the owner approves live billing) -----------------------------
  async function billingSetup(r) {
    const { org } = await auth(r, { need: 'billing.write', allowReadOnly: true });
    if (org.internal === true) throw new HttpError('BAD_REQUEST', 'An internal test account has no billing.'); // no Stripe customer or setup session, ever
    if (!contactComplete(org)) throw new HttpError('BAD_REQUEST', 'Save your legal business name, ABN and billing email first. They are needed on your tax invoices.');
    const customer = await ensureCustomer({ config, pstore, fetchImpl, org });
    const origin = config.siteOrigin || r.url.origin;
    const session = await stripeCall({
      config, fetchImpl, path: '/checkout/sessions',
      form: {
        mode: 'setup', customer, 'payment_method_types[0]': 'card', client_reference_id: org.id, locale: 'auto',
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
    if (kind === 'topup' && st.internal) throw new HttpError('NOT_ENTITLED', 'An internal test account has a generous monthly AI allowance and no top-ups.', {}, 403);
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
    ['GET', '/billing/usage', monthUsage], ['GET', '/billing/jobs', jobsRoute], ['POST', '/billing/job-plan', jobPlanStart], ['POST', '/billing/job-plan/confirm', jobPlanConfirm], ['POST', '/billing/job-plan/cancel', jobPlanCancel], ['GET', '/billing/invoices', listInvoices], ['GET', `/billing/invoices/${ID}`, getInvoice], ['GET', '/billing/contact', getContact], ['PUT', '/billing/contact', setContact],
    ['GET', '/ai', aiBalance], ['POST', '/ai/top-up', aiTopUp], ['POST', '/ai/token', aiTokenRoute],
    ['GET', '/team', listTeam], ['POST', '/team', inviteStaff], ['PATCH', `/team/${ID}`, updateStaff], ['POST', `/team/${ID}/reset-password`, resetStaff],
    ['POST', `/team/${ID}/disable`, (r, id) => setStatus(r, id, 'staff', 'disabled')], ['POST', `/team/${ID}/enable`, (r, id) => setStatus(r, id, 'staff', 'active')],
    ['PUT', '/org/branding', setBranding], ['PATCH', '/org/settings', setSettings],
    ['GET', '/builders/search', searchBuilders, { noCsrf: true }], ['POST', '/client-access-request', clientAccessRequest],
    ['GET', '/client-requests', listClientRequests], ['POST', `/client-requests/${ID}/approve`, approveClientRequest], ['POST', `/client-requests/${ID}/decline`, declineClientRequest],
    ['GET', '/admin/client-requests', adminClientRequests, { token: true }],
    ['POST', '/admin/orgs', createOrg, { token: true }],
    ['POST', '/billing/setup', billingSetup], ['POST', '/billing/setup/confirm', billingSetupConfirm],
    ['POST', '/trial-request', trialRequest, { noCsrf: true }], ['GET', `/brand/${ID}`, brandBySlug, { noCsrf: true }], ['POST', `/admin/orgs/${ID}/slug`, adminSlug, { token: true }],
    ['GET', '/admin/trial-requests', adminRequests, { token: true }], ['POST', `/admin/trial-requests/${ID}/approve`, adminApprove, { token: true }], ['POST', `/admin/trial-requests/${ID}/decline`, adminDecline, { token: true }],
    ['GET', '/admin/enquiries', adminEnquiries, { token: true }], ['GET', `/admin/enquiries/${ID}/pdf`, adminEnquiryPdf, { token: true }],
    ['GET', '/admin/orgs', adminOrgs, { token: true }], ['POST', `/admin/orgs/${ID}/extend-trial`, adminExtend, { token: true }], ['POST', `/admin/orgs/${ID}/convert`, adminConvert, { token: true }], ['POST', `/admin/orgs/${ID}/login-rate`, adminLoginRate, { token: true }], ['GET', `/admin/orgs/${ID}/jobs`, adminJobs, { token: true }], ['POST', `/admin/orgs/${ID}/job-plan`, adminJobPlan, { token: true }], ['POST', `/admin/orgs/${ID}/brand-colours`, adminBrandColours, { token: true }], ['POST', `/admin/orgs/${ID}/reset-admin`, adminResetAdmin, { token: true }],
    ['POST', `/admin/orgs/${ID}/houses`, adminImportHouses, { token: true }],
    ['POST', '/admin/internal-orgs', adminCreateInternal, { token: true }], ['POST', `/admin/orgs/${ID}/internal`, adminSetInternal, { token: true }],
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
    return { user, org, allowed, watermark: state.isTrial, internalTest: org.internal === true };
  }

  /** For POST /api/terms/accept: the signed in portal user and org (cookie session), or throws UNAUTHORISED. No export permission is needed. */
  async function identity(request, url) {
    checkCsrf(request, url);
    const { user, org } = await auth({ request, url, setCookie: null }, { allowReadOnly: true, allowChange: true });
    return { user, org };
  }

  /**
   * M2: a signed org AI token proves who the holder WAS when it was issued. Every use is re-checked against the database: the login must still
   * exist in that org, be active, and carry the same session epoch (so a logout, password change, disable or delete ends the token at once);
   * the org must still exist. Returns { user, org } or throws UNAUTHORISED.
   */
  async function verifyOrgToken(payload) {
    const bad = () => new HttpError('UNAUTHORISED', 'Your sign in has ended. Sign in again to continue.');
    const user = payload?.lid ? await pstore.getUser(payload.lid) : null;
    if (!user || user.orgId !== payload.oid || user.status !== 'active') throw bad();
    if ((user.sessionEpoch || 0) !== (Number.isInteger(payload.se) ? payload.se : 0)) throw bad();
    const org = await pstore.getOrg(user.orgId);
    if (!org) throw bad();
    return { user, org };
  }
  const isInternal = async (orgId) => !!orgId && (await pstore.getOrg(orgId))?.internal === true;
  return { route, scheduled, exportContext, identity, gate, isInternal, verifyOrgToken, completeCardSetup, handleBillingEvent, runMonth: (opts = {}) => runMonth({ pstore, store, config, fetchImpl, now, ...opts }), contactComplete };
}
