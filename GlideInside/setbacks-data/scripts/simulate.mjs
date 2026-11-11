// Runs pickRules over every council and main zone with representative lots; prints JSON to stdout.
import { readFileSync } from 'node:fs';
import { pickRulesDetailed } from '../../pocket-architect-source/src/site/setbacks.js';
const dir = new URL('../', import.meta.url);
const all = JSON.parse(readFileSync(new URL('setback-rules.json', dir), 'utf8'));
const fallbacks = all.fallbacks || {};
const ZONES = ['R1', 'R2', 'R3', 'R5', 'RU5'];
const LOTS = {
  R1: { lotWidthM: 15, lotAreaM2: 600 }, R2: { lotWidthM: 15, lotAreaM2: 600 }, R3: { lotWidthM: 15, lotAreaM2: 600 },
  R5: { lotWidthM: 60, lotAreaM2: 5000 }, RU5: { lotWidthM: 20, lotAreaM2: 800 },
};
const out = {};
for (const c of all.councils) {
  const z = {};
  for (const zone of ZONES) {
    const base = { zone, storeys: 1, cornerLot: false, use: 'dwelling', wallHeightM: 3.0, buildingHeightM: 5.0, ...LOTS[zone] };
    const dcp = pickRulesDetailed(c, base, {});
    const withFb = pickRulesDetailed(c, base, { fallbacks });
    const two = pickRulesDetailed(c, { ...base, storeys: 2, wallHeightM: 6.0, buildingHeightM: 8.0 }, { fallbacks });
    const corner = pickRulesDetailed(c, { ...base, cornerLot: true }, { fallbacks });
    z[zone] = {
      dcp: !!dcp.picked,
      basis: withFb.picked ? withFb.picked.basis : null,
      twoStorey: two.picked ? two.picked.basis : null,
      corner: corner.picked ? corner.picked.basis : null,
      why: dcp.picked ? null : (dcp.attempts[0] || {}).reason || null,
    };
  }
  out[c.lga_slug] = z;
}
console.log(JSON.stringify(out));
