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

/** Letters and digits only, upper case, at most n long. */
const alnum = (t, n = 12) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, n);

/**
 * Short job code for drawing numbers. Never derived from the free text project name (a typo there must not reach every drawing number):
 * the job number the user entered, else the lot and plan of the site (Lot 3 DP 263990 gives L3DP263990), else a short id, else DRAFT.
 */
export function projectCode(project) {
  const tb = project?.titleBlock || {};
  const job = alnum(clean(tb.jobNumber), 10);
  if (job) return job;
  const lot = project?.site?.lot;
  const lotNo = alnum(lot?.lotNumber, 5);
  const plan = alnum(lot?.planLabel, 10);
  if (lotNo && plan) return `L${lotNo}${plan}`.slice(0, 16);
  const id = alnum(project?.id, 6);
  return id || 'DRAFT';
}

export const drawingNo = (project, n) => `GI-${projectCode(project)}-A-${String(n).padStart(3, '0')}`;

/**
 * The project title for the sheets: trimmed, spaces collapsed, control and stray symbol characters removed, and digits typed
 * inside a word (SI38NGLE) taken out. Falls back to "<n> bedroom house" or "Concept house".
 */
export function projectTitle(project) {
  const tb = project?.titleBlock || {};
  let t = clean(tb.projectName) || clean(project?.name) || '';
  t = t.replace(/[\u0000-\u001f\u007f<>{}[\]|\\^~`]+/g, ' ').replace(/(?<=[A-Za-z])\d+(?=[A-Za-z])/g, '').replace(/\s+/g, ' ').trim();
  if (t && /[A-Za-z0-9]/.test(t) && !/^untitled( design)?$/i.test(t)) return t;
  let beds = 0;
  for (const l of project?.levels || []) for (const r of l.rooms || []) if (/bed(room)?\b/i.test(String(r.type || r.name || '')) && !/ensuite|bath|robe/i.test(String(r.name || ''))) beds++;
  return beds > 0 ? `${beds} bedroom house` : 'Concept house';
}

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
