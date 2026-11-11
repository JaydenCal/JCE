// Storage for the builder and client portal: Cloudflare D1 (tables in server/schema.sql) and an in-memory twin for tests.
// Plain camelCase objects in and out. Every lookup that can touch another organisation's data takes the orgId, so tenant
// isolation is enforced here as well as in portal.js. Credits, rate limits and the event log stay in the main store (store.js).
//
// Column spec "name:b" is a boolean (0/1), "name:j" is JSON text, anything else is stored as is.

const SPECS = {
  orgs: {
    table: 'orgs',
    cols: {
      id: 'id', name: 'name', shortCode: 'short_code', displayName: 'display_name', logoDataUrl: 'logo_data_url',
      allowClientTopUps: 'allow_client_topups:b', allowClientEnquiries: 'allow_client_enquiries:b', showGlideToClients: 'show_glide_to_clients:b',
      allowClientCadExports: 'allow_client_cad_exports:b', aiMonthlyCap: 'ai_monthly_cap', legalName: 'legal_name', abn: 'abn',
      billingName: 'billing_name', billingEmail: 'billing_email', billingPhone: 'billing_phone', stripeCustomerId: 'stripe_customer_id', createdAt: 'created_at',
      customLoginCents: 'custom_login_cents', // nullable: the owner's per-login price for this org (migration 0008)
    },
  },
  users: {
    table: 'users',
    cols: {
      id: 'id', orgId: 'org_id', role: 'role', name: 'name', email: 'email', username: 'username', passwordHash: 'password_hash',
      mustChangePassword: 'must_change_password:b', tempPasswordExpiresAt: 'temp_password_expires_at', status: 'status', lotAddress: 'lot_address',
      houseAccess: 'house_access:j', firstSignInAt: 'first_sign_in_at', lastSignInAt: 'last_sign_in_at', createdAt: 'created_at',
    },
  },
  houses: {
    table: 'houses',
    cols: {
      id: 'id', orgId: 'org_id', name: 'name', description: 'description', sourceType: 'source_type', sourceRef: 'source_ref', stats: 'stats_json:j',
      thumbnail: 'thumbnail', project: 'project_json:j', archived: 'archived:b', createdBy: 'created_by', createdAt: 'created_at', updatedAt: 'updated_at',
    },
  },
  projects: {
    table: 'portal_projects',
    cols: {
      id: 'id', orgId: 'org_id', ownerId: 'owner_id', name: 'name', lotAddress: 'lot_address', houseNames: 'house_names:j', project: 'project_json:j',
      createdAt: 'created_at', updatedAt: 'updated_at',
    },
  },
  invoices: {
    table: 'invoices',
    cols: {
      id: 'id', orgId: 'org_id', month: 'month', number: 'number', issuedAt: 'issued_at', dueAt: 'due_at', loginsCount: 'logins_count', topUpsCount: 'topups_count',
      totalCents: 'total_cents', status: 'status', stripeInvoiceId: 'stripe_invoice_id', stripeStep: 'stripe_step', stripeHostedUrl: 'stripe_hosted_url',
      error: 'error', snapshot: 'snapshot_json:j',
    },
  },
  // Trial and billing state of an org. One row per org created through the trial flow (no row = a legacy active org). Merged into the
  // org object by getOrg and listOrgs, so the rest of the code reads org.status, org.trialEndsAt and so on.
  orgAccounts: {
    table: 'org_accounts',
    cols: {
      orgId: 'org_id', status: 'status', trialStartedAt: 'trial_started_at', trialEndsAt: 'trial_ends_at', trialExtendedDays: 'trial_extended_days',
      requestId: 'request_id', convertedAt: 'converted_at', convertedHow: 'converted_how', paymentMethodId: 'payment_method_id', cardBrand: 'card_brand',
      cardLast4: 'card_last4', cardAddedAt: 'card_added_at', ownerNote: 'owner_note',
    },
  },
  trialRequests: {
    table: 'trial_requests',
    cols: {
      id: 'id', createdAt: 'created_at', status: 'status', companyLegalName: 'company_legal_name', abn: 'abn', tradingName: 'trading_name',
      firstName: 'first_name', lastName: 'last_name', email: 'email', mobile: 'mobile', region: 'region', homesPerYear: 'homes_per_year',
      howHeard: 'how_heard', consentAt: 'consent_at', termsVersion: 'terms_version', ipHash: 'ip_hash', notifyStatus: 'notify_status',
      decidedAt: 'decided_at', decisionNote: 'decision_note', orgId: 'org_id',
    },
  },
  loginIssues: {
    table: 'login_issues',
    cols: { loginId: 'login_id', id: 'id', orgId: 'org_id', clientName: 'client_name', issuedAt: 'issued_at', month: 'month', amountCents: 'amount_cents' },
  },
};

