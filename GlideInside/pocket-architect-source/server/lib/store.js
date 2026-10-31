// Store interface with two implementations: Cloudflare D1 (prepared statements against server/schema.sql)
// and an in-memory one for tests. Every method is async. Credits are reserved before the model call and
// settled after it; each of those is one guarded write, so parallel requests cannot overspend.
//
// Entitlement object: { id, projectId, email, stripeSessionId, stripePaymentIntent, amountCents, currency,
//   creditsTotal, creditsUsed, creditsReserved, status, createdAt, expiresAt }

const toEnt = (r) =>
  r && {
    id: r.id,
    projectId: r.project_id,
    email: r.email ?? null,
    stripeSessionId: r.stripe_session_id ?? null,
    stripePaymentIntent: r.stripe_payment_intent ?? null,
    amountCents: r.amount_cents ?? null,
    currency: r.currency ?? null,
    creditsTotal: r.credits_total,
    creditsUsed: r.credits_used,
    creditsReserved: r.credits_reserved,
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
        `INSERT OR IGNORE INTO entitlements (id, project_id, email, stripe_session_id, stripe_payment_intent, amount_cents, currency,
           credits_total, credits_used, credits_reserved, status, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, ?10, ?11)`,
        e.id, e.projectId, e.email ?? null, e.stripeSessionId ?? null, e.stripePaymentIntent ?? null, e.amountCents ?? null,
        e.currency ?? null, e.creditsTotal, e.status || 'active', e.createdAt, e.expiresAt ?? null,
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
      return toEnt(await first('SELECT * FROM entitlements WHERE stripe_payment_intent = ?1 ORDER BY created_at DESC LIMIT 1', pi));
    },
    async findForRestore(email, ref) {
      return toEnt(
        await first(
          `SELECT * FROM entitlements WHERE lower(email) = lower(?1)
             AND (stripe_session_id = ?2 OR stripe_payment_intent = ?2 OR id = ?2)
           ORDER BY created_at DESC LIMIT 1`,
          email, ref,
        ),
      );
    },
    async setEntitlementStatus(id, status) {
      return changed(await run('UPDATE entitlements SET status = ?2 WHERE id = ?1', id, status));
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
  const requests = [];
  const spend = new Map();
  const hooks = new Map();
  const rates = new Map();
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
    },

    async createEntitlement(e) {
      const existing = e.stripeSessionId ? [...ents.values()].find((x) => x.stripeSessionId === e.stripeSessionId) : null;
      if (existing || ents.has(e.id)) return { entitlement: copy(existing || ents.get(e.id)), created: false };
      const row = { creditsUsed: 0, creditsReserved: 0, status: 'active', email: null, stripePaymentIntent: null, stripeSessionId: null, amountCents: null, currency: null, expiresAt: null, ...e };
      row.creditsUsed = 0;
      row.creditsReserved = 0;
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
