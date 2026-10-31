// Premium layer tests: docs/SCOPE.md section 16 tests 7 and 9 to 15 (the client and export sides; the server side is in
// tests/server.test.mjs). Pure modules run in Node. The UI runs in Chromium through tools/smoke.py against
// tests/pages/premium.html and is skipped when Playwright is not installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createProject } from '../src/model/schema.js';
import { createStore } from '../src/model/store.js';
import { OPS } from '../src/model/ops.js';
import { catalogue } from '../src/catalogue/index.js';
import { signToken } from '../server/lib/entitlement.js';
import { SYSTEM_PROMPT } from '../src/premium/ai/prompt.js';
import { buildContext, compactContext, estimateTokens, DEFAULT_TOKEN_CAP } from '../src/premium/ai/context.js';
import { buildTools, checkToolCall, catalogueEnums } from '../src/premium/ai/tools.js';
import { describeOp, summariseOps, nameResolver } from '../src/premium/ai/summary.js';
import { createApi, ApiError } from '../src/premium/api.js';
import { tokenInfo, loadToken, saveToken, clearToken, waitForEntitlement, tokenKey } from '../src/premium/entitlement.js';
import { normaliseCredits, meterText, meterLevel, warningText, exhaustedText, claimWarning, warnedLevels } from '../src/premium/credits.js';
import { friendlyError } from '../src/premium/messages.js';
import { exportPayload, runExport, isLocalHost, EXPORT_ITEMS } from '../src/premium/export-client.js';
import { toDXF, parseDXF, DXF_LAYERS } from '../src/premium/exporters/dxf.js';
import { toPDF } from '../src/premium/exporters/pdf.js';
import { toGLB, toOBJ } from '../src/premium/exporters/model3d.js';
import { crc32, zipStore } from '../src/premium/exporters/zip.js';
import { buildExport, exportFilename } from '../src/premium/exporters/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { jsPDF } = await import('jspdf');

// A browser-like storage for the modules that keep tokens and warning memory in localStorage.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}
globalThis.window = { localStorage: fakeStorage(), location: { hostname: 'localhost' } };
const resetStorage = (initial) => {
  globalThis.window.localStorage = fakeStorage(initial);
  return globalThis.window.localStorage;
};

// A design built only through operations, as the app does.
function sampleStore(id = 'p_prem1') {
  const store = createStore(createProject({ id, name: 'Smith residence', type: 'house' }), { opContext: { catalogue } });
  store.run('add_room', { name: 'Living', type: 'living', x: 0, y: 0, width: 6000, depth: 4500 });
  store.run('add_room', { name: 'Kitchen', type: 'kitchen', x: 6000, y: 0, width: 4000, depth: 4500 });
  store.run('add_room', { name: 'Deck', type: 'deck', x: 0, y: 4500, width: 6000, depth: 3000 });
  store.run('add_opening', { kind: 'window', x: 3000, y: 0, width: 1800 });
  store.run('add_opening', { kind: 'door', x: 6000, y: 2250, width: 900 });
  store.run('add_furniture', { item: 'sofa_3', room: store.project.levels[0].rooms[0].id });
  store.run('add_tank', { x: 11000, y: 500, capacity_l: 5000 });
  store.run('set_finish', { target: 'roof', colour: 'steel-off-white' });
  return store;
}

const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// 1. The Plan Pack never ships the exporters to the browser -----------------------------------------------------------------
test('7. premium.js never statically imports the exporters, and the UI modules do not either', () => {
  const importRe = /^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm;
  const seen = new Set();
  const queue = [path.join(ROOT, 'src/premium/premium.js')];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(importRe)) {
      const spec = m[1];
      assert.ok(!/exporters\//.test(spec) || /export-client|\/exporters\/download/.test(file) === false, `${path.relative(ROOT, file)} statically imports ${spec}`);
      assert.ok(!/exporters/.test(spec), `${path.relative(ROOT, file)} statically imports ${spec}`);
      if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
    }
  }
  const graph = [...seen].map((f) => path.relative(ROOT, f));
  assert.ok(graph.includes('src/premium/export-client.js'));
  assert.ok(graph.includes('src/premium/ui/assistant.js'));
  assert.ok(!graph.some((f) => f.includes('exporters')), `exporters in the static graph: ${graph.filter((f) => f.includes('exporters'))}`);
  assert.ok(!graph.some((f) => /three|jspdf/i.test(f)));
  // The only reference to the exporters is a dynamic import in export-client.js.
  const client = fs.readFileSync(path.join(ROOT, 'src/premium/export-client.js'), 'utf8');
  assert.match(client, /await import\('\.\/exporters\/index\.js'\)/);
  assert.match(client, /jspdf\.umd\.min\.js/);
  assert.match(client, /window\.jspdf/);
});

test('7. a free-tier design cannot produce files: no token and no dev unlock is NOT_ENTITLED, and dev unlock is localhost only', async () => {
  const store = sampleStore();
  await assert.rejects(runExport('dxf', store.project, { api: {}, token: null, devUnlock: false, save: () => assert.fail('must not save') }), (e) => e.code === 'NOT_ENTITLED');
  assert.equal(isLocalHost('localhost'), true);
  assert.equal(isLocalHost('127.0.0.1'), true);
  assert.equal(isLocalHost('[::1]'), true);
  assert.equal(isLocalHost('example.com.au'), false);
  assert.equal(isLocalHost('localhost.evil.test'), false);
  assert.equal(isLocalHost(''), false);
  // The premium module reads the flag through isLocalHost, so a host page cannot switch it on elsewhere.
  const src = fs.readFileSync(path.join(ROOT, 'src/premium/premium.js'), 'utf8');
  assert.match(src, /cfg\.devUnlock && isLocalHost\(\)/);
  assert.deepEqual(EXPORT_ITEMS.map((i) => i.type), ['pdf', 'dxf', 'glb', 'obj']);
});

test('exports: the token path posts the project (without the underlay image) and the dev path builds locally', async () => {
  const store = sampleStore();
  store.project.site.underlay = { image: 'data:image/png;base64,AAAA', scale: 1 };
  const payload = exportPayload(store.project);
  assert.equal(payload.site.underlay, null);
  assert.ok(store.project.site.underlay, 'the open design is not changed');

  const calls = [];
  const api = {
    exportFile: async (token, type, body, fallback) => {
      calls.push({ token, type, body, fallback });
      return { blob: new Blob(['x'.repeat(10)]), filename: 'smith-residence.dxf' };
    },
  };
  const saved = [];
  const out = await runExport('dxf', store.project, { api, token: 'tok.en', save: (blob, name) => saved.push([blob.size, name]) });
  assert.deepEqual(out, { filename: 'smith-residence.dxf', bytes: 10, source: 'server' });
  assert.equal(calls[0].token, 'tok.en');
  assert.equal(calls[0].type, 'dxf');
  assert.equal(calls[0].body.project.site.underlay, null);
  assert.equal(calls[0].body.image, undefined, 'only the PDF carries a cover image');
  assert.deepEqual(saved, [[10, 'smith-residence.dxf']]);

  const local = await runExport('dxf', store.project, { api: {}, devUnlock: true, config: { disclaimer: 'Concept design only.' }, catalogue, save: (blob, name) => saved.push([blob.size, name]) });
  assert.equal(local.source, 'local');
  assert.equal(local.filename, 'smith-residence.dxf');
  assert.ok(local.bytes > 2000);
  assert.equal(calls.length, 1, 'no server call in dev mode');
});

