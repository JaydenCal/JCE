import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RESIDENTIAL_TUTORIAL, COMMERCIAL_TUTORIAL, readTutorial, writeTutorial, shouldStartTutorial, stepIndexForFlow } from '../src/tutorial/steps.js';
import { placeBeside } from '../src/tutorial/coach.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const FLOW = { residential: { 1: ['flow/lot-step.js'], 2: ['flow/residential.js'], 3: ['flow/residential.js'], 4: ['flow/residential.js'] }, commercial: { 1: ['flow/lot-step.js'], 2: ['flow/commercial.js'], 3: ['flow/commercial.js'], 4: ['flow/commercial.js'] } };
const EDITOR = ['profile/ui.js', 'lotcard/lot-card.js', 'ui/topbar.js'];

test('the tutorial starts on a first visit, not again after Skip or Done, and restarts from the button', () => {
  const s = mem();
  assert.equal(shouldStartTutorial('residential', s), true);
  writeTutorial('residential', 'skipped', s);
  assert.equal(shouldStartTutorial('residential', s), false);
  assert.equal(shouldStartTutorial('commercial', s), true, 'each mode keeps its own state');
  writeTutorial('commercial', 'done', s);
  assert.equal(readTutorial('commercial', s), 'done');
  writeTutorial('residential', null, s); // the restart button clears it
  assert.equal(shouldStartTutorial('residential', s), true);
  assert.equal(shouldStartTutorial('residential', { getItem() { throw new Error('blocked'); } }), true, 'blocked storage never throws');
});

for (const [kind, steps] of [['residential', RESIDENTIAL_TUTORIAL], ['commercial', COMMERCIAL_TUTORIAL]]) {
  test(`${kind}: seven steps, every target exists in its own step, wording rules hold`, () => {
    assert.equal(steps.length, 7);
    for (const s of steps) {
      const token = /\[(data-[a-z]+)="([^"]+)"\]/.exec(s.target);
      assert.ok(token, `${s.id}: target is a data attribute selector`);
      const files = s.where === 'flow' ? FLOW[kind][s.flowStep] : EDITOR;
      assert.ok(files, `${s.id}: known place`);
      const needle = token[1] === 'data-ps' ? `ps: '${token[2]}'` : token[1] === 'data-action' ? `action: '${token[2]}'` : `${token[2]}`;
      assert.ok(files.some((f) => src(f).includes(needle)), `${s.id}: ${s.target} is built in ${files.join(' or ')}`);
      assert.ok(!/[–—]/.test(s.text) && !/compliant/i.test(s.text), `${s.id}: wording`);
      assert.ok(s.text.length <= 140, `${s.id}: one or two short sentences`);
    }
    assert.equal(stepIndexForFlow(steps, 1), 0);
  });
}

test('cards sit beside the control and never over the lot or 3D view; a crowded screen falls back to the bottom sheet', () => {
  const view = { w: 1440, h: 900 }, size = { w: 260, h: 120 };
  const target = { left: 100, right: 300, top: 100, bottom: 140, width: 200, height: 40 };
  const stage = { left: 330, right: 1400, top: 60, bottom: 880 };
  const p = placeBeside(target, size, view, [stage]);
  assert.ok(p && (p.left + 260 <= stage.left || p.left >= stage.right || p.top >= stage.bottom || p.top + 120 <= stage.top));
  assert.equal(placeBeside(target, size, view, [{ left: 0, right: 1440, top: 0, bottom: 900 }]), null);
});
