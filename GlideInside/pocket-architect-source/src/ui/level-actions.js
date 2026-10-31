// Shared level actions: delete a level after an in-page confirmation. Used by the level tabs, the level chip menu and the summary panel.

import { askConfirm } from './modal.js';
import { toast } from './toast.js';

export async function deleteLevelWithConfirm(store, id) {
  const level = store.project.levels.find((l) => l.id === id);
  if (!level || store.project.levels.length < 2) return false;
  const ok = await askConfirm({
    title: `Delete ${level.name}?`,
    message: 'Its rooms, walls and furniture will be removed. You can undo.',
    confirmLabel: 'Delete level',
    danger: true,
  });
  if (!ok) return false;
  try {
    store.run('delete', { id });
    if (!store.project.levels.some((l) => l.id === store.ui.activeLevelId)) store.setUI({ activeLevelId: store.project.levels[0].id });
    if (store.ui.levelFilter !== 'all' && !store.project.levels.some((l) => l.id === store.ui.levelFilter)) store.setUI({ levelFilter: 'all' });
    toast(`Deleted ${level.name}.`, { action: { label: 'Undo', onClick: () => store.undo() } });
    return true;
  } catch (e) {
    toast(e?.message || 'That level could not be deleted', { kind: 'warn' });
    return false;
  }
}
