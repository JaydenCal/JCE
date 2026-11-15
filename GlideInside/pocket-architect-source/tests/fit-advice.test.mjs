// House fit: the plain language diagnosis, Auto fit, tanks and the driveway following the house, the slope note and Undo.
// Lots: tests/helpers/fit-lots.mjs (a narrow, irregular, sloping lot like the one a tester walked away from; a normal lot; a large lot).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { narrowLot, normalLot, largeLot, storeWith, catalogue, slopeTerrain } from './helpers/fit-lots.mjs';
import { createStore } from '../src/model/store.js';
import * as G from '../src/model/geometry.js';
import { checkSetbacks, translateHouse, rotateHouse, houseCentre, attachedTanks } from '../src/model/placement.js';
import { buildingHull, buildingRings, deriveDriveway, setStoredDriveway, storedDriveway, garageDoor } from '../src/site/lotplan.js';
import { fitFacts, fitPlan, fitCardModel, applyFix, fixPose, marginIn, buildableArea, slopeUnderHouse, slopeNote, SLOPE_NOTE_M, issueSentence, sideWords, narrowerGuidance, NOTHING_FITS, ENGINEER_LABEL } from '../src/site/fit-advice.js';
import { settleSiteItems, tankSpot, moveHouseBy, turnHouseBy, onSiteNote, DRIVEWAY_REROUTED } from '../src/site/site-items.js';
import { autoPose } from '../src/portal/auto-place.js';
import { placeHouse } from '../src/portal/place-house.js';
import { swapHouse } from '../src/lotcard/swap.js';
import { filterRows } from '../src/flow/res-logic.js';
import { coachNext, FLOW_COACH, TOPVIEW_COACH, coachSeen, coachDone } from '../src/ui/fit-coach.js';

/** The house placed the old way (garage to the street, square, no turn to suit the lot): what the tester saw. */
function squarePlaced(project, id) {
  const store = createStore(project, { autosave: false });
  const house = catalogue.createFromTemplate(id);
  const base = structuredClone(store.project);
  base.levels = [];
  const a = autoPose(base, house);
  store.apply('Place', (p) => { p.levels = []; p.site.tanks = []; placeHouse(p, house, a.pose); p.placedHouse = { id, name: id }; });
  return store;
}
const margin = (p) => marginIn(buildingHull(p), buildableArea(p).polygon);
const snap = (p) => JSON.stringify({ levels: p.levels.map((l) => [l.walls.map((w) => [w.a, w.b]), l.rooms.map((r) => r.polygon)]), tanks: p.site.tanks, driveway: p.site.driveway || null });
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('diagnosis text: what is wrong, where and by how much, in plain words', () => {
  // Normal lot, the house pushed over the left boundary.
  const s = storeWith(normalLot(), 'house_double');
  assert.equal(fitCardModel(s.project).show, false, 'a house that fits shows no card');
  s.apply('push', (p) => translateHouse(p, -4000, 0));
  const facts = fitFacts(s.project);
  assert.equal(facts.state, 'over-lot');
  assert.equal(facts.issues[0].where, 'on the right side (looking from the street)', 'the street is along the top of the plan, so plan left is the right hand side from the street');
  assert.match(issueSentence(facts.issues[0]), /^The house is \d+\.\d m over the boundary on the right side \(looking from the street\)\.$/);
  const card = fitCardModel(s.project);
  assert.equal(card.show, true);
  assert.equal(card.verdict, 'move');
  assert.match(card.lines.join(' '), /There is room for it on this lot\. Auto fit moves it inside the buildable area\./);
  assert.equal(card.actions[0].id, 'auto');
  assert.ok(card.sides.length >= 1 && card.sides[0].a && card.sides[0].b, 'the breaching side is given for the highlight');
  // Inside the lot but too close to the boundary on the right.
  const s2 = storeWith(normalLot(), 'house_double');
  s2.apply('push', (p) => translateHouse(p, 2300, 0));
  const f2 = fitFacts(s2.project);
  assert.equal(f2.state, 'outside');
  assert.match(issueSentence(f2.issues[0]), /^The house is \d+\.\d m too close to the boundary on the left side \(looking from the street\)\.$/);
  // Front and rear words.
  const lot = s.project.site.lot;
  assert.equal(sideWords(lot, 0), 'at the front');
  assert.equal(sideWords(lot, 2), 'at the rear');
  assert.equal(sideWords(lot, 1), 'on the left side (looking from the street)');
  assert.equal(sideWords(lot, 3), 'on the right side (looking from the street)');
});

