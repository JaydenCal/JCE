// Roof off for commercial catalogue buildings, the large Roof off / Roof on button, Split and 3D without the floating stats strip, Walk with a placement session open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emit3d } from '../src/commercial/catalogue/types/_kitB.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('roof off drops canopies and skylights from a building type 3D props, roof on keeps them', () => {
  const plan = { props: [
    { shape: 'box', slot: 'canopy', x0: 0, x1: 1000, y0: 0, y1: 1000, z0: 4000, z1: 4250 },
    { shape: 'box', slot: 'skylight', x0: 0, x1: 100, y0: 0, y1: 100, z0: 6000, z1: 6100 },
    { shape: 'box', slot: 'steel', x0: 0, x1: 100, y0: 0, y1: 100, z0: 0, z1: 4000 },
  ] };
  assert.equal(emit3d(plan, {}).items.length, 3);
  assert.equal(emit3d(plan, { showRoof: true }).items.length, 3);
  assert.deepEqual(emit3d(plan, { showRoof: false }).items.map((p) => p.slot), ['steel']);
});

test('the roof switch reaches the catalogue builder, extras and type props', () => {
  const b = read('../src/viewer3d/build.js');
  assert.match(b, /addCatalogue3D\(ctx, root, project, \{ showRoof, detail \}\)/);
  const t = read('../src/commercial/catalogue/three.js');
  assert.match(t, /export function addCatalogue3D\(ctx, root, project, \{ showRoof = true \} = \{\}\)/);
  assert.match(t, /if \(showRoof\) for \(const \{ roof, baseMm \} of resolveRoofs/);
  assert.match(t, /showRoof && Number\.isFinite\(e\.heightMm\)/);
  assert.match(t, /\{ \.\.\.c3, project, showRoof \}/);
  assert.match(read('../src/commercial/catalogue/types/_kit.js'), /ctx\.showRoof === false/);
});

test('large Roof off / Roof on button on the 3D views: 44 px, labelled, pressed state, with the view buttons', () => {
  const v = read('../src/viewer3d/viewer.js');
  assert.match(v, /mkBtn\('Roof off', 'roof'/);
  assert.match(v, /'Roof on' : 'Roof off'/);
  assert.match(v, /setAttribute\('aria-pressed', String\(hidden\)\)/);
  assert.match(v, /viewBar\.append\(vbHero, vbFront, vbAerial, vbBuilding, vbDev, vbSun, vbRoof\)/);
  assert.match(v, /'showRoof' in patch\) syncRoofBtn\(\)/);
  assert.match(read('../src/viewer3d/viewer-css.js'), /\.ps3d-chip--roof\{[^}]*min-height:44px/);
});

test('Split, 3D and Walk keep the stats strip and tips off the view; Walk suspends the placement overlay', () => {
  const css = read('../styles.css');
  assert.match(css, /\[data-view="3d"\], \[data-view="split"\], \[data-view="walk"\]\) \.cm-strip \{ display: none; \}/);
  assert.match(css, /\[data-view="split"\], \[data-view="walk"\]\) \.ps-hintbar \{ display: none; \}/);
  assert.match(css, /data-view="split"\] \.pso-dock/);
  assert.match(css, /data-view="walk"\] \.pas-catch, \.ps-shell\[data-view="walk"\] \.pas-pose \{ display: none !important; \}/);
  // Walk already falls back to drag to look when the pointer lock is refused
  const w = read('../src/viewer3d/walk.js');
  assert.match(w, /Drag to look around/);
  assert.match(w, /pointerlockerror/);
});
