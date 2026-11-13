// Live numbers for the stats strip: unit count and size mix, GFA (ground and mezzanine separately), site coverage, parking required.

import { layoutUnits, mezzanineOf } from './layout.js';
import { parkingLayout } from './parking.js';
import { DEFAULT_PARKING_RATE } from './rules.js';

const r1 = (v) => Math.round(v * 10) / 10;

/** The lot area in m2: the looked up area, else the boundary polygon area. */
export function lotAreaM2(lot) {
  if (!lot) return null;
  if (Number.isFinite(lot.areaM2) && lot.areaM2 > 0) return lot.areaM2;
  const b = lot.boundary;
  if (!Array.isArray(b) || b.length < 3) return null;
  let a = 0;
  for (let i = 0; i < b.length; i++) { const p = b[i]; const q = b[(i + 1) % b.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2 / 1e6;
}

/** stats(project) -> { units, mix:[{ label, count }], groundGfaM2, mezzGfaM2, gfaM2, footprintM2, coveragePct, parking:{ ratePerM2, required, provided, accessible } }. */
export function commercialStats(project) {
  const c = project.commercial;
  const units = layoutUnits(c);
  const mix = new Map();
  let ground = 0;
  let mezz = 0;
  for (const u of units) {
    const label = `${(u.w / 1000).toFixed(1)} x ${(u.d / 1000).toFixed(1)} m`;
    mix.set(label, (mix.get(label) || 0) + 1);
    ground += (u.w * u.d) / 1e6;
    const m = mezzanineOf(u.spec);
    if (m.enabled) mezz += m.areaM2;
  }
  const gfa = ground + mezz;
  const lotM2 = lotAreaM2(project.site?.lot);
  const rate = Number.isFinite(c?.rates?.parkingPerM2Gfa) ? c.rates.parkingPerM2Gfa : DEFAULT_PARKING_RATE;
  const park = parkingLayout(c);
  return {
    units: units.length,
    mix: [...mix].map(([label, count]) => ({ label, count })),
    groundGfaM2: r1(ground),
    mezzGfaM2: r1(mezz),
    gfaM2: r1(gfa),
    footprintM2: r1(ground),
    lotM2: lotM2 == null ? null : Math.round(lotM2),
    coveragePct: lotM2 ? r1((ground / lotM2) * 100) : null,
    parking: { ratePerM2: rate, required: Math.ceil(gfa * rate - 1e-9), provided: park.totalBays, accessible: park.accessible },
  };
}
