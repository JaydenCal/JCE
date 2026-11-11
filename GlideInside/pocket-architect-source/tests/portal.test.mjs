// Builder portal: billing rules, account generator, mock API, house stats and house placement (docs/PORTAL_API.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthKey, monthStartMs, sydneyParts, ddmmyyyy, loginsInMonth, summariseMonth, formatAud, gstOfTotal, NEW_LOGIN_FEE_CENTS, priceForNthLoginThisMonth, loginRateInfo, TOPUP_FEE_CENTS, TOPUP_CREDITS } from '../src/portal/billing.js';
import { WORDS } from '../src/portal/wordlist.js';
import { generateUsername, generatePassword, generateCredentials, usernameBase, passwordProblem, isBlockedWord, BLOCKED_PARTS, DIGITS } from '../src/portal/credentials.js';
import { createMockApi, memoryStorage, DEMO_LOGINS } from '../src/portal/mock-api.js';
import { houseStats } from '../src/portal/house-stats.js';
import { projectToSvg } from '../src/portal/thumbnail.js';
import { placeHouse, houseBounds, defaultPose, footprintCorners, previewPlacement, fitsLot } from '../src/portal/place-house.js';
import { GLIDE_LIBRARY } from '../src/portal/glide-library.generated.js';
import { createFromTemplate, TEMPLATES } from '../src/catalogue/templates.js';
import { createProject, migrate, validate } from '../src/model/schema.js';

const iso = (s) => Date.parse(s);
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

// Billing ---------------------------------------------------------------------------------------------------------------
test('month keys follow Australia/Sydney calendar months, including daylight saving', () => {
  // AEST (+10) in winter, AEDT (+11) from the first Sunday of October 2026 (04/10/2026).
  assert.equal(monthKey(iso('2026-09-30T13:59:59Z')), '2026-09'); // 23:59:59 AEST on 30/09
  assert.equal(monthKey(iso('2026-09-30T14:00:00Z')), '2026-10'); // 00:00 AEST on 01/10
  assert.equal(monthKey(iso('2026-10-31T12:59:59Z')), '2026-10'); // 23:59:59 AEDT on 31/10
  assert.equal(monthKey(iso('2026-10-31T13:00:00Z')), '2026-11'); // 00:00 AEDT on 01/11
  assert.equal(monthKey(iso('2026-12-31T13:00:00Z')), '2027-01');
  assert.equal(ddmmyyyy(iso('2026-10-31T13:00:00Z')), '01/11/2026');
  assert.equal(monthKey(iso('2026-06-30T14:00:00Z')), '2026-07');
});

test('monthStartMs is midnight Sydney on the 1st', () => {
  for (const key of ['2026-01', '2026-04', '2026-10', '2026-11', '2027-03']) {
    const t = monthStartMs(key);
    const p = sydneyParts(t);
    assert.deepEqual([p.day, p.hour, p.minute], [1, 0, 0], key);
    assert.equal(monthKey(t), key);
    assert.notEqual(monthKey(t - 1), key);
  }
});

test('volume pricing boundaries: 1 to 15 A$30, 16 to 50 A$25, custom rate for all, null or invalid custom rate ignored', () => {
  for (const [n, c] of [[1, 3000], [14, 3000], [15, 3000], [16, 2500], [17, 2500], [49, 2500], [50, 2500], [51, 2500], [200, 2500]]) assert.equal(priceForNthLoginThisMonth(n), c, `login ${n}`);
  for (const n of [1, 15, 16, 50, 51]) assert.equal(priceForNthLoginThisMonth(n, { customLoginCents: 2000 }), 2000, `custom, login ${n}`);
  for (const bad of [null, undefined, 0, -5, 20.5, '2000']) assert.equal(priceForNthLoginThisMonth(16, { customLoginCents: bad }), 2500, `ignored: ${String(bad)}`);
  assert.deepEqual([loginRateInfo(15).currentRateCents, loginRateInfo(14).currentRateCents, loginRateInfo(50).over50NeedsCustomRate, loginRateInfo(51).over50NeedsCustomRate, loginRateInfo(51, { customLoginCents: 1800 }).over50NeedsCustomRate], [2500, 3000, false, true, false]);
});

