// One indicative line about site costs for the plan set site sheet notes. Concept only. Not a quote.

import { estimateSiteCosts, fmtAud } from './estimate.js';
import { gstOf } from './gst.js';

export async function siteCostNote(project, lot) {
  const p = project?.site?.lot ? project : { ...project, site: { ...(project?.site || {}), lot } };
  const est = await estimateSiteCosts(p);
  if (!est?.ok || !est.total?.likely) return null;
  const g = gstOf(est.total.likely);
  return `Indicative site costs about ${fmtAud(g.ex)} excluding GST (${fmtAud(g.incl)} including GST), range ${fmtAud(est.total.low)} to ${fmtAud(est.total.high)} excluding GST. Not a quote.`;
}
