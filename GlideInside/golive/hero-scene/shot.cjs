const { chromium } = require('playwright');
// usage: node shot.cjs out.png W H DSF "query"
const [out, W, H, DSF, q] = [process.argv[2], +process.argv[3] || 1600, +process.argv[4] || 900, +process.argv[5] || 1, process.argv[6] || ''];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--max-active-webgl-contexts=4'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const p = await ctx.newPage(); p.setDefaultTimeout(400000);
  p.on('pageerror', e => console.log('ERR', e.message));
  p.on('console', m => { if (/ERR|error|warn/i.test(m.text())) console.log('CON', m.text().slice(0, 300)); });
  const url = 'file://' + __dirname + '/scene.html?w=' + W + '&h=' + H + '&' + q;
  const t0 = Date.now();
  await p.goto(url);
  await p.waitForFunction(() => window.__treesReady === true || window.__err, null, { timeout: 240000 });
  const data = await p.evaluate(() => { window.__render(); return document.querySelector('canvas').toDataURL('image/png'); });
  require('fs').writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log('done', out, (Date.now() - t0) / 1000 + 's');
  await b.close();
})();
