// Steps 3 and 4 of the guided flow need the lot's aerial. Step 1 normally stores it, but when that request failed or was skipped the flow fetches it
// itself with the same service request the editor uses (/api/site/aerial: the inner high resolution tile plus the wider tile), once per lot.
import { fetchAerial, margin, innerAerialRes, wideAerialParams, WIDE_PX, WIDE_PX_NSW, AERIAL_TIMEOUT_MS, WIDE_AERIAL_TIMEOUT_MS, WIDE_SKIP_SPAN_M } from '../site/client.js';
import { aerialExtentPlan } from '../site/model.js';
import { storeAerials } from '../site/apply.js';
import { underlayFor } from '../site/model.js';
import { loadBitmap } from '../editor2d/underlay.js';

const pending = new Map();
export const NO_AERIAL = 'No aerial for this lot';

/** The lot's box in MGA metres from its plan boundary. */
export function lotBboxMga(lot) {
  const xs = lot.boundary.map((p) => p.x); const ys = lot.boundary.map((p) => p.y);
  return { minE: lot.origin.e + Math.min(...xs) / 1000, maxE: lot.origin.e + Math.max(...xs) / 1000, maxN: lot.origin.n - Math.min(...ys) / 1000, minN: lot.origin.n - Math.max(...ys) / 1000 };
}

/** Make sure the lot has a readable aerial. Resolves true when it has one, false when there genuinely is none. Never throws. deps: fetchImpl. */
export function ensureFlowAerial(store, deps = {}) {
  const lot = store.project.site?.lot;
  if (!lot) return Promise.resolve(false);
  const id = `${store.project.id}:${lot.origin?.e},${lot.origin?.n}`;
  if (pending.has(id)) return pending.get(id);
  const p = (async () => {
    try {
      if (lot.aerial?.key && (await loadBitmap(lot.aerial.key))) return true;
      if (lot.aerial?.userSupplied) return false;
      if (!['NSW', 'QLD'].includes(lot.state) || !lot.origin || !lot.boundary?.length || lot.sample || lot.demo) return false;
      const m = margin();
      const b = lotBboxMga(lot);
      const common = { state: lot.state, srid: String(lot.srid), origin: `${lot.origin.e},${lot.origin.n}` };
      const opts = { fetchImpl: deps.fetchImpl || globalThis.fetch, timeoutMs: AERIAL_TIMEOUT_MS };
      const innerParams = { ...common, bbox: `${b.minE - m},${b.minN - m},${b.maxE + m},${b.maxN + m}`, res: innerAerialRes(b, m) };
      let inner;
      try { inner = await fetchAerial(innerParams, opts); } catch { await new Promise((r) => setTimeout(r, deps.retryMs ?? 1500)); inner = await fetchAerial(innerParams, opts); } // one retry: the imagery service is busy now and then
      let wide = null;
      if (Math.max(b.maxE - b.minE, b.maxN - b.minN) <= WIDE_SKIP_SPAN_M) { try { wide = await fetchAerial({ ...common, ...wideAerialParams(b, lot.state === 'NSW' ? WIDE_PX_NSW : WIDE_PX) }, { ...opts, timeoutMs: WIDE_AERIAL_TIMEOUT_MS }); } catch { /* optional */ } }
      const warnings = [];
      const { aerialKey, aerialWideKey } = await storeAerials(store, { aerial: inner, aerialWide: wide }, warnings);
      if (!aerialKey) return false;
      const cur = store.project.site?.lot;
      if (!cur || cur.origin?.e !== lot.origin.e || cur.origin?.n !== lot.origin.n) return false;
      cur.aerial = { key: aerialKey, source: inner.meta.source || '', attribution: inner.meta.attribution || '', captureDate: inner.meta.captureDate || null, mmPerPx: inner.meta.mmPerPx, extent: aerialExtentPlan(inner.meta.bbox, cur.origin) };
      if (aerialWideKey && wide) cur.aerialWide = { key: aerialWideKey, mmPerPx: wide.meta.mmPerPx, extent: aerialExtentPlan(wide.meta.bbox, cur.origin) };
      cur.provenance = { ...(cur.provenance || {}), aerial: { source: inner.meta.source, attribution: inner.meta.attribution, captureDate: inner.meta.captureDate || null } };
      store.project.site.underlay = underlayFor(cur);
      store.emit('project', { label: 'aerial' });
      return true;
    } catch {
      return false;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, p);
  return p;
}