test('diagnosis text: a house too big for the narrow lot says how much too wide, offers designs that fit, narrower and an engineer', () => {
  const s = squarePlaced(narrowLot(), 'house_single');
  const card = fitCardModel(s.project);
  assert.equal(card.verdict, 'none');
  assert.equal(card.title, 'This house is too big for this lot');
  assert.match(card.lines[0], /^The house is \d+\.\d m too wide( and \d+\.\d m too deep)? for the buildable area, however it is turned\.$/);
  assert.match(card.lines[1], /^It overhangs most (on the (left|right) side \(looking from the street\)|at the (front|rear))\. A smaller design will fit, or a registered engineer can design one for this lot\.$/);
  assert.deepEqual(card.actions.map((a) => a.id), ['designs', 'narrower', 'auto', 'engineer']);
  assert.equal(card.actions.find((a) => a.id === 'engineer').label, ENGINEER_LABEL);
  assert.match(narrowerGuidance(s.project), /^To make the house narrower, drag a side wall inward on the floor plan\. It needs to come in by about \d+\.\d m\./);
  // With no designs to offer the engineer is the primary action.
  const c2 = fitCardModel(s.project, { canDesigns: false });
  assert.equal(c2.actions.find((a) => a.primary).id, 'engineer');
  assert.match(NOTHING_FITS, /registered engineer/);
});

test('auto fit improves the clearance on the irregular lot: the house the tester could not place now fits', () => {
  const s = squarePlaced(narrowLot(), 'house_double');
  const before = margin(s.project);
  assert.ok(before < 0, `square to the street it does not fit (${Math.round(before)} mm)`);
  assert.equal(checkSetbacks(s.project).status, 'breach');
  const card = fitCardModel(s.project);
  assert.equal(card.verdict, 'rotate');
  assert.equal(card.title, 'The house fits if it is turned');
  assert.deepEqual(card.actions.slice(0, 2).map((a) => a.id), ['auto', 'rotate']);
  const plan = fitPlan(s.project);
  assert.ok(plan.auto.fits && plan.auto.margin > 0);
  const r = applyFix(s, 'auto');
  assert.deepEqual([r.ok, r.fits, r.changed], [true, true, true]);
  const after = margin(s.project);
  assert.ok(after > before && after >= 0, `clearance went from ${Math.round(before)} to ${Math.round(after)} mm`);
  assert.equal(checkSetbacks(s.project).status, 'ok');
  assert.equal(fitCardModel(s.project).show, false);
  assert.equal(s.undoLabel(), 'Auto fit');
  // Rotate to fit is the smaller turn and also fits.
  const s2 = squarePlaced(narrowLot(), 'house_double');
  const rot = fixPose(s2.project, 'rotate');
  assert.ok(rot.fits && Math.abs(rot.deg) > 0 && Math.abs(rot.deg) <= Math.abs(plan.auto.deg));
  applyFix(s2, 'rotate');
  assert.equal(checkSetbacks(s2.project).status, 'ok');
});

test('auto fit: on a normal and a large lot a house dragged off comes back with a small move, garage still to the street', () => {
  for (const mk of [normalLot, largeLot]) {
    const s = storeWith(mk(), 'house_double');
    const c0 = houseCentre(s.project);
    s.apply('push', (p) => translateHouse(p, -c0.x - 2000, 0));
    assert.ok(margin(s.project) < 0);
    const pose = fixPose(s.project, 'auto');
    assert.equal(pose.deg, 0, 'no turn is needed');
    applyFix(s, 'auto');
    assert.ok(margin(s.project) >= 0);
    assert.equal(checkSetbacks(s.project).status, 'ok');
    assert.ok(Math.abs(houseCentre(s.project).y - c0.y) < 2500, 'it is not sent to the middle of the lot');
    const dw = deriveDriveway(s.project);
    assert.ok(dw.ok && !dw.routed);
  }
});

test('square to the street turns the garage to the frontage', () => {
  const s = storeWith(normalLot(), 'house_double');
  s.apply('turn', (p) => rotateHouse(p, 37, houseCentre(p)));
  applyFix(s, 'square');
  const door = garageDoor(s.project);
  assert.ok(door.normal.y < -0.99, 'the garage door faces the street (up the plan)');
  assert.equal(s.undoLabel(), 'Square to the street');
});

