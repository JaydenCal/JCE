// "Send to JCE" enquiry endpoint: validation, consent, saved without the email key, rate limit, saved copy, Resend request shape, admin routes.
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

test('enquiry: without RESEND_API_KEY the request is still validated and SAVED, ok true and emailed false (never lost)', async () => {
  const w = world({ RESEND_API_KEY: '' });
  const res = await w.post(good());
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.equal(out.ok, true);
  assert.equal(out.emailed, false);
  assert.match(out.reference, /^GI-[A-Z2-9]{5}$/);
  assert.equal(w.sent.length, 0, 'no email is attempted');
  const [row] = await w.store.listEnquiries();
  assert.equal(row.reference, out.reference);
  assert.equal(row.emailStatus, 'not_configured');
  assert.equal(row.email, 'sarah@example.com');
  assert.equal(await w.store.getEnquiryPdf(out.reference), good().pdfBase64);
});

test('enquiry: with the key set the response says emailed true', async () => {
  const w = world();
  assert.equal((await (await w.post(good())).json()).emailed, true);
});

test('enquiry: if saving fails the error is returned and nothing is emailed', async () => {
  const w = world();
  w.store.saveEnquiry = async () => { throw new Error('db down'); };
  const res = await w.post(good());
  assert.ok(res.status >= 500);
  assert.equal(w.sent.length, 0);
});

test('enquiry: an invalid request is refused even when email is not set up', async () => {
  const w = world({ RESEND_API_KEY: '' });
  assert.equal((await w.post({ ...good(), consent: false })).status, 400);
  assert.equal((await w.store.listEnquiries()).length, 0);
});

// Owner admin routes (bearer admin token): list the saved requests newest first, download a request's PDF.
const ADMIN = 'admin-token-for-enquiry-tests-0123456789';
test('enquiry admin: list newest first without PDF bytes, PDF download, both need the admin token', async () => {
  const store = createMemoryStore();
  let t = T0;
  const app = createApp({ store, env: { SITE_URL: 'https://site.test', ENTITLEMENT_SECRET: 's', RESEND_API_KEY: '', ADMIN_TOKEN: ADMIN }, fetchImpl: async () => { throw new Error('no network'); }, now: () => (t += 60_000) });
  const post = (b, ip) => app.handle(new Request('https://x.test/api/enquiry/jce', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(b) }));
  const a = await (await post({ ...good(), email: 'first@example.com', name: 'First Person' }, '5.5.5.1')).json();
  const b = await (await post({ ...good(), email: 'second@example.com', name: 'Second Person', pdfBase64: null }, '5.5.5.2')).json();
  const get = (path, token) => app.handle(new Request(`https://x.test/api/portal/admin${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

  assert.equal((await get('/enquiries')).status, 401);
  assert.equal((await get('/enquiries', 'wrong-token')).status, 401);
  assert.equal((await get(`/enquiries/${a.reference}/pdf`)).status, 401);

  const res = await get('/enquiries', ADMIN);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.deepEqual(rows.map((r) => r.reference), [b.reference, a.reference], 'newest first');
  assert.equal(rows[1].name, 'First Person');
  assert.equal(rows[1].lot.address, '1 Test St, Sydney');
  assert.equal(rows[1].emailStatus, 'not_configured');
  assert.ok(rows[1].pdfBytes > 0);
  assert.ok(!JSON.stringify(rows).includes('pdfBase64') && !JSON.stringify(rows).includes('JVBERi'), 'no PDF bytes in the list');

  const pdf = await get(`/enquiries/${a.reference}/pdf`, ADMIN);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).toString(), '%PDF-1.4 test');
  assert.equal((await get(`/enquiries/${b.reference}/pdf`, ADMIN)).status, 404, 'a request saved without a PDF has none to download');
  assert.equal((await get('/enquiries/GI-NOPE2/pdf', ADMIN)).status, 404);
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

test('enquiry (final review): line breaks cannot reach the subject, notes keep theirs, a non PDF attachment is refused', async () => {
  const { parseEnquiry } = await import('../server/lib/enquiry.js');
  const e = parseEnquiry({ ...good(), project: null, projectName: 'House\r\nBcc: someone@example.com', name: 'Sam Lee', notes: 'line one\nline two' });
  assert.equal(e.projectName, 'House Bcc: someone@example.com');
  assert.equal(e.name, 'Sam Lee');
  assert.equal(e.notes, 'line one\nline two');
  const w = world();
  assert.equal((await w.post({ ...good(), pdfBase64: Buffer.from('<html>not a pdf</html>').toString('base64') })).status, 400);
  assert.equal(w.sent.length, 0);
});
