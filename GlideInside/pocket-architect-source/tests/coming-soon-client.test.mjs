// Coming soon features, client side: site cost rate precedence and GST, the one page summary, the site sheet cost note, the widget mode helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import * as H from './helpers/grading-harness.mjs';
import { mergeSettings, diffSettings, effectiveSettings, settingsSource, defaultSettings, rateOf } from '../src/premium/site-costs/rates.js';
import { estimateSiteCosts } from '../src/premium/site-costs/estimate.js';
import { gstOf, GST_NOTE } from '../src/premium/site-costs/gst.js';
import { toSitingReport, sitingSummaryFilename } from '../src/premium/exporters/siting-report.js';
import { siteCostNote } from '../src/premium/site-costs/note.js';
import { widgetIdFromSearch, hostOrigin } from '../src/portal/widget-mode.js';

const proj = () => H.residential({ fall: 6 });
const withBuilder = (settings, fn) => { const prev = globalThis.__ps; globalThis.__ps = { siteCostDefaults: { get: () => settings } }; try { return fn(); } finally { globalThis.__ps = prev; } };
function recorder() {
  const texts = [];
  class Rec extends jsPDF { constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (x, ...r) => (texts.push(Array.isArray(x) ? x.join(' ') : String(x)), t(x, ...r)); } }
  return { Rec, texts };
}

test('rates: design over builder default over standard', () => {
  const p = proj();
  const std = rateOf(effectiveSettings(p), 'cut_excavate', 'nsw');
  assert.ok(std > 0);
  withBuilder({ rates: { cut_excavate: { nsw: 99 } } }, () => {
    assert.equal(rateOf(effectiveSettings(p), 'cut_excavate', 'nsw'), 99);
    assert.equal(settingsSource(p), 'builder');
    p.siteCosts = { rates: { cut_excavate: { nsw: 123 } } };
    assert.equal(rateOf(effectiveSettings(p), 'cut_excavate', 'nsw'), 123);
    assert.equal(settingsSource(p), 'design');
  });
});

test('rates: an override changes the estimate and a diff round trips', () => {
  const p = proj();
  const a = estimateSiteCosts(p, {});
  const s = mergeSettings(defaultSettings(), { rates: { cut_excavate: { nsw: 500, qld: 500 } } });
  const b = estimateSiteCosts(p, { settings: s });
  if (a.ok && a.inputs.cutM3 > 0) assert.ok(b.total.likely > a.total.likely);
  const d = diffSettings(defaultSettings(), s);
  assert.equal(d.rates.cut_excavate.nsw, 500);
  assert.equal(rateOf(mergeSettings(defaultSettings(), d), 'cut_excavate', 'nsw'), 500);
  assert.equal(diffSettings(defaultSettings(), defaultSettings()), null);
});

test('rates: bad override values are ignored', () => {
  const s = mergeSettings(defaultSettings(), { region: 'zz', rates: { nope: { nsw: 1 }, cut_excavate: { nsw: -5, qld: 'x' } } });
  assert.equal(s.region, 'auto');
  assert.equal(s.rates.nope, undefined);
});

test('GST: ten percent, with the note', () => {
  assert.deepEqual(gstOf(1000), { ex: 1000, gst: 100, incl: 1100 });
  assert.match(GST_NOTE, /GST/);
  assert.match(GST_NOTE, /Indicative/);
  assert.ok(!/[–—]/.test(GST_NOTE));
});

test('one page summary: one A4 page, concept note, GST, builder name, no forbidden words', async () => {
  const { Rec, texts } = recorder();
  const bytes = await toSitingReport(proj(), { jsPDF: Rec, builder: { name: 'Sample Homes', logo: null, colours: { primary: '#1f4d3a', accent: '#d9822b' }, details: { phone: '0400 000 000' } }, layout: 'summary' });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  assert.equal(bytes.layout?.pages ?? 1, 1);
  const all = texts.join('\n');
  assert.match(all, /Sample Homes/);
  assert.match(all, /GST/);
  assert.match(all, /concept/i);
  assert.ok(!/compliant|Pocket Architect|approval.ready/i.test(all));
  assert.ok(!/[–—]/.test(all));
  assert.match(sitingSummaryFilename(proj()), /\.pdf$/);
});

test('plan set site note: one indicative line with GST both ways', async () => {
  const p = proj();
  const note = await siteCostNote(p, p.site.lot);
  if (note) { assert.match(note, /excluding GST/); assert.match(note, /including GST/); assert.match(note, /Not a quote/); assert.ok(!/[–—]/.test(note)); }
});

