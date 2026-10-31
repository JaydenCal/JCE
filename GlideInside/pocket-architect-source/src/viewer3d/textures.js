// Procedural surface textures drawn on a canvas (browser only). Each spec gives the real-world
// size of one tile in metres, so UVs in metres tile at a believable scale. Colour maps are
// near-white detail maps that are multiplied by the finish colour; bump maps give relief.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const gray = (v) => {
  const n = Math.round(clamp01(v) * 255);
  return `rgb(${n},${n},${n})`;
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// Add per-pixel brightness jitter to a finished canvas.
function jitter(c, W, H, amp, rnd) {
  const img = c.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const j = (rnd() - 0.5) * 2 * amp * 255;
    d[i] = Math.max(0, Math.min(255, d[i] + j));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + j));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + j));
  }
  c.putImageData(img, 0, 0);
}

// Per-pixel shader: fn(u, v) with u, v in 0..1 over the tile returns a value 0..1.
function shade(c, W, H, fn) {
  const img = c.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = Math.round(clamp01(fn((x + 0.5) / W, (y + 0.5) / H)) * 255);
      const k = (y * W + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = n;
      d[k + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
}

const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Boards laid in rows with staggered end joints (timber, vinyl, decking).
function boards(c, W, H, bump, rnd, o) {
  const { rows, perRow, lo, hi, gap, grain } = o;
  const rh = H / rows;
  c.fillStyle = gray(bump ? 0.1 : gap);
  c.fillRect(0, 0, W, H);
  const g = Math.max(1, Math.round(rh * o.gapFrac));
  for (let r = 0; r < rows; r++) {
    const stagger = rnd();
    const bw = W / perRow;
    for (let k = -1; k <= perRow; k++) {
      const x = (k + stagger) * bw;
      const v = lo + rnd() * (hi - lo);
      c.fillStyle = gray(bump ? 0.55 + rnd() * 0.1 : v);
      c.fillRect(x + 1, r * rh + g / 2, bw - 2, rh - g);
      if (!bump && grain) {
        for (let s = 0; s < 6; s++) {
          c.fillStyle = `rgba(0,0,0,${0.025 + rnd() * 0.05})`;
          const yy = r * rh + g + rnd() * (rh - 2 * g);
          c.fillRect(x + 1 + rnd() * bw * 0.3, yy, bw * (0.3 + rnd() * 0.6), 1);
        }
      }
    }
  }
}

function roofTile(c, W, H, bump, rnd, o) {
  const tilesAcross = o.across;
  const courses = o.courses;
  const vari = [];
  for (let i = 0; i < tilesAcross * courses; i++) vari.push((rnd() - 0.5) * 2 * o.variance);
  shade(c, W, H, (u, v) => {
    const uu = u * tilesAcross;
    const vv = v * courses;
    const tu = uu - Math.floor(uu);
    const tv = vv - Math.floor(vv);
    const idx = (Math.floor(vv) % courses) * tilesAcross + (Math.floor(uu) % tilesAcross);
    const profile = 0.5 + 0.5 * Math.cos(2 * Math.PI * tu);
    if (bump) return (0.25 + 0.75 * profile) * (0.4 + 0.6 * smooth(0, 0.9, tv)) * (tv > 0.94 ? 0.3 : 1);
    const lum = tv > 0.93 ? 1 : 0.7 + 0.3 * Math.pow(tv / 0.93, 0.8);
    return lum * (0.84 + 0.16 * profile) * (1 + vari[idx]);
  });
  if (!bump) jitter(c, W, H, 0.012, rnd);
}

export const TEXTURE_SPECS = {
  brick: {
    tile: [0.48, 0.342], ppm: 520, rough: 0.9, bump: 1.2,
    draw(c, W, H, bump, rnd) {
      const courses = 4;
      const bh = H / courses;
      const m = Math.max(2, Math.round(0.011 * (W / 0.48)));
      c.fillStyle = gray(bump ? 0.1 : 0.985);
      c.fillRect(0, 0, W, H);
      const bw = W / 2;
      for (let r = 0; r < courses; r++) {
        const off = (r % 2) * (bw / 2);
        for (let k = -1; k <= 2; k++) {
          c.fillStyle = gray(bump ? 0.78 + rnd() * 0.12 : 0.78 + rnd() * 0.16);
          c.fillRect(off + k * bw + m / 2, r * bh + m / 2, bw - m, bh - m);
        }
      }
      jitter(c, W, H, bump ? 0.03 : 0.035, rnd);
    },
  },
  render: {
    tile: [1, 1], ppm: 256, rough: 0.95, bump: 0.6,
    draw(c, W, H, bump, rnd) {
      c.fillStyle = gray(bump ? 0.5 : 0.97);
      c.fillRect(0, 0, W, H);
      for (let i = 0; i < 90; i++) {
        c.fillStyle = `rgba(${bump ? '255,255,255' : '0,0,0'},${0.012 + rnd() * 0.02})`;
        c.beginPath();
        c.arc(rnd() * W, rnd() * H, 6 + rnd() * 26, 0, Math.PI * 2);
        c.fill();
      }
      jitter(c, W, H, bump ? 0.12 : 0.03, rnd);
    },
  },
  weatherboard: {
    tile: [1, 0.54], ppm: 320, rough: 0.8, bump: 1.4,
    draw(c, W, H, bump, rnd) {
      const rows = 4;
      const rh = H / rows;
      for (let r = 0; r < rows; r++) {
        const gr = c.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
        if (bump) {
          gr.addColorStop(0, gray(0.1));
          gr.addColorStop(0.05, gray(0.25));
          gr.addColorStop(1, gray(0.95));
        } else {
          const tone = 0.93 + (rnd() - 0.5) * 0.05;
          gr.addColorStop(0, gray(tone * 0.7));
          gr.addColorStop(0.08, gray(tone));
          gr.addColorStop(0.9, gray(tone * 0.9));
          gr.addColorStop(1, gray(tone * 0.62));
        }
        c.fillStyle = gr;
        c.fillRect(0, r * rh, W, rh);
      }
      jitter(c, W, H, bump ? 0.01 : 0.02, rnd);
    },
  },
  vertical_cladding: {
    tile: [0.6, 0.6], ppm: 300, rough: 0.8, bump: 1.2,
    draw(c, W, H, bump, rnd) {
      const mod = W / 2;
      shade(c, W, H, (u) => {
        const f = (u * 2) % 1;
        const batten = f > 0.87;
        const edge = Math.abs(f - 0.87) < 0.012 || f < 0.012;
        if (bump) return batten ? 0.95 : 0.4;
        if (edge) return 0.62;
        return batten ? 0.99 : 0.93 + 0.03 * Math.sin(u * 60);
      });
      void mod;
      jitter(c, W, H, bump ? 0.015 : 0.02, rnd);
    },
  },
  grooved_cladding: {
    tile: [0.64, 0.64], ppm: 300, rough: 0.7, bump: 1.0,
    draw(c, W, H, bump, rnd) {
      shade(c, W, H, (u, v) => {
        const f = (v * 4) % 1;
        if (f > 0.93) return bump ? 0.05 : 0.6;
        if (f < 0.03) return bump ? 0.95 : 1;
        return bump ? 0.85 : 0.965;
      });
      jitter(c, W, H, bump ? 0.01 : 0.015, rnd);
    },
  },
  stone: {
    tile: [1.2, 0.8], ppm: 360, rough: 0.95, bump: 1.6,
    draw(c, W, H, bump, rnd) {
      c.fillStyle = gray(bump ? 0.05 : 0.93);
      c.fillRect(0, 0, W, H);
      const rowsH = [0.22, 0.16, 0.24, 0.18].map((v) => (v / 0.8) * H);
      let y = 0;
      const m = Math.max(2, Math.round(0.012 * (W / 1.2)));
      for (const rh of rowsH) {
        const n = 3 + Math.floor(rnd() * 3);
        const cuts = [0];
        for (let i = 1; i < n; i++) cuts.push((i + (rnd() - 0.5) * 0.7) / n);
        cuts.push(1);
        for (let i = 0; i < n; i++) {
          const x0 = cuts[i] * W;
          const x1 = cuts[i + 1] * W;
          c.fillStyle = gray(bump ? 0.45 + rnd() * 0.4 : 0.6 + rnd() * 0.3);
          c.fillRect(x0 + m / 2, y + m / 2, x1 - x0 - m, rh - m);
        }
        y += rh;
      }
      jitter(c, W, H, bump ? 0.07 : 0.05, rnd);
    },
  },
  concrete: {
    tile: [1.5, 1.5], ppm: 200, rough: 0.9, bump: 0.5,
    draw(c, W, H, bump, rnd) {
      c.fillStyle = gray(bump ? 0.5 : 0.94);
      c.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        c.fillStyle = `rgba(${bump ? '255,255,255' : '0,0,0'},${0.01 + rnd() * 0.02})`;
        c.beginPath();
        c.arc(rnd() * W, rnd() * H, 8 + rnd() * 34, 0, Math.PI * 2);
        c.fill();
      }
      for (let i = 0; i < 90; i++) {
        c.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.12})`;
        c.fillRect(rnd() * W, rnd() * H, 1, 1);
      }
      jitter(c, W, H, bump ? 0.1 : 0.025, rnd);
    },
  },
  corrugated: {
    tile: [0.304, 0.5], ppm: 640, rough: 0.42, metal: 0.55, bump: 1.4,
    draw(c, W, H, bump, rnd) {
      shade(c, W, H, (u) => {
        const s = 0.5 + 0.5 * Math.cos(2 * Math.PI * u * 4);
        return bump ? s : 0.72 + 0.28 * s;
      });
      if (!bump) jitter(c, W, H, 0.012, rnd);
    },
  },
  trimdek: {
    tile: [0.76, 0.5], ppm: 400, rough: 0.4, metal: 0.55, bump: 1.6,
    draw(c, W, H, bump, rnd) {
      shade(c, W, H, (u) => {
        const f = (u * 4) % 1;
        let lum;
        let h;
        if (f < 0.6) {
          lum = 0.9 + 0.04 * Math.sin((f / 0.6) * Math.PI);
          h = 0.2;
          if (Math.abs(f - 0.2) < 0.01 || Math.abs(f - 0.4) < 0.01) {
            lum = 0.8;
            h = 0.3;
          }
        } else if (f < 0.7) {
          const t = (f - 0.6) / 0.1;
          lum = 0.9 - 0.35 * t;
          h = 0.2 + 0.8 * t;
        } else if (f < 0.84) {
          lum = 1;
          h = 1;
        } else if (f < 0.94) {
          const t = (f - 0.84) / 0.1;
          lum = 0.72 + 0.2 * t;
          h = 1 - 0.8 * t;
        } else {
          lum = 0.9;
          h = 0.2;
        }
        return bump ? h : lum;
      });
      if (!bump) jitter(c, W, H, 0.012, rnd);
    },
  },
  standing_seam: {
    tile: [0.7, 0.5], ppm: 360, rough: 0.38, metal: 0.6, bump: 1.2,
    draw(c, W, H, bump, rnd) {
      shade(c, W, H, (u) => {
        const f = (u * 2) % 1;
        let lum = 0.9 + 0.06 * Math.sin(f * Math.PI);
        let h = 0.2;
        if (f > 0.93) {
          const t = (f - 0.93) / 0.07;
          lum = 0.55 + 0.45 * t;
          h = 0.2 + 0.8 * t;
        } else if (f < 0.03) {
          const t = f / 0.03;
          lum = 1 - 0.5 * t;
          h = 1 - 0.8 * t;
        }
        return bump ? h : lum;
      });
      if (!bump) jitter(c, W, H, 0.012, rnd);
    },
  },
  concrete_tile: {
    tile: [0.66, 0.84], ppm: 300, rough: 0.78, bump: 2.0,
    draw: (c, W, H, bump, rnd) => roofTile(c, W, H, bump, rnd, { across: 2, courses: 2, variance: 0.02 }),
  },
  terracotta_tile: {
    tile: [0.6, 0.76], ppm: 300, rough: 0.7, bump: 2.0,
    draw: (c, W, H, bump, rnd) => roofTile(c, W, H, bump, rnd, { across: 2, courses: 2, variance: 0.08 }),
  },
  timber: {
    tile: [1.2, 0.96], ppm: 300, rough: 0.5, bump: 0.5,
    draw: (c, W, H, bump, rnd) => boards(c, W, H, bump, rnd, { rows: 8, perRow: 1, lo: 0.82, hi: 1, gap: 0.55, gapFrac: 0.03, grain: true }),
  },
  vinyl: {
    tile: [1.2, 0.9], ppm: 256, rough: 0.5, bump: 0.3,
    draw: (c, W, H, bump, rnd) => boards(c, W, H, bump, rnd, { rows: 5, perRow: 1, lo: 0.9, hi: 1, gap: 0.82, gapFrac: 0.02, grain: false }),
  },
  decking: {
    tile: [2.4, 0.84], ppm: 220, rough: 0.8, bump: 0.8,
    draw: (c, W, H, bump, rnd) => boards(c, W, H, bump, rnd, { rows: 6, perRow: 1, lo: 0.8, hi: 1, gap: 0.3, gapFrac: 0.06, grain: true }),
  },
  tile: {
    tile: [1.2, 1.2], ppm: 360, rough: 0.28, bump: 0.6,
    draw(c, W, H, bump, rnd) {
      c.fillStyle = gray(bump ? 0.05 : 0.62);
      c.fillRect(0, 0, W, H);
      const g = Math.max(2, Math.round(0.007 * (W / 1.2)));
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          c.fillStyle = gray(bump ? 0.8 : 0.92 + rnd() * 0.08);
          c.fillRect((i * W) / 2 + g / 2, (j * H) / 2 + g / 2, W / 2 - g, H / 2 - g);
        }
      }
      jitter(c, W, H, bump ? 0.01 : 0.012, rnd);
    },
  },
  carpet: {
    tile: [0.5, 0.5], ppm: 256, rough: 1, bump: 0.5,
    draw(c, W, H, bump, rnd) {
      c.fillStyle = gray(bump ? 0.5 : 0.9);
      c.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) {
        c.fillStyle = `rgba(${bump ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.03})`;
        c.beginPath();
        c.arc(rnd() * W, rnd() * H, 4 + rnd() * 16, 0, Math.PI * 2);
        c.fill();
      }
      jitter(c, W, H, bump ? 0.25 : 0.07, rnd);
    },
  },
  polished_concrete: {
    tile: [2, 2], ppm: 128, rough: 0.5, bump: 0,
    draw(c, W, H, bump, rnd) {
      c.fillStyle = gray(0.93);
      c.fillRect(0, 0, W, H);
      for (let i = 0; i < 46; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = 20 + rnd() * 60;
        const gr = c.createRadialGradient(x, y, 0, x, y, r);
        const dark = rnd() < 0.5;
        gr.addColorStop(0, `rgba(${dark ? '0,0,0' : '255,255,255'},${0.035 + rnd() * 0.04})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = gr;
        c.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(0, 0, W, 1);
      c.fillRect(0, 0, 1, H);
      jitter(c, W, H, 0.012, rnd);
    },
  },
  grass: {
    tile: [8, 8], ppm: 64, rough: 1, bump: 0,
    draw(c, W, H, bump, rnd) {
      c.fillStyle = gray(0.9);
      c.fillRect(0, 0, W, H);
      // Soft tonal patches, wrapped across the tile edges so the texture repeats without a seam.
      for (let i = 0; i < 90; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = 24 + rnd() * 80;
        const dark = rnd() < 0.55;
        const alpha = 0.025 + rnd() * 0.035;
        for (const ox of [-W, 0, W]) {
          for (const oy of [-H, 0, H]) {
            const cx = x + ox;
            const cy = y + oy;
            if (cx + r < 0 || cx - r > W || cy + r < 0 || cy - r > H) continue;
            const gr = c.createRadialGradient(cx, cy, 0, cx, cy, r);
            gr.addColorStop(0, `rgba(${dark ? '0,0,0' : '255,255,255'},${alpha})`);
            gr.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = gr;
            c.fillRect(cx - r, cy - r, 2 * r, 2 * r);
          }
        }
      }
      for (let i = 0; i < 2600; i++) {
        c.strokeStyle = `rgba(${rnd() < 0.6 ? '0,0,0' : '255,255,255'},${0.04 + rnd() * 0.06})`;
        c.lineWidth = 1;
        const x = rnd() * W;
        const y = rnd() * H;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (rnd() - 0.5) * 3, y + 2 + rnd() * 3);
        c.stroke();
      }
      jitter(c, W, H, 0.035, rnd);
    },
  },
  roller: {
    tile: [1, 0.3], ppm: 300, rough: 0.45, metal: 0.45, bump: 1.0,
    draw(c, W, H, bump, rnd) {
      shade(c, W, H, (u, v) => {
        const f = (v * 4) % 1;
        const s = Math.sin(f * Math.PI);
        return bump ? s : 0.62 + 0.38 * Math.pow(s, 0.6);
      });
      if (!bump) jitter(c, W, H, 0.008, rnd);
    },
  },
  panel: {
    tile: [1, 1], ppm: 200, rough: 0.5, metal: 0.25, bump: 0.8,
    draw(c, W, H, bump, rnd) {
      shade(c, W, H, (u, v) => {
        const f = (v * 2) % 1;
        if (f > 0.965) return bump ? 0.05 : 0.5;
        if (f < 0.02) return bump ? 0.9 : 1;
        return bump ? 0.75 : 0.95;
      });
      if (!bump) jitter(c, W, H, 0.01, rnd);
    },
  },
  tank: {
    tile: [1, 0.54], ppm: 256, rough: 0.5, metal: 0.1, bump: 1.0,
    draw(c, W, H, bump, rnd) {
      shade(c, W, H, (u, v) => {
        const f = (v * 3) % 1;
        const s = Math.sin(f * Math.PI);
        return bump ? s : 0.6 + 0.4 * Math.pow(s, 0.7);
      });
      if (!bump) jitter(c, W, H, 0.008, rnd);
    },
  },
};

