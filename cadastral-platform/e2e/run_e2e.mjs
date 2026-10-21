// Stage 11 end to end run (Playwright, Chromium from PLAYWRIGHT_BROWSERS_PATH). See e2e/README in docs/22 section 9.
// Needs: backend harness on :8765 (python3 e2e/harness.py), the production frontend on :3100 built with NEXT_PUBLIC_API_BASE=http://127.0.0.1:8765 (npx next start -p 3100 -H 127.0.0.1).
// Screenshots and the two downloaded exports go to test-runs/e2e/. Exit code 1 when a step failed. Only 127.0.0.1 is reachable: every other host is aborted.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.resolve(HERE, '..', 'frontend') + '/')('playwright-core');   // playwright-core is a dev dependency of the frontend
const OUT = process.env.E2E_OUT || path.resolve(HERE, '..', 'test-runs', 'e2e');
const FIX = path.join(HERE, 'fixtures');
const PID = process.env.E2E_PROJECT || '5a0e2e11-0000-4000-8000-00000000e2e1';
const WEB = process.env.E2E_WEB || 'http://127.0.0.1:3100';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'exports'), { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addCookies([{ name: 'jce_terms', value: '1', url: WEB }]);
await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') ? r.continue() : r.abort(); });
const page = await ctx.newPage();
const problems = [], notes = [], results = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 300)));
page.on('response', (r) => { if (r.status() >= 400 && !/\/(catalogue|items)(\?|$)/.test(r.url())) problems.push(`http ${r.status()} ${r.url().slice(0, 120)}`); });

const shot = async (name) => { const f = `${name}.png`; await page.screenshot({ path: path.join(OUT, f) }); return f; };
async function step(name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); const f = await shot(name); results.push({ name, ok: true, file: f, detail: detail ?? '' }); console.log(`PASS ${name}${detail ? ' :: ' + detail : ''} (${Date.now() - t0} ms)`); }
  catch (e) { let f = ''; try { f = await shot(name + '_FAILED'); } catch { /* ignore */ } results.push({ name, ok: false, file: f, detail: String(e).slice(0, 400) }); console.log(`FAIL ${name} :: ${String(e).slice(0, 400)}`); }
}
const sleep = (ms) => page.waitForTimeout(ms);
// the viewer ignores shortcut keys while a form control has focus, so give the focus back to the page first
const key = async (k) => { await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }); await page.keyboard.press(k); };

// ---- helpers that run in the page: local scene coordinates (MGA minus origin) to screen pixels, and the reverse for reading the kerb
const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const v = window.__viewer, c = v.camera; c.updateMatrixWorld();
  const zz = z ?? v.groundAt(x, y, 500) ?? 0, V = c.matrixWorldInverse.elements, P = c.projectionMatrix.elements;
  const vx = V[0] * x + V[4] * y + V[8] * zz + V[12], vy = V[1] * x + V[5] * y + V[9] * zz + V[13], vz = V[2] * x + V[6] * y + V[10] * zz + V[14], vw = V[3] * x + V[7] * y + V[11] * zz + V[15];
  const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12] * vw, cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13] * vw, cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15] * vw;
  const r = v.canvas.getBoundingClientRect();
  return { x: r.left + (cx / cw + 1) / 2 * r.width, y: r.top + (1 - cy / cw) / 2 * r.height, z: zz };
}, [x, y, z]);
let G = null;   // lot geometry, read once the page is up
const click = async (x, y, z) => { const s = await toScreen(x, y, z); await page.mouse.move(s.x, s.y); await sleep(60); await page.mouse.click(s.x, s.y); await sleep(120); return s; };
const panelTab = (name) => page.getByRole('tab', { name: new RegExp('^' + name + '$', 'i') }).or(page.locator('button,[role=tab]', { hasText: new RegExp('^' + name + '$', 'i') })).first();
const chip = (label) => page.locator('button.chip', { hasText: new RegExp('^' + label + '$') }).first();
const objects = () => page.evaluate(() => window.__viewer.design.h.store.doc.objects.map((o) => ({ id: o.id, type: o.type, status: o.status })));
const setField = async (sel, value) => { const f = page.locator(sel); await f.fill(String(value)); await f.press('Enter').catch(() => {}); await f.blur().catch(() => {}); await sleep(250); };

