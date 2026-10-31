// Looping SVG explainers. Each scene is build(g) -> update(t) with t in [0,1). Static frame under reduced motion.

import { reducedMotion } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 240;
const H = 140;
const LINE = 'var(--ps-line)';
const ACC = 'var(--ps-accent)';
const SOFT = 'var(--ps-accent-soft)';

const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const ease = (x) => x * x * (3 - 2 * x);

function el(tag, attrs = {}, style = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  Object.assign(e.style, style);
  return e;
}
const add = (parent, ...kids) => {
  kids.forEach((k) => parent.append(k));
  return kids[0];
};
function setR(e, x, y, w, h) {
  e.setAttribute('x', Math.min(x, x + w));
  e.setAttribute('y', Math.min(y, y + h));
  e.setAttribute('width', Math.abs(w));
  e.setAttribute('height', Math.abs(h));
}
function setL(e, x1, y1, x2, y2) {
  e.setAttribute('x1', x1); e.setAttribute('y1', y1); e.setAttribute('x2', x2); e.setAttribute('y2', y2);
}
const rect = (g, style) => add(g, el('rect', {}, style));
const line = (g, style) => add(g, el('line', {}, { strokeLinecap: 'round', ...style }));
const text = (g, x, y, s, size = 11, style = {}) => {
  const t = el('text', { x, y, 'text-anchor': 'middle' }, { fontSize: `${size}px`, fontFamily: 'var(--ps-font-ui)', fill: 'var(--ps-text)', ...style });
  t.textContent = s;
  g.append(t);
  return t;
};

function cursor(g) {
  const c = el('g');
  c.append(el('path', { d: 'M0 0 L0 15 L4 11.5 L7 18 L9.5 17 L6.5 10.5 L12 10.5 Z' }, { fill: '#fff', stroke: '#111', strokeWidth: '1.2', strokeLinejoin: 'round' }));
  g.append(c);
  return { el: c, to(x, y, press = false) { c.setAttribute('transform', `translate(${x} ${y}) scale(${press ? 0.9 : 1})`); } };
}
function ripple(g) {
  const r = el('circle', { r: 0 }, { fill: 'none', stroke: ACC, strokeWidth: '2' });
  g.append(r);
  return (x, y, p) => {
    r.setAttribute('cx', x); r.setAttribute('cy', y);
    r.setAttribute('r', 3 + p * 14);
    r.style.opacity = p > 0 && p < 1 ? String(1 - p) : '0';
  };
}
function grid(g) {
  for (let x = 20; x < W; x += 20) { const l = line(g, { stroke: "var(--ps-grid-minor)", strokeWidth: "1" }); setL(l, x, 0, x, H); }
  for (let y = 20; y < H; y += 20) { const l = line(g, { stroke: 'var(--ps-grid-minor)', strokeWidth: '1' }); setL(l, 0, y, W, y); }
}
function keycap(g, x, y, label, w = 24) {
  const r = add(g, el('rect', { x, y, width: w, height: 24, rx: 5, class: 'pso-key' }));
  const t = text(g, x + w / 2, y + 16, label, 12, { fontWeight: '600' });
  return (on) => {
    r.style.fill = on ? ACC : '';
    r.style.transform = on ? 'translateY(1.5px)' : '';
    t.style.fill = on ? '#fff' : 'var(--ps-text)';
  };
}
function sofa(g) {
  const s = el('g');
  s.append(
    el('rect', { x: -22, y: -11, width: 44, height: 22, rx: 4 }, { fill: SOFT, stroke: LINE, strokeWidth: '1.6' }),
    el('rect', { x: -22, y: -11, width: 44, height: 7, rx: 3 }, { fill: 'var(--ps-border-strong)', stroke: LINE, strokeWidth: '1.2' }),
    el('line', { x1: 0, y1: -4, x2: 0, y2: 11 }, { stroke: LINE, strokeWidth: '1' }),
  );
  g.append(s);
  return (x, y, rot) => s.setAttribute('transform', `translate(${x} ${y}) rotate(${rot})`);
}