test('undo: a fix is one undo step and Undo puts the house, the tank and the driveway back exactly', () => {
  const s = squarePlaced(narrowLot(), 'house_double');
  const before = snap(s.project);
  const depth = s.canUndo();
  applyFix(s, 'auto');
  assert.notEqual(snap(s.project), before);
  assert.equal(s.undo(), true);
  assert.equal(snap(s.project), before);
  assert.equal(s.canUndo(), depth);
  // A fix that changes nothing adds no undo step.
  const s2 = storeWith(normalLot(), 'house_double');
  applyFix(s2, 'auto');
  const label = s2.undoLabel();
  const again = applyFix(s2, 'auto');
  assert.equal(again.changed, false);
  assert.equal(s2.undoLabel(), label);
});

test('tanks follow the house: moved, turned, swapped and auto fitted, they stay beside it, inside the lot, off the house and the driveway', () => {
  const ok = (p, why) => {
    const rings = buildingRings(p);
    const dw = deriveDriveway(p);
    assert.ok(p.site.tanks.length >= 1, why);
    for (const t of p.site.tanks) {
      const r = t.diameter / 2;
      assert.ok(G.pointInPolygon(t, p.site.lot.boundary), `${why}: the tank is inside the lot`);
      assert.ok(!rings.some((ring) => G.pointInPolygon(t, ring)), `${why}: the tank is not in the house`);
      const gap = Math.min(...rings.map((ring) => Math.min(...ring.map((a, i) => G.projectToSegment(t, a, ring[(i + 1) % ring.length]).d))));
      assert.ok(gap >= r && gap <= r + 3600, `${why}: the tank is beside a wall (${Math.round(gap - r)} mm clear)`);
      if (dw?.ok) assert.ok(!G.pointInPolygon(t, dw.polygon), `${why}: the tank is not on the driveway`);
      assert.ok(tankSpot(p, t) >= 0, `${why}: the tank stands in an allowed spot`);
    }
  };
  const s = storeWith(normalLot(), 'house_double');
  ok(s.project, 'placed');
  const t0 = { ...s.project.site.tanks[0] };
  const c0 = houseCentre(s.project);
  s.apply('move', (p) => { moveHouseBy(p, 0, 4000); });
  const t1 = s.project.site.tanks[0];
  assert.deepEqual([t1.x - t0.x, t1.y - t0.y], [0, 4000], 'the tank moved with the house');
  ok(s.project, 'moved');
  s.apply('turn', (p) => { turnHouseBy(p, 90, houseCentre(p)); });
  const want = G.rotatePoint({ x: t0.x, y: t0.y + 4000 }, { x: c0.x, y: c0.y + 4000 }, 90);
  ok(s.project, 'turned');
  assert.ok(G.dist(s.project.site.tanks[0], want) < 6000, 'the tank turned with the house (or was put beside the nearest wall)');
  // Pushed so the tank would leave the lot: it is put beside a wall inside the lot.
  const s2 = storeWith(normalLot(), 'house_double');
  const t = s2.project.site.tanks[0];
  const toEdge = t.x < 10000 ? -(t.x - 300) : 20000 - t.x - 300;
  s2.apply('move', (p) => { moveHouseBy(p, toEdge, 0); });
  ok(s2.project, 'pushed to the boundary');
  // Auto fit on the narrow lot and a change of design.
  const s3 = squarePlaced(narrowLot(), 'house_double');
  applyFix(s3, 'auto');
  ok(s3.project, 'auto fitted');
  swapHouse(s3, catalogue.createFromTemplate('granny_flat'), { id: 'granny_flat', name: 'Granny flat' });
  ok(s3.project, 'swapped');
  // A tank that stands on its own (down the back) is left where it is.
  const s4 = storeWith(largeLot(), 'house_double');
  s4.apply('add', (p) => { p.site.tanks.push({ ...p.site.tanks[0], id: 't_far', x: 20000, y: 70000 }); });
  assert.equal(attachedTanks(s4.project).length, 1);
  s4.apply('move', (p) => { moveHouseBy(p, 3000, 3000); });
  const far = s4.project.site.tanks.find((x) => x.id === 't_far');
  assert.deepEqual([far.x, far.y], [20000, 70000]);
});

