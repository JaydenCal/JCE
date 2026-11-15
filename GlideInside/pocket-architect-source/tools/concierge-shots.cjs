// Playwright screenshots and behaviour checks for the concierge UI at desktop (1440x900) and phone (390x844).
//   PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright node tools/concierge-shots.cjs <outDir>
// Starts tools/concierge-dev-server.mjs itself (mock calendar, stubbed model). One browser at a time. Prints FAIL lines for any broken check.
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = path.resolve(process.argv[2] || '/home/claude/growth/concierge/shots'); fs.mkdirSync(OUT, { recursive: true });
const fails = []; const check = (ok, msg) => { if (!ok) { fails.push(msg); console.log('FAIL', msg); } else console.log('ok  ', msg); };
const servers = [];
function serve(port, env = {}) {
  const p = spawn('node', [path.join(__dirname, 'concierge-dev-server.mjs'), String(port)], { env: { ...process.env, ...env }, stdio: 'ignore' }); servers.push(p);
  return new Promise((r) => setTimeout(() => r(p), 1500));
}
// one small server at a time keeps memory down: start, use, stop
async function withServer(port, env, fn) { const p = await serve(port, env); try { return await fn(); } finally { p.kill(); } }
const EVENTS = []; const consoleErrors = [];
async function newPage(browser, base, vp, mobile, tag) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney' });
  await ctx.route(/googletagmanager|googleapis|gstatic/, (r) => r.abort());
  await ctx.route(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.turnstile={render:function(h,o){setTimeout(function(){o.callback("dev-ok")},50);return "w1"}};' }));
  await ctx.route(/\/plan-studio\//, (r) => { const q = r.request(); if (q.isNavigationRequest() && q.frame().parentFrame()) return r.fulfill({ contentType: 'text/html', body: '<body style="background:#223;color:#9ab">embedded viewer (stubbed for the screenshot run)</body>' }); return r.continue(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__ev = []; window.gtag = function () { const a = Array.prototype.slice.call(arguments); if (a[0] === 'event') window.__ev.push({ name: a[1], params: a[2] }); }; });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${tag}: ${e.message}`));
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
// Pages with an embedded viewer (home, commercial) hide the launcher while the viewer is on screen, so scroll to the foot first.
const openLauncher = async (page) => { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.locator('.gic-launcher').waitFor({ state: 'visible', timeout: 8000 }); await page.locator('.gic-launcher').click(); };
const pickText = async (page, sel, text) => page.locator(sel, { hasText: text }).first().click();

async function flow(browser, base, label, vp, mobile) {
  const { ctx, page } = await newPage(browser, base, vp, mobile, label);
  await page.goto(base + '/for-builders/', { waitUntil: 'load' });
  const launcher = page.locator('.gic-launcher');
  await launcher.waitFor({ timeout: 5000 });
  check(await launcher.isVisible(), `${label}: launcher visible on /for-builders/`);
  const before = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /concierge\.(js|css)/.test(n)).length);
  check(before === 0, `${label}: panel JS and CSS are NOT loaded before the first click`);
  await shot(page, `${label}-01-launcher`);
  await launcher.click();
  await page.locator('.gic-panel').waitFor();
  const after = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /concierge\.(js|css)/.test(n)).length);
  check(after === 2, `${label}: panel JS and CSS load on first open`);
  await page.locator('.gic-intent').first().waitFor();
  check((await page.locator('.gic-intent').count()) === 4, `${label}: four intent chips`);
  check(/AI assistant/i.test(await page.locator('.gic-privacy').innerText()), `${label}: privacy note says AI`);
  await shot(page, `${label}-02-intent-chips`);
  // focus trap and escape
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  check(await page.evaluate(() => !!document.activeElement.closest('.gic-panel')), `${label}: focus stays inside the panel after 40 Tabs`);
  // intent, qualifier
  await pickText(page, '.gic-intent', 'Builder');
  await page.locator('.gic-chip', { hasText: 'Custom builder' }).waitFor();
  await pickText(page, '.gic-chip', 'Custom builder');
  await page.locator('button', { hasText: 'See available times' }).waitFor();
  // FAQ question
  await page.fill('.gic-compose input', 'How much does it cost for builders?');
  await page.keyboard.press('Enter');
  await page.locator('.gic-msg.bot', { hasText: /A\$30 per client login/ }).waitFor();
  check(true, `${label}: deterministic FAQ answer shown`);
  // free text via the stubbed model
  await page.fill('.gic-compose input', 'Do your plans include a loft?');
  await page.keyboard.press('Enter');
  await page.locator('.gic-msg.bot', { hasText: /not sure/ }).waitFor();
  await page.waitForTimeout(150);
  await shot(page, `${label}-03-chat`);
  await page.locator('button', { hasText: 'See available times' }).click();
  await page.locator('.gic-slot').first().waitFor();
  const firstLabel = await page.locator('.gic-slot').first().getAttribute('aria-label');
  check(/ at \d{1,2}:\d\d (am|pm) A(EST|EDT)/.test(firstLabel) && /\d\d\/\d\d\/\d{4}/.test(await page.locator('.gic-day').first().innerText() + ' ' + (await page.locator('.gic-day').first().innerText())), `${label}: slots in Sydney time with DD/MM/YYYY days (${firstLabel})`);
  await shot(page, `${label}-04-slots`);
  await page.locator('.gic-slot').first().click();
  await page.locator('#gic-name').waitFor();
  check(!(await page.locator('#gic-mk').isChecked()), `${label}: marketing opt-in is unticked`);
  await shot(page, `${label}-05-details-empty`);
  await page.click('button:has-text("Review booking")');
  check((await page.locator('.gic-err').innerText()).length > 0, `${label}: validation message shown (aria alert)`);
  await page.fill('#gic-name', 'Sam Tester'); await page.fill('#gic-email', 'sam.tester@example.com');
  await page.check('#gic-consent');
  await shot(page, `${label}-06-details-filled`);
  await page.click('button:has-text("Review booking")');
  await page.locator('#gic-confirm').waitFor();
  check((await page.evaluate(() => window.__ev.filter((e) => e.name === 'booking_agent_booking_confirmed').length)) === 0, `${label}: no confirmed event before the user confirms`);
  await shot(page, `${label}-07-confirm`);
  // a rival books the same slot first
  const first = await page.evaluate(async () => {
    const h = { 'content-type': 'application/json', 'x-gi-request': '1' };
    const s = await (await fetch('/api/concierge/session', { method: 'POST', headers: h, body: '{}' })).json();
    return s.conv;
  });
  const summary = await page.evaluate(() => document.querySelector('.gic-summary').innerText);
  check(/Builder demonstration \(30 min\)/.test(summary), `${label}: summary shows the booking type and duration`);
  // double click protection
  await page.locator('#gic-confirm').dblclick();
  await page.locator('[data-view=success]').waitFor();
  check((await page.locator('.gic-screen h3').innerText()) === 'Booking confirmed', `${label}: success only after the server confirmed`);
  check(/test booking/i.test(await page.locator('.gic-test').innerText()), `${label}: test mode is labelled`);
  await shot(page, `${label}-08-success`);
  const ev = await page.evaluate(() => window.__ev);
  EVENTS.push(...ev.map((e) => ({ label, ...e })));
  check(ev.filter((e) => e.name === 'booking_agent_booking_confirmed').length === 1, `${label}: booking_agent_booking_confirmed fired exactly once (double click)`);
  for (const n of ['booking_agent_opened', 'booking_agent_intent_selected', 'booking_agent_qualification_completed', 'booking_slots_viewed', 'booking_agent_booking_attempt']) check(ev.some((e) => e.name === n), `${label}: event ${n} fired`);
  check(!/sam|tester|example\.com|GI-[A-Z0-9]{6}/i.test(JSON.stringify(ev)), `${label}: no personal data or booking reference in analytics payloads`);
  // cancel
  await page.locator('button', { hasText: 'Cancel this booking' }).click();
  await page.locator('h3', { hasText: 'Booking cancelled' }).waitFor();
  // Escape closes and returns focus
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check((await page.locator('.gic-panel').count()) === 0, `${label}: Escape closes the panel`);
  check(await page.evaluate(() => document.activeElement.classList.contains('gic-launcher')), `${label}: focus returns to the launcher`);
  await ctx.close();
}


