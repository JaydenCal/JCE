// Builds the interactive HTML export (server side path: Node, no DOM) for a project JSON and shoots its 3D tab.
//   node tools/parity-export.mjs project.json out.png [view]   (view: default | aerial)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { catalogue } from '../src/catalogue/index.js';
import { migrate } from '../src/model/schema.js';
import { buildExport } from '../src/premium/exporters/index.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const [, , file, out] = process.argv;
const project = migrate(JSON.parse(readFileSync(resolve(file), 'utf8')));
const config = { disclaimer: 'Concept design only.', seller: { name: 'JCE Infrastructure Pty Ltd trading as Glide Inside', abn: '29 699 165 663' } };
const res = await buildExport('html', project, { catalogue, config, date: new Date('2026-11-18T00:00:00Z') });
const html = new TextDecoder().decode(res.bytes);
if (/https?:\/\//.test(html)) throw new Error('The export holds a web address');
const f = out.replace(/\.png$/, '.html');
writeFileSync(f, html);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`file://${f}#3d`);
await page.waitForTimeout(12000);
await page.locator('#pa-view').screenshot({ path: out, timeout: 240000 });
console.log('shot', out, Math.round(html.length / 1024) + ' KB');
await browser.close();