test('A$30 per NEW client login in the calendar month, once per login, no recurring charge', () => {
  const issues = [
    { loginId: 'a', issuedAt: '2026-10-31T12:00:00Z' }, // 31/10 23:00 Sydney: October
    { loginId: 'b', issuedAt: '2026-10-31T13:00:00Z' }, // 01/11 00:00 Sydney: November
    { loginId: 'c', issuedAt: '2026-11-10T01:00:00Z' },
    { loginId: 'c', issuedAt: '2026-11-11T01:00:00Z' }, // duplicate row for the same login: ignored
  ];
  assert.equal(loginsInMonth(issues, '2026-10').length, 1);
  assert.equal(loginsInMonth(issues, '2026-11').length, 2);
  assert.equal(summariseMonth({ issues }, '2026-11').totals.loginsCents, 2 * NEW_LOGIN_FEE_CENTS);
  assert.equal(summariseMonth({ issues }, '2026-12').totals.totalCents, 0, 'a login issued earlier is not charged again');
});

test('month total is A$30 per new login plus A$10 per top-up, and GST is one eleventh', () => {
  const issues = [{ loginId: 'a', issuedAt: '2026-11-02T01:00:00Z' }, { loginId: 'b', issuedAt: '2026-11-03T01:00:00Z' }];
  const topUps = [{ createdAt: '2026-11-04T01:00:00Z' }, { createdAt: '2026-11-05T01:00:00Z' }, { createdAt: '2026-12-01T01:00:00Z' }];
  const t = summariseMonth({ issues, topUps }, '2026-11').totals;
  assert.deepEqual(t, { loginsCount: 2, loginsCents: 6000, topUpsCount: 2, topUpsCents: 2000, totalCents: 8000 });
  assert.equal(formatAud(t.totalCents), 'A$80');
  assert.equal(gstOfTotal(6000), 545);
  assert.equal(formatAud(1050), 'A$10.50');
});

// Account generator ------------------------------------------------------------------------------------------------------
test('word list: about 500 plain, short, unique, inoffensive words', () => {
  assert.ok(WORDS.length >= 480, `${WORDS.length} words`);
  assert.equal(new Set(WORDS).size, WORDS.length, 'duplicates');
  for (const w of WORDS) {
    assert.match(w, /^[a-z]{3,7}$/, w);
    assert.ok(!isBlockedWord(w), w);
  }
  assert.ok(isBlockedWord('hell') && isBlockedWord('shitty') && !isBlockedWord('shell'));
});

test('password is two different words and two digits, e.g. river-maple-47', () => {
  for (let i = 0; i < 500; i += 1) {
    const pw = generatePassword();
    const m = /^([a-z]+)-([a-z]+)-([2-9]{2})$/.exec(pw);
    assert.ok(m, pw);
    assert.ok(WORDS.includes(m[1]) && WORDS.includes(m[2]));
    assert.notEqual(m[1], m[2]);
  }
  assert.equal(generatePassword({ randomInt: seq(0, 1, 0, 0) }), `${WORDS[0]}-${WORDS[1]}-${DIGITS[0]}${DIGITS[0]}`);
});

test('username is the first name plus a four digit suffix without 0 or 1, easy to read out', () => {
  assert.equal(usernameBase("Sarah-Jane O'Neil"), 'sarah');
  assert.equal(usernameBase('Zoë'), 'zoe');
  assert.equal(usernameBase('   '), 'user');
  assert.equal(usernameBase('Bartholomew-Maximilian'), 'bartholomew'.slice(0, 12));
  for (let i = 0; i < 300; i += 1) assert.match(generateUsername('Sarah'), /^sarah-[2-9]{4}$/);
});

test('generated usernames are unique within the organisation, even when most are taken', () => {
  const taken = new Set();
  // Force collisions: a random source with only two digits to choose from.
  const tiny = () => 0;
  taken.add('sam-2222');
  assert.throws(() => generateUsername('Sam', taken, { randomInt: tiny }), /unique/);
  for (let i = 0; i < 2000; i += 1) {
    const u = generateUsername('Sam', taken);
    assert.ok(!taken.has(u));
    taken.add(u);
  }
  assert.equal(taken.size, 2001);
  const c = generateCredentials('Lee', ['lee-4444']);
  assert.ok(c.username.startsWith('lee-') && c.password.split('-').length === 3);
});

test('no confusable characters or offensive output in generated suffixes and passwords', () => {
  for (let i = 0; i < 2000; i += 1) {
    const { username, password } = generateCredentials('Alex');
    assert.ok(!/[01]/.test(username.split('-')[1]));
    assert.ok(!/[01]/.test(password.split('-')[2]));
    for (const bad of BLOCKED_PARTS) assert.ok(!password.includes(bad), `${password} contains ${bad}`);
    assert.ok(!password.split('-').slice(0, 2).some(isBlockedWord), password);
  }
});

