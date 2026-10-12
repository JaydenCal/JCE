// Draws the 2D floor plan (agent style) from PLAN as an SVG string. Units are metres.

const INK = '#1f1f1d';
const SOFT = '#8f8f8a';
const FILL = '#fbfbf9';

function f(n) { return Math.round(n * 1000) / 1000; }

function wallFrame(w) {
  const [ax, ay] = w.a, [bx, by] = w.b;
  const L = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / L, uy = (by - ay) / L;
  return { ax, ay, L, ux, uy, nx: -uy, ny: ux, t: w.t, e: w.ext ? w.t / 2 : 0 };
}

function quad(F, s0, s1, o0, o1) {
  const p = (s, o) => [F.ax + F.ux * s + F.nx * o, F.ay + F.uy * s + F.ny * o];
  const pts = [p(s0, o0), p(s1, o0), p(s1, o1), p(s0, o1)];
  return pts.map(q => `${f(q[0])},${f(q[1])}`).join(' ');
}

function line(F, s0, o0, s1, o1, stroke, width, extra = '') {
  const x0 = F.ax + F.ux * s0 + F.nx * o0, y0 = F.ay + F.uy * s0 + F.ny * o0;
  const x1 = F.ax + F.ux * s1 + F.nx * o1, y1 = F.ay + F.uy * s1 + F.ny * o1;
  return `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
}

function walls(PLAN) {
  let solid = '', detail = '';
  for (const w of PLAN.walls) {
    const F = wallFrame(w);
    const ops = [...(w.openings || [])].sort((p, q) => p.from - q.from);
    let s = 0;
    const spans = [];
    for (const o of ops) { if (o.from > s) spans.push([s, o.from]); s = o.to; }
    if (s < F.L) spans.push([s, F.L]);
    for (const [s0, s1] of spans) {
      const a = s0 <= 1e-6 ? s0 - F.e : s0;
      const b = s1 >= F.L - 1e-6 ? s1 + F.e : s1;
      solid += `<polygon points="${quad(F, a, b, -F.t / 2, F.t / 2)}" fill="${INK}"/>`;
    }
    for (const o of ops) {
      const h = F.t / 2;
      if (o.type === 'window') {
        detail += `<polygon points="${quad(F, o.from, o.to, -h, h)}" fill="#ffffff"/>`;
        detail += line(F, o.from, -h, o.to, -h, INK, 0.014);
        detail += line(F, o.from, h, o.to, h, INK, 0.014);
        detail += line(F, o.from, 0, o.to, 0, INK, 0.02);
        detail += line(F, o.from, -h, o.from, h, INK, 0.014);
        detail += line(F, o.to, -h, o.to, h, INK, 0.014);
      } else if (o.type === 'slider') {
        const mid = (o.from + o.to) / 2;
        detail += line(F, o.from, -h, o.to, -h, INK, 0.012);
        detail += line(F, o.from, h, o.to, h, INK, 0.012);
        detail += line(F, o.from, -0.035, mid + 0.06, -0.035, INK, 0.03);
        detail += line(F, mid - 0.06, 0.035, o.to, 0.035, INK, 0.03);
        detail += line(F, o.from, -h, o.from, h, INK, 0.014);
        detail += line(F, o.to, -h, o.to, h, INK, 0.014);
      } else if (o.type === 'door') {
        const w0 = o.to - o.from;
        const hs = o.hinge === 'from' ? o.from : o.to;
        const os = o.hinge === 'from' ? o.to : o.from;
        const off = o.side * h;
        const Hx = F.ax + F.ux * hs + F.nx * off, Hy = F.ay + F.uy * hs + F.ny * off;
        const Lx = Hx + F.nx * o.side * w0, Ly = Hy + F.ny * o.side * w0;
        const Cx = F.ax + F.ux * os + F.nx * off, Cy = F.ay + F.uy * os + F.ny * off;
        const v1x = Lx - Hx, v1y = Ly - Hy, v2x = Cx - Hx, v2y = Cy - Hy;
        const sweep = (v1x * v2y - v1y * v2x) > 0 ? 1 : 0;
        detail += `<line x1="${f(Hx)}" y1="${f(Hy)}" x2="${f(Lx)}" y2="${f(Ly)}" stroke="${INK}" stroke-width="0.03"/>`;
        detail += `<path d="M ${f(Lx)} ${f(Ly)} A ${f(w0)} ${f(w0)} 0 0 ${sweep} ${f(Cx)} ${f(Cy)}" fill="none" stroke="${INK}" stroke-width="0.01"/>`;
      }
    }
  }
  return { solid, detail };
}

function rect(x0, y0, x1, y1, extra = '') {
  return `<rect x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" ${extra}/>`;
}

