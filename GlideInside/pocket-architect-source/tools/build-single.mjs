// Build Plan Studio as one self-contained HTML file: dist/plan-studio.html
// Usage: node tools/build-single.mjs [--out path] [--inline] [--brand name]
// Default: the page (HTML, CSS and the app's first-load code, inlined) plus a few sibling files in the same folder, all loaded on demand:
//   ps-<name>-<hash>.js   dynamic import chunks (3D viewer, exporters, portal, pdf import, mock data ...)
//   ps-jspdf.js           jsPDF (plan set and PDF export)
//   ps-pdf-worker.js      the pdf.js worker (PDF import)
// The siblings must be uploaded next to index.html (golive/make-upload-zip.sh includes everything under plan-studio/app).
// --inline: the old fully self-contained single file (no siblings; needed to open from file://, where ES module imports are blocked).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const brandArg = process.argv.indexOf('--brand');
const brand = brandArg > 0 ? process.argv[brandArg + 1] : null; // e.g. 'Pocket Architect': renames the product in the page and its messages
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(root, 'dist/plan-studio.html');

const inline = process.argv.includes('--inline');
const res = await build({
  entryPoints: { 'ps-app': resolve(root, 'src/app.js') },
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  splitting: !inline,
  outdir: inline ? undefined : join(tmpdir(), 'ps-build-out'),
  entryNames: '[name]',
  chunkNames: 'ps-[name]-[hash]',
  write: false,
  logLevel: 'warning',
});
const esc = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--').replace(/\x1b/g, '\\u001b');
const entryFile = res.outputFiles.find((f) => /ps-app\.js$/.test(f.path));
const chunkFiles = res.outputFiles.filter((f) => f !== entryFile);
const js = esc(entryFile.text);
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
const jspdfRaw = readFileSync(resolve(root, 'node_modules/jspdf/dist/jspdf.umd.min.js'), 'utf8');
const workerRaw = readFileSync(resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8');
const jspdf = esc(jspdfRaw);
const worker = esc(workerRaw);
// Sibling mode: the worker and jsPDF are plain files fetched when first needed (pdf-import.js reads __PS_PDF_WORKER__, export-client.js __PS_JSPDF__).
const siblingTags = `<script>window.__PS_PDF_WORKER__ = new URL('ps-pdf-worker.js', document.baseURI).href; window.__PS_JSPDF__ = new URL('ps-jspdf.js', document.baseURI).href;</script>`;
const inlineTags = `<script id="ps-pdf-worker" type="text/plain">${worker}</script>
<script>
try { window.__PS_PDF_WORKER__ = URL.createObjectURL(new Blob([document.getElementById('ps-pdf-worker').textContent], { type: 'text/javascript' })); } catch (e) {}
</script>
<script>${jspdf}</script>`;

const html = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Plan Studio</title>
<meta name="description" content="Draw a floor plan, see it in 3D and walk through it. Houses, granny flats, units, sheds and extensions.">
<!-- GI_CONFIG (portalEnabled, portalMock) comes from the site config; the portal stays closed if this file is missing -->
<script src="../../site.config.js?v=20261111"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
${css}
</style>
</head>
<body>
<div id="app" class="ps-app"><p class="ps-boot">Loading Plan Studio</p></div>
<noscript>Plan Studio needs JavaScript to run.</noscript>
${inline ? inlineTags : siblingTags}
<script type="module">
${js}
</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, brand ? html.replaceAll('Plan Studio', brand) : html);
let sib = 0;
if (!inline) {
  // Replace the previous build's siblings (hashed names change) so no stale chunk is uploaded.
  for (const f of readdirSync(dirname(out))) if (/^ps-.*\.js$/.test(f)) rmSync(join(dirname(out), f));
  for (const f of chunkFiles) {
    const name = f.path.split('/').pop();
    writeFileSync(join(dirname(out), name), f.text);
    sib += f.text.length;
    console.log(`  ${name} ${(f.text.length / 1e3).toFixed(0)} KB`);
  }
  writeFileSync(join(dirname(out), 'ps-jspdf.js'), jspdfRaw);
  writeFileSync(join(dirname(out), 'ps-pdf-worker.js'), workerRaw);
  console.log(`  ps-jspdf.js ${(jspdfRaw.length / 1e3).toFixed(0)} KB, ps-pdf-worker.js ${(workerRaw.length / 1e3).toFixed(0)} KB (on demand)`);
}
console.log(`wrote ${out} (${(html.length / 1e6).toFixed(2)} MB page${inline ? ', fully inline' : `, ${chunkFiles.length} sibling chunks ${(sib / 1e6).toFixed(2)} MB`})`);