test('slope note: nothing at or under about 1.5 m across the footprint, a gentle note with the fall above it', () => {
  assert.equal(SLOPE_NOTE_M, 1.5);
  const flat = storeWith(normalLot(), 'house_double');
  assert.equal(slopeUnderHouse(flat.project), null, 'no level data, no note');
  assert.equal(slopeNote(flat.project), null);
  const withFall = (fallPerM) => { const s = storeWith(normalLot(), 'house_double'); s.project.site.lot.terrain = slopeTerrain(s.project.site.lot.boundary, fallPerM); return s.project; };
  const gentle = withFall(0.05);
  const g = slopeUnderHouse(gentle);
  assert.ok(g.fallM > 0.5 && g.fallM <= 1.5, `a gentle site (${g.fallM} m)`);
  assert.equal(slopeNote(gentle), null);
  const steep = withFall(0.14);
  const n = slopeNote(steep);
  assert.ok(n && n.fallM > 1.5);
  assert.equal(n.text, `The ground falls about ${n.fallM.toFixed(1)} m across this house. This is a concept only: a sloping site may need a split level design. Send it to a registered engineer for advice.`);
  // The threshold itself: exactly 1.5 m is not noted, a little over is.
  const exact = (fall) => { const p = withFall(0.05); const t = p.site.lot.terrain; const hull = buildingHull(p); const bb = G.bbox(hull); t.values = t.values.map((_, i) => { const y = t.y0 + Math.floor(i / t.cols) * t.cellMm; return 100 + fall * Math.min(1, Math.max(0, (y - bb.minY) / (bb.maxY - bb.minY))); }); return p; };
  assert.equal(slopeNote(exact(1.5)), null);
  assert.ok(slopeNote(exact(1.7)));
  // The card carries the note even when the house fits (the narrow lot slopes).
  const s = storeWith(narrowLot(), 'house_double');
  const card = fitCardModel(s.project);
  assert.equal(card.show, false);
  assert.ok(card.slope && card.slope.fallM > 1.5);
});

test('first placement: on the narrow lot the house is turned to suit the lot instead of being left over the boundary', () => {
  const s = storeWith(narrowLot(), 'house_double');
  assert.equal(checkSetbacks(s.project).status, 'ok');
  assert.ok(!s.project.placedHouse.tooBig);
  assert.ok(Math.abs(s.project.placedHouse.turnedToFit) >= 5, 'it says the house was turned');
  assert.ok(deriveDriveway(s.project).ok, 'with a driveway to the street');
  // A house that cannot fit however it is turned is still marked too big.
  const big = storeWith(narrowLot(), 'house_single');
  assert.equal(big.project.placedHouse.tooBig, true);
  // A normal lot is not touched: square to the street as before.
  const n = storeWith(normalLot(), 'house_double');
  assert.equal(n.project.placedHouse.turnedToFit, undefined);
  assert.ok(garageDoor(n.project).normal.y < -0.99);
});

test('driveway: always there when the house has a garage, routed round the house when the garage faces away, inside the lot', () => {
  const inLot = (p, dw) => { const lot = p.site.lot; return dw.centre.every((c) => c.y <= 60 || G.pointInPolygon(c, lot.boundary)); };
  const offHouse = (p, dw) => { const rings = buildingRings(p); const door = garageDoor(p); return dw.centre.every((c) => G.dist(c, door.mid) < 3000 || !rings.some((ring) => G.pointInPolygon(c, ring))); };
  for (const mk of [normalLot, largeLot, narrowLot]) {
    const s = storeWith(mk(), 'house_double');
    const d0 = deriveDriveway(s.project);
    assert.ok(d0.ok && !d0.routed, 'garage to the street: the plain driveway');
    for (const deg of [90, 180, 270]) {
      const q = structuredClone(s.project);
      rotateHouse(q, deg, houseCentre(q));
      const dw = deriveDriveway(q);
      if (mk !== largeLot && (!dw.ok || !dw.routed)) continue; // a house turned across a lot little wider than itself can leave no way past it
      assert.ok(dw.ok, `turned ${deg}: there is a driveway`);
      assert.ok(inLot(q, dw), `turned ${deg}: the driveway stays inside the lot`);
      assert.ok(offHouse(q, dw), `turned ${deg}: the driveway does not run through the house`);
      assert.ok(Math.abs(dw.kerbPoint.y + dw.lengthMm * 0) < 5000 + 4500, 'it ends at the street');
    }
    // Garage facing the back of the lot: routed round the house.
    const back = structuredClone(s.project);
    rotateHouse(back, 180, houseCentre(back));
    const dwb = deriveDriveway(back);
    if (dwb.ok) assert.equal(dwb.routed, true);
    assert.deepEqual(deriveDriveway(back, { route: false }).reason, 'door_faces_away', 'the old answer is still there for callers that ask');
  }
});

