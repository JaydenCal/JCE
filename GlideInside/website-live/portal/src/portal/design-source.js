// The house designs of a signed in builder or client, loaded once per session and cached (the lot card carousel and the picker both read it).
// A lot change re-ranks the cached designs; it never refetches. Only a save to the library (or a sign out) invalidates the cache.
//   Builder or client: their own organisation's library (GET /api/portal/houses). The Glide Inside library is added only when `wantsGlide`
//   says so, and the carousel falls back to it only for builder staff with an empty library (allowGlide).

import { wantsGlide } from './design-mode.js?v=20261119c';
import { builderDesigns } from '../lotcard/designs.js?v=20261119c';

export function createDesignSource({ api, me, params = new URLSearchParams(), clientLike = false } = {}) {
  let cache = null;
  async function fetchAll() {
    const [mine, glide] = await Promise.all([api.listHouses(), (wantsGlide(me, params) ? api.listGlideLibrary().catch(() => []) : Promise.resolve([]))]);
    // The owner's internal test account is sent every builder's designs, marked readOnly with the builder's name. They are grouped by builder
    // ('other') and never offered on the lot card, which ranks the account's own library only.
    const full = async (list, getter, group) => Promise.all((list || []).map(async (x) => {
      const r = await getter(x.id);
      const other = group === 'builder' && x.readOnly === true;
      return { id: x.id, name: x.name, group: other ? 'other' : group, builderName: other ? x.builder?.name || 'Another builder' : null, project: r.project, meta: x, source: group === 'glide' ? 'glide' : 'house' };
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
    async lotDesigns(project) { return builderDesigns(project, await load(), { allowGlide: !clientLike && me?.org?.internal === true }); },
  };
}
