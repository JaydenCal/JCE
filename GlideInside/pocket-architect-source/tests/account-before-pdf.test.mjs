// Account before PDF: the terms gate asks for a free profile first, then the terms; entitled and builder logins are not asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTermsGate, createAcceptanceMemory } from '../src/legal/terms-gate.js';

const mem = () => createAcceptanceMemory({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
const mkGate = (over = {}) => {
  const log = [];
  const gate = createTermsGate({ memory: mem(), openDialog: async ({ onConfirm }) => { log.push('terms'); await onConfirm(); return true; }, ...over });
  return { gate, log };
};

test('no profile: the account dialog comes first, then the terms, then the caller gets the acceptance', async () => {
  let signedIn = false;
  const { gate, log } = mkGate();
  gate.configure({ accountMissing: () => !signedIn, ensureAccount: async () => { log.push('account'); signedIn = true; return true; } });
  const r = await gate.require({ context: 'lot-card-site-pdf' });
  assert.deepEqual(log, ['account', 'terms']);
  assert.ok(r?.version);
});

test('closing the account dialog stops the PDF before the terms are shown', async () => {
  const { gate, log } = mkGate();
  gate.configure({ accountMissing: () => true, ensureAccount: async () => { log.push('account'); return false; } });
  assert.equal(await gate.require({ context: 'pdf-preview' }), null);
  assert.deepEqual(log, ['account']);
});

test('signed in, builder or trial logins are not asked again', async () => {
  const { gate, log } = mkGate();
  gate.configure({ accountMissing: () => false, ensureAccount: async () => { log.push('account'); return true; } });
  await gate.require({ context: 'export-pdf' });
  assert.deepEqual(log, ['terms']);
});

test('terms already accepted still need the account first (the free preview path)', async () => {
  let signedIn = false;
  const { gate, log } = mkGate();
  await gate.require({ context: 'x' }); // accepted and remembered
  log.length = 0;
  gate.configure({ accountMissing: () => !signedIn, ensureAccount: async () => { log.push('account'); signedIn = true; return true; } });
  assert.equal(gate.needsAccount(), true);
  await gate.require({ context: 'pdf-preview' });
  assert.deepEqual(log, ['account']);
});

test('no profile service on the page: nothing extra is asked', async () => {
  const { gate, log } = mkGate();
  assert.equal(gate.needsAccount(), false);
  await gate.require({ context: 'x' });
  assert.deepEqual(log, ['terms']);
});

test('once a profile was made the account dialog never comes back (this session, and this device through the memory)', async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const log = [];
  const mk = () => createTermsGate({ memory: createAcceptanceMemory({ storage }), openDialog: async ({ onConfirm }) => { log.push('terms'); await onConfirm(); return true; }, accountMissing: () => true, ensureAccount: async () => { log.push('account'); return true; } });
  const gate = mk();
  await gate.require({ context: 'a' });
  await gate.require({ context: 'b' });
  await gate.require({ context: 'c' });
  assert.deepEqual(log, ['account', 'terms'], 'one account dialog, one terms dialog, then straight through');
  const later = mk(); // a new page on the same device
  assert.equal(later.needsAccount(), false);
  later.noteAccount(false); // signed out
  assert.equal(later.needsAccount(), true);
});
