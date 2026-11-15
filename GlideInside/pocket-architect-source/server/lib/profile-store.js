// Storage for free user profiles (lib/profiles.js): Cloudflare D1 (tables in migrations/0015_free_profiles.sql) and an in-memory twin for tests.
// Plain camelCase objects in and out. Rate limits stay in the main store (store.hitRate). Nothing here sends email.

const PROFILE_COLS = {
  id: 'id', email: 'email', name: 'name', phone: 'phone', postcode: 'postcode', role: 'role', passwordHash: 'password_hash',
  termsVersion: 'terms_version', termsAcceptedAt: 'terms_accepted_at', marketingConsent: 'marketing_consent:b', marketingConsentAt: 'marketing_consent_at',
  marketingTextVersion: 'marketing_text_version', unsubscribed: 'unsubscribed:b', unsubscribedAt: 'unsubscribed_at', lastSignInAt: 'last_sign_in_at',
  createdAt: 'created_at', updatedAt: 'updated_at',
};
const DESIGN_COLS = {
  id: 'id', profileId: 'profile_id', projectId: 'project_id', name: 'name', address: 'address', kind: 'kind', thumbnail: 'thumbnail',
  project: 'project_json', bytes: 'bytes', createdAt: 'created_at', updatedAt: 'updated_at',
};
const colName = (c) => c.split(':')[0];
const isBool = (c) => c.endsWith(':b');

function fromRow(cols, row, { skip = [] } = {}) {
  if (!row) return null;
  const out = {};
  for (const [k, c] of Object.entries(cols)) {
    if (skip.includes(k)) continue;
    const v = row[colName(c)];
    out[k] = v === undefined ? null : isBool(c) ? !!v : v;
  }
  return out;
}
const param = (cols, k, v) => (v === undefined || v === null ? null : isBool(cols[k]) ? (v ? 1 : 0) : v);

