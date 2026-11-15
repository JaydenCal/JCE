#!/usr/bin/env node
// SEO-009: static SEO checks for GlideInside/website-live. No dependencies. Usage: node tools/seo-check.mjs [siteDir]
// Failures exit 1. Pages in the live-server-only folders (subdivision/) are reported as warnings because they are not edited here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(process.argv[2] || path.join(here, '..', 'website-live'));
const ORIGIN = 'https://glideinside.com.au';
const SOFT = ['subdivision/'];
const SKIP = ['plan-studio/app/', '_review/', '_review-shots/', 'node_modules/'];
const fails = [], warns = [];
const fail = (p, m) => (SOFT.some(s => p.startsWith(s)) ? warns : fails).push(`${p}: ${m}`);
const warn = (p, m) => warns.push(`${p}: ${m}`);

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name), rel = path.relative(site, f).split(path.sep).join('/');
    if (e.isDirectory()) { if (!SKIP.some(s => (rel + '/').startsWith(s)) && !rel.startsWith('subdivision/ptm') && !rel.startsWith('assets')) walk(f, out); }
    else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}
const pages = walk(site).sort();
const urlOf = rel => rel === 'index.html' ? ORIGIN + '/' : rel.endsWith('/index.html') ? ORIGIN + '/' + rel.slice(0, -10) : ORIGIN + '/' + rel;
const attr = (tag, name) => { const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? (m[2] ?? m[3]) : null; };
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

