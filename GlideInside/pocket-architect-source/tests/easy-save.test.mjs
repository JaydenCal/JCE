// Saving a design is included, with no payment: the trimmed create profile form, the single consent tick, the 100 design default, the plain
// "profile full" message, the honest status for a design that is not saved, and no save path that reaches Unlock or a checkout.
// Browser parts run the built app in Chromium against the real Worker app (in-memory store); they skip where Playwright is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { readConfig } from '../server/lib/config.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const SITE = path.resolve(here, '../../website-live');
const read = (f) => fs.readFileSync(path.resolve(here, '..', f), 'utf8');
const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require('playwright')); } catch { try { ({ chromium } = require(require.resolve('playwright', { paths: ['/opt/npm-tools/node_modules'] }))); } catch { /* skipped below */ } }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

test('a free profile keeps 100 designs by default and the setting can still change it', () => {
  assert.equal(readConfig({}).freeProfileMaxDesigns, 100);
  assert.equal(readConfig({ FREE_PROFILE_MAX_DESIGNS: '7' }).freeProfileMaxDesigns, 7);
});

test('save code never reaches Unlock, checkout or a paywall', () => {
  for (const f of ['src/profile/ui.js', 'src/profile/controller.js', 'src/profile/policy.js', 'src/ui/files.js']) {
    const src = read(f).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /openUpgrade|premium\/|checkout|paywall|createCheckout|[Uu]nlock plans|isEntitled|entitled\b/, `${f} must not touch payment`);
  }
  const app = read('src/app.js');
  const saveFn = app.slice(app.indexOf('function save()'), app.indexOf('// Chrome ---'));
  assert.doesNotMatch(saveFn, /premium|upgrade|unlock|checkout/i);
});

test('the profile server has no payment or entitlement check on saving', () => {
  const src = read('server/lib/profiles.js');
  const save = src.slice(src.indexOf("limitMessage"), src.indexOf('linkPack') > 0 ? src.indexOf('linkPack') : undefined);
  assert.doesNotMatch(save, /402|PAYMENT|requireEntitlement|getEntitlement/);
});

test('website copy says saving is included, with the sign up fields and dates as agreed', () => {
  for (const f of ['help/index.html', 'pricing/index.html', 'plan-studio/index.html']) {
    const t = fs.readFileSync(path.join(SITE, f), 'utf8');
    assert.match(t, /Saving is included|saving to a profile is included|Saving designs to your profile, no payment needed/i, f);
  }
  const priv = fs.readFileSync(path.join(SITE, 'privacy.html'), 'utf8');
  assert.match(priv, /Last updated 20\/11\/2026/);
  assert.doesNotMatch(priv, /a phone number, a postcode or suburb, and whether you are a homeowner/);
  for (const f of ['help/index.html', 'pricing/index.html', 'plan-studio/index.html', 'privacy.html']) {
    const t = fs.readFileSync(path.join(SITE, f), 'utf8').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '');
    assert.doesNotMatch(t, /Pocket Architect|\bcompliant\b/i, f);
  }
});

async function rig(env = {}) {
  const origin = { v: '' };
  let app = null;
  const mkApp = (url) => createApp({ store: createMemoryStore(), env: { SITE_URL: url, ENTITLEMENT_SECRET: crypto.randomBytes(20).toString('hex'), ADMIN_TOKEN: crypto.randomBytes(18).toString('hex'), ...env } });
  const posted = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      if (u.pathname === '/api/profile/signup') posted.push(JSON.parse(body.toString()));
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
      const headers = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      const ck = r.headers.getSetCookie?.() || []; if (ck.length) headers['set-cookie'] = ck.map((c) => c.replace(/;\s*Secure/i, ''));
      res.writeHead(r.status, headers); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin.v = `http://127.0.0.1:${server.address().port}`;
  app = mkApp(origin.v);
  const browser = await chromium.launch();
  return { origin: origin.v, browser, posted, close: async () => { await browser.close(); server.close(); } };
}
const PW = () => `${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}-Qz9-${crypto.randomBytes(3).toString('hex')}`;

async function openApp(browser, origin, query, payments) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  page.on('request', (r) => { if (/\/api\/(checkout|orders|billing|stripe)|stripe\.com|\/api\/portal\/.*checkout/i.test(r.url())) payments.push(r.url()); });
  await page.goto(`${origin}/plan-studio/app/${query}`);
  await page.waitForFunction(() => window.__ps?.profilesReady, null, { timeout: 30000 });
  await page.evaluate(() => window.__ps.profilesReady);
  await page.waitForSelector('[data-action="profile-save"]:not([hidden])');
  await page.evaluate(() => document.querySelector('.pso-card .pso-link')?.click());
  return page;
}

