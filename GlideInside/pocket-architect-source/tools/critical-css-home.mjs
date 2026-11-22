// Builds the inline critical CSS block for website-live/index.html (rules that style anything in the first screens)
// and writes it between the CRITICAL-CSS markers in index.html. framework.css then loads without blocking the first paint.
// Run again whenever framework.css changes: node tools/critical-css-home.mjs   (needs Playwright, e.g. /opt/npm-tools)
// It serves website-live itself on a local port; no network needed.
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(process.env.PW_DIR || '/opt/npm-tools/'); const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../website-live');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); let p = path.join(root, u); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html'); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
await new Promise(r => srv.listen(0, r)); const port = srv.address().port;
// Always measure against the full stylesheet: take the page source, drop any inline critical block, load the link as a normal blocking sheet.
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssHref = /href="(framework\.css\?v=[^"]+)"/.exec(html)[1];
const full = html.replace(/<!--CRITICAL-CSS-START-->[\s\S]*?<!--CRITICAL-CSS-END-->/, `<link rel="stylesheet" href="${cssHref}">`);
const b = await chromium.launch(); const keep = new Set(); let all = [];
const vps = [[1440, 900], [1536, 730], [1920, 1080], [1024, 768], [768, 1024], [390, 844], [360, 780]];
for (const [w, h] of vps) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 }); const p = await c.newPage();
  await p.route('**/index.html', r => r.fulfill({ body: full, contentType: 'text/html' })); await p.route(`http://localhost:${port}/`, r => r.fulfill({ body: full, contentType: 'text/html' }));
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await p.waitForTimeout(800);
  const res = await p.evaluate(({ h }) => {
    const sheet = [...document.styleSheets].find(s => s.href && /framework\.css/.test(s.href)); const lim = h + 260; const out = [];
    const strip = s => s.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');
    const inView = sel => { let base; try { base = sel.split(',').map(x => strip(x.trim()) || '*'); } catch { return true; }
      for (const b of base) { let els; try { els = document.querySelectorAll(b); } catch { return true; } for (const e of els) { let x = e, r = x.getBoundingClientRect(); while ((r.height === 0 && r.width === 0) && x.parentElement && getComputedStyle(x).display !== 'contents') { x = x.parentElement; r = x.getBoundingClientRect(); } /* hidden (display:none) elements count by their nearest laid out ancestor, so the rules that hide them are kept */ if (r.top < lim) return true; if (e.closest('.site-header,.cine,.skip,.concept-banner')) return true; } } return false; };
    const walk = (rules, path) => { [...rules].forEach((r, i) => { const id = path + '/' + i;
      if (r.type === 1) { if (/^(html|body|\*|:root)\b/.test(r.selectorText) || r.selectorText === '*' || inView(r.selectorText)) out.push(id); }
      else if (r.type === 5 || r.type === 10) out.push(id); // @font-face, @keyframes kept (small)
      else if (r.cssRules && (r.type === 4 || r.type === 12)) { const before = out.length; walk(r.cssRules, id); if (out.length > before) out.push(id + '#m'); }
      else if (r.cssRules) { out.push(id); } }); };
    walk(sheet.cssRules, ''); return out;
  }, { h });
  res.forEach(x => keep.add(x)); await c.close();
}
await b.close(); srv.close();
// Rebuild text from the stylesheet source via a second pass in a fresh page (serialise kept rules in order)
const b2 = await chromium.launch(); const p2 = await b2.newPage(); const srv2 = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><html></html>'); }); await new Promise(r => srv2.listen(0, r));
await p2.goto(`http://localhost:${srv2.address().port}/`); const cssText = fs.readFileSync(path.join(root, cssHref.split('?')[0]), 'utf8');
const css = await p2.evaluate(({ cssText, keep }) => { const st = document.createElement('style'); st.textContent = cssText; document.head.appendChild(st); const k = new Set(keep);
  const ser = (rules, path) => { let o = ''; [...rules].forEach((r, i) => { const id = path + '/' + i;
    if (r.type === 4 || r.type === 12) { if (k.has(id + '#m')) { const inner = ser(r.cssRules, id); o += (r.type === 4 ? '@media ' + r.conditionText : '@supports ' + r.conditionText) + '{' + inner + '}'; } }
    else if (k.has(id)) o += r.cssText; }); return o; };
  return ser(st.sheet.cssRules, ''); }, { cssText, keep: [...keep] });
await b2.close(); srv2.close();
const min = css.replace(/\s*\{\s*/g, '{').replace(/;\s*}/g, '}').replace(/\s+/g, ' ').replace(/\s*([;:,>])\s*/g, '$1').replace(/;}/g, '}');
// Fonts are preloaded and the first paint can now happen before they arrive: block (not swap) in the inline copy so the text does not reflow when the font lands.
const minB = min.replace(/font-display:swap/g, 'font-display:block');
const block = `<!--CRITICAL-CSS-START--><style id="critical-css">${minB}</style><link rel="stylesheet" href="${cssHref}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${cssHref}"></noscript><!--CRITICAL-CSS-END-->`;
let out = html;
if (/<!--CRITICAL-CSS-START-->/.test(out)) out = out.replace(/<!--CRITICAL-CSS-START-->[\s\S]*?<!--CRITICAL-CSS-END-->/, () => block);
else out = out.replace(/<link rel="stylesheet" href="framework\.css\?v=[^"]+">/, () => block);
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('critical css bytes', min.length, 'full', cssText.length);