// ---------------------------------------------------------------------------------------------------------------------------------
await step('01_load_scene_bundle', async () => {
  await page.goto(`${WEB}/projects/${PID}/viewer`);
  await page.waitForFunction(() => window.__viewer && window.__viewer.bundle, null, { timeout: 90000 });
  await sleep(2500);
  G = await page.evaluate(() => { const v = window.__viewer, h = v.design.h, O = v.bundle.info.origin; return { O, kerb: h.kerb ? { a: [h.kerb.a[0] - O[0], h.kerb.a[1] - O[1]], u: h.kerb.u, n: h.kerb.n, len: h.kerb.length } : null, status: v.bundle.info.terrain?.status ?? null, data: v.bundle.info.data_status, parts: v.bundle.parts.length }; });
  if (!G.kerb) throw new Error('the bundle has no kerb line');
  const txt = await page.locator('body').innerText();
  for (const s of ['INDICATIVE 5 m DEM', 'LIDAR PENDING']) if (!txt.includes(s)) throw new Error(`status label missing: ${s}`);
  return `${G.parts} parts, ${G.data}`;
});

// the lot front edge is the kerb here: M is the kerb point in front of the lot, n runs into the lot
const kerbAt = (t) => [G.kerb.a[0] + G.kerb.u[0] * t, G.kerb.a[1] + G.kerb.u[1] * t];
const along = (p, u, s) => [p[0] + u[0] * s, p[1] + u[1] * s];

await step('02_layer_groups', async () => {
  const names = await page.locator('.dz-lg, [data-layer-group]').count().catch(() => 0);
  const txt = await page.locator('body').innerText();
  for (const s of ['TERRAIN', 'CONTEXT', 'DESIGN OBJECTS', 'STORMWATER RESULTS']) if (!txt.toUpperCase().includes(s)) throw new Error('layer group missing: ' + s);
  const cb = page.getByLabel(/Adjoining lots/i).first(); await cb.uncheck(); await sleep(300); await cb.check(); await sleep(300);
  return `groups present (${names} marked)`;
});

await step('03_plan_view_north_arrow_scale', async () => {
  await key('t'); await sleep(1800);
  const on = await page.locator('[data-plan-overlay], .vw-plan, [data-north], .vw-north').count();
  const txt = await page.locator('body').innerText();
  if (!/\b\d+(\.\d+)?\s?(m|km)\b/.test(txt)) throw new Error('no scale bar text');
  return `plan overlay nodes ${on}`;
});

// ---- import and place the Plan Studio building (with its GLB)
await step('04_open_design_tab_and_import_building', async () => {
  await key('d'); await sleep(600);                       // the Design button (D) switches design mode on and opens the Design tab
  if (!(await page.evaluate(() => window.__viewer.designActive))) throw new Error('design mode did not start');
  await page.locator('#dz-file').scrollIntoViewIfNeeded();
  await page.setInputFiles('#dz-file', [path.join(FIX, 'building_synthetic.planstudio.json'), path.join(FIX, 'building_synthetic.glb')]);
  await page.waitForFunction(() => window.__viewer.design.state().pendingBuilding || /checked this footprint/i.test(document.body.innerText), null, { timeout: 30000 });
  const chk = page.getByLabel(/checked this footprint/i); if (await chk.count()) { await chk.check(); await page.getByRole('button', { name: /Continue to placement/i }).click(); }
  await page.waitForFunction(() => window.__viewer.design.state().pendingBuilding, null, { timeout: 20000 });
  return 'import accepted, placement started';
});

