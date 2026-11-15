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
