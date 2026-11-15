// Step 1: a clear loading state (spinner, message, slow message after 8 seconds, previous lot dimmed) and the lot aerial under the boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/flow/lot-step.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/flow/css.js', import.meta.url), 'utf8');

test('loading text, slow text after 8 seconds, spinner and dimmed previous lot', () => {
  assert.match(src, /Finding your lot\. This can take a little while for some addresses\./);
  assert.match(src, /Still looking\. Council and state map services can be slow\./);
  assert.match(src, /8000/);
  assert.match(src, /gf-spin/);
  assert.match(src, /classList\.toggle\('gf-dim', loading\)/);
  assert.match(css, /\.gf-dim\{opacity/);
});
test('reduced motion stops the spinner animation and no dashes in the new text', () => {
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.gf-spin\{animation:none/);
  for (const t of src.match(/'(Finding your lot[^']*|Still looking[^']*)'/g)) assert.ok(!/[–—]/.test(t));
});
test('step 1 fetches the lot aerial the same way as steps 3 and 4', () => {
  assert.match(src, /ensureFlowAerial\(store\)/);
  assert.match(src, /aerialOf\(/);
});
