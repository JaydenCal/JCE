// "Replace house" or "Add another building": asked when a design is chosen for a lot that already has a house, so two designs never stack by accident.
// hasBuilding is pure and tested; the dialog loads on use.

/** True when the design already holds a house or building (a placed design, rooms or walls). */
export function hasBuilding(project) {
  if (!project) return false;
  if (project.placedHouse) return true;
  return (project.levels || []).some((l) => (l.rooms || []).length || (l.walls || []).length);
}

/** The wording. */
export function placeChoiceText(name, existing = 'house') {
  return {
    title: `Place ${name || 'this design'}`,
    message: `This lot already has a ${existing}. Replace it with ${name || 'this design'}, or keep it and add ${name || 'this design'} as another building?`,
    replace: 'Replace house',
    add: 'Add another building',
    cancel: 'Cancel',
  };
}

/** Resolves 'replace', 'add' or null (cancelled). Resolves 'add' at once when there is nothing to replace. */
export async function askPlaceChoice(project, name, { existing = 'house' } = {}) {
  if (!hasBuilding(project)) return 'add';
  const { openModal } = await import('./modal.js');
  const { h } = await import('./dom.js');
  const t = placeChoiceText(name, existing);
  return new Promise((resolve) => {
    let answer = null;
    openModal({
      title: t.title, size: 'sm',
      body: h('p', { style: { margin: '0 0 4px' } }, t.message),
      footer: (close) => [
        h('button', { class: 'ps-btn', type: 'button', dataset: { act: 'cancel' }, onclick: () => close('cancel') }, t.cancel),
        h('button', { class: 'ps-btn', type: 'button', dataset: { act: 'add' }, onclick: () => { answer = 'add'; close('add'); } }, t.add),
        h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { act: 'replace' }, onclick: () => { answer = 'replace'; close('replace'); } }, t.replace),
      ],
      onClose: () => resolve(answer),
    });
  });
}