const ACCOUNT_KEYS = Object.keys(SPECS.orgAccounts.cols).filter((k) => k !== 'orgId');
const withAccount = (org, acct) => (org ? { ...org, ...Object.fromEntries(ACCOUNT_KEYS.map((k) => [k, acct?.[k] ?? null])), status: acct?.status || 'active' } : null);
const splitOrgPatch = (patch) => {
  const org = {};
  const acct = {};
  for (const [k, v] of Object.entries(patch)) (ACCOUNT_KEYS.includes(k) ? acct : org)[k] = v;
  return { org, acct };
};

const colName = (c) => c.split(':')[0];
const colType = (c) => c.split(':')[1];

function fromRow(spec, row) {
  if (!row) return null;
  const out = {};
  for (const [key, c] of Object.entries(spec.cols)) {
    const v = row[colName(c)];
    const t = colType(c);
    out[key] = v === undefined ? null : t === 'b' ? !!v : t === 'j' ? (v == null ? null : JSON.parse(v)) : v;
  }
  return out;
}

function toParams(spec, obj, keys) {
  return keys.map((k) => {
    const c = spec.cols[k];
    const v = obj[k];
    const t = colType(c);
    if (v === undefined || v === null) return null;
    return t === 'b' ? (v ? 1 : 0) : t === 'j' ? JSON.stringify(v) : v;
  });
}

const isUnique = (e) => /UNIQUE|constraint/i.test(String(e?.message || e));
const LIST_COLS = (spec, omit = []) => Object.entries(spec.cols).filter(([k]) => !omit.includes(k)).map(([, c]) => colName(c)).join(', ');

