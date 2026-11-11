// Branding and numbering for the engineering style plan set.
//   Public users: Glide Inside branding plus the fields of their title block (titleblock.js).
//   Builder and client logins: the builder's logo and name lead the title block, with a small "Prepared with Glide Inside" credit.
// Drawing numbers use the Glide Inside scheme GI-<project>-A-NNN. Dates on sheets are DD/MM/YYYY.

import { clean } from './kit.js';
import { BRAND, LOGO_PNG } from '../../brand/logo.js';
import { imageInfo } from '../pdf.js';

export const DISCLAIMER = 'CONCEPT ONLY. TO BE VERIFIED BY A SUITABLY QUALIFIED PERSON BEFORE ANY USE FOR APPROVAL OR CONSTRUCTION. Not a survey. Not a development application drawing.';

export const ddmmyyyy = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
/** A date the user typed, put into DD/MM/YYYY where it is a recognisable numeric date; anything else is kept as written. */
export function normDate(text) {
  const t = clean(text);
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3].length === 2 ? `20${m[3]}` : m[3]}`;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
  return t;
}
export const ddmmyy = ddmmyyyy; // earlier name; the format is DD/MM/YYYY

/** Short project code for drawing numbers: the job number if there is one, else letters and digits from the project name. */
export function projectCode(project) {
  const tb = project?.titleBlock || {};
  const raw = clean(tb.jobNumber) || clean(tb.projectName) || clean(project?.name) || 'PROJECT';
  const code = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8);
  return code || 'PROJECT';
}

export const drawingNo = (project, n) => `GI-${projectCode(project)}-A-${String(n).padStart(3, '0')}`;

/**
 * Who the sheets are branded as. options.builder = { name, logo (data URL) } for builder or client logins. In the browser the
 * portal publishes the same thing as window.__ps.builder. options.logo is the user's own logo for public mode.
 */
export function brandOf(project, options = {}) {
  let builder = options.builder;
  if (builder === undefined) {
    try { builder = typeof window !== 'undefined' ? window.__ps?.builder : null; } catch { builder = null; }
  }
  const tb = project?.titleBlock || {};
  const glide = imageInfo(LOGO_PNG);
  let userLogo = options.logo;
  if (userLogo === undefined) {
    try { userLogo = typeof window !== 'undefined' ? window.__ps?.getLogo?.() : null; } catch { userLogo = null; }
  }
  const asImg = (u) => { const i = u ? imageInfo(u) : null; return i && i.w > 0 && i.h > 0 ? i : null; };
  if (builder && (builder.name || builder.logo)) {
    return { mode: 'builder', name: clean(builder.name) || clean(tb.company) || '', logo: asImg(builder.logo) || asImg(userLogo), glide, credit: `Prepared with ${BRAND.name}` };
  }
  return { mode: 'public', name: clean(tb.company), logo: asImg(userLogo), glide, credit: '' };
}

/** Attribution line for the footer, from the state of the lot. With an aerial on the sheet its own attribution and date follow. */
export function attribution(lot, { aerial = false } = {}) {
  const nsw = 'Cadastre, imagery and contours: NSW Spatial Services (CC BY).';
  const qld = 'Cadastre: Queensland Government (CC BY 4.0). Imagery and elevation: Queensland Government (CC BY-SA).';
  let base;
  if (!lot) base = `${nsw} ${qld} Where used.`;
  else base = lot.state === 'QLD' ? qld : nsw;
  const a = aerial ? lot?.aerial : null;
  if (!a) return base;
  const when = a.captureDate ? ` Aerial captured ${normDate(clean(String(a.captureDate)))}.` : '';
  const src = clean(a.attribution || a.source || '').replace(/^\s*(aerial underlay|aerial|imagery)\s*:\s*/i, '').replace(/[\s.,;]+$/, '');
  return `${base} Aerial underlay${src ? `: ${src}` : ''}. Reduced resolution, not for measurement.${when}`;
}
