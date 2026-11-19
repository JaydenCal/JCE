// Fixes from the 20/11/2026 stress test of Glide Inside (release 6g): coach start step, commercial legend placement, two column toolbox,
// the flow 3D note, builder default site costs, security nits, SEO tags, the siting summary menu item, the top bar name and the large site pill.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { legendPlacement, legendHeight, LEGEND_W, LEGEND_MIN_W } from '../src/editor2d/draw-overlays.js';
import { nameBoxWidth, NAME_MIN_PX, NAME_MAX_PX } from '../src/ui/topbar-name.js';
import { createWatchdog, isColdBuild, detailNoteText, LARGE_SITE_M2 } from '../src/viewer3d/watchdog.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('1. coach: begin() keeps the step the first paint moved to, so ?sample=1 does not reopen on "Type your address"', () => {
  const s = read('src/tutorial/coach.js');
  assert.ok(!/paint\(\); go\(0\);/.test(s), 'begin no longer resets to step 0 after paint()');
  assert.match(s, /else \{ paint\(\); go\(i\); \}/);
  assert.match(s, /skippedAddress = true;/, 'the one time skip is still there');
  assert.match(s, /kind = k; skippedAddress = false;/, 'and it is re-armed on each start, so Back still reaches the address step');
  // The skip moves i to the first flow step 1 step that is not the address step.
  assert.match(s, /steps\.findIndex\(\(x, n\) => n > i && x\.where === 'flow' && x\.flowStep === 1\)/);
});

test('2. commercial legend: it keeps clear of the layout panel, narrower if it must, and is unchanged with no panel', () => {
  const size = { w: 510, h: 784 }, h = legendHeight(3, 2);
  const panel = { minX: 12, maxX: 330, minY: 12, maxY: 700 };
  assert.deepEqual(legendPlacement(size, null, h), { x: 510 - LEGEND_W - 14, y: 168 }, 'no panel: as before');
  const p = legendPlacement(size, null, h, LEGEND_W, { avoid: [panel] });
  assert.ok(p.x >= panel.maxX + 8, `legend x ${p.x} starts right of the panel (${panel.maxX})`);
  assert.ok(p.y >= 168, 'never up at the north point');
  assert.ok(p.w >= LEGEND_MIN_W && p.x + p.w <= size.w - 14 + 1, 'narrowed to the strip, inside the canvas');
  // Plenty of room: the full width spot is used.
  const wide = legendPlacement({ w: 1000, h: 784 }, null, h, LEGEND_W, { avoid: [panel] });
  assert.equal(wide.x, 1000 - LEGEND_W - 14); assert.equal(wide.w, undefined);
  const src = read('src/editor2d/draw-overlays.js');
  assert.match(src, /\.cm-dock:not\(\[hidden\]\)/, 'the commercial dock is measured');
  assert.match(read('src/editor2d/editor.js'), /avoidBoxes: floatingPanelBoxes\(canvas\)/);
  assert.match(src, /const w = at\.w \|\| LEGEND_W;/);
});

test('3. toolbox: a single column that does not fit switches to the two column layout (data-tools2), same rules as the short window layout', () => {
  const css = read('styles.css');
  assert.match(css, /\.ps-shell\[data-tools2\]:not\(\[data-view="3d"\]\):not\(\[data-view="walk"\]\) \.ps-main \{ grid-template-columns: 92px minmax\(0, 1fr\) 328px; \}/);
  assert.match(css, /\.ps-shell\[data-tools2\] \.ps-toolbox \{ flex-direction: row; flex-wrap: wrap;/);
  assert.match(css, /\.ps-shell\[data-tools2\] \.ps-tool \{ width: 36px; height: 36px; \}/);
  const js = read('src/ui/toolbox.js');
  assert.match(js, /el\.scrollHeight > el\.clientHeight \+ 1/);
  assert.match(js, /setAttribute\('data-tools2', ''\)/);
  assert.match(js, /new ResizeObserver\(queueFit\)/);
});

test('4. check step 3D: the "Drag to orbit" note is not stretched over the scene (it was a full height dark pill)', () => {
  const css = read('src/flow/css.js');
  assert.match(css, /\.gf-3d>div:not\(\.gf-note\)\{position:absolute;inset:0\}/, 'the stretch rule skips the note');
  const js = read('src/flow/preview3d.js');
  assert.match(js, /left: '10px', bottom: '6px', top: 'auto', right: 'auto'/, 'and the note sets its own edges');
  assert.ok(!/__flowV/.test(js), 'no debug hook');
});

test('5. site costs: Reset only clears this design, never the builder default (the server call is clear(), reached only from Remove then Remove it)', () => {
  const s = read('src/premium/site-costs/panel.js');
  const reset = /dataset: \{ action: 'reset' \}, onclick: \(\) => \{([^}]*)\}/.exec(s)[1];
  assert.ok(!/siteCostDefaults/.test(reset), 'Reset never touches the builder default');
  const clears = s.match(/siteCostDefaults\.clear\(\)/g) || [];
  assert.equal(clears.length, 1, 'clear() is only called from the confirmed removal');
  assert.match(s, /action: 'remove-builder-yes'[^\n]*siteCostDefaults\.clear\(\)/);
});