// D1 --------------------------------------------------------------------------------------------------------------------
export function createD1PortalStore(db) {
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const first = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const changed = (r) => (r?.meta?.changes ?? 0) > 0;

  async function insert(spec, obj, { ignore = false } = {}) {
    const keys = Object.keys(spec.cols).filter((k) => obj[k] !== undefined);
    const cols = keys.map((k) => colName(spec.cols[k]));
    const res = await run(`INSERT ${ignore ? 'OR IGNORE ' : ''}INTO ${spec.table} (${cols.join(', ')}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(', ')})`, ...toParams(spec, obj, keys));
    return changed(res);
  }
  async function update(spec, where, whereArgs, patch) {
    const keys = Object.keys(patch).filter((k) => spec.cols[k] && patch[k] !== undefined);
    if (!keys.length) return false;
    const sets = keys.map((k, i) => `${colName(spec.cols[k])} = ?${i + 1}`).join(', ');
    const res = await run(`UPDATE ${spec.table} SET ${sets} WHERE ${where.replace(/\?(\d+)/g, (_, n) => `?${Number(n) + keys.length}`)}`, ...toParams(spec, patch, keys), ...whereArgs);
    return changed(res);
  }
  const one = async (spec, where, ...a) => fromRow(spec, await first(`SELECT ${LIST_COLS(spec)} FROM ${spec.table} WHERE ${where}`, ...a));
  const many = async (spec, where, args, order = '', omit = []) => (await all(`SELECT ${LIST_COLS(spec, omit)} FROM ${spec.table} WHERE ${where} ${order}`, ...args)).map((r) => fromRow({ cols: Object.fromEntries(Object.entries(spec.cols).filter(([k]) => !omit.includes(k))) }, r));

  return {
    kind: 'd1',
    // Organisations
    createOrg: (o) => insert(SPECS.orgs, o).catch((e) => (isUnique(e) ? false : Promise.reject(e))),
    getOrg: async (id) => withAccount(await one(SPECS.orgs, 'id = ?1', id), await one(SPECS.orgAccounts, 'org_id = ?1', id)),
    getOrgByShortCode: async (code) => {
      const o = await one(SPECS.orgs, 'short_code = ?1', code);
      return o && withAccount(o, await one(SPECS.orgAccounts, 'org_id = ?1', o.id));
    },
    async listOrgs() {
      const accts = new Map((await many(SPECS.orgAccounts, '1 = 1', [])).map((a) => [a.orgId, a]));
      return (await many(SPECS.orgs, '1 = 1', [], 'ORDER BY created_at, id')).map((o) => withAccount(o, accts.get(o.id)));
    },
    async updateOrg(id, patch) {
      const { org, acct } = splitOrgPatch(patch);
      let done = Object.keys(org).length ? await update(SPECS.orgs, 'id = ?1', [id], org) : true;
      if (Object.keys(acct).length) done = (await this.saveOrgAccount(id, acct)) && done;
      return done;
    },
    /** Insert or update the org_accounts row (the trial and card state). */
    async saveOrgAccount(orgId, patch) {
      if (await first('SELECT 1 AS x FROM org_accounts WHERE org_id = ?1', orgId)) return update(SPECS.orgAccounts, 'org_id = ?1', [orgId], patch);
      return insert(SPECS.orgAccounts, { status: 'active', ...patch, orgId });
    },
    // Trial requests
    createTrialRequest: (r) => insert(SPECS.trialRequests, r),
    getTrialRequest: (id) => one(SPECS.trialRequests, 'id = ?1', id),
    listTrialRequests: (status = null) => (status ? many(SPECS.trialRequests, 'status = ?1', [status], 'ORDER BY created_at DESC, id') : many(SPECS.trialRequests, '1 = 1', [], 'ORDER BY created_at DESC, id')),
    updateTrialRequest: (id, patch) => update(SPECS.trialRequests, 'id = ?1', [id], patch),
    findOpenTrialRequestByAbn: (abn) => one(SPECS.trialRequests, "abn = ?1 AND status IN ('pending','approved')", abn),
    /** Atomic claim: pending -> approved. False when another request already decided it (a double click). */
    async claimTrialRequest(id, patch) {
      const keys = Object.keys(patch);
      const sets = keys.map((k, i) => `${colName(SPECS.trialRequests.cols[k])} = ?${i + 2}`).join(', ');
      const res = await run(`UPDATE trial_requests SET status = 'deciding', ${sets} WHERE id = ?1 AND status = 'pending'`, id, ...toParams(SPECS.trialRequests, patch, keys));
      return changed(res);
    },
    // Users
    createUser: (u) => insert(SPECS.users, u).catch((e) => (isUnique(e) ? false : Promise.reject(e))),
    getUser: (id) => one(SPECS.users, 'id = ?1', id),
    findUserByLogin: (login) => one(SPECS.users, 'username = ?1 OR email = ?1', login),
    usernameExists: async (username) => !!(await first('SELECT 1 AS x FROM users WHERE username = ?1', username)),
    emailExists: async (email, exceptId = '') => !!(await first('SELECT 1 AS x FROM users WHERE email = ?1 AND id <> ?2', email, exceptId)),
    listUsers: (orgId, staff) => many(SPECS.users, `org_id = ?1 AND ${staff ? "role <> 'client'" : "role = 'client'"}`, [orgId], 'ORDER BY created_at DESC, id'),
    countActiveAdmins: async (orgId, exceptId = '') => Number((await first("SELECT COUNT(*) AS n FROM users WHERE org_id = ?1 AND role = 'admin' AND status = 'active' AND id <> ?2", orgId, exceptId))?.n ?? 0),
    updateUser: (id, patch) => update(SPECS.users, 'id = ?1', [id], patch),
    async deleteUser(orgId, id) {
      const n = Number((await first('SELECT COUNT(*) AS n FROM portal_projects WHERE owner_id = ?1 AND org_id = ?2', id, orgId))?.n ?? 0);
      await run('DELETE FROM portal_projects WHERE owner_id = ?1 AND org_id = ?2', id, orgId);
      await run('DELETE FROM sessions WHERE user_id = ?1', id);
      await run('DELETE FROM users WHERE id = ?1 AND org_id = ?2', id, orgId);
      return { removedProjects: n };
    },
    countProjectsByOwner: async (orgId) => Object.fromEntries((await all('SELECT owner_id AS o, COUNT(*) AS n FROM portal_projects WHERE org_id = ?1 GROUP BY owner_id', orgId)).map((r) => [r.o, Number(r.n)])),
    // Sessions
    async createSession(s) {
      await run('INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)', s.idHash, s.userId, s.createdAt, s.lastSeenAt, s.expiresAt);
    },
    async getSession(idHash) {
      const r = await first('SELECT id_hash, user_id, created_at, last_seen_at, expires_at FROM sessions WHERE id_hash = ?1', idHash);
      return r && { idHash: r.id_hash, userId: r.user_id, createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at };
    },
    async touchSession(idHash, lastSeenAt, expiresAt) {
      await run('UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE id_hash = ?1', idHash, lastSeenAt, expiresAt);
    },
    async deleteSession(idHash) {
      await run('DELETE FROM sessions WHERE id_hash = ?1', idHash);
    },
    async deleteUserSessions(userId, exceptHash = '') {
      await run('DELETE FROM sessions WHERE user_id = ?1 AND id_hash <> ?2', userId, exceptHash);
    },
    async purgeSessions(nowIso) {
      await run('DELETE FROM sessions WHERE expires_at <= ?1', nowIso);
    },
    // Lockout counters. addFailure counts a failure in the current window and locks once `max` is reached.
    async getFailure(key) {
      const r = await first('SELECT count, window_start, locked_until FROM auth_failures WHERE key = ?1', key);
      return r && { count: Number(r.count), windowStart: Number(r.window_start), lockedUntil: r.locked_until == null ? null : Number(r.locked_until) };
    },
    async addFailure(key, nowMs, { windowMs, max, lockMs }) {
      const row = await first(
        `INSERT INTO auth_failures (key, count, window_start, locked_until) VALUES (?1, 1, ?2, NULL)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN ?2 - auth_failures.window_start >= ?3 THEN 1 ELSE auth_failures.count + 1 END,
           window_start = CASE WHEN ?2 - auth_failures.window_start >= ?3 THEN ?2 ELSE auth_failures.window_start END
         RETURNING count`,
        key, nowMs, windowMs,
      );
      const count = Number(row?.count ?? 1);
      let lockedUntil = null;
      if (count >= max) {
        lockedUntil = nowMs + lockMs;
        await run('UPDATE auth_failures SET locked_until = ?2, count = 0, window_start = ?3 WHERE key = ?1', key, lockedUntil, nowMs);
      }
      return { count, lockedUntil };
    },
    async clearFailure(key) {
      await run('DELETE FROM auth_failures WHERE key = ?1', key);
    },
    // Houses and projects
    saveHouse: async (h) => {
      const exists = await first('SELECT 1 AS x FROM houses WHERE id = ?1 AND org_id = ?2', h.id, h.orgId);
      if (exists) return update(SPECS.houses, 'id = ?1 AND org_id = ?2', [h.id, h.orgId], { ...h, id: undefined, orgId: undefined });
      return insert(SPECS.houses, h);
    },
    getHouse: (orgId, id) => one(SPECS.houses, 'id = ?1 AND org_id = ?2', id, orgId),
    listHouses: (orgId) => many(SPECS.houses, 'org_id = ?1', [orgId], 'ORDER BY name COLLATE NOCASE', ['project']),
    async saveProject(p) {
      const exists = await first('SELECT 1 AS x FROM portal_projects WHERE id = ?1 AND org_id = ?2', p.id, p.orgId);
      if (exists) return update(SPECS.projects, 'id = ?1 AND org_id = ?2', [p.id, p.orgId], { ...p, id: undefined, orgId: undefined, ownerId: undefined, createdAt: undefined });
      return insert(SPECS.projects, p);
    },
    getProject: (orgId, id) => one(SPECS.projects, 'id = ?1 AND org_id = ?2', id, orgId),
    listProjects: (orgId, ownerId = null) => many(SPECS.projects, ownerId ? 'org_id = ?1 AND owner_id = ?2' : 'org_id = ?1', ownerId ? [orgId, ownerId] : [orgId], 'ORDER BY updated_at DESC, id', ['project']),
    // Billing
    addLoginIssue: (row) => insert(SPECS.loginIssues, row, { ignore: true }),
    getLoginIssue: (loginId) => one(SPECS.loginIssues, 'login_id = ?1', loginId),
    updateLoginIssue: (loginId, patch) => update(SPECS.loginIssues, 'login_id = ?1', [loginId], patch),
    listLoginIssues: (orgId) => many(SPECS.loginIssues, 'org_id = ?1', [orgId], 'ORDER BY issued_at, id'),
    insertInvoice: (inv) => insert(SPECS.invoices, inv).catch((e) => (isUnique(e) ? false : Promise.reject(e))),
    getInvoice: (orgId, id) => one(SPECS.invoices, 'id = ?1 AND org_id = ?2', id, orgId),
    getInvoiceByMonth: (orgId, month) => one(SPECS.invoices, 'org_id = ?1 AND month = ?2', orgId, month),
    updateInvoice: (id, patch) => update(SPECS.invoices, 'id = ?1', [id], patch),
    listInvoices: (orgId) => many(SPECS.invoices, 'org_id = ?1', [orgId], 'ORDER BY month DESC'),
    async getSetting(key) {
      return (await first('SELECT value FROM portal_settings WHERE key = ?1', key))?.value ?? null;
    },
    async setSetting(key, value) {
      await run('INSERT INTO portal_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2', key, value);
    },
  };
}

