// Builder colour scheme: hex validation, AA contrast derivation, CSS variable mapping, logo colour picking, the additive
// migration and the mock API round trip. The server round trip (memory and D1) is in portal-server.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normaliseHex, validateColours, contrast, luminance, ensureContrast, buttonColours, inkFor, deriveTheme, themeVars, dominantColours, hasBrand, GI_DEFAULT, AA } from '../src/portal/theme.js';
import { themeCss } from '../src/portal/theme-css.js';
import { createMockApi, memoryStorage, DEMO_LOGINS } from '../src/portal/mock-api.js';

test('hex validation: 3 and 6 digit hex with or without #, lower cased; everything else refused', () => {
  assert.equal(normaliseHex('#1F6F4A'), '#1f6f4a');
  assert.equal(normaliseHex('1f6f4a'), '#1f6f4a');
  assert.equal(normaliseHex('#fa0'), '#ffaa00');
  for (const bad of ['', '#12', '#12345', '#1234567', 'red', 'rgb(1,2,3)', '#gggggg', null, undefined, 42, '#1f6f4a;}body{display:none']) assert.equal(normaliseHex(bad), null, String(bad));
  const ok = validateColours({ primary: '#1F4D3A', accent: 'd9822b', darkInk: '', darkBg: null });
  assert.deepEqual(ok, { ok: true, colours: { primary: '#1f4d3a', accent: '#d9822b', darkInk: null, darkBg: null }, errors: {} });
  const bad = validateColours({ primary: 'green', accent: '#12' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.primary, /hex colour/);
  assert.ok(bad.errors.accent);
  assert.equal(validateColours({ accent: '#d9822b' }).ok, false, 'an accent alone needs a primary');
  assert.equal(validateColours({}).ok, true, 'nothing chosen is the Glide Inside look');
  assert.deepEqual(validateColours({ primary: '#fff' }, { partial: true }).colours, { primary: '#ffffff' });
});

test('contrast maths matches WCAG reference values', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.02);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(inkFor('#1f4d3a'), '#ffffff');
  assert.equal(inkFor('#f5d000'), '#101418');
});

test('failing colours get a derived variant that reaches AA; passing colours are left alone', () => {
  const light = ensureContrast('#f2b705', '#f1f2f4');
  assert.equal(light.changed, true);
  assert.ok(contrast(light.colour, '#f1f2f4') >= AA);
  assert.equal(ensureContrast('#1f4d3a', '#f1f2f4').changed, false);
  const dark = ensureContrast('#1f4d3a', '#0f2037');
  assert.ok(contrast(dark.colour, '#0f2037') >= AA, 'on a dark surface the colour is lightened');
  for (const fill of ['#f28c28', '#d9822b', '#888888', '#00a0ff', '#ffee00', '#1f4d3a', '#0a1f44', '#e91e63', '#7fff00']) {
    const b = buttonColours(fill);
    assert.ok(contrast(b.fill, b.ink) >= AA, `${fill} button ${b.fill} on ${b.ink}`);
  }
  assert.equal(buttonColours('#1f4d3a').changed, false);
});

test('deriveTheme: every text pairing reaches AA for a spread of brand colours', () => {
  for (const [primary, accent] of [['#1f4d3a', '#d9822b'], ['#0a1f44', '#f28c28'], ['#ffee00', '#ffee00'], ['#e91e63', null], ['#888888', '#999999'], ['#ffffff', '#cccccc'], ['#000000', '#00ff88']]) {
    const t = deriveTheme({ primary, accent, darkBg: '#101820', darkInk: '#bbbbbb' });
    assert.ok(contrast(t.primary, t.primaryInk) >= AA, `${primary} bar text`);
    assert.ok(contrast(t.button, t.buttonInk) >= AA, `${primary}/${accent} button`);
    assert.ok(contrast(t.link, '#f1f2f4') >= AA && contrast(t.link, '#ffffff') >= AA, `${primary}/${accent} link on light`);
    assert.ok(contrast(t.dark.accent, '#1a2a3a') >= AA - 0.6 || contrast(t.dark.accent, t.dark.panel) >= AA, `${primary} dark accent`);
    assert.ok(contrast(t.dark.text, t.dark.panel) >= AA, 'dark text');
  }
  assert.equal(deriveTheme(null), null);
  assert.equal(deriveTheme({ primary: null, accent: '#ff0000' }), null);
  assert.equal(deriveTheme({ primary: '#1f4d3a' }).accent, '#1f4d3a', 'accent defaults to primary');
  assert.ok(deriveTheme({ primary: '#ffee00' }).adjusted.length > 0, 'the settings page can say a shade was adjusted');
});

