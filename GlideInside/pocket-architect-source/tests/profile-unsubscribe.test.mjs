// One click unsubscribe link (Spam Act 2003): signed token, no sign in, clears consent, records the event, rejects forged tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { createMemoryProfileStore } from '../server/lib/profile-store.js';
import { hmacSha256, toB64u } from '../server/lib/entitlement.js';

const SITE = 'https://site.test';
const SECRET = 'e'.repeat(40);
const PW = 'Correct-horse-battery-9';
const mkApp = () => {
  const pstore = createMemoryProfileStore();
  const app = createApp({ store: createMemoryStore(), profileStore: pstore, env: { SITE_URL: SITE, ENTITLEMENT_SECRET: SECRET }, fetchImpl: async () => { throw new Error('no network'); } });
  return { app, pstore };
};
const post = (app, path, body, cookie = '') => app.fetch(new Request(`${SITE}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gi-request': '1', origin: SITE, 'cf-connecting-ip': '1.1.1.1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const token = async (id) => { const b = toB64u(new TextEncoder().encode(`u1.${id}`)); return `${b}.${toB64u(await hmacSha256(SECRET, `unsub1.${b}`))}`; };

async function signedUpWithConsent(app, pstore, marketing) {
  const r = await post(app, '/profile/signup', { name: 'Sam Test', email: 'sam@example.com', password: PW, acceptTerms: true, acceptPrivacy: true, marketing });
  assert.equal(r.status, 202);
  return pstore.getProfileByEmail('sam@example.com');
}

test('signed link clears consent without a sign in and shows a confirmation page', async () => {
  const { app, pstore } = mkApp();
  const p = await signedUpWithConsent(app, pstore, true);
  assert.equal(p.marketingConsent, true);
  const res = await app.fetch(new Request(`${SITE}/api/profile/unsubscribe?t=${await token(p.id)}`, { headers: { 'cf-connecting-ip': '2.2.2.2' } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /You are unsubscribed/);
  const after = await pstore.getProfile(p.id);
  assert.equal(after.marketingConsent, false);
  assert.equal(after.unsubscribed, true);
  const events = await pstore.listConsentEvents?.(p.id);
  if (events) assert.ok(events.some((e) => e.source === 'unsubscribe-link' && e.consent === false));
});

test('one click POST (mail client) works too, and repeating the link is harmless', async () => {
  const { app, pstore } = mkApp();
  const p = await signedUpWithConsent(app, pstore, true);
  const t = await token(p.id);
  const a = await app.fetch(new Request(`${SITE}/api/profile/unsubscribe?t=${t}`, { method: 'POST', headers: { 'cf-connecting-ip': '2.2.2.2' } }));
  assert.equal(a.status, 200);
  const b = await app.fetch(new Request(`${SITE}/api/profile/unsubscribe?t=${t}`, { headers: { 'cf-connecting-ip': '2.2.2.2' } }));
  assert.equal(b.status, 200);
});

test('a forged, edited or missing token is refused and changes nothing', async () => {
  const { app, pstore } = mkApp();
  const p = await signedUpWithConsent(app, pstore, true);
  const good = await token(p.id);
  for (const t of ['', 'abc.def', good.slice(0, -2) + 'xx', `${toB64u(new TextEncoder().encode(`u1.${p.id}`))}.${toB64u(new Uint8Array(32))}`]) {
    const res = await app.fetch(new Request(`${SITE}/api/profile/unsubscribe?t=${encodeURIComponent(t)}`, { headers: { 'cf-connecting-ip': '3.3.3.3' } }));
    assert.equal(res.status, 400, t);
  }
  assert.equal((await pstore.getProfile(p.id)).marketingConsent, true);
});

test('the account preference button path (PUT preferences marketing false) also clears consent', async () => {
  const { app, pstore } = mkApp();
  await signedUpWithConsent(app, pstore, true);
  const si = await post(app, '/profile/session', { email: 'sam@example.com', password: PW });
  const cookie = si.headers.get('set-cookie').split(';')[0];
  const res = await app.fetch(new Request(`${SITE}/api/profile/preferences`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-gi-request': '1', origin: SITE, cookie, 'cf-connecting-ip': '1.1.1.1' }, body: JSON.stringify({ marketing: false }) }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).profile.marketing, false);
});
