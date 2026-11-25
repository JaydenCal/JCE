// Homeowner plan sets are free for contact details (25/11/2026): the form rules, the lead saved through the enquiry endpoint with source
// "planset-free", the config flag that switches it back to the Plan Pack, and a desktop browser run. Builder, per job billing and commercial are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { queueLead, queuedLeads, flushLeadQueue, QUEUE_MAX, consentText, areaBuilderFor, leadProblems, leadBody, rememberLead, rememberedLead, alreadyGave, LEAD_SOURCE, LEAD_CONSENT, GET_LABEL, QUOTE_LINE, CONCEPT_LINE } from '../src/premium/free-planset.js';
import { parseEnquiry, handleEnquiry, summaryText } from '../server/lib/enquiry.js';
import { createMemoryStore } from '../server/lib/store.js';
import { SRC, SKIP, serve, launch, newPage, openApp, dismiss } from './helpers/phone-harness.mjs';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const call = (store, body) => handleEnquiry({ body, request: new Request('http://x/api/enquiry/jce'), store, config: {}, fetchImpl: null, now: () => Date.now(), clientIp: () => `9.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const good = { name: 'Sam Citizen', email: 'sam@example.com', suburb: 'Calala', timeframe: '12m', ownership: 'buying', consent: true };

test('the wording is the owner\'s and has no dashes', () => {
  assert.equal(LEAD_CONSENT, 'I agree to Glide Inside sharing my details and design with the local builder who covers my area, so they can contact me about building.');
  assert.equal(consentText('Example Homes'), LEAD_CONSENT, 'no builder is named in the wording');
  assert.equal(GET_LABEL, 'Get my plan set, free');
  assert.equal(QUOTE_LINE, 'Need stormwater, site classification or footings? Get a quote from JCE');
  assert.equal(CONCEPT_LINE, 'Concept only. Not for construction or approval.');
  const t = fs.readFileSync(path.join(SRC, 'src/premium/free-planset.js'), 'utf8');
  assert.ok(!/[–—]/.test(t) && !/compliant/i.test(t));
});

test('the form needs a name, a valid email, a suburb and the consent tick', () => {
  assert.deepEqual(leadProblems(good), []);
  assert.deepEqual(leadProblems({}).map((p) => p.field), ['name', 'email', 'suburb', 'timeframe', 'ownership', 'consent']);
  assert.deepEqual(leadProblems({ ...good, timeframe: 'soon' }).map((p) => p.field), ['timeframe'], 'only the offered answers count');
  assert.deepEqual(leadProblems({ ...good, ownership: '' }).map((p) => p.field), ['ownership']);
  assert.deepEqual(leadProblems({ ...good, email: 'nope' }).map((p) => p.field), ['email']);
  assert.deepEqual(leadProblems({ ...good, consent: false }).map((p) => p.field), ['consent']);
  assert.deepEqual(leadProblems({ ...good, consent: 'yes' }).map((p) => p.field), ['consent'], 'only a real tick counts');
});

test('the lead body is a lead only, tagged planset-free, with the lot from the design', () => {
  const project = { name: 'x', placedHouse: { name: 'Granny flat, 2 bedroom' }, site: { lot: { address: '1 Example St, Calala NSW', lga: 'TAMWORTH REGIONAL', zoning: { code: 'R1', name: 'General Residential' } } } };
  const b = leadBody({ ...good, surface: 'phone', designType: 'granny' }, project, { now: () => new Date('2026-11-25T01:02:03.000Z') });
  assert.equal(b.consentText, LEAD_CONSENT, 'the consent text is stored with the lead');
  assert.equal(b.consentAt, '2026-11-25T01:02:03.000Z', 'and when it was given');
  assert.equal(b.timeframe, '12m');
  assert.equal(b.ownership, 'buying');
  assert.equal(b.designType, 'granny');
  assert.match(b.notes, /Building: Within 12 months/);
  assert.match(b.notes, /Owns the block: Buying/);
  assert.match(b.notes, /Design type: granny/);
  assert.match(b.notes, /Consent: I agree to Glide Inside sharing my details and design with the local builder who covers my area/);
  assert.equal(b.builder, null, 'no builder holds the area, so none is named');
  assert.doesNotMatch(b.notes, /Builder named/);
  const named = leadBody({ ...good, builder: 'Example Homes' }, project);
  assert.equal(named.builder, null, 'no builder is named: leads are not shared with builders yet');
  assert.doesNotMatch(named.notes, /Builder named/);
  assert.match(b.notes, /Consent given: 2026-11-25T01:02:03/);
  assert.equal(b.source, LEAD_SOURCE);
  assert.equal(b.source, 'planset-free');
  assert.equal(b.need, 'planset');
  assert.equal(b.consent, true);
  assert.equal(b.pdfBase64, undefined);
  assert.equal(b.project, undefined);
  assert.match(b.notes, /Suburb: Calala/);
  assert.match(b.notes, /Surface: phone/);
  assert.equal(b.lot.address, '1 Example St, Calala NSW');
  assert.equal(b.lot.zone, 'R1 General Residential');
});

test('the builder for the area comes from the lot\'s postcode, and is none when no builder holds it', () => {
  const lot = (address) => ({ site: { lot: { address } } });
  const cfg = { areaBuilders: { 2340: { name: 'Example Homes' }, 2400: 'Other Builds' } };
  assert.equal(areaBuilderFor(lot('1 Example St, Tamworth NSW 2340'), cfg).name, 'Example Homes');
  assert.equal(areaBuilderFor(lot('9 Test Rd, Moree NSW 2400'), cfg).name, 'Other Builds');
  assert.equal(areaBuilderFor(lot('1 Example St, Kempsey NSW 2440'), cfg), null);
  assert.equal(areaBuilderFor(lot('1 Example St, Tamworth'), cfg), null);
  assert.equal(areaBuilderFor(lot('1 Example St, Tamworth NSW 2340'), {}), null);
  assert.equal(areaBuilderFor(lot('1 Example St, Tamworth NSW 2340'), { areaBuilders: {} }), null);
  assert.equal(areaBuilderFor({}, cfg), null);
  assert.deepEqual(CONFIG.areaBuilders || {}, {}, 'no builder has an area yet');
});

test('details are remembered in this browser per design', () => {
  const s = mem();
  assert.equal(rememberedLead(s), null);
  rememberLead(good, 'p1', s);
  assert.equal(rememberedLead(s).suburb, 'Calala');
  assert.equal(alreadyGave('p1', s), true);
  assert.equal(alreadyGave('p2', s), false, 'a second design asks again');
});

test('the server saves a planset-free lead with no phone, and still checks a phone that is given', async () => {
  const body = { ...leadBody(good, { site: { lot: {} } }) };
  const e = parseEnquiry(body);
  assert.equal(e.source, 'planset-free');
  assert.equal(e.need, 'planset');
  assert.equal(e.phone, '');
  assert.throws(() => parseEnquiry({ ...body, phone: '12' }), /phone/i);
  assert.throws(() => parseEnquiry({ ...body, consent: false }), /tick/i);
  assert.throws(() => parseEnquiry({ ...body, need: 'engineering' }), /Phone is required/, 'every other enquiry still needs a phone');
  assert.equal(parseEnquiry({ ...body, source: 'something-else' }).source, 'public', 'only the known sources are kept');
  const store = createMemoryStore();
  const out = await handleEnquiry({ body, request: new Request('http://x/api/enquiry/jce'), store, config: {}, fetchImpl: null, now: () => Date.now(), clientIp: () => '1.2.3.4' });
  assert.equal(out.ok, true);
  assert.equal(out.emailed, false, 'no email is sent when email is not set up, and none ever goes to the person');
  const saved = (await store.listEnquiries?.({ limit: 5 })) || null;
  if (saved) assert.equal(saved[0].source, 'planset-free');
  assert.match(summaryText(e, 'GI-ABCDE'), /free plan set lead/);
  assert.match(summaryText(e, 'GI-ABCDE'), /Nothing was sent to the visitor/);
});

test('the flag is on, is read from the host page, and the Stripe code is still in place behind it', () => {
  assert.equal(CONFIG.homeownerPlanSetFree, true);
  const cfg = fs.readFileSync(path.join(SRC, 'src/config.js'), 'utf8');
  assert.ok(/GI_CONFIG\?\.homeownerPlanSetFree/.test(cfg), 'GI_CONFIG.homeownerPlanSetFree = false switches it back');
  const prem = fs.readFileSync(path.join(SRC, 'src/premium/premium.js'), 'utf8');
  assert.ok(/const planSetFree = \(\) => !!cfg\.homeownerPlanSetFree && !portalOn\(\) && !commercialNow\(\) && !csubOn\(\) && !state\.token;/.test(prem), 'homeowner residential only');
  assert.ok(prem.includes('flows.openUpgrade(o)') && prem.includes('api.checkout') === false, 'the Plan Pack dialog is still the fallback');
  assert.ok(fs.readFileSync(path.join(SRC, 'src/premium/ui/flows.js'), 'utf8').includes('api.checkout'), 'the Stripe checkout code is in place');
});

test('desktop: the PDF plan set is free for details; the builder and commercial states are not', { skip: SKIP, timeout: 300000 }, async () => {
  const { server, origin } = await serve();
  const br = await launch();
  try {
    const { page } = await newPage(br, { width: 1280, height: 860, phone: false });
    await page.addInitScript(() => { window.__ev = []; window.addEventListener('ps:analytics', (e) => window.__ev.push([e.detail.event, e.detail.props])); });
    const posted = [];
    await page.route('**/api/enquiry/jce', async (r) => { posted.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, reference: 'GI-ABCDE', emailed: false }) }); });
    await openApp(page, origin, '?mode=residential&sample=1&flow=0');
    await dismiss(page);
    await page.waitForFunction(() => window.__ps.premium, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__ps.premium.planSetFree()), true);
    assert.equal((await page.locator('.ps-topbar').first().textContent()).includes('AI design assistant, A$30'), true, 'the top bar button is the A$30 AI design assistant, not the plans');
    await page.evaluate(() => { window.__ps.premium.exportAs('pdf'); });
    await page.waitForSelector('[data-ps=planset-form]');
    assert.equal(await page.textContent('[data-ps=planset-consent-text]'), LEAD_CONSENT, 'no builder holds the area, so the wording names none');
    assert.equal(await page.locator('.psp-modal').first().textContent().then((t) => /A\$\s?30/.test(t)), false, 'no price in the dialog');
    await page.fill('#fps-name', 'Sam Citizen'); await page.fill('#fps-email', 'sam@example.com'); await page.fill('#fps-suburb', 'Calala'); await page.check('[data-ps=planset-timeframe][value="6m"]'); await page.check('[data-ps=planset-ownership][value=yes]'); await page.check('#fps-consent');
    assert.equal(await page.locator('[data-ps=planset-privacy]').getAttribute('href'), '/privacy.html');
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await page.click('[data-ps=planset-form] button[type=submit]');
    await page.waitForSelector('[data-ps=terms-check]', { timeout: 30000 });
    await page.check('[data-ps=terms-check]'); await page.click('[data-ps=terms-generate]');
    assert.match((await dl).suggestedFilename(), /\.pdf$/i);
    await page.waitForSelector('[data-ps=planset-done]:not([hidden])');
    assert.equal(posted.length, 1);
    assert.equal(posted[0].source, 'planset-free');
    assert.equal(await page.textContent('[data-ps=planset-quote]'), QUOTE_LINE);
    const names = (await page.evaluate(() => window.__ev)).map((e) => e[0]);
    assert.ok(names.includes('planset_lead_submit') && names.includes('planset_download'));
    assert.ok(names.includes('export_unlocked_by_lead'), 'the lead unlock event fires once the form is sent');
    // every other file is now free without asking again: no form, the file just downloads
    const dxf = page.waitForEvent('download', { timeout: 120000 });
    await page.evaluate(() => { window.__ps.premium.exportAs('dxf'); });
    assert.match((await dxf).suggestedFilename(), /\.dxf$/i);
    assert.equal(await page.locator('[data-ps=planset-form]:visible').count(), 0, 'the form is not shown a second time');
    assert.ok(!names.includes('phone_planset_download'), 'the phone events are for the phone path');
    // a builder login, a commercial design and the DXF keep their own paths
    assert.equal(await page.evaluate(() => { const p = window.__ps.premium; p.setPortalEntitlement?.({ entitled: true, exports: ['pdf'], orgName: 'B' }); return p.planSetFree(); }), false, 'builder portal: not free');
    assert.equal(await page.evaluate(() => { window.__ps.premium.setPortalEntitlement?.(null); window.__ps.store.project.mode = 'commercial'; const v = window.__ps.premium.planSetFree(); window.__ps.store.project.mode = 'residential'; return v; }), false, 'commercial: not free');
    assert.deepEqual(page.errs, []);
  } finally { await br.close(); server.close(); }
});

test('the server never refuses a free plan set for the per email daily limit; the same email and design in a day is recorded once', async () => {
  const store = createMemoryStore();
  const body = leadBody({ ...good, consentText: 'I agree, shown text.' }, { name: 'Design A', site: { lot: {} } });
  const outs = [];
  for (let i = 0; i < 6; i++) outs.push(await call(store, body));
  assert.ok(outs.every((o) => o.ok === true), 'never refused');
  assert.equal((await store.listEnquiries()).length, 1, 'the same email and design is recorded once');
  for (let i = 0; i < 5; i++) assert.equal((await call(store, leadBody(good, { name: `Design ${i + 10}`, site: { lot: {} } }))).ok, true, 'other designs from the same email are recorded too');
  assert.equal((await store.listEnquiries()).length, 6);
  const other = await handleEnquiry({ body: { ...body, need: 'engineering', source: 'public', phone: '0412345678', email: 'x@example.com' }, request: new Request('http://x'), store: createMemoryStore(), config: {}, fetchImpl: null, now: () => Date.now(), clientIp: () => '5.5.5.5' });
  assert.equal(other.ok, true);
});

test('the real consent text the visitor saw is stored and shown, and Glide Inside lead errors do not name JCE Infrastructure', async () => {
  const body = leadBody({ ...good, consentText: 'Wording shown on the form.', builder: 'Example Homes' }, { name: 'D', site: { lot: {} } });
  const e = parseEnquiry(body);
  assert.equal(e.consentText, 'Wording shown on the form.');
  const text = summaryText(e, 'GI-ABCDE');
  assert.ok(text.includes('Wording shown on the form.') && !text.includes('about this design".'), 'the email shows the wording the visitor saw');
  const store = createMemoryStore();
  await call(store, body);
  assert.equal((await store.listEnquiries())[0].consentText, 'Wording shown on the form.');
  assert.equal((await store.listEnquiries())[0].orgName, '', 'never tied to a builder');
  const sent = await parseEnquiry({ ...body, orgName: 'Some Builder' });
  assert.equal(sent.orgName, '', 'a builder name on a free plan set lead is ignored: nothing is forwarded to builders');
  assert.throws(() => parseEnquiry({ ...body, consent: false }), (err) => /tick/i.test(err.message) && !/JCE/.test(err.message));
});

test('a lead the server did not take is kept in a small queue, tried again, and cleared once accepted', async () => {
  const st = mem();
  for (let i = 0; i < QUEUE_MAX + 2; i++) queueLead({ email: `a${i}@example.com`, projectName: 'D' }, st);
  assert.equal(queuedLeads(st).length, QUEUE_MAX, 'only a few entries');
  queueLead({ email: 'a4@example.com', projectName: 'D', again: 1 }, st);
  assert.equal(queuedLeads(st).length, QUEUE_MAX, 'the same email and design is one entry');
  let n = await flushLeadQueue(async () => { throw new Error('rejected'); }, st);
  assert.equal(n, QUEUE_MAX, 'still kept when the server says no');
  const sent = [];
  n = await flushLeadQueue(async (b) => { sent.push(b.email); }, st);
  assert.equal(n, 0);
  assert.equal(sent.length, QUEUE_MAX);
  assert.deepEqual(queuedLeads(st), [], 'cleared once accepted');
});

test('premium.saveLead keeps the lead and still downloads when the server refuses it, with neutral wording', () => {
  const p = fs.readFileSync(path.join(SRC, 'src/premium/premium.js'), 'utf8');
  const i = p.indexOf('async function saveLead');
  const block = p.slice(i, p.indexOf('async function downloadFreePlanSet'));
  assert.match(block, /queueLead\(body\)/);
  assert.ok(!/throw new Error\([^)]*(connection|could not be saved)/.test(block), 'a refusal no longer blocks the download or blames the connection');
  assert.ok(!/check your connection/i.test(block));
  assert.match(block, /rememberLead/);
});
