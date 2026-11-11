// Interactive HTML export (restored from the live app): one self-contained offline file, plan and 3D model.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { catalogue } from '../src/catalogue/index.js';
import { buildExport, exportFilename, EXPORT_TYPES } from '../src/premium/exporters/index.js';
import { EXPORT_ITEMS } from '../src/premium/export-client.js';
import { VIEWER_JS } from '../src/premium/exporters/html-viewer.generated.js';

function house() {
  const p = createProject({ id: 'p_html0001', name: 'Smith <residence> & Co' });
  p.titleBlock.client = 'J Smith';
  p.titleBlock.address = '12 Example St, Tamworth';
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  applyOp(p, 'add_room', { type: 'bedroom', name: 'Bed 1', x: 6000, y: 0, width: 3500, depth: 4500 });
  return p;
}
const config = { disclaimer: 'Concept design only.', seller: { name: 'JCE Infrastructure Pty Ltd trading as Glide Inside', abn: '29 699 165 663' } };

test('html is a plan pack export type with a name and a label', () => {
  assert.ok(EXPORT_TYPES.html);
  assert.equal(exportFilename('html', house()), 'smith-residence-co.html');
  assert.ok(EXPORT_ITEMS.some((i) => i.type === 'html' && /Interactive HTML/.test(i.label)));
});

test('the interactive HTML is one file that works offline: no web address, no external resource, 3D model and viewer inside', async () => {
  const file = await buildExport('html', house(), { catalogue, config, date: new Date('2026-11-11T00:00:00Z') });
  assert.equal(file.mime, 'text/html; charset=utf-8');
  assert.equal(file.filename, 'smith-residence-co.html');
  const html = new TextDecoder().decode(file.bytes);
  assert.ok(html.startsWith('<!doctype html>'));

  // nothing fetched from anywhere: no http(s) text at all (not even XML namespaces), no external src/href/link/import/url()
  assert.deepEqual(html.match(/https?:\/\/[^\s"'<>)]*/g) || [], []);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.doesNotMatch(css, /@import|url\(/, 'no fonts or images fetched by the stylesheet');
  for (const m of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) assert.match(m[1], /^(data:|#)/, `external reference ${m[1]}`);
  assert.equal((html.match(/<html\b/g) || []).length, 1, 'a single document');

  // the plan: an SVG per level, rooms and areas, the escaped title, the disclaimer and the seller
  assert.match(html, /<svg class="pa-plan"[^>]*aria-label="Ground floor plan"/);
  assert.match(html, />Living<\/text>/);
  assert.match(html, />Bed 1<\/text>/);
  assert.match(html, /27\.00 m²/);
  assert.match(html, /<h1>Smith &lt;residence&gt; &amp; Co<\/h1>/);
  assert.match(html, /J Smith \| 12 Example St, Tamworth/);
  assert.match(html, /Concept design only\./);
  assert.match(html, /ABN 29 699 165 663/);
  assert.match(html, /<td>Living<\/td><td>Living<\/td><td class="n">27\.00 m²<\/td>/);

  // the 3D tab: viewer inlined, orbit controls, and the embedded model is a real GLB
  assert.match(html, /<button class="pa-tab" role="tab" data-tab="3d"/);
  assert.match(html, /id="pa-view" aria-label="Interactive 3D model"/);
  assert.ok(html.includes('window.PA3D'), 'the viewer is inlined');
  assert.match(VIEWER_JS, /OrbitControls|enableDamping/);
  assert.ok(html.length > VIEWER_JS.length, 'three.js is part of the file');
  const model = html.match(/<script id="pa-glb" type="text\/plain"(?: data-enc="([^"]*)")?>([^<]+)<\/script>/);
  assert.ok(model, 'the model is embedded');
  let bytes = Buffer.from(model[2], 'base64');
  if (model[1] === 'deflate-raw') bytes = zlib.inflateRawSync(bytes);
  assert.equal(bytes.subarray(0, 4).toString(), 'glTF');
  assert.ok(bytes.length > 2000);

  // no how-to panel over the view (owner preference); only the reset and roof buttons
  assert.doesNotMatch(html, /Drag to orbit|pa-hint/);
  assert.match(html, /id="pa-reset"/);
  assert.equal((html.match(/<\/script>/g) || []).length, 3, 'model data, viewer, tabs');
});

test('a design with two levels gets a plan and a room table for each, and the model can be left out for a plan only file', async () => {
  const p = house();
  applyOp(p, 'add_level', {});
  const file = await buildExport('html', p, { catalogue, config, model: false });
  const html = new TextDecoder().decode(file.bytes);
  assert.equal((html.match(/<svg class="pa-plan"/g) || []).length, 2);
  assert.ok(!html.includes('WebGLRenderer'), 'no viewer without a model');
  assert.ok(!html.includes('data-tab="3d"'));
  assert.deepEqual(html.match(/https?:\/\//g) || [], []);
});

test('the sample templates all export, with the model, within a sensible size', async () => {
  const { TEMPLATES, createFromTemplate } = await import('../src/catalogue/templates.js');
  for (const t of TEMPLATES.filter((x) => x.id !== 'blank').slice(0, 6)) {
    const file = await buildExport('html', createFromTemplate(t.id), { catalogue, config });
    const html = new TextDecoder().decode(file.bytes);
    assert.ok(html.includes('id="pa-glb"'), t.id);
    assert.deepEqual(html.match(/https?:\/\//g) || [], [], t.id);
    assert.ok(file.bytes.length < 4_000_000, `${t.id} ${file.bytes.length}`);
  }
});