export function createD1ProfileStore(db) {
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const first = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const changed = (r) => (r?.meta?.changes ?? 0) > 0;
  const isUnique = (e) => /UNIQUE|constraint/i.test(String(e?.message || e));
  const list = (cols, skip = []) => Object.entries(cols).filter(([k]) => !skip.includes(k)).map(([, c]) => colName(c)).join(', ');

  async function insert(table, cols, obj) {
    const keys = Object.keys(cols).filter((k) => obj[k] !== undefined);
    const res = await run(`INSERT INTO ${table} (${keys.map((k) => colName(cols[k])).join(', ')}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(', ')})`, ...keys.map((k) => param(cols, k, obj[k])));
    return changed(res);
  }
  async function update(table, cols, where, whereArgs, patch) {
    const keys = Object.keys(patch).filter((k) => cols[k] && patch[k] !== undefined);
    if (!keys.length) return false;
    const sets = keys.map((k, i) => `${colName(cols[k])} = ?${i + 1}`).join(', ');
    const res = await run(`UPDATE ${table} SET ${sets} WHERE ${where.replace(/\?(\d+)/g, (_, n) => `?${Number(n) + keys.length}`)}`, ...keys.map((k) => param(cols, k, patch[k])), ...whereArgs);
    return changed(res);
  }

  return {
    kind: 'd1',
    createProfile: (p) => insert('profiles', PROFILE_COLS, p).catch((e) => (isUnique(e) ? false : Promise.reject(e))),
    getProfile: async (id) => fromRow(PROFILE_COLS, await first(`SELECT ${list(PROFILE_COLS)} FROM profiles WHERE id = ?1`, id)),
    getProfileByEmail: async (email) => fromRow(PROFILE_COLS, await first(`SELECT ${list(PROFILE_COLS)} FROM profiles WHERE email = ?1`, email)),
    updateProfile: (id, patch) => update('profiles', PROFILE_COLS, 'id = ?1', [id], patch),
    async deleteProfile(id) {
      await run('DELETE FROM profile_designs WHERE profile_id = ?1', id);
      await run('DELETE FROM profile_sessions WHERE profile_id = ?1', id);
      await run('DELETE FROM profile_consent_events WHERE profile_id = ?1', id);
      await run('DELETE FROM profile_packs WHERE profile_id = ?1', id);
      return changed(await run('DELETE FROM profiles WHERE id = ?1', id));
    },
    async addConsentEvent(e) {
      await run('INSERT INTO profile_consent_events (id, profile_id, at, consent, text_version, text, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)', e.id, e.profileId, e.at, e.consent ? 1 : 0, e.textVersion ?? null, e.text ?? null, e.source);
    },
    async listConsentEvents(profileId) {
      return (await all('SELECT id, at, consent, text_version, text, source FROM profile_consent_events WHERE profile_id = ?1 ORDER BY at, id', profileId))
        .map((r) => ({ id: r.id, at: r.at, consent: !!r.consent, textVersion: r.text_version, text: r.text, source: r.source }));
    },
    // Sessions
    async createSession(s) {
      await run('INSERT INTO profile_sessions (id_hash, profile_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)', s.idHash, s.profileId, s.createdAt, s.lastSeenAt, s.expiresAt);
    },
    async getSession(idHash) {
      const r = await first('SELECT id_hash, profile_id, created_at, last_seen_at, expires_at FROM profile_sessions WHERE id_hash = ?1', idHash);
      return r && { idHash: r.id_hash, profileId: r.profile_id, createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at };
    },
    async touchSession(idHash, lastSeenAt, expiresAt) {
      await run('UPDATE profile_sessions SET last_seen_at = ?2, expires_at = ?3 WHERE id_hash = ?1', idHash, lastSeenAt, expiresAt);
    },
    async deleteSession(idHash) {
      await run('DELETE FROM profile_sessions WHERE id_hash = ?1', idHash);
    },
    async deleteProfileSessions(profileId, exceptHash = '') {
      await run('DELETE FROM profile_sessions WHERE profile_id = ?1 AND id_hash <> ?2', profileId, exceptHash);
    },
    async purgeSessions(nowIso) {
      await run('DELETE FROM profile_sessions WHERE expires_at <= ?1', nowIso);
    },
    // Designs (the list leaves out the project JSON)
    countDesigns: async (profileId) => Number((await first('SELECT COUNT(*) AS n FROM profile_designs WHERE profile_id = ?1', profileId))?.n ?? 0),
    listDesigns: async (profileId) => (await all(`SELECT ${list(DESIGN_COLS, ['project'])} FROM profile_designs WHERE profile_id = ?1 ORDER BY updated_at DESC, id`, profileId)).map((r) => fromRow(DESIGN_COLS, r, { skip: ['project'] })),
    getDesign: async (profileId, id) => fromRow(DESIGN_COLS, await first(`SELECT ${list(DESIGN_COLS)} FROM profile_designs WHERE id = ?1 AND profile_id = ?2`, id, profileId)),
    getDesignByProject: async (profileId, projectId) => fromRow(DESIGN_COLS, await first(`SELECT ${list(DESIGN_COLS)} FROM profile_designs WHERE profile_id = ?1 AND project_id = ?2`, profileId, projectId)),
    createDesign: (d) => insert('profile_designs', DESIGN_COLS, d).catch((e) => (isUnique(e) ? false : Promise.reject(e))),
    updateDesign: (profileId, id, patch) => update('profile_designs', DESIGN_COLS, 'id = ?1 AND profile_id = ?2', [id, profileId], { ...patch, id: undefined, profileId: undefined }),
    async deleteDesign(profileId, id) {
      return changed(await run('DELETE FROM profile_designs WHERE id = ?1 AND profile_id = ?2', id, profileId));
    },
    // Plan Packs linked to a profile
    async linkPack(p) {
      await run('INSERT OR IGNORE INTO profile_packs (profile_id, entitlement_id, project_id, linked_at) VALUES (?1, ?2, ?3, ?4)', p.profileId, p.entitlementId, p.projectId, p.linkedAt);
    },
    async listPacks(profileId) {
      return (await all('SELECT entitlement_id, project_id, linked_at FROM profile_packs WHERE profile_id = ?1 ORDER BY linked_at', profileId)).map((r) => ({ entitlementId: r.entitlement_id, projectId: r.project_id, linkedAt: r.linked_at }));
    },
    // Owner contact list: every profile with its design counts (no password hash).
    async listContacts() {
      const rows = await all(`SELECT ${list(PROFILE_COLS, ['passwordHash'])},
        (SELECT COUNT(*) FROM profile_designs d WHERE d.profile_id = profiles.id) AS designs,
        (SELECT COUNT(*) FROM profile_designs d WHERE d.profile_id = profiles.id AND d.kind = 'residential') AS residential_designs,
        (SELECT COUNT(*) FROM profile_designs d WHERE d.profile_id = profiles.id AND d.kind = 'commercial') AS commercial_designs
        FROM profiles ORDER BY created_at DESC, id LIMIT 20000`);
      return rows.map((r) => ({ ...fromRow(PROFILE_COLS, r, { skip: ['passwordHash'] }), designs: Number(r.designs), residentialDesigns: Number(r.residential_designs), commercialDesigns: Number(r.commercial_designs) }));
    },
  };
}

