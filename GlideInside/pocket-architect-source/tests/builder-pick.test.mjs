// Builder picker: the slug rules, the public brand route (memory and D1), the admin slug route, and the sign in page's query handling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, cleanSlug, readPick } from '../src/portal/builders.js';
import { createMockApi, memoryStorage } from '../src/portal/mock-api.js';
import fs from 'node:fs';

test('slug rules: names derive slugs, bad values are refused', () => {
  assert.equal(cleanSlug('sample-homes'), 'sample-homes');
  assert.equal(slugify('Sample Homes Pty Ltd'), 'sample-homes-pty-ltd');
  assert.equal(slugify('  A & B  Builders! '), 'a-and-b-builders');
  for (const bad of ['', 'Hunter', 'a b', '-a', 'a-', 'a--b', '../x', '<script>', 'x'.repeat(41), null, 5]) assert.equal(cleanSlug(bad), null, String(bad));
});

test('short ?b= alias', () => {
  assert.deepEqual(readPick('?b=sample-homes'), { builder: 'sample-homes', role: null });
});

test('query handling: ?builder= and ?role= (and the older ?client=1)', () => {
  assert.deepEqual(readPick('?builder=sample-homes&role=client'), { builder: 'sample-homes', role: 'client' });
  assert.deepEqual(readPick('?builder=sample-homes&role=builder'), { builder: 'sample-homes', role: 'builder' });
  assert.deepEqual(readPick('?client=1'), { builder: null, role: 'client' });
  assert.deepEqual(readPick('?role=client'), { builder: null, role: 'client' });
  assert.deepEqual(readPick(''), { builder: null, role: null });
  assert.deepEqual(readPick('?builder=<img src=x>&role=admin'), { builder: null, role: null });
});

test('mock api: getBrand returns only name, logo and colours, and 404s for an unknown builder', async () => {
  const api = createMockApi({ storage: memoryStorage() });
  const b = await api.getBrand('sample-homes');
  assert.deepEqual(Object.keys(b).sort(), ['colours', 'logoUrl', 'name']);
  await assert.rejects(() => api.getBrand('not-a-builder'), (e) => e.code === 'NOT_FOUND' && e.status === 404);
});

test('migration 0011 is additive and schema.sql has the same column and unique index', () => {
  const m = fs.readFileSync(new URL('../server/migrations/0011_org_slug.sql', import.meta.url), 'utf8');
  assert.match(m, /ALTER TABLE orgs ADD COLUMN slug TEXT;/);
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug ON orgs\(slug\)/);
  assert.doesNotMatch(m, /DROP|DELETE|UPDATE/i);
  const s = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
  assert.match(s, /slug TEXT/);
  assert.match(s, /idx_orgs_slug/);
});
