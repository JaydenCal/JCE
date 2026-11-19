// Phone mode for the Residential tool: detection, the bottom action bar, no sideways scrolling, the share fallback, the three overlap and
// cut off fixes (Back to plan against Edit room, the room buttons row, the status bar help line) and the new copy rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { phoneModeFor, PHONE_QUERY, DESKTOP_KEY } from '../src/phone/mode.js';
import { phoneHint, MOVE_HINT } from '../src/phone/hint.js';
import { shareOrCopy } from '../src/phone/share.js';
import { SRC, SITE } from './helpers/phone-harness.mjs';

// ---------------------------------------------------------------------------------------------- pure
test('phone mode needs a coarse pointer and a narrow window; Desktop view switches it off', () => {
  assert.equal(phoneModeFor({ coarse: true, width: 390 }), true);
  assert.equal(phoneModeFor({ coarse: true, width: 700 }), true);
  assert.equal(phoneModeFor({ coarse: true, width: 701 }), false, 'a tablet width is not a phone');
  assert.equal(phoneModeFor({ coarse: false, width: 390 }), false, 'a narrow desktop window is not a phone');
  assert.equal(phoneModeFor({ coarse: true, width: 390, desktop: true }), false, 'Desktop view wins');
  assert.equal(PHONE_QUERY, '(pointer: coarse) and (max-width: 700px)');
  assert.equal(DESKTOP_KEY, 'ps.desktopView');
});

test('the phone status hint is short, in touch words and keeps whole sentences', () => {
  assert.equal(phoneHint('Drag the house to move it. Drag the gold ring to turn it, Shift for 15 degree steps. Arrow keys nudge 0.1 m (Shift 1 m).', 'movehouse'), MOVE_HINT);
  assert.match(MOVE_HINT, /Twist with two fingers/);
  const h = phoneHint('Click to start a wall. Double click or Enter finishes. Hold Shift for 15 degree steps.', 'wall');
  assert.equal(h, 'Tap to start a wall.');
  assert.ok(!/shift|enter|ctrl|–|—/i.test(phoneHint('Click a room, then press Delete. Hold Alt to bypass snapping.', 'select')));
  assert.equal(phoneHint('', 'wall'), '');
});

test('share: the share sheet first, then the clipboard, then a manual copy', async () => {
  const calls = [];
  const url = 'https://glideinside.com.au/plan-studio/app/?share=abc';
  assert.deepEqual(await shareOrCopy({ url, nav: { share: async (d) => calls.push(d) }, doc: null }), { how: 'shared', url });
  assert.equal(calls[0].url, url);
  assert.equal((await shareOrCopy({ url, nav: { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }, doc: null })).how, 'cancelled');
  const copied = [];
  assert.equal((await shareOrCopy({ url, nav: { clipboard: { writeText: async (t) => copied.push(t) } }, doc: null })).how, 'copied');
  assert.deepEqual(copied, [url]);
  assert.equal((await shareOrCopy({ url, nav: { share: async () => { throw new Error('denied'); }, clipboard: { writeText: async (t) => copied.push(t) } }, doc: null })).how, 'copied', 'a failed share sheet falls back to copy');
  assert.equal((await shareOrCopy({ url, nav: {}, doc: null })).how, 'manual');
  const legacy = { createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }), body: { append() {} }, execCommand: () => true };
  assert.equal((await shareOrCopy({ url, nav: {}, doc: legacy })).how, 'copied', 'the older copy command works when there is no clipboard API');
});

// ---------------------------------------------------------------------------------------------- copy rules
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f, out) : out.push(f); } return out; };
test('new copy: no en or em dashes, no "compliant", no old product name, no prices, no "use a computer" nudge', () => {
  const files = [...walk(path.join(SRC, 'src/phone')), path.join(SRC, 'src/flow/phone-plan.js')];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/[–—]/.test(t), `${path.basename(f)} has a dash`);
    assert.ok(!/compliant/i.test(t), `${path.basename(f)} says compliant`);
    assert.ok(!/pocket architect/i.test(t), `${path.basename(f)} has the old name`);
    assert.ok(!/\$\s?\d|A\$\d/.test(t), `${path.basename(f)} has a price`);
  }
  const home = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const card = /<div class="handoff" data-handoff>[\s\S]*?<\/div>/.exec(home)?.[0] || '';
  assert.ok(card.includes('data-phone-start') && /plan-studio\/app\/\?mode=residential/.test(card), 'the card starts the phone tool');
  assert.ok(!/[–—]|compliant|free/i.test(card), 'the card copy follows the text rules');
  for (const f of walk(SITE).filter((x) => /\.(html|js)$/.test(x) && !/\/(staging|plan-studio\/app)\//.test(x))) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/works best on a computer|carry on at your desk|use a computer|best on desktop/i.test(t), `${path.relative(SITE, f)} still sends phone visitors to a computer`);
  }
});
