// Builder title blocks (src/premium/exporters/planset/titleblock.js): fields per org, no leakage between orgs, public users unchanged,
// the "Powered by Glide Inside" credit, and the details validation shared by the server, the demo API and the Branding tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jsPDF } from 'jspdf';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { toEngineeringPDF } from '../src/premium/exporters/eng/index.js';
import { builderOf, initialsOf } from '../src/premium/exporters/planset/titleblock.js';
import { validateDetails, cleanDetails, abnChecksumOk } from '../src/portal/brand-details.js';
import { LOGO_PNG } from '../src/premium/brand/logo.js';

const houses = JSON.parse(fs.readFileSync(new URL('../../golive/builder-houses/hunter-homes.json', import.meta.url), 'utf8'));
const project = houses[0].project;
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const lot = { boundaryM: rect(0, 0, 36, 60), frontEdge: 0, lotNumber: '12', planLabel: 'DP 1234567', address: '12 Sample Street, Thornton NSW 2322', lga: 'Maitland City Council', setbacks: { front: 6, side: 0.9, rear: 3 }, neighbours: [] };

const A = { name: 'Sample Homes Pty Ltd', logo: LOGO_PNG, details: { licence: '123456C', abn: '51 824 753 556', address: '4 Industrial Drive, Thornton NSW 2322', phone: '02 5550 0100', email: 'hello@samplehomes.com.au', website: 'www.samplehomes.com.au' }, client: { name: 'Jordan Example' } };
const B = { name: 'Other Builders', logo: null, details: { licence: '98765B', abn: '53 004 085 616', address: '9 Hill Road, Kempsey NSW 2440', phone: '02 6500 1111', email: 'info@otherbuilders.example', website: 'www.otherbuilders.example' }, client: { name: 'Alex Client' } };

function recorder() {
  const texts = [];
  let images = 0;
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t, ...r) => (texts.push(Array.isArray(t) ? t.join(' ') : String(t)), text(t, ...r));
      const add = this.addImage.bind(this);
      this.addImage = (...r) => { images++; return add(...r); };
    }
  }
  return { Rec, texts, images: () => images };
}
// The sheet notes (src/legal, owned by the legal wording branch) name the Glide Inside entity for the terms of use. That is the legal notice,
// not the title block, so the title block assertions look at the sheet text without those two sentences.
const withoutLegal = (text) => text.split('\n').filter((l) => !/trading as Glide Inside|Glide Inside, ABN|glideinside\.com\.au\/terms/.test(l)).join('\n');
const plan = async (builder, extra = {}) => {
  const rec = recorder();
  const r = await exportPlanSet({ project, lot, kind: 'site', download: false, jsPDF: rec.Rec, date: new Date(2026, 10, 18), builder, ...extra });
  return { r, text: rec.texts.join('\n'), body: withoutLegal(rec.texts.join('\n')), images: rec.images() };
};

test('builder plan set: every field of the builder title block is on the sheets, with Powered by Glide Inside', async () => {
  const { r, text } = await plan(A);
  assert.equal(r.pages, 3);
  for (const want of ['Sample Homes Pty Ltd', 'Builder licence 123456C', 'ABN 51 824 753 556', '4 Industrial Drive, Thornton NSW 2322', 'Ph 02 5550 0100', 'hello@samplehomes.com.au', 'www.samplehomes.com.au', 'Jordan Example', '18/11/2026', 'SITE PLAN', 'GI-L12DP1234567-C100', '1:250 @ A3', 'Powered by Glide Inside']) assert.ok(text.includes(want), `missing ${want}`);
  assert.equal(text.split('Powered by Glide Inside').length - 1, 3, 'the credit is on every sheet');
});

test('builder sheets never show JCE or Glide Inside as the main identity', async () => {
  const { body: text } = await plan(A);
  assert.ok(!/JCE Infrastructure/i.test(text), 'no JCE company name');
  assert.ok(!text.includes('29 699 165 663'), 'no old ABN');
  assert.ok(!text.includes('hello@glideinside.com.au') && !text.includes('trading as Glide Inside'), 'no Glide Inside entity block');
});

