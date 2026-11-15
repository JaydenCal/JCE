// 3D review screenshots: strata complex, warehouse with metal upper, showroom, service station, mixed site and a residential house, each in Aerial, 3D, Street and Walk inside.
//   node tools/review3d-shots.cjs [outDir] [prefix] [scene,scene]   (prefix: before | after)
// Serves website-live as the site root, the real Worker app at /api, and stubs /api/site/* with a real looking E4 lot.
//   node tools/commercial-lotcard-shots.cjs [outDir]     (Playwright: PLAYWRIGHT_PATH or a local install)
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '../../website-live'));
const OUT = path.resolve(process.argv[2] || '/home/claude/fable-3d-review');
const PORT = Number(process.env.PORT || 8841); const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const ADDRESS = '12 Industrial Drive, Westdale NSW';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { createApp } = await import('../server/lib/app.js');
  const { createMemoryStore } = await import('../server/lib/store.js');
  const { demoLotResponse } = await import('../src/site/demo-lot.js');
  const tam = (await import('../src/site/fixtures/tamworth.js')).default;
  const app = createApp({ store: createMemoryStore(), env: { SITE_URL: ORIGIN, ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '1' } });
  let RES = false;
  const lotResp = () => {
    if (RES) { const d = demoLotResponse({}); return { ...d, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL' }; }
    const r = demoLotResponse({ commercial: true });
    const W = 72; const D = 112;
    const outer = [[-W / 2 - 2, -D / 2], [W / 2, -D / 2 + 1.5], [W / 2 + 1, D / 2], [-W / 2, D / 2 - 1]];
    return { ...r, sample: false, demo: false, attribution: 'Cadastre: NSW Spatial Services.', lga: 'TAMWORTH REGIONAL',
      lot: { ...r.lot, lotNumber: '12', planLabel: 'DP 1198432', lotLabel: 'Lot 12 DP 1198432', lotPlan: '12/DP1198432', polygons: [{ outer, holes: [] }], areaM2: 8050, registeredAreaM2: 8050,
        bboxMga: { minE: r.origin.e - 37, minN: r.origin.n - 57, maxE: r.origin.e + 37, maxN: r.origin.n + 57 } } };
  };
  const CACHE = path.join(OUT, 'aerial-cache'); fs.mkdirSync(CACHE, { recursive: true });
  const server = http.createServer(async (req, res_) => {
    const res = res_;
    const u = new URL(req.url, ORIGIN);
    if (u.pathname === '/api/site/search') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ results: [{ label: ADDRESS, state: 'NSW', lon: 150.930273, lat: -31.090267 }] })); }
    if (u.pathname === '/api/site/lot') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(lotResp())); }
    if (u.pathname === '/api/site/aerial') {
      // A synthetic street drawn for the box asked for (tools/review3d-aerial.py), at the resolution the real service would give, cached on disk.
      const [minE, minN, maxE, maxN] = String(u.searchParams.get('bbox')).split(',').map(Number);
      const [oe, on] = String(u.searchParams.get('origin') || `${lotResp().origin.e},${lotResp().origin.n}`).split(',').map(Number);
      const res = Math.min(2, Math.max(0.05, Number(u.searchParams.get('res')) || 0.1));
      const maxPx = Number(u.searchParams.get('maxpx')) || 4096;
      const k = Math.max(1, (maxE - minE) / res / maxPx, (maxN - minN) / res / maxPx);
      const w = Math.ceil((maxE - minE) / res / k); const h = Math.ceil((maxN - minN) / res / k);
      const box = [minE - oe, minN - on, maxE - oe, maxN - on].map((v) => v.toFixed(1));
      const file = path.join(CACHE, `${RES ? 'r' : 'c'}_${box.join('_')}_${w}x${h}.jpg`);
      if (!fs.existsSync(file)) require('child_process').execFileSync('python3', [path.resolve(__dirname, 'review3d-aerial.py'), ...box, String(w), String(h), file, ...(RES ? ['res'] : [])]);
      const meta = { ...tam.aerial, bbox: { minE, minN, maxE, maxN }, widthPx: w, heightPx: h, mmPerPx: ((maxE - minE) / w) * 1000, source: 'Synthetic test picture', sample: false, synthetic: true };
      res_.writeHead(200, { 'content-type': 'image/jpeg', 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) }); return res_.end(fs.readFileSync(file));
    }
    if (u.pathname === '/api/site/contours') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(tam.contours)); }
    if (u.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await app.fetch(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const headers = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const log = [];
  const mk = async (vp) => {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route(/^https:\/\/www\.googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') log.push(`console.error: ${m.text()} @ ${m.location().url}`); });
    return page;
  };
  const appFrame = (pg) => pg.frames().find((f) => /plan-studio\/app/.test(f.url()));
  const shot = async (pg, name) => { await pg.waitForTimeout(900); try { await pg.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 240000 }); console.log('shot', name); } catch (e) { console.log('shot failed', name, String(e.message).split('\n')[0]); } };
  const cardReady = async (fr, ms = 45000) => fr.waitForFunction(() => { const r = document.querySelector('[data-ps="lot-card-root"]'); return r && !r.hidden && document.querySelector('[data-ps="cc-stats"] [data-stat]'); }, null, { timeout: ms });
  const act = async (fr, fn, arg) => fr.evaluate(fn, arg);
  const tab = (fr, id) => fr.evaluate((i) => document.querySelector(`[data-ps="cc-views"] [data-tab="${i}"]`)?.click(), id);
  const layout = async (fr, id) => { await fr.evaluate((i) => window.__ps.lotCard.setLayout(i), id); await fr.waitForTimeout(2500); };

  const PRE = process.argv[3] || 'after';
  const ONLY = (process.argv[4] || '').split(',').filter(Boolean);
  const want = (s) => !ONLY.length || ONLY.includes(s);
  const VIEWS = (process.argv[5] || 'aerial,3d,street,walk').split(',');
  const page = await mk({ width: 1440, height: 900 });
  await page.goto(`${ORIGIN}/plan-studio/app/?embed=1&mode=commercial&address=${encodeURIComponent(ADDRESS)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Lot 12/.test(document.querySelector('[data-ps="lot-head"]')?.textContent || ''), null, { timeout: 240000 }).catch((e) => log.push('lookup wait: ' + e.message));
  await page.waitForFunction(() => window.__ps?.store?.project?.mode === 'commercial' && window.__ps.store.project.commercial?.rows?.length > 0 && window.__ps.lotCard, null, { timeout: 240000 }).catch((e) => log.push('commercial wait: ' + e.message));
  await page.waitForTimeout(6000);
  const fr = page.mainFrame();
  const setParams = (params) => fr.evaluate((ps) => { const o = window.__ps.buildingOps; const st = window.__ps.store; const id = st.project.commercial.buildings[0].id; for (const [k, v] of Object.entries(ps)) o.setBuildingParam(st, id, k, v); }, params);
  const four = async (name) => {
    for (const v of VIEWS) {
      await tab(fr, v); await page.waitForTimeout(v === 'walk' ? 6000 : 3800);
      await shot(page, `${PRE}-${name}-${v}`);
    }
    await tab(fr, 'aerial'); await page.waitForTimeout(1500);
  };
  const fps = async (label) => console.log('fps', label, await fr.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 2000) res(Math.round(n / 2)); else requestAnimationFrame(f); }; requestAnimationFrame(f); })), await fr.evaluate(() => { const r = window.__ps.getViewer?.()?.renderer?.info; return r ? JSON.stringify({ calls: r.render.calls, tris: r.render.triangles, tex: r.memory.textures, geo: r.memory.geometries }) : ''; }));
  if (want('strata')) {
    await fr.evaluate(() => window.__ps.lotCard.setLayout('b2b-12')); await fr.waitForFunction(() => !document.querySelector('.is-busy'), null, { timeout: 60000 }); await fr.waitForTimeout(14000);
    await fr.evaluate(() => window.__ps.buildingOps.setRowsUnit(window.__ps.store, { construction: 'tilt_up', panelFinish: 'painted', panelColour: 'project', panelReveals: 'one', accentPanels: 'both', accentColour: 'charcoal', signageBand: true })); await fr.waitForTimeout(2500);
    await four('strata'); await fps('strata');
  }
  if (want('mixed')) {
    await fr.evaluate(() => window.__ps.lotCard.setLayout('b2b-12')); await fr.waitForFunction(() => !document.querySelector('.is-busy'), null, { timeout: 60000 }); await fr.waitForTimeout(9000);
    console.log('mixed', await fr.evaluate(() => { const o = window.__ps.buildingOps; const s = window.__ps.store; o.addBuilding(s, 'office'); return JSON.stringify(s.project.commercial.buildings.map((b) => [b.type || b.typeId, b.place])); }));
    await fr.waitForTimeout(3000);
    await four('mixed');
  }
  if (want('warehouse')) {
    await fr.evaluate(() => window.__ps.lotCard.setType('warehouse')); await fr.waitForTimeout(3000);
    await setParams({ construction: 'tilt_up_metal_upper', panelFinish: 'painted', panelColour: 'sand', dadoHeightMm: 3600, docks: 4 });
    await fr.waitForTimeout(1500);
    await four('warehouse'); await fps('warehouse');
  }
  if (want('showroom')) {
    await fr.evaluate(() => window.__ps.lotCard.setType('showroom')); await fr.waitForTimeout(3000);
    await setParams({ construction: 'tilt_up', panelFinish: 'painted', panelColour: 'sand', accentPanels: 'entry', accentColour: 'charcoal', panelReveals: 'two', signageBand: true });
    await fr.waitForTimeout(1500);
    await four('showroom');
  }
  if (want('servo')) {
    await fr.evaluate(() => window.__ps.lotCard.setType('service-station')); await fr.waitForTimeout(4000);
    await four('servo'); await fps('servo');
  }
  await page.context().close();
  const HOUSES = [['house', null], ['granny', 'granny_flat'], ['shed', 'shed_workshop']].filter(([n]) => want(n));
  if (HOUSES.length) {
    RES = true;
    const ph = await mk({ width: 1440, height: 900 });
    await ph.goto(`${ORIGIN}/plan-studio/app/?embed=1&address=${encodeURIComponent('14 Wattle Street, Westdale NSW')}`, { waitUntil: 'domcontentloaded' });
    const f2 = ph.mainFrame();
    await ph.waitForFunction(() => window.__ps?.store?.project?.site?.lot?.boundary?.length > 2 && window.__ps.store.project.levels?.some((l) => l.walls?.length) && !/Loading your block|Placing design/.test(document.body.innerText), null, { timeout: 300000 }).catch((e) => log.push('house wait: ' + e.message));
    await ph.waitForTimeout(12000);
    for (const [name, type] of HOUSES) {
      if (type) { console.log(name, await f2.evaluate((t) => { try { const ps = window.__ps; const cur = structuredClone(ps.store.project); const fresh = ps.catalogue.createFromTemplate(t); ps.store.apply('Review design', (p) => { for (const k of Object.keys(p)) delete p[k]; Object.assign(p, structuredClone({ ...fresh, id: cur.id, designType: t === 'granny_flat' ? 'granny_flat' : t === 'shed_workshop' ? 'shed' : 'house', site: cur.site, titleBlock: cur.titleBlock })); }); ps.store.select(null); ps.store.setUI({ activeLevelId: ps.store.project.levels[0].id, levelFilter: 'all' }); return 'ok ' + t; } catch (e) { return 'failed ' + e.message; } }, type)); await ph.waitForTimeout(6000); }
      await f2.evaluate(() => document.querySelector('[data-ps="view3d-aerial"]')?.click()); await ph.waitForTimeout(3500); await shot(ph, `${PRE}-${name}-aerial`);
      await f2.evaluate(() => document.querySelector('[data-ps="view3d-hero"]')?.click()); await ph.waitForTimeout(3500); await shot(ph, `${PRE}-${name}-3d`);
      await f2.evaluate(() => document.querySelector('[data-ps="view3d-front"]')?.click()); await ph.waitForTimeout(3500); await shot(ph, `${PRE}-${name}-street`);
      await f2.evaluate(() => window.__ps.store.setUI({ view: 'walk' })); await ph.waitForTimeout(6000); await shot(ph, `${PRE}-${name}-walk`);
      await f2.evaluate(() => window.__ps.store.setUI({ view: '3d' })); await ph.waitForTimeout(2500);
    }
    await ph.context().close();
  }
  if (want('double')) {
    // The double storey starter in the full editor (no lot): the 3D view a person designing from a template sees.
    const pd = await mk({ width: 1440, height: 900 });
    await pd.goto(`${ORIGIN}/plan-studio/app/`, { waitUntil: 'domcontentloaded' });
    await pd.waitForFunction(() => window.__ps?.catalogue?.templates?.length > 0, null, { timeout: 60000 });
    await pd.waitForTimeout(3000);
    const f3 = pd.mainFrame();
    console.log('double', await f3.evaluate(() => { const ps = window.__ps; const ok = ps.loadTemplate(ps.catalogue.templates.find((t) => t.id === 'house_double')); ps.store.setUI({ view: '3d' }); return String(ok); }));
    await pd.waitForTimeout(7000);
    await f3.evaluate(() => document.querySelector('[data-ps="view3d-aerial"]')?.click()); await pd.waitForTimeout(3500); await shot(pd, `${PRE}-double-aerial`);
    await f3.evaluate(() => document.querySelector('[data-ps="view3d-hero"]')?.click()); await pd.waitForTimeout(3500); await shot(pd, `${PRE}-double-3d`);
    await f3.evaluate(() => document.querySelector('[data-ps="view3d-front"]')?.click()); await pd.waitForTimeout(3500); await shot(pd, `${PRE}-double-street`);
    await f3.evaluate(() => window.__ps.store.setUI({ view: 'walk' })); await pd.waitForTimeout(6000); await shot(pd, `${PRE}-double-walk`);
    await pd.context().close();
  }
  await browser.close(); server.close();
  console.log(log.length ? 'LOG:\n' + [...new Set(log)].join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });
