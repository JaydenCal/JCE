// Build Plan Studio as one self-contained HTML file: dist/plan-studio.html
// Usage: node tools/build-single.mjs [--out path]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(root, 'dist/plan-studio.html');

const res = await build({
  entryPoints: [resolve(root, 'src/app.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  write: false,
  logLevel: 'warning',
});
const esc = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/\x1b/g, '\\u001b');
const js = esc(res.outputFiles[0].text);
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
const jspdf = esc(readFileSync(resolve(root, 'node_modules/jspdf/dist/jspdf.umd.min.js'), 'utf8'));
const worker = esc(readFileSync(resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8'));

const html = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Plan Studio</title>
<meta name="description" content="Draw a floor plan, see it in 3D and walk through it. Houses, granny flats, units, sheds and extensions.">
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
<script id="ps-pdf-worker" type="text/plain">${worker}</script>
<script>
try { window.__PS_PDF_WORKER__ = URL.createObjectURL(new Blob([document.getElementById('ps-pdf-worker').textContent], { type: 'text/javascript' })); } catch (e) {}
</script>
<script>${jspdf}</script>
<script type="module">
${js}
</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1e6).toFixed(2)} MB)`);