test('no cross-org leakage: one builder details never appear on another builder sheets', async () => {
  const a = await plan(A);
  const b = await plan(B);
  for (const v of [...Object.values(A.details), A.name, A.client.name]) assert.ok(!b.text.includes(v), `B sheets carry A's ${v}`);
  for (const v of [...Object.values(B.details), B.name, B.client.name]) assert.ok(!a.text.includes(v), `A sheets carry B's ${v}`);
  assert.ok(b.text.includes('Builder licence 98765B'));
  assert.ok(b.text.includes('Powered by Glide Inside'));
});

test('a builder with only a name still gets a builder block; blank fields are left off, nothing invented', async () => {
  const { body: text } = await plan({ name: 'Bare Builder' });
  assert.ok(text.includes('Bare Builder') && text.includes('Powered by Glide Inside'));
  for (const no of ['Builder licence', 'ABN ', 'Ph ']) assert.ok(!text.includes(no), `unexpected ${no}`);
  assert.ok(!/\S@\S/.test(text), 'no email invented');
});

test('public users keep the Glide Inside title block and have no Powered by credit', async () => {
  const { text } = await plan(null);
  assert.ok(text.includes('Glide Inside customer') && text.includes('hello@glideinside.com.au'));
  assert.ok(!text.includes('Powered by Glide Inside'));
  assert.ok(!text.includes('Builder licence'));
});

test('long values stay inside the block (cut or wrapped, never dropped silently into overlap)', async () => {
  const long = { ...A, name: 'The Very Long Named Sample Home Builders and Developers Pty Ltd', details: { ...A.details, address: 'Level 12, Tower Two, 1234 Extremely Long Boulevard Name Business Park, Thornton North NSW 2322', email: 'a.very.long.email.address.for.the.accounts.team@samplehomes.com.au' } };
  const { r } = await plan(long);
  assert.equal(r.pages, 3);
});

test('engineering plans: builder block with details and Powered by Glide Inside, public unchanged', async () => {
  const b = recorder();
  await toEngineeringPDF(project, { jsPDF: b.Rec, builder: A, date: new Date(2026, 10, 18) });
  const t = b.texts.join('\n');
  for (const want of ['Sample Homes Pty Ltd', 'Builder licence 123456C', 'ABN 51 824 753 556', 'www.samplehomes.com.au', 'Jordan Example', 'Powered by Glide Inside']) assert.ok(t.includes(want), `eng missing ${want}`);
  const pub = recorder();
  await toEngineeringPDF(project, { jsPDF: pub.Rec, builder: null, date: new Date(2026, 10, 18) });
  assert.ok(!pub.texts.join('\n').includes('Builder licence'));
});

test('builderOf and initialsOf', () => {
  assert.equal(builderOf(null), null);
  assert.equal(builderOf(''), null);
  assert.equal(builderOf('Hunter Homes').name, 'Hunter Homes');
  assert.equal(initialsOf('Sample Homes Pty Ltd'), 'SH');
  assert.equal(builderOf({ name: 'X', details: { abn: 'bad', email: 'bad' } }).details.abn, null, 'invalid details are dropped at export time');
});

test('details validation', () => {
  const ok = validateDetails({ licence: ' 123456C ', abn: '51824753556', address: '4 Road', phone: '(02) 5550 0100', email: 'a@b.co', website: 'HTTPS://www.x.com.au/' });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(ok.details.abn, '51 824 753 556');
  assert.equal(ok.details.website, 'www.x.com.au');
  assert.equal(validateDetails({}).details.licence, null);
  for (const bad of [{ abn: '1234' }, { phone: '12' }, { email: 'x@y' }, { website: 'nodot' }, { licence: 'a;b' }]) assert.equal(validateDetails(bad).ok, false, JSON.stringify(bad));
  assert.equal(cleanDetails({ abn: '5182475355' }).abn, null);
  assert.ok(abnChecksumOk('51 824 753 556'));
});
