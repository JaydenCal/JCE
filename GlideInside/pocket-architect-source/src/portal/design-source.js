// The house designs of a signed in builder or client, loaded once per session and cached (the lot card carousel and the picker both read it).
// A lot change re-ranks the cached designs; it never refetches. Only a save to the library (or a sign out) invalidates the cache.
//   Builder or client: their own organisation's library (GET /api/portal/houses). The Glide Inside library is added only when `wantsGlide`
//   says so, and the carousel falls back to it only for builder staff with an empty library (allowGlide).

import { wantsGlide } from './design-mode.js';
import { builderDesigns } from '../lotcard/designs.js';

export function createDesignSource({ api, me, params = new URLSearchParams(), clientLike = false } = {}) {
  let cache = null;
  async function fetchAll() {
    const [mine, glide] = await Promise.all([api.listHouses(), (wantsGlide(me, params) ? api.listGlideLibrary().catch(() => []) : Promise.resolve([]))]);
    const full = async (list, getter, group) => Promise.all((list || []).map(async (x) => {
      const r = await getter(x.id);
      return { id: x.id, name: x.name, group, project: r.project, meta: x, source: group === 'glide' ? 'glide' : 'house' };
    }));
    return [...(await full(mine, (id) => api.getHouse(id), 'builder')), ...(await full(glide, (id) => api.getGlideModel(id), 'glide'))];
  }
  /** All designs, from the cache after the first call. A failed load is not cached. */
  function load({ force = false } = {}) {
    if (!cache || force) {
      cache = fetchAll().catch((e) => { cache = null; throw e; });
    }
    return cache;
  }
  return {
    load,
    invalidate() { cache = null; },
    /** The lot card provider: the cached designs ranked for the project's lot. */
    async lotDesigns(project) { return builderDesigns(project, await load(), { allowGlide: !clientLike }); },
  };
}
