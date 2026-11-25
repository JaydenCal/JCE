// The sample lot with a real aerial. The home page frame, "Try a sample lot" and ?sample=1 open a lot from static files shipped with the site
// (website-live/plan-studio/sample/), so the first view has a real NSW aerial and contours under it, loads at once and never calls a NSW service
// at page load. The files are made once, from a real vacant lot, by tools/export-sample-lot.mjs, and checked in.
//
//   sample-lot.json            the manifest: { schema: 1, status: 'ready', lot, aerial: { file, meta }, aerialWide: { file, meta }, contours, credit }
//   sample-lot-aerial.jpg      the sharp inner aerial (the same image the lookup gets from NSW Spatial Services)
//   sample-lot-aerial-wide.jpg the wider ring around it (optional)
//
// While the manifest says status "placeholder" (or is missing, or a file will not load) the synthetic sample lot is used exactly as before
// (src/site/demo-lot.js). Commercial always uses the synthetic lot.

import { demoSite } from './demo-lot.js';

export const SAMPLE_SCHEMA = 1;
export const SAMPLE_DIR = 'plan-studio/sample/';
export const SAMPLE_MANIFEST = 'sample-lot.json';
export const SAMPLE_CREDIT = 'Aerial imagery and ground levels: NSW Spatial Services, Department of Customer Service.';

const isBox = (b) => !!b && ['minE', 'minN', 'maxE', 'maxN'].every((k) => Number.isFinite(Number(b[k])));

/** Pure: is this manifest one we can open? Returns the reason it is not, or null. */
export function manifestProblem(m) {
  if (!m || typeof m !== 'object') return 'no manifest';
  if (m.schema !== SAMPLE_SCHEMA) return 'unknown schema';
  if (m.status !== 'ready') return `status is ${String(m.status)}`;
  const lot = m.lot;
  if (!lot?.lot?.polygons?.length || !lot.origin || !Number.isFinite(Number(lot.origin.e)) || !Number.isFinite(Number(lot.origin.n))) return 'no lot';
  if (!m.aerial?.file || !isBox(m.aerial.meta?.bbox)) return 'no aerial';
  if (m.aerialWide && (!m.aerialWide.file || !isBox(m.aerialWide.meta?.bbox))) return 'bad wide aerial';
  return null;
}

/** Pure: the lot response of the sample, flagged as the sample lot (so it is labelled, never restored, never looked up again). */
export function sampleLotResponse(m) {
  const lot = structuredClone(m.lot);
  lot.sample = true;
  lot.demo = true;
  lot.lot = { ...lot.lot, lotLabel: 'Sample lot', lotNumber: '', planLabel: '', lotPlan: '', section: '' };
  lot.attribution = lot.attribution || SAMPLE_CREDIT;
  return lot;
}

const here = () => (typeof location !== 'undefined' ? location.href : null);

/** Where the sample files are, from the page the app runs on (/plan-studio/app/ -> /plan-studio/sample/). */
export function sampleBase(pageUrl = here()) {
  if (!pageUrl) return null;
  try { return new URL('../sample/', pageUrl).href; } catch { return null; }
}

/**
 * The prefetched site the sample lot goes through applySiteLookup with: the real one when its files are in place, else the synthetic one.
 * Never throws. `opts.commercial` always gets the synthetic lot. `base` and `fetchImpl` are for tests.
 */
export async function loadSampleSite(opts = {}, { base = sampleBase(), fetchImpl = globalThis.fetch } = {}) {
  const fallback = () => demoSite(opts);
  if (opts?.commercial || !base || typeof fetchImpl !== 'function') return fallback();
  try {
    const r = await fetchImpl(new URL(SAMPLE_MANIFEST, base).href, { headers: { accept: 'application/json' } });
    if (!r?.ok) return fallback();
    const m = await r.json();
    if (manifestProblem(m)) return fallback();
    const img = async (f) => {
      const res = await fetchImpl(new URL(f.file, base).href);
      if (!res?.ok) throw new Error(`${f.file} would not load`);
      return { blob: await res.blob(), meta: structuredClone(f.meta) };
    };
    const aerial = await img(m.aerial);
    let aerialWide = null;
    if (m.aerialWide) { try { aerialWide = await img(m.aerialWide); } catch { aerialWide = null; } } // the wide ring is optional
    return { lot: sampleLotResponse(m), aerial, aerialWide, contours: m.contours || null, warnings: [], real: true };
  } catch {
    return fallback();
  }
}

/**
 * Pure: the manifest the export tool writes, from a fetchSite() result. `files` names the two image files. Throws when the lot has no aerial.
 */
export function buildSampleManifest(site, { files = { aerial: 'sample-lot-aerial.jpg', wide: 'sample-lot-aerial-wide.jpg' }, address = '', exportedOn = '' } = {}) {
  if (!site?.lot?.lot) throw new Error('The lookup returned no lot.');
  if (!site.aerial?.meta) throw new Error('The lookup returned no aerial: nothing to ship.');
  const { sample, demo, ...lot } = site.lot; // eslint-disable-line no-unused-vars
  return {
    schema: SAMPLE_SCHEMA,
    status: 'ready',
    address,
    exportedOn,
    credit: SAMPLE_CREDIT,
    lot,
    aerial: { file: files.aerial, meta: site.aerial.meta },
    aerialWide: site.aerialWide?.meta ? { file: files.wide, meta: site.aerialWide.meta } : null,
    contours: site.contours || null,
  };
}
