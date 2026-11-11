// In-memory mock of the portal API with realistic sample data (docs/PORTAL_API.md). The state lives in localStorage so the
// dashboard page and Pocket Architect (same origin) see the same builder, clients and designs. Every storage access is wrapped.
// Passwords are kept in plain text HERE ONLY, because this is a review mock. The real server uses PBKDF2 (docs/PORTAL_API.md 6).
//
//   const api = createMockApi({ now, storage, latency });   // tests pass a controllable clock and an in-memory storage

import { ApiError } from '../premium/api.js';
import { migrate, validate } from '../model/schema.js';
import { GLIDE_LIBRARY } from './glide-library.generated.js';
import { houseStats } from './house-stats.js';
import { projectToSvg } from './thumbnail.js';
import { generateUsername, generatePassword, generateToken, passwordProblem } from './credentials.js';
import { gstOfTotal, monthLabel } from './billing.js';
import { NEW_LOGIN_FEE_CENTS, TOPUP_FEE_CENTS, TOPUP_CREDITS, monthKey, previousMonthKey, monthStartMs, summariseMonth, loginsInMonth } from './billing.js';

const DB_KEY = 'gi.portal.mock.v1';
const SESSION_KEY = 'gi.portal.session.v1';
const DAY = 86400000;
export const DEFAULT_AI_MONTHLY_CAP = 150;
export const TEMP_PASSWORD_DAYS = 7;
export const MAX_FAILED_SIGN_INS = 5;
export const LOCKOUT_MINUTES = 15;
export const SELLER = { name: 'Glide Inside', abn: '29 699 165 663' };
export const DEMO_LOGINS = {
  admin: { identifier: 'priya@samplehomes.example', password: 'river-maple-47' },
  designer: { identifier: 'tom@samplehomes.example', password: 'olive-cedar-38' },
  client: { identifier: 'sarah-4821', password: 'lemon-peach-52' },
};

const PERMS = {
  admin: ['houses.write', 'clients.read', 'clients.write', 'billing.read', 'billing.write', 'team.write', 'branding.write', 'projects.read'],
  designer: ['houses.write', 'clients.read', 'projects.read'],
  client: [],
};

export function memoryStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => (m.set(k, String(v)), true), remove: (k) => m.delete(k) };
}

