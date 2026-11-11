// Interactive HTML export: one self-contained file that opens offline. A Plan tab with a floor plan drawn to scale for each
// level and its room schedule, and a 3D tab with the model embedded as a GLB and the viewer (three.js) inlined.
// No network access: no CDN, no web fonts, no links. Pure function, Node compatible. The 3D tab is left out when no GLB is given.

import * as G from '../../model/geometry.js';
import {
  ascii, levelsSorted, wallShapes, doorGeometry, openingLines, stairGeometry, furnitureSize, furnitureCorners, scheduleData,
} from './shared.js';
import { levelContent, ddmmyyyy } from './drawing.js';
import { furnitureStrokes, placeLabel, boxOf } from './symbols.js';
import { TRIAL_CSS, TRIAL_HTML, TRIAL_NOTE } from './watermark.js';
import { BRAND, LOGO_PNG } from '../brand/logo.js';

export const HTML_DISCLAIMER = 'Concept design only. Not for construction. Not a development application drawing. Verify all dimensions on site.';
const INK = BRAND.ink;
const ACCENT = BRAND.accent;
const GREY = '#80848c';
const NEW_FILL = '#26282e';
const EXIST_FILL = '#9ea0a6';
const DEMO = '#c43030';
const DIM = '#3c425a';
const FONT = "Helvetica, Arial, 'Segoe UI', sans-serif";

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const txt = (s) => esc(ascii(s));
const r1 = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${r1(p.x)},${r1(p.y)}`;
const pts = (a) => a.map(pt).join(' ');
const m2 = (v) => `${(Math.round(v * 100) / 100).toFixed(2)} m²`;

/** Floor plan of one level as inline SVG (plan millimetres, y down). Scales with the page and prints. */
export function levelSvg(project, level, { catalogue = null, withSite = false } = {}) {
  const content = levelContent(project, level, withSite, catalogue);
  const { shapes, dims, box } = content;
  const span = Math.max(box.w, box.h, 4000);
  const pad = span * 0.04;
  const below = span * 0.1;
  const view = { x0: box.minX - pad, y0: box.minY - pad, x1: box.maxX + pad, y1: box.maxY + pad + below };
  const sw = (k) => r1(span * k);
  const thin = sw(0.0016);
  const mid = sw(0.0026);
  const fs = span / 72;
  const fsSmall = fs * 0.86;
  const dimFs = Math.max(span / 88, 160);
  const out = [];

  for (const r of level.rooms) {
    if (r.outdoor) out.push(`<polygon points="${pts(r.polygon)}" fill="#f0eee4" stroke="${GREY}" stroke-width="${thin}" stroke-dasharray="${sw(0.008)} ${sw(0.005)}"/>`);
  }

  const furnBoxes = [];
  for (const f of level.furniture) {
    for (const op of furnitureStrokes(catalogue, f)) {
      const w = r1(Math.max(0.5, Math.min(3.5, op.width || 1)) * thin);
      for (const p of op.paths) {
        if (p.pts.length < 2) continue;
        if (op.op === 'fill') {
          if (p.pts.length < 3) continue;
          const k = op.tint ? Math.min(1, op.alpha) : 0;
          const shade = (c) => Math.round(255 - (255 - c) * k);
          out.push(`<polygon points="${pts(p.pts)}" fill="rgb(${shade(128)},${shade(132)},${shade(140)})" stroke="none"/>`);
        } else {
          const dash = op.dash?.length ? ` stroke-dasharray="${op.dash.map((d) => r1(Math.max(20, d))).join(' ')}"` : '';
          const tag = p.closed && p.pts.length > 2 ? 'polygon' : 'polyline';
          out.push(`<${tag} points="${pts(p.pts)}" fill="none" stroke="${GREY}" stroke-width="${w}"${dash}/>`);
        }
      }
    }
    furnBoxes.push(boxOf(furnitureCorners(f, furnitureSize(catalogue, f)), 30));
  }

  for (const st of level.stairs) {
    const g = stairGeometry(st);
    out.push(`<polygon points="${pts(g.corners)}" fill="#fff" stroke="${INK}" stroke-width="${mid}"/>`);
    for (const t of g.treads) out.push(`<line x1="${r1(t[0].x)}" y1="${r1(t[0].y)}" x2="${r1(t[1].x)}" y2="${r1(t[1].y)}" stroke="${INK}" stroke-width="${thin}"/>`);
    for (const a of g.arrow) out.push(`<polyline points="${pts(a)}" fill="none" stroke="${INK}" stroke-width="${mid}"/>`);
  }

  for (const s of shapes) {
    const status = s.wall.status;
    for (const piece of s.pieces) {
      if (status === 'demolish') out.push(`<polygon points="${pts(piece.poly)}" fill="none" stroke="${DEMO}" stroke-width="${thin}" stroke-dasharray="${sw(0.006)} ${sw(0.004)}"/>`);
      else {
        const fill = status === 'existing' ? EXIST_FILL : NEW_FILL;
        out.push(`<polygon points="${pts(piece.poly)}" fill="${fill}" stroke="${fill}" stroke-width="${r1(thin * 0.5)}"/>`);
      }
    }
  }

  const doorBoxes = [];
  for (const s of shapes) {
    for (const sp of s.spans) {
      const o = sp.opening;
      if (o.kind === 'door') {
        const g = doorGeometry(s, o);
        const a0 = Math.atan2(g.F.y - g.H.y, g.F.x - g.H.x);
        let diff = Math.atan2(g.O.y - g.H.y, g.O.x - g.H.x) - a0;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        out.push(`<g fill="none" stroke="${INK}" stroke-width="${thin}"><line x1="${r1(g.H.x)}" y1="${r1(g.H.y)}" x2="${r1(g.O.x)}" y2="${r1(g.O.y)}"/><path d="M${pt(g.F)} A${r1(g.radius)} ${r1(g.radius)} 0 0 ${diff > 0 ? 1 : 0} ${pt(g.O)}"/></g>`);
        doorBoxes.push(boxOf([g.H, g.F, g.O, { x: g.F.x + g.O.x - g.H.x, y: g.F.y + g.O.y - g.H.y }], 20));
      }
      for (const l of openingLines(s, o).lines) out.push(`<line x1="${r1(l[0].x)}" y1="${r1(l[0].y)}" x2="${r1(l[1].x)}" y2="${r1(l[1].y)}" stroke="${INK}" stroke-width="${thin}"/>`);
    }
  }

  // Dimension strings, kept clear of the room labels.
  const dimBoxes = [];
  const dimOut = [];
  for (const d of dims) {
    dimBoxes.push(boxOf([d.a, d.b], 60));
    for (const e of d.ext) {
      dimBoxes.push(boxOf(e, 40));
      dimOut.push(`<line x1="${r1(e[0].x)}" y1="${r1(e[0].y)}" x2="${r1(e[1].x)}" y2="${r1(e[1].y)}"/>`);
    }
    dimOut.push(`<line x1="${r1(d.a.x)}" y1="${r1(d.a.y)}" x2="${r1(d.b.x)}" y2="${r1(d.b.y)}"/>`);
    for (const t of d.ticks) dimOut.push(`<line x1="${r1(t[0].x)}" y1="${r1(t[0].y)}" x2="${r1(t[1].x)}" y2="${r1(t[1].y)}" stroke-width="${mid}"/>`);
    const w = d.text.length * dimFs * 0.56;
    dimBoxes.push(d.textRot ? { x0: d.textAt.x - dimFs, y0: d.textAt.y - w / 2, x1: d.textAt.x + 40, y1: d.textAt.y + w / 2 } : { x0: d.textAt.x - w / 2, y0: d.textAt.y - dimFs, x1: d.textAt.x + w / 2, y1: d.textAt.y + 40 });
    const rot = d.textRot ? ` transform="rotate(-90 ${r1(d.textAt.x)} ${r1(d.textAt.y)})"` : '';
    dimOut.push(`<text x="${r1(d.textAt.x)}" y="${r1(d.textAt.y)}"${rot} text-anchor="middle" fill="${DIM}" stroke="none" font-size="${r1(dimFs)}">${esc(d.text)}</text>`);
  }

  // Room names and areas in the largest clear part of each room.
  const wallBoxes = [];
  for (const s of shapes) for (const pc of s.pieces) wallBoxes.push(boxOf(pc.poly, 10));
  const inset = Math.max(0, ...shapes.map((s) => Number(s.wall.thickness) || 0)) / 2 + span / 400;
  const labelBoxes = [];
  const labels = [];
  for (const r of level.rooms) {
    const name = ascii(r.name) || String(r.type || 'Room');
    const area = m2(G.polygonArea(r.polygon) / 1e6);
    const bb = G.bbox(r.polygon);
    let size = fs;
    const need = Math.max(name.length * 0.6 * size, area.length * 0.52 * fsSmall);
    const room = Math.max(bb.w - 2 * inset, 600);
    if (need > room) size = Math.max(fs * 0.55, size * (room / need));
    const small = size * 0.86;
    const w = Math.max(name.length * 0.6 * size, area.length * 0.52 * small);
    const h = size + small * 1.15;
    const obstacles = [...wallBoxes, ...furnBoxes, ...doorBoxes, ...dimBoxes, ...labelBoxes];
    const centre = G.polygonCentroid(r.polygon);
    const base = { poly: r.polygon, w, h, obstacles, prefer: centre, step: Math.max(span / 220, 40) };
    const spot = placeLabel({ ...base, inset }) || placeLabel({ ...base, inset: span / 800 }) || { x: centre.x, y: centre.y };
    labelBoxes.push({ x0: spot.x - w / 2, y0: spot.y - h / 2, x1: spot.x + w / 2, y1: spot.y + h / 2 });
    const top = spot.y - h / 2;
    labels.push(`<text x="${r1(spot.x)}" y="${r1(top + size * 0.88)}" text-anchor="middle" font-size="${r1(size)}" font-weight="700" fill="${INK}">${esc(name)}</text><text x="${r1(spot.x)}" y="${r1(top + size + small * 1.02)}" text-anchor="middle" font-size="${r1(small)}" fill="${INK}">${esc(area)}</text>`);
  }
  out.push(...labels);

  for (const t of withSite ? project.site?.tanks || [] : []) {
    out.push(`<circle cx="${r1(t.x)}" cy="${r1(t.y)}" r="${r1(t.diameter / 2)}" fill="none" stroke="${INK}" stroke-width="${mid}"/>`);
    out.push(`<text x="${r1(t.x)}" y="${r1(t.y + dimFs * 0.35)}" text-anchor="middle" font-size="${r1(dimFs)}" fill="${INK}">${esc(`RWT ${Math.round(t.capacityL)}L`)}</text>`);
  }
  out.push(`<g stroke="${DIM}" stroke-width="${thin}">${dimOut.join('')}</g>`);

  // Scale bar (true length on the plan) and north arrow.
  const bars = [5, 4, 3, 2, 1].map((n) => ({ n, mm: n * 1000 })).find((c) => c.mm <= box.w * 0.9) || { n: 1, mm: 1000 };
  const parts = bars.n >= 5 ? 5 : bars.n >= 2 ? 2 : 1;
  const by = box.maxY + pad + below * 0.5;
  const bh = span * 0.006;
  for (let i = 0; i < parts; i++) out.push(`<rect x="${r1(box.minX + (bars.mm * i) / parts)}" y="${r1(by)}" width="${r1(bars.mm / parts)}" height="${r1(bh)}" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width="${thin}"/>`);
  out.push(`<text x="${r1(box.minX)}" y="${r1(by - dimFs * 0.35)}" text-anchor="middle" font-size="${r1(dimFs)}" fill="${INK}">0</text>`);
  out.push(`<text x="${r1(box.minX + bars.mm)}" y="${r1(by - dimFs * 0.35)}" text-anchor="middle" font-size="${r1(dimFs)}" fill="${INK}">${bars.n} m</text>`);
  const na = span * 0.03;
  const nx = box.maxX - na;
  const ny = by - na * 0.2;
  const deg = Number(project.site?.northDeg) || 0;
  out.push(`<g transform="rotate(${deg} ${r1(nx)} ${r1(ny)})"><polygon points="${r1(nx)},${r1(ny - na)} ${r1(nx + na * 0.38)},${r1(ny + na * 0.6)} ${r1(nx)},${r1(ny + na * 0.3)} ${r1(nx - na * 0.38)},${r1(ny + na * 0.6)}" fill="${INK}"/><text x="${r1(nx)}" y="${r1(ny - na * 1.12)}" text-anchor="middle" font-size="${r1(dimFs * 1.1)}" font-weight="700" fill="${INK}">N</text></g>`);

  const w = view.x1 - view.x0;
  const h = view.y1 - view.y0;
  const title = `${ascii(level.name) || 'Level'} floor plan`;
  return `<svg class="pa-plan" viewBox="${r1(view.x0)} ${r1(view.y0)} ${r1(w)} ${r1(h)}" role="img" aria-label="${esc(title)}" font-family="${esc(FONT)}" style="aspect-ratio:${r1(w)}/${r1(h)}">${out.join('')}</svg>`;
}

const CSS = `
:root{--ink:${INK};--accent:${ACCENT};--line:#d9dee4;--bg:#f4f6f8;--card:#fff;--mut:#5b6877}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ${FONT}}
header.pa-head{background:#fff;border-bottom:3px solid var(--accent)}
.pa-wrap{max-width:1100px;margin:0 auto;padding:0 16px}
.pa-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0 6px;flex-wrap:wrap}
.pa-logo{height:30px;width:auto;max-width:70vw}
.pa-date{color:var(--mut);font-size:13px}
h1{margin:6px 0 2px;font-size:clamp(22px,4.5vw,32px);line-height:1.2}
.pa-sub{color:var(--mut);margin:0 0 10px}
.pa-stats{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px;padding:0;list-style:none}
.pa-stats li{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:14px}
.pa-stats b{font-size:16px}
.pa-tabs{display:flex;gap:4px;margin:0;padding:0}
.pa-tab{appearance:none;border:0;background:transparent;font:inherit;font-weight:600;color:var(--mut);padding:10px 18px;border-bottom:3px solid transparent;margin-bottom:-3px;cursor:pointer}
.pa-tab[aria-selected=true]{color:var(--ink);border-bottom-color:var(--ink)}
.pa-tab:focus-visible,.pa-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{padding:18px 0 8px}
.pa-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 16px}
.pa-card h2{margin:0 0 8px;font-size:18px}
.pa-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pa-plan{display:block;width:100%;min-width:560px;height:auto;background:#fff}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{background:var(--bg);font-weight:600}
td.n,th.n{text-align:right;white-space:nowrap}
tr.tot td{font-weight:700}
.pa-view{position:relative;background:linear-gradient(#cfe3f2,#f3f7fa 70%);border-radius:10px;overflow:hidden;height:min(72vh,720px);min-height:340px;border:1px solid var(--line)}
.pa-view canvas{display:block;width:100%;height:100%;touch-action:none}
.pa-tools{position:absolute;right:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap;z-index:2}
.pa-btn{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-size:14px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;min-height:36px}
.pa-btn[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.pa-msg{padding:28px 18px;text-align:center;color:var(--mut)}
footer{border-top:1px solid var(--line);background:#fff;margin-top:12px}
footer .pa-wrap{padding:14px 16px 22px;font-size:12.5px;color:var(--mut)}
footer p{margin:0 0 6px}
[hidden]{display:none!important}
@media print{.pa-tabs,.pa-view,.pa-tools{display:none!important}.pa-scroll{overflow:visible}.pa-plan{min-width:0}[data-panel=plan]{display:block!important}body{background:#fff}.pa-card{break-inside:avoid}}
`;

const TAB_JS = `(function(){var tabs=[].slice.call(document.querySelectorAll('.pa-tab')),panels=[].slice.call(document.querySelectorAll('[data-panel]'));
function show(n){tabs.forEach(function(t){t.setAttribute('aria-selected',String(t.dataset.tab===n))});panels.forEach(function(p){p.hidden=p.dataset.panel!==n});
var g=document.getElementById('pa-glb');
if(n==='3d'&&window.PA3D&&!window.PA3D.started&&g){window.PA3D.start(document.getElementById('pa-view'),g.textContent.trim(),g.getAttribute('data-enc')||'')}
if(window.PA3D&&window.PA3D.started)window.PA3D.setActive(n==='3d')}
tabs.forEach(function(t){t.addEventListener('click',function(){show(t.dataset.tab);try{history.replaceState(null,'','#'+t.dataset.tab)}catch(e){}})});
var h=(location.hash||'').slice(1);show(h==='3d'&&document.getElementById('pa-view')?'3d':'plan')})();`;

/**
 * The page. options: { catalogue, config, glb: base64 text of the GLB (or ''), glbEncoding: '' | 'deflate-raw', viewerJs, logo, date }.
 * Returns the HTML text.
 */
export function toHTML(project, options = {}) {
  const { catalogue = null, config = {}, glb = '', glbEncoding = '', viewerJs = '', logo = LOGO_PNG, date = new Date(), trial = false } = options;
  const has3d = !!(glb && viewerJs);
  const levels = levelsSorted(project);
  const data = scheduleData(project);
  const tb = project.titleBlock || {};
  const title = ascii(tb.projectName) || ascii(project.name) || 'Design';
  const when = ascii(tb.date) || ddmmyyyy(date);
  const disclaimer = ascii(config.disclaimer || HTML_DISCLAIMER);
  const seller = config.seller || {};
  const indoor = data.totals.reduce((s, t) => s + t.indoor, 0);
  const outdoor = data.totals.reduce((s, t) => s + t.outdoor, 0);
  const beds = levels.reduce((n, l) => n + l.rooms.filter((r) => r.type === 'bedroom').length, 0);
  const stats = [`<li><b>${esc(m2(indoor))}</b> indoor</li>`];
  if (outdoor > 0) stats.push(`<li><b>${esc(m2(outdoor))}</b> outdoor</li>`);
  stats.push(`<li><b>${levels.length}</b> ${levels.length === 1 ? 'level' : 'levels'}</li>`);
  if (beds) stats.push(`<li><b>${beds}</b> ${beds === 1 ? 'bedroom' : 'bedrooms'}</li>`);
  const sub = [ascii(tb.client), ascii(tb.address)].filter(Boolean).join(' | ');

  const sections = levels.map((level, i) => {
    const totals = data.totals[i];
    const rows = data.rooms.filter((r) => r.level === ascii(level.name)).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td class="n">${esc(m2(r.area))}</td></tr>`);
    const name = ascii(level.name) || 'Level';
    return `<section class="pa-card" aria-label="${esc(name)} floor plan"><h2>${esc(name)} floor plan</h2><div class="pa-scroll">${levelSvg(project, level, { catalogue, withSite: i === 0 })}</div></section>
<section class="pa-card"><h2>${esc(name)} rooms</h2><div class="pa-scroll"><table><thead><tr><th>Room</th><th>Type</th><th class="n">Area (m²)</th></tr></thead><tbody>${rows.join('')}<tr class="tot"><td colspan="2">Total indoor</td><td class="n">${esc(m2(totals.indoor))}</td></tr>${totals.outdoor > 0 ? `<tr class="tot"><td colspan="2">Total outdoor</td><td class="n">${esc(m2(totals.outdoor))}</td></tr>` : ''}</tbody></table></div></section>`;
  });

  const tabs = `<nav class="pa-tabs" role="tablist" aria-label="Views"><button class="pa-tab" role="tab" data-tab="plan" aria-selected="true">Plan</button>${has3d ? '<button class="pa-tab" role="tab" data-tab="3d" aria-selected="false">3D</button>' : ''}</nav>`;
  const view3d = has3d ? '<div data-panel="3d" hidden><div class="pa-view" id="pa-view" aria-label="Interactive 3D model"><div class="pa-tools"><button class="pa-btn" id="pa-reset" type="button">Reset view</button><button class="pa-btn" id="pa-roof" type="button" aria-pressed="true" hidden>Roof on</button></div></div></div>' : '';
  const scripts = has3d ? `<script id="pa-glb" type="text/plain"${glbEncoding ? ` data-enc="${esc(glbEncoding)}"` : ''}>${glb}</script>\n<script>${viewerJs.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>\n` : '';
  const product = BRAND.name;
  const company = [ascii(seller.name), seller.abn ? `ABN ${ascii(seller.abn)}` : ''].filter(Boolean).join(' | ');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(product)}</title>
<meta name="robots" content="noindex">
<style>${CSS}${trial ? TRIAL_CSS : ''}</style>${trial ? `\n<meta name="generator" content="${TRIAL_NOTE}">` : ''}
</head>
<body>${trial ? `\n${TRIAL_HTML}` : ''}
<header class="pa-head"><div class="pa-wrap">
<div class="pa-top"><img class="pa-logo" src="${esc(logo)}" alt="${esc(product)}"><span class="pa-date">${esc(when)}</span></div>
<h1>${esc(title)}</h1>
${sub ? `<p class="pa-sub">${esc(sub)}</p>` : ''}
<ul class="pa-stats">${stats.join('')}</ul>
${tabs}
</div></header>
<main><div class="pa-wrap">
<div data-panel="plan">${sections.join('\n')}</div>
${view3d}
</div></main>
<footer><div class="pa-wrap"><p>${esc(disclaimer)}</p><p>${esc(product)} | ${esc(config.productName || 'Pocket Architect')}${company ? ` | ${esc(company)}` : ''} | Prepared ${esc(when)}</p></div></footer>
${scripts}<script>${TAB_JS}</script>
</body>
</html>
`;
}
