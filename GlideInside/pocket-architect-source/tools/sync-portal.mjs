// Copies the portal screens and the few shared modules they import into website-live/portal/src/, so the static site serves
// the dashboard without the rest of the app. Run after changing anything under src/portal/:  node tools/sync-portal.mjs
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const out = resolve(root, '../website-live/portal/src');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = ['src/portal', 'src/config.js', 'src/ui/dom.js', 'src/ui/design-file.js', 'src/model/schema.js', 'src/premium/api.js'];
for (const f of files) cpSync(resolve(root, f), resolve(out, f.replace(/^src\//, '')), { recursive: true, filter: (s) => !/client-mode|placement|app-strip/.test(s) });
console.log(`Synced ${files.length} entries to ${out}`);
