// A synthetic "aerial" for the sample lots (roads, lawns, roofs, trees) drawn on a canvas, so the underlay and the 3D
// terrain texture have something to show in mock mode. Browser only. It is a picture of nothing real.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function mockAerialBlob(meta, lotResp) {
  const w = Math.min(2048, meta.widthPx);
  const h = Math.min(2048, Math.round((meta.widthPx ? w * meta.heightPx / meta.widthPx : meta.heightPx)));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d');
  const o = lotResp.origin;
  const b = meta.bbox;
  const px = (dx) => ((dx - (b.minE - o.e)) / (b.maxE - b.minE)) * w;
  const py = (dn) => (((b.maxN - o.n) - dn) / (b.maxN - b.minN)) * h;
  const rand = rng(7);
  g.fillStyle = '#7d7f7a';
  g.fillRect(0, 0, w, h);
  const lots = [lotResp.lot, ...lotResp.neighbours];
  for (const l of lots) {
    const ring = l.polygons[0].outer;
    g.beginPath();
    ring.forEach(([x, y], i) => (i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y))));
    g.closePath();
    g.fillStyle = `rgb(${96 + Math.floor(rand() * 20)},${128 + Math.floor(rand() * 24)},${72 + Math.floor(rand() * 16)})`;
    g.fill();
    // roof: a rectangle about half the lot, near its centroid
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ang = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
    g.save();
    g.translate(px(cx), py(cy));
    g.rotate(-ang);
    const sw = (Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) * 0.6 * w) / (b.maxE - b.minE);
    const sh = (Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]) * 0.35 * w) / (b.maxE - b.minE);
    g.fillStyle = rand() > 0.5 ? '#9c5b45' : '#6f7478';
    g.fillRect(-sw / 2, -sh / 2, sw, sh);
    g.restore();
    for (let t = 0; t < 3; t++) {
      g.beginPath();
      g.fillStyle = 'rgba(48,86,48,0.85)';
      g.arc(px(Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs))), py(Math.min(...ys) + rand() * (Math.max(...ys) - Math.min(...ys))), (3 + rand() * 3) * (w / ((b.maxE - b.minE) * 10)) * 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}
