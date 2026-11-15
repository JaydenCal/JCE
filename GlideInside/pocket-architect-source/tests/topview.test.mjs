// The enlarged top view (src/lotcard/topview.js): scene builders, zoom and pan maths, SVG output, and the wiring on both lot cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalogue } from '../src/catalogue/index.js';
import { migrate } from '../src/model/schema.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { housingScene, sceneBounds, fitView, zoomAt, panBy, viewBoxOf, scaleBarFor, sceneInner, sceneSvg, ZOOM_IN, ZOOM_OUT, TOPVIEW_CSS } from '../src/lotcard/topview.js';
import { commercialScene } from '../src/commercial/topview-scene.js';
import { commercialProject } from './helpers/commercial-fixture.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const lotHouse = () => {
  const p = migrate(catalogue.createFromTemplate('house_single'));
  const f = FIXTURES[0];
  p.site.lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', contours: f.contours, address: f.search[0].label, source: 'sample' });
  return p;
};

test('housing scene: lot boundary, setback line, neighbours and the house, all as finite plan points', () => {
  const sc = housingScene(lotHouse());
  assert.ok(sc.boundary.length >= 3);
  assert.ok(sc.shapes.some((s) => s.kind === 'house'));
  assert.ok(sc.neighbours.length > 0);
  for (const q of [...sc.boundary, ...sc.shapes.flatMap((s) => s.ring)]) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
  assert.match(sc.summary, /m²/);
  assert.equal(sc.northDeg, 0);
  assert.equal(housingScene(migrate(catalogue.createFromTemplate('house_single'))), null, 'no lot, no scene');
});

test('commercial scene: units numbered, parking bays, buildings, setback line', async () => {
  const sc = await commercialScene(commercialProject({ plain: false }));
  const kinds = new Set(sc.shapes.map((s) => s.kind));
  assert.ok(kinds.has('unit') && kinds.has('bay'));
  assert.equal(sc.labels.length, sc.shapes.filter((s) => s.kind === 'unit').length);
  assert.deepEqual(sc.labels.map((l) => l.text).slice(0, 3), ['1', '2', '3']);
  assert.match(sc.summary, /16 units/);
  assert.ok(sc.envelope && sc.envelope.length >= 3, 'the setback line');
});

test('the scene follows the layout: a different layout gives a different scene (kept in sync)', async () => {
  const a = commercialProject({ plain: false, rows: 'pair' });
  const b = commercialProject({ plain: false, rows: 'single' });
  const sa = await commercialScene(a);
  const sb = await commercialScene(b);
  assert.notEqual(sa.shapes.filter((s) => s.kind === 'unit').length, sb.shapes.filter((s) => s.kind === 'unit').length);
});

test('fitView frames the whole scene with a margin, zoom keeps the point under the cursor, limits hold', () => {
  const sc = housingScene(lotHouse());
  const fit = fitView(sc, 800, 500);
  const b = sceneBounds(sc);
  const vb = viewBoxOf(fit, 800, 500);
  assert.ok(vb.x < b.minX && vb.x + vb.w > b.maxX && vb.y < b.minY && vb.y + vb.h > b.maxY, 'the whole scene is in view');
  const anchor = { sx: 600, sy: 120 };
  const before = { x: fit.cx + (anchor.sx - 400) / fit.k, y: fit.cy + (anchor.sy - 250) / fit.k };
  const z = zoomAt(fit, fit, 3, anchor.sx, anchor.sy, 800, 500);
  assert.ok(Math.abs(z.k / fit.k - 3) < 1e-9);
  const after = { x: z.cx + (anchor.sx - 400) / z.k, y: z.cy + (anchor.sy - 250) / z.k };
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-6);
  assert.equal(zoomAt(fit, fit, 1e9, 400, 250, 800, 500).k, fit.k * ZOOM_IN);
  assert.equal(zoomAt(fit, fit, 1e-9, 400, 250, 800, 500).k, fit.k * ZOOM_OUT);
  const p = panBy(fit, 100, -50, sc);
  assert.ok(p.cx < fit.cx && p.cy > fit.cy, 'dragging right moves the plan right, so the centre moves left');
  const far = panBy(fit, -1e12, 1e12, sc);
  assert.ok(far.cx <= b.maxX + (b.maxX - b.minX) + 1e-6, 'pan is limited');
  const bar = scaleBarFor(fit.k);
  assert.ok(bar.px <= 150 && bar.px > 20 && bar.m > 0);
});