export function browserStorage() {
  const mem = memoryStorage();
  return {
    get(k) {
      try {
        const v = globalThis.localStorage?.getItem(k);
        return v ?? mem.get(k);
      } catch {
        return mem.get(k);
      }
    },
    set(k, v) {
      try {
        globalThis.localStorage.setItem(k, v);
        return true;
      } catch {
        return mem.set(k, v);
      }
    },
    remove(k) {
      try {
        globalThis.localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
      mem.remove(k);
    },
  };
}

const rid = (prefix) => `${prefix}_${generateToken(5)}`;
const err = (code, message, status = 400) => new ApiError(code, message, { status });
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const text = (v, name, { max = 120, required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw err('BAD_REQUEST', `${name} is required.`);
  if (s.length > max) throw err('BAD_REQUEST', `${name} is too long.`);
  return s;
};
const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function seedDb(now) {
  const key = monthKey(now);
  const m1 = previousMonthKey(key);
  const m2 = previousMonthKey(m1);
  const m3 = previousMonthKey(m2);
  const at = (k, day, hour = 10) => Math.min(now, monthStartMs(k) + (day - 1) * DAY + hour * 3600000);
  const iso = (ms) => new Date(ms).toISOString();
  const orgId = 'org_sample';
  const user = (id, role, name, email, username, password, extra = {}) => ({
    id, orgId, role, name, email, username, password, mustChangePassword: false, status: 'active', createdAt: iso(at(m3, 3)), lastSignInAt: null,
    houseAccess: 'all', lotAddress: '', ai: { used: {}, topUpBalance: 0 }, ...extra,
  });
  const users = [
    user('u_priya', 'admin', 'Priya', 'priya@samplehomes.example', 'priya-4827', DEMO_LOGINS.admin.password, { lastSignInAt: iso(now - 3600000) }),
    user('u_tom', 'designer', 'Tom', 'tom@samplehomes.example', 'tom-3948', DEMO_LOGINS.designer.password, { lastSignInAt: iso(now - 2 * DAY) }),
    user('u_sarah', 'client', 'Sarah', 'sarah.t@example.com', 'sarah-4821', DEMO_LOGINS.client.password, { createdAt: iso(at(m1, 12)), lastSignInAt: iso(now - DAY), lotAddress: 'Lot 14, 22 Banksia Rise, Thornton NSW 2322', houseAccess: ['h_banksia', 'h_wattle'], ai: { used: { [key]: 62 }, topUpBalance: 0 } }),
    user('u_daniel', 'client', 'Daniel', '', 'daniel-5937', 'plum-lake-84', { createdAt: iso(at(m1, 20)), lastSignInAt: iso(now - 6 * DAY), lotAddress: 'Lot 3 Ironbark Close, Cessnock NSW 2325', ai: { used: { [key]: 140 }, topUpBalance: 300 } }),
    user('u_mei', 'client', 'Mei', 'mei.l@example.com', 'mei-6294', 'tulip-bear-29', { createdAt: iso(at(key, 2)), mustChangePassword: true, tempPasswordExpiresAt: iso(now + 5 * DAY), lotAddress: '', houseAccess: ['h_coastal'] }),
    user('u_jack', 'client', 'Jack', '', 'jack-7382', 'swan-pine-63', { createdAt: iso(at(key, 3, 14)), lotAddress: '15 Wattle Court, Raymond Terrace NSW 2324', lastSignInAt: iso(now - 5 * 3600000), ai: { used: { [key]: 150 }, topUpBalance: 0 } }),
    user('u_olivia', 'client', 'Olivia', 'olivia.r@example.com', 'olivia-8473', 'jade-fox-75', { createdAt: iso(at(m2, 8)), status: 'disabled', lastSignInAt: iso(at(m2, 30)) }),
    user('u_ahmed', 'client', 'Ahmed', 'ahmed.k@example.com', 'ahmed-2956', 'coral-oak-36', { createdAt: iso(at(key, 3, 16)), lastSignInAt: iso(at(key, 3, 16)), lotAddress: 'Lot 9 Flinders Drive, Medowie NSW 2318' }),
  ];
  const glide = (id) => GLIDE_LIBRARY.find((g) => g.id === id);
  const house = (id, name, glideId, extra = {}) => {
    const g = glide(glideId);
    const { id: _id, name: _n, thumbnail, templateId, description, type, category, ...stats } = g;
    return { id, orgId, name, description: `Based on ${g.name}.`, source: { type: 'glide', ref: glideId }, createdAt: iso(at(m2, 5)), updatedAt: iso(at(m1, 15)), createdBy: 'u_priya', archived: false, ...stats, thumbnail, project: null, ...extra };
  };
  const houses = [
    house('h_banksia', 'Banksia 25 single storey', 'glide:house_single'),
    house('h_coastal', 'Coastal 28 double storey', 'glide:house_double'),
    house('h_wattle', 'Wattle 12 granny flat', 'glide:granny_flat'),
    house('h_ironbark', 'Ironbark duplex', 'glide:duplex'),
    house('h_cottage', 'Cottage 2 (older range)', 'glide:granny_flat', { archived: true }),
  ];
  const issues = [
    { id: 'li_1', orgId, loginId: 'u_sarah', clientName: 'Sarah', chargedAt: iso(at(m1, 12)), amountCents: NEW_LOGIN_FEE_CENTS },
    { id: 'li_2', orgId, loginId: 'u_daniel', clientName: 'Daniel', chargedAt: iso(at(m1, 20)), amountCents: NEW_LOGIN_FEE_CENTS },
    { id: 'li_3', orgId, loginId: 'u_olivia', clientName: 'Olivia', chargedAt: iso(at(m2, 8)), amountCents: NEW_LOGIN_FEE_CENTS },
    { id: 'li_5', orgId, loginId: 'u_jack', clientName: 'Jack', chargedAt: iso(at(key, 3, 14)), amountCents: NEW_LOGIN_FEE_CENTS },
    { id: 'li_6', orgId, loginId: 'u_ahmed', clientName: 'Ahmed', chargedAt: iso(at(key, 3, 16)), amountCents: NEW_LOGIN_FEE_CENTS },
  ];
  const topUps = [
    { id: 'tu_1', orgId, loginId: 'u_daniel', credits: TOPUP_CREDITS, amountCents: TOPUP_FEE_CENTS, createdAt: iso(at(m1, 25)) },
    { id: 'tu_2', orgId, loginId: 'u_daniel', credits: TOPUP_CREDITS, amountCents: TOPUP_FEE_CENTS, createdAt: iso(at(key, 3, 9)) },
  ];
  const projects = [
    { id: 'pr_1', orgId, ownerId: 'u_sarah', name: 'Thornton, Lot 14', lotAddress: users[2].lotAddress, houseNames: ['Banksia 25 single storey'], createdAt: iso(at(m1, 14)), updatedAt: iso(now - DAY), project: null, glideRef: 'glide:house_single' },
    { id: 'pr_2', orgId, ownerId: 'u_daniel', name: 'Cessnock, Lot 3', lotAddress: users[3].lotAddress, houseNames: ['Ironbark duplex'], createdAt: iso(at(m1, 22)), updatedAt: iso(now - 6 * DAY), project: null, glideRef: 'glide:duplex' },
    { id: 'pr_3', orgId, ownerId: 'u_jack', name: 'Raymond Terrace', lotAddress: users[5].lotAddress, houseNames: ['Wattle 12 granny flat'], createdAt: iso(at(key, 3, 15)), updatedAt: iso(now - 5 * 3600000), project: null, glideRef: 'glide:granny_flat' },
  ];
  return {
    version: 1,
    orgs: [{ id: orgId, name: 'Sample Homes Pty Ltd', shortCode: 'SHM', branding: { displayName: 'Sample Homes', logoDataUrl: null }, allowClientTopUps: true, allowClientEnquiries: true, showGlideToClients: true, allowClientCadExports: false, aiMonthlyCap: DEFAULT_AI_MONTHLY_CAP, billingContact: { name: 'Accounts, Sample Homes', email: 'accounts@samplehomes.example', phone: '02 5550 0100', legalName: 'Sample Homes Pty Ltd', abn: '51 824 753 556' }, createdAt: iso(at(m3, 1)) }],
    users, houses, projects, issues, topUps, resets: {},
  };
}

export function createMockApi({ now = () => Date.now(), storage = browserStorage(), seed = true, latency = 0, loadCatalogue = () => import('../catalogue/templates.js') } = {}) {
  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : null);

  function load() {
    let db = null;
    try {
      db = JSON.parse(storage.get(DB_KEY) || 'null');
    } catch {
      db = null;
    }
    if (!db || db.version !== 1) {
      db = seed ? seedDb(now()) : { version: 1, orgs: [], users: [], houses: [], projects: [], issues: [], topUps: [], resets: {} };
      save(db);
    }
    return db;
  }
  const save = (db) => storage.set(DB_KEY, JSON.stringify(db));
  const iso = () => new Date(now()).toISOString();

  const sessionUserId = () => {
    try {
      return JSON.parse(storage.get(SESSION_KEY) || 'null')?.userId || null;
    } catch {
      return null;
    }
  };

  // Context and guards --------------------------------------------------------------------------------------------------
  function ctx(need, { allowChangeRequired = false } = {}) {
    const db = load();
    const user = db.users.find((u) => u.id === sessionUserId());
    if (!user) throw err('UNAUTHORISED', 'Please sign in.', 401);
    if (user.status !== 'active') throw err('ACCOUNT_DISABLED', 'This login has been disabled. Contact your builder.', 403);
    const org = db.orgs.find((o) => o.id === user.orgId);
    if (user.mustChangePassword && !allowChangeRequired) throw err('PASSWORD_CHANGE_REQUIRED', 'Choose a new password before you continue.', 403);
    if (need && !PERMS[user.role].includes(need)) throw err('FORBIDDEN', 'Your role does not allow that.', 403);
    return { db, user, org };
  }
  const isStaff = (u) => u.role !== 'client';

  const aiBalance = (user, org) => {
    const month = monthKey(now());
    const used = user.ai?.used?.[month] || 0;
    const cap = org.aiMonthlyCap ?? DEFAULT_AI_MONTHLY_CAP;
    const monthlyRemaining = Math.max(0, cap - used);
    const topUpBalance = user.ai?.topUpBalance || 0;
    return { month, monthlyCap: cap, used, monthlyRemaining, topUpBalance, remaining: monthlyRemaining + topUpBalance, total: cap + topUpBalance };
  };

  const publicUser = (u, org) => ({
    id: u.id, name: u.name, email: u.email || '', username: u.username, role: u.role, status: u.status, mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt, lastSignInAt: u.lastSignInAt, tempPasswordExpiresAt: u.mustChangePassword ? u.tempPasswordExpiresAt || null : null, ...(org ? { ai: aiBalance(u, org) } : {}),
  });
  const publicOrg = (o) => ({ id: o.id, name: o.name, shortCode: o.shortCode, branding: clone(o.branding), allowClientTopUps: !!o.allowClientTopUps, allowClientEnquiries: o.allowClientEnquiries !== false, showGlideToClients: o.showGlideToClients !== false, allowClientCadExports: !!o.allowClientCadExports, aiMonthlyCap: o.aiMonthlyCap, billingContact: clone(o.billingContact) });
  const houseMeta = (h) => { const { project, ...rest } = h; return { ...clone(rest), hasProject: !!project }; };
  const visibleHouse = (user, h) => !h.archived && (user.houseAccess === 'all' || (Array.isArray(user.houseAccess) && user.houseAccess.includes(h.id)));

  async function resolveGlideProject(ref, name) {
    const g = GLIDE_LIBRARY.find((x) => x.id === ref);
    if (!g) throw err('NOT_FOUND', 'Unknown Glide Inside model.', 404);
    const { createFromTemplate } = await loadCatalogue();
    const p = createFromTemplate(g.templateId);
    if (name) p.name = name;
    return p;
  }

  const takenUsernames = (db) => new Set(db.users.map((u) => u.username.toLowerCase()));

  function createAccount(db, org, { firstName, email, role, lotAddress = '', houseAccess = 'all' }) {
    const name = text(firstName, 'First name', { required: true, max: 60 });
    const mail = text(email, 'Email', { max: 120 }).toLowerCase();
    if (!emailOk(mail)) throw err('BAD_REQUEST', 'That email address does not look right.');
    if (mail && db.users.some((u) => u.email?.toLowerCase() === mail)) throw err('CONFLICT', 'That email address already has a login.', 409);
    const username = generateUsername(name, takenUsernames(db));
    const password = generatePassword();
    const user = {
      id: rid('u'), orgId: org.id, role, name, email: mail, username, password, mustChangePassword: true, tempPasswordExpiresAt: new Date(now() + TEMP_PASSWORD_DAYS * DAY).toISOString(), status: 'active', createdAt: iso(), lastSignInAt: null,
      houseAccess: role === 'client' ? houseAccess : 'all', lotAddress: text(lotAddress, 'Lot address', { max: 200 }), ai: { used: {}, topUpBalance: 0 },
    };
    db.users.push(user);
    return { user, credentials: { username, password } };
  }

  const cleanAccess = (db, org, access) => {
    if (access === 'all' || access == null) return 'all';
    if (!Array.isArray(access)) throw err('BAD_REQUEST', 'houseAccess must be "all" or a list of house ids.');
    const ids = new Set(db.houses.filter((h) => h.orgId === org.id).map((h) => h.id));
    return access.filter((id) => ids.has(id));
  };

  function clientView(db, org, u) {
    return { ...publicUser(u, org), lotAddress: u.lotAddress || '', houseAccess: u.houseAccess, projectCount: db.projects.filter((p) => p.ownerId === u.id).length, billed: db.issues.some((i) => i.loginId === u.id) };
  }

  const api = {
    // Session -------------------------------------------------------------------------------------------------------------
    async signIn({ identifier, password } = {}) {
      await wait();
      const db = load();
      const id = text(identifier, 'Email or username', { required: true }).toLowerCase();
      const user = db.users.find((u) => u.username.toLowerCase() === id || (u.email && u.email.toLowerCase() === id));
      if (user?.lockedUntil && Date.parse(user.lockedUntil) > now()) {
        const mins = Math.ceil((Date.parse(user.lockedUntil) - now()) / 60000);
        throw new ApiError('ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`, { status: 429, retryAfter: mins * 60 });
      }
      if (!user || user.password !== password) {
        if (user) {
          user.failedSignIns = (user.failedSignIns || 0) + 1;
          if (user.failedSignIns >= MAX_FAILED_SIGN_INS) {
            user.failedSignIns = 0;
            user.lockedUntil = new Date(now() + LOCKOUT_MINUTES * 60000).toISOString();
          }
          save(db);
        }
        throw err('INVALID_CREDENTIALS', 'That sign in did not work. Check the details and try again.', 401);
      }
      if (user.status !== 'active') throw err('ACCOUNT_DISABLED', 'This login has been disabled. Contact your builder.', 403);
      if (user.mustChangePassword && user.tempPasswordExpiresAt && Date.parse(user.tempPasswordExpiresAt) < now()) throw err('PASSWORD_EXPIRED', `This temporary password expired after ${TEMP_PASSWORD_DAYS} days. Ask your builder for a new one.`, 401);
      user.failedSignIns = 0;
      user.lockedUntil = null;
      user.lastSignInAt = iso();
      // The A$20 charge for a client login happens here, on the first sign in, and never again for that login.
      if (user.role === 'client' && !db.issues.some((i) => i.loginId === user.id)) db.issues.push({ id: rid('lc'), orgId: user.orgId, loginId: user.id, clientName: user.name, chargedAt: iso(), amountCents: NEW_LOGIN_FEE_CENTS });
      save(db);
      storage.set(SESSION_KEY, JSON.stringify({ userId: user.id, at: iso() }));
      return api.me();
    },
    async signOut() {
      await wait();
      storage.remove(SESSION_KEY);
      return { ok: true };
    },
    /** The signed in person, or null. */
    async me() {
      await wait();
      const db = load();
      const user = db.users.find((u) => u.id === sessionUserId());
      if (!user || user.status !== 'active') return null;
      const org = db.orgs.find((o) => o.id === user.orgId);
      return { user: publicUser(user, org), org: publicOrg(org), permissions: [...PERMS[user.role]], houseAccess: user.houseAccess, lotAddress: user.lotAddress || '', ai: aiBalance(user, org), canTopUp: isStaff(user) || !!org.allowClientTopUps, plansIncluded: true, enquiry: isStaff(user) || org.allowClientEnquiries !== false, exports: isStaff(user) || org.allowClientCadExports ? ['pdf', 'dxf', 'glb', 'obj'] : ['pdf'] };
    },
    async changePassword({ currentPassword, newPassword } = {}) {
      await wait();
      const { db, user } = ctx(null, { allowChangeRequired: true });
      if (user.password !== currentPassword) throw err('INVALID_CREDENTIALS', 'The current password is not right.', 401);
      const problem = passwordProblem(newPassword, { username: user.username, email: user.email, temporary: user.mustChangePassword ? currentPassword : null });
      if (problem) throw err('BAD_REQUEST', problem);
      user.password = newPassword;
      user.mustChangePassword = false;
      user.tempPasswordExpiresAt = null;
      save(db);
      return { ok: true };
    },
    /** Always answers ok so the screen cannot be used to find which addresses are registered. The mock also returns the token. */
    async requestPasswordReset({ identifier } = {}) {
      await wait();
      const db = load();
      const id = text(identifier, 'Email', { required: true }).toLowerCase();
      const user = db.users.find((u) => u.role !== 'client' && u.email && u.email.toLowerCase() === id);
      let mock;
      if (user) {
        const token = generateToken();
        db.resets[token] = { userId: user.id, exp: now() + 3600000 };
        save(db);
        mock = { token };
      }
      return { ok: true, ...(mock ? { mock } : {}) };
    },
    async completePasswordReset({ token, newPassword } = {}) {
      await wait();
      const db = load();
      const r = db.resets[token];
      if (!r || r.exp < now()) throw err('BAD_REQUEST', 'This reset link has expired. Ask for a new one.');
      const user = db.users.find((u) => u.id === r.userId);
      const problem = passwordProblem(newPassword, { username: user.username, email: user.email });
      if (problem) throw err('BAD_REQUEST', problem);
      user.password = newPassword;
      user.mustChangePassword = false;
      user.tempPasswordExpiresAt = null;
      user.failedSignIns = 0;
      user.lockedUntil = null;
      delete db.resets[token];
      save(db);
      return { ok: true };
    },

    // Houses ----------------------------------------------------------------------------------------------------------------
    /** Staff: the builder's library (archived included on request). Client: only the houses this login may see. */
    async listHouses({ includeArchived = false } = {}) {
      await wait();
      const { db, user } = ctx();
      let list = db.houses.filter((h) => h.orgId === user.orgId);
      list = isStaff(user) ? list.filter((h) => includeArchived || !h.archived) : list.filter((h) => visibleHouse(user, h));
      return list.sort((a, b) => a.name.localeCompare(b.name)).map(houseMeta);
    },
    async getHouse(id) {
      await wait();
      const { db, user } = ctx();
      const h = db.houses.find((x) => x.id === id && x.orgId === user.orgId);
      if (!h || (!isStaff(user) && !visibleHouse(user, h))) throw err('NOT_FOUND', 'That house design was not found.', 404);
      const project = h.project ? clone(h.project) : await resolveGlideProject(h.source?.ref, h.name);
      project.name = h.name;
      return { ...houseMeta(h), project };
    },
    /**
     * Create or update a library house. Create from the open design: { name, project }. Import: the same with a parsed file.
     * Start from the Glide library: { name?, fromGlideId }. Update: { id, name?, project? }.
     */
    async saveHouse({ id, name, project, fromGlideId, description } = {}) {
      await wait();
      const { db, user, org } = ctx('houses.write');
      let h = id ? db.houses.find((x) => x.id === id && x.orgId === org.id) : null;
      if (id && !h) throw err('NOT_FOUND', 'That house design was not found.', 404);
      let proj = null;
      let source = h?.source || { type: 'saved' };
      let stats = null;
      let thumbnail = null;
      if (fromGlideId) {
        const g = GLIDE_LIBRARY.find((x) => x.id === fromGlideId);
        if (!g) throw err('NOT_FOUND', 'Unknown Glide Inside model.', 404);
        const { id: _i, name: _n, thumbnail: th, templateId, description: _d, type, category, ...s } = g;
        stats = s;
        thumbnail = th;
        source = { type: 'glide', ref: fromGlideId };
        name = name || g.name;
      } else if (project) {
        let p;
        try {
          p = migrate(project);
        } catch (e) {
          throw err('BAD_REQUEST', e.message || 'That is not a Pocket Architect design.');
        }
        const problems = validate(p);
        if (problems.length) throw err('BAD_REQUEST', `That design has problems: ${problems.slice(0, 3).join('; ')}.`);
        proj = p;
        stats = houseStats(p);
        thumbnail = projectToSvg(p);
        if (!h) source = { type: 'saved' };
      } else if (!h) throw err('BAD_REQUEST', 'Send a project or fromGlideId.');
      const label = text(name ?? h?.name ?? proj?.name, 'Name', { required: true, max: 80 });
      if (db.houses.some((x) => x.orgId === org.id && x.id !== h?.id && !x.archived && x.name.toLowerCase() === label.toLowerCase())) throw err('CONFLICT', 'A house design with that name already exists.', 409);
      if (!h) {
        h = { id: rid('h'), orgId: org.id, createdAt: iso(), createdBy: user.id, archived: false, project: null };
        db.houses.push(h);
      }
      Object.assign(h, { name: label, description: description ?? h.description ?? '', updatedAt: iso(), source });
      if (stats) Object.assign(h, stats, { thumbnail });
      if (proj) h.project = proj;
      else if (fromGlideId) h.project = null;
      save(db);
      return houseMeta(h);
    },
    async duplicateHouse(id) {
      await wait();
      const { db, org } = ctx('houses.write');
      const h = db.houses.find((x) => x.id === id && x.orgId === org.id);
      if (!h) throw err('NOT_FOUND', 'That house design was not found.', 404);
      let n = 2;
      let label = `${h.name} copy`;
      while (db.houses.some((x) => x.orgId === org.id && x.name.toLowerCase() === label.toLowerCase())) label = `${h.name} copy ${n++}`;
      const copy = { ...clone(h), id: rid('h'), name: label, createdAt: iso(), updatedAt: iso(), archived: false };
      db.houses.push(copy);
      save(db);
      return houseMeta(copy);
    },
    async archiveHouse(id, archived = true) {
      await wait();
      const { db, org } = ctx('houses.write');
      const h = db.houses.find((x) => x.id === id && x.orgId === org.id);
      if (!h) throw err('NOT_FOUND', 'That house design was not found.', 404);
      h.archived = !!archived;
      h.updatedAt = iso();
      save(db);
      return houseMeta(h);
    },
    /** The Glide Inside models, available to every builder and client. No project JSON in the list. */
    async listGlideLibrary() {
      await wait();
      const { user, org } = ctx();
      if (!isStaff(user) && org.showGlideToClients === false) return [];
      return GLIDE_LIBRARY.map(({ ...g }) => g);
    },
    async getGlideModel(id) {
      await wait();
      const { user, org } = ctx();
      if (!isStaff(user) && org.showGlideToClients === false) throw err('NOT_FOUND', 'Unknown Glide Inside model.', 404);
      const g = GLIDE_LIBRARY.find((x) => x.id === id);
      if (!g) throw err('NOT_FOUND', 'Unknown Glide Inside model.', 404);
      return { ...g, project: await resolveGlideProject(id, g.name) };
    },

    // Clients -------------------------------------------------------------------------------------------------------------
    async listClients() {
      await wait();
      const { db, org } = ctx('clients.read');
      return db.users.filter((u) => u.orgId === org.id && u.role === 'client').map((u) => clientView(db, org, u)).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    },
    /** Generate account: only firstName is required. Returns the credentials once; they are never readable again. */
    async issueClientLogin({ firstName, email, lotAddress, houseAccess } = {}) {
      await wait();
      const { db, org } = ctx('clients.write');
      const access = cleanAccess(db, org, houseAccess);
      const { user, credentials } = createAccount(db, org, { firstName, email, role: 'client', lotAddress, houseAccess: access });
      save(db);
      return { client: clientView(db, org, user), credentials, charge: { amountCents: NEW_LOGIN_FEE_CENTS, trigger: 'first_sign_in', note: 'A$20 incl. GST is charged on your monthly invoice once your client first signs in.' } };
    },
    async updateClient(id, { firstName, email, lotAddress, houseAccess } = {}) {
      await wait();
      const { db, org } = ctx('clients.write');
      const u = db.users.find((x) => x.id === id && x.orgId === org.id && x.role === 'client');
      if (!u) throw err('NOT_FOUND', 'That client login was not found.', 404);
      if (firstName !== undefined) u.name = text(firstName, 'First name', { required: true, max: 60 });
      if (email !== undefined) {
        const mail = text(email, 'Email').toLowerCase();
        if (!emailOk(mail)) throw err('BAD_REQUEST', 'That email address does not look right.');
        u.email = mail;
      }
      if (lotAddress !== undefined) u.lotAddress = text(lotAddress, 'Lot address', { max: 200 });
      if (houseAccess !== undefined) u.houseAccess = cleanAccess(db, org, houseAccess);
      save(db);
      return clientView(db, org, u);
    },
    /** New temporary password. Never a charge. */
    async resetClientPassword(id) {
      await wait();
      const { db, org } = ctx('clients.write');
      const u = db.users.find((x) => x.id === id && x.orgId === org.id && x.role === 'client');
      if (!u) throw err('NOT_FOUND', 'That client login was not found.', 404);
      u.password = generatePassword();
      u.mustChangePassword = true;
      u.tempPasswordExpiresAt = new Date(now() + TEMP_PASSWORD_DAYS * DAY).toISOString();
      u.failedSignIns = 0;
      u.lockedUntil = null;
      save(db);
      return { credentials: { username: u.username, password: u.password } };
    },
    /** Removes the login and all of that client's projects. An unused login (never signed in) is deleted free; a charge already made stays on the invoice. */
    async deleteClient(id) {
      await wait();
      const { db, org } = ctx('clients.write');
      const u = db.users.find((x) => x.id === id && x.orgId === org.id && x.role === 'client');
      if (!u) throw err('NOT_FOUND', 'That client login was not found.', 404);
      const removed = db.projects.filter((p) => p.ownerId === id).length;
      db.projects = db.projects.filter((p) => p.ownerId !== id);
      db.users = db.users.filter((x) => x.id !== id);
      const charged = db.issues.some((i) => i.loginId === id);
      save(db);
      return { ok: true, removedProjects: removed, charged };
    },
    /** All of a client's projects as design files, for the builder to keep or hand over. */
    async exportClientProjects(id) {
      await wait();
      const { db, org } = ctx('clients.read');
      const u = db.users.find((x) => x.id === id && x.orgId === org.id && x.role === 'client');
      if (!u) throw err('NOT_FOUND', 'That client login was not found.', 404);
      const projects = [];
      for (const p of db.projects.filter((x) => x.ownerId === id)) {
        const project = p.project ? clone(p.project) : await resolveGlideProject(p.glideRef, p.name);
        projects.push({ id: p.id, name: p.name, lotAddress: p.lotAddress || '', updatedAt: p.updatedAt, project });
      }
      return { exportedAt: iso(), client: { id: u.id, name: u.name, username: u.username, email: u.email || '', lotAddress: u.lotAddress || '' }, projects };
    },
    async disableClient(id) {
      return setStatus(id, 'client', 'disabled', 'clients.write');
    },
    async enableClient(id) {
      return setStatus(id, 'client', 'active', 'clients.write');
    },

    // Projects ----------------------------------------------------------------------------------------------------------------
    async listProjects({ clientId } = {}) {
      await wait();
      const { db, user } = ctx();
      let list = db.projects.filter((p) => p.orgId === user.orgId);
      if (!isStaff(user)) list = list.filter((p) => p.ownerId === user.id);
      else if (clientId) list = list.filter((p) => p.ownerId === clientId);
      const names = new Map(db.users.map((u) => [u.id, u.name]));
      return list.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)).map(({ project, glideRef, ...p }) => ({ ...clone(p), ownerName: names.get(p.ownerId) || '' }));
    },
    /** Opens a project: the saved design, plus who owns it. Staff can open any client's project. */
    async openProject(id) {
      await wait();
      const { db, user } = ctx();
      const p = db.projects.find((x) => x.id === id && x.orgId === user.orgId);
      if (!p || (!isStaff(user) && p.ownerId !== user.id)) throw err('NOT_FOUND', 'That project was not found.', 404);
      const project = p.project ? clone(p.project) : await resolveGlideProject(p.glideRef, p.name);
      project.id = project.id || p.id;
      const owner = db.users.find((u) => u.id === p.ownerId);
      const { project: _p, glideRef, ...meta } = p;
      return { ...clone(meta), ownerName: owner?.name || '', project };
    },
    async saveProject({ id, name, project, lotAddress, houseNames } = {}) {
      await wait();
      const { db, user } = ctx();
      let p = id ? db.projects.find((x) => x.id === id && x.orgId === user.orgId) : null;
      if (id && (!p || (!isStaff(user) && p.ownerId !== user.id))) throw err('NOT_FOUND', 'That project was not found.', 404);
      let proj;
      try {
        proj = migrate(project);
      } catch (e) {
        throw err('BAD_REQUEST', e.message || 'That is not a Pocket Architect design.');
      }
      if (JSON.stringify(proj).length > 4_000_000) throw err('PAYLOAD_TOO_LARGE', 'That design is too large to save.', 413);
      if (!p) {
        p = { id: rid('pr'), orgId: user.orgId, ownerId: user.id, createdAt: iso(), glideRef: null };
        db.projects.push(p);
      }
      Object.assign(p, { name: text(name ?? proj.name, 'Name', { required: true, max: 80 }), updatedAt: iso(), project: proj });
      if (lotAddress !== undefined) p.lotAddress = text(lotAddress, 'Lot address', { max: 200 });
      else p.lotAddress = p.lotAddress || '';
      p.houseNames = Array.isArray(houseNames) ? houseNames.slice(0, 20).map(String) : p.houseNames || [];
      save(db);
      const { project: _p, glideRef, ...meta } = p;
      return clone(meta);
    },

    // Billing ----------------------------------------------------------------------------------------------------------------
    /** This month (or `month`, 'YYYY-MM'): new logins and AI top-ups with dates, and the running total. */
    async monthUsage({ month } = {}) {
      await wait();
      const { db, org } = ctx('billing.read');
      const key = month || monthKey(now());
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw err('BAD_REQUEST', 'month must be YYYY-MM.');
      const names = new Map(db.users.map((u) => [u.id, u.name]));
      const s = summariseMonth({ issues: db.issues.filter((i) => i.orgId === org.id), topUps: db.topUps.filter((t) => t.orgId === org.id) }, key);
      return {
        month: key, timezone: 'Australia/Sydney',
        rates: { newLoginCents: NEW_LOGIN_FEE_CENTS, topUpCents: TOPUP_FEE_CENTS, topUpCredits: TOPUP_CREDITS },
        logins: s.logins.map((i) => ({ id: i.id, loginId: i.loginId, clientName: names.get(i.loginId) || i.clientName, firstSignInAt: i.chargedAt ?? i.issuedAt, amountCents: i.amountCents })),
        topUps: s.topUps.map((t) => ({ id: t.id, loginId: t.loginId, clientName: names.get(t.loginId) || '', credits: t.credits, amountCents: t.amountCents, createdAt: t.createdAt })),
        totals: s.totals,
      };
    },
    /** One invoice per past calendar month with charges, raised on the 1st of the next month, due 14 days later. */
    async listInvoices() {
      await wait();
      const { db, org } = ctx('billing.read');
      const issues = db.issues.filter((i) => i.orgId === org.id);
      const topUps = db.topUps.filter((t) => t.orgId === org.id);
      const current = monthKey(now());
      const months = new Set([...issues.map((i) => monthKey(i.chargedAt ?? i.issuedAt)), ...topUps.map((t) => monthKey(t.createdAt))]);
      months.delete(current);
      return [...months].filter((m) => m < current).sort().reverse().map((m) => {
        const t = summariseMonth({ issues, topUps }, m).totals;
        const issuedMs = monthStartMs(nextMonthKey(m));
        const dueMs = issuedMs + 14 * DAY;
        return { id: `inv_${m}`, number: `GI-${org.shortCode}-${m.replace('-', '')}`, month: m, issuedAt: new Date(issuedMs).toISOString(), dueAt: new Date(dueMs).toISOString(), status: now() > dueMs ? 'paid' : 'due', loginsCount: t.loginsCount, topUpsCount: t.topUpsCount, totalCents: t.totalCents };
      });
    },
    /** A tax invoice for a past month (id from listInvoices). Seller, ABN, GST and total incl. GST are all on it. */
    async getInvoice(id) {
      await wait();
      const { db, org } = ctx('billing.read');
      const inv = (await api.listInvoices()).find((i) => i.id === id);
      if (!inv) throw err('NOT_FOUND', 'That invoice was not found.', 404);
      const usage = await api.monthUsage({ month: inv.month });
      const c = org.billingContact || {};
      const lines = [
        { description: `New client logins first signed in during ${monthLabel(inv.month)} (A$20 each, incl. GST)`, quantity: usage.totals.loginsCount, unitCents: NEW_LOGIN_FEE_CENTS, totalCents: usage.totals.loginsCents },
        { description: `AI credit top-ups of ${TOPUP_CREDITS} credits (A$10 each, incl. GST)`, quantity: usage.totals.topUpsCount, unitCents: TOPUP_FEE_CENTS, totalCents: usage.totals.topUpsCents },
      ].filter((l) => l.quantity > 0);
      const total = usage.totals.totalCents;
      return { ...inv, title: 'Tax invoice', seller: { ...SELLER }, buyer: { legalName: c.legalName || '', abn: c.abn || '', contact: c.name || '', email: c.email || '' }, lines, gstCents: gstOfTotal(total), subtotalExGstCents: total - gstOfTotal(total), totalInclGstCents: total, logins: usage.logins, topUps: usage.topUps };
    },
    async getBillingContact() {
      await wait();
      return clone(ctx('billing.read').org.billingContact);
    },
    async setBillingContact({ name, email, phone, legalName, abn } = {}) {
      await wait();
      const { db, org } = ctx('billing.write');
      const mail = text(email, 'Billing email', { required: true });
      if (!emailOk(mail)) throw err('BAD_REQUEST', 'That email address does not look right.');
      const digits = String(abn || '').replace(/\s+/g, '');
      if (!/^\d{11}$/.test(digits)) throw err('BAD_REQUEST', 'Enter the 11 digit ABN for your business.');
      org.billingContact = { name: text(name, 'Contact name', { required: true }), email: mail, phone: text(phone, 'Phone', { max: 30 }), legalName: text(legalName, 'Legal business name', { required: true, max: 120 }), abn: `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}` };
      save(db);
      return clone(org.billingContact);
    },

    // AI credits ----------------------------------------------------------------------------------------------------------------
    async aiBalance() {
      await wait();
      const { user, org } = ctx();
      return aiBalance(user, org);
    },
    /** A$10 incl. GST for 300 credits, added at once and charged on the end of month invoice. */
    async aiTopUp() {
      await wait();
      const { db, user, org } = ctx();
      if (!isStaff(user) && !org.allowClientTopUps) throw err('TOPUPS_DISABLED', 'Your builder has turned off AI credit top-ups.', 403);
      user.ai = user.ai || { used: {}, topUpBalance: 0 };
      user.ai.topUpBalance = (user.ai.topUpBalance || 0) + TOPUP_CREDITS;
      const topUp = { id: rid('tu'), orgId: org.id, loginId: user.id, credits: TOPUP_CREDITS, amountCents: TOPUP_FEE_CENTS, createdAt: iso() };
      db.topUps.push(topUp);
      save(db);
      return { topUp, ai: aiBalance(user, org) };
    },
    /** Server side use in the real system (the AI proxy). Monthly allowance first, then top-up balance. Hard stop at zero. */
    async spendAiCredits({ credits } = {}) {
      await wait();
      const { db, user, org } = ctx();
      const n = Math.max(0, Math.round(Number(credits) || 0));
      const b = aiBalance(user, org);
      if (n > b.remaining) throw new ApiError('CREDITS_EXHAUSTED', 'You have used all your AI credits for this month.', { status: 402 });
      const fromMonth = Math.min(n, b.monthlyRemaining);
      user.ai.used[b.month] = (user.ai.used[b.month] || 0) + fromMonth;
      user.ai.topUpBalance = (user.ai.topUpBalance || 0) - (n - fromMonth);
      save(db);
      return { ai: aiBalance(user, org) };
    },

    // Team --------------------------------------------------------------------------------------------------------------------
    async listTeam() {
      await wait();
      const { db, org } = ctx('clients.read');
      return db.users.filter((u) => u.orgId === org.id && u.role !== 'client').map((u) => publicUser(u, org));
    },
    /** Generate account for staff: firstName and role (admin or designer). No charge. */
    async inviteStaff({ firstName, email, role } = {}) {
      await wait();
      const { db, org } = ctx('team.write');
      if (!['admin', 'designer'].includes(role)) throw err('BAD_REQUEST', 'Role must be admin or designer.');
      const { user, credentials } = createAccount(db, org, { firstName, email, role });
      save(db);
      return { user: publicUser(user, org), credentials };
    },
    async updateStaff(id, { role, firstName, email } = {}) {
      await wait();
      const { db, user: me, org } = ctx('team.write');
      const u = db.users.find((x) => x.id === id && x.orgId === org.id && x.role !== 'client');
      if (!u) throw err('NOT_FOUND', 'That team member was not found.', 404);
      if (role !== undefined) {
        if (!['admin', 'designer'].includes(role)) throw err('BAD_REQUEST', 'Role must be admin or designer.');
        const otherAdmins = db.users.filter((x) => x.orgId === org.id && x.role === 'admin' && x.status === 'active' && x.id !== u.id);
        if (u.role === 'admin' && role !== 'admin' && !otherAdmins.length) throw err('CONFLICT', 'There must be at least one admin.', 409);
        u.role = role;
      }
      if (firstName !== undefined) u.name = text(firstName, 'First name', { required: true, max: 60 });
      if (email !== undefined) {
        const mail = text(email, 'Email').toLowerCase();
        if (!emailOk(mail)) throw err('BAD_REQUEST', 'That email address does not look right.');
        u.email = mail;
      }
      save(db);
      return publicUser(u, org);
    },
    async resetStaffPassword(id) {
      await wait();
      const { db, org } = ctx('team.write');
      const u = db.users.find((x) => x.id === id && x.orgId === org.id && x.role !== 'client');
      if (!u) throw err('NOT_FOUND', 'That team member was not found.', 404);
      u.password = generatePassword();
      u.mustChangePassword = true;
      u.tempPasswordExpiresAt = new Date(now() + TEMP_PASSWORD_DAYS * DAY).toISOString();
      u.failedSignIns = 0;
      u.lockedUntil = null;
      save(db);
      return { credentials: { username: u.username, password: u.password } };
    },
    async disableStaff(id) {
      return setStatus(id, 'staff', 'disabled', 'team.write');
    },
    async enableStaff(id) {
      return setStatus(id, 'staff', 'active', 'team.write');
    },

    // Branding and settings --------------------------------------------------------------------------------------------------------
    /** Builder logo and name for plan title blocks. logoDataUrl: PNG or JPEG data URL (at most 400 KB) or null to remove. */
    async setBranding({ displayName, logoDataUrl } = {}) {
      await wait();
      const { db, org } = ctx('branding.write');
      const b = { displayName: text(displayName, 'Name for plans', { required: true, max: 60 }), logoDataUrl: org.branding.logoDataUrl };
      if (logoDataUrl !== undefined) {
        if (logoDataUrl !== null && !/^data:image\/(png|jpeg);base64,/.test(logoDataUrl)) throw err('BAD_REQUEST', 'The logo must be a PNG or JPG image.');
        if (logoDataUrl && logoDataUrl.length > 400_000) throw err('PAYLOAD_TOO_LARGE', 'That logo is too large. Use an image under 300 KB.', 413);
        b.logoDataUrl = logoDataUrl;
      }
      org.branding = b;
      save(db);
      return clone(b);
    },
    /** Organisation settings. allowClientTopUps (default on) lets client logins buy AI credit top-ups. */
    async setOrgSettings({ allowClientTopUps, allowClientEnquiries, showGlideToClients, allowClientCadExports } = {}) {
      await wait();
      const { db, org } = ctx('billing.write');
      if (allowClientTopUps !== undefined) org.allowClientTopUps = !!allowClientTopUps;
      if (allowClientEnquiries !== undefined) org.allowClientEnquiries = !!allowClientEnquiries;
      if (showGlideToClients !== undefined) org.showGlideToClients = !!showGlideToClients;
      if (allowClientCadExports !== undefined) org.allowClientCadExports = !!allowClientCadExports;
      save(db);
      return publicOrg(org);
    },

    /** "Send to JCE": the mock sends nothing and returns a fake reference. Same consent and field checks as the server. */
    async enquiryJce(body = {}) {
      await wait();
      const { db, org, user } = ctx();
      if (!isStaff(user) && org.allowClientEnquiries === false) throw err('FORBIDDEN', 'Your builder has turned off sending to JCE.', 403);
      if (body.consent !== true) throw err('BAD_REQUEST', 'Please tick the box to agree to your plans and details being sent to JCE Infrastructure Pty Ltd.', 400);
      for (const k of ['name', 'phone', 'email']) if (!String(body[k] || '').trim()) throw err('BAD_REQUEST', `${k} is required.`, 400);
      if (!['engineering', 'da', 'both'].includes(body.need)) throw err('BAD_REQUEST', 'need must be engineering, da or both.', 400);
      const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      const reference = `GI-${Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('')}`;
      (db.enquiries ||= []).push({ reference, createdAt: iso(), email: body.email, need: body.need });
      save(db);
      return { ok: true, reference, mock: true };
    },

    /** Test and demo helper: wipe the mock back to its sample data. Not part of the real API. */
    async _reset() {
      storage.remove(SESSION_KEY);
      save(seed ? seedDb(now()) : { version: 1, orgs: [], users: [], houses: [], projects: [], issues: [], topUps: [], resets: {} });
      return { ok: true };
    },
  };

  async function setStatus(id, kind, status, perm) {
    await wait();
    const { db, user: me, org } = ctx(perm);
    const u = db.users.find((x) => x.id === id && x.orgId === org.id && (kind === 'client' ? x.role === 'client' : x.role !== 'client'));
    if (!u) throw err('NOT_FOUND', 'That login was not found.', 404);
    if (status === 'disabled' && u.id === me.id) throw err('CONFLICT', 'You cannot disable your own login.', 409);
    if (status === 'disabled' && u.role === 'admin' && !db.users.some((x) => x.orgId === org.id && x.role === 'admin' && x.status === 'active' && x.id !== u.id)) throw err('CONFLICT', 'There must be at least one active admin.', 409);
    u.status = status;
    save(db);
    return kind === 'client' ? clientView(db, org, u) : publicUser(u, org);
  }

  return api;
}

const nextMonthKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

export { loginsInMonth };
