// AI credits for portal logins. Uses the org credit pools of the AI branch (claude/glide-ai): each login has a monthly pool
// (entitlement row `org:<orgId>:<loginId>:<YYYY-MM>`, resets at the start of each Sydney month) and a top-up pool
// (`orgtop:<orgId>:<loginId>`). The pool ids, row fields and the `ai_topup` event are identical to that branch, so the
// AI endpoints and this code share the same rows. Top-up credits carry over 12 months from purchase (reconcileTopUps).

import { monthKey, monthStartMs, previousMonthKey } from '../../src/portal/billing.js';
import { issueOrgToken } from './entitlement.js';
import { HttpError } from './http.js';

export const TOPUP_VALID_MONTHS = 12;
const nextMonthKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
export { previousMonthKey };

export const orgPoolIds = (orgId, loginId, monthKeyValue) => ({ monthlyId: `org:${orgId}:${loginId}:${monthKeyValue}`, topUpId: `orgtop:${orgId}:${loginId}` });
export const aiRole = (user) => (user.role === 'client' ? 'client' : 'builder');
export const monthlyCap = (org, config) => (Number.isFinite(org.aiMonthlyCap) && org.aiMonthlyCap >= 0 ? org.aiMonthlyCap : config.orgMonthlyCredits);

/** When a top-up bought at `createdAt` stops being usable (12 months later). */
export function topUpExpiry(createdAt) {
  const d = new Date(createdAt);
  d.setUTCMonth(d.getUTCMonth() + TOPUP_VALID_MONTHS);
  return d.toISOString();
}

export async function ensurePools({ store, config, org, user, nowMs }) {
  const key = monthKey(nowMs);
  const { monthlyId, topUpId } = orgPoolIds(org.id, user.id, key);
  const createdAt = new Date(nowMs).toISOString();
  const base = { projectId: org.id, email: null, amountCents: 0, currency: 'aud', status: 'active', createdAt };
  await store.createEntitlement({ ...base, id: monthlyId, stripeSessionId: `org-m:${monthlyId}`, creditsTotal: monthlyCap(org, config), expiresAt: new Date(monthStartMs(nextMonthKey(key))).toISOString() });
  await store.createEntitlement({ ...base, id: topUpId, stripeSessionId: `org-t:${topUpId}`, creditsTotal: 0, expiresAt: null });
  return { key, monthlyId, topUpId };
}

/**
 * Remove top-up credits older than 12 months that were never used. Consumption is attributed to the oldest purchase first.
 * The pool total always equals purchases minus credits already expired, so what is still to expire is derived, not stored.
 */
export async function reconcileTopUps({ store, org, user, nowMs }) {
  const { topUpId } = orgPoolIds(org.id, user.id, monthKey(nowMs));
  const pool = await store.getEntitlement(topUpId);
  if (!pool || pool.creditsTotal <= 0) return 0;
  const lots = (await store.listEvents('ai_topup'))
    .filter((e) => e.detail?.orgId === org.id && e.detail?.loginId === user.id)
    .map((e) => ({ credits: Number(e.detail.credits) || 0, createdAt: e.detail.createdAt || e.createdAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const purchased = lots.reduce((n, l) => n + l.credits, 0);
  let consumed = pool.creditsUsed;
  let expiredUnused = 0;
  for (const lot of lots) {
    const used = Math.min(lot.credits, consumed);
    consumed -= used;
    if (Date.parse(topUpExpiry(lot.createdAt)) <= nowMs) expiredUnused += lot.credits - used;
  }
  const alreadyExpired = Math.max(0, purchased - pool.creditsTotal);
  const apply = Math.min(expiredUnused - alreadyExpired, pool.creditsTotal - pool.creditsUsed - (pool.creditsReserved || 0));
  if (apply > 0) {
    await store.addCredits(topUpId, -apply);
    return apply;
  }
  return 0;
}

/** The shape the screens use (mock-api aiBalance): monthly allowance and top-up balance. */
export async function aiSnapshot({ store, config, org, user, nowMs, reconcile = true }) {
  const { key, monthlyId, topUpId } = await ensurePools({ store, config, org, user, nowMs });
  if (reconcile) await reconcileTopUps({ store, org, user, nowMs });
  const m = await store.getEntitlement(monthlyId);
  const t = await store.getEntitlement(topUpId);
  const cap = m?.creditsTotal ?? monthlyCap(org, config);
  const used = m ? m.creditsUsed + (m.creditsReserved || 0) : 0;
  const monthlyRemaining = Math.max(0, cap - used);
  const topUpBalance = t ? Math.max(0, t.creditsTotal - t.creditsUsed - (t.creditsReserved || 0)) : 0;
  return { month: key, monthlyCap: cap, used, monthlyRemaining, topUpBalance, remaining: monthlyRemaining + topUpBalance, total: cap + topUpBalance, monthResetsOn: `${nextMonthKey(key)}-01` };
}

/** Add one top-up and log the billable event that the month end invoice reads. The charge is A$10 incl. GST for 300 credits. */
export async function addTopUp({ store, config, org, user, nowMs, randomId }) {
  const { topUpId } = await ensurePools({ store, config, org, user, nowMs });
  await store.addCredits(topUpId, config.topUpCredits);
  const createdAt = new Date(nowMs).toISOString();
  const detail = { orgId: org.id, loginId: user.id, credits: config.topUpCredits, amountCents: config.topUpCents, currency: 'aud', gstInclusive: true, createdAt, role: aiRole(user) };
  const id = randomId('topup');
  await store.logEvent({ id, type: 'ai_topup', detail, createdAt });
  return { id, orgId: org.id, loginId: user.id, credits: detail.credits, amountCents: detail.amountCents, createdAt };
}

/** A signed org token for the AI endpoints (issueOrgToken is the contract with claude/glide-ai). */
export async function aiToken({ config, org, user, nowMs }) {
  if (!config.entitlementSecret) throw new HttpError('SERVER_NOT_CONFIGURED', 'ENTITLEMENT_SECRET is not set.');
  const ttlSeconds = 8 * 3600;
  const token = await issueOrgToken({ orgId: org.id, loginId: user.id, role: aiRole(user), cap: monthlyCap(org, config), ttlSeconds }, config, nowMs);
  return { token, role: aiRole(user), expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString() };
}
