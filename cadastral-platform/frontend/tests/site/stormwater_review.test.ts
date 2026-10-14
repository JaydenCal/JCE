/** Stage 9 review fixes: the panel mapping of closed basins, the pre and post cover label and the trench that does not empty. Fixtures are SYNTHETIC TEST DATA. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiltrationView, overlandView, peakView, type StormwaterResult, type SwClosedBasin, type SwOverland } from '@/lib/site/stormwater';
import { buildOverlandLayer } from '@/lib/site/overlandScene';
import { E0, N0 } from './helpers';

const FULL = JSON.parse(readFileSync(join(__dirname, '../fixtures', 'stormwater_full.json'), 'utf8')) as StormwaterResult;
const DASH = /[–—]/;
const basin: SwClosedBasin = {
  id: 'CB1', status: 'NO OUTLET', area_m2: 64, cells: 256, lowest_rl: 100.51, highest_rl: 100.9, centroid: [E0 + 9, N0 + 14], sink_count: 16,
  sinks: [{ x: E0 + 9, y: N0 + 10.25, rl: 100.51, contributing_area_m2: 4 }],
  outline: [[E0 + 5, N0 + 10], [E0 + 13, N0 + 10], [E0 + 13, N0 + 18], [E0 + 5, N0 + 18], [E0 + 5, N0 + 10]],
};

describe('review fixes: the panel shows what the server now reports', () => {
  it('lists each closed basin with its area, lowest ground and D8 sinks, and draws it in its own colour', () => {
    const ov = { ...(FULL.overland as SwOverland), closed_basins: [basin], closed_basins_total: 1, enclosed_area_m2: 64, sinks: { count: 16, listed: [], truncated: false } };
    const v = overlandView(ov)!;
    expect(v.closedBasins).toEqual([{ id: 'CB1', text: 'CB1: NO OUTLET, AREA 64.0 m2, LOWEST GROUND 100.51 RL, 16 D8 SINK(S)' }]);
    const g = buildOverlandLayer(ov, [E0, N0]);
    const flagged: THREE.Object3D[] = []; g.traverse((o) => { if (o.userData.closedBasin) flagged.push(o); });
    expect(flagged.length).toBe(1);
    expect(overlandView(FULL.overland as SwOverland)!.closedBasins).toEqual([]);          // an answer from before the fix has none
  });
  it('shows the pre and post cover label with its note, and nothing when the label is empty', () => {
    const p = peakView({ ...FULL.peak_flows, comparison_label: 'PRE AND POST COVER DIFFERENT AREAS', comparison_note: 'PRE DEVELOPMENT: 306.0 M2 OF THE LOT HAS NO SURFACE OBJECT' });
    expect(p.comparison.startsWith('PRE AND POST COVER DIFFERENT AREAS. PRE DEVELOPMENT: 306.0 M2')).toBe(true);
    expect(peakView({ ...FULL.peak_flows, comparison_label: '' }).comparison).toBe('');
    expect(peakView(FULL.peak_flows).comparison).toBe('');
  });
  it('reads a trench that does not empty as DOES NOT EMPTY, not as not evaluated', () => {
    const t = { ...FULL.infiltration.trenches[0], emptying_time_h: null, does_not_empty: true, check: { status: 'FAIL', message: 'DOES NOT EMPTY: THE INFILTRATION RATE (0 MM/H) IS NOT ABOVE ZERO' } };
    const v = infiltrationView({ ...FULL.infiltration, trenches: [t] }).trenches[0];
    expect(v.time).toBe('DOES NOT EMPTY'); expect(v.check.tone).toBe('bad'); expect(v.check.text.startsWith('DOES NOT EMPTY')).toBe(true);
    expect([v.time, v.check.text].some((s) => DASH.test(s))).toBe(false);
  });
});