// 2. API client ----------------------------------------------------------------------------------------------------------------
test('api client: bearer header, endpoints, and every failure becomes an ApiError with a code', async () => {
  const seen = [];
  const replies = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const api = createApi({ base: '/api/', fetchImpl });
  replies.push(jsonResponse({ total: 500, used: 188, remaining: 312, warnLevel: 0 }));
  assert.equal((await api.credits('tok', 'p_1')).remaining, 312);
  assert.equal(seen[0].url, '/api/credits?project=p_1');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.headers.authorization, 'Bearer tok');

  replies.push(jsonResponse({ estimatedCredits: 3, remaining: 300, requiresConfirm: false }));
  await api.estimate('tok', { message: 'm', context: 'c' });
  assert.equal(seen[1].url, '/api/ai/estimate');
  assert.equal(seen[1].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(seen[1].init.body), { message: 'm', context: 'c' });

  replies.push(jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Slow down.', retryAfter: 12 }, code: 'RATE_LIMITED', message: 'Slow down.' }, 429, { 'retry-after': '12' }));
  await assert.rejects(api.edit('tok', {}), (e) => e instanceof ApiError && e.code === 'RATE_LIMITED' && e.status === 429 && e.retryAfter === 12 && e.message === 'Slow down.');

  replies.push(jsonResponse({ error: { code: 'CONFIRM_REQUIRED', message: 'Large.', estimatedCredits: 14, remaining: 300 } }, 409));
  await assert.rejects(api.edit('tok', {}), (e) => e.code === 'CONFIRM_REQUIRED' && e.details.estimatedCredits === 14 && e.details.remaining === 300);

  replies.push(new TypeError('Failed to fetch'));
  await assert.rejects(api.credits('tok'), (e) => e.code === 'NETWORK');

  replies.push(new Response('<html>Not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(api.health(), (e) => e.code === 'SERVER_UNAVAILABLE');

  replies.push(jsonResponse({ error: { code: 'NOT_ENTITLED', message: 'Your payment has not been confirmed yet.', pending: true } }, 404));
  assert.deepEqual(await api.entitlement({ sessionId: 'cs_1', projectId: 'p_1' }), { pending: true });
  assert.equal(seen.at(-1).url, '/api/entitlement?session_id=cs_1&project=p_1');
  assert.equal(seen.at(-1).init.headers.authorization, undefined);

  replies.push(jsonResponse({ error: { code: 'NOT_ENTITLED', message: 'Refunded.' } }, 403));
  await assert.rejects(api.entitlement({ sessionId: 'cs_1', projectId: 'p_1' }), (e) => e.code === 'NOT_ENTITLED');

  replies.push(new Response('PDFDATA', { status: 200, headers: { 'content-disposition': 'attachment; filename="smith-residence-plans.pdf"', 'content-type': 'application/pdf' } }));
  const file = await api.exportFile('tok', 'pdf', { project: {} });
  assert.equal(file.filename, 'smith-residence-plans.pdf');
  assert.equal(await file.blob.text(), 'PDFDATA');
  assert.equal(seen.at(-1).url, '/api/export/pdf');
  replies.push(new Response('x', { status: 200 }));
  assert.equal((await api.exportFile('tok', 'dxf', {}, 'fallback.dxf')).filename, 'fallback.dxf');

  replies.push(jsonResponse({ url: 'https://checkout.stripe.com/c/pay/cs_1' }));
  assert.equal((await api.checkout({ projectId: 'p_1', projectName: 'Smith' })).url, 'https://checkout.stripe.com/c/pay/cs_1');
  assert.deepEqual(JSON.parse(seen.at(-1).init.body), { projectId: 'p_1', projectName: 'Smith' });
  replies.push(jsonResponse({ token: 't', projectId: 'p_1' }));
  await api.restore({ email: 'a@b.com', sessionOrReceipt: 'cs_1' });
  assert.equal(seen.at(-1).url, '/api/entitlement/restore');
});

// 3. Entitlement token in the browser --------------------------------------------------------------------------------------
test('10. entitlement token: stored under ps.ent.<projectId>, checked for project and expiry, safe without storage', async () => {
  const now = Date.now();
  const good = await signToken({ eid: 'ent_1', pid: 'p_a', exp: Math.floor(now / 1000) + 3600 }, 'secret');
  const expired = await signToken({ eid: 'ent_1', pid: 'p_a', exp: Math.floor(now / 1000) - 5 }, 'secret');
  const other = await signToken({ eid: 'ent_2', pid: 'p_b', exp: Math.floor(now / 1000) + 3600 }, 'secret');
  assert.deepEqual(tokenInfo(good, now), { eid: 'ent_1', pid: 'p_a', exp: Math.floor(now / 1000) + 3600, expired: false });
  assert.equal(tokenInfo(expired, now).expired, true);
  for (const bad of [null, '', 'abc', 'a.b.c', '!!!.???', 12]) assert.equal(tokenInfo(bad), null, String(bad));

  const store = resetStorage();
  assert.equal(tokenKey('p_a'), 'ps.ent.p_a');
  assert.equal(saveToken('p_a', good), true);
  assert.equal(store.map.get('ps.ent.p_a'), good);
  assert.equal(loadToken('p_a', now), good);
  assert.equal(loadToken('p_missing', now), null);
  store.setItem('ps.ent.p_a', expired);
  assert.equal(loadToken('p_a', now), null);
  assert.equal(store.map.has('ps.ent.p_a'), false, 'an expired token is removed');
  store.setItem('ps.ent.p_a', other);
  assert.equal(loadToken('p_a', now), null, 'a token for another project is not accepted');
  store.setItem('ps.ent.p_a', 'garbage');
  assert.equal(loadToken('p_a', now), null);
  saveToken('p_a', good);
  clearToken('p_a');
  assert.equal(loadToken('p_a', now), null);

  // Blocked storage (private windows, cleared site data): nothing throws and the tool still works.
  globalThis.window.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(loadToken('p_a', now), null);
  assert.equal(saveToken('p_a', good), false);
  clearToken('p_a');
  assert.equal(claimWarning('p_a', 0.5), true, 'warnings still show once per session');
  resetStorage();
});

test('8. after checkout the client asks for the entitlement again and again for up to 30 seconds', async () => {
  let clock = 0;
  const sleeps = [];
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
  };
  const now = () => clock;
  let calls = 0;
  const api = { entitlement: async () => (++calls < 4 ? { pending: true } : { token: 't.k', credits: { total: 500, used: 0, remaining: 500 }, projectId: 'p_1' }) };
  const res = await waitForEntitlement({ api, sessionId: 'cs_1', projectId: 'p_1', sleep, now, intervalMs: 2000, timeoutMs: 30000 });
  assert.equal(res.token, 't.k');
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [2000, 2000, 2000]);

  // Never confirmed: stops by 30 seconds with PAYMENT_PENDING.
  clock = 0;
  let polls = 0;
  const never = { entitlement: async () => (polls++, { pending: true }) };
  await assert.rejects(waitForEntitlement({ api: never, sessionId: 'cs_1', projectId: 'p_1', sleep, now, intervalMs: 2000, timeoutMs: 30000 }), (e) => e.code === 'PAYMENT_PENDING');
  assert.ok(clock >= 26000 && clock <= 30000, `waited ${clock} ms`);
  assert.ok(polls >= 14 && polls <= 16, `polled ${polls} times`);

  // Network blips are retried. A final answer from the server is not.
  clock = 0;
  let n = 0;
  const flaky = { entitlement: async () => { if (++n < 3) throw new ApiError('NETWORK', 'offline'); return { token: 'ok.ok' }; } };
  assert.equal((await waitForEntitlement({ api: flaky, sessionId: 's', projectId: 'p', sleep, now })).token, 'ok.ok');
  const refunded = { entitlement: async () => { throw new ApiError('NOT_ENTITLED', 'This Plan Pack is no longer active.', { status: 403 }); } };
  await assert.rejects(waitForEntitlement({ api: refunded, sessionId: 's', projectId: 'p', sleep, now }), (e) => e.code === 'NOT_ENTITLED');
});

// 4. Credits, messages, summaries ------------------------------------------------------------------------------------------
test('credits meter, warnings (shown once each) and the read-only state', () => {
  const c = normaliseCredits({ total: 500, used: 188, remaining: 312, warnLevel: 0 });
  assert.equal(meterText(c), '312 of 500 credits left');
  assert.equal(meterLevel(c), 'ok');
  assert.equal(meterLevel(normaliseCredits({ total: 500, used: 400 })), 'warn');
  assert.equal(meterLevel(normaliseCredits({ total: 500, used: 475 })), 'danger');
  assert.equal(normaliseCredits({ total: 500, used: 500 }).remaining, 0);
  assert.equal(normaliseCredits(null), null);
  assert.equal(normaliseCredits({ total: 'x', used: 1 }), null);
  assert.match(warningText({ level: 0.5, usedPercent: 50, remaining: 250 }), /used half of the AI credits.*250 credits left/);
  assert.match(warningText({ level: 0.8, usedPercent: 81, remaining: 95 }), /81%.*95 credits left/);
  assert.match(warningText({ level: 0.95, usedPercent: 96, remaining: 1 }), /Only 1 credit left.*read-only/);
  assert.match(exhaustedText({ total: 500 }), /used all 500 AI credits.*read-only.*editing and exports still work/i);
  resetStorage();
  assert.deepEqual([claimWarning('p_1', 0.5), claimWarning('p_1', 0.5), claimWarning('p_1', 0.8), claimWarning('p_2', 0.5)], [true, false, true, true]);
  assert.deepEqual(warnedLevels('p_1'), [0.5, 0.8]);
});

test('friendly messages for every failure, in Australian English with no dashes', () => {
  const E = (code, extra = {}) => Object.assign(new ApiError(code, `server says ${code}`), extra);
  const cases = [
    [E('NETWORK'), { area: 'ai' }, /Could not reach.*Nothing was charged/],
    [E('TIMEOUT'), { area: 'ai' }, /took too long.*Nothing was charged/],
    [E('AI_PAUSED'), { area: 'ai' }, /paused.*credits are untouched/],
    [E('RATE_LIMITED', { retryAfter: 12 }), { area: 'ai' }, /Wait about 12 seconds/],
    [E('RATE_LIMITED'), { area: 'ai' }, /limit for AI requests/],
    [E('RATE_LIMITED'), { area: 'restore' }, /Too many attempts/],
    [E('SERVER_UNAVAILABLE'), { area: 'ai', dev: true }, /server\/README\.md/],
    [E('SERVER_UNAVAILABLE'), { area: 'ai' }, /not available right now/],
    [E('PAYLOAD_TOO_LARGE'), { area: 'ai' }, /too large for the assistant/],
    [E('PAYLOAD_TOO_LARGE'), { area: 'export' }, /too large to export/],
    [E('NOT_ENTITLED'), { area: 'restore' }, /could not find a Plan Pack/],
    [E('EXPORT_UNAVAILABLE'), { area: 'export' }, /not available right now/],
    [E('PAYMENTS_UNAVAILABLE'), { area: 'checkout' }, /Payments are not available/],
    [E('SOMETHING_NEW'), {}, /server says SOMETHING_NEW/],
    [new Error(''), {}, /Something went wrong/],
  ];
  for (const [err, opts, re] of cases) {
    const text = friendlyError(err, opts);
    assert.match(text, re);
    assert.ok(!/[–—]/.test(text), `dash in: ${text}`);
  }
});

test('summaries describe each change in plain English and fit an undo label', () => {
  const store = sampleStore();
  const names = nameResolver(catalogue);
  const living = store.project.levels[0].rooms[0];
  const deck = store.project.levels[0].rooms.find((r) => r.name === 'Deck');
  const cases = [
    [['set_finish', { target: 'roof', colour: 'steel-charcoal' }], 'Roof colour set to Charcoal'],
    [['set_finish', { target: 'external_walls', material: 'brick', colour: 'brick-light-grey' }], 'External walls set to Light Grey brick'],
    [['resize_room', { id: deck.id, side: 'south', delta: 2000 }], 'Deck extended 2.0 m south'],
    [['resize_room', { id: deck.id, side: 'north', delta: -500 }], 'Deck reduced 0.5 m north'],
    [['add_room', { name: 'Study', type: 'study', width: 3000, depth: 3000 }], 'Added Study (3.0 by 3.0 m)'],
    [['update_room', { id: living.id, name: 'Lounge' }], 'Renamed Living to Lounge'],
    [['mirror_plan', { axis: 'left_right' }], 'Flipped the plan left to right'],
    [['set_roof', { type: 'gable', pitch: 25 }], 'Roof changed to gable, pitch set to 25 degrees'],
    [['delete', { id: living.id }], 'Deleted Living'],
    [['set_status', { ids: ['a', 'b'], status: 'demolish' }], 'Marked 2 elements for demolition'],
  ];
  for (const [[op, args], text] of cases) assert.equal(describeOp(op, args, store.project, names), text);
  assert.equal(summariseOps([]), 'no changes');
  assert.equal(summariseOps(['Roof colour set to Charcoal']), 'Roof colour set to Charcoal');
  assert.equal(summariseOps(['Roof colour set to Charcoal', 'Deck extended 2.0 m south']), 'Roof colour set to Charcoal and 1 more');
  assert.ok(summariseOps(['x'.repeat(200)]).length <= 60);
  for (const op of Object.keys(OPS)) assert.ok(describeOp(op, {}, store.project, names).length > 2, `no description for ${op}`);
});

// 5. AI context, prompt and tools (SCOPE 7.5 to 7.7) ------------------------------------------------------------------------------
test('compact plan context follows SCOPE 7.6 and stays under the cap', () => {
  const store = sampleStore();
  const { text, tokens, trimmed } = buildContext(store.project, { activeLevelId: store.ui.activeLevelId });
  const lines = text.split('\n');
  assert.equal(lines[0], 'PROJECT "Smith residence" type=house units=mm x=right y=down(south)');
  assert.match(text, /^FINISH ext_walls=brick\/brick-light-grey .* roof=corrugated\/steel-off-white/m);
  assert.match(text, /^LEVEL l_\w+ "Ground" ffl=0 ceiling=2550 roof=hip 22\.5deg eaves=450 active$/m);
  assert.match(text, /^ROOM r_\w+ "Living" living rect x=0\.\.6000 y=0\.\.4500 area=27\.00$/m);
  assert.match(text, /^ROOM r_\w+ "Deck" deck rect x=0\.\.6000 y=4500\.\.7500 area=18\.00 outdoor$/m);
  assert.match(text, /^WALL w_\w+ \(0,0\)-\(6000,0\) ext t=250 new$/m);
  assert.match(text, /^OPEN o_\w+ window on w_\w+ centre=3000 w=1800 h=1200 sill=900 sliding$/m);
  assert.match(text, /^FURN f_\w+ sofa_3 at \(3000,2250\) rot=0 in r_\w+$/m);
  assert.match(text, /^TANK t_\w+ 5000L at \(11000,500\)/m);
  assert.ok(!/[{}\[\]]/.test(text.replace(/\(.*?\)/g, '')), 'plain text, not JSON');
  assert.equal(trimmed, false);
  assert.equal(tokens, estimateTokens(text));
  assert.ok(tokens < 600, `${tokens} tokens`);
  assert.equal(compactContext(store.project, { activeLevelId: store.ui.activeLevelId }), text);
  assert.equal(DEFAULT_TOKEN_CAP, 40000);

  // A large design is summarised, never sent whole, and the result is stable.
  const big = createStore(createProject({ id: 'p_big', name: 'Big' }), { opContext: { catalogue } });
  big.run('add_room', { name: 'Hall', type: 'living', x: 0, y: 0, width: 20000, depth: 20000 });
  for (let i = 0; i < 400; i++) big.run('add_furniture', { item: 'sofa_3', x: 500 + (i % 20) * 900, y: 500 + Math.floor(i / 20) * 900 });
  const full = buildContext(big.project, { activeLevelId: big.ui.activeLevelId });
  assert.ok(full.tokens > 2500, 'the full detail is large');
  const capped = buildContext(big.project, { activeLevelId: big.ui.activeLevelId, maxTokens: 1500 });
  assert.ok(capped.tokens <= 1500, `${capped.tokens} tokens`);
  assert.equal(capped.trimmed, true);
  assert.match(capped.text, /^ROOM r_\w+ "Hall"/m, 'rooms and walls are kept');
  assert.equal(buildContext(big.project, { activeLevelId: big.ui.activeLevelId, maxTokens: 1500 }).text, capped.text);
});