function furnitureSVG(PLAN) {
  const st = `fill="${FILL}" stroke="${SOFT}" stroke-width="0.014"`;
  const ln = `stroke="${SOFT}" stroke-width="0.012" fill="none"`;
  let out = '';
  for (const it of PLAN.furniture) {
    const r = it.rect;
    switch (it.type) {
      case 'bed': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st + ' rx="0.04"');
        if (it.head === 'n') {
          const w = x1 - x0;
          out += rect(x0 + 0.08, y0 + 0.1, x0 + w / 2 - 0.04, y0 + 0.42, st + ' rx="0.06"');
          out += rect(x0 + w / 2 + 0.04, y0 + 0.1, x1 - 0.08, y0 + 0.42, st + ' rx="0.06"');
          out += `<path d="M ${f(x0)} ${f(y0 + 0.62)} L ${f(x1)} ${f(y0 + 0.62)}" ${ln}/>`;
        } else if (it.head === 'e') {
          const h = y1 - y0;
          out += rect(x1 - 0.42, y0 + 0.08, x1 - 0.1, y0 + h / 2 - 0.04, st + ' rx="0.06"');
          out += rect(x1 - 0.42, y0 + h / 2 + 0.04, x1 - 0.1, y1 - 0.08, st + ' rx="0.06"');
          out += `<path d="M ${f(x1 - 0.62)} ${f(y0)} L ${f(x1 - 0.62)} ${f(y1)}" ${ln}/>`;
        }
        break;
      }
      case 'bedside': case 'coffee': case 'island': case 'table':
        out += rect(...r, st + ' rx="0.03"');
        break;
      case 'robe': {
        out += rect(...r, st);
        const [x0, y0, x1, y1] = r;
        out += `<path d="M ${f(x0)} ${f(y0)} L ${f(x1)} ${f(y1)}" ${ln} stroke-dasharray="0.06 0.05"/>`;
        if (it.label) out += `<text x="${f((x0 + x1) / 2)}" y="${f((y0 + y1) / 2 + 0.05)}" font-size="0.15" text-anchor="middle" fill="${SOFT}" font-weight="600" transform="rotate(-90 ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)})">${it.label}</text>`;
        break;
      }
      case 'bath': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st + ' rx="0.08"');
        out += rect(x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, st + ' rx="0.2"');
        out += `<circle cx="${f(x1 - 0.25)}" cy="${f((y0 + y1) / 2)}" r="0.03" ${ln}/>`;
        break;
      }
      case 'vanity': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st);
        out += `<ellipse cx="${f((x0 + x1) / 2)}" cy="${f((y0 + y1) / 2)}" rx="${f((x1 - x0) * 0.32)}" ry="${f((y1 - y0) * 0.22)}" ${st}/>`;
        break;
      }
      case 'toilet': {
        const [x0, y0, x1, y1] = r;
        const cy = (y0 + y1) / 2;
        if (it.front === 'e') {
          out += rect(x0, y0 + 0.02, x0 + 0.18, y1 - 0.02, st);
          out += `<ellipse cx="${f(x0 + 0.42)}" cy="${f(cy)}" rx="0.26" ry="0.18" ${st}/>`;
        }
        break;
      }
      case 'shower': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st);
        out += `<path d="M ${f(x0)} ${f(y0)} L ${f(x1)} ${f(y1)} M ${f(x1)} ${f(y0)} L ${f(x0)} ${f(y1)}" ${ln}/>`;
        out += `<circle cx="${f((x0 + x1) / 2)}" cy="${f((y0 + y1) / 2)}" r="0.04" ${st}/>`;
        break;
      }
      case 'bench': {
        out += rect(...r, st);
        const [sx, sy] = it.sink, [cx, cy] = it.cooktop;
        out += rect(sx - 0.38, sy - 0.2, sx + 0.38, sy + 0.2, st + ' rx="0.05"');
        out += rect(sx - 0.34, sy - 0.16, sx - 0.02, sy + 0.16, st + ' rx="0.04"');
        out += rect(sx + 0.02, sy - 0.16, sx + 0.34, sy + 0.16, st + ' rx="0.04"');
        out += rect(cx - 0.3, cy - 0.25, cx + 0.3, cy + 0.25, st);
        for (const [dx, dy, rr] of [[-0.14, -0.11, 0.08], [0.14, -0.11, 0.06], [-0.14, 0.11, 0.06], [0.14, 0.11, 0.08]])
          out += `<circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="${rr}" ${ln}/>`;
        break;
      }
      case 'overhead':
        out += rect(...r, `fill="none" stroke="${SOFT}" stroke-width="0.012" stroke-dasharray="0.08 0.06"`);
        break;
      case 'fridge': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st);
        out += `<text x="${f((x0 + x1) / 2)}" y="${f((y0 + y1) / 2 + 0.05)}" font-size="0.14" text-anchor="middle" fill="${SOFT}" font-weight="600">FR</text>`;
        break;
      }
      case 'stool':
        out += `<circle cx="${it.at[0]}" cy="${it.at[1]}" r="0.18" ${st}/>`;
        break;
      case 'rug':
        out += rect(...r, `fill="none" stroke="#c9c8c2" stroke-width="0.012"`);
        break;
      case 'sofa': case 'armchair': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st + ' rx="0.06"');
        const a = 0.18, b = 0.22;
        if (it.front === 'e') {
          out += rect(x0, y0, x0 + b, y1, st);
          out += rect(x0, y0, x1, y0 + a, st);
          out += rect(x0, y1 - a, x1, y1, st);
        } else if (it.front === 'n') {
          out += rect(x0, y1 - b, x1, y1, st);
          out += rect(x0, y0, x0 + a * 0.8, y1, st);
          out += rect(x1 - a * 0.8, y0, x1, y1, st);
        } else if (it.front === 'w') {
          out += rect(x1 - b, y0, x1, y1, st);
          out += rect(x0, y0, x1, y0 + a * 0.8, st);
          out += rect(x0, y1 - a * 0.8, x1, y1, st);
        }
        break;
      }
      case 'tvunit': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st);
        out += rect(x1 - 0.06, y0 + 0.28, x1 - 0.02, y1 - 0.28, `fill="${SOFT}"`);
        break;
      }
      case 'lamp':
        out += `<circle cx="${it.at[0]}" cy="${it.at[1]}" r="0.17" ${st}/><circle cx="${it.at[0]}" cy="${it.at[1]}" r="0.04" fill="${SOFT}"/>`;
        break;
      case 'chair': {
        const [cx, cy] = it.at;
        out += rect(cx - 0.21, cy - 0.21, cx + 0.21, cy + 0.21, st + ' rx="0.04"');
        const back = { n: [cx - 0.21, cy + 0.15, cx + 0.21, cy + 0.21], s: [cx - 0.21, cy - 0.21, cx + 0.21, cy - 0.15],
          e: [cx - 0.21, cy - 0.21, cx - 0.15, cy + 0.21], w: [cx + 0.15, cy - 0.21, cx + 0.21, cy + 0.21] }[it.front];
        out += rect(...back, `fill="${SOFT}"`);
        break;
      }
      case 'plant': {
        const s = it.scale || 1;
        out += `<circle cx="${it.at[0]}" cy="${it.at[1]}" r="${f(0.26 * s)}" ${st}/><circle cx="${it.at[0]}" cy="${it.at[1]}" r="${f(0.12 * s)}" ${ln}/>`;
        break;
      }
      case 'outtable':
        out += `<circle cx="${it.at[0]}" cy="${it.at[1]}" r="0.4" ${st}/>`;
        break;
      case 'outchair': {
        const [cx, cy] = it.at;
        out += rect(cx - 0.2, cy - 0.2, cx + 0.2, cy + 0.2, st + ' rx="0.05"');
        break;
      }
      case 'planter': {
        const [x0, y0, x1, y1] = r;
        out += rect(x0, y0, x1, y1, st);
        for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.27) out += `<circle cx="${f(x)}" cy="${f((y0 + y1) / 2)}" r="0.11" ${ln}/>`;
        break;
      }
      default: break;
    }
  }
  return out;
}

