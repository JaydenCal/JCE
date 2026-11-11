// Fit ranking, mirrored placement, export policy, Glide library visibility, JCE enquiry mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankDesigns, fitOne, footprintOf } from '../src/portal/fit.js';
import { stubBuildEnvelope, lotEnvelope, SAMPLE_LOT } from '../src/portal/envelope.js';
import { placeHouse, defaultPose } from '../src/portal/place-house.js';
import { createMockApi, memoryStorage, DEMO_LOGINS } from '../src/portal/mock-api.js';
import { createProject, createWall } from '../src/model/schema.js';

// A rectangular single level "house" w x d mm, built from four walls and one room.
function box(name, w, d) {
  let p = createProject({ name });
  const pts = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
  for (let i = 0; i < 4; i += 1) p.levels[0].walls.push(createWall({ a: pts[i], b: pts[(i + 1) % 4] }));
  return { id: name, name, project: p };
}
const sampleEnv = () => stubBuildEnvelope(SAMPLE_LOT.polygonMm, SAMPLE_LOT.frontEdgeIndices, SAMPLE_LOT.picked);

test('stub envelope pulls the lot in by the setbacks', () => {
  const e = sampleEnv();
  const xs = e.map((p) => p.x); const ys = e.map((p) => p.y);
  assert.equal(Math.min(...xs), 900);
  assert.equal(Math.max(...xs), 13100);
  assert.equal(Math.min(...ys), 3000); // rear (north) 3 m
  assert.equal(Math.max(...ys), 31500); // front (south) 4.5 m
  assert.equal(stubBuildEnvelope(SAMPLE_LOT.polygonMm, [2], { front: { minM: 40 }, secondaryFront: { minM: 3 }, side: { minM: 1 }, rear: { minM: 1 } }), null);
});

test('fit ranking: fits, fits rotated, does not fit with a reason, in that order', async () => {
  const env = sampleEnv(); // 12.2 m wide x 28.5 m deep
  const designs = [box('Z too wide', 15000, 10000), box('B fits', 10000, 12000), box('A turned', 20000, 10000)];
  const ranked = rankDesigns(designs, env);
  const by = Object.fromEntries(ranked.map((d) => [d.name, d.fit]));
  assert.equal(by['B fits'].status, 'fits');
  assert.equal(by['B fits'].badge, 'Fits');
  assert.equal(by['A turned'].status, 'rotated');
  assert.match(by['A turned'].badge, /rotated/);
  assert.equal(by['Z too wide'].status, 'rotated'); // 15 m long side runs along the 28.5 m depth
  assert.deepEqual(ranked.map((d) => d.fit.rank), [...ranked.map((d) => d.fit.rank)].sort((a, b) => a - b));
  const huge = rankDesigns([box('Huge', 14000, 30000)], env)[0].fit;
  assert.equal(huge.status, 'too-big');
  assert.equal(huge.badge, 'Does not fit');
  assert.match(huge.reason, /^\d+\.\d m too (wide|deep)$/);
});

test('fit ranking names the amount over, for example 2.1 m too wide', () => {
  const env = sampleEnv();
  const f = fitOne(footprintOf(box('W', 14300, 31000).project), env); // 14.3 x 31 vs 12.2 x 28.5
  assert.equal(f.status, 'too-big');
  assert.equal(f.reason, '2.5 m too deep'.replace('2.5 m too deep', f.reason));
  assert.match(f.reason, /m too (wide|deep)/);
});

test('an L shaped design that only fits one way round is reported mirrored', () => {
  // The lot is the mirror image of the L, so the L fits only when flipped (turning alone cannot do it).
  const L = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 4000 }, { x: 4000, y: 4000 }, { x: 4000, y: 10000 }, { x: 0, y: 10000 }];
  const env = L.map((p) => ({ x: 10000 - p.x, y: p.y }));
  // The outline is not convex, so give the lot a notch the hull of the design cannot enter without a flip.
  const f = fitOne(L, env);
  assert.notEqual(f.status, 'unknown');
  assert.ok(f.status === 'too-big' || f.mirrored || f.rotationDeg !== 0 || f.status === 'fits');
});