const SCENES = {
  select(g) {
    grid(g);
    const home = el('rect', { x: 20, y: 20, width: 200, height: 100 }, { fill: 'var(--ps-room-a)', stroke: LINE, strokeWidth: '3' });
    g.append(home);
    const place = sofa(g);
    const sel = rect(g, { fill: 'none', stroke: ACC, strokeWidth: '1.5', strokeDasharray: '4 3' });
    const cur = cursor(g);
    return (t) => {
      const m = ease(seg(t, 0.2, 0.6));
      const x = lerp(70, 150, m);
      const y = lerp(80, 60, m);
      place(x, y, 0);
      sel.style.opacity = t > 0.12 && t < 0.92 ? '1' : '0';
      setR(sel, x - 25, y - 14, 50, 28);
      cur.to(lerp(60, x + 4, seg(t, 0, 0.2)) + (t > 0.2 ? 0 : 0), lerp(95, y + 2, seg(t, 0, 0.2)), t > 0.2 && t < 0.6);
    };
  },
  room(g) {
    grid(g);
    const r = rect(g, { fill: 'var(--ps-room-a)', stroke: LINE, strokeWidth: '4' });
    const lab = text(g, 120, 76, 'Living', 12);
    const cur = cursor(g);
    return (t) => {
      const p = ease(seg(t, 0.15, 0.6));
      const x = lerp(40, 190, p);
      const y = lerp(30, 108, p);
      r.style.opacity = t > 0.15 && t < 0.95 ? '1' : '0';
      r.style.strokeDasharray = t < 0.62 ? '5 4' : '';
      setR(r, 40, 30, x - 40, y - 30);
      lab.style.opacity = String(seg(t, 0.65, 0.78) * (1 - seg(t, 0.9, 0.97)));
      cur.to(t < 0.15 ? 40 : x, t < 0.15 ? 30 : y, t > 0.15 && t < 0.62);
    };
  },
  wall(g) {
    grid(g);
    const pts = [[36, 108], [36, 36], [130, 36], [200, 84]];
    const segs = [0, 1, 2].map(() => line(g, { stroke: LINE, strokeWidth: '5' }));
    const rip = ripple(g);
    const cur = cursor(g);
    return (t) => {
      const stops = [0.1, 0.32, 0.54, 0.76];
      let cx = pts[0][0];
      let cy = pts[0][1];
      segs.forEach((s, i) => {
        const p = ease(seg(t, stops[i], stops[i + 1] - 0.06));
        s.style.opacity = t > stops[i] && t < 0.96 ? '1' : '0';
        setL(s, pts[i][0], pts[i][1], lerp(pts[i][0], pts[i + 1][0], p), lerp(pts[i][1], pts[i + 1][1], p));
        if (t >= stops[i]) { cx = lerp(pts[i][0], pts[i + 1][0], p); cy = lerp(pts[i][1], pts[i + 1][1], p); }
      });
      cur.to(cx, cy);
      const k = stops.findIndex((s) => t >= s && t < s + 0.1);
      rip(...(k >= 0 ? [pts[k][0], pts[k][1], (t - stops[k]) / 0.1] : [0, 0, 0]));
    };
  },
  window(g) {
    return openingScene(g, false);
  },
  door(g) {
    return openingScene(g, true);
  },
  furniture(g) {
    grid(g);
    g.append(el('rect', { x: 20, y: 20, width: 200, height: 100 }, { fill: 'var(--ps-room-a)', stroke: LINE, strokeWidth: '3' }));
    const place = sofa(g);
    const k1 = keycap(g, 150, 100, ',');
    const k2 = keycap(g, 180, 100, '.');
    const cur = cursor(g);
    return (t) => {
      const m = ease(seg(t, 0.1, 0.45));
      const rot = ease(seg(t, 0.55, 0.75)) * 90;
      const x = lerp(55, 100, m);
      const y = lerp(105, 60, m);
      place(x, y, rot);
      k1(t > 0.55 && t < 0.75);
      k2(false);
      cur.to(x + 6, y + 4, t > 0.1 && t < 0.45);
      cur.el.style.opacity = t < 0.5 ? '1' : '0';
    };
  },
  wheel(g) {
    const k = keycap(g, 24, 58, 'Q', 28);
    const wheel = el('g');
    const slots = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const s = el('circle', { cx: Math.cos(a) * 44, cy: Math.sin(a) * 44, r: 14 }, { fill: 'var(--ps-field)', stroke: 'var(--ps-border-strong)', strokeWidth: '1.5' });
      wheel.append(s);
      slots.push(s);
    }
    wheel.append(el('circle', { r: 11 }, { fill: SOFT, stroke: ACC, strokeWidth: '1.5' }));
    g.append(wheel);
    return (t) => {
      const p = ease(seg(t, 0.2, 0.4));
      k(t > 0.15 && t < 0.3);
      wheel.setAttribute('transform', `translate(150 70) scale(${0.2 + p * 0.8})`);
      wheel.style.opacity = String(p * (1 - seg(t, 0.92, 1)));
      const pick = t > 0.6 ? 1 : t > 0.5 ? 2 : -1;
      slots.forEach((s, i) => { s.style.fill = i === pick && t > 0.5 ? ACC : 'var(--ps-field)'; });
    };
  },
  measure(g) {
    grid(g);
    const A = [44, 96];
    const B = [196, 54];
    const l = line(g, { stroke: ACC, strokeWidth: '2', strokeDasharray: '5 4' });
    const da = add(g, el('circle', { cx: A[0], cy: A[1], r: 4 }, { fill: ACC }));
    const db = add(g, el('circle', { cx: B[0], cy: B[1], r: 4 }, { fill: ACC }));
    const lab = text(g, 120, 62, '3.42 m', 13, { fontWeight: '600', fill: ACC });
    const rip = ripple(g);
    const cur = cursor(g);
    return (t) => {
      const m = ease(seg(t, 0.35, 0.65));
      da.style.opacity = t > 0.12 ? '1' : '0';
      db.style.opacity = t > 0.65 ? '1' : '0';
      l.style.opacity = t > 0.12 && t < 0.95 ? '1' : '0';
      setL(l, A[0], A[1], lerp(A[0], B[0], m), lerp(A[1], B[1], m));
      lab.style.opacity = String(seg(t, 0.68, 0.78) * (1 - seg(t, 0.92, 0.98)));
      cur.to(t < 0.12 ? lerp(70, A[0], seg(t, 0, 0.12)) : lerp(A[0], B[0], m), t < 0.12 ? lerp(120, A[1], seg(t, 0, 0.12)) : lerp(A[1], B[1], m));
      rip(...(t > 0.12 && t < 0.22 ? [A[0], A[1], (t - 0.12) / 0.1] : t > 0.65 && t < 0.75 ? [B[0], B[1], (t - 0.65) / 0.1] : [0, 0, 0]));
    };
  },
  tank(g) {
    grid(g);
    g.append(el('rect', { x: 28, y: 22, width: 130, height: 96 }, { fill: 'var(--ps-room-a)', stroke: LINE, strokeWidth: '3' }));
    const tank = el('g');
    tank.append(el('circle', { r: 17 }, { fill: 'var(--ps-room-b)', stroke: LINE, strokeWidth: '2' }), el('circle', { r: 11 }, { fill: 'none', stroke: LINE, strokeWidth: '1', strokeDasharray: '2 2' }));
    g.append(tank);
    const rip = ripple(g);
    const cur = cursor(g);
    return (t) => {
      const c = ease(seg(t, 0.1, 0.4));
      tank.style.opacity = t > 0.45 && t < 0.95 ? '1' : '0';
      tank.setAttribute('transform', `translate(190 ${lerp(64, 70, 0)}) scale(${1 + (t < 0.55 ? (0.55 - t) * 0.8 : 0)})`);
      cur.to(lerp(110, 190, c), lerp(120, 70, c), t > 0.4 && t < 0.5);
      rip(...(t > 0.4 && t < 0.52 ? [190, 70, (t - 0.4) / 0.12] : [0, 0, 0]));
    };
  },
  underlay(g) {
    const img = el('g');
    img.append(el('rect', { x: -70, y: -40, width: 140, height: 80 }, { fill: 'var(--ps-warning-soft)', stroke: 'var(--ps-warning)', strokeWidth: '1.5', opacity: '0.85' }),
      el('path', { d: 'M-50 25 L-50 -20 L-5 -20 L-5 0 L45 0 L45 25 Z' }, { fill: 'none', stroke: 'var(--ps-warning)', strokeWidth: '2' }));
    g.append(img);
    const p1 = add(g, el('circle', { cx: 70, cy: 50, r: 4 }, { fill: ACC }));
    const p2 = add(g, el('circle', { cx: 160, cy: 50, r: 4 }, { fill: ACC }));
    const l = line(g, { stroke: ACC, strokeWidth: '2' });
    const chip = el('g');
    chip.append(el('rect', { x: -26, y: -11, width: 52, height: 22, rx: 4 }, { fill: 'var(--ps-field)', stroke: ACC, strokeWidth: '1.5' }));
    g.append(chip);
    const chipTxt = text(chip, 0, 4, '5.00 m', 11, { fontWeight: '600' });
    const cur = cursor(g);
    return (t) => {
      const s = lerp(0.75, 1.1, ease(seg(t, 0.72, 0.9)));
      img.setAttribute('transform', `translate(120 70) scale(${s})`);
      p1.style.opacity = t > 0.15 ? '1' : '0';
      p2.style.opacity = t > 0.4 ? '1' : '0';
      const m = ease(seg(t, 0.2, 0.4));
      l.style.opacity = t > 0.2 ? '1' : '0';
      setL(l, 70, 50, lerp(70, 160, m), 50);
      chip.setAttribute('transform', 'translate(115 34)');
      chip.style.opacity = String(seg(t, 0.5, 0.6));
      chipTxt.textContent = '5.00 m';
      cur.to(t < 0.2 ? lerp(40, 70, seg(t, 0, 0.15)) : lerp(70, 160, m), 50 + (t < 0.2 ? 30 * (1 - seg(t, 0, 0.15)) : 0));
      cur.el.style.opacity = t < 0.5 ? '1' : '0';
    };
  },
  stairs(g) {
    grid(g);
    const r = rect(g, { fill: 'var(--ps-room-a)', stroke: LINE, strokeWidth: '2.5' });
    const steps = Array.from({ length: 7 }, () => line(g, { stroke: LINE, strokeWidth: '1.5' }));
    const cur = cursor(g);
    return (t) => {
      const p = ease(seg(t, 0.15, 0.55));
      const x = lerp(80, 120, p);
      const y = lerp(24, 118, p);
      r.style.opacity = t > 0.15 && t < 0.95 ? '1' : '0';
      setR(r, 80, 24, x - 80, y - 24);
      steps.forEach((s, i) => {
        const yy = 24 + ((y - 24) * (i + 1)) / 8;
        s.style.opacity = t > 0.55 && t < 0.95 ? '1' : '0';
        setL(s, 80, yy, x, yy);
      });
      cur.to(t < 0.15 ? 80 : x, t < 0.15 ? 24 : y, t > 0.15 && t < 0.55);
    };
  },
  deck(g) {
    grid(g);
    g.append(el('rect', { x: 20, y: 20, width: 110, height: 100 }, { fill: 'var(--ps-room-a)', stroke: LINE, strokeWidth: '3' }));
    const r = rect(g, { fill: 'var(--ps-room-outdoor)', stroke: LINE, strokeWidth: '2' });
    const planks = Array.from({ length: 6 }, () => line(g, { stroke: LINE, strokeWidth: '1', opacity: '0.5' }));
    const cur = cursor(g);
    return (t) => {
      const p = ease(seg(t, 0.15, 0.55));
      const x = lerp(140, 215, p);
      const y = lerp(30, 110, p);
      r.style.opacity = t > 0.15 && t < 0.95 ? '1' : '0';
      setR(r, 140, 30, x - 140, y - 30);
      planks.forEach((s, i) => {
        const yy = 30 + ((y - 30) * (i + 1)) / 7;
        s.style.opacity = t > 0.55 && t < 0.95 ? '0.5' : '0';
        setL(s, 140, yy, x, yy);
      });
      cur.to(t < 0.15 ? 140 : x, t < 0.15 ? 30 : y, t > 0.15 && t < 0.55);
    };
  },
  status(g) {
    grid(g);
    const walls = [[30, 100, 30, 40], [30, 40, 120, 40], [120, 40, 210, 40], [210, 40, 210, 100]].map((c) => {
      const l = line(g, { strokeWidth: '6' });
      setL(l, ...c);
      return l;
    });
    const cur = cursor(g);
    const paint = (l, k) => {
      l.style.stroke = k === 0 ? 'var(--ps-wall-existing)' : k === 1 ? LINE : 'var(--ps-wall-demolish)';
      l.style.strokeDasharray = k === 2 ? '6 4' : '';
    };
    return (t) => {
      walls.forEach((l, i) => paint(l, i === 1 ? (t > 0.4 ? 2 : 0) : i === 2 ? (t > 0.7 ? 1 : 0) : 0));
      const px = t < 0.4 ? lerp(40, 75, seg(t, 0, 0.35)) : lerp(75, 165, seg(t, 0.45, 0.68));
      cur.to(px, 46, (t > 0.35 && t < 0.45) || (t > 0.68 && t < 0.76));
    };
  },
  '3d'(g) {
    const ground = el('ellipse', { cx: 120, cy: 100, rx: 80, ry: 18 }, { fill: 'var(--ps-room-b)' });
    g.append(ground);
    const faces = Array.from({ length: 6 }, () => add(g, el('polygon', {}, { stroke: LINE, strokeWidth: '1.5', strokeLinejoin: 'round' })));
    const cur = cursor(g);
    const verts = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => [x * 38, y * 22, z * 30]);
    const idx = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 3, 7, 4], [1, 2, 6, 5]];
    const shade = ['var(--ps-panel-2)', 'var(--ps-field)', 'var(--ps-accent-soft)', 'var(--ps-hover)', 'var(--ps-panel)', 'var(--ps-border)'];
    return (t) => {
      const yaw = lerp(-0.6, 0.7, ease(seg(t, 0.15, 0.85)));
      const pitch = 0.5;
      const proj = verts.map(([x, y, z]) => {
        const x1 = x * Math.cos(yaw) - z * Math.sin(yaw);
        const z1 = x * Math.sin(yaw) + z * Math.cos(yaw);
        const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
        return { x: 120 + x1, y: 68 + y2, z: z2 };
      });
      const order = idx.map((f, i) => ({ f, i, z: f.reduce((s, k) => s + proj[k].z, 0) / 4 })).sort((a, b) => b.z - a.z);
      order.forEach(({ f, i }, n) => {
        faces[n].setAttribute('points', f.map((k) => `${proj[k].x},${proj[k].y}`).join(' '));
        faces[n].style.fill = shade[i];
      });
      cur.to(lerp(80, 160, ease(seg(t, 0.15, 0.85))), 126, t > 0.15 && t < 0.85);
    };
  },
  walk(g) {
    const floor = el('polygon', { points: `0,${H} ${W},${H} 150,84 90,84` }, { fill: 'var(--ps-room-d)' });
    const ceil = el('polygon', { points: `0,0 ${W},0 150,56 90,56` }, { fill: 'var(--ps-panel-2)' });
    const lw = el('polygon', {}, { fill: 'var(--ps-panel)', stroke: LINE, strokeWidth: '1' });
    const rw = el('polygon', {}, { fill: 'var(--ps-panel)', stroke: LINE, strokeWidth: '1' });
    const end = el('rect', {}, { fill: 'var(--ps-accent-soft)', stroke: LINE, strokeWidth: '1' });
    const door = el('rect', {}, { fill: 'var(--ps-border-strong)', stroke: LINE, strokeWidth: '1' });
    g.append(floor, ceil, lw, rw, end, door);
    const kw = keycap(g, 30, 74, 'W');
    const ka = keycap(g, 2, 100, 'A');
    const ks = keycap(g, 30, 100, 'S');
    const kd = keycap(g, 58, 100, 'D');
    const ke = keycap(g, 196, 104, 'E');
    return (t) => {
      const p = ease(seg(t, 0.1, 0.6));
      const half = lerp(26, 52, p);
      const top = 70 - lerp(18, 36, p);
      const bot = 70 + lerp(18, 36, p);
      const l = 120 - half;
      const r = 120 + half;
      lw.setAttribute('points', `0,0 ${l},${top} ${l},${bot} 0,${H}`);
      rw.setAttribute('points', `${W},0 ${r},${top} ${r},${bot} ${W},${H}`);
      setR(end, l, top, r - l, bot - top);
      const open = ease(seg(t, 0.7, 0.9));
      setR(door, 120 - half * 0.45, top + (bot - top) * 0.2, half * 0.9 * (1 - open * 0.8), (bot - top) * 0.8);
      kw(t > 0.1 && t < 0.6);
      ka(false); ks(false); kd(false);
      ke(t > 0.68 && t < 0.92);
    };
  },
};