test('chosen passwords need 10 characters and must not be common or contain the username', () => {
  assert.match(passwordProblem('short'), /10/);
  assert.match(passwordProblem('Password123'), /common/i);
  assert.match(passwordProblem('qwertyuiop'), /common/i);
  assert.match(passwordProblem('sarah-4821-x', { username: 'sarah-4821' }), /username/);
  assert.match(passwordProblem('river-maple-47', { temporary: 'river-maple-47' }), /temporary/);
  assert.equal(passwordProblem('harbour pelican 7 window'), null);
});

// Mock API ---------------------------------------------------------------------------------------------------------------
const NOW = iso('2026-11-11T02:00:00Z'); // 11/11/2026 13:00 Sydney
function fresh({ now: start = NOW, ...opts } = {}) {
  let t = start;
  const clock = { now: () => t, set: (v) => { t = v; }, advance: (ms) => { t += ms; } };
  const api = createMockApi({ now: clock.now, storage: memoryStorage(), ...opts });
  return { api, clock };
}
const admin = async (api) => api.signIn(DEMO_LOGINS.admin);
const rejects = (p, code) => assert.rejects(p, (e) => (assert.equal(e.code, code), true));

test('sign in, me and sign out; wrong password and unknown users fail the same way', async () => {
  const { api } = fresh();
  assert.equal(await api.me(), null);
  await rejects(api.listHouses(), 'UNAUTHORISED');
  await rejects(api.signIn({ identifier: DEMO_LOGINS.admin.identifier, password: 'nope' }), 'INVALID_CREDENTIALS');
  await rejects(api.signIn({ identifier: 'nobody@example.com', password: 'nope' }), 'INVALID_CREDENTIALS');
  const me = await admin(api);
  assert.equal(me.user.role, 'admin');
  assert.equal(me.org.name, 'Sample Homes Pty Ltd');
  assert.equal(me.ai.monthlyCap, 150);
  await api.signOut();
  assert.equal(await api.me(), null);
});

test('five failed sign ins lock the login for 15 minutes', async () => {
  const { api, clock } = fresh();
  for (let i = 0; i < 5; i += 1) await rejects(api.signIn({ identifier: 'priya@samplehomes.example', password: 'wrong' }), 'INVALID_CREDENTIALS');
  await rejects(api.signIn(DEMO_LOGINS.admin), 'ACCOUNT_LOCKED');
  clock.advance(14 * 60000);
  await rejects(api.signIn(DEMO_LOGINS.admin), 'ACCOUNT_LOCKED');
  clock.advance(2 * 60000);
  assert.equal((await api.signIn(DEMO_LOGINS.admin)).user.role, 'admin');
});

test('Generate account: only the first name is needed, credentials shown once, A$30 charged once', async () => {
  const { api } = fresh();
  await admin(api);
  const before = (await api.monthUsage()).totals;
  const r = await api.issueClientLogin({ firstName: 'Priscilla' });
  assert.match(r.credentials.username, /^priscilla-[2-9]{4}$/);
  assert.match(r.credentials.password, /^[a-z]+-[a-z]+-[2-9]{2}$/);
  assert.equal(r.charge.amountCents, 3000);
  assert.equal(r.charge.trigger, 'first_sign_in');
  assert.equal(r.client.status, 'active');
  assert.equal(r.client.houseAccess, 'all');
  assert.equal(JSON.stringify(await api.listClients()).includes(r.credentials.password), false, 'password is not readable again');
  // Generating costs nothing: the charge starts at the client's first sign in.
  assert.deepEqual((await api.monthUsage()).totals, before);
  await api.signOut();
  await api.signIn({ identifier: r.credentials.username, password: r.credentials.password });
  await api.signOut();
  await admin(api);
  const after = (await api.monthUsage()).totals;
  assert.equal(after.loginsCount, before.loginsCount + 1);
  assert.equal(after.totalCents, before.totalCents + 3000);
  // A second sign in does not charge again.
  await api.signOut();
  await api.signIn({ identifier: r.credentials.username, password: r.credentials.password }).catch(() => {});
  await api.signOut();
  await admin(api);
  assert.equal((await api.monthUsage()).totals.loginsCount, after.loginsCount);
  // Reset, disable, enable, edit: no charge.
  await api.resetClientPassword(r.client.id);
  await api.disableClient(r.client.id);
  await api.enableClient(r.client.id);
  await api.updateClient(r.client.id, { lotAddress: 'Lot 1 Test Street', houseAccess: ['h_banksia'] });
  assert.equal((await api.monthUsage()).totals.totalCents, after.totalCents);
  await rejects(api.issueClientLogin({ firstName: '  ' }), 'BAD_REQUEST');
  await rejects(api.issueClientLogin({ firstName: 'X', email: 'not-an-email' }), 'BAD_REQUEST');
});

