import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('homeowner Check it step shows no developer feasibility (profit, margin, debt); the commercial flow keeps it', () => {
  const res = readFileSync(new URL('../src/flow/residential.js', import.meta.url), 'utf8');
  assert.ok(!/createFinance/.test(res), 'residential flow does not mount the finance panel');
  const com = readFileSync(new URL('../src/flow/commercial.js', import.meta.url), 'utf8');
  assert.ok(/createFinance/.test(com), 'commercial flow keeps it');
});

test('tutorial coach keeps clear of the guided flow footer buttons', () => {
  const c = readFileSync(new URL('../src/tutorial/coach.js', import.meta.url), 'utf8');
  assert.match(c, /const AVOID_FLOW = '[^']*\.gf-foot/);
});
