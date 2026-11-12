// Store interface with two implementations: Cloudflare D1 (prepared statements against server/schema.sql)
// and an in-memory one for tests. Every method is async. Credits are reserved before the model call and
// settled after it; each of those is one guarded write, so parallel requests cannot overspend.
//
// Entitlement object: { id, projectId, email, stripeSessionId, stripePaymentIntent, amountCents, currency,
//   creditsTotal, creditsUsed, creditsReserved, pdfUsed, pdfAllowed, pdfFile, status, createdAt, expiresAt }
//
// D1 SHAPE: the entitlements table is the one the live Worker created on 15/10/2026 (column payment_intent, pdf_used, pdf_allowed,
// pdf_file), plus credits_reserved added by migrations/0006_release.sql. The Stripe payment intent therefore lives in payment_intent.
// The projects table is the live Save and share table (the builder portal's projects are in portal_projects).

const toEnt = (r) =>
  r && {
    id: r.id,
    projectId: r.project_id,
    email: r.email ?? null,
    stripeSessionId: r.stripe_session_id ?? null,
    stripePaymentIntent: r.payment_intent ?? null,
    amountCents: r.amount_cents ?? null,
    currency: r.currency ?? null,
    creditsTotal: r.credits_total,
    creditsUsed: r.credits_used,
    creditsReserved: r.credits_reserved ?? 0,
    pdfUsed: r.pdf_used ?? 0,
    pdfAllowed: r.pdf_allowed ?? 1,
    pdfFile: r.pdf_file ?? null,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? null,
  };