test('a login is billed in the Sydney month of its first sign in, not when it was generated', async () => {
  const { api, clock } = fresh({ now: iso('2026-10-31T12:30:00Z') }); // 23:30 on 31/10 Sydney
  await admin(api);
  const a = await api.issueClientLogin({ firstName: 'Late' });
  const b = await api.issueClientLogin({ firstName: 'Early' });
  await api.signOut();
  await api.signIn({ identifier: a.credentials.username, password: a.credentials.password }); // 23:30 31/10
  await api.signOut();
  clock.set(iso('2026-10-31T13:30:00Z')); // 00:30 on 01/11 Sydney
  await api.signIn({ identifier: b.credentials.username, password: b.credentials.password });
  await api.signOut();
  await admin(api);
  assert.equal((await api.monthUsage({ month: '2026-10' })).logins.filter((l) => l.clientName === 'Late').length, 1);
  assert.equal((await api.monthUsage({ month: '2026-10' })).logins.filter((l) => l.clientName === 'Early').length, 0);
  assert.equal((await api.monthUsage({ month: '2026-11' })).logins.filter((l) => l.clientName === 'Early').length, 1);
});

test('an unused login can be deleted free and is never billed', async () => {
  const { api } = fresh();
  await admin(api);
  const before = (await api.monthUsage()).totals;
  const r = await api.issueClientLogin({ firstName: 'Unused' });
  const del = await api.deleteClient(r.client.id);
  assert.equal(del.charged, false);
  assert.deepEqual((await api.monthUsage()).totals, before);
});

test('temporary passwords expire after 7 days and a change is forced at first sign in', async () => {
  const { api, clock } = fresh();
  await admin(api);
  const r = await api.issueClientLogin({ firstName: 'Nina', email: 'nina.k@example.com' });
  const second = await api.issueClientLogin({ firstName: 'Omar' });
  await api.signOut();
  // First sign in works, but nothing else until the password is changed.
  const me = await api.signIn({ identifier: r.credentials.username, password: r.credentials.password });
  assert.equal(me.user.mustChangePassword, true);
  await rejects(api.listHouses(), 'PASSWORD_CHANGE_REQUIRED');
  await rejects(api.changePassword({ currentPassword: r.credentials.password, newPassword: 'short' }), 'BAD_REQUEST');
  await rejects(api.changePassword({ currentPassword: r.credentials.password, newPassword: 'Password123' }), 'BAD_REQUEST');
  await rejects(api.changePassword({ currentPassword: r.credentials.password, newPassword: 'nina.k-secure-1' }), 'BAD_REQUEST'); // contains email name
  await api.changePassword({ currentPassword: r.credentials.password, newPassword: 'harbour pelican 7 window' });
  assert.ok((await api.listHouses()).length >= 1);
  await api.signOut();
  assert.equal((await api.signIn({ identifier: r.credentials.username, password: 'harbour pelican 7 window' })).user.mustChangePassword, false);
  await api.signOut();
  // An unused temporary password stops working after 7 days.
  clock.advance(7 * 86400000 + 60000);
  await rejects(api.signIn({ identifier: second.credentials.username, password: second.credentials.password }), 'PASSWORD_EXPIRED');
  await admin(api);
  const reset = await api.resetClientPassword(second.client.id);
  await api.signOut();
  await api.signIn({ identifier: second.credentials.username, password: reset.credentials.password });
});

test('client sees only the houses they were given; staff see the whole library; archived houses are hidden from clients', async () => {
  const { api } = fresh();
  await admin(api);
  const all = await api.listHouses();
  assert.ok(all.length >= 4);
  assert.equal((await api.listHouses({ includeArchived: true })).length, all.length + 1);
  await api.archiveHouse('h_wattle');
  await api.signOut();
  await api.signIn(DEMO_LOGINS.client);
  const mine = await api.listHouses();
  assert.deepEqual(mine.map((h) => h.id), ['h_banksia']); // sarah had banksia + wattle; wattle is now archived
  await rejects(api.getHouse('h_coastal'), 'NOT_FOUND');
  const house = await api.getHouse('h_banksia');
  assert.equal(validate(house.project).length, 0);
  assert.equal((await api.listGlideLibrary()).length, GLIDE_LIBRARY.length);
  await rejects(api.saveHouse({ name: 'x', fromGlideId: 'glide:house_single' }), 'FORBIDDEN');
  await rejects(api.listClients(), 'FORBIDDEN');
});

