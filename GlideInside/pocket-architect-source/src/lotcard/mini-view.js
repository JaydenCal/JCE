// The corner top view (the mini map on the lot card) can be moved, zoomed and turned without opening the large view:
// drag to pan, scroll or pinch to zoom, right-drag or Shift and drag or a two-finger twist to rotate, and a small button puts it back.
// The canvas keeps its own drawing; the view is a CSS transform on it, so the house move and turn handles in lot-card.js keep working
// (they ask `toLocal` for the canvas point under the pointer). The maths has no DOM and is unit tested.
import { h } from '../ui/dom.js';

const RAD = Math.PI / 180;
export const MINI_ZOOM = { min: 0.7, max: 12 };
export const defaultView = () => ({ z: 1, x: 0, y: 0, rot: 0 });
export const isDefault = (v) => v.z === 1 && v.x === 0 && v.y === 0 && v.rot === 0;
const rv = (x, y, deg) => { const c = Math.cos(deg * RAD); const s = Math.sin(deg * RAD); return { x: x * c - y * s, y: x * s + y * c }; };
const wrap = (d) => ((d % 360) + 360) % 360;
const clampPan = (v, w, h) => ({ ...v, x: Math.max(-w * v.z, Math.min(w * v.z, v.x)), y: Math.max(-h * v.z, Math.min(h * v.z, v.y)) });

/** CSS transform string for a view (the element's origin is its centre). */
export const cssOf = (v) => `translate(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px) rotate(${v.rot.toFixed(2)}deg) scale(${v.z.toFixed(4)})`;

/** The point of the untransformed canvas (px from its centre) under a pointer at (sx, sy) px from the box centre. */
export function toLocal(v, sx, sy) {
  const d = rv(sx - v.x, sy - v.y, -v.rot);
  return { x: d.x / v.z, y: d.y / v.z };
}
/** Zoom by `factor` about (sx, sy), which keeps the point under it. */
export function zoomAbout(v, factor, sx, sy, w, h) {
  const z = Math.min(MINI_ZOOM.max, Math.max(MINI_ZOOM.min, v.z * factor));
  const p = toLocal(v, sx, sy);
  const d = rv(p.x * z, p.y * z, v.rot);
  return clampPan({ ...v, z, x: sx - d.x, y: sy - d.y }, w, h);
}
/** Turn by `deg` clockwise about (sx, sy), which keeps the point under it. */
export function turnAbout(v, deg, sx, sy, w, h) {
  const rot = wrap(v.rot + deg);
  const p = toLocal(v, sx, sy);
  const d = rv(p.x * v.z, p.y * v.z, rot);
  return clampPan({ ...v, rot, x: sx - d.x, y: sy - d.y }, w, h);
}
export const panView = (v, dx, dy, w, h) => clampPan({ ...v, x: v.x + dx, y: v.y + dy }, w, h);

const RESET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l4 6h-8zM12 21v-8M5 14a7 7 0 0 0 14 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {Object} o
 * @param {HTMLElement} o.mini      The mini map box (not transformed).
 * @param {HTMLCanvasElement} o.cv  Its canvas (transformed).
 * @param {SVGElement} [o.north]    North arrow; turned by the view plus northDeg().
 * @param {Function} [o.northDeg]   () => degrees the project's north is turned from the top.
 * @param {Function} [o.yielding]   () => true while another gesture (moving the house) owns the pointer.
 */
export function attachMiniView({ mini, cv, north = null, northDeg = () => 0, yielding = () => false }) {
  let view = defaultView();
  const ptrs = new Map();
  let g = null; // { d, a, mid } while two pointers are down
  let mode = null; // 'pan' | 'turn'
  let moved = false;
  let clickBlock = false;
  const box = () => { const r = mini.getBoundingClientRect(); return { w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  const rel = (e) => { const b = box(); return { x: e.clientX - b.cx, y: e.clientY - b.cy }; };
  const reset = h('button', { class: 'lc-mini-reset', type: 'button', hidden: true, title: 'Reset the top view (north up, whole lot)', 'aria-label': 'Reset top view: north up, whole lot', dataset: { ps: 'lc-mini-reset' }, onclick: (e) => { e.stopPropagation(); view = defaultView(); apply(); } });
  reset.innerHTML = RESET_ICON;
  mini.append(reset);

  function apply() {
    cv.style.transform = isDefault(view) ? '' : cssOf(view);
    cv.style.transformOrigin = '50% 50%';
    reset.hidden = isDefault(view);
    if (north) north.style.transform = `rotate(${(northDeg() + view.rot).toFixed(2)}deg)`;
  }
  const point = (e) => rel(e);
  const ang = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const wrap180 = (d) => ((d + 540) % 360) - 180;

  mini.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.lc-mini-x, .lc-mini-reset')) return;
    if (e.button > 2 || e.button === 1) return;
    if (yielding()) return;
    ptrs.set(e.pointerId, point(e));
    moved = false;
    mode = e.button === 2 || e.shiftKey ? 'turn' : 'pan';
    try { mini.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; g = { d: Math.hypot(a.x - b.x, a.y - b.y), a: ang(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; mode = 'pinch'; moved = true; }
    e.preventDefault();
  });
  mini.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || yielding()) return;
    const p = point(e);
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, p);
    const { w, h: hh } = box();
    if (ptrs.size === 1) {
      if (!moved) { const start = mini._mvStart || (mini._mvStart = prev); if (Math.hypot(p.x - start.x, p.y - start.y) < 4) return; }
      moved = true;
      if (mode === 'turn') view = turnAbout(view, wrap180(ang({ x: 0, y: 0 }, p) - ang({ x: 0, y: 0 }, prev)), 0, 0, w, hh);
      else view = panView(view, p.x - prev.x, p.y - prev.y, w, hh);
      apply();
      return;
    }
    if (ptrs.size === 2 && g) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const an = ang(a, b);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (g.d > 0 && d > 0) view = zoomAbout(view, d / g.d, mid.x, mid.y, w, hh);
      view = turnAbout(view, wrap180(an - g.a), mid.x, mid.y, w, hh);
      view = panView(view, mid.x - g.mid.x, mid.y - g.mid.y, w, hh);
      g = { d, a: an, mid };
      apply();
    }
  });
  const up = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    try { mini.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (ptrs.size < 2) g = null;
    if (!ptrs.size) {
      mini._mvStart = null;
      mode = null;
      if (moved) { clickBlock = true; setTimeout(() => { clickBlock = false; }, 0); }
    }
  };
  mini.addEventListener('pointerup', up);
  mini.addEventListener('pointercancel', up);
  mini.addEventListener('contextmenu', (e) => e.preventDefault());
  mini.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 300 : 1;
    const p = rel(e);
    const { w, h: hh } = box();
    view = zoomAbout(view, Math.exp(-e.deltaY * unit * 0.002), p.x, p.y, w, hh);
    apply();
  }, { passive: false });
  mini.style.touchAction = 'none';

  return {
    view: () => ({ ...view }),
    apply,
    reset: () => { view = defaultView(); apply(); },
    /** True once after a drag, so the click that follows it does not open the large view. */
    consumeClick: () => { const v = clickBlock; clickBlock = false; return v; },
    /** The canvas point (px from its centre) under a client position. */
    toLocal: (clientX, clientY) => { const b = box(); return toLocal(view, clientX - b.cx, clientY - b.cy); },
    dispose: () => reset.remove(),
  };
}