test('system prompt carries the SCOPE 7.7 rules', () => {
  for (const re of [/tools/i, /millimetre|mm/i, /north/i, /existing ids?|use the ids/i, /colour|material/i, /compliance|approval/i, /structural/i, /cost/i, /unrelated|decline/i, /one or two/i, /Australian English/i]) {
    assert.match(SYSTEM_PROMPT, re);
  }
  assert.ok(!/[–—]/.test(SYSTEM_PROMPT), 'no en or em dashes');
  assert.ok(estimateTokens(SYSTEM_PROMPT) < 800);
});

test('tools come from the operations registry with catalogue ids injected, and calls are checked', () => {
  const tools = buildTools(catalogue);
  assert.deepEqual(tools.map((t) => t.name), Object.keys(OPS));
  for (const t of tools) {
    assert.equal(t.input_schema.type, 'object');
    assert.ok(t.description.length > 10, t.name);
  }
  const enums = catalogueEnums(catalogue);
  assert.ok(enums.furniture.includes('sofa_3') && enums.furniture.length >= 40);
  assert.ok(enums.colours.includes('steel-charcoal') && enums.materials.includes('brick'));
  const finish = tools.find((t) => t.name === 'set_finish');
  assert.ok(finish.input_schema.properties.colour.enum.includes('steel-charcoal'));
  assert.ok(finish.input_schema.properties.material.enum.includes('corrugated'));
  assert.ok(tools.find((t) => t.name === 'add_furniture').input_schema.properties.item.enum.includes('sofa_3'));
  assert.deepEqual(buildTools(null).map((t) => t.name), Object.keys(OPS), 'works without a catalogue');

  const good = checkToolCall('set_finish', { target: 'roof', colour: 'steel-charcoal' }, tools);
  assert.equal(good.ok, true);
  assert.deepEqual(good.args, { target: 'roof', colour: 'steel-charcoal' });
  const unknownColour = checkToolCall('set_finish', { target: 'roof', colour: 'hot-pink' }, tools);
  assert.equal(unknownColour.ok, false);
  assert.match(unknownColour.error, /colour/);
  assert.match(checkToolCall('make_tea', {}, tools).error, /Unknown operation/);
  assert.equal(checkToolCall('set_finish', { colour: 'steel-charcoal' }, tools).ok, false, 'missing required target');
  assert.deepEqual(checkToolCall('add_room', { x: '0', y: 0, width: '3000', depth: 3000, bogus: 1, type: 'study' }, tools).args, { x: 0, y: 0, width: 3000, depth: 3000, type: 'study' });
});

test('11. the changes the assistant returns apply as one undo step through the operations layer', () => {
  const store = sampleStore();
  const deck = store.project.levels[0].rooms.find((r) => r.name === 'Deck');
  const before = structuredClone(store.project);
  const ops = [
    { op: 'set_finish', args: { target: 'roof', colour: 'steel-charcoal' } },
    { op: 'resize_room', args: { id: deck.id, side: 'south', delta: 1000 } },
    { op: 'resize_room', args: { id: 'r_missing', side: 'south', delta: 1000 } },
  ];
  const names = nameResolver(catalogue);
  const phrases = ops.map((o) => describeOp(o.op, o.args, store.project, names));
  const results = store.runBatch(`AI: ${summariseOps(phrases)}`, ops.map((o) => ({ op: o.op, args: o.args })));
  assert.deepEqual(results.map((r) => r.ok), [true, true, false]);
  assert.match(results[2].error, /No element with id r_missing/);
  assert.equal(store.project.finishes.roof.colour, 'steel-charcoal');
  assert.equal(store.undoLabel(), 'AI: Roof colour set to Charcoal and 2 more');
  assert.equal(store.undo(), true);
  assert.deepEqual(store.project.finishes, before.finishes);
  assert.deepEqual(store.project.levels[0].rooms, before.levels[0].rooms, 'one undo restores every change');
  assert.equal(store.undoLabel(), 'Change finish', 'only the AI step was undone');
});

// 6. Exporters (SCOPE 8, 16 test 9) ---------------------------------------------------------------------------------------------------
function dxfEntities(text) {
  const pairs = parseDXF(text);
  const start = pairs.findIndex((p, i) => p.code === 2 && p.value === 'ENTITIES' && pairs[i - 1]?.value === 'SECTION');
  const end = pairs.findIndex((p, i) => i > start && p.code === 0 && p.value === 'ENDSEC');
  const out = [];
  let cur = null;
  for (const p of pairs.slice(start + 1, end)) {
    if (p.code === 0) {
      cur = { type: p.value, g: {} };
      out.push(cur);
    } else if (cur) (cur.g[p.code] ??= []).push(p.value);
  }
  return out;
}

test('9. DXF: R12 ASCII, Appendix B layers, a 10,000 mm wall measures 10000 and Y is minus plan y', () => {
  const store = createStore(createProject({ id: 'p_dxf', name: 'DXF check' }), { opContext: { catalogue } });
  store.run('add_wall', { x1: 0, y1: 2000, x2: 10000, y2: 2000, thickness: 250 });
  store.run('add_wall', { x1: 0, y1: 5000, x2: 4000, y2: 5000, thickness: 250, status: 'existing' });
  store.run('add_wall', { x1: 0, y1: 7000, x2: 4000, y2: 7000, thickness: 250, status: 'demolish' });
  const text = toDXF(store.project, { catalogue });
  assert.ok(text.startsWith('  0\nSECTION\n  2\nHEADER'));
  assert.match(text, /\nAC1009\n/);
  assert.ok(/^[\x20-\x7e\n]*$/.test(text), 'ASCII only');
  assert.ok(text.trimEnd().endsWith('EOF'));
  for (const l of DXF_LAYERS) assert.match(text, new RegExp(`\\n${l.key}\\n`), l.key);
  assert.equal(DXF_LAYERS.length, 14, 'Appendix B 13 layers plus the title block layer');
  assert.match(text, /\nDASHED\n/);
  const ents = dxfEntities(text);
  const num = (e, code, at = 0) => Number(e.g[code]?.[at]);
  const lines = ents.filter((e) => e.type === 'LINE');
  const len = (e) => Math.hypot(num(e, 11) - num(e, 10), num(e, 21) - num(e, 20));
  const newWall = lines.filter((e) => e.g[8][0] === 'PS-WALL-NEW');
  assert.ok(newWall.some((e) => Math.abs(len(e) - 10000) < 0.01), 'a wall face measures 10000');
  assert.ok(newWall.every((e) => num(e, 20) < 0 && num(e, 21) < 0), 'DXF Y is minus plan y (2000 becomes about -2000)');
  const ys = newWall.map((e) => num(e, 20));
  assert.ok(Math.max(...ys) < -1800 && Math.min(...ys) > -2200);
  assert.ok(lines.some((e) => e.g[8][0] === 'PS-WALL-EXIST'));
  assert.ok(lines.some((e) => e.g[8][0] === 'PS-WALL-DEMO'));
  assert.ok(ents.some((e) => e.type === 'TEXT' && e.g[8][0] === 'PS-ANNO' && /millimetres/i.test(e.g[1].join(' '))), 'units are stated in a note');
  // Layer names come from a configurable map.
  const mapped = toDXF(store.project, { catalogue, layerMap: { 'PS-WALL-NEW': 'A-WALL' } });
  assert.match(mapped, /\nA-WALL\n/);
  assert.ok(!/\nPS-WALL-NEW\n/.test(mapped));
});

test('9. DXF: all levels in one file, side by side with titles, and entities for rooms, doors, windows and tanks', () => {
  const store = sampleStore();
  store.run('add_level', { name: 'First', copy_outline: true });
  const text = toDXF(store.project, { catalogue });
  const ents = dxfEntities(text);
  const layers = new Set(ents.map((e) => e.g[8]?.[0]));
  for (const key of ['PS-WALL-NEW', 'PS-DOOR', 'PS-WIN', 'PS-ROOM', 'PS-TEXT', 'PS-DIM', 'PS-FURN', 'PS-SITE', 'PS-ROOF', 'PS-ANNO']) assert.ok(layers.has(key), `no entities on ${key}`);
  const kinds = new Set(ents.map((e) => e.type));
  for (const k of ['LINE', 'ARC', 'CIRCLE', 'POLYLINE', 'TEXT']) assert.ok(kinds.has(k), k);
  const titles = ents.filter((e) => e.type === 'TEXT' && e.g[8][0] === 'PS-ANNO').map((e) => e.g[1].join(' '));
  assert.ok(titles.some((t) => /GROUND/i.test(t)) && titles.some((t) => /FIRST/i.test(t)), titles.join(' | '));
  const xs = ents.filter((e) => e.type === 'LINE' && e.g[8][0] === 'PS-WALL-NEW').map((e) => Number(e.g[10][0]));
  assert.ok(Math.max(...xs) > 14000, 'the second level sits to the right of the first');
});