test('create profile form: name, email, password, one consent tick, unticked marketing, no phone, postcode or role', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const r = await rig();
  const payments = [];
  try {
    const page = await openApp(r.browser, r.origin, '?template=house_single', payments);
    await page.click('[data-action="profile-save"]');
    await page.click('[data-action="prompt-create"]');
    await page.waitForSelector('#ps-prof-name');
    assert.equal(await page.textContent('.ps-modal-head h2'), 'Save your design');
    const intro = await page.textContent('[data-role="save-included"]');
    assert.match(intro, /Saving is included\. No payment or card needed\./);
    assert.equal(await page.locator('#ps-prof-phone, #ps-prof-post, #ps-prof-role, #ps-prof-privacy').count(), 0);
    assert.equal(await page.locator('.ps-prof-form input[type="checkbox"]').count(), 2, 'the consent tick and the marketing tick');
    assert.equal(await page.isChecked('#ps-prof-mk'), false, 'marketing is never ticked for the person');
    const consent = await page.textContent('label[for="ps-prof-terms"]');
    assert.equal(consent.trim(), 'I accept the site terms and privacy policy.');
    assert.equal(await page.locator('label[for="ps-prof-terms"] a').count(), 2);
    assert.equal(await page.locator('[data-action="signin-submit"], [data-tab="signin"]').count(), 1, 'Sign in is one click away');
    // the single tick is required
    await page.fill('#ps-prof-name', 'Sam Citizen'); await page.fill('#ps-prof-email', 'sam@example.com'); await page.fill('#ps-prof-pw', PW());
    await page.click('[data-action="create-submit"]');
    assert.match(await page.textContent('.ps-prof-err'), /accept the site terms and privacy policy/);
    assert.equal(r.posted.length, 0);
    await page.check('#ps-prof-terms');
    await page.click('[data-action="create-submit"]');
    await page.waitForFunction(() => /Saved to profile/.test(document.querySelector('[data-role="profile-status"]')?.textContent || ''), null, { timeout: 15000 });
    assert.equal(r.posted.length, 1);
    const b = r.posted[0];
    assert.equal(b.acceptTerms, true); assert.equal(b.acceptPrivacy, true); assert.equal(b.marketing, false);
    assert.ok(!('phone' in b) && !('postcode' in b) && !('role' in b));
    assert.deepEqual(payments, []);
  } finally { await r.close(); }
});

test('saving never reaches Unlock or a checkout: residential, commercial, signed out and signed in, and Save to file stays available', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const r = await rig();
  const payments = [];
  try {
    for (const query of ['?template=house_single', '?mode=commercial']) {
      const page = await openApp(r.browser, r.origin, query, payments);
      const skip = page.getByText('Skip to editor');
      if (await skip.count()) await skip.first().click(); // the guided flow covers the editor bar
      const unlockOpen = () => page.locator('.psp-layer [data-act="unlock"], .psp-layer [data-role="upgrade"], .psp-modal:has-text("Plan Pack")').count();
      const save = page.locator('.ps-topbar [data-action="save"]').first();
      if (await save.count()) {
        // On a narrow bar the file buttons live in the More menu: open it first.
        if (await page.locator('.ps-more-pop [data-action="save"]').count()) await page.locator('[data-ps="topbar-more"]').first().click();
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), save.click()]);
        assert.match(dl.suggestedFilename(), /\.glideinside\.json$/, `${query}: Save to file downloads without paying`);
        assert.equal(await unlockOpen(), 0, `${query}: no Unlock after Save to file`);
      }
      const btn = page.locator('[data-action="profile-save"]');
      if (await btn.count() && await btn.isVisible()) {
        await btn.click();
        assert.equal(await unlockOpen(), 0, `${query}: no Unlock after Save design`);
        assert.match(await page.textContent('[data-role="profile-prompt"]'), /Saving is included\. No payment or card needed\./);
      }
      await page.context().close();
    }
    assert.deepEqual(payments, []);
  } finally { await r.close(); }
});

test('a full profile says so in plain words with one click to My designs and Save to file; a new design is never shown as saved', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const r = await rig({ FREE_PROFILE_MAX_DESIGNS: '1' });
  const payments = [];
  try {
    const page = await openApp(r.browser, r.origin, '?template=house_single', payments);
    await page.click('[data-action="profile-save"]');
    await page.click('[data-action="prompt-create"]');
    await page.fill('#ps-prof-name', 'Sam Citizen'); await page.fill('#ps-prof-email', 'full@example.com'); await page.fill('#ps-prof-pw', PW());
    await page.check('#ps-prof-terms');
    await page.click('[data-action="create-submit"]');
    const status = () => page.textContent('[data-role="profile-status"]');
    await page.waitForFunction(() => /Saved to profile/.test(document.querySelector('[data-role="profile-status"]')?.textContent || ''), null, { timeout: 15000 });
    // another design replaces the open one (New, a file or the guided flow): it must not read as saved
    await page.evaluate(() => { const s = window.__ps.store; const p = JSON.parse(JSON.stringify(s.project)); p.id = `other-${Date.now()}`; p.name = 'Second design'; s.replace(p); });
    await page.waitForFunction(() => /Not saved to your profile yet/.test(document.querySelector('[data-role="profile-status"]')?.textContent || ''), null, { timeout: 5000 });
    assert.doesNotMatch(await status(), /Saved to profile/);
    // saving it hits the limit of 1
    await page.click('[data-action="profile-save"]');
    await page.waitForSelector('[data-role="profile-limit"]', { timeout: 10000 });
    assert.equal(await page.textContent('[data-role="profile-limit"]'), 'Your profile is full (1 design). Delete an old design in My designs to save this one, or use Save to file.');
    assert.equal(await page.locator('[data-action="limit-my-designs"]').count(), 1);
    assert.equal(await page.locator('[data-action="limit-save-file"]').count(), 1);
    const st = await status();
    assert.match(st, /Not saved\. Your profile is full \(1 design\)\./);
    assert.doesNotMatch(st, /Free up a spot/);
    assert.equal((await page.textContent('[data-action="profile-save"]')).trim(), 'Profile full');
    await page.click('[data-action="limit-my-designs"]');
    await page.waitForSelector('[data-role="my-designs"] .ps-prof-row');
    assert.deepEqual(payments, []);
  } finally { await r.close(); }
});