// In memory (tests, development) ----------------------------------------------------------------------------------------
export function createMemoryProfileStore() {
  const T = { profiles: new Map(), sessions: new Map(), consent: [], designs: new Map(), packs: [] };
  const cp = (o) => (o == null ? null : structuredClone(o));
  const noJson = (d) => {
    const c = cp(d);
    delete c.project;
    return c;
  };
  return {
    kind: 'memory',
    _tables: T,
    async createProfile(p) {
      if ([...T.profiles.values()].some((x) => x.email === p.email) || T.profiles.has(p.id)) return false;
      T.profiles.set(p.id, { phone: null, postcode: null, role: null, marketingConsent: false, marketingConsentAt: null, marketingTextVersion: null, unsubscribed: false, unsubscribedAt: null, lastSignInAt: null, ...cp(p) });
      return true;
    },
    getProfile: async (id) => cp(T.profiles.get(id)),
    getProfileByEmail: async (email) => cp([...T.profiles.values()].find((x) => x.email === email)),
    async updateProfile(id, patch) {
      const p = T.profiles.get(id);
      if (!p) return false;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) p[k] = cp(v);
      return true;
    },
    async deleteProfile(id) {
      for (const [k, d] of T.designs) if (d.profileId === id) T.designs.delete(k);
      for (const [h, s] of T.sessions) if (s.profileId === id) T.sessions.delete(h);
      T.consent = T.consent.filter((e) => e.profileId !== id);
      T.packs = T.packs.filter((p) => p.profileId !== id);
      return T.profiles.delete(id);
    },
    async addConsentEvent(e) {
      T.consent.push(cp({ ...e, consent: !!e.consent }));
    },
    listConsentEvents: async (profileId) => T.consent.filter((e) => e.profileId === profileId).map((e) => ({ id: e.id, at: e.at, consent: e.consent, textVersion: e.textVersion ?? null, text: e.text ?? null, source: e.source })),
    createSession: async (s) => void T.sessions.set(s.idHash, cp(s)),
    getSession: async (h) => cp(T.sessions.get(h)),
    async touchSession(h, lastSeenAt, expiresAt) {
      const s = T.sessions.get(h);
      if (s) Object.assign(s, { lastSeenAt, expiresAt });
    },
    deleteSession: async (h) => void T.sessions.delete(h),
    async deleteProfileSessions(profileId, except = '') {
      for (const [h, s] of T.sessions) if (s.profileId === profileId && h !== except) T.sessions.delete(h);
    },
    async purgeSessions(nowIso) {
      for (const [h, s] of T.sessions) if (s.expiresAt <= nowIso) T.sessions.delete(h);
    },
    countDesigns: async (profileId) => [...T.designs.values()].filter((d) => d.profileId === profileId).length,
    listDesigns: async (profileId) => [...T.designs.values()].filter((d) => d.profileId === profileId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1)).map(noJson),
    getDesign: async (profileId, id) => (T.designs.get(id)?.profileId === profileId ? cp(T.designs.get(id)) : null),
    getDesignByProject: async (profileId, projectId) => cp([...T.designs.values()].find((d) => d.profileId === profileId && d.projectId === projectId)),
    async createDesign(d) {
      if (T.designs.has(d.id) || [...T.designs.values()].some((x) => x.profileId === d.profileId && x.projectId === d.projectId)) return false;
      T.designs.set(d.id, { address: null, thumbnail: null, ...cp(d) });
      return true;
    },
    async updateDesign(profileId, id, patch) {
      const d = T.designs.get(id);
      if (!d || d.profileId !== profileId) return false;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && k !== 'id' && k !== 'profileId') d[k] = cp(v);
      return true;
    },
    async deleteDesign(profileId, id) {
      return T.designs.get(id)?.profileId === profileId ? T.designs.delete(id) : false;
    },
    async linkPack(p) {
      if (!T.packs.some((x) => x.profileId === p.profileId && x.entitlementId === p.entitlementId)) T.packs.push(cp(p));
    },
    listPacks: async (profileId) => T.packs.filter((p) => p.profileId === profileId).map((p) => ({ entitlementId: p.entitlementId, projectId: p.projectId, linkedAt: p.linkedAt })),
    async listContacts() {
      return [...T.profiles.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((p) => {
        const mine = [...T.designs.values()].filter((d) => d.profileId === p.id);
        const { passwordHash, ...rest } = cp(p);
        void passwordHash;
        return { ...rest, designs: mine.length, residentialDesigns: mine.filter((d) => d.kind === 'residential').length, commercialDesigns: mine.filter((d) => d.kind === 'commercial').length };
      });
    },
  };
}