function finishes(PLAN) {
  let out = '';
  for (const r of PLAN.rooms) {
    if (r.floor !== 'tile' && r.floor !== 'deck') continue;
    const xs = r.poly.map(p => p[0]), ys = r.poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const step = r.floor === 'tile' ? 0.3 : 0.6;
    const col = r.floor === 'tile' ? '#e6e5e0' : '#dcdad4';
    let d = '';
    for (let x = x0 + step; x < x1 - 0.01; x += step) d += `M ${f(x)} ${f(y0)} L ${f(x)} ${f(y1)} `;
    for (let y = y0 + step; y < y1 - 0.01; y += step) d += `M ${f(x0)} ${f(y)} L ${f(x1)} ${f(y)} `;
    out += `<path d="${d}" stroke="${col}" stroke-width="0.008" fill="none"/>`;
  }
  return out;
}

function labels(PLAN) {
  let out = '';
  for (const r of PLAN.rooms) {
    if (!r.name || !r.label) continue;
    const [x, y] = r.label;
    out += `<text x="${x}" y="${y}" font-size="0.3" font-weight="700" letter-spacing="0.03" text-anchor="middle" fill="${INK}">${r.name}</text>`;
    if (r.dims) out += `<text x="${x}" y="${f(y + 0.32)}" font-size="0.21" font-weight="500" text-anchor="middle" fill="#5c5c58">${r.dims}</text>`;
  }
  for (const l of PLAN.extraLabels || []) {
    out += `<text x="${l.at[0]}" y="${l.at[1]}" font-size="0.3" font-weight="700" letter-spacing="0.03" text-anchor="middle" fill="${INK}">${l.name}</text>`;
  }
  return out;
}