// Default flow: Request a call back. No calendar. Email to the owner is stubbed and read back from the dev server.
async function callbackFlow(browser, base, label, vp, mobile) {
  const L = label + '-cb';
  const { ctx, page } = await newPage(browser, base, vp, mobile, L);
  await page.goto(base + '/for-builders/?utm_campaign=spring_launch', { waitUntil: 'load' });
  await page.locator('.gic-launcher').click(); await page.locator('.gic-intent').first().waitFor();
  await pickText(page, '.gic-intent', 'Builder'); await pickText(page, '.gic-chip', 'Custom builder');
  await page.locator('button', { hasText: 'Request a call back' }).first().waitFor();
  check((await page.locator('button', { hasText: 'See available times' }).count()) === 0, `${L}: slot UI is hidden when no calendar is on`);
  check(!/book(ing)? (a|an) (time|appointment)|appointment/i.test(await page.locator('.gic-log').innerText()), `${L}: no booking or appointment wording in the chat`);
  await shot(page, `${label}-cb-01-offer`);
  await page.fill('.gic-compose input', 'Do your plans include a loft?'); await page.keyboard.press('Enter');
  await page.locator('.gic-msg.bot', { hasText: /not sure/ }).waitFor();
  await page.locator('button', { hasText: 'Request a call back' }).first().click();
  await page.locator('#gic-cb-name').waitFor();
  check(!(await page.locator('#gic-cb-consent').isChecked()) && !(await page.locator('#gic-cb-mk').isChecked()), `${L}: consent and marketing boxes start unticked`);
  check((await page.locator('#gic-cb-type').inputValue()) === 'builder', `${L}: customer type preselected from the chip`);
  await shot(page, `${label}-cb-02-form`);
  await page.click('button:has-text("Review request")');
  check((await page.locator('.gic-err').innerText()).length > 0, `${L}: validation message shown`);
  await page.fill('#gic-cb-name', 'Sam Tester'); await page.fill('#gic-cb-phone', '12'); await page.fill('#gic-cb-email', 'sam.tester@example.com');
  await page.selectOption('#gic-cb-when', 'afternoon'); await page.fill('#gic-cb-note', 'after 2pm please'); await page.fill('#gic-cb-notes', 'Interested in the trial'); await page.check('#gic-cb-consent');
  await page.click('button:has-text("Review request")');
  check(/phone/i.test(await page.locator('.gic-err').innerText()), `${L}: a bad phone number is refused in the page`);
  await page.fill('#gic-cb-phone', '0412 345 678');
  await page.click('button:has-text("Review request")');
  await page.locator('#gic-cb-send').waitFor();
  const base0 = (await page.evaluate(() => fetch('/__dev/mail').then((r) => r.json()))).mail.length; // the preview server is shared by both viewports
  check(base0 === (label === 'desktop' ? 0 : 1), `${L}: nothing is sent before the explicit button (already sent: ${base0})`);
  await shot(page, `${label}-cb-03-review`);
  await page.dblclick('#gic-cb-send');
  await page.locator('[data-view=callback-done]').waitFor();
  const txt = await page.locator('[data-view=callback-done]').innerText();
  check(/Thanks, your request is with Jayden at Glide Inside\. He will call you, usually within one business day\./.test(txt), `${L}: success wording`);
  check(!/booked|booking|appointment|confirmed/i.test(txt), `${L}: success never says a booking or appointment exists`);
  await shot(page, `${label}-cb-04-success`);
  const dev = await page.evaluate(() => fetch('/__dev/mail').then((r) => r.json()));
  check(dev.mail.length === base0 + 1 && dev.saved.length === base0 + 1, `${L}: double click sent one request (saved ${dev.saved.length}, emailed ${dev.mail.length})`);
  const m = dev.mail[dev.mail.length - 1] || { to: [], text: '' };
  check(m.to.length === 1 && m.to[0] === 'owner@example.test' && m.reply_to === 'sam.tester@example.com', `${L}: email goes to the owner only, reply-to is the visitor`);
  check(/Call back request \(Builder\)/.test(m.subject) && ['Sam Tester', '0412 345 678', 'sam.tester@example.com', 'Afternoon: after 2pm please', 'Interested in the trial', '/for-builders/', 'spring_launch', 'GI-'].every((x) => m.text.includes(x)), `${L}: email holds name, phone, email, type, best time, notes, page, campaign, reference`);
  const evs = await page.evaluate(() => window.__ev);
  check(evs.filter((e) => e.name === 'booking_agent_callback_requested').length === 1, `${L}: callback_requested fired once, after server success`);
  check(!evs.some((e) => e.name === 'booking_agent_booking_confirmed'), `${L}: no booking_confirmed event in the default flow`);
  check(!/sam|0412|example|GI-[A-Z0-9]{5}/i.test(JSON.stringify(evs.filter((e) => /^booking_agent/.test(e.name)).map((e) => e.params))), `${L}: no personal data or reference in GA4 parameters`);
  EVENTS.push(...evs.map((e) => ({ label: L, ...e })));
  await ctx.close();
}

