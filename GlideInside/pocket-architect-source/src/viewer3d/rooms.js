// SHIM. The room snapping engine lives on branch claude/glide-rooms (src/viewer3d/rooms.js). This file only carries the same
// signatures so the lot card builds and tests; drop it and take the real file at merge.
//   listRoomTabs(project) -> [{ id, label, roomIds, caption }]  (last tab is always { id: 'aerial' })
//   snapToRoom(viewer, project, tabId) -> Promise<boolean>      (smooth glide to eye height in the room; 'aerial' returns to the site view)

const GROUPS = [
  ['living', 'Living', ['living', 'family', 'rumpus', 'media'], 'A view across the living room.'],
  ['kitchen', 'Kitchen', ['kitchen'], 'The kitchen and its bench.'],
  ['dining', 'Dining', ['dining'], 'The dining area.'],
  ['bedrooms', 'Bedrooms', ['bedroom'], 'A bedroom.'],
  ['alfresco', 'Alfresco', ['alfresco', 'verandah', 'patio'], 'The covered outdoor area.'],
  ['garage', 'Garage', ['garage', 'carport'], 'The garage.'],
];

export function listRoomTabs(project) {
  const rooms = (project?.levels || []).flatMap((l) => l.rooms || []).filter((r) => r.status !== 'demolish');
  const tabs = [];
  for (const [id, label, types, line] of GROUPS) {
    const ids = rooms.filter((r) => types.includes(r.type)).map((r) => r.id);
    if (ids.length) tabs.push({ id, label: id === 'bedrooms' && ids.length === 1 ? 'Bedroom' : label, roomIds: ids, caption: `${label} · ${line}` });
  }
  tabs.push({ id: 'aerial', label: 'Aerial', roomIds: [], caption: 'Aerial · The whole lot from above.' });
  return tabs;
}

export async function snapToRoom(viewer, project, tabId) {
  if (!viewer) return false;
  if (tabId === 'aerial') { viewer.resetCamera?.(); return true; }
  return false;
}
