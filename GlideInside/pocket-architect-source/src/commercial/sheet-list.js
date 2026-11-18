// The commercial plan set pages, in one light module (no PDF code) so the buttons, the gate and the plan set agree on what is sold.
export const COMMERCIAL_SHEET_LIST = Object.freeze([
  { id: 'cover', code: 'C000', title: 'COVER SHEET AND DRAWING INDEX' },
  { id: 'existing', code: 'C100', title: 'EXISTING SITE' },
  { id: 'layout', code: 'C101', title: 'PROPOSED LAYOUT' },
  { id: 'mezz', code: 'C102', title: 'MEZZANINE LEVEL PLAN' },
  { id: 'yield', code: 'C103', title: 'YIELD SUMMARY' },
  { id: 'elev', code: 'C104', title: 'ELEVATIONS' },
  { id: 'finance', code: 'C105', title: 'DEVELOPMENT FEASIBILITY' },
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
