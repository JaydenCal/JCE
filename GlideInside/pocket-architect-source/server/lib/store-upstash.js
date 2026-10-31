// Upstash Redis store over its REST API (fetch only, no SDK). For production on Vercel.
//   const store = createUpstashStore({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
//
// Layout (all keys start with `ps:`):
//   ps:ent:<id>             hash: the entitlement (credit counters are numeric fields)
//   ps:sess:<sessionId>     entitlement id for a Stripe Checkout Session (the idempotency key)
//   ps:pi:<paymentIntent>   latest entitlement id for a payment intent
//   ps:ai:<entitlementId>   list of AI request logs (newest first, capped)
//   ps:spend:<period>       micro-USD counter, 'd:YYYY-MM-DD' or 'm:YYYY-MM'
//   ps:wh:<eventId>         Stripe webhook idempotency marker
//   ps:rate:<key>:<start>   fixed window counter
//   ps:evt:<id>, ps:evts:<type>   events (marker plus capped list)
//
// Every credit change is one Lua EVAL, so parallel requests cannot overspend (same rule as the D1 store).
// Plan content is never stored here; request logs hold token counts only.

const NUMERIC = new Set(['creditsTotal', 'creditsUsed', 'creditsReserved', 'amountCents']);
const FIELDS = ['id', 'projectId', 'email', 'stripeSessionId', 'stripePaymentIntent', 'amountCents', 'currency', 'creditsTotal', 'creditsUsed', 'creditsReserved', 'status', 'createdAt', 'expiresAt'];
const DAY = 86400;

export const LUA = {
  create: `
local existing = redis.call('GET', KEYS[2])
if existing then return existing end
if redis.call('EXISTS', KEYS[1]) == 1 then return ARGV[1] end
redis.call('SET', KEYS[2], ARGV[1])
redis.call('HSET', KEYS[1], unpack(ARGV, 2))
return ''`,
  reserve: `
local e = redis.call('HMGET', KEYS[1], 'status', 'expiresAt', 'creditsUsed', 'creditsReserved', 'creditsTotal')
if e[1] ~= 'active' then return 0 end
if e[2] and e[2] ~= '' and e[2] <= ARGV[2] then return 0 end
if (tonumber(e[3]) or 0) + (tonumber(e[4]) or 0) + tonumber(ARGV[1]) > (tonumber(e[5]) or 0) then return 0 end
redis.call('HINCRBY', KEYS[1], 'creditsReserved', ARGV[1])
return 1`,
  settle: `
local e = redis.call('HMGET', KEYS[1], 'creditsUsed', 'creditsReserved', 'creditsTotal')
if not e[3] then return 0 end
local reserved = math.max(0, (tonumber(e[2]) or 0) - tonumber(ARGV[1]))
local used = math.min(tonumber(e[3]), (tonumber(e[1]) or 0) + tonumber(ARGV[2]))
redis.call('HSET', KEYS[1], 'creditsReserved', reserved, 'creditsUsed', used)
return 1`,
  release: `
local r = redis.call('HGET', KEYS[1], 'creditsReserved')
if not r then return 0 end
redis.call('HSET', KEYS[1], 'creditsReserved', math.max(0, (tonumber(r) or 0) - tonumber(ARGV[1])))
return 1`,
  rate: `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return c`,
};

function parseHash(flat) {
  if (!Array.isArray(flat) || !flat.length) return null;
  const o = {};
  for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  const ent = {};
  for (const f of FIELDS) {
    const v = o[f];
    ent[f] = v === undefined ? null : NUMERIC.has(f) ? Number(v) : v;
  }
  return ent;
}