// D1 --------------------------------------------------------------------------------------------
export function createD1Store(db) {
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const first = (sql, ...args) => db.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
  const changed = (res) => (res?.meta?.changes ?? 0) > 0;

  return {
    kind: 'd1',

    async createEntitlement(e) {
      const res = await run(
        `INSERT OR IGNORE INTO entitlements (id, project_id, email, stripe_session_id, payment_intent, amount_cents, currency,
           credits_total, credits_used, credits_reserved, pdf_used, pdf_allowed, status, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, 0, ?12, ?9, ?10, ?11)`,
        e.id, e.projectId, e.email ?? null, e.stripeSessionId ?? null, e.stripePaymentIntent ?? null, e.amountCents ?? null,
        e.currency ?? null, e.creditsTotal, e.status || 'active', e.createdAt, e.expiresAt ?? null, e.pdfAllowed ?? 1,
      );
      if (changed(res)) return { entitlement: await this.getEntitlement(e.id), created: true };
      return { entitlement: e.stripeSessionId ? await this.getEntitlementBySession(e.stripeSessionId) : null, created: false };
    },
    async getEntitlement(id) {
      return toEnt(await first('SELECT * FROM entitlements WHERE id = ?1', id));
    },
    async getEntitlementBySession(sessionId) {
      return toEnt(await first('SELECT * FROM entitlements WHERE stripe_session_id = ?1', sessionId));
    },
    async getEntitlementByPaymentIntent(pi) {
      return toEnt(await first('SELECT * FROM entitlements WHERE payment_intent = ?1 ORDER BY created_at DESC LIMIT 1', pi));
    },
    async findForRestore(email, ref) {
      return toEnt(
        await first(
          `SELECT * FROM entitlements WHERE lower(email) = lower(?1)
             AND (stripe_session_id = ?2 OR payment_intent = ?2 OR id = ?2)
           ORDER BY created_at DESC LIMIT 1`,
          email, ref,
        ),
      );
    },
    async setEntitlementStatus(id, status) {
      return changed(await run('UPDATE entitlements SET status = ?2 WHERE id = ?1', id, status));
    },
    async setEntitlementExpiry(id, expiresAt) {
      return changed(await run('UPDATE entitlements SET expires_at = ?2 WHERE id = ?1', id, expiresAt));
    },
    // Dispute closed in our favour: the pack is active again, but only if it was held for the dispute.
    async setEntitlementStatusIf(id, from, to) {
      return changed(await run('UPDATE entitlements SET status = ?3 WHERE id = ?1 AND status = ?2', id, from, to));
    },
    async setStatusByPaymentIntent(pi, to, onlyFrom = null) {
      return changed(
        onlyFrom
          ? await run('UPDATE entitlements SET status = ?2 WHERE payment_intent = ?1 AND status = ?3', pi, to, onlyFrom)
          : await run('UPDATE entitlements SET status = ?2 WHERE payment_intent = ?1', pi, to),
      );
    },
    // Friends and testing code (live behaviour): one row per (code, email), project_id '*', at most maxUses rows per code.
    async grantTestCode(e) {
      await run(
        `INSERT OR IGNORE INTO entitlements (id, project_id, email, stripe_session_id, amount_cents, currency, credits_total, credits_used, credits_reserved, pdf_used, pdf_allowed, status, created_at, expires_at)
         SELECT ?1, '*', ?2, ?3, 0, 'aud', ?4, 0, 0, 0, ?5, 'active', ?6, ?7
         WHERE (SELECT COUNT(*) FROM entitlements WHERE instr(stripe_session_id, ?8) = 1) < ?9`,
        e.id, e.email, e.stripeSessionId, e.creditsTotal, e.pdfAllowed, e.createdAt, e.expiresAt, e.prefix, e.maxUses,
      );
      return this.getEntitlementBySession(e.stripeSessionId);
    },
    // One PDF set per job. claim is a single guarded write; zero rows changed means the set was already issued.
    async claimPdfSet(id) {
      return changed(await run('UPDATE entitlements SET pdf_used = pdf_used + 1 WHERE id = ?1 AND pdf_used < pdf_allowed', id));
    },
    async releasePdfSet(id) {
      await run('UPDATE entitlements SET pdf_used = MAX(0, pdf_used - 1) WHERE id = ?1', id);
    },
    async setPdfFile(id, key) {
      await run('UPDATE entitlements SET pdf_file = ?2 WHERE id = ?1', id, key);
    },
    // Save and share (live table "projects"; the design itself is in R2).
    async createSharedProject(p) {
      await run(
        'INSERT INTO projects (id, edit_key_hash, name, email, bytes, created_at, updated_at, expires_at, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
        p.id, p.editKeyHash, p.name ?? null, p.email ?? null, p.bytes, p.createdAt, p.updatedAt, p.expiresAt, p.ipHash ?? null,
      );
    },
    async getSharedProject(id) {
      const r = await first('SELECT * FROM projects WHERE id = ?1', id);
      return r && { id: r.id, editKeyHash: r.edit_key_hash, name: r.name, email: r.email, bytes: r.bytes, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at };
    },
    async updateSharedProject(id, p) {
      await run('UPDATE projects SET name = ?2, bytes = ?3, updated_at = ?4, expires_at = ?5, email = COALESCE(?6, email) WHERE id = ?1', id, p.name ?? null, p.bytes, p.updatedAt, p.expiresAt, p.email ?? null);
    },
    async deleteSharedProject(id) {
      await run('DELETE FROM projects WHERE id = ?1', id);
    },
    async firstExpiredSharedProject(nowIso) {
      return (await first('SELECT id FROM projects WHERE expires_at <= ?1 LIMIT 1', nowIso))?.id ?? null;
    },
    async hasWebhookEvent(id) {
      return !!(await first('SELECT 1 AS x FROM webhook_events WHERE id = ?1', id));
    },
    async reserveCredits(id, n, nowIso) {
      return changed(
        await run(
          `UPDATE entitlements SET credits_reserved = credits_reserved + ?2
           WHERE id = ?1 AND status = 'active' AND (expires_at IS NULL OR expires_at > ?3)
             AND credits_used + credits_reserved + ?2 <= credits_total`,
          id, n, nowIso,
        ),
      );
    },
    async settleCredits(id, reserved, actual) {
      await run(
        `UPDATE entitlements SET credits_reserved = MAX(0, credits_reserved - ?2), credits_used = MIN(credits_total, credits_used + ?3) WHERE id = ?1`,
        id, reserved, actual,
      );
    },
    async addCredits(id, n) {
      return changed(await run('UPDATE entitlements SET credits_total = credits_total + ?2 WHERE id = ?1', id, n));
    },
    async releaseCredits(id, reserved) {
      await run('UPDATE entitlements SET credits_reserved = MAX(0, credits_reserved - ?2) WHERE id = ?1', id, reserved);
    },
    async logAiRequest(r) {
      await run(
        `INSERT INTO ai_requests (id, entitlement_id, created_at, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
           cost_usd_micros, credits, ops_count, latency_ms, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        r.id, r.entitlementId, r.createdAt, r.model ?? null, r.inputTokens ?? 0, r.outputTokens ?? 0, r.cacheWriteTokens ?? 0,
        r.cacheReadTokens ?? 0, Math.round(r.costUsdMicros ?? 0), r.credits ?? 0, r.opsCount ?? 0, r.latencyMs ?? 0, r.status,
      );
    },
    async listAiRequests(entitlementId) {
      const rows = await all('SELECT * FROM ai_requests WHERE entitlement_id = ?1 ORDER BY created_at, id', entitlementId);
      return rows.map((r) => ({
        id: r.id, entitlementId: r.entitlement_id, createdAt: r.created_at, model: r.model, inputTokens: r.input_tokens,
        outputTokens: r.output_tokens, cacheWriteTokens: r.cache_write_tokens, cacheReadTokens: r.cache_read_tokens,
        costUsdMicros: r.cost_usd_micros, credits: r.credits, opsCount: r.ops_count, latencyMs: r.latency_ms, status: r.status,
      }));
    },
    async addSpend(period, micros) {
      await run(
        `INSERT INTO spend (period, cost_usd_micros) VALUES (?1, ?2)
         ON CONFLICT(period) DO UPDATE SET cost_usd_micros = cost_usd_micros + ?2`,
        period, Math.round(micros),
      );
    },
    async getSpend(period) {
      return (await first('SELECT cost_usd_micros AS v FROM spend WHERE period = ?1', period))?.v ?? 0;
    },
    async claimWebhookEvent(id, type, nowIso) {
      return changed(await run('INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?1, ?2, ?3)', id, type ?? null, nowIso));
    },
    async releaseWebhookEvent(id) {
      await run('DELETE FROM webhook_events WHERE id = ?1', id);
    },
    // Fixed window counter: returns the count in the current window, including this hit.
    async hitRate(key, windowSec, nowMs) {
      const start = Math.floor(nowMs / (windowSec * 1000)) * windowSec * 1000;
      const row = await first(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.count + 1 ELSE 1 END,
           window_start = ?2
         RETURNING count`,
        key, start,
      );
      return Number(row?.count ?? 1);
    },
    // Site lookup cache (JSON strings with an expiry).
    async getSiteCache(key, nowMs) {
      const row = await first('SELECT value FROM site_cache WHERE key = ?1 AND expires_at > ?2', key, nowMs);
      return row?.value ?? null;
    },
    async putSiteCache(key, value, ttlSec, nowMs) {
      await run(
        `INSERT INTO site_cache (key, value, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, expires_at = ?3`,
        key, value, nowMs + ttlSec * 1000,
      );
      if (Math.random() < 0.02) await run('DELETE FROM site_cache WHERE expires_at < ?1', nowMs);
    },
    async saveEnquiry(e) {
      await run(
        `INSERT INTO jce_enquiries (id, reference, created_at, name, phone, email, need, notes, lot_json, source, org_name, project_name, project_json, pdf_bytes, consent, email_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15)`,
        e.id, e.reference, e.createdAt, e.name, e.phone, e.email, e.need, e.notes || null, JSON.stringify(e.lot || {}), e.source || 'public', e.orgName || null,
        e.projectName || null, e.projectJson ?? null, e.pdfBytes || 0, e.emailStatus || 'pending',
      );
      return e.reference;
    },
    async markEnquiry(reference, patch) {
      await run('UPDATE jce_enquiries SET email_status = ?2, email_id = ?3, emailed_at = ?4, email_error = ?5 WHERE reference = ?1', reference, patch.emailStatus, patch.emailId ?? null, patch.emailedAt ?? null, patch.emailError ?? null);
    },
    async listEnquiries() {
      return (await all('SELECT * FROM jce_enquiries ORDER BY created_at, id')).map((r) => ({
        reference: r.reference, createdAt: r.created_at, name: r.name, phone: r.phone, email: r.email, need: r.need, notes: r.notes ?? '',
        lot: (() => { try { return JSON.parse(r.lot_json || '{}'); } catch { return {}; } })(), source: r.source, orgName: r.org_name ?? '', projectName: r.project_name ?? '',
        pdfBytes: r.pdf_bytes || 0, emailStatus: r.email_status, emailError: r.email_error ?? null, emailedAt: r.emailed_at ?? null, hasProject: !!r.project_json,
      }));
    },
    async saveEnquiryPdf(reference, base64) {
      const size = 500_000;
      for (let i = 0, seq = 0; i < base64.length; i += size, seq += 1) await run('INSERT OR REPLACE INTO jce_enquiry_pdfs (reference, seq, chunk) VALUES (?1, ?2, ?3)', reference, seq, base64.slice(i, i + size));
    },
    /** The saved PDF as base64, or null. */
    async getEnquiryPdf(reference) {
      const rows = await all('SELECT chunk FROM jce_enquiry_pdfs WHERE reference = ?1 ORDER BY seq', reference);
      return rows.length ? rows.map((r) => r.chunk).join('') : null;
    },
    async logEvent({ id, type, detail, createdAt }) {
      return changed(await run('INSERT OR IGNORE INTO events (id, type, detail, created_at) VALUES (?1, ?2, ?3, ?4)', id, type, detail ? JSON.stringify(detail) : null, createdAt));
    },
    async listEvents(type) {
      const rows = await all('SELECT * FROM events WHERE type = ?1 ORDER BY created_at, id', type);
      return rows.map((r) => ({ id: r.id, type: r.type, detail: r.detail ? JSON.parse(r.detail) : null, createdAt: r.created_at }));
    },
  };
}

