// "Send to JCE" enquiry endpoint: validation, consent, 503 when unset, rate limit, saved copy, Resend request shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { createProject } from '../src/model/schema.js';

const T0 = Date.UTC(2026, 10, 11, 3, 0, 0);
function world(env = {}, resend = () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })) {
  const sent = [];
  const store = createMemoryStore();
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    sent.push({ headers: init.headers, body: JSON.parse(init.body) });
    return resend();
  };
  const app = createApp({ store, env: { SITE_URL: 'https://site.test', ENTITLEMENT_SECRET: 's', RESEND_API_KEY: 're_test', ...env }, fetchImpl, now: () => T0 });
  const post = (body, ip = '1.2.3.4') => app.handle(new Request('https://x.test/api/enquiry/jce', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) }));
  return { sent, store, post };
}
const good = () => ({
  name: 'Sarah Lee', phone: '0412 345 678', email: 'Sarah@Example.com', need: 'both', notes: 'Slab on ground', consent: true,
  lot: { address: '1 Test St, Sydney', lot: '12', dp: 'DP 345', lga: 'Parramatta', zone: 'R2' },
  project: createProject({ name: 'Test house' }), pdfBase64: Buffer.from('%PDF-1.4 test').toString('base64'), source: 'client', orgName: 'Sample Homes',
});

test('enquiry: sends the email through Resend, keeps a copy, returns a reference', async () => {
  const w = world();
  const res = await w.post(good());
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.equal(out.ok, true);
  assert.match(out.reference, /^GI-[A-Z2-9]{5}$/);
  assert.equal(w.sent.length, 1);
  const m = w.sent[0];
  assert.equal(m.headers.authorization, 'Bearer re_test');
  assert.deepEqual(m.body.to, ['enquiries@jceinfrastructure.com.au']);
  assert.equal(m.body.from, 'Glide Inside <plans@glideinside.com.au>');
  assert.equal(m.body.reply_to, 'sarah@example.com');
  assert.ok(m.body.subject.includes(out.reference));
  assert.match(m.body.text, /Engineering and DA plans/);
  assert.match(m.body.text, /Parramatta/);
  assert.deepEqual(m.body.attachments.map((a) => a.filename.split('.').pop()), ['pdf', 'json']);
  assert.equal(Buffer.from(m.body.attachments[0].content, 'base64').toString(), '%PDF-1.4 test');
  const [row] = await w.store.listEnquiries();
  assert.equal(row.reference, out.reference);
  assert.equal(row.emailStatus, 'sent');
  assert.equal(row.consent, true);
});

test('enquiry: ENQUIRY_TO and ENQUIRY_FROM come from the environment', async () => {
  const w = world({ ENQUIRY_TO: 'test@example.com', ENQUIRY_FROM: 'GI <a@b.test>' });
  await w.post(good());
  assert.deepEqual(w.sent[0].body.to, ['test@example.com']);
  assert.equal(w.sent[0].body.from, 'GI <a@b.test>');
});

test('enquiry: 503 when RESEND_API_KEY is not set, and nothing is saved or sent', async () => {
  const w = world({ RESEND_API_KEY: '' });
  const res = await w.post(good());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'ENQUIRY_NOT_CONFIGURED');
  assert.equal(w.sent.length, 0);
  assert.equal((await w.store.listEnquiries()).length, 0);
});

test('enquiry: consent, contact details and need are required', async () => {
  const w = world();
  for (const patch of [{ consent: false }, { consent: 'yes' }, { name: '' }, { phone: 'abc' }, { email: 'nope' }, { need: 'other' }]) {
    const res = await w.post({ ...good(), ...patch });
    assert.equal(res.status, 400, JSON.stringify(patch));
  }
  assert.equal(w.sent.length, 0);
});

test('enquiry: rejects a bad or oversized PDF', async () => {
  const w = world({ ENQUIRY_MAX_PDF_BYTES: '100' });
  assert.equal((await w.post({ ...good(), pdfBase64: '***' })).status, 400);
  assert.equal((await w.post({ ...good(), pdfBase64: Buffer.alloc(500).toString('base64') })).status, 413);
});

test('enquiry: rate limited per email address (3 a day)', async () => {
  const w = world();
  for (let i = 0; i < 3; i++) assert.equal((await w.post(good(), `9.9.9.${i}`)).status, 200);
  assert.equal((await w.post(good(), '9.9.9.9')).status, 429);
});

test('enquiry: rate limited per IP (5 an hour)', async () => {
  const w = world();
  for (let i = 0; i < 5; i++) assert.equal((await w.post({ ...good(), email: `p${i}@example.com` })).status, 200);
  assert.equal((await w.post({ ...good(), email: 'p9@example.com' })).status, 429);
});

test('enquiry: if Resend refuses, the enquiry is still saved and the reference is returned with 502', async () => {
  const w = world({}, () => new Response('{}', { status: 422 }));
  const res = await w.post(good());
  const out = await res.json();
  assert.equal(res.status, 502);
  assert.equal(out.error.code, 'EMAIL_FAILED');
  const [row] = await w.store.listEnquiries();
  assert.equal(row.emailStatus, 'failed');
  assert.equal(out.error.reference ?? out.reference, row.reference);
});
