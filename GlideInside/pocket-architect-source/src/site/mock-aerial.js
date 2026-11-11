// A synthetic "aerial" for the sample lots (roads, lawns, roofs, trees) drawn on a canvas, so the underlay and the 3D
// terrain texture have something to show in mock mode. Browser only. It is a picture of nothing real.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const inRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const ROOFS = [['#8f4b3a', '#a65a45'], ['#5d6266', '#72787c'], ['#3d4348', '#51585d'], ['#7a3f33', '#93503f'], ['#6c7a6a', '#7f8e7c']];

// Speckle: many tiny marks in a colour range, so a flat fill reads as lawn, concrete or asphalt at full resolution.
function speckle(g, rand, w, h, count, size, palette, alpha = 0.5) {
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * (0.4 + rand() * 0.6);
    g.fillStyle = palette[Math.floor(rand() * palette.length)];
    g.fillRect(rand() * w, rand() * h, size * (0.6 + rand()), size * (0.6 + rand()));
  }
  g.globalAlpha = 1;
}

function tree(g, rand, x, y, r) {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.26)';
  g.beginPath();
  g.ellipse(x + r * 0.28, y + r * 0.34, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
  g.fill();
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, '#5f9047');
  grad.addColorStop(0.65, '#3f7036');
  grad.addColorStop(1, '#2b5226');
  g.fillStyle = grad;
  g.beginPath();
  for (let a = 0; a < 18; a++) {
    const ang = (a / 18) * Math.PI * 2;
    const rr = r * (0.86 + rand() * 0.2);
    g[a ? 'lineTo' : 'moveTo'](x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  g.closePath();
  g.fill();
  for (let k = 0; k < 14; k++) {
    g.fillStyle = `rgba(${120 + rand() * 50},${170 + rand() * 40},${90 + rand() * 30},0.22)`;
    g.beginPath();
    g.arc(x + (rand() - 0.6) * r, y + (rand() - 0.6) * r, r * (0.1 + rand() * 0.16), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

export async function mockAerialBlob(meta, lotResp) {
  const w = Math.min(2048, meta.widthPx);
  const h = Math.min(2048, Math.round((meta.widthPx ? w * meta.heightPx / meta.widthPx : meta.heightPx)));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d');
  const o = lotResp.origin;
  const b = meta.bbox;
  const ppm = w / (b.maxE - b.minE);
  const px = (dx) => ((dx - (b.minE - o.e)) / (b.maxE - b.minE)) * w;
  const py = (dn) => (((b.maxN - o.n) - dn) / (b.maxN - b.minN)) * h;
  const rand = rng(7);
  const lots = [lotResp.lot, ...lotResp.neighbours];
  const rings = lots.map((l) => l.polygons[0].outer);
  const trace = (ring) => {
    g.beginPath();
    ring.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
    g.closePath();
  };

  // Street: asphalt with wear and fine grain
  g.fillStyle = '#54575a';
  g.fillRect(0, 0, w, h);
  speckle(g, rand, w, h, Math.round(w * h / 18), 1.2, ['#484b4e', '#62656a', '#585b5e', '#6c6f72'], 0.6);

  // Kerb and footpath where a lot meets the street (shared boundaries are covered by the lawns drawn after)
  g.lineJoin = 'miter';
  for (const ring of rings) {
    trace(ring);
    g.lineWidth = 5.4 * ppm;
    g.strokeStyle = '#8d8d87';
    g.stroke();
  }
  for (const ring of rings) {
    trace(ring);
    g.lineWidth = 4.8 * ppm;
    g.strokeStyle = '#c3c1b8';
    g.stroke();
  }
  // Lawns: mottled, with mowing stripes
  for (const ring of rings) {
    trace(ring);
    g.fillStyle = `rgb(${98 + Math.floor(rand() * 16)},${134 + Math.floor(rand() * 16)},${74 + Math.floor(rand() * 12)})`;
    g.fill();
    g.save();
    trace(ring);
    g.clip();
    // soft patches 1 to 4 m across (read at ground level), then blades
    for (let k = 0; k < 90; k++) {
      const rx = (3 + rand() * 20) * ppm;
      g.globalAlpha = 0.07 + rand() * 0.08;
      g.fillStyle = rand() > 0.5 ? '#a8c47a' : '#3f6a34';
      g.beginPath();
      g.ellipse(rand() * w, rand() * h, rx, rx * (0.5 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    speckle(g, rand, w, h, Math.round(w * h / 70), 1.7, ['#79ab5a', '#4f7f3d', '#88b565', '#5c8f46', '#9bbb72', '#3f6c35'], 0.5);
    g.restore();
  }

  lots.forEach((l, li) => {
    const ring = rings[li];
    // The edge that faces the street: its outside probe is not inside any lot
    let front = null;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      const nx = (q[1] - p[1]) / len;
      const ny = -(q[0] - p[0]) / len;
      for (const sg of [1, -1]) {
        const probe = [mx + nx * sg * 3, my + ny * sg * 3];
        if (inRing([mx - nx * sg * 3, my - ny * sg * 3], ring) && !rings.some((r2, k) => k !== li && inRing(probe, r2))) {
          if (!front || len > front.len) front = { p, q, len, nx: -nx * sg, ny: -ny * sg };
        }
      }
    }
    if (!front) front = { p: ring[0], q: ring[1], len: Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]), nx: 0, ny: 0 };
    const ux = (front.q[0] - front.p[0]) / front.len;
    const uy = (front.q[1] - front.p[1]) / front.len;
    // inward normal: towards the lot centre
    let nx = -uy;
    let ny = ux;
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
    const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const fm = [(front.p[0] + front.q[0]) / 2, (front.p[1] + front.q[1]) / 2];
    if ((cx - fm[0]) * nx + (cy - fm[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const depth = Math.max(...ring.map((p) => (p[0] - fm[0]) * nx + (p[1] - fm[1]) * ny));
    const W = front.len;
    const hw = Math.min(W * 0.62, 17);
    const hd = Math.min(depth * 0.36, 12.5);
    const setback = Math.min(7.5, depth * 0.2);
    const [roofA, roofB] = ROOFS[Math.floor(rand() * ROOFS.length)];
    const hasPool = rand() > 0.72;
    const side = rand() > 0.5 ? 1 : -1;

    g.save();
    // Local metres: a along the front edge, b into the lot
    const o0 = [px(fm[0]), py(fm[1])];
    const ua = [px(fm[0] + ux) - o0[0], py(fm[1] + uy) - o0[1]];
    const nb = [px(fm[0] + nx) - o0[0], py(fm[1] + ny) - o0[1]];
    g.transform(ua[0], ua[1], nb[0], nb[1], o0[0], o0[1]);
    trace2(g, ring, fm, ux, uy, nx, ny);
    g.clip();
    // Rear and side fences
    g.lineWidth = 0.14;
    g.strokeStyle = 'rgba(120,114,100,0.85)';
    trace2(g, ring, fm, ux, uy, nx, ny);
    g.stroke();
    // Driveway and path
    const dw = 3.4;
    const dx0 = side * (hw / 2 - dw / 2 - 0.4);
    g.fillStyle = '#b9b6ac';
    g.fillRect(dx0 - dw / 2, -0.5, dw, setback + 1.2);
    g.strokeStyle = 'rgba(90,88,80,0.35)';
    g.lineWidth = 0.05;
    for (let k = 2; k < setback + 1; k += 2.6) {
      g.beginPath();
      g.moveTo(dx0 - dw / 2, k);
      g.lineTo(dx0 + dw / 2, k);
      g.stroke();
    }
    g.fillStyle = '#c9c5ba';
    g.fillRect(-side * hw * 0.18 - 0.5, 0, 1, setback + 0.6);
    // Roof shadow, then the roof as two pitches around a ridge along the long axis
    const hx0 = -hw / 2;
    const hy0 = setback;
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.fillRect(hx0 + 1.2, hy0 + 1.4, hw, hd);
    g.fillStyle = roofA;
    g.fillRect(hx0, hy0, hw, hd / 2);
    g.fillStyle = roofB;
    g.fillRect(hx0, hy0 + hd / 2, hw, hd / 2);
    g.strokeStyle = 'rgba(0,0,0,0.30)';
    g.lineWidth = 0.14;
    g.strokeRect(hx0, hy0, hw, hd);
    g.beginPath();
    g.moveTo(hx0 + 1.6, hy0 + hd / 2);
    g.lineTo(hx0 + hw - 1.6, hy0 + hd / 2);
    g.stroke();
    g.lineWidth = 0.06;
    g.strokeStyle = 'rgba(0,0,0,0.10)';
    for (let k = hx0 + 0.5; k < hx0 + hw; k += 0.55) {
      g.beginPath();
      g.moveTo(k, hy0);
      g.lineTo(k, hy0 + hd);
      g.stroke();
    }
    // Garage wing towards the street over the driveway
    g.fillStyle = roofA;
    g.fillRect(dx0 - 3.2, setback - 0.1, 6.4, 1.6);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(dx0 - 3.2 + 0.8, setback + 0.2, 6.4, 1.6);
    g.fillStyle = roofA;
    g.fillRect(dx0 - 3.2, setback - 0.1, 6.4, 1.6);
    // Rear: shed, pool, trees
    const sx = -side * (W * 0.28);
    g.fillStyle = '#7a7f82';
    g.fillRect(sx - 1.6, depth - 5, 3.2, 2.6);
    if (hasPool) {
      g.fillStyle = '#c8d4d8';
      g.fillRect(side * 1.5 - 2.3, hy0 + hd + 2.2 - 0.3, 5.1, 9.1 / 2 + 0.2);
      g.fillStyle = '#3fa2c4';
      g.fillRect(side * 1.5 - 2, hy0 + hd + 2.2, 4.5, 4.4);
    }
    for (let t = 0; t < 3; t++) {
      const ta = (rand() - 0.5) * W * 0.8;
      const tb = hy0 + hd + 3 + rand() * Math.max(2, depth - hy0 - hd - 6);
      tree(g, rand, ta, tb, 1.7 + rand() * 1.8);
    }
    g.restore();
  });

  // Street trees on the verge
  for (let i = 0; i < 9; i++) {
    const ring = rings[Math.floor(rand() * rings.length)];
    const p = ring[Math.floor(rand() * ring.length)];
    const q = ring[(Math.floor(rand() * ring.length) + 1) % ring.length];
    const t = rand();
    const x = px(p[0] + (q[0] - p[0]) * t);
    const y = py(p[1] + (q[1] - p[1]) * t);
    if (x > 0 && y > 0 && x < w && y < h && !rings.some((r) => inRing([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], r))) tree(g, rand, x, y, 2.6 * ppm);
  }
  // Light film grain so nothing reads as a flat fill
  speckle(g, rand, w, h, Math.round(w * h / 60), 1.1, ['#000000', '#ffffff'], 0.035);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
}

// Path of a lot ring in the local frame (metres: a along the front edge, b into the lot) on a context that already has that transform.
function trace2(g, ring, fm, ux, uy, nx, ny) {
  g.beginPath();
  ring.forEach(([x, y], i) => {
    const dx = x - fm[0];
    const dy = y - fm[1];
    const a = dx * ux + dy * uy;
    const bb = dx * nx + dy * ny;
    g[i ? 'lineTo' : 'moveTo'](a, bb);
  });
  g.closePath();
}
