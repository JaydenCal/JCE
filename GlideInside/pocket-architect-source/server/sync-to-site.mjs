// Copies the Plan Studio server and the shared modules it needs into the Next.js site (frontend/src/lib/plan-studio-server).
//
//   node server/sync-to-site.mjs [path/to/frontend]
//
// Server files (server/lib/*.js) land in plan-studio-server/ and everything they import from src/ lands in
// plan-studio-server/shared/ (same layout as src/). Copies are .ts files starting with `// @ts-nocheck` because the
// site compiles TypeScript with allowJs off; relative imports lose their .js extension so the Next build resolves them.
// The hand-written site files (runtime.ts, jspdf.ts) are never touched. Run it again after any change to the originals.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SITE = path.resolve(ROOT, '../site-in/cadastral-platform/frontend');
const siteDir = path.resolve(process.argv[2] || DEFAULT_SITE);
const OUT = path.join(siteDir, 'src/lib/plan-studio-server');

const SERVER_FILES = ['app', 'config', 'http', 'entitlement', 'stripe', 'credits', 'anthropic', 'store', 'store-file', 'store-upstash'];
const EXTRA_SHARED = ['src/premium/exporters/index.js', 'src/catalogue/index.js'];
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) out.push(path.resolve(path.dirname(file), m[3]));
  return out;
}

// Shared closure: every file under src/ reachable from the server files and the extra entries.
const shared = new Set();
const queue = [...EXTRA_SHARED.map((f) => path.join(ROOT, f)), ...SERVER_FILES.flatMap((n) => importsOf(path.join(ROOT, 'server/lib', `${n}.js`)))];
while (queue.length) {
  const f = queue.pop();
  if (!f.startsWith(path.join(ROOT, 'src') + path.sep) || shared.has(f)) continue;
  if (!fs.existsSync(f)) throw new Error(`Missing import target ${rel(f)}`);
  shared.add(f);
  queue.push(...importsOf(f));
}

function convert(file, isServer) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(IMPORT_RE, (all, lead, q, spec) => {
    let next = spec;
    if (isServer && spec.startsWith('../../src/')) next = `./shared/${spec.slice('../../src/'.length)}`;
    return `${lead}${q}${next.replace(/\.js$/, '')}${q}`;
  });
  return `// @ts-nocheck\n// Generated copy of ${rel(file)} by server/sync-to-site.mjs. Edit the original in the Plan Studio repository.\n${text}`;
}

fs.rmSync(path.join(OUT, 'shared'), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const n of SERVER_FILES) fs.writeFileSync(path.join(OUT, `${n}.ts`), convert(path.join(ROOT, 'server/lib', `${n}.js`), true));
for (const f of [...shared].sort()) {
  const dest = path.join(OUT, 'shared', path.relative(path.join(ROOT, 'src'), f)).replace(/\.js$/, '.ts');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, convert(f, false));
}
console.log(`Copied ${SERVER_FILES.length} server files and ${shared.size} shared modules to ${OUT}`);