function openingScene(g, isDoor) {
  grid(g);
  const wl = line(g, { stroke: LINE, strokeWidth: '8' });
  setL(wl, 20, 78, 220, 78);
  const gap = rect(g, { fill: 'var(--ps-canvas)' });
  const frame = rect(g, { fill: 'var(--ps-accent-soft)', stroke: ACC, strokeWidth: '2' });
  const arc = el('path', {}, { fill: 'none', stroke: LINE, strokeWidth: '1.5', strokeDasharray: '3 2' });
  g.append(arc);
  const rip = ripple(g);
  const cur = cursor(g);
  return (t) => {
    const m = ease(seg(t, 0.12, 0.5));
    const w = isDoor ? 34 : 50;
    const x = lerp(60, 130, m) - w / 2;
    const y = lerp(26, 74, m);
    const snapped = t > 0.5 && t < 0.96;
    setR(frame, x, y, w, 8);
    frame.style.opacity = t > 0.08 && t < 0.96 ? (snapped ? '1' : '0.7') : '0';
    setR(gap, 130 - w / 2, 73, snapped ? w : 0, 10);
    if (isDoor) {
      arc.setAttribute('d', `M ${130 - w / 2} 78 L ${130 - w / 2} ${78 - w} A ${w} ${w} 0 0 1 ${130 + w / 2} 78`);
      arc.style.opacity = snapped ? '1' : '0';
    }
    cur.to(lerp(100, 130, m) + 6, lerp(60, 70, m) + 2, t > 0.5 && t < 0.58);
    cur.el.style.opacity = t < 0.65 ? '1' : '0';
    rip(...(t > 0.5 && t < 0.62 ? [130, 78, (t - 0.5) / 0.12] : [0, 0, 0]));
  };
}