const indexable = new Set();
for (const rel of pages) {
  const html = fs.readFileSync(path.join(site, rel), 'utf8');
  const head = (/<head[\s\S]*?<\/head>/i.exec(html) || [''])[0];
  const robots = (/<meta[^>]+name=["']robots["'][^>]*>/i.exec(head) || [''])[0];
  const noindex = /noindex/i.test(attr(robots, 'content') || '');
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // 1. internal links to index.html
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const h = attr(m[0], 'href') || '';
    if (/index\.html/i.test(h)) fail(rel, `internal link to index.html variant: ${h}`);
  }
  for (const m of body.matchAll(/<(?:link|img|form|iframe)\b[^>]*>/gi)) {
    const h = attr(m[0], 'href') || attr(m[0], 'action') || '';
    if (/index\.html/i.test(h)) fail(rel, `reference to index.html variant: ${h}`);
  }

  // 2. canonical
  const canon = (/<link[^>]+rel=["']canonical["'][^>]*>/i.exec(head) || [''])[0];
  const cHref = attr(canon, 'href');
  if (!noindex) {
    indexable.add(urlOf(rel));
    if (!cHref) fail(rel, 'missing canonical');
    else {
      const want = urlOf(rel);
      // legal pages use a .html canonical which is their real URL
      if (cHref !== want) fail(rel, `canonical ${cHref} does not match ${want}`);
      if (/index\.html/.test(cHref)) fail(rel, 'canonical contains index.html');
      if (!cHref.startsWith(ORIGIN + '/')) fail(rel, 'canonical is not absolute apex https');
    }
    // 3. one H1
    const h1 = (body.match(/<h1\b/gi) || []).length;
    if (h1 !== 1) fail(rel, `expected exactly 1 h1, found ${h1}`);
    // 4. title, description, lang, og
    const title = decode(((/<title>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || '').trim());
    const desc = decode(attr((/<meta[^>]+name=["']description["'][^>]*>/i.exec(head) || [''])[0], 'content') || '');
    if (!title) fail(rel, 'missing title'); else if (title.length > 70) warn(rel, `title ${title.length} chars`);
    if (!desc) fail(rel, 'missing meta description'); else if (desc.length > 170) warn(rel, `description ${desc.length} chars`);
    if (!/<html[^>]+lang=["']en-AU["']/i.test(html)) fail(rel, 'html lang is not en-AU');
    for (const t of ['og:title', 'og:description', 'og:type', 'og:url']) if (!new RegExp(`property=["']${t}["']`).test(head)) warn(rel, `missing ${t}`);
    if (!/property=["']og:image["']/.test(head)) warn(rel, 'missing og:image');
  }
  // 5. JSON-LD parses
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); const nodes = j['@graph'] || [j]; for (const n of nodes) if (!n['@type']) fail(rel, 'JSON-LD node without @type'); if (/aggregateRating|"review"|Review"/.test(m[1])) fail(rel, 'JSON-LD contains rating or review markup'); }
    catch (e) { fail(rel, 'JSON-LD does not parse: ' + e.message); }
  }
  // 6. images: alt present
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) if (attr(m[0], 'alt') === null) fail(rel, `img without alt: ${(attr(m[0], 'src') || '').slice(0, 60)}`);

  // 7. visible copy: no em or en dash, no "compliant"
  const visible = decode(body.replace(/<[^>]+>/g, ' ') + ' ' + [...head.matchAll(/<(?:title)>([\s\S]*?)<\/title>|content=["']([^"']*)["']/gi)].map(x => x[1] || x[2] || '').join(' ') + ' ' + [...body.matchAll(/(?:alt|aria-label|title|placeholder)=["']([^"']*)["']/gi)].map(x => x[1]).join(' '));
  if (/[\u2013\u2014]/.test(visible) || /&(?:mdash|ndash);|&#821[12];|&#x201[34];/i.test(body)) fail(rel, 'em or en dash in visible copy');
  if (/compliant/i.test(visible)) fail(rel, 'the word "compliant" appears in visible copy');
}

// 8. sitemap
const sm = fs.readFileSync(path.join(site, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
const seen = new Set();
for (const u of locs) {
  if (seen.has(u)) fails.push(`sitemap.xml: duplicate ${u}`); seen.add(u);
  if (!u.startsWith(ORIGIN + '/')) { fails.push(`sitemap.xml: not apex https: ${u}`); continue; }
  if (/index\.html|\?|#/.test(u)) fails.push(`sitemap.xml: non canonical form ${u}`);
  const rel = u.slice(ORIGIN.length + 1);
  const ok = rel === '' ? fs.existsSync(path.join(site, 'index.html')) : rel.endsWith('/') ? fs.existsSync(path.join(site, rel, 'index.html')) : fs.existsSync(path.join(site, rel));
  if (!ok) fails.push(`sitemap.xml: ${u} has no local file`);
  const pageRel = rel === '' ? 'index.html' : rel.endsWith('/') ? rel + 'index.html' : rel;
  if (pages.includes(pageRel) && !indexable.has(u)) fails.push(`sitemap.xml: ${u} is noindex`);
}
for (const must of ['/', '/for-builders/', '/commercial/', '/book-a-demo/']) if (!seen.has(ORIGIN + must)) fails.push(`sitemap.xml: missing ${must}`);
// 9. robots
const rb = fs.readFileSync(path.join(site, 'robots.txt'), 'utf8');
if (!/Sitemap:\s*https:\/\/glideinside\.com\.au\/sitemap\.xml/i.test(rb)) fails.push('robots.txt: sitemap not referenced');
const dis = [...rb.matchAll(/^Disallow:\s*(\S+)/gim)].map(m => m[1]);
for (const u of locs) { const p = '/' + u.slice(ORIGIN.length + 1); for (const d of dis) if (d !== '/' && p.startsWith(d)) fails.push(`robots.txt: blocks sitemap URL ${u} via ${d}`); }
for (const d of dis) if (d === '/') fails.push('robots.txt: Disallow / blocks everything');
for (const need of ['/plan-studio/app/']) if (!dis.includes(need)) fails.push(`robots.txt: expected Disallow ${need}`);

console.log(`pages checked: ${pages.length}, indexable: ${indexable.size}, sitemap URLs: ${locs.length}`);
if (warns.length) { console.log(`\nWARNINGS (${warns.length})`); warns.forEach(w => console.log('  ' + w)); }
if (fails.length) { console.log(`\nFAILURES (${fails.length})`); fails.forEach(f => console.log('  ' + f)); process.exit(1); }
console.log('\nAll SEO checks passed.');