let C = null;
await step('05_place_building', async () => {
  const M = kerbAt(40.1); C = along(along(M, G.kerb.n, 22), G.kerb.u, 0);
  const s = await toScreen(C[0], C[1]); await page.mouse.move(s.x - 30, s.y - 30); await sleep(150); await page.mouse.move(s.x, s.y); await sleep(250);
  await page.mouse.click(s.x, s.y); await sleep(900);
  const o = (await objects()).filter((x) => x.type === 'building'); if (o.length !== 1) throw new Error('building not placed: ' + JSON.stringify(o));
  return `building ${o[0].id}`;
});

await step('06_set_ffl', async () => {
  const b = (await objects()).find((x) => x.type === 'building');
  await page.evaluate((id) => { const c = window.__viewer.design; c.select ? c.select(id) : c.h.store.run('select', { id }); }, b.id).catch(() => {});
  await sleep(500);
  if (!(await page.locator('#dz-p-ffl_rl').count())) { const s = await toScreen(C[0], C[1]); await key('Escape'); await page.mouse.click(s.x, s.y); await sleep(500); }
  const gz = await page.evaluate(([x, y]) => window.__viewer.groundAt(x, y, 500), C), ffl = Math.round((gz + 0.3) * 100) / 100;
  await setField('#dz-p-ffl_rl', ffl);
  await setField('#dz-p-height_m', 5.5).catch(() => {});
  const got = await page.evaluate((id) => { const o = window.__viewer.design.h.store.doc.objects.find((x) => x.id === id); return o?.params?.ffl_rl ?? null; }, b.id);
  if (!got || Math.abs(Number(got.value) - ffl) > 0.011) throw new Error('ffl not stored: ' + JSON.stringify(got));
  return `FFL ${ffl} m RL, basis ${got.basis}`;
});

await step('07_draw_driveway', async () => {
  await panelTab('Design').click();
  await chip('DRIVEWAY').click(); await sleep(200);
  const M = kerbAt(40.1), p1 = along(M, G.kerb.n, 6), p2 = along(M, G.kerb.n, 12);
  const s0 = await click(M[0], M[1]); await click(p1[0], p1[1]); await click(p2[0], p2[1]); await key('Enter'); await sleep(900);
  const o = (await objects()).filter((x) => x.type === 'driveway'); if (!o.length) throw new Error('no driveway object');
  const v0 = await page.evaluate((id) => window.__viewer.design.h.store.doc.objects.find((x) => x.id === id).geometry.pts[0], o[0].id);
  return `driveway ${o[0].id}, crossover at ${JSON.stringify(v0)}`;
});

await step('08_drag_crossover', async () => {
  const d = (await objects()).find((x) => x.type === 'driveway');
  const read = () => page.evaluate((id) => window.__viewer.design.h.store.doc.objects.find((x) => x.id === id).geometry.pts[0], d.id);
  await key('Escape'); await page.evaluate((id) => window.__viewer.design.select(id), d.id); await sleep(500);
  const before = await read();
  const O = G.O, p0 = [before.e ?? before[0], before.n ?? before[1]];
  // geometry points are MGA like the controller; convert to the local scene frame for the projection
  const loc = [p0[0] - O[0], p0[1] - O[1]], tgt = along(loc, G.kerb.u, 4);
  const a = await toScreen(loc[0], loc[1]), b = await toScreen(tgt[0], tgt[1]);
  await page.mouse.move(a.x, a.y); await sleep(200); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10); await sleep(40); } await page.mouse.up(); await sleep(900);
  const after = await read(), moved = Math.hypot((after.e ?? after[0]) - p0[0], (after.n ?? after[1]) - p0[1]);
  if (moved < 1) throw new Error(`crossover did not move (${moved.toFixed(2)} m)`);
  return `crossover moved ${moved.toFixed(2)} m along the kerb`;
});