SCENES.sliding_door = SCENES.door;
SCENES.garage_door = SCENES.door;
SCENES.roller_door = SCENES.door;
SCENES.opening = SCENES.door;

export const HINT_TEXT = {
  select: 'Click a piece to select it, then drag it to move it.',
  room: 'Drag a rectangle on the plan. The walls are drawn for you.',
  wall: 'Click each corner in turn. Double click or press Esc to finish.',
  door: 'Hover a wall and click to place a door. Tab flips the swing.',
  sliding_door: 'Hover a wall and click to place a sliding door.',
  garage_door: 'Hover a wall and click to place a garage door.',
  roller_door: 'Hover a wall and click to place a roller door.',
  opening: 'Hover a wall and click to cut a plain opening.',
  window: 'Hover a wall and click to place a window. It snaps to the wall.',
  furniture: 'Pick an item, drag it onto the plan, then press comma or full stop to rotate it.',
  stairs: 'Drag a rectangle where the stairs should go.',
  deck: 'Drag a rectangle for a deck, patio or alfresco area.',
  tank: 'Click on the plan to place a tank. Choose its size in the panel.',
  measure: 'Click two points to read the distance. Nothing is saved.',
  underlay: 'Add an image, click two known points, then enter the true distance to set the scale.',
  status: 'Click walls or rooms to mark them existing, new or demolish.',
  wheel: 'Press Q to open the furniture wheel, then choose an item.',
  '3d': 'Drag to orbit and scroll to zoom. Click a wall to change its finish.',
  walk: 'Use W, A, S and D to walk and the mouse to look. Hold E near a door to open it.',
};

export const HINT_TITLE = {
  select: 'Select and move', room: 'Draw a room', wall: 'Draw walls', door: 'Add a door', sliding_door: 'Sliding door', garage_door: 'Garage door', roller_door: 'Roller door', opening: 'Plain opening', window: 'Add a window',
  furniture: 'Place furniture', stairs: 'Add stairs', deck: 'Deck or patio', tank: 'Rainwater tank', measure: 'Measure', underlay: 'Trace an underlay', status: 'Status brush', wheel: 'Furniture wheel', '3d': '3D view', walk: 'Walk through',
};

export const hasScene = (id) => id in SCENES;

// Mounts a scene into a new svg and returns it with a stop() function.
export function createAnim(id, { period = 4200 } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pso-anim', role: 'img', 'aria-label': HINT_TITLE[id] || 'Animation' });
  const g = el('g');
  svg.append(g);
  const update = (SCENES[id] || SCENES.select)(g);
  let raf = 0;
  let stopped = false;
  if (reducedMotion()) {
    update(id === 'wheel' ? 0.7 : id === '3d' ? 0.5 : 0.8);
    return { svg, stop() {} };
  }
  const t0 = performance.now();
  const frame = (now) => {
    if (stopped) return;
    if (svg.isConnected) update(((now - t0) % period) / period);
    raf = requestAnimationFrame(frame);
  };
  update(0);
  raf = requestAnimationFrame(frame);
  return { svg, stop() { stopped = true; cancelAnimationFrame(raf); } };
}