test('9. PDF: A3 landscape, 1:100 means 10,000 mm is 100 mm on the sheet, auto scale, title block', () => {
  const calls = { lines: [], texts: [] };
  class Recorder extends jsPDF {
    constructor(...a) {
      super(...a);
      const line = this.line.bind(this);
      const text = this.text.bind(this);
      this.line = (x1, y1, x2, y2, ...r) => (calls.lines.push([x1, y1, x2, y2]), line(x1, y1, x2, y2, ...r));
      this.text = (t, ...r) => (calls.texts.push(Array.isArray(t) ? t.join(' ') : String(t)), text(t, ...r));
    }
  }
  const store = createStore(createProject({ id: 'p_pdf', name: 'Smith residence' }), { opContext: { catalogue } });
  store.run('add_wall', { x1: 0, y1: 0, x2: 10000, y2: 0, thickness: 250 });
  const config = { disclaimer: 'Concept design only. Not for construction.' };
  store.run('set_titleblock', { company: 'Example Design Pty Ltd', client: 'A and B Smith', jobNumber: '2601', drawnBy: 'XY' });
  const bytes = toPDF(store.project, { jsPDF: Recorder, config, catalogue, scale: 100, date: new Date(2026, 9, 14) });
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const raw = Buffer.from(bytes).toString('latin1');
  const box = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(raw);
  assert.ok(Math.abs(Number(box[1]) - 1190.55) < 0.05 && Math.abs(Number(box[2]) - 841.89) < 0.05, 'A3 landscape, 420 by 297 mm');
  assert.equal(bytes.layout.scale, 100);
  assert.deepEqual(bytes.layout.pages, ['title', 'level', 'schedule']);
  const lengths = calls.lines.map(([a, b, c, d]) => Math.hypot(c - a, d - b));
  assert.ok(lengths.some((l) => Math.abs(l - 100) < 0.05), 'the 10,000 mm dimension line is 100 mm long');
  assert.ok(calls.texts.includes('10000'), 'dimension text');
  assert.ok(calls.texts.includes('1:100'));
  assert.ok(calls.texts.includes('14/10/2026'), 'DD/MM/YYYY date');
  assert.ok(calls.texts.some((t) => t.includes('Example Design Pty Ltd')), 'company from the title block');
  assert.ok(calls.texts.includes('A and B Smith') && calls.texts.includes('2601') && calls.texts.includes('XY'), 'title block values are printed');
  assert.ok(calls.texts.includes('PS-1001') && calls.texts.includes('2 OF 3'));
  assert.ok(calls.texts.some((t) => /^GROUND FLOOR PLAN  1:100 at A3$/.test(t)), 'plan title with scale and paper');
  assert.ok(!calls.texts.includes('Glide Inside'), 'the logo image carries the name; no duplicate text line');
  assert.ok(!calls.texts.some((t) => /JCE/i.test(t)), 'no JCE text');
  assert.ok(calls.texts.some((t) => t.includes('Concept design only. Not for construction.')));
  assert.ok(!calls.texts.some((t) => /[–—]/.test(t)), 'no dashes in the document text');

  // Half the scale: 1:200 puts the same wall at 50 mm.
  calls.lines.length = 0;
  toPDF(store.project, { jsPDF: Recorder, config, catalogue, scale: 200 });
  assert.ok(calls.lines.map(([a, b, c, d]) => Math.hypot(c - a, d - b)).some((l) => Math.abs(l - 50) < 0.05));

  // The scale is chosen automatically to fit: a 45 m wide building cannot be drawn at 1:100 on A3.
  const wide = createStore(createProject({ id: 'p_wide', name: 'Wide' }), { opContext: { catalogue } });
  wide.run('add_room', { name: 'Shed', type: 'other', x: 0, y: 0, width: 45000, depth: 12000 });
  assert.equal(toPDF(wide.project, { jsPDF, config, catalogue }).layout.scale, 200);
  const small = createStore(createProject({ id: 'p_small', name: 'Small' }), { opContext: { catalogue } });
  small.run('add_room', { name: 'Room', type: 'other', x: 0, y: 0, width: 3000, depth: 3000 });
  assert.equal(toPDF(small.project, { jsPDF, config, catalogue }).layout.scale, 50);
});

test('9. PDF: one sheet per level, schedules, and a cover always, and a 3D view sheet when an image is supplied', () => {
  const store = sampleStore();
  store.run('add_level', { name: 'First', copy_outline: true });
  const config = {};
  const plain = toPDF(store.project, { jsPDF, config, catalogue });
  assert.deepEqual(plain.layout.pages, ['title', 'level', 'level', 'schedule']);
  // A 1 by 1 pixel PNG stands in for the 3D snapshot.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const withCover = toPDF(store.project, { jsPDF, config, catalogue, image: png });
  assert.deepEqual(withCover.layout.pages, ['title', 'level', 'level', 'view', 'schedule']);
  assert.deepEqual(withCover.layout.sheets.map((x) => x.number), ['PS-1000', 'PS-1001', 'PS-1002', 'PS-1003', 'PS-1004']);
  assert.ok(withCover.length > plain.length);
});

test('9. drawing set: scale bar length, cover and register, fallback note, A1, DXF scale bar and title block', async () => {
  const { scaleBarSpec, chooseScale, levelContent, titleBlockValues } = await import('../src/premium/exporters/drawing.js');
  assert.equal(scaleBarSpec(100).metres, 5);
  assert.ok(Math.abs(scaleBarSpec(100).paperMm - 50) < 1e-9, '5 m at 1:100 is 50 mm');
  assert.ok(Math.abs(scaleBarSpec(50).paperMm - 100) < 1e-9, '5 m at 1:50 is 100 mm');

  const calls = { rects: [], texts: [] };
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const rect = this.rect.bind(this);
      const text = this.text.bind(this);
      this.rect = (x, y, w, h, st) => (calls.rects.push({ w, h, st }), rect(x, y, w, h, st));
      this.text = (t, ...r) => (calls.texts.push(Array.isArray(t) ? t.join(' ') : String(t)), text(t, ...r));
    }
  }
  const store = sampleStore('p_set');
  store.run('add_level', { name: 'First', copy_outline: true });
  store.run('set_titleblock', { projectName: 'Smith residence', client: 'A Smith', address: '1 Test Road, Macksville NSW', drawingPrefix: 'XY', issuePurpose: 'Concept' });
  store.run('set_drawing', { scale: 100, paper: 'A3' });
  let out = toPDF(store.project, { jsPDF: Rec, catalogue, logo: null });
  // Scale bar: segments alternate filled and open and total 50 mm at 1:100 on A3.
  const segs = calls.rects.filter((r) => Math.abs(r.h - 2) < 1e-6 && r.st === 'FD');
  assert.equal(segs.length, 10, 'five segments on each of the two plan sheets');
  assert.ok(Math.abs(segs.reduce((a, r) => a + r.w, 0) - 100) < 1e-6, 'each bar is 50 mm on paper');
  assert.deepEqual(out.layout.sheets.map((x) => x.number), ['XY-1000', 'XY-1001', 'XY-1002', 'XY-1003']);
  assert.ok(out.layout.sheets[0].title.includes('DRAWING REGISTER'));
  for (const t of ['SMITH RESIDENCE', 'PREPARED FOR A SMITH', '1 TEST ROAD, MACKSVILLE NSW', 'SITE PLAN', 'DRAWING No.', 'XY-1000', 'XY-1003', 'SHEET', '1 OF 4']) assert.ok(calls.texts.includes(t), t);
  assert.ok(calls.texts.some((t) => /^C O N C E P T/.test(t)), 'letter spaced caption');
  assert.ok(!/[–—]/.test(calls.texts.join('')));

  // A1 keeps real millimetres: the bar is 50 mm at 1:100 on A1 too.
  calls.rects.length = 0;
  out = toPDF(store.project, { jsPDF: Rec, catalogue, scale: 100, paper: 'A1' });
  const raw = Buffer.from(out).toString('latin1');
  const mb = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(raw);
  assert.ok(Math.abs(Number(mb[1]) - 2383.94) < 0.1, 'A1 landscape');
  assert.equal(out.layout.paper, 'A1');

  // A scale that does not fit falls back to the next one that does and says so.
  const wide = createStore(createProject({ id: 'p_wide2', name: 'Wide' }), { opContext: { catalogue } });
  wide.run('add_room', { name: 'Shed', type: 'other', x: 0, y: 0, width: 45000, depth: 12000 });
  const r = toPDF(wide.project, { jsPDF, catalogue, scale: 100 }).layout;
  assert.equal(r.scale, 200);
  assert.equal(r.fallback, true);
  assert.match(r.note, /1:100 does not fit on A3\. Drawn at 1:200\./);
  assert.equal(toPDF(wide.project, { jsPDF, catalogue, scale: 100, paper: 'A1' }).layout.scale, 100, 'A1 holds 1:100');

  // Empty title block fields stay empty.
  const v = titleBlockValues(createProject({ id: 'p_e', name: 'E' }), { sheetNo: 2, total: 3 });
  assert.equal(v.client, '');
  assert.equal(v.drawingNo, 'PS-1001');

  // DXF: scale bar in true millimetres and title block text.
  const dxf = toDXF(store.project, { catalogue });
  const ents = dxfEntities(dxf);
  assert.ok(ents.some((e) => e.type === 'SOLID' || e.type === 'POLYLINE'));
  const anno = ents.filter((e) => e.type === 'TEXT').map((e) => e.g[1].join(' '));
  assert.ok(anno.some((t) => /^PROJECT: SMITH RESIDENCE/i.test(t)) || anno.some((t) => /^PROJECT: Smith residence/.test(t)), anno.join('|'));
  assert.ok(anno.some((t) => /^CLIENT: A Smith/.test(t)) && anno.some((t) => /^DRAWING NO\.: XY-1001/.test(t)));
  assert.ok(anno.includes('5') || anno.includes('10'), 'scale bar labels in metres');
  assert.ok(!/JCE/i.test(dxf));
  assert.ok(ents.some((e) => e.type === 'TEXT' && e.g[8][0] === 'PS-TITLE' && /^PREPARED WITH: Glide Inside/.test(e.g[1].join(' '))), 'title block layer carries the Glide Inside name');
});

test('9. drawing set: Glide Inside logo on cover and every sheet, the user logo only in the client panel, no JCE', async () => {
  const { LOGO_PNG } = await import('../src/premium/brand/logo.js');
  const calls = { images: [], texts: [] };
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const add = this.addImage.bind(this);
      const text = this.text.bind(this);
      this.addImage = (img, ...r) => (calls.images.push(img === LOGO_PNG ? 'brand' : 'user'), add(img, ...r));
      this.text = (t, ...r) => (calls.texts.push(Array.isArray(t) ? t.join(' ') : String(t)), text(t, ...r));
    }
  }
  const store = sampleStore('p_logo');
  store.run('set_titleblock', { projectName: 'Logo test', client: 'C Client' });
  const user = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const out = toPDF(store.project, { jsPDF: Rec, catalogue, logo: user });
  const sheets = out.layout.pages.length;
  assert.equal(calls.images.filter((i) => i === 'brand').length, sheets + 1, 'one in every title block plus the cover');
  assert.equal(calls.images.filter((i) => i === 'user').length, sheets, 'user logo in the client panel of each sheet');
  assert.equal(calls.texts.filter((t) => t === 'Glide Inside').length, 0, 'no duplicate name under the logo');
  assert.ok(calls.texts.includes('CONCEPT'), 'status box');
  assert.ok(!calls.texts.some((t) => /JCE/i.test(t)));
  calls.images.length = 0;
  toPDF(store.project, { jsPDF: Rec, catalogue, logo: null });
  assert.ok(!calls.images.includes('user'));
});

test('9. GLB and OBJ: valid files in metres with Y up, the building only (no lawn disc)', async () => {
  const store = createStore(createProject({ id: 'p_glb', name: 'Smith residence' }), { opContext: { catalogue } });
  store.run('add_room', { name: 'Living', type: 'living', x: 0, y: 0, width: 6000, depth: 4500 });
  store.run('add_room', { name: 'Kitchen', type: 'kitchen', x: 6000, y: 0, width: 4000, depth: 4500 });
  store.run('add_room', { name: 'Deck', type: 'deck', x: 0, y: 4500, width: 6000, depth: 3000 });
  const glb = new Uint8Array(await toGLB(store.project, { catalogue }));
  assert.equal(Buffer.from(glb.subarray(0, 4)).toString(), 'glTF');
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(view.getUint32(4, true), 2, 'glTF version 2');
  assert.equal(view.getUint32(8, true), glb.byteLength, 'declared length matches');
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, 'first chunk is JSON');
  const gltf = JSON.parse(Buffer.from(glb.subarray(20, 20 + jsonLength)).toString('utf8'));
  assert.equal(gltf.asset.version, '2.0');
  assert.ok(gltf.meshes.length > 0 && gltf.nodes.length > 0);
  const boxes = gltf.meshes.flatMap((m) => m.primitives.map((p) => gltf.accessors[p.attributes.POSITION])).filter((a) => a?.min && a?.max);
  assert.ok(boxes.length > 5);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const a of boxes) for (let i = 0; i < 3; i++) (lo[i] = Math.min(lo[i], a.min[i]), (hi[i] = Math.max(hi[i], a.max[i])));
  const size = hi.map((v, i) => v - lo[i]);
  // Plan is 10 m wide (living 6 m and kitchen 4 m) and 7.5 m deep with the deck; X is plan x and Z is plan y, in metres.
  assert.ok(size[0] > 10 && size[0] < 12.5, `width ${size[0]} m`);
  assert.ok(size[2] > 7.5 && size[2] < 10, `depth ${size[2]} m`);
  assert.ok(!gltf.nodes.some((n) => n.name === 'ground'), 'no ground disc');
  assert.ok(size[1] > 2.4 && size[1] < 6, `height ${size[1]} m, Y up`);
  assert.ok(lo[1] > -0.5, 'the model stands on y = 0');

  const obj = toOBJ(store.project, { catalogue });
  const objText = typeof obj === 'string' ? obj : obj.obj;
  assert.match(objText, /^v -?[\d.]+ -?[\d.]+ -?[\d.]+$/m);
  assert.match(objText, /^f /m);
});

test('zip and the one-call export entry point', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = zipStore([{ name: 'a.obj', data: 'v 0 0 0\n' }, { name: 'a.mtl', data: 'newmtl x\n' }], new Date(2026, 9, 14, 10, 30));
  assert.equal(Buffer.from(zip.subarray(0, 4)).toString('latin1'), 'PK\u0003\u0004');
  const text = Buffer.from(zip).toString('latin1');
  assert.ok(text.includes('a.obj') && text.includes('a.mtl') && text.includes('v 0 0 0\n'));
  assert.equal(new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(zip.byteLength - 22, true), 0x06054b50, 'end of central directory');

  const store = sampleStore();
  assert.deepEqual(['pdf', 'dxf', 'glb', 'obj'].map((t) => exportFilename(t, store.project)), ['smith-residence-plans.pdf', 'smith-residence.dxf', 'smith-residence.glb', 'smith-residence-obj.zip']);
  const dxf = await buildExport('dxf', store.project, { config: { disclaimer: 'x' }, catalogue });
  assert.equal(dxf.mime, 'application/dxf');
  assert.ok(dxf.bytes.length > 3000);
  const pdf = await buildExport('pdf', store.project, { loadJsPDF: async () => jsPDF, config: {}, catalogue });
  assert.equal(pdf.filename, 'smith-residence-plans.pdf');
  assert.equal(Buffer.from(pdf.bytes.subarray(0, 5)).toString(), '%PDF-');
  const glb = await buildExport('glb', store.project, { catalogue });
  assert.equal(glb.mime, 'model/gltf-binary');
  const objZip = await buildExport('obj', store.project, { catalogue });
  assert.equal(objZip.filename, 'smith-residence-obj.zip');
  assert.match(Buffer.from(objZip.bytes).toString('latin1'), /smith-residence\.mtl/);
  await assert.rejects(buildExport('stl', store.project), /Unknown export type/);
});

// 7. The UI in Chromium (skipped when Playwright is not available) ---------------------------------------------------------------
const PYTHON = process.env.PYTHON || 'python3';
const hasBrowser = spawnSync(PYTHON, ['-c', 'import playwright'], { encoding: 'utf8' }).status === 0 && fs.existsSync(path.join(ROOT, 'tools/smoke.py'));
const skipUi = hasBrowser ? false : 'Playwright for Python is not installed';

const PRELUDE = String.raw`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { let v = null; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(30); } };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const text = (el) => (el ? el.textContent : null);
  const T = window.__tp;
  const S = T.store;
  const typeInto = (value) => { const t = $('.psp-ai textarea'); t.value = value; t.dispatchEvent(new Event('input', { bubbles: true })); return t; };
  const send = (value) => { typeInto(value); $('.psp-ai .psp-btn--primary').click(); };
  const idle = () => until(() => { const b = $('.psp-ai .psp-btn--primary'); return b && b.getAttribute('aria-busy') !== 'true' && !$('.psp-dots') && !$('.psp-modal'); });
  const msgs = () => $$('.psp-history .psp-msg');
  const lastMsg = () => msgs().at(-1);
  const editCalls = () => T.bodies.filter((b) => b.path === '/ai/edit');
  const button = (root, label) => $$('.psp-btn', root).find((b) => b.textContent.trim() === label);
  const out = {};
`;

function browser(query, body, { size } = {}) {
  const script = `async () => { ${PRELUDE} ${body} return JSON.stringify(out); }`;
  const args = [path.join(ROOT, 'tools/smoke.py'), `tests/pages/premium.html${query}`, '--wait', '400', '--eval', script];
  if (size) args.push('--size', size);
  const r = spawnSync(PYTHON, args, { cwd: ROOT, encoding: 'utf8', timeout: 150000 });
  const stdout = r.stdout || '';
  assert.equal(r.status, 0, `the page reported errors or did not run:\n${stdout}\n${r.stderr}`);
  const line = stdout.split('\n').find((l) => l.startsWith('eval: '));
  assert.ok(line, `no result from the page:\n${stdout}`);
  return JSON.parse(line.slice(6));
}

test('UI, locked by default: Unlock button, locked Exports menu, locked assistant, upgrade modal, checkout, no browser dialogs', { skip: skipUi }, () => {
  const r = browser('?state=locked', String.raw`
    let dialogs = 0;
    window.alert = window.confirm = window.prompt = () => { dialogs += 1; return true; };
    out.topbar = text($('#tp-topbar .psp-btn--primary'));
    out.requestsAtStart = T.requests.length;
    $('.psp-menu-wrap > .psp-btn').click();
    await sleep(60);
    const items = $$('.psp-menu-item');
    out.items = items.map((b) => text(b.querySelector('span')));
    out.itemsLocked = items.filter((b) => b.dataset.type !== 'pdf').every((b) => b.getAttribute('aria-disabled') === 'true' && /Locked/.test(b.textContent));
    out.menuOpen = $('.psp-menu').hidden === false;
    out.prompts = $$('.psp-ai .psp-prompt').map((b) => [b.textContent, b.disabled]);
    out.aiButtons = $$('.psp-ai .psp-btn').map((b) => b.textContent.trim());
    out.noInput = !$('.psp-ai textarea');
    out.storeEntitled = S.ui.premium.entitled;
    out.isEntitled = T.premium.isEntitled();
    items[1].click();
    await sleep(120);
    const modal = $('.psp-modal');
    out.modalTitle = text(modal.querySelector('h2'));
    out.modalText = modal.textContent;
    out.menuClosed = $('.psp-menu').hidden === true;
    button(modal, 'Continue to secure checkout').click();
    await until(() => window.__navigated);
    out.navigated = window.__navigated;
    out.paths = T.requests.map((r) => r.path);
    out.checkoutBody = T.bodies.find((b) => b.path === '/checkout').body;
    out.events = T.events.map((e) => e.event);
    out.dialogs = dialogs;
    $('.psp-scrim').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(60);
    out.closedOnEscape = !$('.psp-modal');
  `);
  assert.equal(r.topbar, 'Unlock plans, A$30');
  assert.equal(r.requestsAtStart, 0, 'the locked state makes no network calls');
  assert.deepEqual(r.items, ['PDF plans', 'DXF drawing', '3D model (GLB)', '3D model (OBJ)']);
  assert.equal(r.itemsLocked, true);
  assert.equal(r.menuOpen, true);
  assert.equal(r.prompts.length, 4);
  assert.ok(r.prompts.every(([, disabled]) => disabled), 'example prompts are disabled chips');
  const promptText = r.prompts.map(([t]) => t).join(' | ').toLowerCase();
  for (const word of ['roof', 'deck', 'study', 'flip']) assert.ok(promptText.includes(word), `prompt about ${word}`);
  assert.ok(r.aiButtons.some((t) => /Unlock plans, A\$30/.test(t)));
  assert.equal(r.noInput, true, 'no input box while locked');
  assert.equal(r.storeEntitled, false);
  assert.equal(r.isEntitled, false);
  assert.equal(r.modalTitle, 'Unlock the Plan Pack');
  for (const s of ['A$30', 'incl. GST', 'AI design assistant', '500 AI credits', 'PDF plan set', 'DXF', '3D model files', 'Re-export', '12 months', 'Concept design only', 'Continue to secure checkout', 'Restore purchase']) assert.ok(r.modalText.includes(s), `modal text has "${s}"`);
  assert.ok(!/[–—]/.test(r.modalText), 'no dashes in the copy');
  assert.equal(r.menuClosed, true, 'the menu closes when an item is chosen');
  assert.equal(r.navigated, 'https://checkout.stripe.com/c/pay/cs_test_mock');
  assert.deepEqual(r.paths, ['/checkout']);
  assert.deepEqual(r.checkoutBody, { projectId: 'p_testpage', projectName: 'Smith residence' });
  assert.deepEqual(r.events, ['ps_upgrade_click', 'ps_checkout_started']);
  assert.equal(r.dialogs, 0, 'in-page modals only');
  assert.equal(r.closedOnEscape, true);
});

test('UI, coming soon: the button is disabled and says so, and the modal cannot start checkout', { skip: skipUi }, () => {
  const r = browser('?state=soon', String.raw`
    out.topbar = text($('#tp-topbar .psp-bar-slot .psp-btn'));
    out.topbarDisabled = $('#tp-topbar .psp-bar-slot .psp-btn').disabled;
    out.aiButton = text($('.psp-locked-box .psp-btn'));
    out.aiDisabled = $('.psp-locked-box .psp-btn').disabled;
    T.premium.openUpgrade();
    await sleep(100);
    const modal = $('.psp-modal');
    out.title = text(modal.querySelector('h2'));
    out.checkout = button(modal, 'Plan Pack coming soon').disabled;
    out.requests = T.requests.length;
  `);
  assert.equal(r.topbar, 'Plan Pack coming soon');
  assert.equal(r.topbarDisabled, true);
  assert.equal(r.aiButton, 'Plan Pack coming soon');
  assert.equal(r.aiDisabled, true);
  assert.equal(r.title, 'Plan Pack coming soon');
  assert.equal(r.checkout, true);
  assert.equal(r.requests, 1, 'only the health check goes out when there is no back end');
});