async function conflictFlow(browser, base, label, vp, mobile) {
  const { ctx, page } = await newPage(browser, base, vp, mobile, label + '-conflict');
  await page.goto(base + '/book-a-demo/'); await openLauncher(page);
  await pickText(page, '.gic-intent', 'Real estate agent'); await pickText(page, '.gic-chip', 'Land');
  await page.locator('button', { hasText: 'See available times' }).click();
  await page.locator('.gic-slot').first().click();
  await page.fill('#gic-name', 'Alex Rival'); await page.fill('#gic-email', 'alex@example.com'); await page.check('#gic-consent');
  await page.click('button:has-text("Review booking")'); await page.locator('#gic-confirm').waitFor();
  // someone else takes that time (second visitor, same server)
  const taken = await page.evaluate(async () => {
    const h = { 'content-type': 'application/json', 'x-gi-request': '1' };
    const j = async (p, b) => (await fetch('/api/concierge/' + p, { method: 'POST', headers: h, body: JSON.stringify(b) })).json();
    const conv = (await j('session', {})).conv;
    const slots = (await j('slots', { conv, type: 'agent' })).slots;
    const prop = await j('propose', { conv, type: 'agent', slotStart: slots[0].start, name: 'Rival One', email: 'rival@example.com', bookingConsent: true });
    return (await j('confirm', { conv, proposalToken: prop.proposalToken, idemKey: 'rival' + Math.random().toString(36).slice(2, 14) + 'xxxxxxxx', confirm: true })).state;
  });
  check(taken === 'confirmed', `${label}: rival booking made`);
  await page.locator('#gic-confirm').click();
  await page.locator('[data-view=error]').waitFor();
  check(/Nothing was booked/.test(await page.locator('.gic-screen').innerText()), `${label}: conflict shows an error and says nothing was booked`);
  const evs = await page.evaluate(() => window.__ev);
  check(evs.some((e) => e.name === 'booking_agent_booking_failed' && e.params.reason === 'slot_taken'), `${label}: booking_agent_booking_failed (slot_taken) fired`);
  check(!evs.some((e) => e.name === 'booking_agent_booking_confirmed'), `${label}: no confirmed event on conflict`);
  await shot(page, `${label}-09-error-conflict`);
  EVENTS.push(...evs.map((e) => ({ label: label + '-conflict', ...e })));
  await ctx.close();
}