// Convert a height canvas to a tangent space normal map. Normal maps filter smoothly through the
// mip chain, so fine relief (corrugations, brick courses) fades out at distance instead of aliasing
// the way a screen space bump map does. relief is the depth of the surface detail in metres.
function heightToNormal(canvas, relief, ppm) {
  const W = canvas.width;
  const H = canvas.height;
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  const img = octx.createImageData(W, H);
  const d = img.data;
  const k = (relief * ppm * 0.5) / 255;
  for (let y = 0; y < H; y++) {
    const ym = (y - 1 + H) % H;
    const yp = (y + 1) % H;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W;
      const xp = (x + 1) % W;
      const dx = (src[(y * W + xp) * 4] - src[(y * W + xm) * 4]) * k;
      const dy = (src[(yp * W + x) * 4] - src[(ym * W + x) * 4]) * k;
      // +u runs right and +v runs up; canvas y runs down, so dH/dv is -dy.
      const l = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      d[o] = (-dx / l * 0.5 + 0.5) * 255;
      d[o + 1] = (dy / l * 0.5 + 0.5) * 255;
      d[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

const RELIEF_PER_UNIT = 0.008; // metres of relief per unit of a spec's bump value

// Build the colour map and normal map for a spec. Returns null without a DOM.
export function makeTextures(THREE, key, spec, maxAniso = 8) {
  if (typeof document === 'undefined') return null;
  const W = Math.max(8, Math.min(1024, Math.round(spec.tile[0] * spec.ppm)));
  const H = Math.max(8, Math.min(1024, Math.round(spec.tile[1] * spec.ppm)));
  const out = {};
  for (const bump of spec.bump === 0 ? [false] : [false, true]) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    if (!c) return null;
    spec.draw(c, W, H, bump, mulberry32(hashStr(key)));
    const source = bump ? heightToNormal(canvas, spec.bump * RELIEF_PER_UNIT, spec.ppm) : canvas;
    const t = new THREE.CanvasTexture(source);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / spec.tile[0], 1 / spec.tile[1]);
    t.anisotropy = maxAniso;
    t.colorSpace = bump ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.needsUpdate = true;
    out[bump ? 'normal' : 'map'] = t;
  }
  return out;
}