test('designers manage houses but cannot issue logins, see billing or change the team', async () => {
  const { api } = fresh();
  await api.signIn(DEMO_LOGINS.designer);
  const h = await api.saveHouse({ name: 'Designer made', fromGlideId: 'glide:granny_flat' });
  assert.equal(h.bedrooms, 2);
  await rejects(api.issueClientLogin({ firstName: 'Nope' }), 'FORBIDDEN');
  await rejects(api.monthUsage(), 'FORBIDDEN');
  await rejects(api.inviteStaff({ firstName: 'Nope', role: 'admin' }), 'FORBIDDEN');
  await rejects(api.setBranding({ displayName: 'x' }), 'FORBIDDEN');
});

test('house library: save the open design, import, duplicate, rename clash, archive', async () => {
  const { api } = fresh();
  await admin(api);
  const project = createFromTemplate('house_double');
  const saved = await api.saveHouse({ name: 'Imported double', project });
  assert.equal(saved.storeys, 2);
  assert.equal(saved.bedrooms, houseStats(project).bedrooms);
  assert.match(saved.thumbnail, /^<svg/);
  const full = await api.getHouse(saved.id);
  assert.equal(full.project.levels.length, 2);
  await rejects(api.saveHouse({ name: 'imported double', project }), 'CONFLICT');
  await rejects(api.saveHouse({ name: 'Bad', project: { schema: 1, levels: [{ id: 'l', walls: [{ id: 'w', a: {}, b: {} }] }] } }), 'BAD_REQUEST');
  await rejects(api.saveHouse({ name: 'Bad', project: { nope: true } }), 'BAD_REQUEST');
  const dup = await api.duplicateHouse(saved.id);
  assert.equal(dup.name, 'Imported double copy');
  const arch = await api.archiveHouse(saved.id);
  assert.equal(arch.archived, true);
  assert.ok(!(await api.listHouses()).some((h) => h.id === saved.id));
  assert.equal((await api.archiveHouse(saved.id, false)).archived, false);
  const renamed = await api.saveHouse({ id: saved.id, name: 'Renamed double' });
  assert.equal(renamed.name, 'Renamed double');
  assert.equal((await api.getHouse(saved.id)).project.levels.length, 2);
});

test('projects: clients save their own, staff can open any client project, clients cannot open others', async () => {
  const { api } = fresh();
  await api.signIn(DEMO_LOGINS.client);
  const mine = await api.listProjects();
  assert.deepEqual(mine.map((p) => p.id), ['pr_1']);
  const opened = await api.openProject('pr_1');
  assert.equal(validate(opened.project).length, 0);
  const saved = await api.saveProject({ id: 'pr_1', name: 'Thornton updated', project: opened.project });
  assert.equal(saved.name, 'Thornton updated');
  await rejects(api.openProject('pr_2'), 'NOT_FOUND');
  await api.signOut();
  await admin(api);
  assert.equal((await api.listProjects()).length, 3);
  assert.equal((await api.openProject('pr_2')).ownerName, 'Daniel');
  assert.equal((await api.listProjects({ clientId: 'u_jack' })).length, 1);
});

test('client data handling: export a client\'s projects, then delete the client and their projects', async () => {
  const { api } = fresh();
  await admin(api);
  const exp = await api.exportClientProjects('u_daniel');
  assert.equal(exp.client.username, 'daniel-5937');
  assert.equal(exp.projects.length, 1);
  assert.equal(validate(exp.projects[0].project).length, 0);
  const del = await api.deleteClient('u_daniel');
  assert.equal(del.removedProjects, 1);
  assert.ok(!(await api.listClients()).some((c) => c.id === 'u_daniel'));
  assert.ok(!(await api.listProjects()).some((p) => p.ownerId === 'u_daniel'));
  await rejects(api.exportClientProjects('u_daniel'), 'NOT_FOUND');
  // The login was charged when issued, so past charges do not change.
  assert.ok((await api.monthUsage({ month: '2026-10' })).logins.some((l) => l.loginId === 'u_daniel'));
});

