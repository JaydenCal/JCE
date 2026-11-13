// One cached call for everything the UI and the tests read from a commercial project.
import { layoutUnits } from './layout.js';
import { parkingLayout } from './parking.js';
import { bollardsFor, bollardSchedule } from './bollards.js';
import { commercialStats } from './stats.js';
import { commercialChecks } from './checks.js';

let last = { key: '', value: null };

export function analyse(project) {
  if (!project?.commercial) return null;
  const lot = project.site?.lot;
  const key = JSON.stringify([project.commercial, lot?.envelope, lot?.setbacks, lot?.setbacksKey, lot?.boundary, lot?.frontEdges, lot?.lotLabel, lot?.areaM2, lot?.zoning, project.levels.length, project.levels[0]?.walls.length]);
  if (last.key === key) return last.value;
  const bollards = bollardsFor(project.commercial);
  const value = { units: layoutUnits(project.commercial), parking: parkingLayout(project.commercial), bollards, schedule: bollardSchedule(bollards), stats: commercialStats(project), checks: commercialChecks(project) };
  last = { key, value };
  return value;
}
