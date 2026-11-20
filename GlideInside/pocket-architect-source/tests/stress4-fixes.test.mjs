// Fixes from the release 6 six hour stress test (20/11/2026): dialogs that fit the screen, phone Find your lot, the stale "Profile full" state,
// the save offer that never covers the step, 44 px phone targets, touch wording, the coach and the flow header, a one row top bar, pinch zoom, tip placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProfileController } from '../src/profile/controller.js';
import { ProfileError } from '../src/profile/api.js';
import { createStore } from '../src/model/store.js';
import { createProject } from '../src/model/schema.js';
import { HINT_TEXT } from '../src/ui/onboarding/anims.js';
import { HINT_TEXT_TOUCH, touchLine } from '../src/phone/touch-text.js';
import { phoneHint } from '../src/phone/hint.js';
import { clearSpot } from '../src/ui/onboarding/util.js';
import { nameMinFor } from '../src/ui/topbar-name.js';
import { SKIP, serve, launch, newPage, openApp, toStep, toEditor, dismiss } from './helpers/phone-harness.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BAD = /\b(click|clicks|hover|hold|press|scroll|shift|alt|ctrl|esc|comma|full stop|wheel)\b|\bQ\b/i;

test('1. dialogs: the scrim is fixed to the screen, the dialog is capped to the viewport, phones get a full height bottom sheet', () => {
  const css = read('styles.css');
  assert.match(css, /\.ps-scrim \{\s*position: fixed; inset: 0;/);
  assert.match(css, /max-height: min\(640px, calc\(100dvh - 32px\)\)/);
  assert.match(css, /\.ps-modal-body \{[^}]*overflow-y: auto; min-height: 0;/);
  assert.match(css, /\.ps-modal-head \{ flex: none;/);
  assert.match(css, /html\[data-phone="1"\] \.ps-scrim \{ align-items: flex-end; padding: 0; \}/);
  assert.match(css, /height: calc\(100dvh - 20px\)/);
});

test('2. phone Find your lot: the sample and upload buttons survive the hidden header links and an error offers a way on', () => {
  const css = read('src/phone/css.js');
  assert.match(css, /\.gf-skip\.gf-alt\{display:flex;[^}]*min-height:44px/);
  const src = read('src/flow/lot-step.js');
  assert.match(src, /Keep drawing without a lot/);
  assert.match(src, /dataset: \{ ps: 'flow-fail-sample' \}/);
  assert.match(src, /failActions\.hidden = !\(error && !loading\)/);
  assert.match(read('src/flow/guided.js'), /skip: \(\) => skipToEditor\(\)/);
});

test('3. a full profile clears its limit state as soon as a design is deleted, so Save retries', async () => {
  const designs = [{ id: 'a' }, { id: 'b' }];
  const api = {
    me: async () => ({ profile: { id: 'u', designLimit: 2 }, limits: { designs: 2 } }),
    saveDesign: async () => { throw new ProfileError('DESIGN_LIMIT_REACHED', 'full'); },
    deleteDesign: async (id) => { designs.splice(designs.findIndex((d) => d.id === id), 1); },
    listDesigns: async () => ({ designs: [...designs], limit: 2 }),
  };
  const store = createStore(createProject({ name: 'x' }));
  store.run('add_room', { type: 'bedroom', name: 'Bed', x: 0, y: 0, width: 3000, depth: 3000 });
  const c = createProfileController({ api, store, setTimer: () => 0, clearTimer: () => {} });
  await c.init();
  await c.saveNow();
  assert.equal(c.state.saveState, 'limit');
  await c.listDesigns(); // still full: stays
  assert.equal(c.state.saveState, 'limit');
  await c.removeDesign('a');
  assert.equal(c.state.saveState, 'unsaved', 'delete clears the limit state');
  // Fewer than the limit seen by a plain list (a design deleted in another tab) clears it too.
  c.state.saveState = 'limit';
  designs.pop();
  await c.listDesigns();
  assert.notEqual(c.state.saveState, 'limit');
  assert.match(read('src/profile/ui.js'), /await controller\.listDesigns\(\); \} catch/);
});

test('4. the save offer is an inline card in the guided flow, never fixed over the step', () => {
  const s = read('src/profile/ui.js');
  assert.match(s, /\.gf-root>\.ps-prof-prompt\{position:relative;/);
  assert.match(s, /flowFoot\.before\(prompt\)/);
  assert.ok(!/\.gf-open \.ps-prof-prompt\{position:fixed/.test(s));
  assert.ok(!/gf-open \.ps-prof-prompt/.test(read('src/phone/css.js')));
});

test('5. phone tap targets are 44 px in the css', () => {
  const css = read('src/phone/css.js');
  for (const re of [/\.gf-prog li button\{min-width:44px;min-height:44px/, /\.fitc-x\{width:44px;height:44px/, /\.pso-btn\{min-height:44px/, /\.gf-backpill\{min-height:44px!important/, /\.ps-rot-btn\{min-height:44px/, /\.lc-tab[^{]*\{height:44px/, /\.ps-prof-prompt \.ps-btn/, /\.ps-btn,html\[data-phone="1"\] \.ps-btn--sm[^{]*\{min-height:44px;min-width:44px/]) assert.match(css, re);
  const fw = read('../website-live/framework.css');
  assert.match(fw, /\.nav-toggle\{min-height:44px;min-width:44px\}/);
  assert.match(fw, /\.site-header \.logo\{display:inline-flex;align-items:center;min-height:44px/);
});

test('6. touch wording: no click, keys or Q wheel in the phone tool tips, panel help or tour', () => {
  for (const id of Object.keys(HINT_TEXT)) {
    assert.ok(HINT_TEXT_TOUCH[id], `${id} has a touch tip`);
    assert.ok(!BAD.test(HINT_TEXT_TOUCH[id]), `${id}: ${HINT_TEXT_TOUCH[id]}`);
  }
  assert.match(HINT_TEXT_TOUCH.select, /^Tap a piece/);
  for (const t of ['Choose the Window tool, hover a wall and click to place it.', 'Choose Walk at the top, then use W, A, S and D to move. Hold E near a door to open it.', 'Press Q over the plan to open the wheel of items already in your design, then pick one.', 'Choose 3D at the top. Drag to orbit and scroll to zoom.', 'Click a wall in the 3D view, then pick a new finish.', 'The Road or pavement tool (L) draws driveways. Click each PI, then double click to finish.']) {
    assert.ok(!BAD.test(touchLine(t)), touchLine(t));
  }
  assert.ok(!BAD.test(phoneHint('Choose an item from the furniture drawer, or hold Q for the inventory wheel, then click the plan to place it.', 'furniture')));
  const p = read('src/ui/panel-tool.js');
  assert.match(p, /Twist with two fingers to turn it, or use the on-screen rotate buttons/);
  assert.match(p, /Tap the plan to place\. Keep tapping to place more/);
  assert.match(read('src/ui/onboarding/hints.js'), /HINT_TEXT_TOUCH\[id\]/);
});

test('7. the coach keeps clear of the flow header buttons', () => {
  assert.match(read('src/tutorial/coach.js'), /const AVOID_FLOW = '[^']*\.gf-head'/);
});

test('8. top bar: lower priority buttons collapse into More before the bar wraps; the name keeps 180 px from 1280', () => {
  assert.equal(nameMinFor(1279), 100);
  assert.equal(nameMinFor(1280), 180);
  assert.equal(nameMinFor(1536), 180);
  const t = read('src/ui/topbar.js');
  assert.match(t, /collapse: \['\.ps-tut-q', roofBtn, siteBtn, statusSeg, '\.psp-bar-slot', fileGroup\]/);
  assert.match(read('src/ui/topbar-more.js'), /function fit\(size\)/);
});

test('9. pinch zoom: the editor shell and the 3D overlays take no page pinch on a phone', () => {
  const css = read('src/phone/css.js');
  assert.match(css, /\.ps-shell\[data-phone-ui\]\{touch-action:pan-x pan-y\}/);
  for (const sel of ['.lc-root>*', '.ps-credit', '.ps3d-roombar']) assert.ok(css.includes(sel), sel);
  assert.match(read('index.html'), /name="viewport" content="width=device-width, initial-scale=1/);
});

test('10. tip placement: clearSpot slides a card clear of the lot card', () => {
  const lot = { left: 120, top: 277, right: 560, bottom: 670 };
  const top = { left: 0, top: 0, right: 1536, bottom: 68 };
  const s = clearSpot({ x: 75, y: 40, w: 252, h: 122 }, { vw: 1536, vh: 730, avoid: [lot, top] });
  assert.ok(s && s.y >= 68 && s.y + 122 <= 277, JSON.stringify(s));
  assert.equal(clearSpot({ x: 75, y: 40, w: 252, h: 262 }, { vw: 1536, vh: 730, avoid: [lot, top] }), null, 'too tall for the gap: caller drops the animation');
  const h = read('src/ui/onboarding/hints.js');
  assert.match(h, /pso-hint--compact/);
  assert.match(h, /\.lc-root:not\(\[hidden\]\) \.lc-card/);
});