export function createUpstashStore({ url, token, fetchImpl } = {}) {
  if (!url || !token) throw new Error('Upstash needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
  const base = String(url).replace(/\/+$/, '');
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  async function cmd(...args) {
    const res = await doFetch(base, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args.map((a) => (typeof a === 'number' ? String(a) : a))),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Upstash error: ${data.error || res.status}`);
    return data.result;
  }
  const evalLua = (script, keys, args) => cmd('EVAL', script, keys.length, ...keys, ...args);

  const entKey = (id) => `ps:ent:${id}`;
  const loadEnt = async (id) => (id ? parseHash(await cmd('HGETALL', entKey(id))) : null);

  return {
    kind: 'upstash',

    async createEntitlement(e) {
      const row = {
        id: e.id, projectId: e.projectId, email: e.email ?? null, stripeSessionId: e.stripeSessionId ?? null,
        stripePaymentIntent: e.stripePaymentIntent ?? null, amountCents: e.amountCents ?? null, currency: e.currency ?? null,
        creditsTotal: e.creditsTotal, creditsUsed: 0, creditsReserved: 0, status: e.status || 'active', createdAt: e.createdAt, expiresAt: e.expiresAt ?? null,
      };
      const flat = [];
      for (const f of FIELDS) if (row[f] !== null && row[f] !== undefined) flat.push(f, String(row[f]));
      const sessKey = row.stripeSessionId ? `ps:sess:${row.stripeSessionId}` : `ps:nosess:${row.id}`;
      const existing = await evalLua(LUA.create, [entKey(row.id), sessKey], [row.id, ...flat]);
      if (existing) return { entitlement: await loadEnt(existing), created: false };
      if (row.stripePaymentIntent) await cmd('SET', `ps:pi:${row.stripePaymentIntent}`, row.id);
      return { entitlement: await loadEnt(row.id), created: true };
    },
    getEntitlement: (id) => loadEnt(id),
    async getEntitlementBySession(sessionId) {
      return loadEnt(await cmd('GET', `ps:sess:${sessionId}`));
    },
    async getEntitlementByPaymentIntent(pi) {
      return loadEnt(await cmd('GET', `ps:pi:${pi}`));
    },
    async findForRestore(email, ref) {
      const wanted = String(email || '').toLowerCase();
      const ids = new Set([await cmd('GET', `ps:sess:${ref}`), await cmd('GET', `ps:pi:${ref}`), ref]);
      const found = [];
      for (const id of ids) {
        if (!id) continue;
        const ent = await loadEnt(id);
        if (ent && ent.email && ent.email.toLowerCase() === wanted) found.push(ent);
      }
      return found.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    },
    async setEntitlementStatus(id, status) {
      if (!(await cmd('EXISTS', entKey(id)))) return false;
      await cmd('HSET', entKey(id), 'status', status);
      return true;
    },
    async reserveCredits(id, n, nowIso) {
      return Number(await evalLua(LUA.reserve, [entKey(id)], [n, nowIso])) === 1;
    },
    async settleCredits(id, reserved, actual) {
      await evalLua(LUA.settle, [entKey(id)], [reserved, actual]);
    },
    async releaseCredits(id, reserved) {
      await evalLua(LUA.release, [entKey(id)], [reserved]);
    },
    async logAiRequest(r) {
      const key = `ps:ai:${r.entitlementId}`;
      await cmd('LPUSH', key, JSON.stringify({ ...r, costUsdMicros: Math.round(r.costUsdMicros ?? 0) }));
      await cmd('LTRIM', key, 0, 999);
    },
    async listAiRequests(entitlementId) {
      const rows = (await cmd('LRANGE', `ps:ai:${entitlementId}`, 0, -1)) || [];
      return rows.map((r) => JSON.parse(r)).reverse();
    },
    async addSpend(period, micros) {
      await cmd('INCRBY', `ps:spend:${period}`, Math.round(micros));
      await cmd('EXPIRE', `ps:spend:${period}`, 100 * DAY);
    },
    async getSpend(period) {
      return Number(await cmd('GET', `ps:spend:${period}`)) || 0;
    },
    async claimWebhookEvent(id, type, nowIso) {
      return (await cmd('SET', `ps:wh:${id}`, JSON.stringify({ type: type ?? null, receivedAt: nowIso }), 'NX', 'EX', 30 * DAY)) === 'OK';
    },
    async releaseWebhookEvent(id) {
      await cmd('DEL', `ps:wh:${id}`);
    },
    // Fixed window counter: the count in the current window, including this hit.
    async hitRate(key, windowSec, nowMs) {
      const start = Math.floor(nowMs / (windowSec * 1000)) * windowSec * 1000;
      return Number(await evalLua(LUA.rate, [`ps:rate:${key}:${start}`], [windowSec + 5]));
    },
    async logEvent({ id, type, detail, createdAt }) {
      const first = (await cmd('SET', `ps:evt:${id}`, '1', 'NX', 'EX', 90 * DAY)) === 'OK';
      if (!first) return false;
      await cmd('RPUSH', `ps:evts:${type}`, JSON.stringify({ id, type, detail: detail ?? null, createdAt }));
      await cmd('LTRIM', `ps:evts:${type}`, -1000, -1);
      return true;
    },
    async listEvents(type) {
      return ((await cmd('LRANGE', `ps:evts:${type}`, 0, -1)) || []).map((r) => JSON.parse(r));
    },
  };
}
