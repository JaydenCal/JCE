// Open and save design files (.json). Nothing leaves the browser.

import { slug, downloadBlob, h } from './dom.js';
import { parseDesign } from './design-file.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

export function saveDesign(store) {
  store.saveNow?.();
  const text = JSON.stringify(store.project, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const name = `${slug(store.project.name)}.planstudio.json`;
  downloadBlob(blob, name);
  toast(`Saved ${name}. Keep the file safe: it is your copy of this design.`, { kind: 'ok' });
  return name;
}

export function showOpenError(message, problems = []) {
  openModal({
    title: 'This file could not be opened',
    size: 'sm',
    body: h('div', null,
      h('p', { style: { margin: '0 0 8px' } }, message),
      problems.length
        ? h('ul', { class: 'ps-hint', style: { margin: 0, paddingLeft: '18px' } }, problems.slice(0, 6).map((p) => h('li', null, p)), problems.length > 6 ? h('li', null, `and ${problems.length - 6} more`) : null)
        : null),
    footer: (close) => h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: () => close() }, 'Close'),
  });
}

// Show the file picker. `accept(project, fileName)` decides what to do with a valid project.
export function pickDesignFile(input, accept) {
  input.value = '';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      showOpenError('That file is larger than 25 MB, which is too big for a design file.');
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      showOpenError('That file could not be read.');
      return;
    }
    const res = parseDesign(text);
    if (res.error) showOpenError(res.error, res.problems);
    else accept(res.project, file.name);
  };
  input.click();
}