test('CSS variable mapping: the existing portal and app tokens receive the brand colours', () => {
  const t = deriveTheme({ primary: '#0a1f44', accent: '#f28c28' });
  const v = themeVars(t);
  assert.deepEqual(Object.keys(v.portal).sort(), ['--accent', '--accent-hover', '--accent-soft', '--deep', '--deep-2']);
  assert.equal(v.portal['--deep'], '#0a1f44');
  assert.deepEqual(Object.keys(v.app).sort(), ['--ps-accent', '--ps-accent-ink', '--ps-accent-soft', '--ps-focus']);
  assert.equal(v.app['--ps-accent-ink'], t.buttonInk);
  assert.ok(!Object.keys({ ...v.portal, ...v.app, ...v.appDark, ...v.brand }).some((k) => /ok|warning|danger|wall|ghost|room|ink$/.test(k) && !/accent-ink|primary-ink|button-ink/.test(k)), 'status, wall and ghost colours are not touched');
  assert.deepEqual(themeVars(null), { portal: {}, app: {}, appDark: {}, brand: {} });
  const css = themeCss({ primary: '#0a1f44', accent: '#f28c28' });
  assert.match(css, /:root\[data-brand-theme\]\{[^}]*--ps-accent:/);
  assert.match(css, /:root\[data-brand-theme\]\[data-theme="dark"\]/);
  assert.match(css, /\.pp-btn--primary/);
  assert.match(css, /\.pas-strip/);
  assert.equal(themeCss({ primary: null }), '');
  assert.doesNotMatch(css, /canvas|\.ps-plan|setback|three/i, 'the 3D scene, plan canvas and setback states are not recoloured');
  assert.ok(hasBrand({ primary: '#fff' }) && !hasBrand(null) && !hasBrand({ primary: 'x' }));
  assert.equal(GI_DEFAULT.primary, '#12231c');
});

test('dominant colours from logo pixels ignore white, black, grey and transparent', () => {
  const px = [];
  const add = (r, g, b, a, n) => { for (let i = 0; i < n; i++) px.push(r, g, b, a); };
  add(255, 255, 255, 255, 500); add(10, 10, 10, 255, 200); add(128, 128, 128, 255, 200); add(0, 0, 0, 0, 300);
  add(31, 77, 58, 255, 300); add(217, 130, 43, 255, 120); add(34, 80, 60, 255, 100);
  const found = dominantColours(new Uint8ClampedArray(px), 3);
  assert.equal(found.length, 2, 'two distinct hues; the near duplicate green merges');
  assert.ok(contrast(found[0], '#1f4d3a') < 1.2, 'most common first');
  assert.deepEqual(dominantColours(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])), []);
});

test('migration 0010 is additive: only nullable ADD COLUMN on orgs, and schema.sql matches', () => {
  const sql = fs.readFileSync(new URL('../server/migrations/0010_org_brand_colours.sql', import.meta.url), 'utf8');
  const stmts = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
  assert.equal(stmts.length, 4);
  for (const s of stmts) assert.match(s, /^ALTER TABLE orgs ADD COLUMN brand_(primary|accent|dark_ink|dark_bg) TEXT;$/, 'nullable TEXT, no default, no NOT NULL');
  assert.doesNotMatch(sql, /DROP|UPDATE|DELETE|RENAME|NOT NULL/i);
  const schema = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
  for (const c of ['brand_primary', 'brand_accent', 'brand_dark_ink', 'brand_dark_bg']) assert.ok(schema.includes(c), c);
  const dir = new URL('../server/migrations/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((x) => /^000[1-9]/.test(x))) assert.doesNotMatch(fs.readFileSync(new URL(f, dir), 'utf8'), /brand_primary/, `${f} untouched`);
});

test('mock API: builder colours round trip, validate, clear and show in the session payload', async () => {
  const api = createMockApi({ storage: memoryStorage(), now: () => Date.UTC(2026, 10, 11, 1) });
  await api.signIn(DEMO_LOGINS.admin);
  let me = await api.me();
  assert.deepEqual(me.org.branding.colours, { primary: '#1f4d3a', accent: '#d9822b', darkInk: null, darkBg: null }, 'sample colours for the review build');
  const saved = await api.setBranding({ displayName: 'Sample Homes', colours: { primary: '#0A1F44', accent: '#F28C28' } });
  assert.deepEqual(saved.colours, { primary: '#0a1f44', accent: '#f28c28', darkInk: null, darkBg: null });
  me = await api.me();
  assert.equal(me.org.branding.colours.primary, '#0a1f44');
  await assert.rejects(() => api.setBranding({ displayName: 'Sample Homes', colours: { primary: 'blue' } }), /hex colour/);
  assert.equal((await api.setBranding({ displayName: 'Sample Homes' })).colours.primary, '#0a1f44', 'colours kept when not sent');
  assert.equal((await api.setBranding({ displayName: 'Sample Homes', colours: null })).colours, null, 'reset to the Glide Inside look');
});
