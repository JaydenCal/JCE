import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const app = readFileSync(resolve(root, '../website-live/plan-studio/app/index.html'), 'utf8');

test('built app has no HTML comment opener inside inline scripts', () => {
  const scripts = [...app.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 3);
  for (const s of scripts) assert.ok(!s.includes('<!--'), 'inline script contains <!--');
});

test('built app boots in Chromium (smoke-boot)', (t) => {
  const r = spawnSync(process.execPath, [resolve(root, 'tools/smoke-boot.mjs')], { encoding: 'utf8', timeout: 60000 });
  if (/Cannot find module|Executable doesn't exist/.test(r.stderr || '')) return t.skip('playwright or Chromium not available');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