export const PLAN_VIEWBOX = { x: -1.2, y: -2.3, w: 14.4, h: 14.8 };

export function planSVG(PLAN, opts = {}) {
  const vb = PLAN_VIEWBOX;
  const font = opts.font || "Urbanist, 'Helvetica Neue', Helvetica, Arial, sans-serif";
  const bg = opts.background === false ? '' : `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${opts.background || '#ffffff'}"/>`;
  const W = walls(PLAN);
  const F = PLAN.facts;

  // balcony outline and balustrade line
  const balc = PLAN.rooms.find(r => r.id === 'balcony');
  const bx0 = balc.poly[0][0], by0 = balc.poly[0][1], bx1 = balc.poly[2][0], by1 = balc.poly[2][1];
  const balcony = `<path d="M ${bx0} ${by0} L ${bx0} ${by1} L ${bx1} ${by1} L ${bx1} ${by0}" fill="none" stroke="${INK}" stroke-width="0.05"/>` +
    `<path d="M ${f(bx0 + 0.06)} ${by0} L ${f(bx0 + 0.06)} ${f(by1 - 0.06)} L ${f(bx1 - 0.06)} ${f(by1 - 0.06)} L ${f(bx1 - 0.06)} ${by0}" fill="none" stroke="${INK}" stroke-width="0.012"/>`;

  // scale bar 0 to 5 m
  let scale = '';
  const sx = 0, sy = 11.55;
  for (let i = 0; i < 5; i++) scale += rect(sx + i, sy, sx + i + 1, sy + 0.12, `fill="${i % 2 ? '#ffffff' : INK}" stroke="${INK}" stroke-width="0.012"`);
  for (let i = 0; i <= 5; i++) scale += `<text x="${sx + i}" y="${f(sy + 0.42)}" font-size="0.2" text-anchor="middle" fill="${INK}">${i}</text>`;
  scale += `<text x="${f(sx + 5.25)}" y="${f(sy + 0.42)}" font-size="0.2" fill="${INK}">m</text>`;

  // north arrow pointing down the page
  const nx = 12.3, ny = 11.25;
  const north = `<circle cx="${nx}" cy="${ny}" r="0.42" fill="none" stroke="${INK}" stroke-width="0.02"/>` +
    `<path d="M ${nx} ${f(ny + 0.36)} L ${f(nx - 0.16)} ${f(ny - 0.18)} L ${nx} ${f(ny - 0.06)} L ${f(nx + 0.16)} ${f(ny - 0.18)} Z" fill="${INK}"/>` +
    `<text x="${nx}" y="${f(ny + 0.78)}" font-size="0.24" font-weight="700" text-anchor="middle" fill="${INK}">N</text>`;

  const title = opts.title === false ? '' :
    `<text x="-0.12" y="-1.45" font-size="0.46" font-weight="700" letter-spacing="0.04" fill="${INK}">SAMPLE APARTMENT</text>` +
    `<text x="-0.12" y="-0.92" font-size="0.24" font-weight="500" fill="#4a4a46">${F.beds} bed · ${F.baths} bath · Internal ${F.internal} m² · Balcony ${F.balcony} m² · Total ${F.total} m²</text>`;
  const note = opts.title === false ? '' :
    `<text x="0" y="12.3" font-size="0.18" fill="#6a6a65">Original plan drawn for demonstration only. Not a real property. Dimensions approximate.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"` +
    (opts.width ? ` width="${opts.width}" height="${Math.round(opts.width * vb.h / vb.w)}"` : '') +
    ` font-family="${font}">` + bg + finishes(PLAN) + furnitureSVG(PLAN) + balcony + W.solid + W.detail + labels(PLAN) + title + scale + north + note + `</svg>`;
}