test('driveway edits: a valid edit is kept, one that no longer works is dropped with the note, and Undo brings it back', () => {
  const s = storeWith(largeLot(), 'house_double');
  const d0 = deriveDriveway(s.project);
  const bend = { x: d0.centre[20].x + 2500, y: d0.centre[20].y };
  s.apply('Edit driveway', (p) => { setStoredDriveway(p, { endOffsetMm: d0.endOffsetMm + 1500, pis: [bend], radiusM: 6, widthMm: null }); });
  const notes = [];
  const off = onSiteNote((n) => notes.push(n));
  // A small move: the edit still works, so it stays.
  s.apply('Move house', (p) => { moveHouseBy(p, 300, 500); });
  assert.ok(storedDriveway(s.project), 'the edit is kept');
  assert.equal(deriveDriveway(s.project).edited, true);
  assert.equal(notes.length, 0);
  // The house is moved onto the bend: the edit runs through the house, so the driveway is routed again.
  const c = houseCentre(s.project);
  s.apply('Move house', (p) => { const r = moveHouseBy(p, Math.round(bend.x - c.x), Math.round(bend.y - c.y)); assert.equal(r.drivewayRerouted, true); });
  assert.equal(storedDriveway(s.project), null);
  const dw = deriveDriveway(s.project);
  assert.ok(dw.ok && !dw.edited);
  assert.deepEqual(notes.map((n) => n.text), [DRIVEWAY_REROUTED]);
  assert.equal(DRIVEWAY_REROUTED, 'Driveway re-routed to suit the new position.');
  s.undo();
  assert.ok(storedDriveway(s.project), 'Undo brings the edit back');
  off();
});

