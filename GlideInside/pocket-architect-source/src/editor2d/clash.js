// Furniture that clips a wall: which items clash, a quiet change detector and the toast text.

import { furnitureClashes } from '../model/ops.js';

// Set of furniture ids that clip a wall in `project`.
export function clashIds(project, catalogue) {
  try {
    return new Set(furnitureClashes(project, (id) => catalogue?.getFurniture?.(id) || null).map((c) => c.furnitureId));
  } catch {
    return new Set();
  }
}

// Clash entries with the item name and level name, for the summary warnings.
export function clashList(project, catalogue) {
  let list = [];
  try {
    list = furnitureClashes(project, (id) => catalogue?.getFurniture?.(id) || null);
  } catch {
    return [];
  }
  return list.map((c) => {
    const level = project.levels.find((l) => l.id === c.levelId);
    const f = level?.furniture.find((x) => x.id === c.furnitureId);
    const name = catalogue?.getFurniture?.(f?.item)?.name || String(f?.item || 'Furniture').replace(/[_-]+/g, ' ');
    return { ...c, name, levelName: level?.name || '' };
  });
}

// Remembers which ids have already been announced. `notify(ids, announce)` calls announce(newIds)
// for ids that were not clashing before; ids that stop clashing are forgotten so they can warn again.
export function createClashNotifier() {
  let known = new Set();
  return {
    silent(ids) {
      known = new Set(ids);
    },
    notify(ids, announce) {
      const fresh = [...ids].filter((id) => !known.has(id));
      known = new Set(ids);
      if (fresh.length) announce(fresh);
    },
  };
}
