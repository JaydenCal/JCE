// The lot plan with the house on it, as one SVG string, for the plan side of the phone Check it step.
import { lotMapSvg } from './lot-map.js';
import { deriveDriveway } from '../site/lotplan.js';

const pts = (a) => a.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');

export function planWithHouseSvg(project, { aerial = null } = {}) {
  let s = lotMapSvg(project, { aerial });
  if (!s) return '';
  let add = '';
  try { const d = deriveDriveway(project); if (d?.ok) add += `<polygon points="${pts(d.polygon)}" fill="#9a9da3" stroke="#6b6f76" stroke-width="40" opacity="0.95"/>`; } catch { /* no driveway */ }
  const ground = [...(project.levels || [])].sort((a, b) => a.elevation - b.elevation)[0];
  for (const r of ground?.rooms || []) {
    if (r.status === 'demolish' || !r.polygon?.length) continue;
    add += `<polygon points="${pts(r.polygon)}" fill="${r.outdoor ? 'rgba(120,170,110,.55)' : r.type === 'garage' ? '#c9ccc7' : '#f4efe4'}" stroke="#2c2f36" stroke-width="40"/>`;
  }
  for (const w of ground?.walls || []) if (w.status !== 'demolish') add += `<line x1="${Math.round(w.a.x)}" y1="${Math.round(w.a.y)}" x2="${Math.round(w.b.x)}" y2="${Math.round(w.b.y)}" stroke="#2c2f36" stroke-width="${Math.max(Math.round(w.thickness || 150), 60)}" stroke-linecap="square"/>`;
  return s.replace(/<\/svg>$/, `${add}</svg>`);
}
