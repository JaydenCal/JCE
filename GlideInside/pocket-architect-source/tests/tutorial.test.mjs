import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RESIDENTIAL_TUTORIAL, COMMERCIAL_TUTORIAL, CHAPTERS, BASICS_ID, chaptersFor, chapterById, chapterDone, markChapter, readChapters, chapterProgress, videoUrl, posterUrl, readTutorial, writeTutorial, shouldStartTutorial, stepIndexForFlow } from '../src/tutorial/steps.js';
import { menuRows } from '../src/tutorial/menu.js';
import { placeBeside, placeCorner, otherPromptOpen, OTHER_PROMPTS } from '../src/tutorial/coach.js';

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

const allSrc = (() => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = `${d}/${e.name}`; if (e.isDirectory()) walk(f); else if (f.endsWith('.js') && !f.includes('/tutorial/')) out.push(fs.readFileSync(f, 'utf8')); } };
  walk(new URL('../src', import.meta.url).pathname);
  return out.join('\n');
})();
const toolIds = [...src('editor2d/tools-meta.js').matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
const targetExists = (target) => {
  const m = /^\[(data-[a-z]+)="([^"]+)"\]$/.exec(target);
  if (!m) return false;
  const [, attr, val] = m;
  if (attr === 'data-tool') return toolIds.includes(val);
  if (allSrc.includes(`'${val}'`) || allSrc.includes(`"${val}"`)) return true;
  // Built from a template such as `flow-filter-${key}`: the prefix is a template and the last word is a key somewhere in the source.
  const cut = val.lastIndexOf('-'), prefix = val.slice(0, cut + 1), key = val.slice(cut + 1);
  return cut > 0 && allSrc.includes(`\`${prefix}$` + '{') && new RegExp(`['"\\s]${key}['":\\s]`).test(allSrc);
};

for (const [kind, steps] of [['residential', RESIDENTIAL_TUTORIAL], ['commercial', COMMERCIAL_TUTORIAL]]) {
  test(`${kind}: the Basics chapter keeps its seven steps, every target exists in its own step, wording rules hold`, () => {
    assert.equal(steps.length, 7);
    for (const s of steps) {
      const token = /\[(data-[a-z]+)="([^"]+)"\]/.exec(s.target);
      assert.ok(token, `${s.id}: target is a data attribute selector`);
      const files = s.where === 'flow' ? FLOW[kind][s.flowStep] : EDITOR;
      assert.ok(files, `${s.id}: known place`);
      const needle = token[1] === 'data-ps' ? `ps: '${token[2]}'` : token[1] === 'data-action' ? `action: '${token[2]}'` : `${token[2]}`;
      assert.ok(files.some((f) => src(f).includes(needle)), `${s.id}: ${s.target} is built in ${files.join(' or ')}`);
      assert.ok(!/[\u2013\u2014]/.test(s.text) && !/compliant/i.test(s.text), `${s.id}: wording`);
      assert.ok(s.text.length <= 140, `${s.id}: one or two short sentences`);
    }
    assert.equal(stepIndexForFlow(steps, 1), 0);
  });
}

const WANT = {
  residential: ['basics', 'find', 'design', 'place', 'edit', 'driveway', 'view3d', 'save', 'planset'],
  commercial: ['basics', 'find', 'type', 'place', 'hardstand', 'numbers', 'editor', 'planset'],
};
for (const kind of ['residential', 'commercial']) {
  test(`${kind}: the requested chapters exist, Basics first, each with 3 to 6 short steps whose targets exist`, () => {
    const list = chaptersFor(kind);
    assert.deepEqual(list.map((c) => c.id), WANT[kind]);
    assert.equal(list[0].id, BASICS_ID);
    const ids = new Set();
    for (const c of list) {
      assert.ok(c.title && c.blurb && c.video, `${c.id}: title, blurb and video name`);
      assert.ok(!ids.has(c.id), `${c.id}: unique`); ids.add(c.id);
      if (c.id !== BASICS_ID) assert.ok(c.steps.length >= 3 && c.steps.length <= 6, `${c.id}: ${c.steps.length} steps`);
      const stepIds = new Set();
      for (const s of c.steps) {
        assert.ok(!stepIds.has(s.id), `${c.id}/${s.id}: unique step id`); stepIds.add(s.id);
        assert.ok(s.where === 'flow' || s.where === 'editor', `${c.id}/${s.id}: where`);
        if (s.where === 'flow') assert.ok([1, 2, 3, 4].includes(s.flowStep), `${c.id}/${s.id}: flow step`);
        if (s.arm) assert.ok(toolIds.includes(s.arm), `${c.id}/${s.id}: arms a real tool`);
        assert.ok(targetExists(s.target), `${c.id}/${s.id}: ${s.target} is built somewhere in the app`);
        assert.ok(s.text && s.text.length <= 140, `${c.id}/${s.id}: text is one or two short sentences (${s.text.length})`);
        for (const str of [s.text, c.title, c.blurb]) assert.ok(!/[\u2013\u2014]/.test(str) && !/compliant/i.test(str), `${c.id}/${s.id}: wording`);
      }
      assert.equal(videoUrl(c), `/help/videos/${c.video}.mp4`);
      assert.equal(posterUrl(c), `/help/videos/${c.video}.jpg`);
    }
    assert.equal(chapterById(kind, 'place').id, 'place');
    assert.equal(chapterById(kind, 'nope'), null);
  });
}

