// Kerb and drainage edge types. Each profile is a closed cross section in mm: x runs from the pavement edge towards the landscaping side
// (the back of the kerb), y is up from the pavement surface at the edge (negative is below it). Profiles are what the 3D view extrudes and
// the plan symbols are drawn from `plan.lines` (offsets in mm from the pavement edge, so the same polyline gives every line).
// Indicative sections for concept layout, the council's standard drawing governs (check with council).

const K = (o) => Object.freeze({ indicative: true, ...o, profile: Object.freeze(o.profile.map((p) => Object.freeze(p))) });

export const KERBS = Object.freeze([
  K({
    id: 'barrier-kg',
    label: 'Barrier kerb and gutter',
    short: 'Barrier kerb and gutter',
    profile: [{ x: 0, y: 0 }, { x: 450, y: 30 }, { x: 456, y: 180 }, { x: 600, y: 180 }, { x: 600, y: -100 }, { x: 0, y: -100 }],
    heightMm: 180,
    widthMm: 600,
    rateKey: 'barrier-kg',
    colour: '#b4b2aa',
    plan: { lines: [{ offsetMm: 0, weightMm: 70 }, { offsetMm: 450, weightMm: 140 }, { offsetMm: 600, weightMm: 70 }], label: 'BKG' },
  }),
  K({
    id: 'layback-kg',
    label: 'Layback (roll top) kerb and gutter',
    short: 'Layback kerb and gutter',
    profile: [{ x: 0, y: 0 }, { x: 450, y: 30 }, { x: 520, y: 125 }, { x: 580, y: 150 }, { x: 640, y: 150 }, { x: 640, y: -100 }, { x: 0, y: -100 }],
    heightMm: 150,
    widthMm: 640,
    rateKey: 'layback-kg',
    colour: '#bbb9b0',
    plan: { lines: [{ offsetMm: 0, weightMm: 70 }, { offsetMm: 450, weightMm: 100, dash: [400, 200] }, { offsetMm: 640, weightMm: 70 }], label: 'LKG' },
  }),
  K({
    id: 'mountable',
    label: 'Mountable kerb',
    short: 'Mountable kerb',
    profile: [{ x: 0, y: 0 }, { x: 140, y: 70 }, { x: 300, y: 70 }, { x: 300, y: -100 }, { x: 0, y: -100 }],
    heightMm: 70,
    widthMm: 300,
    rateKey: 'mountable',
    colour: '#c0beb5',
    plan: { lines: [{ offsetMm: 0, weightMm: 90 }, { offsetMm: 300, weightMm: 70 }], label: 'MK' },
  }),
  K({
    id: 'flush-edge',
    label: 'Flush kerb or edge strip',
    short: 'Flush edge strip',
    profile: [{ x: 0, y: 6 }, { x: 300, y: 6 }, { x: 300, y: -150 }, { x: 0, y: -150 }],
    heightMm: 6,
    widthMm: 300,
    rateKey: 'flush-edge',
    colour: '#c4c1b8',
    plan: { lines: [{ offsetMm: 0, weightMm: 80 }, { offsetMm: 300, weightMm: 60 }], label: 'FE' },
  }),
  K({
    id: 'kerb-only-b',
    label: 'Kerb only (B type)',
    short: 'Kerb only (B)',
    profile: [{ x: 0, y: 0 }, { x: 0, y: 150 }, { x: 150, y: 150 }, { x: 150, y: -100 }, { x: 0, y: -100 }],
    heightMm: 150,
    widthMm: 150,
    rateKey: 'kerb-only-b',
    colour: '#b9b7ae',
    plan: { lines: [{ offsetMm: 0, weightMm: 130 }, { offsetMm: 150, weightMm: 70 }], label: 'KB' },
  }),
  K({
    id: 'dish-drain',
    label: 'Concrete dish drain',
    short: 'Dish drain',
    profile: [{ x: 0, y: 0 }, { x: 300, y: -100 }, { x: 600, y: 0 }, { x: 600, y: -150 }, { x: 0, y: -150 }],
    heightMm: -100,
    widthMm: 600,
    rateKey: 'dish-drain',
    colour: '#a9a79f',
    plan: { lines: [{ offsetMm: 0, weightMm: 70 }, { offsetMm: 300, weightMm: 50, dash: [250, 250] }, { offsetMm: 600, weightMm: 70 }], label: 'DD' },
  }),
]);

const BY_ID = new Map(KERBS.map((k) => [k.id, k]));
export const kerbById = (id) => BY_ID.get(id) || null;
export const isKerbType = (id) => BY_ID.has(id);

/** Defaults: kerb against landscaping, and where it crosses a driveway crossover. */
export const KERB_DEFAULTS = Object.freeze({ edge: 'barrier-kg', crossover: 'layback-kg' });

/** Signed area of the profile (mm2): positive is counter clockwise in x right, y up. */
export function profileArea(profile) {
  let a = 0;
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i];
    const q = profile[(i + 1) % profile.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Plan symbol lines for a kerb along a polyline: [{ a, b, weightMm, dash }] in plan coordinates. The offset direction is the polyline
 * normal n = (-dy, dx) / length, which points to the landscaping side for auto generated kerbs (pavement on the other side).
 */
export function planLines(kerb, polyline) {
  const k = typeof kerb === 'string' ? kerbById(kerb) : kerb;
  if (!k || !Array.isArray(polyline) || polyline.length < 2) return [];
  const out = [];
  for (let i = 0; i + 1 < polyline.length; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const nx = -dy / l;
    const ny = dx / l;
    for (const ln of k.plan.lines) {
      out.push({ a: { x: a.x + nx * ln.offsetMm, y: a.y + ny * ln.offsetMm }, b: { x: b.x + nx * ln.offsetMm, y: b.y + ny * ln.offsetMm }, weightMm: ln.weightMm, dash: ln.dash || null });
    }
  }
  return out;
}
