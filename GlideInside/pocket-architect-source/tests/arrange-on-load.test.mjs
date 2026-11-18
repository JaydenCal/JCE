// A lot opened with its house arranges itself so no "outside the buildable area" warning shows; commercial words say building.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalLot, storeWith } from './helpers/fit-lots.mjs';
import { translateHouse } from '../src/model/placement.js';
import { fitCardModel, commercialWords } from '../src/site/fit-advice.js';
import { arrangeOnLoad, arrangeOnLoadWatching } from '../src/flow/arrange-on-load.js';

const nowait = async () => {};

test('a house that sits outside the setbacks is moved inside on load', async () => {
  const s = storeWith(normalLot(), 'house_double');
  s.apply('push', (p) => translateHouse(p, -4000, 0));
  assert.equal(fitCardModel(s.project).show, true);
  const r = await arrangeOnLoad(s, { wait: nowait });
  assert.equal(r, 'moved');
  assert.equal(fitCardModel(s.project).show, false);
});

test('a house that already fits is left alone; no lot means nothing to do', async () => {
  const s = storeWith(normalLot(), 'house_double');
  const before = JSON.stringify(s.project.levels);
  assert.equal(await arrangeOnLoad(s, { wait: nowait }), 'fits');
  assert.equal(JSON.stringify(s.project.levels), before);
  assert.equal(await arrangeOnLoad({ project: { site: {} } }, { wait: nowait }), 'fits');
});

test('a chosen design is never swapped; an unchosen one may be', async () => {
  const mk = () => { const s = storeWith(normalLot(), 'house_double'); s.apply('push', (p) => { translateHouse(p, -4000, 0); }); return s; };
  let called = 0;
  const s = mk();
  s.project.flow = { designId: 'house_double' };
  const stubFix = { wait: nowait, catalogue: {}, placeBest: async () => { called++; } };
  await arrangeOnLoad(s, stubFix);
  assert.equal(called, 0, 'auto fit solved it, and a chosen design is never swapped anyway');
});

test('commercial wording says building, not house', () => {
  const m = commercialWords({ show: true, title: 'This house is too big for this lot', lines: ['The house is 4.0 m too wide for the buildable area, however it is turned.'] });
  assert.equal(m.title, 'This building is too big for this lot');
  assert.match(m.lines[0], /^The building is 4\.0 m too wide/);
  assert.doesNotMatch(JSON.stringify(m), /house/i);
});

test('setbacks that arrive after the editor opens trigger one more pass', async () => {
  const s = storeWith(normalLot(), 'house_double');
  assert.equal(await arrangeOnLoadWatching(s, { wait: nowait }), 'fits');
  s.apply('late setbacks change pushes the house out', (p) => translateHouse(p, -4000, 0));
  assert.equal(fitCardModel(s.project).show, true);
  s.emit('project', { label: 'setbacks' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fitCardModel(s.project).show, false, 'the late pass moved it back inside');
});