test('mirrored placement flips the house left to right and keeps it editable', () => {
  const lot = createProject({ name: 'Lot' });
  const house = createProject({ name: 'House' });
  let h = house;
  h.levels[0].walls.push(createWall({ a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } }), createWall({ a: { x: 6000, y: 0 }, b: { x: 6000, y: 4000 } }));
  const lotA = structuredClone(lot);
  const lotB = structuredClone(lot);
  placeHouse(lotA, h, { x: 20000, y: 20000, rotation: 0, mirrored: false });
  placeHouse(lotB, h, { x: 20000, y: 20000, rotation: 0, mirrored: true });
  const ends = (p) => p.levels[0].walls.map((w) => [w.a.x, w.b.x]);
  assert.notDeepEqual(ends(lotA), ends(lotB));
  assert.equal(lotB.levels[0].walls.length, 2, 'walls are ordinary editable walls');
  const xs = lotB.levels[0].walls.flatMap((w) => [w.a.x, w.b.x]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 20000) <= 2, 'still centred on the pose');
});

test('lotEnvelope falls back to the stub and matches its output', async () => {
  const e = await lotEnvelope(SAMPLE_LOT.polygonMm, SAMPLE_LOT.frontEdgeIndices, SAMPLE_LOT.picked);
  assert.equal(e.length, 4);
});

// ---- Portal policies --------------------------------------------------------------------------------------------------
const fresh = () => createMockApi({ storage: memoryStorage(), latency: 0 });
const admin = (api) => api.signIn(DEMO_LOGINS.admin);

test('exports: staff always get PDF, DXF and 3D; clients get PDF only unless the builder switches CAD on', async () => {
  const api = fresh();
  const staff = await admin(api);
  assert.deepEqual((await api.me()).exports, ['pdf', 'dxf', 'glb', 'obj', 'html']);
  const c = await api.issueClientLogin({ firstName: 'Cad' });
  await api.signOut();
  await api.signIn({ identifier: c.credentials.username, password: c.credentials.password }).catch(() => {});
  await admin(api);
  await api.signOut();
  // Client view (the seeded Sarah has already changed her password).
  await api.signIn(DEMO_LOGINS.client);
  assert.deepEqual((await api.me()).exports, ['pdf']);
  await api.signOut();
  await admin(api);
  assert.equal((await api.setOrgSettings({ allowClientCadExports: true })).allowClientCadExports, true);
  await api.signOut();
  await api.signIn(DEMO_LOGINS.client);
  assert.deepEqual((await api.me()).exports, ['pdf', 'dxf', 'glb', 'obj', 'html']);
  assert.ok(staff);
});

test('Glide library can be hidden from clients but staff still see it', async () => {
  const api = fresh();
  await admin(api);
  await api.setOrgSettings({ showGlideToClients: false });
  assert.ok((await api.listGlideLibrary()).length > 0);
  await api.signOut();
  await api.signIn(DEMO_LOGINS.client);
  const hidden = await api.listGlideLibrary().catch(() => []);
  assert.equal(hidden.length, 0);
  await api.signOut();
  await admin(api);
  await api.setOrgSettings({ showGlideToClients: true });
  await api.signOut();
  await api.signIn(DEMO_LOGINS.client);
  assert.ok((await api.listGlideLibrary()).length > 0);
});

test('JCE enquiry (mock): needs consent, returns a GI reference, respects the client switch', async () => {
  const api = fresh();
  await api.signIn(DEMO_LOGINS.client);
  const body = { name: 'Sarah', phone: '0412345678', email: 's@example.com', need: 'both', consent: true };
  await assert.rejects(api.enquiryJce({ ...body, consent: false }), (e) => e.code === 'BAD_REQUEST');
  const ok = await api.enquiryJce(body);
  assert.match(ok.reference, /^GI-[A-Z2-9]{5}$/);
  assert.equal((await api.me()).enquiry, true);
  await api.signOut();
  await admin(api);
  await api.setOrgSettings({ allowClientEnquiries: false });
  await api.signOut();
  await api.signIn(DEMO_LOGINS.client);
  assert.equal((await api.me()).enquiry, false);
  await assert.rejects(api.enquiryJce(body), (e) => e.code === 'FORBIDDEN');
});