test('video names are one per chapter plus an overview per mode, and no builder brand names appear in chapter text', () => {
  const names = [...chaptersFor('residential'), ...chaptersFor('commercial')].map((c) => c.video);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('residential-overview') && names.includes('commercial-overview'));
  const all = JSON.stringify(CHAPTERS);
  assert.ok(!/mcdonald|jones homes|hotondo|masterton|coral homes|allworth|gardner|hunter homes|montgomery|tullipan/i.test(all));
});

test('chapter progress is remembered per mode and chapter, and blocked storage never throws', () => {
  const s = mem();
  assert.equal(chapterDone('residential', 'place', s), false);
  assert.equal(markChapter('residential', 'place', true, s), true);
  assert.equal(chapterDone('residential', 'place', s), true);
  assert.equal(chapterDone('commercial', 'place', s), false, 'each mode keeps its own ticks');
  assert.deepEqual(chapterProgress('residential', s), { done: 1, total: chaptersFor('residential').length });
  markChapter('residential', 'place', false, s);
  assert.equal(chapterDone('residential', 'place', s), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(chapterDone('residential', 'find', blocked), false);
  assert.equal(markChapter('residential', 'find', true, blocked), false);
  assert.deepEqual(readChapters(blocked), {});
  // the first visit key is separate: finishing a chapter other than Basics does not switch the first visit tour off
  assert.equal(shouldStartTutorial('residential', s), true);
});

test('the menu lists every chapter with both actions and the player is small with a close button', () => {
  const rows = menuRows('commercial', mem());
  assert.deepEqual(rows.map((r) => r.id), WANT.commercial);
  for (const r of rows) assert.ok(r.video.endsWith('.mp4') && r.poster.endsWith('.jpg'));
  const menuSrc = src('tutorial/menu.js');
  for (const needle of ["'Walk me through it'", "'Watch the video'", "'tutorial-video-close'", 'preload', 'poster']) assert.ok(menuSrc.includes(needle), needle);
  assert.match(menuSrc, /\.tut-vid\{[^}]*width:min\(420px/, 'the player is a small overlay, not full screen');
  assert.ok(src('app.js').includes('openMenu(') && src('flow/index.js').includes('openMenu(kind)'), 'the ? button and Show me how open the menu');
});

test('cards sit beside the control and never over the lot or 3D view; a crowded screen falls back to the bottom sheet', () => {
  const view = { w: 1440, h: 900 }, size = { w: 260, h: 120 };
  const target = { left: 100, right: 300, top: 100, bottom: 140, width: 200, height: 40 };
  const stage = { left: 330, right: 1400, top: 60, bottom: 880 };
  const p = placeBeside(target, size, view, [stage]);
  assert.ok(p && (p.left + 260 <= stage.left || p.left >= stage.right || p.top >= stage.bottom || p.top + 120 <= stage.top));
  assert.equal(placeBeside(target, size, view, [{ left: 0, right: 1440, top: 0, bottom: 900 }]), null);
});

test('a crowded screen puts the card in a free corner, never over the lot card or the target', () => {
  const view = { w: 1536, h: 730 }, size = { w: 260, h: 120 };
  const lotCard = { left: 80, right: 520, top: 270, bottom: 670 }; // bottom left, as in split view
  const c = placeCorner({ left: 700, right: 800, top: 100, bottom: 140 }, size, view, [lotCard]);
  assert.ok(c && !(c.left < lotCard.right && c.left + 260 > lotCard.left && c.top < lotCard.bottom && c.top + 120 > lotCard.top));
  assert.equal(placeCorner(null, size, view, [{ left: 0, right: 1536, top: 0, bottom: 730 }]), null);
});

test('the coach steps aside for dialogs and the profile prompt, but not for the guided flow it lives over', () => {
  const doc = (hit) => ({ querySelector: (sel) => (sel === OTHER_PROMPTS ? hit : null) });
  assert.equal(otherPromptOpen(doc(null)), false);
  assert.equal(otherPromptOpen(doc({})), true);
  for (const c of ['.ps-modal', '.ps-prof-prompt', '.gi-terms']) assert.ok(OTHER_PROMPTS.includes(c));
  assert.ok(!OTHER_PROMPTS.includes('aria-modal'), 'the flow root is aria-modal and must not hide the coach');
});