test('SVG is vector (paths and text, no raster image), strokes keep pixel width at any zoom, text keeps pixel size', () => {
  const sc = housingScene(lotHouse());
  if (!sc.envelope) { const b = sceneBounds(sc); sc.envelope = [{ x: b.minX + 1000, y: b.minY + 1000 }, { x: b.maxX - 1000, y: b.minY + 1000 }, { x: b.maxX - 1000, y: b.maxY - 1000 }, { x: b.minX + 1000, y: b.maxY - 1000 }]; } // the fixture lot has no setbacks loaded
  const fit = fitView(sc, 900, 600);
  const out = sceneInner(sc, fit, 900, 600);
  assert.ok(!/<image|data:image/.test(out), 'no bitmap');
  assert.match(out, /data-part="boundary"/);
  assert.match(out, /data-part="setback"/);
  assert.match(out, /data-part="house"/);
  assert.ok((out.match(/vector-effect="non-scaling-stroke"/g) || []).length >= 4);
  const z = zoomAt(fit, fit, 8, 450, 300, 900, 600);
  const size = (s) => Number(/font-size="([\d.]+)"/.exec(s)[1]) * (s === out ? fit.k : z.k);
  const outZ = sceneInner(sc, z, 900, 600);
  assert.ok(Math.abs(size(out) - size(outZ)) < 0.2, 'label size on screen is the same at 100 percent and at 800 percent');
  const svg = sceneSvg(sc, fit, 900, 600);
  assert.match(svg, /^<svg [^>]*role="img"/);
  assert.match(svg, /aria-label="[^"]*m²/);
  assert.ok(!/[\u2013\u2014]/.test(svg), 'no en or em dashes');
});

test('commercial SVG draws units, bays and their numbers when zoomed in, and drops numbers when too small to read', async () => {
  const sc = await commercialScene(commercialProject({ plain: false }));
  const fit = fitView(sc, 900, 600);
  const zoomed = zoomAt(fit, fit, 6, 450, 300, 900, 600);
  const outFit = sceneInner(sc, fit, 900, 600);
  const outZoom = sceneInner(sc, zoomed, 900, 600);
  assert.match(outFit, /data-part="unit"/);
  assert.match(outFit, /data-part="bay"/);
  const nums = (s) => (s.match(/font-weight="700"[^>]*>\d+</g) || []).length;
  assert.ok(nums(outZoom) > 0, 'unit numbers show when zoomed in');
});

test('wiring: both lot cards have an expand button on the mini map and open the top view from the map, the button and the menu', () => {
  const res = read('../src/lotcard/lot-card.js');
  const com = read('../src/commercial/lotcard.js');
  for (const src of [res, com]) {
    assert.match(src, /expandButton\(/, 'expand button');
    assert.match(src, /createTopView\(/);
    assert.match(src, /'Enlarge top view', \(\) => topView\.toggle\(\)/, 'menu item');
    assert.match(src, /Close top view/);
    assert.match(src, /class: 'lc-mini'[^}]*role: 'group'/, 'the mini is not a button, so the expand button is not nested in one');
    assert.match(src, /\.lc-mini-x/, 'a click on the expand button is not handled twice');
    assert.doesNotMatch(src, /is-big/, 'the old bitmap enlargement is gone');
  }
  assert.match(res, /if \(embed\) topView\.open\(\)/);
  assert.match(com, /topView\.open\(\)/);
  assert.match(res, /topView\.dispose\(\)/);
  assert.match(com, /topView\.dispose\(\)/);
});

test('accessibility and sizing: dialog role, modal, focus return, Escape, keyboard, live region; 70 to 80 percent, full screen on phones', () => {
  const src = read('../src/lotcard/topview.js');
  for (const want of ["role: 'dialog'", "'aria-modal': 'true'", "'aria-labelledby': 'tv-title'", "'aria-live': 'polite'", "e.key === 'Escape'", "e.key === 'Tab'", 'ArrowLeft', "e.key === '+'", "e.key === '0'", 'inert', 'back?.focus', "'aria-label': 'Enlarge top view'"]) assert.ok(src.includes(want), `missing ${want}`);
  assert.match(TOPVIEW_CSS, /width:76%;height:76%/);
  assert.match(TOPVIEW_CSS, /@media \(max-width:640px\)[^{]*\{\.tv-dlg\{[^}]*width:100%;height:100%/);
  assert.match(src, /wheel/);
  assert.match(src, /pointerdown/);
  assert.ok(!/[\u2013\u2014]/.test(src + TOPVIEW_CSS), 'no en or em dashes');
});