test('UI, assistant: 11 roof colour as one undo step, 14 confirmation, friendly errors, failures listed, undo button', { skip: skipUi }, () => {
  const r = browser('?state=entitled', String.raw`
    out.meter = text($('.psp-meter-text'));
    out.chips = $$('.psp-ai .psp-prompt').map((b) => b.disabled);
    const levelId = S.ui.activeLevelId;
    send('Make the roof dark grey');
    await idle();
    out.roof = S.project.finishes.roof.colour;
    out.undoLabel = S.undoLabel();
    out.reply = text(lastMsg());
    out.meterAfter = text($('.psp-meter-text'));
    const first = editCalls()[0];
    out.edit1 = { keys: Object.keys(first.body).sort(), history: first.body.history.length, active: first.body.activeLevelId === levelId, firstLine: first.body.context.split('\n')[0], bearer: /^Bearer \S+$/.test(first.auth), confirmLarge: first.body.confirmLarge };
    out.estimateFirst = T.bodies.findIndex((b) => b.path === '/ai/estimate') < T.bodies.findIndex((b) => b.path === '/ai/edit');
    button(lastMsg(), 'Undo').click();
    await sleep(60);
    out.afterPanelUndo = S.project.finishes.roof.colour;
    out.undoneText = /Undone/.test(text(lastMsg()));
    out.noUndoButton = !button(lastMsg(), 'Undo');

    send('Make the deck 1 m deeper');
    await idle();
    out.edit2History = editCalls()[1].body.history.map((h) => h.role + ':' + h.content);
    const deck = S.project.levels[0].rooms.find((x) => x.name === 'Deck');
    out.deckBottom = Math.max(...deck.polygon.map((p) => p.y));
    out.deckLabel = S.undoLabel();
    S.undo();
    await sleep(60);
    out.deckBack = Math.max(...S.project.levels[0].rooms.find((x) => x.name === 'Deck').polygon.map((p) => p.y));
    out.undoGoneAfterOutsideUndo = !button(lastMsg(), 'Undo') && /Undone/.test(text(lastMsg()));

    send('oops bad idea');
    await idle();
    const partial = lastMsg();
    out.partial = { text: text(partial), failList: $$('.psp-changes--fail li', partial).length, okList: $$('.psp-changes:not(.psp-changes--fail) li', partial).length };
    out.partialLabel = S.undoLabel();
    S.undo();

    const errs = {};
    for (const [k, v] of [['paused', 'please pause'], ['rate', 'rate limit me'], ['offline', 'go offline']]) { send(v); await idle(); errs[k] = text(lastMsg()); }
    out.errs = errs;
    out.errorStyle = lastMsg().classList.contains('psp-msg--error');

    const before = editCalls().length;
    send('do everything large');
    const dlg = await until(() => $('.psp-modal'));
    out.confirmText = dlg.textContent;
    button(dlg, 'Cancel').click();
    await sleep(150);
    out.cancelEdits = editCalls().length - before;
    out.restored = $('.psp-ai textarea').value;
    $('.psp-ai .psp-btn--primary').click();
    const dlg2 = await until(() => $('.psp-modal'));
    button(dlg2, 'Continue').click();
    await idle();
    out.confirmLarge = editCalls().at(-1).body.confirmLarge;
    out.largeReply = text(lastMsg());

    const histories = editCalls().map((c) => c.body.history);
    out.maxHistory = Math.max(...histories.map((h) => h.length));
    out.errorTurnsInHistory = histories.flat().some((h) => /paused|quickly|reach/.test(h.content));
    out.events = [...new Set(T.events.map((e) => e.event))];

    T.credits.used = 500;
    send('one more please');
    await idle();
    out.exhaustedMsg = text(lastMsg());
    out.readOnly = { input: $('.psp-ai textarea').disabled, send: $('.psp-ai .psp-btn--primary').disabled, banner: text($('.psp-banner')) };
    S.run('set_finish', { target: 'roof', colour: 'steel-cream' });
    out.manualEdit = S.project.finishes.roof.colour;
  `);
  assert.equal(r.meter, '312 of 500 credits left');
  assert.deepEqual(r.chips, [false, false, false, false]);
  assert.equal(r.roof, 'steel-charcoal', 'roof colour changed');
  assert.equal(r.undoLabel, 'AI: Roof colour set to Charcoal');
  assert.match(r.reply, /Done\. The roof is now charcoal\./);
  assert.match(r.reply, /Changes made/);
  assert.match(r.reply, /Roof colour set to Charcoal/);
  assert.match(r.reply, /2 credits used/);
  assert.equal(r.meterAfter, '310 of 500 credits left');
  assert.deepEqual(r.edit1, { keys: ['activeLevelId', 'confirmLarge', 'context', 'history', 'message'], history: 0, active: true, firstLine: 'PROJECT "Smith residence" type=house units=mm x=right y=down(south)', bearer: true, confirmLarge: false });
  assert.equal(r.estimateFirst, true, 'the estimate is asked for before the request');
  assert.equal(r.afterPanelUndo, 'steel-off-white', 'one Undo click restores the colour');
  assert.equal(r.undoneText, true);
  assert.equal(r.noUndoButton, true);
  assert.deepEqual(r.edit2History, ['user:Make the roof dark grey', 'assistant:Done. The roof is now charcoal.'], 'the last turns are sent');
  assert.equal(r.deckBottom, 8500, 'the deck is 1 m deeper');
  assert.equal(r.deckLabel, 'AI: Deck extended 1.0 m south');
  assert.equal(r.deckBack, 7500);
  assert.equal(r.undoGoneAfterOutsideUndo, true, 'the panel Undo follows the history');
  assert.match(r.partial.text, /I tried two changes/);
  assert.equal(r.partial.okList, 1);
  assert.equal(r.partial.failList, 1);
  assert.match(r.partial.text, /Resize room: No element with id r_missing/);
  assert.equal(r.partialLabel, 'AI: Roof colour set to Charcoal and 1 more');
  assert.match(r.errs.paused, /paused.*credits are untouched/);
  assert.match(r.errs.rate, /Wait about 12 seconds/);
  assert.match(r.errs.offline, /Could not reach the Plan Studio server.*Nothing was charged/);
  assert.equal(r.errorStyle, true);
  assert.match(r.confirmText, /This change may use about 14 credits\. \d+ credits remain\. Continue\?/);
  assert.equal(r.cancelEdits, 0, 'cancelling sends nothing');
  assert.equal(r.restored, 'do everything large', 'the message comes back to the box');
  assert.equal(r.confirmLarge, true);
  assert.ok(r.maxHistory <= 8);
  assert.equal(r.errorTurnsInHistory, false, 'failed turns are not sent back as history');
  for (const e of ['ps_ai_request']) assert.ok(r.events.includes(e), e);
  assert.match(r.exhaustedMsg, /All AI credits in this Plan Pack have been used.*read-only.*Manual editing and exports still work/);
  assert.equal(r.readOnly.input, true);
  assert.equal(r.readOnly.send, true);
  assert.match(r.readOnly.banner, /read-only/);
  assert.equal(r.manualEdit, 'steel-cream', 'manual editing still works (13)');
});

test('UI, warnings: the 95% banner shows once and is remembered; 13 the panel is read-only at the allowance while exports work', { skip: skipUi }, () => {
  const warn = browser('?state=warn', String.raw`
    out.start = text($('.psp-meter-text'));
    send('make the roof charcoal');
    await idle();
    out.banners = $$('.psp-banner').map((b) => b.textContent);
    out.level = $('.psp-meter').dataset.level;
    out.stored = localStorage.getItem('ps.ai.warned.p_testpage');
    S.undo();
    send('make the roof charcoal');
    await idle();
    out.bannersAfter = $$('.psp-banner').length;
    $('.psp-banner .psp-btn--icon').click();
    out.afterDismiss = $$('.psp-banner').length;
    out.warningEvents = T.events.filter((e) => e.event === 'ps_ai_credits_warning').length;
  `);
  assert.equal(warn.start, '27 of 500 credits left');
  assert.equal(warn.banners.length, 1);
  assert.match(warn.banners[0], /Only 25 credits left.*read-only/);
  assert.equal(warn.level, 'danger');
  assert.equal(warn.stored, '[0.95]');
  assert.equal(warn.bannersAfter, 1, 'the same threshold is not shown again');
  assert.equal(warn.afterDismiss, 0);
  assert.equal(warn.warningEvents, 1);

  const done = browser('?state=exhausted', String.raw`
    out.meter = text($('.psp-meter-text'));
    out.input = $('.psp-ai textarea').disabled;
    out.send = $('.psp-ai .psp-btn--primary').disabled;
    out.chips = $$('.psp-ai .psp-prompt').map((b) => b.disabled);
    out.banner = text($('.psp-banner'));
    out.placeholder = $('.psp-ai textarea').placeholder;
    S.run('set_finish', { target: 'roof', colour: 'steel-charcoal' });
    out.manual = S.project.finishes.roof.colour;
    $('.psp-menu-wrap > .psp-btn').click();
    await sleep(60);
    $('.psp-menu-item[data-type=dxf]').click();
    await until(() => T.downloads.length);
    out.downloads = T.downloads.map((d) => d.name);
    out.aiCalls = T.requests.filter((r) => r.path.startsWith('/ai')).length;
  `);
  assert.equal(done.meter, '0 of 500 credits left');
  assert.equal(done.input, true);
  assert.equal(done.send, true);
  assert.deepEqual(done.chips, [true, true, true, true]);
  assert.match(done.banner, /used all 500 AI credits.*read-only.*Manual editing and exports still work/);
  assert.match(done.placeholder, /read-only/);
  assert.equal(done.manual, 'steel-charcoal');
  assert.deepEqual(done.downloads, ['smith-residence.dxf']);
  assert.equal(done.aiCalls, 0);
});

test('UI, exports with a Plan Pack: all four files come from the server with the bearer token', { skip: skipUi }, () => {
  const r = browser('?state=entitled', String.raw`
    for (const type of ['pdf', 'dxf', 'glb', 'obj']) {
      $('.psp-menu-wrap > .psp-btn').click();
      await sleep(60);
      $('.psp-menu-item[data-type=' + type + ']').click();
      if (type === 'pdf') { await sleep(150); $('.psp-btn[data-act=download]').click(); }
      await until(() => T.downloads.length === ['pdf', 'dxf', 'glb', 'obj'].indexOf(type) + 1);
    }
    out.downloads = T.downloads.map((d) => d.name);
    const exportCalls = T.bodies.filter((b) => b.path.startsWith('/export/'));
    out.calls = exportCalls.map((c) => [c.path, Object.keys(c.body).join(','), /^Bearer /.test(c.auth)]);
    out.underlay = exportCalls[0].body.project.site.underlay;
    out.projectId = exportCalls[0].body.project.id;
    out.events = T.events.filter((e) => e.event === 'ps_export').map((e) => e.props.type);
    out.chip = text($('.psp-chip'));
    out.menuFoot = (() => { $('.psp-menu-wrap > .psp-btn').click(); return text($('.psp-menu-foot')); })();
  `);
  assert.deepEqual(r.downloads, ['smith-residence-plans.pdf', 'smith-residence.dxf', 'smith-residence.glb', 'smith-residence-obj.zip']);
  assert.deepEqual(r.calls, [['/export/pdf', 'project', true], ['/export/dxf', 'project', true], ['/export/glb', 'project', true], ['/export/obj', 'project', true]]);
  assert.equal(r.underlay, null);
  assert.equal(r.projectId, 'p_testpage');
  assert.deepEqual(r.events, ['pdf', 'dxf', 'glb', 'obj']);
  assert.equal(r.chip, 'Plan Pack');
  assert.match(r.menuFoot, /Re-export as often as you like until \d\d\/\d\d\/\d{4}\./);
});