test('widget mode helpers', () => {
  assert.equal(widgetIdFromSearch('?embed=1&widget=acme-homes'), 'acme-homes');
  assert.equal(widgetIdFromSearch('?embed=1'), '');
  assert.equal(hostOrigin({ ancestorOrigins: ['https://builder.example'], search: '' }, null), 'https://builder.example');
});

import { jobOf, jceMailto, ORDER_CONSENT, ORDER_PRIVACY } from '../src/premium/ui/order-request.js';
import fs from 'node:fs';

test('order request: job details, share link only when the page is one, mailto only with a configured address', () => {
  const p = { name: 'Sample 3 bed', site: { lot: { address: '1 Sample St, Town NSW', lotNumber: '7', planLabel: 'DP 99' } } };
  const j = jobOf(p, { href: 'https://example.test/plan-studio/app/?share=abc123' });
  assert.equal(j.lotLabel, 'Lot 7 DP 99');
  assert.match(j.designLink, /share=abc123/);
  assert.equal(jobOf(p, { href: 'https://example.test/plan-studio/app/' }).designLink, '');
  assert.equal(jceMailto({}, { job: j, services: ['stormwater-concept'] }), '');
  assert.equal(jceMailto(undefined, { job: j }), '');
  const m = jceMailto({ jceEmail: 'orders@example.test' }, { job: j, services: ['stormwater-concept'] });
  assert.match(m, /^mailto:orders@example\.test\?subject=/);
  assert.match(decodeURIComponent(m), /Stormwater concept/);
});

test('order request: wording rules and no regional or defence mentions', () => {
  const src = fs.readFileSync(new URL('../src/premium/ui/order-request.js', import.meta.url), 'utf8') + ORDER_CONSENT + ORDER_PRIVACY;
  assert.ok(!/Queensland|FNQ|RPEQ|Gunnedah|Macksville|Defence|compliant|Pocket Architect/i.test(src));
  assert.ok(!/[–—]/.test(src));
  assert.ok(!/!/.test(ORDER_CONSENT + ORDER_PRIVACY));
});

// Review fixes (19/11/2026) --------------------------------------------------------------------------------------------------------
import { createEmbed } from '../src/ui/embed.js';
import { unansweredText } from '../src/premium/exporters/siting-summary.js';
import { createMockApi, memoryStorage, DEMO_LOGINS } from '../src/portal/mock-api.js';

const readSite = (p) => fs.readFileSync(new URL(`../../website-live/${p}`, import.meta.url), 'utf8');
const readSrc = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('summary: the title is the placed design name, falling back to the project name', async () => {
  const p = proj(); p.name = 'Single storey, 4 bedroom';
  const a = recorder();
  await toSitingReport(p, { jsPDF: a.Rec, layout: 'summary', title: 'Banksia 25' });
  assert.ok(a.texts.some((t) => t === 'Banksia 25'), 'the design row and heading read the placed design');
  assert.ok(!a.texts.some((t) => /Single storey, 4 bedroom/.test(t)));
  const b = recorder();
  await toSitingReport(p, { jsPDF: b.Rec, layout: 'summary' });
  assert.ok(b.texts.some((t) => /Single storey, 4 bedroom/.test(t)), 'no placed design: the project name as before');
  // premium.js hands the placed design name over
  assert.match(readSrc('src/premium/premium.js'), /store\.ui\?\.placedDesign\?\.name[\s\S]{0,200}title: placedName/);
});

test('summary: a layer with no open data says so, and easements point to the title', () => {
  assert.equal(unansweredText({ id: 'easement', answer: 'Not available' }), 'Not in open data, check the title');
  assert.equal(unansweredText({ id: 'heritage', answer: 'Not available' }), 'Not in open data, check the council map');
  assert.match(unansweredText({ id: 'flood', answer: 'Not checked' }), /^Not checked/);
  for (const t of [unansweredText({ id: 'easement' }), unansweredText({ id: 'flood' })]) assert.ok(!/[–—]|compliant/i.test(t));
});

