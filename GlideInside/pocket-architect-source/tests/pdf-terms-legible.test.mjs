// The plan set terms note is the legal stamp: at least 6 pt on A3, never overprinted by the trial line, on every PDF flavour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model/schema.js';
import { applyOp } from '../src/model/ops.js';
import { catalogue } from '../src/catalogue/index.js';
import { buildExport } from '../src/premium/exporters/index.js';
import { TRIAL_FOOTER } from '../src/premium/exporters/watermark.js';

const house = () => {
  const p = createProject({ id: 'p_tl001', name: 'Marsh residence' });
  applyOp(p, 'add_room', { type: 'living', name: 'Living', x: 0, y: 0, width: 6000, depth: 4500 });
  return p;
};
const terms = { version: '1.1', acceptedAt: '2026-11-15T01:00:00Z' };

async function items(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    out.push(tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.hypot(i.transform[2], i.transform[3]), w: i.width })));
  }
  return out;
}

for (const [name, opts] of [['engineering builder', {}], ['engineering trial', { watermark: true }], ['legacy builder', { style: 'legacy' }], ['legacy trial', { watermark: true, style: 'legacy' }]]) {
  test(`terms note is at least 6 pt and clear of the trial line: ${name}`, async () => {
    const jsPDF = (await import('jspdf')).jsPDF;
    const r = await buildExport('pdf', house(), { jsPDF, catalogue, config: {}, terms, ...opts });
    const pages = await items(r.bytes);
    for (const [pi, its] of pages.entries()) {
      const note = its.filter((i) => /CONCEPT ONLY|No third party|Inside, ABN|Issued under/.test(i.s) || /Plan set terms|terms of use v1\.1/.test(i.s));
      if (!note.length) continue;
      for (const t of note) assert.ok(t.h >= 5.9, `page ${pi + 1}: terms text ${t.h.toFixed(2)} pt`);
      const trial = its.find((i) => i.s.includes('Free trial export'));
      if (opts.watermark) assert.ok(trial, `page ${pi + 1}: trial line present`);
      if (trial) {
        const top = Math.max(...note.map((n) => n.y + n.h));
        assert.ok(trial.y > top, `page ${pi + 1}: trial line (y ${trial.y.toFixed(1)}) sits above the terms rows (top ${top.toFixed(1)})`);
      }
    }
    assert.ok(pages.some((its) => its.some((i) => /CONCEPT ONLY/.test(i.s))), 'terms note is printed');
  });
}
test('trial footer text unchanged', () => assert.match(TRIAL_FOOTER, /^Free trial export/));