await step('09_add_tank', async () => {
  const M = kerbAt(40.1), T = along(along(M, G.kerb.n, 25), G.kerb.u, 7.5);
  await chip('RAINWATER TANK').click(); await sleep(200); await click(T[0], T[1]); await key('Escape'); await sleep(700);
  const o = (await objects()).filter((x) => x.type === 'rwt'); if (!o.length) throw new Error('no tank');
  return `tank ${o[0].id}`;
});

await step('10_add_infiltration_trench', async () => {
  const M = kerbAt(40.1), a = along(along(M, G.kerb.n, 20), G.kerb.u, -7.5), b = along(a, G.kerb.n, 6);
  await chip('INFILTRATION TRENCH').click(); await sleep(200); await click(a[0], a[1]); await click(b[0], b[1]); await key('Enter'); await sleep(900);
  const o = (await objects()).filter((x) => x.type === 'infiltration_trench'); if (!o.length) throw new Error('no trench');
  await key('Escape');
  return `trench ${o[0].id}`;
});

await step('11_run_checks', async () => {
  await page.getByRole('button', { name: /^Check now$/ }).click();
  await page.waitForFunction(() => /NOT SET|PASS|FAIL|UNRESOLVED|CHECKED|OK/i.test(document.body.innerText), null, { timeout: 30000 });
  await sleep(1500);
  const t = await page.evaluate(() => window.__viewer.design.h.store.doc.objects.length);
  return `${t} objects checked`;
});

await step('12_stormwater_with_uploaded_ifd', async () => {
  await page.locator('#sw-ifd').scrollIntoViewIfNeeded();
  await page.setInputFiles('#sw-ifd', path.join(FIX, 'ifd_synthetic.csv')); await sleep(1500);
  await page.getByRole('button', { name: /Run the stormwater analysis/ }).click();
  await page.waitForFunction(() => !/Analysing/.test(document.body.innerText) && /STORMWATER/i.test(document.body.innerText), null, { timeout: 60000 });
  await sleep(1500);
  const txt = await page.locator('body').innerText();
  return /SYNTHETIC|ifd_synthetic|IFD/i.test(txt) ? 'IFD stored and analysis ran' : 'ran';
});

await step('13_ai_first_design_rules_mode', async () => {
  const ai = page.getByLabel(/Let the AI choose/i); if (await ai.isChecked()) await ai.uncheck();
  await page.getByRole('button', { name: /^Design for me$/ }).click();
  await page.getByRole('button', { name: /^Run it$|Review the cost|Confirm and run/ }).first().click({ timeout: 30000 });
  await page.waitForFunction(() => { const f = window.__viewer.design.state().firstDesign; return f.phase === 'review' || f.phase === 'error'; }, null, { timeout: 90000 });
  const f = await page.evaluate(() => { const s = window.__viewer.design.state().firstDesign; return { phase: s.phase, error: s.error, n: s.result?.proposals.length ?? 0, by: s.result?.selected_by ?? '', calls: s.result?.usage?.calls ?? null }; });
  if (f.phase !== 'review' || f.n < 1) throw new Error('first design gave no proposals: ' + JSON.stringify(f));
  if (f.calls) throw new Error('a model call was made without a key: ' + JSON.stringify(f));
  await sleep(800);
  return `${f.n} proposals, ${f.by}, ${f.calls} model calls`;
});

await step('14_accept_a_proposal', async () => {
  const before = (await objects()).length;
  const btn = page.getByRole('button', { name: /^Accept$/ }).first();
  await btn.scrollIntoViewIfNeeded(); await btn.click(); await sleep(1500);
  const f = await page.evaluate(() => window.__viewer.design.state().firstDesign.items.map((i) => i.status));
  if (!f.includes('accepted')) throw new Error('no proposal accepted: ' + JSON.stringify(f));
  return `proposal accepted (${f.filter((x) => x === 'accepted').length} of ${f.length}), objects ${before} to ${(await objects()).length}`;
});

