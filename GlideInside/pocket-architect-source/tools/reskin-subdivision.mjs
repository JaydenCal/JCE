// Puts the new Glide Inside header and footer on the live /subdivision/ page without touching anything else in it.
// Usage: node tools/reskin-subdivision.mjs <live subdivision/index.html> [<output file>]   (default output: <input>.reskinned.html)
// The header and footer HTML are in tools/subdivision-chrome/, the CSS is website-live/assets/gi-chrome.css (upload it to public_html/assets/).
// Rules: replaces the first <header>...</header> and the last <footer>...</footer> (or the first <nav> block, or an insert after <body>,
// and an insert before </body>, when the page has none); links the stylesheet if missing; everything else stays byte for byte.
// It is safe to run twice: its own blocks are wrapped in comment markers and replaced in place.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
export const CSS_LINK = '<link rel="stylesheet" href="/assets/gi-chrome.css?v=20261111">';
const NEW_ABN = 'ABN 29 699 165 663';
const mark = (name, html) => `<!--gi-chrome:${name}:start-->\n${html.trim()}\n<!--gi-chrome:${name}:end-->`;

export function reskin(html, { header, footer } = {}) {
  header ??= readFileSync(resolve(here, 'subdivision-chrome/header.html'), 'utf8');
  footer ??= readFileSync(resolve(here, 'subdivision-chrome/footer.html'), 'utf8');
  const notes = [];
  let out = html;
  const own = (name) => new RegExp(`<!--gi-chrome:${name}:start-->[\\s\\S]*?<!--gi-chrome:${name}:end-->`);

  // Header
  if (own('header').test(out)) { out = out.replace(own('header'), () => mark('header', header)); notes.push('header: replaced earlier new header'); }
  else {
    const m = /<header\b[^>]*>[\s\S]*?<\/header>/i.exec(out);
    if (m) { out = out.slice(0, m.index) + mark('header', header) + out.slice(m.index + m[0].length); notes.push('header: replaced <header>'); }
    else {
      const n = /<nav\b[^>]*>[\s\S]*?<\/nav>/i.exec(out);
      const b = /<body\b[^>]*>/i.exec(out);
      if (n && b && n.index - (b.index + b[0].length) < 3000) { out = out.slice(0, n.index) + mark('header', header) + out.slice(n.index + n[0].length); notes.push('header: replaced the first <nav> near the top (no <header>)'); }
      else if (b) { const at = b.index + b[0].length; out = out.slice(0, at) + '\n' + mark('header', header) + out.slice(at); notes.push('header: inserted after <body> (page had none)'); }
      else throw new Error('No <body> found; is this the right file?');
    }
  }
  // Footer
  if (own('footer').test(out)) { out = out.replace(own('footer'), () => mark('footer', footer)); notes.push('footer: replaced earlier new footer'); }
  else {
    const all = [...out.matchAll(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi)];
    const m = all.at(-1);
    if (m) { out = out.slice(0, m.index) + mark('footer', footer) + out.slice(m.index + m[0].length); notes.push('footer: replaced <footer>'); }
    else {
      const at = out.toLowerCase().lastIndexOf('</body>');
      if (at < 0) throw new Error('No </body> found; is this the right file?');
      out = out.slice(0, at) + mark('footer', footer) + '\n' + out.slice(at); notes.push('footer: inserted before </body> (page had none)');
    }
  }
  // Stylesheet
  if (!/assets\/gi-chrome\.css/.test(out)) {
    const at = out.toLowerCase().indexOf('</head>');
    if (at < 0) throw new Error('No </head> found');
    out = out.slice(0, at) + CSS_LINK + '\n' + out.slice(at); notes.push('css: linked gi-chrome.css');
  }
  // ABN: the new footer carries the right entity. Report any other ABN left in the page (not edited: the rest stays byte for byte).
  const outside = out.replace(own('footer'), '');
  const others = [...new Set((outside.match(/ABN[\s:]*\d[\d ]{8,}\d/gi) || []).filter((s) => s.replace(/\s/g, '') !== NEW_ABN.replace(/\s/g, '')))];
  if (others.length) notes.push(`WARNING other ABN text still in the page: ${others.join(' | ')}`);
  return { html: out, notes };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [src, dst] = process.argv.slice(2);
  if (!src) { console.error('Usage: node tools/reskin-subdivision.mjs <subdivision/index.html> [output]'); process.exit(2); }
  const r = reskin(readFileSync(resolve(src), 'utf8'));
  const outPath = resolve(dst || `${src}.reskinned.html`);
  writeFileSync(outPath, r.html);
  console.log(r.notes.map((n) => '  ' + n).join('\n'));
  console.log(`wrote ${outPath}`);
}
