// In-page usability audit used by the site review: contrast (WCAG AA), controls without an accessible name, text that overflows its box,
// dashes and banned words, small touch targets. Returns plain objects; callers print them.
//   const { audit } = require('./review-audit.cjs'); const r = await audit(page, 'step-3');
async function audit(pageOrFrame, label = '') {
  return pageOrFrame.evaluate((label) => {
    const out = { label, contrast: [], unlabeled: [], clipped: [], text: [], small: [], hscroll: false };
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const bgOf = (el) => {
      const stack = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null; // image behind: cannot judge
        if (/gradient/.test(cs.backgroundImage || '')) return null;
        const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      }
      let base = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
      return base;
    };
    const covered = (el) => { const r = el.getBoundingClientRect(); const x = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 2), y = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 2); if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false; const t = document.elementFromPoint(x, y); return !!t && !el.contains(t) && !t.contains(el); };
    const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; if (covered(el)) return false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || e.hidden) return false; } return true; };
    const sel = (el) => { const d = el.getAttribute('data-ps'); return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (d ? `[data-ps=${d}]` : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''); };
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; let count = 0;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue.trim(); if (t.length < 2) continue;
      const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName) || !visible(el)) continue;
      if (el.closest('canvas, svg')) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
      const f = over(fg, bg); const r = ratio(f, bg);
      const px = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700; const large = px >= 24 || (px >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (r < need) { const k = sel(el) + t.slice(0, 20); if (!seen.has(k) && count++ < 60) { seen.add(k); out.contrast.push({ el: sel(el), text: t.slice(0, 50), ratio: Math.round(r * 100) / 100, need, fg: cs.color, px }); } }
    }
    // Controls without an accessible name.
    document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab], [role=switch], [role=checkbox]').forEach((el) => {
      if (!visible(el) || el.type === 'hidden') return;
      const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const name = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el.labels && el.labels.length) || id || el.innerText || el.textContent || el.getAttribute('placeholder') || el.value || '');
      const hasImgAlt = el.querySelector('img[alt]:not([alt=""]), svg[aria-label], svg title');
      if (!String(name).trim() && !hasImgAlt && !el.closest('label')) out.unlabeled.push({ el: sel(el), html: el.outerHTML.slice(0, 120) });
    });
    // Text clipped by its own box (overflow hidden or ellipsis) and elements that overflow the viewport.
    document.querySelectorAll('body *').forEach((el) => {
      if (!visible(el) || /^(CANVAS|SVG|PATH|SCRIPT|STYLE|IMG)$/i.test(el.tagName)) return;
      const cs = getComputedStyle(el);
      if (!el.children.length && el.textContent.trim() && (el.scrollWidth > el.clientWidth + 2) && /hidden|clip/.test(cs.overflowX) && el.clientWidth > 0) out.clipped.push({ el: sel(el), text: el.textContent.trim().slice(0, 50), sw: el.scrollWidth, cw: el.clientWidth, ellipsis: cs.textOverflow === 'ellipsis' });
      if (!el.children.length && el.textContent.trim() && el.scrollHeight > el.clientHeight + 3 && /hidden|clip/.test(cs.overflowY) && el.clientHeight > 0) out.clipped.push({ el: sel(el), text: el.textContent.trim().slice(0, 50), sh: el.scrollHeight, ch: el.clientHeight, v: true });
      if (['BUTTON', 'A', 'INPUT', 'SELECT'].includes(el.tagName) || el.getAttribute('role') === 'button') { const r = el.getBoundingClientRect(); if (out.small.length < 12 && window.innerWidth < 600 && (r.height < 32 || r.width < 32) && r.width > 0) out.small.push({ el: sel(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 30) }); }
    });
    out.hscroll = document.documentElement.scrollWidth > window.innerWidth + 2;
    const txt = document.body.innerText;
    if (/[–—]/.test(txt)) out.text.push('dash: ' + (txt.match(/.{0,25}[–—].{0,25}/) || [''])[0].replace(/\n/g, ' '));
    if (/compliant/i.test(txt)) out.text.push('word compliant');
    const prices = txt.match(/A?\$\s?\d[\d,.]*\s*(?:incl\.?[^.\n]{0,20})?(?:per|\/)\s*\w+/gi); if (prices) out.text.push('prices: ' + [...new Set(prices)].join(' | '));
    return out;
  }, label);
}
function show(r) {
  const lines = [`== ${r.label}${r.hscroll ? '  [HORIZONTAL SCROLL]' : ''}`];
  for (const c of r.contrast) lines.push(`  contrast ${c.ratio}<${c.need} ${c.el} "${c.text}" ${c.fg} ${c.px}px`);
  for (const c of r.unlabeled) lines.push(`  unlabeled ${c.el} ${c.html}`);
  for (const c of r.clipped) lines.push(`  clipped ${c.el} "${c.text}" ${c.sw ? `${c.sw}>${c.cw}` : `${c.sh}>${c.ch}`}`);
  for (const c of r.small) lines.push(`  small ${c.el} ${c.w}x${c.h} "${c.text}"`);
  for (const c of r.text) lines.push('  text ' + c);
  return lines.join('\n');
}
module.exports = { audit, show };