test('6c. the widget never mounts the "Open full editor" link, not even hidden', () => {
  const e = read('src/ui/embed-viewer.js');
  assert.match(e, /export function mountViewerChrome\(stage, store, \{ widget = false \} = \{\}\) \{[\s\S]*?if \(widget \|\| inFrame\(\)\) return/);
  assert.match(read('src/app.js'), /mountViewerChrome\(refs\.stage, store, \{ widget: WIDGET \}\)/);
});

test('7. SEO: the app page has noindex and a canonical from the build template; the old portal copy is a noindex redirect with its own title', () => {
  const b = read('tools/build-single.mjs');
  assert.match(b, /<meta name="robots" content="noindex">/);
  assert.match(b, /<link rel="canonical" href="https:\/\/glideinside\.com\.au\/plan-studio\/app\/">/);
  const built = read('../website-live/plan-studio/app/index.html');
  assert.match(built, /<meta name="robots" content="noindex">/);
  assert.match(built, /<link rel="canonical" href="https:\/\/glideinside\.com\.au\/plan-studio\/app\/">/);
  const p = read('../website-live/plan-studio/portal/index.html');
  assert.match(p, /<meta name="robots" content="noindex">/);
  assert.match(p, /<link rel="canonical" href="https:\/\/glideinside\.com\.au\/portal\/">/);
  assert.ok(!/<title>Portal \| Glide Inside<\/title>/.test(p), 'not the same title as /portal/');
});

test('8. the export menu has the one page siting summary next to the siting report (residential only)', () => {
  const s = read('src/premium/ui/topbar.js');
  assert.match(s, /dataset: \{ type: 'siting-summary' \}, onclick: \(\) => \{ closeMenu\(false\); actions\.sitingSummary\(\); \}/);
  assert.ok(s.indexOf("type: 'siting-report'") < s.indexOf("type: 'siting-summary'") && s.indexOf("type: 'siting-summary'") < s.indexOf("type: 'site-costs'"), 'between the report and site costs');
  assert.match(s, /actions\.sitingSummary && !st\.commercial/, 'the summary layout exists for residential designs only');
  assert.match(s, /One page siting summary/);
  assert.ok(!/[–—]/.test(s));
  const p = read('src/premium/premium.js');
  assert.match(p, /sitingSummary: \(o\) => exportSitingReport\(\{ \.\.\.\(o \|\| \{\}\), layout: 'summary' \}\),\n        siteCosts/);
});

test('9. top bar name: sized to the text between 100 and 260 px, the full name as the tooltip', () => {
  assert.equal(nameBoxWidth(0), NAME_MIN_PX);
  assert.equal(nameBoxWidth(40), NAME_MIN_PX, 'a short name keeps the minimum');
  const w = nameBoxWidth(150);
  assert.ok(w > 150 && w <= NAME_MAX_PX, `150 px of text gets ${w}`);
  assert.equal(nameBoxWidth(900), NAME_MAX_PX, 'a long name is capped');
  assert.equal(nameBoxWidth(NaN), NAME_MIN_PX);
  const t = read('src/ui/topbar.js');
  assert.match(t, /nameInput\.title = nameInput\.value;/);
  assert.match(t, /fitNameBox\(nameInput, el\)/);
});

test('10. "Large site, simplifying view": the first build is never judged, and only a really large lot is called large', () => {
  assert.equal(isColdBuild(1), true, 'the first build of a session carries one off costs');
  assert.equal(isColdBuild(2), false);
  assert.equal(detailNoteText(1080), 'Simplifying the 3D view to keep it smooth', 'a 1,080 m2 lot is not a large site');
  assert.equal(detailNoteText(undefined), 'Simplifying the 3D view to keep it smooth');
  assert.equal(detailNoteText(LARGE_SITE_M2), 'Large site, simplifying view');
  assert.equal(detailNoteText(60000), 'Large site, simplifying view');
  const v = read('src/viewer3d/viewer.js');
  assert.match(v, /isColdBuild\(stats\.builds\) \? null : watchdog\.record\(stats\.buildMs, detail\)/);
  assert.match(v, /detailNote\.textContent = detailNoteText\(store\.project\.site\?\.lot\?\.areaM2\)/);
  // A slow later build still degrades as before.
  const wd = createWatchdog(2000);
  assert.equal(wd.record(5000, 'full'), 'degrade');
});