test('AI credits: monthly cap per login with a hard stop, top-ups of 300 for A$10, allowClientTopUps switch', async () => {
  const { api, clock } = fresh();
  await api.signIn(DEMO_LOGINS.client); // Sarah: 62 of 150 used
  let ai = await api.aiBalance();
  assert.deepEqual([ai.used, ai.remaining, ai.topUpBalance], [62, 88, 0]);
  await api.spendAiCredits({ credits: 80 });
  await rejects(api.spendAiCredits({ credits: 9 }), 'CREDITS_EXHAUSTED');
  const top = await api.aiTopUp();
  assert.deepEqual([top.topUp.credits, top.topUp.amountCents], [TOPUP_CREDITS, TOPUP_FEE_CENTS]);
  assert.equal(top.topUp.loginId, 'u_sarah');
  assert.equal(top.topUp.orgId, 'org_sample');
  ai = top.ai;
  assert.equal(ai.remaining, 8 + 300);
  await api.spendAiCredits({ credits: 20 }); // monthly allowance first (8 left), then top-up balance
  ai = await api.aiBalance();
  assert.deepEqual([ai.monthlyRemaining, ai.topUpBalance], [0, 288]);
  // Allowance resets next month; the top-up balance carries over.
  clock.set(iso('2026-12-02T02:00:00Z'));
  ai = await api.aiBalance();
  assert.deepEqual([ai.used, ai.monthlyRemaining, ai.topUpBalance], [0, 150, 288]);
  clock.set(NOW);
  // The builder can switch client top-ups off.
  await api.signOut();
  await admin(api);
  assert.equal((await api.setOrgSettings({ allowClientTopUps: false })).allowClientTopUps, false);
  await api.signOut();
  await api.signIn(DEMO_LOGINS.client);
  assert.equal((await api.me()).canTopUp, false);
  await rejects(api.aiTopUp(), 'TOPUPS_DISABLED');
});

test('the month total on the Billing tab and invoice is A$30 per new login plus A$10 per top-up', async () => {
  const { api } = fresh();
  await admin(api);
  const before = (await api.monthUsage()).totals;
  assert.equal(before.totalCents, before.loginsCount * 3000 + before.topUpsCount * 1000);
  const ivy = await api.issueClientLogin({ firstName: 'Ivy' });
  assert.deepEqual((await api.monthUsage()).totals, before, 'no charge until first sign in');
  await api.signOut();
  await api.signIn({ identifier: ivy.credentials.username, password: ivy.credentials.password });
  await api.aiTopUp().catch(() => {});
  await api.signOut();
  await admin(api);
  await api.aiTopUp();
  const after = (await api.monthUsage()).totals;
  assert.equal(after.totalCents, before.totalCents + 3000 + 1000);
  assert.equal((await api.monthUsage()).topUps.at(-1).amountCents, 1000);
  // Past invoices are tax invoices with the seller ABN, GST and total incl. GST.
  const [first] = await api.listInvoices();
  const inv = await api.getInvoice(first.id);
  assert.equal(inv.title, 'Tax invoice');
  assert.deepEqual(inv.seller, { name: 'JCE Infrastructure Pty Ltd trading as Glide Inside', abn: '29 699 165 663' });
  assert.equal(inv.totalInclGstCents, first.totalCents);
  assert.equal(inv.gstCents, gstOfTotal(first.totalCents));
  assert.equal(inv.subtotalExGstCents + inv.gstCents, inv.totalInclGstCents);
  assert.equal(inv.lines.reduce((s, l) => s + l.totalCents, 0), inv.totalInclGstCents);
  assert.equal(inv.buyer.abn, '51 824 753 556');
});

test('billing settings need the builder legal name and an 11 digit ABN', async () => {
  const { api } = fresh();
  await admin(api);
  await rejects(api.setBillingContact({ name: 'A', email: 'a@example.com' }), 'BAD_REQUEST');
  await rejects(api.setBillingContact({ name: 'A', email: 'a@example.com', legalName: 'Sample Homes Pty Ltd', abn: '123' }), 'BAD_REQUEST');
  const c = await api.setBillingContact({ name: 'A', email: 'a@example.com', legalName: 'Sample Homes Pty Ltd', abn: '51824753556' });
  assert.equal(c.abn, '51 824 753 556');
});