// In memory (tests) -------------------------------------------------------------------------------
export function createMemoryStore() {
  const ents = new Map();
  const enquiries = new Map();
  const enquiryPdfs = new Map();
  const requests = [];
  const spend = new Map();
  const hooks = new Map();
  const rates = new Map();
  const shared = new Map();
  const siteCache = new Map();
  const events = new Map();
  const copy = (o) => (o ? { ...o } : null);
  const byEmail = (e, email) => e.email && email && e.email.toLowerCase() === String(email).toLowerCase();

  return {
    kind: 'memory',
    // test inspection
    _ents: ents,
    // Snapshot and restore as plain JSON, used by the file store (frontend/.data/plan-studio.json).
    _dump() {
      return {
        ents: [...ents.values()],
        requests,
        spend: Object.fromEntries(spend),
        hooks: Object.fromEntries(hooks),
        rates: Object.fromEntries(rates),
        events: [...events.values()],
        shared: [...shared.values()],
      };
    },
    _load(data = {}) {
      ents.clear();
      for (const e of data.ents || []) ents.set(e.id, e);
      requests.length = 0;
      requests.push(...(data.requests || []));
      spend.clear();
      for (const [k, v] of Object.entries(data.spend || {})) spend.set(k, v);
      hooks.clear();
      for (const [k, v] of Object.entries(data.hooks || {})) hooks.set(k, v);
      rates.clear();
      for (const [k, v] of Object.entries(data.rates || {})) rates.set(k, v);
      events.clear();
      for (const e of data.events || []) events.set(e.id, e);
      shared.clear();
      for (const p of data.shared || []) shared.set(p.id, p);
    },

    async createEntitlement(e) {
      const existing = e.stripeSessionId ? [...ents.values()].find((x) => x.stripeSessionId === e.stripeSessionId) : null;
      if (existing || ents.has(e.id)) return { entitlement: copy(existing || ents.get(e.id)), created: false };
      const row = { creditsUsed: 0, creditsReserved: 0, pdfUsed: 0, pdfAllowed: 1, pdfFile: null, status: 'active', email: null, stripePaymentIntent: null, stripeSessionId: null, amountCents: null, currency: null, expiresAt: null, ...e };
      row.creditsUsed = 0;
      row.creditsReserved = 0;
      row.pdfUsed = 0;
      ents.set(row.id, row);
      return { entitlement: copy(row), created: true };
    },
    async getEntitlement(id) {
      return copy(ents.get(id));
    },
    async getEntitlementBySession(sessionId) {
      return copy([...ents.values()].find((x) => x.stripeSessionId === sessionId));
    },
    async getEntitlementByPaymentIntent(pi) {
      return copy([...ents.values()].filter((x) => x.stripePaymentIntent === pi).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
    },
    async findForRestore(email, ref) {
      return copy(
        [...ents.values()]
          .filter((x) => byEmail(x, email) && (x.stripeSessionId === ref || x.stripePaymentIntent === ref || x.id === ref))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
      );
    },
    async setEntitlementStatus(id, status) {
      const e = ents.get(id);
      if (!e) return false;
      e.status = status;
      return true;
    },
    async setEntitlementExpiry(id, expiresAt) {
      const e = ents.get(id);
      if (!e) return false;
      e.expiresAt = expiresAt;
      return true;
    },
    async setEntitlementStatusIf(id, from, to) {
      const e = ents.get(id);
      if (!e || e.status !== from) return false;
      e.status = to;
      return true;
    },
    async setStatusByPaymentIntent(pi, to, onlyFrom = null) {
      let n = 0;
      for (const e of ents.values()) if (e.stripePaymentIntent === pi && (!onlyFrom || e.status === onlyFrom)) (e.status = to, (n += 1));
      return n > 0;
    },
    async grantTestCode(e) {
      const existing = [...ents.values()].find((x) => x.stripeSessionId === e.stripeSessionId);
      if (existing) return copy(existing);
      if ([...ents.values()].filter((x) => String(x.stripeSessionId || '').startsWith(e.prefix)).length >= e.maxUses) return null;
      const row = { id: e.id, projectId: '*', email: e.email, stripeSessionId: e.stripeSessionId, stripePaymentIntent: null, amountCents: 0, currency: 'aud', creditsTotal: e.creditsTotal, creditsUsed: 0, creditsReserved: 0, pdfUsed: 0, pdfAllowed: e.pdfAllowed, pdfFile: null, status: 'active', createdAt: e.createdAt, expiresAt: e.expiresAt };
      ents.set(row.id, row);
      return copy(row);
    },
    async claimPdfSet(id) {
      const e = ents.get(id);
      if (!e || !(e.pdfUsed < e.pdfAllowed)) return false;
      e.pdfUsed += 1;
      return true;
    },
    async releasePdfSet(id) {
      const e = ents.get(id);
      if (e) e.pdfUsed = Math.max(0, e.pdfUsed - 1);
    },
    async setPdfFile(id, key) {
      const e = ents.get(id);
      if (e) e.pdfFile = key;
    },
    async createSharedProject(p) {
      if (shared.has(p.id)) throw new Error('UNIQUE constraint failed: projects.id');
      shared.set(p.id, { ...p });
    },
    async getSharedProject(id) {
      return copy(shared.get(id));
    },
    async updateSharedProject(id, p) {
      const r = shared.get(id);
      if (r) Object.assign(r, { name: p.name ?? null, bytes: p.bytes, updatedAt: p.updatedAt, expiresAt: p.expiresAt, email: p.email ?? r.email });
    },
    async deleteSharedProject(id) {
      shared.delete(id);
    },
    async firstExpiredSharedProject(nowIso) {
      return [...shared.values()].find((p) => p.expiresAt <= nowIso)?.id ?? null;
    },
    async hasWebhookEvent(id) {
      return hooks.has(id);
    },
    async reserveCredits(id, n, nowIso) {
      const e = ents.get(id);
      if (!e || e.status !== 'active') return false;
      if (e.expiresAt && !(e.expiresAt > nowIso)) return false;
      if (e.creditsUsed + e.creditsReserved + n > e.creditsTotal) return false;
      e.creditsReserved += n;
      return true;
    },
    async settleCredits(id, reserved, actual) {
      const e = ents.get(id);
      if (!e) return;
      e.creditsReserved = Math.max(0, e.creditsReserved - reserved);
      e.creditsUsed = Math.min(e.creditsTotal, e.creditsUsed + actual);
    },
    async addCredits(id, n) {
      const e = ents.get(id);
      if (!e) return false;
      e.creditsTotal += n;
      return true;
    },
    async releaseCredits(id, reserved) {
      const e = ents.get(id);
      if (e) e.creditsReserved = Math.max(0, e.creditsReserved - reserved);
    },
    async logAiRequest(r) {
      requests.push({ ...r, costUsdMicros: Math.round(r.costUsdMicros ?? 0) });
    },
    async listAiRequests(entitlementId) {
      return requests.filter((r) => r.entitlementId === entitlementId).map(copy);
    },
    async addSpend(period, micros) {
      spend.set(period, (spend.get(period) || 0) + Math.round(micros));
    },
    async getSpend(period) {
      return spend.get(period) || 0;
    },
    async claimWebhookEvent(id, type, nowIso) {
      if (hooks.has(id)) return false;
      hooks.set(id, { type, receivedAt: nowIso });
      return true;
    },
    async releaseWebhookEvent(id) {
      hooks.delete(id);
    },
    async hitRate(key, windowSec, nowMs) {
      const start = Math.floor(nowMs / (windowSec * 1000)) * windowSec * 1000;
      const row = rates.get(key);
      const count = row && row.start === start ? row.count + 1 : 1;
      rates.set(key, { start, count });
      return count;
    },
    async getSiteCache(key, nowMs) {
      const row = siteCache.get(key);
      return row && row.expires > nowMs ? row.value : null;
    },
    async putSiteCache(key, value, ttlSec, nowMs) {
      siteCache.set(key, { value, expires: nowMs + ttlSec * 1000 });
      if (siteCache.size > 500) siteCache.delete(siteCache.keys().next().value);
    },
    async saveEnquiry(e) {
      enquiries.set(e.reference, { ...structuredClone(e) });
      return e.reference;
    },
    async markEnquiry(reference, patch) {
      const row = enquiries.get(reference);
      if (row) Object.assign(row, structuredClone(patch));
    },
    async listEnquiries() {
      return [...enquiries.values()].map((r) => { const { pdfBase64, projectJson, ...rest } = structuredClone(r); return { ...rest, hasProject: !!projectJson }; });
    },
    async saveEnquiryPdf(reference, base64) {
      enquiryPdfs.set(reference, base64);
    },
    async getEnquiryPdf(reference) {
      return enquiryPdfs.get(reference) ?? null;
    },
    async logEvent({ id, type, detail, createdAt }) {
      if (events.has(id)) return false;
      events.set(id, { id, type, detail: detail ?? null, createdAt });
      return true;
    },
    async listEvents(type) {
      return [...events.values()].filter((e) => e.type === type).map(copy);
    },
  };
}
