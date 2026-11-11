// Mock of the assistant API for CONFIG.aiMock = true: the same methods as createApi uses for credits, estimate, edit and
// top-ups, with canned replies and valid operations built from the design on screen. No network, no credits spent. It lets
// the owner walk through the whole flow, including the 50%, 80% and 95% warnings, the hard stop and the top-up.

import { ApiError } from '../api.js';
import { checkToolCall } from './tools.js';
import { lotOf, fallAcross, checkSetbacks, NOT_LOADED } from '../../model/placement.js';
import { fitHouse } from '../../site/fit-house.js';

export const MOCK_TOPUP = { credits: 300, amountCents: 1000 };
const THRESHOLDS = [0.5, 0.8, 0.95];
const metres = (v) => (Math.round(v * 100) / 100).toString();

const nextMonthFirst = (nowMs) => {
  const d = new Date(nowMs);
  const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
  const m = d.getMonth() === 11 ? 1 : d.getMonth() + 2;
  return `${y}-${String(m).padStart(2, '0')}-01`;
};

/** Canned answer for a message: { reply, ops }. Only returns operations the registry accepts for this design. */
export function mockReply(message, project) {
  const t = String(message || '').toLowerCase();
  const lot = lotOf(project);
  const siteIntent = /garage|fit|inside|setback|envelope|position|check|front/.test(t);
  const noLot = { reply: 'No lot is loaded for this design yet. Load a lot first and I can position the house on it.', ops: [], free: true };

  if (/fall|slope|steep/.test(t)) {
    if (!lot) return noLot;
    const f = fallAcross(project);
    return f
      ? { reply: `There is about ${metres(f.fallM)} m of fall across the lot (${f.slopePct}%)${f.direction ? `, falling to the ${f.direction}` : ''}, from RL ${metres(f.maxRL)} down to RL ${metres(f.minRL)}.`, ops: [] }
      : { reply: 'No level data is loaded for this lot, so I cannot say how much fall there is.', ops: [] };
  }
  if (/floor level|ffl/.test(t)) {
    if (!lot) return noLot;
    const f = fallAcross(project);
    if (!f) return { reply: 'No level data is loaded for this lot, so I cannot suggest a floor level.', ops: [] };
    const rl = Math.round((f.meanRL + 0.15) * 100) / 100;
    return { reply: `Floor level set to RL ${metres(rl)} m, 150 mm above the average ground level.`, ops: [{ op: 'set_floor_level', args: { rl } }] };
  }
  if (/rotate|turn/.test(t)) {
    if (!lot) return noLot;
    const n = /(-?\d+)\s*(deg|°)?/.exec(t);
    const degrees = n ? Math.max(-360, Math.min(360, Number(n[1]))) : 90;
    return { reply: `Rotated the house ${Math.abs(degrees)} degrees ${degrees < 0 ? 'anticlockwise' : 'clockwise'}.`, ops: [{ op: 'rotate_house', args: { degrees } }] };
  }
  if (siteIntent) {
    if (!lot) return noLot;
    if (!lot.setbacks && !lot.envelope) return { reply: `${NOT_LOADED} I can still move or rotate the house, but I will not make any setback claims.`, ops: [], free: true };
    const chk = checkSetbacks(project);
    if (/check/.test(t) && !/fit|move/.test(t)) {
      return { reply: chk.status === 'ok' ? 'The house is inside the indicative setback envelope.' : chk.message, ops: [{ op: 'check_setbacks', args: {} }] };
    }
    const align = /garage|front/.test(t) ? 'front' : 'centre';
    const fit = fitHouse(project);
    if (!fit.ok || !fit.fits) return { reply: fit.message, ops: [], free: true };
    if (align !== 'front') return {
      reply: fit.message,
      ops: [{ op: 'suggest_site_position', args: { align, apply: true } }, { op: 'check_setbacks', args: {} }],
    };
    return {
      reply: align === 'front' ? 'Moved the house as far toward the front boundary as the loaded setbacks allow.' : 'Moved the house to sit inside the indicative setback envelope.',
      ops: [{ op: 'suggest_site_position', args: { align, apply: true } }, { op: 'check_setbacks', args: {} }],
    };
  }
  if (/roof/.test(t) && /colou?r/.test(t)) {
    return { reply: 'Roof colour set to Charcoal.', ops: [{ op: 'set_finish', args: { target: 'roof', material: 'corrugated', colour: 'steel-charcoal' } }] };
  }
  return { free: true, reply: 'This is a mock assistant, so it only knows a few requests: fit the house inside the setbacks, check the setbacks, how much fall is on the lot, set the floor level, rotate the house, or change the roof colour.', ops: [] };
}