test('embed bridge: the widget has no listeners, posts nothing and takes no messages', () => {
  const added = []; const posted = [];
  const parent = { postMessage: (...a) => posted.push(a) };
  globalThis.window = { parent, addEventListener: (t) => added.push(t), removeEventListener() {} };
  globalThis.location = { search: '?embed=1&widget=x&host=https%3A%2F%2Fwww.builder.example', origin: 'https://glideinside.com.au' };
  try {
    const w = createEmbed({ widget: true, handlers: { loadTemplate: () => assert.fail('no'), setMode: () => assert.fail('no') } });
    assert.deepEqual(added, [], 'no message, analytics or upgrade listener');
    assert.equal(w.ready(), false); assert.equal(w.post('ps:analytics', { event: 'x' }), false); assert.equal(w.upgrade(), false);
    assert.deepEqual(posted, []);
    assert.deepEqual(w.allowed, []);
    // the normal embed still listens and posts (the bridge for the site's own pages is unchanged)
    const n = createEmbed({ handlers: {} });
    assert.ok(added.includes('message') && added.includes('ps:analytics'));
    assert.equal(n.ready(), true);
  } finally { delete globalThis.window; delete globalThis.location; }
});

test('widget lockdown, wiring: the editor routes are no-ops, hidden from the first paint, and the Glide library is not offered', () => {
  const app = readSrc('src/app.js');
  assert.match(app, /const WIDGET = VIEWER && !COMMERCIAL_VIEWER/);
  assert.match(app, /const openGuided = \(\) => \{\s*if \(WIDGET\) return;/);
  assert.match(app, /openEditorDirect = \(\) => WIDGET \? null/);
  assert.match(app, /widget: WIDGET \} : \{\}/);
  assert.match(app, /api\.widgetMode = true; api\.lotDesigns = async \(\) => \[\]/);
  const card = readSrc('src/lotcard/lot-card.js');
  assert.match(card, /hidden: widget, dataset: \{ ps: 'lc-edit' \}/);
  assert.match(card, /if \(widget\) \{ toast\('Try another design/, 'the fit card guidance never opens the editor');
  assert.match(card, /widget \? \[\] : Array\.isArray\(catalogue\?\.templates\)/, 'no building types from the catalogue in the swap list');
  assert.match(card, /embed && !widget \? h\('button', \{ class: 'lc-full'/);
  assert.match(card, /canEngineer: \(\) => !widget && engineer\.available\(\)/);
  const css = readSrc('styles.css');
  for (const s of ['lc-edit', 'lc-full-editor', 'lc-upload', 'lc-pdf', 'lc-pdf-house', 'lc-send-engineer', 'embed-full']) assert.match(css, new RegExp(`\\.gw-widget \\[data-ps="${s}"\\]`), `${s} hidden by CSS from the first paint`);
  assert.match(readSrc('src/ui/embed-viewer.js'), /window\.__ps\?\.widgetMode\) return; \/\/ the website widget has no route to the editor/);
});

test('widget mode: when the config call fails the panel replaces the viewer, and it is reachable by tests', async () => {
  const { showUnavailable } = await import('../src/portal/widget-mode.js');
  const made = [];
  const mk = (tag) => { const e = { tag, nodeType: 1, children: [], style: {}, dataset: {}, attrs: {}, classList: { add: (...c) => (e.cls = [...(e.cls || []), ...c]), contains: (c) => (e.cls || []).includes(c) }, append(...n) { this.children.push(...n); }, setAttribute(k, v) { this.attrs[k] = v; }, set className(v) { this.cls = String(v).split(' '); }, get className() { return (this.cls || []).join(' '); }, addEventListener() {}, textContent: '' }; made.push(e); return e; };
  const shell = mk('div'); const doc = { body: mk('body'), head: mk('head'), createElement: mk, createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }), getElementById: () => null };
  doc.body.children.push(shell);
  globalThis.document = doc;
  let panel;
  try { panel = showUnavailable(doc); } finally { delete globalThis.document; }
  assert.ok(doc.body.classList.contains('gw-off'));
  assert.equal(shell.hidden, true); assert.equal(shell.style.display, 'none'); assert.equal('inert' in shell.attrs, true);
  const text = JSON.stringify(panel.children, (k, v) => (k === 'tag' || k === 'cls' ? undefined : v));
  assert.match(text, /This widget is not available right now/);
  assert.ok(!/editor|upload|PDF|Glide library/i.test(text.replace(/Glide Inside/g, '')));
});

test('mock api (review mode) keeps the secret out of the settings, as the server does', async () => {
  const api = createMockApi({ storage: memoryStorage() });
  await api.signIn(DEMO_LOGINS.admin);
  const first = await api.setWebhook({ url: 'https://hooks.zapier.com/hooks/catch/1/a/' });
  assert.match(first.secret, /^whsec_/);
  const got = await api.getWebhook();
  assert.equal('secret' in got, false);
  assert.ok(got.secretHint);
  assert.equal((await api.revealWebhookSecret()).secret, first.secret);
});

test('website: the widget card is Coming soon, the other five stay Available, the comparison cell is current, nothing uses a dash', () => {
  for (const f of ['index.html', 'for-builders/index.html']) {
    const s = readSite(f);
    assert.match(s, /gx-badge soon">Coming soon<\/span><h3>See it on your block widget<\/h3>/, `${f}: widget is Coming soon`);
    for (const t of ['Site overlays', 'Branded siting report', 'Site cost estimator', 'Engineering order menu from JCE', 'Lead inbox and integrations']) assert.match(s, new RegExp(`gx-badge now">Available</span><h3>${t}</h3>`), `${f}: ${t} is Available`);
    assert.ok(!/Site overlays and lead integrations coming soon/.test(s), `${f}: the stale comparison cell is gone`);
    assert.match(s, /Site overlays and a lead inbox with webhooks are available now\. The website widget is coming soon\./);
    const soonAt = s.indexOf('<h3 class="gx-sub">Coming soon</h3>');
    assert.ok(soonAt > s.indexOf('Lead inbox and integrations'), `${f}: the five Available cards sit under Available now`);
  }
});

test('privacy page: widget leads, webhooks, engineering orders, retention and deletion are covered in the house tone', () => {
  const s = readSite('privacy.html');
  assert.match(s, /id="widget-leads"/); assert.match(s, /id="engineering-orders"/);
  assert.match(s, /the builder whose widget it is/i);
  assert.match(s, /store the lead for that builder on their behalf/i);
  assert.match(s, /Webhooks and Zapier/);
  assert.match(s, /JCE Infrastructure Pty Ltd, ABN 29 699 165 663, a separate business/);
  assert.match(s, /deleted 24 months after/); assert.match(s, /after 90 days/);
  assert.match(s, /To have a widget lead deleted/); assert.match(s, /To have an engineering order request deleted/);
  assert.match(s, /Last updated 19\/11\/2026/);
  assert.ok(!/[–—]/.test(s), 'no em or en dashes'); assert.ok(!/compliant/i.test(s));
  // the two forms link to the sections that cover them
  assert.match(readSrc('src/portal/widget-mode.js'), /#widget-leads/); assert.match(readSrc('src/premium/ui/order-request.js'), /#engineering-orders/);
});

test('docs: the Cloudflare framing rule is written out, with the right order and the .htaccess finding', () => {
  const d = readSrc('docs/WIDGET_LEADS.md');
  assert.match(d, /http\.request\.uri\.query contains "widget="/);
  assert.match(d, /http\.request\.uri\.path eq "\/plan-studio\/app\/"/);
  assert.match(d, /frame-ancestors https:/);
  assert.match(d, /BELOW rule 1/);
  assert.match(d, /no `\.htaccess` in this repository/);
  assert.ok(!/An empty list allows any website\./.test(d) && !/updates the earlier lead/.test(d), 'the two stale statements are fixed');
  assert.match(fs.readFileSync(new URL('../../../SECURITY-HEADERS.md', import.meta.url), 'utf8'), /Rule 3 \(when the website widget is released\)/);
  assert.equal(readSite('widget/v1.js').includes('try { host = t ? document.querySelector(t) : null; }'), true, 'a bad data-target cannot throw');
});

test('admin engineering orders: a Delete button calls the delete endpoint and the table row markup stays balanced', async () => {
  const ui = fs.readFileSync(new URL('../src/portal/ui/admin-app.js', import.meta.url), 'utf8');
  assert.match(ui, /ps: 'order-delete'/);
  assert.match(ui, /api\.deleteEngineeringOrder\(o\.id\)/);
  assert.match(ui, /confirmDialog\(\{ title: `Delete \$\{o\.id\}\?`/);
  const calls = [];
  const { createAdminApi } = await import('../src/portal/admin-api.js');
  const api = createAdminApi({ fetchImpl: async (u, i) => { calls.push([i.method, String(u)]); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }, token: () => 't' });
  await api.deleteEngineeringOrder('AB12CD');
  assert.equal(calls[0][0], 'DELETE');
  assert.match(calls[0][1], /\/engineering-orders\/AB12CD$/);
});
