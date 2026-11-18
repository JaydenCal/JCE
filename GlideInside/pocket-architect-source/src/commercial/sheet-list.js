// The commercial plan set sheet FAMILIES, in one light module (no PDF code) so the buttons, the gate and the plan set agree on what is sold. Plans are
// C1xx, elevations C2xx (one sheet per building or row group, C200, C201...), sections C3xx, schedules C900 and C910. The sheets a project really gets
// (a levels plan only with ground data, upper level plans only with an upper level) are built by commercialSheetPlan() in planset/commercial.js.
export const COMMERCIAL_SHEET_LIST = Object.freeze([
  { id: 'cover', code: 'C000', title: 'COVER SHEET AND DRAWING INDEX' },
  { id: 'existing', code: 'C100', title: 'EXISTING SITE AND LEVELS' },
  { id: 'layout', code: 'C101', title: 'PROPOSED LAYOUT' },
  { id: 'levels', code: 'C102', title: 'LEVELS AND GRADING PLAN (INDICATIVE)' },
  { id: 'upper', code: 'C110', title: 'UPPER LEVEL PLANS' },
  { id: 'elev', code: 'C200', title: 'ELEVATIONS' },
  { id: 'sect', code: 'C300', title: 'SECTIONS' },
  { id: 'yield', code: 'C900', title: 'YIELD SUMMARY AND SCHEDULES' },
  { id: 'finance', code: 'C910', title: 'DEVELOPMENT FEASIBILITY' },
]);

/** 'C000 and C100 to C103': consecutive codes are joined into a range, anything else is listed. */
export function sheetListText(list = COMMERCIAL_SHEET_LIST) {
  const n = (c) => Number(String(c).replace(/\D/g, ''));
  const groups = [];
  for (const s of list) {
    const g = groups[groups.length - 1];
    if (g && n(s.code) === n(g.at(-1).code) + 1) g.push(s); else groups.push([s]);
  }
  const parts = groups.map((g) => (g.length > 2 ? `${g[0].code} to ${g.at(-1).code}` : g.map((x) => x.code).join(' and ')));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
}