// In memory (tests, development) -------------------------------------------------------------------------------------------
export function createMemoryPortalStore() {
  const T = { trialRequests: new Map(), orgs: new Map(), users: new Map(), sessions: new Map(), houses: new Map(), projects: new Map(), invoices: new Map(), loginIssues: new Map(), failures: new Map(), settings: new Map() };
  const cp = (o) => (o == null ? null : structuredClone(o));
  const omit = (o, keys) => {
    const c = cp(o);
    for (const k of keys) delete c[k];
    return c;
  };
  const patchOf = (obj, patch) => {
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) obj[k] = cp(v);
  };

  return {
    kind: 'memory',
    _tables: T,
    async createOrg(o) {
      if (T.orgs.has(o.id) || (o.shortCode && [...T.orgs.values()].some((x) => x.shortCode === o.shortCode))) return false;
      T.orgs.set(o.id, cp(o));
      return true;
    },
    getOrg: async (id) => (T.orgs.has(id) ? { ...cp(T.orgs.get(id)), status: T.orgs.get(id).status || 'active' } : null),
    getOrgByShortCode: async (code) => {
      const o = [...T.orgs.values()].find((x) => x.shortCode === code);
      return o ? { ...cp(o), status: o.status || 'active' } : null;
    },
    listOrgs: async () => [...T.orgs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((o) => ({ ...cp(o), status: o.status || 'active' })),
    async updateOrg(id, patch) {
      const o = T.orgs.get(id);
      if (!o) return false;
      patchOf(o, patch);
      return true;
    },
    saveOrgAccount(orgId, patch) {
      return this.updateOrg(orgId, patch);
    },
    async createTrialRequest(r) {
      T.trialRequests.set(r.id, cp(r));
      return true;
    },
    getTrialRequest: async (id) => cp(T.trialRequests.get(id)),
    listTrialRequests: async (status = null) => [...T.trialRequests.values()].filter((r) => !status || r.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(cp),
    async updateTrialRequest(id, patch) {
      const r = T.trialRequests.get(id);
      if (!r) return false;
      patchOf(r, patch);
      return true;
    },
    findOpenTrialRequestByAbn: async (abn) => cp([...T.trialRequests.values()].find((r) => r.abn === abn && ['pending', 'approved'].includes(r.status))),
    async claimTrialRequest(id, patch) {
      const r = T.trialRequests.get(id);
      if (!r || r.status !== 'pending') return false;
      patchOf(r, { ...patch, status: 'deciding' });
      return true;
    },
    async createUser(u) {
      const email = u.email ? u.email.toLowerCase() : null;
      if (T.users.has(u.id) || [...T.users.values()].some((x) => x.username === u.username || (email && x.email === email))) return false;
      T.users.set(u.id, { ...cp(u), email });
      return true;
    },
    getUser: async (id) => cp(T.users.get(id)),
    findUserByLogin: async (login) => cp([...T.users.values()].find((u) => u.username === login || (u.email && u.email === login))),
    usernameExists: async (username) => [...T.users.values()].some((u) => u.username === username),
    emailExists: async (email, exceptId = '') => [...T.users.values()].some((u) => u.email === email && u.id !== exceptId),
    listUsers: async (orgId, staff) => [...T.users.values()].filter((u) => u.orgId === orgId && (staff ? u.role !== 'client' : u.role === 'client')).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(cp),
    countActiveAdmins: async (orgId, exceptId = '') => [...T.users.values()].filter((u) => u.orgId === orgId && u.role === 'admin' && u.status === 'active' && u.id !== exceptId).length,
    async updateUser(id, patch) {
      const u = T.users.get(id);
      if (!u) return false;
      patchOf(u, patch);
      return true;
    },
    async deleteUser(orgId, id) {
      const u = T.users.get(id);
      let n = 0;
      if (u && u.orgId === orgId) {
        for (const [pid, p] of T.projects) if (p.ownerId === id && p.orgId === orgId) (T.projects.delete(pid), (n += 1));
        for (const [h, s] of T.sessions) if (s.userId === id) T.sessions.delete(h);
        T.users.delete(id);
      }
      return { removedProjects: n };
    },
    countProjectsByOwner: async (orgId) => {
      const out = {};
      for (const p of T.projects.values()) if (p.orgId === orgId) out[p.ownerId] = (out[p.ownerId] || 0) + 1;
      return out;
    },
    createSession: async (s) => void T.sessions.set(s.idHash, cp(s)),
    getSession: async (h) => cp(T.sessions.get(h)),
    async touchSession(h, lastSeenAt, expiresAt) {
      const s = T.sessions.get(h);
      if (s) Object.assign(s, { lastSeenAt, expiresAt });
    },
    deleteSession: async (h) => void T.sessions.delete(h),
    async deleteUserSessions(userId, except = '') {
      for (const [h, s] of T.sessions) if (s.userId === userId && h !== except) T.sessions.delete(h);
    },
    async purgeSessions(nowIso) {
      for (const [h, s] of T.sessions) if (s.expiresAt <= nowIso) T.sessions.delete(h);
    },
    getFailure: async (key) => cp(T.failures.get(key)),
    async addFailure(key, nowMs, { windowMs, max, lockMs }) {
      let f = T.failures.get(key);
      if (!f || nowMs - f.windowStart >= windowMs) f = { count: 0, windowStart: nowMs, lockedUntil: f?.lockedUntil ?? null };
      f.count += 1;
      let lockedUntil = null;
      const count = f.count;
      if (count >= max) {
        lockedUntil = nowMs + lockMs;
        f = { count: 0, windowStart: nowMs, lockedUntil };
      }
      T.failures.set(key, f);
      return { count, lockedUntil };
    },
    clearFailure: async (key) => void T.failures.delete(key),
    async saveHouse(h) {
      const cur = T.houses.get(h.id);
      if (cur && cur.orgId !== h.orgId) return false;
      if (cur) patchOf(cur, { ...h, id: undefined, orgId: undefined });
      else T.houses.set(h.id, cp(h));
      return true;
    },
    getHouse: async (orgId, id) => {
      const h = T.houses.get(id);
      return h && h.orgId === orgId ? cp(h) : null;
    },
    listHouses: async (orgId) => [...T.houses.values()].filter((h) => h.orgId === orgId).sort((a, b) => a.name.localeCompare(b.name)).map((h) => ({ ...omit(h, ['project']), project: undefined })),
    async saveProject(p) {
      const cur = T.projects.get(p.id);
      if (cur && cur.orgId !== p.orgId) return false;
      if (cur) patchOf(cur, { ...p, id: undefined, orgId: undefined, ownerId: undefined, createdAt: undefined });
      else T.projects.set(p.id, cp(p));
      return true;
    },
    getProject: async (orgId, id) => {
      const p = T.projects.get(id);
      return p && p.orgId === orgId ? cp(p) : null;
    },
    listProjects: async (orgId, ownerId = null) => [...T.projects.values()].filter((p) => p.orgId === orgId && (!ownerId || p.ownerId === ownerId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map((p) => ({ ...omit(p, ['project']), project: undefined })),
    async addLoginIssue(row) {
      if (T.loginIssues.has(row.loginId)) return false;
      T.loginIssues.set(row.loginId, cp(row));
      return true;
    },
    getLoginIssue: async (loginId) => cp(T.loginIssues.get(loginId)),
    async updateLoginIssue(loginId, patch) {
      const r = T.loginIssues.get(loginId);
      if (!r) return false;
      Object.assign(r, patch);
      return true;
    },
    listLoginIssues: async (orgId) => [...T.loginIssues.values()].filter((r) => r.orgId === orgId).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)).map(cp),
    async insertInvoice(inv) {
      if (T.invoices.has(inv.id) || [...T.invoices.values()].some((x) => (x.orgId === inv.orgId && x.month === inv.month) || x.number === inv.number)) return false;
      T.invoices.set(inv.id, cp(inv));
      return true;
    },
    getInvoice: async (orgId, id) => {
      const i = T.invoices.get(id);
      return i && i.orgId === orgId ? cp(i) : null;
    },
    getInvoiceByMonth: async (orgId, month) => cp([...T.invoices.values()].find((i) => i.orgId === orgId && i.month === month)),
    async updateInvoice(id, patch) {
      const i = T.invoices.get(id);
      if (!i) return false;
      patchOf(i, patch);
      return true;
    },
    listInvoices: async (orgId) => [...T.invoices.values()].filter((i) => i.orgId === orgId).sort((a, b) => b.month.localeCompare(a.month)).map(cp),
    getSetting: async (k) => T.settings.get(k) ?? null,
    setSetting: async (k, v) => void T.settings.set(k, v),
  };
}
