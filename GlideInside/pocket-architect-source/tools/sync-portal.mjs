// Copies the portal screens and the few shared modules they import into website-live/portal/src/, so the static site serves
// the dashboard without the rest of the app. Run after changing anything under src/portal/:  node tools/sync-portal.mjs
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const out = resolve(root, '../website-live/portal/src');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = ['src/portal', 'src/config.js', 'src/ui/dom.js', 'src/ui/design-file.js', 'src/model/schema.js', 'src/commercial/schema.js', 'src/premium/api.js'];
for (const f of files) cpSync(resolve(root, f), resolve(out, f.replace(/^src\//, '')), { recursive: true, filter: (s) => !/client-mode|placement|app-strip/.test(s) });
// Cache busting: every relative import in the synced copy carries the same ?v= token, so a browser never mixes a fresh module
// with a stale cached one (18/11/2026: billing-tab.js failed on a cached billing.js). Bump PORTAL_V on every portal release and
// keep the portal/index.html and portal/admin/index.html entry imports on the same token.
export const PORTAL_V = '20261119b';
const walk = (d) => readdirSync(d).flatMap((n) => { const f = resolve(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
let n = 0;
for (const f of walk(out).filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(f, 'utf8');
  const next = src.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)(\?v=[^'"]*)?\2/g, (m, pre, q, spec) => { n++; return `${pre}${q}${spec}?v=${PORTAL_V}${q}`; });
  if (next !== src) writeFileSync(f, next);
}
for (const html of ['../website-live/portal/index.html', '../website-live/portal/admin/index.html']) {
  const fp = resolve(root, html);
  const t = readFileSync(fp, 'utf8');
  const u = t.replace(/(\.\/src\/portal\/[^'"?]+\.js)(\?v=[^'"]*)?(['"])/g, `$1?v=${PORTAL_V}$3`);
  if (u !== t) writeFileSync(fp, u);
}
console.log(`Synced ${files.length} entries to ${out}, ${n} imports versioned ${PORTAL_V}`);
