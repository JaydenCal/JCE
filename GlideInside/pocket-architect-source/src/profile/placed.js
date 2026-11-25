// A house placed on a real lot (not the sample lot): the moment the small Save your design card is timed from. No DOM, covered by tests/analytics-ga.test.mjs.

/** The lot on the design is the built in sample lot (never counted as a real lot placement). */
export const isSampleLot = (project) => {
  const lot = project?.site?.lot;
  return !!lot && (lot.lotLabel === 'Sample lot' || lot.source === 'sample');
};

/** Identifies a house placed on a real lot: null until the design has both. Changes when the lot changes, not when the house is edited. */
export function placedLotKey(project) {
  const lot = project?.site?.lot;
  if (!lot || !project.placedHouse) return null;
  return `${lot.origin?.e ?? ''}|${lot.origin?.n ?? ''}|${lot.lotLabel || ''}|${lot.boundary?.length || 0}`;
}

const realHousePlaced = (project) => !!placedLotKey(project) && !isSampleLot(project);

/** Calls onPlaced(project) once for each real (not sample) lot that gets a house. Returns the unsubscribe function. */
export function watchHousePlaced(store, onPlaced) {
  let last = null;
  return store.on('project', () => {
    if (!realHousePlaced(store.project)) return;
    const key = placedLotKey(store.project);
    if (key === last) return;
    last = key;
    onPlaced(store.project);
  });
}
