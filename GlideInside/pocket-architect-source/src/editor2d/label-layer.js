// Label collision avoidance for the commercial 2D plan. During one frame every upright text drawn on the canvas (room names, tank and
// fuel island labels, plan labels) is collected, then placed so no two overlap: a label that collides is nudged up or down (and a little
// sideways) to the nearest free spot, and a thin leader line joins it to what it labels. Rotated text (aisle and bay labels along a row)
// is drawn where it is and only reserves its space. Pure placement in resolveLabels (testable without a canvas); createLabelLayer wraps a
// 2D context.

const PAD = 2; // px kept clear around a label

const overlaps = (a, b) => a.x0 < b.x1 + PAD && a.x1 > b.x0 - PAD && a.y0 < b.y1 + PAD && a.y1 > b.y0 - PAD;

/**
 * items: [{ x, y, w, h, align: 'left'|'center'|'right'|'start'|'end', base: 'middle'|'top'|'bottom'|'alphabetic', fixed?: bool }] in screen px.
 * bounds: { w, h } of the canvas. Returns one result per item: { x, y, moved: bool, hidden: bool }.
 * Items are placed in order (earlier items win their spot). A fixed item never moves; it only reserves its box.
 */
export function resolveLabels(items, bounds = null) {
  const boxOf = (it, x, y) => {
    const left = it.align === 'center' ? x - it.w / 2 : it.align === 'right' || it.align === 'end' ? x - it.w : x;
    const top = it.base === 'middle' ? y - it.h / 2 : it.base === 'bottom' ? y - it.h : it.base === 'top' ? y : y - it.h * 0.8;
    return { x0: left, y0: top, x1: left + it.w, y1: top + it.h };
  };
  const placed = [];
  const out = [];
  for (const it of items) {
    let best = { x: it.x, y: it.y, moved: false };
    let box = boxOf(it, it.x, it.y);
    if (!it.fixed && placed.some((p) => overlaps(box, p))) {
      let found = null;
      for (let k = 1; k <= 6 && !found; k++) {
        for (const dx of [0, it.w * 0.35, -it.w * 0.35]) {
          for (const sgn of [-1, 1]) {
            const x = it.x + dx;
            const y = it.y + sgn * k * (it.h + 1);
            const b = boxOf(it, x, y);
            if (bounds && (b.x0 < 2 || b.y0 < 2 || b.x1 > bounds.w - 2 || b.y1 > bounds.h - 2)) continue;
            if (placed.some((p) => overlaps(b, p))) continue;
            found = { x, y, moved: true, box: b };
            break;
          }
          if (found) break;
        }
      }
      if (found) { best = found; box = found.box; }
    }
    placed.push(box);
    out.push({ x: best.x, y: best.y, moved: !!best.moved, hidden: false, box });
  }
  return out;
}

const NONE = new Set(['fillText', 'strokeText']);

/** Wrap a 2D context: fillText and strokeText are collected until flush(); everything else is passed straight through. */
export function createLabelLayer(g) {
  const items = [];
  const halos = new Map();
  const key = (t, x, y) => `${t}\u0001${Math.round(x)}\u0001${Math.round(y)}`;
  const upright = () => { const m = g.getTransform(); return Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6; };
  const snap = () => ({ font: g.font, fill: g.fillStyle, stroke: g.strokeStyle, lw: g.lineWidth, align: g.textAlign, base: g.textBaseline, alpha: g.globalAlpha });
  const ctx = new Proxy(g, {
    get(target, prop) {
      if (prop === 'fillText') {
        return (text, x, y, max) => {
          if (!upright()) { target.fillText(text, x, y, max); return; }
          const m = target.getTransform();
          const px = m.a * x + m.e; const py = m.d * y + m.f;
          const s = snap();
          const prev = target.font;
          const w = target.measureText(String(text)).width * m.a;
          const hgt = (parseFloat(/(\d+(?:\.\d+)?)px/.exec(s.font)?.[1]) || 10) * 1.15 * m.d;
          target.font = prev;
          items.push({ text: String(text), x: px, y: py, w, h: hgt, align: s.align, base: s.base, style: s, halo: halos.get(key(text, px, py)) || null, max });
        };
      }
      if (prop === 'strokeText') {
        return (text, x, y, max) => {
          if (!upright()) { target.strokeText(text, x, y, max); return; }
          const m = target.getTransform();
          halos.set(key(text, m.a * x + m.e, m.d * y + m.f), snap());
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  function flush(bounds = null) {
    if (!items.length) return { moved: 0 };
    const res = resolveLabels(items, bounds);
    let moved = 0;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    items.forEach((it, i) => {
      const r = res[i];
      g.font = it.style.font; g.textAlign = it.style.align; g.textBaseline = it.style.base;
      if (r.moved) {
        moved += 1;
        // leader line from the original anchor to the label
        g.globalAlpha = 0.7; g.strokeStyle = it.style.fill; g.lineWidth = 1;
        const cx = it.align === 'center' ? r.x : it.align === 'right' || it.align === 'end' ? r.x - it.w / 2 : r.x + it.w / 2;
        g.beginPath(); g.moveTo(it.x, it.y); g.lineTo(cx, r.y); g.stroke();
        g.beginPath(); g.arc(it.x, it.y, 1.8, 0, Math.PI * 2); g.fillStyle = it.style.fill; g.fill();
      }
      if (it.halo) { g.globalAlpha = it.halo.alpha; g.strokeStyle = it.halo.stroke; g.lineWidth = it.halo.lw; g.strokeText(it.text, r.x, r.y); }
      g.globalAlpha = it.style.alpha; g.fillStyle = it.style.fill; g.fillText(it.text, r.x, r.y);
    });
    g.restore();
    items.length = 0; halos.clear();
    return { moved };
  }
  return { ctx, flush, count: () => items.length };
}
void NONE;