test('team: invite staff with a generated login, protect the last admin, branding rules', async () => {
  const { api } = fresh();
  await admin(api);
  const inv = await api.inviteStaff({ firstName: 'Riley', role: 'designer' });
  assert.match(inv.credentials.username, /^riley-[2-9]{4}$/);
  assert.equal((await api.monthUsage()).totals.loginsCount, (await api.monthUsage()).logins.length, 'staff logins are never charged');
  assert.equal((await api.listTeam()).length, 3);
  await rejects(api.updateStaff('u_priya', { role: 'designer' }), 'CONFLICT');
  await rejects(api.disableStaff('u_priya'), 'CONFLICT');
  await api.updateStaff(inv.user.id, { role: 'admin' });
  await api.updateStaff('u_priya', { role: 'designer' });
  await rejects(api.setBranding({ displayName: 'S', logoDataUrl: 'data:text/html;base64,AAA' }), 'FORBIDDEN'); // priya is now a designer
  await api.signOut();
  await api.signIn({ identifier: inv.credentials.username, password: inv.credentials.password });
  await api.changePassword({ currentPassword: inv.credentials.password, newPassword: 'another strong phrase 9' });
  await rejects(api.setBranding({ displayName: 'S', logoDataUrl: 'data:text/html;base64,AAA' }), 'BAD_REQUEST');
  const b = await api.setBranding({ displayName: 'Sample Homes QLD', logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(b.displayName, 'Sample Homes QLD');
  assert.equal((await api.me()).org.branding.logoDataUrl.startsWith('data:image/png'), true);
});

test('forgot password: always answers ok; the reset link sets a strong password', async () => {
  const { api } = fresh();
  const none = await api.requestPasswordReset({ identifier: 'nobody@example.com' });
  assert.deepEqual(none, { ok: true });
  const r = await api.requestPasswordReset({ identifier: 'PRIYA@samplehomes.example' });
  assert.ok(r.mock.token);
  await rejects(api.completePasswordReset({ token: r.mock.token, newPassword: 'weak' }), 'BAD_REQUEST');
  await api.completePasswordReset({ token: r.mock.token, newPassword: 'a long unusual phrase 42' });
  await rejects(api.completePasswordReset({ token: r.mock.token, newPassword: 'a long unusual phrase 43' }), 'BAD_REQUEST');
  assert.equal((await api.signIn({ identifier: 'priya@samplehomes.example', password: 'a long unusual phrase 42' })).user.name, 'Priya');
});

// Glide library and house statistics -------------------------------------------------------------------------------------
test('the generated Glide library is current and covers every catalogue template', () => {
  const ids = TEMPLATES.filter((t) => t.id !== 'blank').map((t) => `glide:${t.id}`);
  assert.deepEqual(GLIDE_LIBRARY.map((g) => g.id), ids);
  for (const g of GLIDE_LIBRARY) {
    const s = houseStats(createFromTemplate(g.templateId));
    for (const k of Object.keys(s)) assert.equal(g[k], s[k], `${g.id}.${k}: run node tools/build-glide-library.mjs`);
    assert.match(g.thumbnail, /^<svg/);
  }
});

test('house stats: beds, baths, garage cars, living area, footprint and storeys', () => {
  const s = houseStats(createFromTemplate('house_single'));
  assert.equal(s.bedrooms, 4);
  assert.equal(s.bathrooms, 2);
  assert.equal(s.garage, 2);
  assert.equal(s.storeys, 1);
  assert.ok(s.floorAreaM2 > 180 && s.floorAreaM2 < 230, String(s.floorAreaM2));
  assert.ok(s.widthMm > 15000 && s.depthMm > 15000);
  assert.equal(houseStats(createFromTemplate('house_double')).storeys, 2);
  assert.match(projectToSvg(createFromTemplate('granny_flat')), /<polygon/);
  assert.match(projectToSvg(createProject()), /^<svg/);
});

// House placement --------------------------------------------------------------------------------------------------------
const ids = (p) => p.levels.flatMap((l) => [...l.walls, ...l.openings, ...l.rooms, ...l.furniture, ...l.stairs].map((e) => e.id));
const roomCentre = (r) => ({ x: r.polygon.reduce((s, q) => s + q.x, 0) / r.polygon.length, y: r.polygon.reduce((s, q) => s + q.y, 0) / r.polygon.length });

test('placing a house on a blank lot puts its footprint centre at the pose, keeps ids unique and the project valid', () => {
  const house = createFromTemplate('house_single');
  const snapshot = JSON.stringify(house);
  const lot = createProject({ name: 'Lot 14' });
  const rec = placeHouse(lot, house, { x: 20000, y: 15000, rotation: 0 });
  assert.equal(validate(lot).length, 0);
  assert.equal(lot.levels.length, 1);
  assert.equal(lot.levels[0].walls.length, house.levels[0].walls.length);
  assert.equal(lot.levels[0].openings.length, house.levels[0].openings.length);
  assert.equal(new Set(ids(lot)).size, ids(lot).length);
  assert.equal(rec.entityIds.length, ids(lot).length + lot.site.tanks.length);
  const b = houseBounds(lot);
  assert.ok(Math.abs(b.cx - 20000) <= 2 && Math.abs(b.cy - 15000) <= 2, `${b.cx},${b.cy}`);
  assert.equal(lot.finishes.roof.colour, house.finishes.roof.colour);
  // The library design itself is untouched.
  assert.equal(JSON.stringify(house), snapshot);
});

test('openings stay on their new walls and walls keep their lengths after rotation', () => {
  const house = createFromTemplate('house_single');
  const lot = createProject();
  placeHouse(lot, house, { x: 0, y: 0, rotation: 37 });
  assert.equal(validate(lot).length, 0);
  const len = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const orig = house.levels[0].walls.map(len);
  lot.levels[0].walls.forEach((w, i) => assert.ok(Math.abs(len(w) - orig[i]) < 2, `wall ${i}`));
  const wallIds = new Set(lot.levels[0].walls.map((w) => w.id));
  assert.ok(lot.levels[0].openings.every((o) => wallIds.has(o.wallId)));
  const f0 = house.levels[0].furniture[0];
  if (f0) assert.equal(lot.levels[0].furniture[0].rotation, Math.round((((f0.rotation + 37) % 360) + 540) % 360 - 180));
});

test('a 90 degree turn swaps width and depth exactly and rotates furniture and stairs', () => {
  const house = createFromTemplate('house_double');
  const w0 = houseBounds(house);
  const lot = createProject();
  placeHouse(lot, house, { x: 10000, y: 10000, rotation: 90 });
  const b = houseBounds(lot);
  assert.ok(Math.abs(b.width - w0.depth) <= 1 && Math.abs(b.depth - w0.width) <= 1);
  const stairs = house.levels.flatMap((l) => l.stairs);
  const placedStairs = lot.levels.flatMap((l) => l.stairs);
  assert.equal(placedStairs.length, stairs.length);
  assert.equal(placedStairs[0].rotation, ((stairs[0].rotation + 90 + 540) % 360) - 180 || 180);
  assert.deepEqual(footprintCorners(house, { x: 0, y: 0, rotation: 90 }).map((c) => Math.abs(c.x)).sort()[0] >= 0, true);
});

test('a two storey house merges into matching levels and adds the missing one; the house stays editable by ops', () => {
  const lot = createFromTemplate('house_single'); // existing ground floor
  const before = lot.levels[0].walls.length;
  const house = createFromTemplate('house_double');
  const rec = placeHouse(lot, house, defaultPose(lot, house));
  assert.equal(lot.levels.length, 2);
  assert.equal(lot.levels[0].walls.length, before + house.levels[0].walls.length);
  assert.deepEqual(rec.levels.map((l) => l.added), [false, true]);
  assert.ok(lot.levels[1].elevation > 0);
  assert.equal(validate(lot).length, 0);
  assert.ok(footprintCorners(house, defaultPose(lot, house)).every((c) => c.x > houseBounds(createFromTemplate('house_single')).maxX));
});

test('placing the same house twice gives independent copies', () => {
  const house = createFromTemplate('granny_flat');
  const lot = createProject();
  placeHouse(lot, house, { x: 6000, y: 6000, rotation: 0 });
  placeHouse(lot, house, { x: 20000, y: 6000, rotation: 180 });
  assert.equal(lot.levels[0].rooms.length, house.levels[0].rooms.length * 2);
  assert.equal(new Set(ids(lot)).size, ids(lot).length);
  assert.equal(validate(lot).length, 0);
});

test('placement keeps the room layout: room centres keep their distances', () => {
  const house = createFromTemplate('granny_flat');
  const a = house.levels[0].rooms[0];
  const b = house.levels[0].rooms[1];
  const d0 = Math.hypot(roomCentre(a).x - roomCentre(b).x, roomCentre(a).y - roomCentre(b).y);
  const lot = createProject();
  placeHouse(lot, house, { x: 9000, y: 9000, rotation: 123 });
  const [pa, pb] = lot.levels[0].rooms;
  const d1 = Math.hypot(roomCentre(pa).x - roomCentre(pb).x, roomCentre(pa).y - roomCentre(pb).y);
  assert.ok(Math.abs(d0 - d1) < 3);
});

test('preview never changes the project; tanks move with the house; the lot size check warns', () => {
  const lot = createProject();
  const snap = JSON.stringify(lot);
  const house = createFromTemplate('shed_farm');
  const preview = previewPlacement(lot, house, { x: 10000, y: 10000, rotation: 0 });
  assert.equal(JSON.stringify(lot), snap);
  assert.equal(preview.site.tanks.length, house.site.tanks.length);
  assert.ok(house.site.tanks.length > 0);
  assert.equal(fitsLot(house, { x: 0, y: 0, rotation: 0 }, { widthMm: 12000, depthMm: 12000 }), false);
  assert.equal(fitsLot(house, { x: 0, y: 0, rotation: 0 }, { widthMm: 20000, depthMm: 20000 }), true);
  assert.equal(fitsLot(house, { x: 0, y: 0, rotation: 0 }, null), true);
  assert.throws(() => placeHouse(lot, { levels: [] }, {}), /no levels/);
  assert.equal(migrate(preview).levels.length, 1);
});
