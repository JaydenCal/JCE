// Runs the real plan set exporter in a WebGL browser page (Playwright, swiftshader) so the 3D renders come from the app's own viewer3d scene.
// renderPlanSet(project, { aerial, kind }) -> { bytes: Buffer, sheets, pages, shots }.   The project and aerial are plain data made in Node.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, SKIP } from './viewer-host.mjs';
import { ARGS } from './phone-harness.mjs';
export { SKIP };

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../..');
let bundle = null;
async function bundleText() {
  if (bundle) return bundle;
  const entry = `
    export { exportPlanSet } from '${SRC}/src/premium/exporters/planset/index.js';
    export { saveImage } from '${SRC}/src/editor2d/underlay.js';
    export { renderSetViews } from '${SRC}/src/premium/exporters/planset/views3d.js';`;
  const res = await build({ stdin: { contents: entry, resolveDir: SRC, loader: 'js' }, bundle: true, format: 'iife', globalName: 'PS3D', write: false, logLevel: 'error', target: 'es2020', minify: false });
  bundle = res.outputFiles[0].text;
  return bundle;
}

export async function renderPlanSet(project, { aerial = null, kind = 'commercial', views = true, builder = null, storedAerial = true, width = 1280, height = 800, phone = false } = {}) {
  const br = await chromium.launch({ args: ARGS });
  try {
    const ctx = await br.newContext({ viewport: { width, height }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('http://planset.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><body></body>' }));
    await page.goto('http://planset.test/', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: await bundleText() });
    const out = await page.evaluate(async ({ project, aerial, kind, views, builder, storedAerial }) => {
      const t0 = performance.now();
      if (aerial) {
        const b = await (await fetch(aerial.image)).blob();
        await window.PS3D.saveImage('ps.test.aerial', b);
        if (storedAerial) project.site.lot.aerial = { key: 'ps.test.aerial', source: 'test', attribution: aerial.attribution || '', extent: aerial.extent, mmPerPx: (aerial.extent.x1 - aerial.extent.x0) / 640 };
      }
      const r = await window.PS3D.exportPlanSet({ project, kind, download: false, fetchSite: null, ...(builder ? { builder, builderName: builder.name } : {}), aerial: aerial ? [aerial] : null, ...(views ? {} : { views3d: null }) });
      const buf = new Uint8Array(await r.blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(s), sheets: r.sheets, pages: r.pages, ms: Math.round(performance.now() - t0) };
    }, { project, aerial, kind, views, builder, storedAerial });
    return { bytes: Buffer.from(out.b64, 'base64'), sheets: out.sheets, pages: out.pages, ms: out.ms, errs };
  } finally { await br.close(); }
}
