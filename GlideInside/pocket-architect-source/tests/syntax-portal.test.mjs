// Parses every portal and site script so a missing bracket can never ship again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { transformSync } from 'esbuild';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const live = resolve(root, '../website-live');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js)$/.test(n)) out.push(p);
  }
  return out;
}

const files = [
  ...walk(resolve(root, 'src/portal')),
  ...walk(resolve(live, 'portal')),
  ...readdirSync(live).filter((n) => /\.js$/.test(n)).map((n) => join(live, n)),
];

test('portal and site scripts exist to check', () => assert.ok(files.length > 20));

for (const f of files) {
  test(`parses ${f.replace(resolve(root, '..') + '/', '')}`, () => {
    const code = readFileSync(f, 'utf8');
    try { transformSync(code, { loader: 'js', format: 'esm', logLevel: 'silent' }); }
    catch (e) { assert.fail(`Syntax error: ${e.errors?.[0]?.text} at ${e.errors?.[0]?.location?.line}:${e.errors?.[0]?.location?.column}`); }
  });
}