test('8. UI, checkout return: waits for the webhook, stores the token, unlocks; restore purchase works with email and reference', { skip: skipUi }, () => {
  const back = browser('?open=return', String.raw`
    out.waiting = text($('.psp-modal'));
    await until(() => /Plan Pack unlocked/.test(text($('.psp-modal'))), 8000);
    out.done = text($('.psp-modal'));
    out.entitled = T.premium.isEntitled();
    out.stored = Object.keys(localStorage).filter((k) => k.startsWith('ps.ent.'));
    out.url = location.search;
    out.polls = T.requests.filter((r) => r.path === '/entitlement').length;
    out.sessionSent = T.bodies.filter((b) => b.path === '/entitlement').length;
    button($('.psp-modal'), 'Start using it').click();
    await sleep(80);
    out.meter = text($('.psp-meter-text'));
    out.chip = text($('.psp-chip'));
    out.events = T.events.map((e) => e.event);
    out.storeUi = S.ui.premium;
  `);
  assert.match(back.waiting, /waiting for the payment to be confirmed/);
  assert.match(back.done, /Plan Pack unlocked.*Payment received.*312 of 500 left.*Exports until\s*\d\d\/\d\d\/\d{4}.*ent_test0001/);
  assert.equal(back.entitled, true);
  assert.deepEqual(back.stored, ['ps.ent.p_testpage']);
  assert.equal(back.url, '?open=return', 'the checkout parameters are removed from the address');
  assert.ok(back.polls >= 3, `${back.polls} polls`);
  assert.equal(back.meter, '312 of 500 credits left');
  assert.equal(back.chip, 'Plan Pack');
  assert.deepEqual(back.events, ['ps_checkout_completed']);
  assert.deepEqual(back.storeUi, { entitled: true, credits: { total: 500, used: 188, remaining: 312 } });

  const restore = browser('?open=restore', String.raw`
    const email = $('#psp-restore-email');
    const ref = $('#psp-restore-ref');
    out.focus = document.activeElement === email;
    const submit = () => $('.psp-modal .psp-btn--primary').click();
    submit(); await sleep(80);
    out.emptyError = text($('.psp-modal .psp-error'));
    email.value = 'jayden@example.com'; ref.value = 'bogus-reference';
    submit();
    await until(() => /could not find/.test(text($('.psp-modal .psp-error')) || ''));
    out.badError = text($('.psp-modal .psp-error'));
    ref.value = 'cs_test_paid1';
    submit();
    await until(() => /restored/.test(text($('.psp-modal h2'))));
    out.title = text($('.psp-modal h2'));
    out.body = text($('.psp-modal-body'));
    out.entitled = T.premium.isEntitled();
    out.restoreBody = T.bodies.filter((b) => b.path === '/entitlement/restore').at(-1).body;
    out.stored = Object.keys(localStorage).filter((k) => k.startsWith('ps.ent.'));
  `);
  assert.equal(restore.focus, true);
  assert.match(restore.emptyError, /Enter the email address used at checkout/);
  assert.match(restore.badError, /could not find a Plan Pack/);
  assert.equal(restore.title, 'Plan Pack restored');
  assert.match(restore.body, /active for the design that is open now/);
  assert.equal(restore.entitled, true);
  assert.deepEqual(restore.restoreBody, { email: 'jayden@example.com', sessionOrReceipt: 'cs_test_paid1' });
  assert.deepEqual(restore.stored, ['ps.ent.p_testpage']);
});

test('UI, a refunded or expired Plan Pack: the token is forgotten and the locked state returns with an explanation', { skip: skipUi }, () => {
  const r = browser('?state=revoked', String.raw`
    await until(() => !T.premium.isEntitled());
    out.entitled = T.premium.isEntitled();
    out.stored = Object.keys(localStorage).filter((k) => k.startsWith('ps.ent.'));
    out.notice = text($('.psp-ai .psp-note'));
    out.topbar = text($('#tp-topbar .psp-btn--primary'));
    out.input = !!$('.psp-ai textarea');
  `);
  assert.equal(r.entitled, false);
  assert.deepEqual(r.stored, []);
  assert.equal(r.notice, 'This Plan Pack has been refunded. If you think this is a mistake, restore your purchase.');
  assert.equal(r.topbar, 'Unlock plans, A$30');
  assert.equal(r.input, false);
});

test('7. UI, developer unlock (localhost only): exports are built in the browser, jsPDF loads on demand, the assistant says the server is needed', { skip: skipUi }, () => {
  const r = browser('?state=dev', String.raw`
    out.scriptBefore = !!$('script[src*="jspdf"]');
    out.chip = text($('.psp-chip'));
    for (const type of ['dxf', 'glb', 'obj', 'pdf']) {
      $('.psp-menu-wrap > .psp-btn').click();
      await sleep(60);
      $('.psp-menu-item[data-type=' + type + ']').click();
      if (type === 'pdf') { await sleep(150); $('.psp-btn[data-act=download]').click(); }
      await until(() => T.downloads.length === ['dxf', 'glb', 'obj', 'pdf'].indexOf(type) + 1, 30000);
    }
    out.downloads = T.downloads;
    out.scriptAfter = $('script[src*="jspdf"]') ? $('script[src*="jspdf"]').getAttribute('src') : null;
    out.jspdf = typeof window.jspdf?.jsPDF;
    out.serverExports = T.requests.filter((r) => r.path.startsWith('/export')).length;
    send('Make the roof charcoal');
    await sleep(400);
    out.ai = text(lastMsg());
    out.aiCalls = T.requests.filter((r) => r.path.startsWith('/ai')).length;
  `);
  assert.equal(r.scriptBefore, false, 'jsPDF is not loaded until a PDF is built');
  assert.equal(r.chip, 'Dev unlock');
  assert.deepEqual(r.downloads.map((d) => d.name), ['smith-residence.dxf', 'smith-residence.glb', 'smith-residence-obj.zip', 'smith-residence-plans.pdf']);
  assert.ok(r.downloads.every((d) => d.size > 2000), JSON.stringify(r.downloads));
  assert.match(r.scriptAfter, /vendor\/jspdf\/dist\/jspdf\.umd\.min\.js$/);
  assert.equal(r.jspdf, 'function');
  assert.equal(r.serverExports, 0);
  assert.match(r.ai, /needs the Plan Studio server.*server\/README\.md/);
  assert.equal(r.aiCalls, 0);
});

test('UI, narrow screen: no horizontal scroll, menu fits, assistant usable', { skip: skipUi }, () => {
  const r = browser('?state=entitled', String.raw`
    out.overflow = document.documentElement.scrollWidth > window.innerWidth;
    $('.psp-menu-wrap > .psp-btn').click();
    await sleep(80);
    const rect = $('.psp-menu').getBoundingClientRect();
    out.menu = { left: rect.left >= 0, right: rect.right <= window.innerWidth, bottom: rect.bottom <= window.innerHeight };
    out.overflowAfter = document.documentElement.scrollWidth > window.innerWidth;
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await sleep(60);
    out.menuClosed = $('.psp-menu').hidden;
    send('Make the deck 1 m deeper');
    await idle();
    out.reply = text(lastMsg());
    const panel = $('.tp-panel').getBoundingClientRect();
    out.panelFits = panel.right <= window.innerWidth + 1;
  `, { size: '390x844' });
  assert.equal(r.overflow, false);
  assert.deepEqual(r.menu, { left: true, right: true, bottom: true });
  assert.equal(r.overflowAfter, false);
  assert.equal(r.menuClosed, true);
  assert.match(r.reply, /extended the deck/);
  assert.equal(r.panelFits, true);
});

// 8. Wave 2: PDF import and the automatic switch-on -------------------------------------------------------------------------------
const { importPdf, renderScale, MAX_SIDE_PX } = await import('../src/premium/pdf-import.js');

function pdfHarness({ pages = 1, entitled = true, picked = true, size = 1000 } = {}) {
  const calls = { upgrade: [], notices: [], underlay: [], rendered: [], chosen: 0 };
  const file = picked ? new Blob([new Uint8Array(size)], { type: 'application/pdf' }) : null;
  const doc = {
    numPages: pages,
    getPage: async (n) => ({ n, getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }) }),
    destroy() { calls.destroyed = true; },
  };
  const hooks = {
    isEntitled: () => entitled,
    openUpgrade: (o) => calls.upgrade.push(o),
    pickFile: async () => file,
    loadPdf: async () => doc,
    choosePage: async () => { calls.chosen += 1; return 2; },
    renderPage: async (page, scale) => {
      calls.rendered.push({ n: page.n, scale });
      return { width: Math.round(595 * scale), height: Math.round(842 * scale), toBlob: (cb) => cb(new Blob(['png'], { type: 'image/png' })) };
    },
    setUnderlay: async (blob, opts) => { calls.underlay.push({ type: blob.type, opts }); },
    layer: { notify: (text, kind) => { calls.notices.push([kind, text]); return { remove() {} }; } },
  };
  return { calls, hooks, store: sampleStore('p_pdf1') };
}

test('PDF import: not entitled opens the upgrade modal and reads nothing', async () => {
  const h = pdfHarness({ entitled: false });
  let picked = false;
  h.hooks.pickFile = async () => { picked = true; return null; };
  const out = await importPdf({ store: h.store }, h.hooks);
  assert.equal(out.status, 'locked');
  assert.deepEqual(h.calls.upgrade, [{ source: 'pdf-import' }]);
  assert.equal(picked, false);
  assert.equal(h.calls.underlay.length, 0);
});

test('PDF import: a one page PDF becomes the underlay at about 200 dpi and calibration starts', async () => {
  const h = pdfHarness({ pages: 1 });
  const out = await importPdf({ store: h.store }, h.hooks);
  assert.equal(out.status, 'ok');
  assert.equal(h.calls.chosen, 0, 'no page picker for a single page');
  assert.equal(out.page, 1);
  assert.equal(out.dpi, 200);
  assert.equal(out.width, Math.round((595 * 200) / 72));
  assert.deepEqual(h.calls.underlay, [{ type: 'image/png', opts: { calibrate: true } }]);
  assert.ok(h.calls.notices.some(([kind, t]) => kind === 'ok' && /set the scale/.test(t)));
  assert.equal(h.calls.destroyed, true);
});

test('PDF import: several pages ask which one, a cancelled picker or file changes nothing', async () => {
  const h = pdfHarness({ pages: 5 });
  const out = await importPdf({ store: h.store }, h.hooks);
  assert.equal(out.page, 2);
  assert.equal(h.calls.chosen, 1);
  assert.equal(h.calls.rendered[0].n, 2);
  const none = pdfHarness({ picked: false });
  assert.equal((await importPdf({ store: none.store }, none.hooks)).status, 'cancelled');
  const noPage = pdfHarness({ pages: 3 });
  noPage.hooks.choosePage = async () => null;
  assert.equal((await importPdf({ store: noPage.store }, noPage.hooks)).status, 'cancelled');
  assert.equal(none.calls.underlay.length + noPage.calls.underlay.length, 0);
});