/**
 * createMockApi({ getProject, session, cost, delayMs, now })
 * session: { kind: 'public'|'builder'|'client', credits?: { total, used, topUpRemaining, monthResetsOn } }
 * cost: credits charged per reply (default 2). Returns credits(), estimate(), edit(), topUp(), setClientTopUps() and
 * `state` / `events` for inspection (events are the billable top-up records).
 */
export function createMockApi({ getProject, session = { kind: 'public' }, cost = 2, delayMs = 150, now = () => Date.now() } = {}) {
  const org = session.kind === 'builder' || session.kind === 'client';
  const seed = session.credits || {};
  const state = {
    total: Number.isFinite(seed.total) ? seed.total : org ? 300 : 500,
    used: Number.isFinite(seed.used) ? seed.used : 0,
    topUp: Number.isFinite(seed.topUpRemaining) ? seed.topUpRemaining : 0,
    resetsOn: seed.monthResetsOn || nextMonthFirst(now()),
    clientTopUps: true,
  };
  const events = [];
  const wait = () => (delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  const remaining = () => Math.max(0, state.total - state.used);
  const offer = () => ({ allowed: session.kind === 'builder' || state.clientTopUps, ...MOCK_TOPUP });
  const snapshot = () => ({
    total: state.total, used: state.used, remaining: remaining(), warnLevel: THRESHOLDS.filter((t) => state.used / state.total >= t).at(-1) || 0,
    ...(org ? { kind: 'org', monthResetsOn: state.resetsOn, topUpRemaining: state.topUp, available: remaining() + state.topUp, topUp: offer() } : {}),
  });

  return {
    state,
    events,
    mock: true,
    snapshot,
    async health() {
      return { ok: true, mock: true };
    },
    async credits() {
      await wait();
      return snapshot();
    },
    async estimate() {
      await wait();
      return { estimatedCredits: cost, remaining: remaining() + state.topUp, requiresConfirm: false };
    },
    async edit(_token, body = {}) {
      await wait();
      const plan = mockReply(body.message, getProject());
      const charge = plan.free && !plan.ops.length ? 0 : cost; // a refusal or an "I can only do..." reply is free
      if (charge > 0 && remaining() + state.topUp < cost) {
        throw new ApiError('CREDITS_EXHAUSTED', org ? 'All AI credits for this month have been used.' : 'All AI credits in this Plan Pack have been used.', {
          status: 402, details: { remaining: 0, estimatedCredits: cost, ...(org ? { topUp: offer(), monthResetsOn: state.resetsOn } : {}) },
        });
      }
      const before = state.used;
      const fromMonthly = Math.min(charge, remaining());
      state.used += fromMonthly;
      state.topUp -= charge - fromMonthly;
      const crossed = THRESHOLDS.filter((t) => before / state.total < t && state.used / state.total >= t).at(-1) || null;
      const ops = [];
      const rejected = [];
      for (const o of plan.ops) {
        const c = checkToolCall(o.op, o.args);
        if (c.ok) ops.push({ op: o.op, args: c.args });
        else rejected.push({ op: o.op, error: c.error });
      }
      return {
        reply: plan.reply, ops, rejected,
        credits: { charged: charge, ...snapshot() },
        warning: crossed ? { level: crossed, usedPercent: Math.round((state.used / state.total) * 100), remaining: remaining() } : null,
      };
    },
    async topUp() {
      await wait();
      if (!org) throw new ApiError('NOT_ENTITLED', 'Top-ups are for builder and client logins.', { status: 403 });
      if (!offer().allowed) throw new ApiError('TOPUP_DISABLED', 'Top-ups are turned off for your organisation. Ask your builder.', { status: 403 });
      state.topUp += MOCK_TOPUP.credits;
      const record = { orgId: 'mock-org', loginId: `mock-${session.kind}`, credits: MOCK_TOPUP.credits, amountCents: MOCK_TOPUP.amountCents, createdAt: new Date(now()).toISOString() };
      events.push(record);
      return { credits: snapshot(), topUp: record };
    },
    async setClientTopUps(_token, enabled) {
      if (session.kind !== 'builder') throw new ApiError('NOT_ENTITLED', 'Only a builder login can change this.', { status: 403 });
      state.clientTopUps = !!enabled;
      return { clientTopUps: state.clientTopUps };
    },
  };
}