await step('15_measure_distance_area_level', async () => {
  await key('Escape'); await key('m'); await sleep(500);
  if (!(await page.evaluate(() => window.__viewer.measureActive))) throw new Error('measure mode did not start');
  const M = kerbAt(40.1), head = () => page.locator('[data-measure-result]').innerText();
  const out = [];
  const a = along(M, G.kerb.n, 3), b = along(M, G.kerb.n, 23);
  await click(a[0], a[1]); await click(b[0], b[1]); await sleep(500); out.push('distance: ' + (await head()));
  if (!/\d/.test(out[0])) throw new Error('no distance: ' + out[0]);
  await page.getByRole('button', { name: /^Level difference$/ }).click(); await sleep(300);
  await click(a[0], a[1]); await click(b[0], b[1]); await sleep(500); out.push('level: ' + (await head()));
  await page.getByRole('button', { name: /^Area$/ }).click(); await sleep(300);
  const q = [along(M, G.kerb.n, 4), along(along(M, G.kerb.n, 4), G.kerb.u, 8), along(along(M, G.kerb.n, 12), G.kerb.u, 8), along(M, G.kerb.n, 12)];
  for (const p of q) await click(p[0], p[1]); await sleep(500); out.push('area: ' + (await head()));
  return out.join(' | ');
});

await step('16_first_person_collision', async () => {
  await key('Escape'); if (await page.evaluate(() => window.__viewer.measureActive)) await key('m'); await sleep(300);
  await key('f'); await sleep(1500);
  if (!(await page.evaluate(() => window.__viewer.fpActive))) throw new Error('first person did not start');
  const locked = await page.evaluate(() => window.__viewer.fp.locked);
  if (!locked) notes.push('pointer lock was not granted in headless Chromium; keys still drive the walker, mouse look was not exercised');
  // the building footprint (MGA ring) in local metres, its centre, and a start point 6 m outside the first corner
  const T = await page.evaluate((O) => {
    const v = window.__viewer, b = v.design.h.store.doc.objects.find((o) => o.type === 'building'), ring = b.geometry.ring.map((p) => [p[0] - O[0], p[1] - O[1]]);
    const c = ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]), p0 = ring[0], d = Math.hypot(p0[0] - c[0], p0[1] - c[1]);
    const start = [c[0] + (p0[0] - c[0]) * (1 + 1.0 / d), c[1] + (p0[1] - c[1]) * (1 + 1.0 / d)];
    return { ring, c, start, away: [c[0] + (p0[0] - c[0]) * (1 + 16 / d), c[1] + (p0[1] - c[1]) * (1 + 16 / d)] };   // start 1 m outside the first corner
  }, G.O);
  const walk = async (from, to, ms) => {
    await page.evaluate(([f, t]) => { const v = window.__viewer, z = v.groundAt(f[0], f[1], 500) ?? 0; v.fp.respawn({ p: [f[0], f[1], z + 0.05], yaw: Math.atan2(t[0] - f[0], t[1] - f[1]) * 180 / Math.PI }); }, [from, to]);
    await sleep(600);
    const s0 = await page.evaluate(() => ({ ...window.__viewer.fp.state }));
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await sleep(ms); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    const s1 = await page.evaluate(() => { const v = window.__viewer; return { ...v.fp.state, ground: v.groundAt(v.fp.state.x, v.fp.state.y, v.fp.state.z + 2) }; });
    return { s0, s1, moved: Math.hypot(s1.x - s0.x, s1.y - s0.y) };
  };
  const inside = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const free = await walk(T.start, T.away, 7000);                  // away from the building: the control, how far the walker goes in the same time
  const blocked = await walk(T.start, T.c, 7000);                  // into the building
  if (inside([blocked.s1.x, blocked.s1.y], T.ring)) throw new Error('the walker is inside the building footprint');
  if (!(free.moved > 2)) throw new Error('the control walk went too short a way to judge: ' + free.moved.toFixed(2));
  if (blocked.moved > free.moved * 0.7) throw new Error(`no collision with the building: ${blocked.moved.toFixed(2)} m against ${free.moved.toFixed(2)} m in free space`);
  if (Math.abs(free.s1.z - (free.s1.ground ?? free.s1.z)) > 0.5) throw new Error('the walker is not on the ground: ' + JSON.stringify(free.s1));
  await sleep(400);          // the walker stays on screen for the picture; the next step leaves first person with Esc
  return `free walk ${free.moved.toFixed(2)} m, into the building ${blocked.moved.toFixed(2)} m, stopped ${Math.hypot(blocked.s1.x - T.c[0], blocked.s1.y - T.c[1]).toFixed(2)} m from its centre, outside the footprint, on the ground (z ${free.s1.z.toFixed(2)} vs ${free.s1.ground?.toFixed?.(2)})`;
});