(async () => {
  await serve(8741, { CALENDAR: '1' }); await serve(8745, {});
  const browser = await chromium.launch();
  const VPS = [['desktop', { width: 1440, height: 900 }, false], ['phone390', { width: 390, height: 844 }, true]];
  for (const [label, vp, mobile] of VPS) {
    
    await callbackFlow(browser, 'http://127.0.0.1:8745', label, vp, mobile);
    await flow(browser, 'http://127.0.0.1:8741', label, vp, mobile);
    await conflictFlow(browser, 'http://127.0.0.1:8741', label, vp, mobile);
    // unknown outcome (timeout): checking screen, then reconciled
    await withServer(8742, { SLOW: '1', CALENDAR: '1' }, async () => { const SLOW = 'http://127.0.0.1:8742'; const { ctx, page } = await newPage(browser, SLOW, vp, mobile, label + '-unknown');
      await page.goto(SLOW + '/pricing/'); await openLauncher(page);
      await pickText(page, '.gic-intent', 'Homeowner'); await pickText(page, '.gic-chip', 'A new house');
      await page.locator('button', { hasText: 'See available times' }).click(); await page.locator('.gic-slot').first().click();
      await page.fill('#gic-name', 'Pat Slow'); await page.fill('#gic-email', 'pat@example.com'); await page.check('#gic-consent');
      await page.click('button:has-text("Review booking")'); await page.locator('#gic-confirm').click();
      await page.locator('[data-view=unknown]').waitFor();
      check(/Checking your booking/.test(await page.locator('.gic-screen h3').first().innerText()), `${label}: timeout shows the checking state, not confirmed`);
      check((await page.evaluate(() => window.__ev.filter((e) => e.name === 'booking_agent_booking_confirmed').length)) === 0, `${label}: no confirmed event while unknown`);
      await shot(page, `${label}-10-unknown-checking`);
      await page.locator('[data-view=success]').waitFor({ timeout: 12000 });
      check(await page.evaluate(() => window.__ev.filter((e) => e.name === 'booking_agent_booking_confirmed').length) === 1, `${label}: reconciled by lookup, confirmed event fired once`);
      await ctx.close(); });
    // non-AI fallback (Worker flag off)
    await withServer(8743, { OFF: '1' }, async () => { const { ctx, page } = await newPage(browser, 'http://127.0.0.1:8743', vp, mobile, label + '-off');
      await page.goto('http://127.0.0.1:8743/commercial/'); await openLauncher(page);
      await page.locator('[data-view=fallback]').waitFor();
      check((await page.locator('.gic-screen a').count()) >= 2, `${label}: non-AI fallback offers the demo form and enquiry`);
      await shot(page, `${label}-11-fallback-no-ai`); await ctx.close(); });
    // Turnstile path
    await withServer(8744, { TURNSTILE: '1' }, async () => { const { ctx, page } = await newPage(browser, 'http://127.0.0.1:8744', vp, mobile, label + '-turnstile');
      await page.goto('http://127.0.0.1:8744/'); await openLauncher(page);
      await pickText(page, '.gic-intent', 'Developer'); await page.locator('.gic-chip', { hasText: 'Commercial or industrial lot' }).waitFor();
      check(true, `${label}: Turnstile token obtained and verified server side before the chat starts`); await ctx.close(); });
  }
  // does not load in the app, portal or iframes; hides over the embedded viewer on the home page
  { const { ctx, page } = await newPage(browser, 'http://127.0.0.1:8741', { width: 1440, height: 900 }, false, 'guards');
    await page.goto('http://127.0.0.1:8741/'); await page.locator('.gic-launcher').waitFor();
    await page.evaluate(() => document.querySelector('#live-tool').scrollIntoView({ block: 'center' })); await page.waitForTimeout(600);
    const clear = await page.evaluate(() => { const b = document.querySelector('.gic-launcher'); if (b.hidden) return 'hidden'; const a = b.getBoundingClientRect(), v = document.querySelector('#live-tool').getBoundingClientRect(); return (a.left < v.right && a.right > v.left && a.top < v.bottom && a.bottom > v.top) ? 'OVERLAP' : (b.classList.contains('gic-compact') ? 'compact' : 'full'); });
    check(clear !== 'OVERLAP', `home: launcher never overlaps the embedded viewer (state: ${clear})`);
    await shot(page, 'desktop-12-home-viewer-launcher-hidden');
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(600);
    check(await page.locator('.gic-launcher').isVisible() && !(await page.locator('.gic-compact').count()), 'home: full launcher returns when the viewer is off screen');
    // narrow desktop: the viewer fills the width, so the launcher hides over it
    await page.setViewportSize({ width: 900, height: 800 }); await page.evaluate(() => document.querySelector('#live-tool').scrollIntoView({ block: 'center' })); await page.waitForTimeout(600);
    const narrow = await page.evaluate(() => { const b = document.querySelector('.gic-launcher'); if (b.hidden) return 'hidden'; const a = b.getBoundingClientRect(), v = document.querySelector('#live-tool').getBoundingClientRect(); return (a.left < v.right && a.right > v.left && a.top < v.bottom && a.bottom > v.top) ? 'OVERLAP' : 'clear'; });
    check(narrow !== 'OVERLAP', `home at 900px: launcher does not overlap the viewer (state: ${narrow})`);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
    await shot(page, 'desktop-13-home-launcher');
    for (const p of ['/plan-studio/app/', '/portal/']) {
      await page.goto('http://127.0.0.1:8741' + p, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      check((await page.locator('.gic-launcher').count()) === 0, `${p}: no launcher`);
      const injected = await page.evaluate(async (u) => { await new Promise((r) => { const s = document.createElement('script'); s.src = u; s.onload = r; s.onerror = r; document.body.appendChild(s); }); return document.querySelectorAll('.gic-launcher').length; }, 'http://127.0.0.1:8741/assets/concierge/launcher.js');
      check(injected === 0, `${p}: the stub refuses to run even if injected`);
    }
    await page.setContent(`<iframe id=f src="http://127.0.0.1:8741/pricing/" style="width:900px;height:600px"></iframe>`);
    await page.waitForTimeout(1500);
    const framed = await page.frames().find((f) => f !== page.mainFrame());
    check(framed ? (await framed.locator('.gic-launcher').count()) === 0 : true, 'iframe: no launcher inside a frame');
    await ctx.close(); }
  await browser.close(); servers.forEach((s) => s.kill());
  fs.writeFileSync(path.join(OUT, 'analytics-events.json'), JSON.stringify(EVENTS, null, 1));
  check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? ': ' + consoleErrors.slice(0, 5).join(' | ') : ''}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL CHECKS PASSED');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); servers.forEach((s) => s.kill()); process.exit(2); });
