// The "Show me how" menu and the small video player. The menu lists every chapter of the tool in use with two actions each:
// "Walk me through it" (the guided tour of that chapter) and "Watch the video" (a short how to clip in a small overlay player).
// The player sits in the bottom right corner, never covers the whole screen and has a close button. Wording rule: no dashes.
import { h } from '../ui/dom.js';
import { chaptersFor, chapterDone, chapterProgress, videoUrl, posterUrl } from './steps.js';

export const HELP_PAGE = '/help/';
export const MENU_CSS = `
.tut-menu{position:fixed;z-index:2147483001;top:56px;right:12px;width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 76px);display:flex;flex-direction:column;box-sizing:border-box;border-radius:14px;background:#12263a;color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.4)}
.tut-menu[hidden],.tut-vid[hidden]{display:none}
.tut-menu-hd{display:flex;align-items:center;gap:8px;padding:14px 16px 6px}.tut-menu-hd h2{margin:0;font:700 16px/1.2 system-ui,sans-serif;flex:1}
.tut-menu-sub{padding:0 16px 8px;font-size:12px;opacity:.75}
.tut-x{font:inherit;cursor:pointer;width:32px;height:32px;border-radius:16px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;padding:0}
.tut-chapters{list-style:none;margin:0;padding:0 8px 8px;overflow:auto}
.tut-chapter{padding:10px 8px;border-top:1px solid rgba(255,255,255,.12)}
.tut-chapter-t{display:flex;align-items:center;gap:8px;font-weight:700}.tut-chapter-t .tut-tick{width:18px;height:18px;border-radius:9px;border:1.5px solid rgba(255,255,255,.4);flex:none;font-size:11px;line-height:15px;text-align:center}
.tut-chapter[data-done="true"] .tut-tick{background:#c7a256;border-color:#c7a256;color:#12263a}
.tut-chapter-b{margin:2px 0 8px 26px;font-size:12px;opacity:.75}
.tut-chapter-a{display:flex;gap:8px;margin-left:26px;flex-wrap:wrap}
.tut-chapter-a button{font:inherit;font-size:12px;cursor:pointer;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;padding:6px 10px;min-height:32px}
.tut-chapter-a .tut-walk{background:#c7a256;color:#12263a;border-color:#c7a256;font-weight:700}
.tut-menu-ft{padding:10px 16px 14px;border-top:1px solid rgba(255,255,255,.12);font-size:12px}.tut-menu-ft a{color:#fff}
.tut-vid{position:fixed;z-index:2147483002;right:16px;bottom:16px;width:min(420px,calc(100vw - 32px));box-sizing:border-box;border-radius:12px;background:#12263a;color:#fff;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden}
.tut-vid-hd{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px}.tut-vid-hd span{flex:1}
.tut-vid video{display:block;width:100%;aspect-ratio:16/9;background:#000}
.tut-vid-ft{padding:6px 12px 8px;font-size:11.5px;font-weight:500}.tut-vid-ft a{color:#fff}
@media (max-width:600px){.tut-menu{top:auto;bottom:8px;right:8px;left:8px;width:auto;max-height:80vh}.tut-vid{right:8px;bottom:8px;width:calc(100vw - 16px)}}
`;

/** Pure: the rows the menu shows for a mode, with each chapter's done state and video address. */
export function menuRows(kind, storage) {
  return chaptersFor(kind).map((c) => ({ id: c.id, title: c.title, blurb: c.blurb, steps: c.steps.length, done: chapterDone(kind, c.id, storage), video: videoUrl(c), poster: posterUrl(c) }));
}

