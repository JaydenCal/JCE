// Two tools, one address: Glide Inside Residential and Glide Inside Commercial (src/toolmode.js, src/ui/tool-switch.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { toolFromSearch, toolOfProject, resolveTool, otherToolUrl, projectHasWork, TOOL_INFO, toolName, toolMode } from '../src/toolmode.js';
import { switchOffer, openInTool } from '../src/ui/tool-switch.js';

const house = { levels: [{ rooms: [{ id: 'r' }], walls: [] }] };
const commercial = { mode: 'commercial', levels: [{ rooms: [], walls: [] }], commercial: { rows: [{ id: 'a' }] } };

test('?mode= picks the tool, anything else is no request', () => {
  assert.equal(toolFromSearch('?mode=residential'), 'residential');
  assert.equal(toolFromSearch('?mode=commercial&address=1+Main+St'), 'commercial');
  assert.equal(toolFromSearch('?mode=COMMERCIAL'), 'commercial');
  assert.equal(toolFromSearch('?mode=other'), null);
  assert.equal(toolFromSearch(''), null);
});

test('a project knows its tool', () => {
  assert.equal(toolOfProject(commercial), 'commercial');
  assert.equal(toolOfProject({ flow: { kind: 'commercial', step: 2 }, levels: [] }), 'commercial');
  assert.equal(toolOfProject(house), 'residential');
  assert.equal(toolOfProject(null), 'residential');
});

test('no ?mode= follows the saved project; a fresh start is residential', () => {
  assert.equal(resolveTool({ search: '', project: commercial, fromSaved: true }).tool, 'commercial');
  assert.equal(resolveTool({ search: '', project: house, fromSaved: true }).tool, 'residential');
  assert.equal(resolveTool({ search: '', project: null, fromSaved: false }).tool, 'residential');
});

test('an explicit request that disagrees with the saved design is a mismatch, never a silent switch', () => {
  const a = resolveTool({ search: '?mode=residential', project: commercial, fromSaved: true });
  assert.equal(a.tool, 'residential'); assert.equal(a.mismatch, true); assert.equal(a.projectTool, 'commercial');
  const b = resolveTool({ search: '?mode=commercial', project: house, fromSaved: true });
  assert.equal(b.tool, 'commercial'); assert.equal(b.mismatch, true);
  assert.equal(resolveTool({ search: '?mode=commercial', project: commercial, fromSaved: true }).mismatch, false);
  assert.equal(resolveTool({ search: '?mode=commercial', project: { levels: [{ rooms: [], walls: [] }] }, fromSaved: true }).mismatch, false, 'an empty design has nothing to protect');
  assert.equal(projectHasWork({ levels: [{ rooms: [], walls: [] }] }), false);
});

test('names, tab titles and prices differ by tool, with no dashes and no old product names', () => {
  assert.equal(TOOL_INFO.residential.name, 'Glide Inside Residential');
  assert.equal(TOOL_INFO.commercial.name, 'Glide Inside Commercial');
  assert.notEqual(TOOL_INFO.residential.tabTitle, TOOL_INFO.commercial.tabTitle);
  assert.equal(TOOL_INFO.residential.cta, 'AI design assistant');
  assert.match(TOOL_INFO.commercial.cta, /Commercial Developer subscription/);
  for (const t of Object.values(TOOL_INFO)) for (const v of [t.name, t.tabTitle, t.cta, t.ctaText]) {
    assert.ok(!/[–—]/.test(v), v);
    assert.ok(!/pocket architect|plan studio/i.test(v), v);
  }
  toolMode.current = 'commercial';
  assert.equal(toolName(), 'Glide Inside Commercial');
  toolMode.current = 'residential';
});

test('the address of the other tool keeps the app path and drops a share id', () => {
  assert.equal(otherToolUrl('commercial', { pathname: '/plan-studio/app/', search: '?mode=residential&share=abc&back=x' }), '/plan-studio/app/?mode=commercial&back=x');
});

test('opening a commercial design in the residential tool offers the switch, wording names the other tool', () => {
  const o = switchOffer(commercial, 'residential');
  assert.equal(o.mismatch, true); assert.equal(o.tool, 'commercial');
  assert.match(o.confirmLabel, /Glide Inside Commercial/);
  assert.equal(switchOffer(house, 'residential').mismatch, false);
});

test('openInTool leaves the design in the hand-off slot and navigates', () => {
  const mem = {}; const storage = { setItem: (k, v) => { mem[k] = v; } };
  let to = null; const loc = { pathname: '/plan-studio/app/', search: '?mode=residential&address=1+Main+St', assign: (u) => { to = u; } };
  assert.equal(openInTool(commercial, 'commercial', { loc, storage }), true);
  assert.ok(JSON.parse(mem['ps.handoff.v1']).project.commercial);
  assert.equal(to, '/plan-studio/app/?mode=commercial');
  assert.equal(openInTool(commercial, 'commercial', { loc, storage: { setItem() { throw new Error('full'); } } }), false);
});

test('the old product names are gone from the app, the portal screens, the prompts and the exporters', () => {
  const bad = /pocket architect|plan studio/i;
  const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; const s = statSync(p); if (s.isDirectory()) walk(p, out); else if (/\.(js|html|css)$/.test(f)) out.push(p); } return out; };
  const hits = [];
  for (const f of [...walk(new URL('../src', import.meta.url).pathname), new URL('../index.html', import.meta.url).pathname]) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => { if (bad.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) hits.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});