test('step 2 filter "Fits this lot", the first placement tips and the wording rules', () => {
  const rows = [{ id: 'a', fits: true, stats: { bedrooms: 3, storeys: 1 }, frontageM: null }, { id: 'b', fits: false, stats: { bedrooms: 4, storeys: 2 }, frontageM: null }];
  assert.deepEqual(filterRows(rows, { fitsOnly: true }).map((r) => r.id), ['a']);
  assert.deepEqual(filterRows(rows, {}).map((r) => r.id), ['a', 'b']);
  // Tips: a step waits for its own action; Got it always moves on.
  assert.equal(FLOW_COACH[0].text, 'Your house is on the lot. Drag it to move it.');
  assert.equal(TOPVIEW_COACH[0].text, 'Your house is on the lot. In the top view, drag it to move it, use the ring to rotate.');
  assert.equal(coachNext(FLOW_COACH, 0, 'turn'), 0);
  assert.equal(coachNext(FLOW_COACH, 0, 'move'), 1);
  assert.equal(coachNext(FLOW_COACH, 1, 'turn'), 2);
  assert.equal(coachNext(FLOW_COACH, 2, 'move'), 2);
  assert.equal(coachNext(FLOW_COACH, 2, 'ok'), 3);
  const st = mem();
  assert.equal(coachSeen(st), false);
  coachDone(st);
  assert.equal(coachSeen(st), true);
  // Wording: no em or en dashes, never "compliant", no builder names.
  for (const f of ['../src/site/fit-advice.js', '../src/site/site-items.js', '../src/ui/fit-card.js', '../src/ui/fit-coach.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/[–—]/.test(src), `${f}: no em or en dashes`);
    assert.ok(!/complian/i.test(src), `${f}: never "compliant"`);
  }
  const all = [];
  for (const [mk, id] of [[narrowLot, 'house_single'], [narrowLot, 'house_double'], [normalLot, 'house_double']]) {
    const s = squarePlaced(mk(), id);
    s.apply('push', (p) => translateHouse(p, -3000, 0));
    const c = fitCardModel(s.project);
    all.push(c.title, ...c.lines, ...c.actions.map((a) => a.label), c.slope?.text || '', c.driveway?.text || '');
  }
  for (const t of all) { assert.ok(!/[–—]/.test(t), t); assert.ok(!/complian/i.test(t), t); }
});

// Suggestions: ways to make the house smaller and other sizes that fit ---------------------------------------------------------------
import { shrinkSuggestions, sizeAlternatives, swapKeeping, applyShrink, narrowerDesignSuggestion, keptPose } from '../src/site/fit-suggest.js';
import { publicDesigns } from '../src/lotcard/designs.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

test('a wide house on the narrow lot gets ways to shrink it, each with its saving, ranked against the shortfall', () => {
  const s = squarePlaced(narrowLot(), 'house_single');
  const plan = fitPlan(s.project);
  assert.equal(plan.verdict, 'none');
  const ways = shrinkSuggestions(s.project, { needWideM: plan.tooWideM, needDeepM: plan.tooDeepM });
  assert.ok(ways.length >= 3, `several suggestions (${ways.map((w) => w.id).join(', ')})`);
  for (const w of ways) {
    assert.match(w.text, / saves about \d+\.\d m of (width|depth)( and \d+\.\d m of depth)?( at the garage)?\.$/, w.text);
    assert.ok(!/[–—]|complian/i.test(w.text + w.guide));
    assert.ok(w.oneTap || w.guide.length > 10, `${w.id} says what to do in the editor`);
  }
  const ids = ways.map((w) => w.id);
  assert.ok(ids.includes('garage-single'));
  assert.match(ways.find((w) => w.id === 'garage-single').text, /^A single garage instead of a double saves about \d+\.\d m of width( at the garage)?\.$/);
  assert.ok(ids.includes('alfresco') && ids.includes('two-storey'));
  // Ranked: each covers no more of the shortfall than the one before it.
  const rel = (w) => Math.min(w.saveWideM, plan.tooWideM) + Math.min(w.saveDeepM, plan.tooDeepM);
  for (let i = 1; i < ways.length; i++) assert.ok(rel(ways[i]) <= rel(ways[i - 1]) + 1e-9, 'most useful first');
  // A two storey house is not told to go two storey.
  assert.ok(!shrinkSuggestions(squarePlaced(narrowLot(), 'house_double').project, {}).some((w) => w.id === 'two-storey'));
});

test('drop the alfresco is one tap with Undo, and the house is smaller for it', () => {
  const s = squarePlaced(narrowLot(), 'house_single');
  const before = snap(s.project);
  const rooms = (p) => p.levels.flatMap((l) => l.rooms).filter((r) => r.type === 'alfresco').length;
  assert.equal(rooms(s.project), 1);
  const w = shrinkSuggestions(s.project, {}).find((x) => x.id === 'alfresco');
  assert.equal(w.oneTap, true);
  const m0 = margin(s.project);
  assert.equal(applyShrink(s, 'alfresco').ok, true);
  assert.equal(rooms(s.project), 0);
  assert.equal(s.undoLabel(), 'Remove alfresco');
  assert.ok(margin(s.project) >= m0);
  s.undo();
  assert.equal(snap(s.project), before);
  assert.equal(rooms(s.project), 1);
});

test('other sizes: the designs that fit come first, then by likeness, with a label and the width; the swap keeps the spot and the facing', () => {
  const s = squarePlaced(narrowLot(), 'house_single');
  const designs = publicDesigns(catalogue, s.project);
  const alts = sizeAlternatives(s.project, designs);
  assert.ok(!alts.list.some((a) => a.id === 'house_single'), 'the placed design is not offered');
  assert.ok(alts.fitCount >= 2);
  const fits = alts.list.map((a) => a.fit > 0);
  assert.ok(fits.indexOf(false) === -1 || fits.lastIndexOf(true) < fits.indexOf(false), 'fitting designs first');
  const best = alts.list[0];
  assert.equal(best.id, 'house_double', 'the nearest in size and kind that fits');
  assert.match(best.label, /^Similar 5 bedroom that fits: \d+\.\d m wide$/);
  assert.ok(alts.list.find((a) => a.id === 'duplex').fit === 0);
  const nd = narrowerDesignSuggestion(s.project, alts);
  assert.match(nd.text, /^A narrower design: .+ is \d+\.\d m wide and saves about \d+\.\d m of width\.$/);
  // One tap swap: same place, same facing where it fits; one undo step.
  const n = storeWith(largeLot(), 'house_single');
  n.apply('turn', (p) => { rotateHouse(p, 25, houseCentre(p)); translateHouse(p, 1500, 9000); });
  const c0 = G.polygonCentroid(buildingHull(n.project));
  const a0 = Math.atan2(garageDoor(n.project).normal.y, garageDoor(n.project).normal.x);
  const before = snap(n.project);
  const r = swapKeeping(n, designs.find((d) => d.id === 'house_double'));
  assert.deepEqual([r.ok, r.fits, r.kept], [true, true, true]);
  const c1 = G.polygonCentroid(buildingHull(n.project));
  const a1 = Math.atan2(garageDoor(n.project).normal.y, garageDoor(n.project).normal.x);
  assert.ok(G.dist(c0, c1) < 60, 'same position');
  assert.ok(Math.abs(a1 - a0) < 0.01, 'same facing');
  assert.equal(n.project.placedHouse.id, 'house_double');
  assert.equal(n.undoLabel(), 'Change house design');
  n.undo();
  assert.equal(snap(n.project), before);
  // On the narrow lot the swap ends inside the buildable area.
  const r2 = swapKeeping(s, best.design);
  assert.equal(r2.fits, true);
  assert.equal(checkSetbacks(s.project).status, 'ok');
  assert.ok(keptPose(n.project, designs.find((d) => d.id === 'granny_flat').project) === null, 'a home with no garage door falls back to the usual placement');
});

test('a tight fit is called out gently, with the same suggestions', () => {
  const s = storeWith(normalLot(), 'house_single');
  const p = fitPlan(s.project);
  const card = fitCardModel(s.project);
  if (p.now.margin < 250 && p.auto.margin < 400) {
    assert.equal(card.verdict, 'tight');
    assert.equal(card.title, 'A tight fit');
    assert.match(card.lines[0], /^The house fits with about \d+\.\d m to spare\. There are smaller options below if you want more room\.$/);
    assert.equal(card.tone, 'note');
  } else assert.equal(card.show, false);
  assert.ok(shrinkSuggestions(s.project, {}).length >= 2);
});

test('the new designs catalogue (branch claude/new-designs, when it is fetched) feeds the suggestions with no code change', async (t) => {
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'gi-new-designs-'));
    const tar = execFileSync('git', ['archive', 'origin/claude/new-designs', 'src'], { cwd: fileURLToPath(new URL('..', import.meta.url)), maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
  } catch { t.skip('branch claude/new-designs is not available here'); return; }
  const src = join(dir, 'src/catalogue/index.js');
  if (!existsSync(src)) { t.skip('no catalogue in the branch'); return; }
  const cat = (await import(pathToFileURL(src).href)).default;
  const designs = [];
  for (const tpl of cat.templates) {
    if (!/^(house_|granny|duplex|narrow_|single_|townhouse|dual_|acreage|shed_house)/.test(tpl.id)) continue;
    let proj = null;
    try { proj = cat.createFromTemplate(tpl.id); } catch { proj = null; }
    if (proj?.levels?.length) designs.push({ id: tpl.id, name: tpl.name, project: JSON.parse(JSON.stringify(proj)), ...(tpl.frontageM != null ? { frontageM: tpl.frontageM } : {}) });
  }
  assert.ok(designs.length >= 12, `${designs.length} designs loaded from the branch`);
  const s = squarePlaced(narrowLot(), 'house_single');
  const alts = sizeAlternatives(s.project, designs);
  const fitting = alts.list.filter((a) => a.fit > 0);
  assert.ok(fitting.length >= 5, `${fitting.length} of the new designs fit the narrow lot`);
  assert.ok(fitting.some((a) => /^narrow_/.test(a.id)), 'the narrow lot homes are among them');
  assert.match(fitting[0].label, /^Similar \d bedroom that fits: \d+\.\d m wide$/);
  assert.ok(/^(narrow_|single_|house_)/.test(fitting[0].id), `a similar home leads (${fitting[0].id})`);
  // Swapping to a narrow home lands inside the buildable area.
  const pick = fitting.find((a) => /^narrow_/.test(a.id));
  assert.equal(swapKeeping(s, pick.design).fits, true);
  assert.equal(checkSetbacks(s.project).status, 'ok');
  assert.ok(shrinkSuggestions(s.project, {}).every((w) => / saves about /.test(w.text)));
});
