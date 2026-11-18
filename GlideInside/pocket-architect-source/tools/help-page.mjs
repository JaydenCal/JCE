// Writes the video grid into website-live/help/index.html between the VIDEOS markers, from the chapter data and videos/manifest.json.
//   node tools/help-page.mjs        (also called by tools/make-tutorial-videos.mjs after a recording run)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, BASICS_ID } from '../src/tutorial/steps.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SITE = path.resolve(here, '../../website-live');
export const HELP = path.join(SITE, 'help');
export const VIDEOS = path.join(HELP, 'videos');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const DESC = {
  residential: { basics: 'The whole residential tool in a few minutes: find a lot, pick a design, place it, check it in 3D and get the plan set.' },
  commercial: { basics: 'The whole commercial tool in a few minutes: find a site, choose a building, place it, draw the car park and read the numbers.' },
};

export function renderGrid(manifest = {}) {
  const out = [];
  for (const kind of ['residential', 'commercial']) {
    const label = kind === 'residential' ? 'Residential' : 'Commercial';
    out.push(`<div class="vid-group" data-mode="${kind}" id="${kind}">`);
    out.push(`  <h2>${label}: how to videos</h2>`);
    out.push('  <div class="vid-grid">');
    for (const c of CHAPTERS[kind]) {
      const m = manifest[c.video];
      const title = c.id === BASICS_ID ? `${label} overview` : c.title;
      const blurb = DESC[kind][c.id] || c.blurb;
      out.push(`    <article class="card vid${c.id === BASICS_ID ? ' vid-wide' : ''}" id="${c.video}">`);
      out.push(`      <video controls preload="none" playsinline width="1280" height="800" poster="videos/${c.video}.jpg" aria-label="${esc(title)}"><source src="videos/${c.video}.mp4" type="video/mp4"><a href="videos/${c.video}.mp4">Watch the video: ${esc(title)}</a></video>`);
      out.push(`      <h3>${esc(title)}</h3>`);
      out.push(`      <p>${esc(blurb)}</p>`);
      out.push(`      <p class="muted vid-len">${m ? `${clock(m.seconds)} video` : 'Short video'}</p>`);
      out.push('    </article>');
    }
    out.push('  </div>');
    out.push('</div>');
  }
  return out.join('\n');
}

export function updatePage() {
  const file = path.join(HELP, 'index.html');
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(VIDEOS, 'manifest.json'), 'utf8')); } catch { /* no videos yet */ }
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('<!-- VIDEOS:START -->'), b = html.indexOf('<!-- VIDEOS:END -->');
  if (a < 0 || b < 0) throw new Error('help/index.html has no VIDEOS markers');
  fs.writeFileSync(file, `${html.slice(0, a)}<!-- VIDEOS:START -->\n${renderGrid(manifest)}\n${html.slice(b)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { updatePage(); console.log('help page updated'); }
