// The grading lines step 4 shows under the checks: indicative cut and fill and the grade check, empty when the lot has no ground levels.
import { gradingReport, gradingTextLines } from '../viewer3d/grading-report.js';

const cache = new WeakMap();
/** @returns {string[]} */
export function gradingLinesOf(project) {
  try {
    const t = project?.site?.lot?.terrain;
    if (!t) return [];
    const key = JSON.stringify([project.site.grading, project.mode, project.placedHouse?.id, project.commercial?.layout?.id, (project.commercial?.buildings || []).length, project.levels?.[0]?.walls?.length]);
    const hit = cache.get(t);
    if (hit && hit.key === key) return hit.lines;
    const lines = gradingTextLines(gradingReport(project, { stepMm: 1500 }));
    cache.set(t, { key, lines });
    return lines;
  } catch { return []; }
}