export function createHelpMenu({ onWalk, storage } = {}) {
  let kind = 'residential';
  const title = h('h2', null, 'Show me how');
  const sub = h('div', { class: 'tut-menu-sub' });
  const list = h('ul', { class: 'tut-chapters', dataset: { ps: 'tutorial-chapters' } });
  const close = h('button', { type: 'button', class: 'tut-x', 'aria-label': 'Close', dataset: { ps: 'tutorial-menu-close' }, onclick: () => hide() }, '×');
  const menu = h('div', { class: 'tut-menu', hidden: true, role: 'dialog', 'aria-label': 'Show me how', dataset: { ps: 'tutorial-menu' } },
    h('div', { class: 'tut-menu-hd' }, title, close), sub, list,
    h('div', { class: 'tut-menu-ft' }, h('a', { href: HELP_PAGE, target: '_blank', rel: 'noopener', dataset: { ps: 'tutorial-help-page' } }, 'See all how to videos')));

  const vTitle = h('span');
  const vCl = h('button', { type: 'button', class: 'tut-x', 'aria-label': 'Close video', dataset: { ps: 'tutorial-video-close' }, onclick: () => closeVideo() }, '×');
  const vWrap = h('div', { class: 'tut-vid', hidden: true, role: 'dialog', 'aria-label': 'How to video', dataset: { ps: 'tutorial-video-player' } },
    h('div', { class: 'tut-vid-hd' }, vTitle, vCl));
  let video = null;

  if (typeof document !== 'undefined') {
    const st = document.createElement('style'); st.textContent = MENU_CSS; document.head.append(st);
    document.body.append(menu, vWrap);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!vWrap.hidden) closeVideo(); else if (!menu.hidden) hide(); } });
  }

  function paint() {
    const p = chapterProgress(kind, storage);
    title.textContent = kind === 'commercial' ? 'Show me how: Commercial' : 'Show me how: Residential';
    sub.textContent = `${p.done} of ${p.total} chapters done. Pick a chapter and walk through it, or watch a short video.`;
    list.replaceChildren(...menuRows(kind, storage).map((r) => h('li', { class: 'tut-chapter', dataset: { ps: 'tutorial-chapter', chapter: r.id, done: String(r.done) } },
      h('div', { class: 'tut-chapter-t' }, h('span', { class: 'tut-tick', 'aria-hidden': 'true' }, r.done ? '✓' : ''), r.title),
      h('div', { class: 'tut-chapter-b' }, r.blurb),
      h('div', { class: 'tut-chapter-a' },
        h('button', { type: 'button', class: 'tut-walk', dataset: { ps: 'tutorial-walk', chapter: r.id }, onclick: () => { hide(); onWalk?.(kind, r.id); } }, 'Walk me through it'),
        h('button', { type: 'button', dataset: { ps: 'tutorial-video', chapter: r.id }, onclick: () => { hide(); playVideo(r); } }, 'Watch the video')))));
  }
  function show(k) { kind = k === 'commercial' ? 'commercial' : 'residential'; closeVideo(); paint(); menu.hidden = false; menu.querySelector('.tut-walk')?.focus?.(); }
  function hide() { menu.hidden = true; }
  function playVideo(r) {
    closeVideo();
    vTitle.textContent = r.title;
    video = h('video', { controls: true, autoplay: true, playsinline: true, preload: 'metadata', poster: r.poster, src: r.video, 'aria-label': `How to video: ${r.title}`, dataset: { ps: 'tutorial-video-el' } });
    vWrap.insertBefore(video, vWrap.querySelector('.tut-vid-ft'));
    if (!vWrap.querySelector('.tut-vid-ft')) vWrap.append(h('div', { class: 'tut-vid-ft' }, h('a', { href: HELP_PAGE, target: '_blank', rel: 'noopener' }, 'More how to videos')));
    vWrap.hidden = false;
  }
  function closeVideo() { if (video) { try { video.pause(); } catch { /* none */ } video.removeAttribute('src'); try { video.load(); } catch { /* none */ } video.remove(); video = null; } vWrap.hidden = true; }
  return { menu, player: vWrap, show, hide, playVideo, closeVideo, get open() { return !menu.hidden; }, get playing() { return !vWrap.hidden; } };
}
