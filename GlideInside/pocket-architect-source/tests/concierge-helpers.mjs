// Shared world for the concierge tests: a real app on an in-memory store, the mock calendar and a stubbed Anthropic fetch. Nothing touches the network.
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';

export const T0 = Date.UTC(2026, 10, 9, 23, 0, 0); // Tuesday 10/11/2026 10:00 AEDT
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export { jsonRes };

export function world(envOverrides = {}, { model = null, clock = { t: T0 } } = {}) {
  const calls = { anthropic: [], turnstile: [], other: [] };
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      calls.anthropic.push(body);
      return model ? model(body) : jsonRes({ content: [{ type: 'text', text: 'Glide Inside Residential has starting plans for granny flats.' }], usage: { input_tokens: 900, output_tokens: 40 } });
    }
    if (u.startsWith('https://challenges.cloudflare.com/')) {
      const b = JSON.parse(init.body);
      calls.turnstile.push(b);
      return jsonRes({ success: b.response === 'good-token' });
    }
    calls.other.push(u);
    throw new Error(`unexpected fetch ${u}`);
  };
  const store = createMemoryStore();
  const env = {
    SITE_URL: 'https://site.test', ENTITLEMENT_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'sk-test',
    CONCIERGE_ENABLED: '1', CONCIERGE_ALLOW_MOCK: '1', CONCIERGE_APPROVED_TYPES: 'homeowner,builder,developer,agent', AI_MONTHLY_BUDGET_AUD: '5',
    ...envOverrides,
  };
  const app = createApp({ store, env, fetchImpl, now: () => clock.t });
  let n = 0;
  const post = async (path, body, { ip = '203.0.113.7', headers = {} } = {}) => {
    const res = await app.handle(new Request(`https://site.test/api/concierge/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gi-request': '1', 'cf-connecting-ip': ip, ...headers }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const get = async (path, ip = '203.0.113.7') => {
    const res = await app.handle(new Request(`https://site.test/api/concierge/${path}`, { headers: { 'cf-connecting-ip': ip } }));
    return { status: res.status, body: await res.json() };
  };
  const start = async (ip) => (await post('session', { turnstileToken: 'x' }, { ip })).body.conv;
  const idem = () => `idem_${String(++n).padStart(4, '0')}_abcdefghijkl`;
  return { app, store, calls, clock, post, get, start, idem, provider: app.concierge.provider, cc: app.concierge };
}

/** First free slot for a type, then a signed proposal for it. */
export async function proposeFirst(w, conv, type = 'builder', who = { name: 'Sam Test', email: 'sam@example.com' }, pick = 0) {
  const s = await w.post('slots', { conv, type });
  const slot = s.body.slots[pick];
  const p = await w.post('propose', { conv, type, slotStart: slot.start, ...who, bookingConsent: true });
  return { slot, p, slots: s.body.slots };
}
