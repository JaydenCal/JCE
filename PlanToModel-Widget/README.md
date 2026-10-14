# Plan to 3D model widget

A scroll-driven showcase: a plan sheet (shown like a PDF) dissolves into a live 3D model as the visitor scrolls.
From about 60% a mouse drag orbits the model. "Take control" locks the page scroll, enables wheel zoom and shows a column of view buttons (Services first). Moving the pointer off the model gives normal scrolling back. Esc or Release exits.
Two demo projects with a toggle: a residential development and an industrial warehouse. All project, client, street, lot and company details have been removed.

## Quick start
1. Upload the whole folder to any web host (it must be served over http/https; opening index.html from disk works for a quick look in most browsers).
2. Open `index.html` to see it working. To use it on your own page, copy the `<section id="showcase">` block from `index.html` into your page, then add:
   - `<link rel="stylesheet" href="css/ptm.css">` in `<head>` (restyle by editing the CSS variables at the top: `--gold`, `--gold2`, `--bg`, `--text`)
   - before `</body>`: `vendor/gsap.min.js`, `vendor/ScrollTrigger.min.js`, `js/ptm.js` (in that order)
3. Keep these folders together, relative to the page: `assets/ css/ js/ model/ models/ vendor/`.

## Swapping in your own content
- Plan sheets: replace `assets/plan-a.webp` and `assets/plan-b.webp` (any aspect ratio; crop off any title block you do not want shown).
- Models are self-contained three.js viewers: `model/index.html` (residential) and `models/warehouse.html` + `models/warehouse.js` (industrial). The model data is the big `MODEL = {...}` object at the top of each.
- Text: edit the labels, captions (`CAPS` in `js/ptm.js`) and alt text in the section markup.

## How the page talks to the viewers (postMessage)
Parent to viewer: `{type:'morph', t:0..1}`, `{type:'control', on:true|false}`, `{type:'orbit', on, zoom}`, `{type:'view', id}`.
Viewer to parent: `{type:'ready', views:[{id,label}]}`, `{type:'engage'}`, `{type:'release'}`, `{type:'wheel', dy}`.
The viewers also work on their own: open `model/index.html` or `models/warehouse.html` directly for the full viewer with layers and a views bar.

## Notes
- Needs WebGL. Without it the plan sheet stays on screen and a note is shown.
- `prefers-reduced-motion` skips the pinning and shows the finished model.
- Touch devices: orbit and zoom start after pressing "Take control" so the page can still scroll.
- Third-party code included: GSAP + ScrollTrigger (check GSAP's licence for your use), three.js r147 and OrbitControls (MIT).
- Fonts load from Google Fonts (Jost, IBM Plex); remove the link tag to use your own.
