// Builds the STAGING copy of the website into ../website-live-staging (generated, gitignored; deploy-staging.ps1 runs this).
//   node staging/build-staging-site.mjs
// From website-live: the rebuilt single file app (production flags), per council setbacks data, a visible STAGING banner on every
// page, noindex everywhere, robots.txt disallow all, no analytics, no sitemap. Never touches website-live itself except the portal
// source sync that the repo already commits.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // GlideInside
const src = resolve(root, 'pocket-architect-source');
const live = resolve(root, 'website-live');
const out = resolve(root, 'website-live-staging');
const node = process.execPath;
const run = (args, cwd = src) => execFileSync(node, args, { cwd, stdio: 'inherit' });

// 1. The app must be a production build: no mocks, no review build, same-origin API.
const cfgSrc = readFileSync(resolve(src, 'src/config.js'), 'utf8');
for (const [re, what] of [[/const REVIEW_BUILD = false;/, 'REVIEW_BUILD false'], [/siteMock: false/, 'siteMock false'], [/aiMock: false/, 'aiMock false'], [/apiBase: '\/api'/, "apiBase '/api'"]]) {
  if (!re.test(cfgSrc)) throw new Error(`src/config.js is not a production config: expected ${what}`);
}

// 2. Fresh copy of the site without the review pages.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
run(['tools/sync-portal.mjs']); // website-live/portal/src from the current source (already committed that way)
cpSync(live, out, { recursive: true, filter: (p) => !/[\\/]_review([\\/]|$)/.test(p) && !/[\\/]\.DS_Store$/.test(p) });
rmSync(join(out, 'sitemap.xml'), { force: true });

// 3. The app: one file, product name "Pocket Architect".
run(['tools/build-single.mjs', '--brand', 'Pocket Architect', '--out', join(out, 'plan-studio/app/index.html')]);

// 4. Setback rules split per council, from setbacks-data (falls back to the committed split when the source data is absent).
if (existsSync(resolve(root, 'setbacks-data/setback-rules.json'))) run(['tools/split-setbacks.mjs', '--out', join(out, 'plan-studio/data/setbacks')]);
if (!existsSync(join(out, 'plan-studio/data/setbacks'))) throw new Error('No setbacks data in the staging site.');

// 5. Site config: production flags, portal live, staging flag, no analytics.
let cfg = readFileSync(join(out, 'site.config.js'), 'utf8');
const set = (key, val) => {
  const re = new RegExp(`(\\b${key}:\\s*)([^,\\n]*)(,?)`);
  if (!re.test(cfg)) throw new Error(`site.config.js has no ${key}`);
  cfg = cfg.replace(re, `$1${val}$3`);
};
set('portalLive', 'true'); set('portalEnabled', 'true'); set('portalMock', 'false'); set('premiumEnabled', 'true');
set('ga4Id', '""'); set('adsConversion', '""');
cfg = cfg.replace('window.GI_CONFIG = {', 'window.GI_CONFIG = {\n  staging: true,                  // STAGING build: the app asks the staging server for a free test Plan Pack\n  siteMock: false, aiMock: false,');
writeFileSync(join(out, 'site.config.js'), cfg);

// 6. Banner and noindex on every page.
let commit = '';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim(); } catch {}
const stamp = `${commit ? `build ${commit}, ` : ''}${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const banner = `<div id="staging-banner" role="note" style="position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;background:#b42318;color:#fff;font:600 12px/1 system-ui,Segoe UI,Arial,sans-serif;padding:5px 14px;border-radius:0 0 8px 8px;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.35);letter-spacing:.02em">STAGING, not the live site <span style="font-weight:400;opacity:.85">(${stamp})</span></div>`;
const NOINDEX = '<meta name="robots" content="noindex, nofollow">';
let pages = 0;
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.html?$/i.test(n)) continue;
    let h = readFileSync(p, 'utf8');
    h = h.replace(/<meta\s+name=["']robots["'][^>]*>/gi, '').replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '');
    if (/<head[^>]*>/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => `${m}${NOINDEX}`);
    else h = NOINDEX + h;
    if (/<body[^>]*>/i.test(h)) h = h.replace(/<body[^>]*>/i, (m) => `${m}${banner}`);
    else h = banner + h;
    writeFileSync(p, h);
    pages += 1;
  }
})(out);

writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
writeFileSync(join(out, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-cache\n');
writeFileSync(join(out, 'staging-info.json'), JSON.stringify({ staging: true, builtAt: new Date().toISOString(), commit }, null, 2));
console.log(`Staging site: ${out} (${pages} pages with the STAGING banner and noindex)`);
