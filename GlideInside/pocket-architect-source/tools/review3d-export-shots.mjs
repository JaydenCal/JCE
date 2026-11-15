// Before and after pictures of the 3D view of the interactive HTML export (the single offline file), for the 3D review.
//   node tools/review3d-export-shots.mjs [outDir] [git ref of the "before" viewer]
// Builds the export of the single storey starter house with the current viewer (after) and with the viewer of the given commit (before).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { catalogue } from '../src/catalogue/index.js';
import { migrate } from '../src/model/schema.js';
import { buildExport } from '../src/premium/exporters/index.js';
import { VIEWER_JS } from '../src/premium/exporters/html-viewer.generated.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = resolve(process.argv[2] || '/home/claude/fable-3d-review');
const REF = process.argv[3] || 'HEAD~1';
mkdirSync(OUT, { recursive: true });
const config = { disclaimer: 'Concept design only.', seller: { name: 'JCE Infrastructure Pty Ltd trading as Glide Inside', abn: '29 699 165 663' } };
const project = migrate(catalogue.createFromTemplate('house_single'));
const file = await buildExport('html', project, { catalogue, config, date: new Date('2026-11-15T00:00:00Z') });
const after = new TextDecoder().decode(file.bytes);
if (/https?:\/\//.test(after)) throw new Error('The export holds a web address');
const oldSrc = execFileSync('git', ['show', `${REF}:GlideInside/pocket-architect-source/src/premium/exporters/html-viewer.generated.js`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
const oldJs = JSON.parse(oldSrc.slice(oldSrc.indexOf('export const VIEWER_JS = ') + 25).trim().replace(/;$/, ''));
const before = after.split(VIEWER_JS).join(oldJs);
if (before === after) throw new Error('The viewer script was not found in the export');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
for (const [name, html] of [['before', before], ['after', after]]) {
  const f = resolve(OUT, `export-${name}.html`);
  writeFileSync(f, html);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`file://${f}#3d`);
  await page.waitForTimeout(9000);
  await page.locator('#pa-view').screenshot({ path: resolve(OUT, `${name}-export-3d.png`), timeout: 240000 });
  console.log('shot', `${name}-export-3d`);
  await page.close();
}
await browser.close();