// ---- exports
const saveDl = async (kind) => {
  await key('Escape');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator(`[data-export="${kind}"]`).click()]);
  const f = path.join(OUT, 'exports', dl.suggestedFilename()); await dl.saveAs(f); return f;
};
let glbFile = '', dxfFile = '';
await step('17_export_tab_glb', async () => {
  await key('Escape'); await sleep(300);
  await panelTab('Export').click(); await sleep(600);
  glbFile = await saveDl('glb');
  const b = fs.readFileSync(glbFile); if (b.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const jl = b.readUInt32LE(12), j = JSON.parse(b.toString('utf8', 20, 20 + jl).trim());
  const names = new Set(j.nodes.map((x) => x.name)), objs = await objects();
  const miss = objs.filter((o) => !names.has(o.id)); if (miss.length) throw new Error('nodes missing for ' + miss.map((m) => m.id).join(','));
  const txt = JSON.stringify(j.asset?.extras ?? j.extras ?? {});
  if (!/INDICATIVE 5 m DEM/.test(txt)) throw new Error('status label missing in the GLB');
  return `${path.basename(glbFile)} ${b.length} bytes, ${j.nodes.length} nodes, every object has its node`;
});
await step('18_export_dxf', async () => {
  dxfFile = await saveDl('dxf');
  const t = fs.readFileSync(dxfFile, 'latin1');
  if (!/AC10(15|09|24)/.test(t)) throw new Error('no DXF version header');
  for (const s of ['INDICATIVE 5 m DEM', 'LIDAR PENDING']) if (!t.toUpperCase().includes(s.toUpperCase())) throw new Error('status label missing in the DXF: ' + s);
  const L = t.split(/\r?\n/), texts = []; const layers = new Set(); let ent = '';
  for (let i = 0; i + 1 < L.length; i += 2) { const code = L[i].trim(), val = L[i + 1]; if (code === '0') ent = val.trim(); else if (code === '1' && (ent === 'TEXT' || ent === 'MTEXT')) texts.push(val); else if (code === '2' && ent === 'LAYER') layers.add(val.trim()); }
  const lower = texts.filter((x) => x !== x.toUpperCase()); if (lower.length) throw new Error('lower case drawing text: ' + lower.slice(0, 3).join(' / '));
  const badLayers = [...layers].filter((x) => x !== '0' && x !== 'Defpoints' && !/^JCS-[A-Z0-9]+-[A-Z0-9]+-[A-Z]+$/.test(x)); if (badLayers.length) throw new Error('layers outside the JCS scheme: ' + badLayers.slice(0, 4).join(', '));
  if (!texts.length) throw new Error('no drawing text');
  return `${path.basename(dxfFile)} ${t.length} bytes, ${layers.size} layers, ${texts.length} text entities all upper case`;
});

await browser.close();
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
const total = size(OUT);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ steps: results, notes, problems: [...new Set(problems)].slice(0, 40), bytes: total }, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed; ${total} bytes in ${OUT}`);
if (problems.length) console.log('page problems:', [...new Set(problems)].slice(0, 10));
process.exit(results.every((r) => r.ok) ? 0 : 1);