test('PDF import: big pages are limited to 4096 px, and failures give a readable message', async () => {
  assert.equal(renderScale(595, 842), 200 / 72);
  const a0 = renderScale(2384, 3370);
  assert.ok(Math.abs(3370 * a0 - MAX_SIDE_PX) < 1e-6, 'A0 is reduced to the 4096 px limit');
  const bad = pdfHarness();
  bad.hooks.loadPdf = async () => { const e = new Error('x'); e.name = 'PasswordException'; throw e; };
  const out = await importPdf({ store: bad.store }, bad.hooks);
  assert.equal(out.status, 'error');
  assert.match(bad.calls.notices.at(-1)[1], /password protected/);
  const huge = pdfHarness({ size: 41 * 1024 * 1024 });
  assert.equal((await importPdf({ store: huge.store }, huge.hooks)).status, 'error');
  assert.match(huge.calls.notices.at(-1)[1], /over 40 MB/);
});

test('PDF import: falls back to the older editor API when setUnderlayFromBlob is missing', async () => {
  const h = pdfHarness();
  delete h.hooks.setUnderlay; // the real helper exists in src/editor2d/underlay.js; check the module still exports it
  const mod = await import('../src/editor2d/underlay.js');
  assert.equal(typeof mod.setUnderlayFromBlob, 'function');
});

test('PDF import: pdf.js loads from the package and reads a real PDF (pages and size)', async (t) => {
  let lib;
  try {
    const { loadPdfjs } = await import('../src/premium/pdf-import.js');
    lib = await loadPdfjs();
  } catch (e) {
    return t.skip(`pdf.js does not load in Node here: ${e.message}`);
  }
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.text('Page one', 20, 20);
  doc.addPage('a3', 'landscape');
  doc.text('Page two', 20, 20);
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  const pdf = await lib.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise;
  assert.equal(pdf.numPages, 2);
  const p2 = await pdf.getPage(2);
  const v = p2.getViewport({ scale: 1 });
  assert.ok(Math.abs(v.width - 1190.55) < 1 && Math.abs(v.height - 841.89) < 1, `A3 landscape in points, got ${v.width} x ${v.height}`);
  await pdf.destroy();
});

test('UI, no back end: the Plan Pack stays "coming soon" and health is asked once', { skip: skipUi }, () => {
  const r = browser('?state=soon', String.raw`
    await sleep(300);
    out.topbar = text($('#tp-topbar .psp-bar-slot .psp-btn'));
    out.paths = T.requests.map((x) => x.path);
    out.enabled = T.premium.state.entitled;
  `);
  assert.equal(r.topbar, 'Plan Pack coming soon');
  assert.deepEqual(r.paths, ['/health']);
});

test('UI, back end present: a healthy /api/health turns checkout on for the session', { skip: skipUi }, () => {
  const r = browser('?state=probe', String.raw`
    await T.premium.ready;
    await sleep(100);
    out.topbar = text($('#tp-topbar .psp-bar-slot .psp-btn'));
    out.topbarDisabled = $('#tp-topbar .psp-bar-slot .psp-btn').disabled;
    out.aiButton = text($('.psp-locked-box .psp-btn'));
    T.premium.openUpgrade();
    await sleep(100);
    out.checkoutEnabled = !button($('.psp-modal'), 'Continue to secure checkout').disabled;
    out.paths = T.requests.map((x) => x.path);
  `);
  assert.equal(r.topbar, 'Unlock plans, A$30');
  assert.equal(r.topbarDisabled, false);
  assert.match(r.aiButton, /Unlock plans/);
  assert.equal(r.checkoutEnabled, true);
  assert.deepEqual(r.paths, ['/health']);
});

test('UI, development grant: on localhost with the dev flag the test entitlement is fetched and stored', { skip: skipUi }, () => {
  const r = browser('?state=devgrant', String.raw`
    await T.premium.ready;
    await sleep(100);
    out.entitled = T.premium.isEntitled();
    out.hasToken = !!T.premium.state.token;
    out.chip = text($('.psp-chip'));
    out.credits = T.premium.state.credits && T.premium.state.credits.remaining;
    out.paths = T.requests.map((x) => x.path);
    out.stored = !!localStorage.getItem('ps.ent.' + S.project.id);
  `);
  assert.equal(r.hasToken, true);
  assert.equal(r.stored, true);
  assert.match(r.chip, /Plan Pack/);
  assert.equal(r.credits, 312);
  assert.ok(r.paths.includes('/entitlement'));
});

test('UI, PDF import: the locked state opens the upgrade modal, the unlocked state renders a real PDF page as the underlay', { skip: skipUi }, () => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFontSize(30);
  doc.text('Plan page one', 20, 40);
  doc.addPage('a3', 'landscape');
  doc.rect(20, 20, 200, 100);
  doc.text('Plan page two', 30, 60);
  const b64 = Buffer.from(doc.output('arraybuffer')).toString('base64');
  const run = (state) => browser(`?state=${state}`, String.raw`
    const pdfBytes = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0));
    const file = new File([pdfBytes], 'plan.pdf', { type: 'application/pdf' });
    const { importPdf } = await import('../../src/premium/pdf-import.js');
    const ps = { store: S, premium: T.premium };
    const running = importPdf(ps, { pickFile: async () => file, setUnderlay: undefined, layer: undefined, isEntitled: () => T.premium.isEntitled(), openUpgrade: () => T.premium.openUpgrade() });
    out.modalAfterStart = await until(() => $('.psp-modal'), 4000) ? text($('.psp-modal h2')) : null;
    if (out.modalAfterStart === 'Choose a page') {
      out.thumbs = await until(() => $$('.psp-pdf-thumb canvas').length === 2 && $$('.psp-pdf-thumb canvas').length, 6000);
      out.pageLabels = $$('.psp-pdf-grid [role=option]').map((b) => b.getAttribute('aria-label'));
      $$('.psp-pdf-grid [role=option]')[1].click();
    }
    const result = await Promise.race([running, sleep(15000).then(() => ({ status: 'timeout' }))]);
    out.result = { status: result.status, page: result.page, pages: result.pages, width: result.width, height: result.height, dpi: result.dpi };
    const u = S.project.site.underlay;
    out.underlay = u ? { key: u.key, mmPerPx: u.mmPerPx } : null;
    out.undoLabel = S.undoLabel();
  `);
  const locked = run('locked');
  assert.equal(locked.modalAfterStart, 'Unlock the Plan Pack');
  assert.equal(locked.result.status, 'locked');
  assert.equal(locked.underlay, null);
  const dev = run('dev');
  assert.equal(dev.modalAfterStart, 'Choose a page');
  assert.deepEqual(dev.pageLabels, ['Page 1', 'Page 2']);
  assert.equal(dev.result.status, 'ok', JSON.stringify(dev));
  assert.equal(dev.result.page, 2);
  assert.equal(dev.result.pages, 2);
  assert.equal(dev.result.dpi, 200);
  assert.ok(Math.abs(dev.result.width - (1190.55 * 200) / 72) < 3, `A3 landscape at 200 dpi, got ${dev.result.width}`);
  assert.ok(dev.underlay && dev.underlay.mmPerPx > 0);
  assert.equal(dev.undoLabel, 'Set underlay');
});

// 9. PDF preview in Exports (free and paid) -------------------------------------------------------------------------------------
test('PDF preview: module never exposes bytes, builds canvases with a baked watermark in free mode, and stays out of the static graph', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/premium/pdf-preview.js'), 'utf8');
  assert.doesNotMatch(src, /createObjectURL|toDataURL|toBlob|\.download\b|new Blob/);
  assert.match(src, /PREVIEW, Plan Pack required to download/);
  assert.match(src, /Unlock to download, A\$/);
  assert.doesNotMatch(src, /\balert\(|\bconfirm\(|\bprompt\(/);
  assert.doesNotMatch(src, /[–—]/);
  const premium = fs.readFileSync(path.join(ROOT, 'src/premium/premium.js'), 'utf8');
  assert.match(premium, /previewPdf/);
  assert.match(src, /await import\('\.\/exporters\/pdf\.js'\)/);
});

test('PDF preview: DXF, GLB and OBJ stay paid only for a free user', async () => {
  const store = sampleStore();
  for (const type of ['dxf', 'glb', 'obj']) {
    await assert.rejects(runExport(type, store.project, { api: {}, token: null, devUnlock: false, save: () => assert.fail('must not save') }), (e) => e.code === 'NOT_ENTITLED');
  }
});

test('PDF preview: previewScale is about 70 dpi', async () => {
  const { previewScale, PREVIEW_DPI } = await import('../src/premium/pdf-preview.js');
  assert.equal(PREVIEW_DPI, 70);
  assert.ok(Math.abs(previewScale() - 70 / 72) < 1e-9);
});

test('9. plan sheets: furniture uses the catalogue draw2d symbols, labels clear furniture and dimensions', async () => {
  const { furnitureStrokes, createRecorder, placeLabel, placeBeside } = await import('../src/premium/exporters/symbols.js');
  const bed = catalogue.FURNITURE.find((f) => /bed/i.test(f.id) && typeof f.draw2d === 'function');
  const ops = furnitureStrokes(catalogue, { item: bed.id, x: 1000, y: 2000, rotation: 90 });
  const strokes = ops.filter((o) => o.op === 'stroke');
  assert.ok(strokes.length > 3, 'a symbol is more than its outline box');
  const pts = strokes.flatMap((o) => o.paths.flatMap((p) => p.pts));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  // Rotated 90 degrees: the item depth runs along x and the width along y.
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - bed.d) < 5 && Math.abs(Math.max(...ys) - Math.min(...ys) - bed.w) < 5);
  assert.equal(furnitureStrokes(catalogue, { item: 'no_such_item', x: 0, y: 0 }).length, 2, 'outline box fallback');
  const { ctx, ops: rec } = createRecorder();
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.stroke();
  assert.ok(rec[0].paths[0].pts.length > 30);

  const poly = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];
  const sofa = { x0: 12, y0: 10, x1: 28, y1: 20 };
  const at = placeLabel({ poly, w: 10, h: 6, obstacles: [sofa], prefer: { x: 20, y: 15 } });
  assert.equal(at.overlap, 0, 'label moved off the furniture');
  const dim = { x0: -20, y0: 49, x1: 20, y1: 51 };
  const t = placeBeside({ c: { x: 0, y: 50 }, r: 3, w: 12, h: 3, obstacles: [dim] });
  assert.ok(t.y + 1.5 < 49 || t.y - 1.5 > 51, 'tank label off the dimension line');

  // The PDF draws many more segments with symbols than four sides per item.
  const calls = { lines: 0 };
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const lines = this.lines.bind(this);
      this.lines = (...r) => (calls.lines++, lines(...r));
    }
  }
  const store = sampleStore('p_symbols');
  const items = store.project.levels.reduce((n, l) => n + l.furniture.length, 0);
  toPDF(store.project, { jsPDF: Rec, catalogue });
  assert.ok(items === 0 || calls.lines > items * 6);
});
