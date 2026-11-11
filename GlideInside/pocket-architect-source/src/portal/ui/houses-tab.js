// House library ("Default layouts"): the builder's own designs. Add by saving the open design, importing a file,
// or starting from the Glide Inside library. Duplicate, archive, edit in Pocket Architect.

import { h, openDialog, field, busy, toast, chip, icon, errorMessage } from './kit.js';
import { svgDataUri } from '../thumbnail.js';
import { sizeLabel } from '../house-stats.js';
import { appLink, designLink } from '../links.js';
import { parseDesign } from '../../ui/design-file.js';
import { houseStats } from '../house-stats.js';

export const statsLine = (s) => [
  s.bedrooms ? `${s.bedrooms} bed` : null, s.bathrooms ? `${s.bathrooms} bath` : null, s.garage ? `${s.garage} car` : null,
  `${s.floorAreaM2} m²`, sizeLabel(s), `${s.storeys} ${s.storeys === 1 ? 'storey' : 'storeys'}`,
].filter(Boolean).join(' · ');

export function houseCard(hs, actions) {
  return h('article', { class: `pp-house${hs.archived ? ' is-archived' : ''}`, dataset: { id: hs.id } },
    h('img', { class: 'pp-house-thumb', src: svgDataUri(hs.thumbnail), alt: `Floor plan of ${hs.name}`, width: 320, height: 200, loading: 'lazy' }),
    h('div', { class: 'pp-house-body' },
      h('h3', null, hs.name, hs.archived ? chip('Archived', 'muted') : null),
      h('p', { class: 'pp-stats' }, statsLine(hs)),
      hs.category || hs.source ? h('p', { class: 'pp-sub' }, hs.category || ({ glide: 'From the Glide Inside library', saved: 'Saved from Pocket Architect', import: 'Imported file' }[hs.source?.type] || '')) : null),
    h('div', { class: 'pp-actions' }, ...actions));
}

export function renderHouses(host, { api, me, appLinkFor = appLink, designHref = designLink }) {
  const canWrite = me.permissions.includes('houses.write');
  const state = { q: '', beds: '', archived: false, items: [] };
  const grid = h('div', { class: 'pp-grid', role: 'list' });
  const count = h('p', { class: 'pp-sub', 'aria-live': 'polite' });

  async function load() {
    state.items = await api.listHouses({ includeArchived: true });
    paint();
  }
  function paint() {
    const q = state.q.toLowerCase();
    const items = state.items.filter((x) => (state.archived || !x.archived) && (!q || x.name.toLowerCase().includes(q)) && (!state.beds || (state.beds === '5' ? x.bedrooms >= 5 : x.bedrooms === Number(state.beds))));
    count.textContent = `${items.length} of ${state.items.filter((x) => state.archived || !x.archived).length} designs`;
    grid.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'pp-empty' }, state.items.length ? 'No designs match. Clear the search or filters.' : 'No house designs yet. Add one with the buttons above.')]));
  }
  function card(hs) {
    const rename = canWrite ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => renameDialog(hs) }, 'Rename') : null;
    return houseCard(hs, [
      h('a', { class: 'pp-btn pp-btn--sm pp-btn--primary', href: appLinkFor({ house: hs.id }), target: '_blank', rel: 'noopener' }, icon('open', 15), 'Edit in Pocket Architect'),
      canWrite ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { const c = await api.duplicateHouse(hs.id); toast(`Duplicated as "${c.name}".`, { kind: 'ok' }); await load(); }) }, 'Duplicate') : null,
      rename,
      canWrite ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api.archiveHouse(hs.id, !hs.archived); toast(hs.archived ? 'Restored.' : 'Archived. Clients can no longer see it.', { kind: 'ok' }); await load(); }) }, hs.archived ? 'Restore' : 'Archive') : null,
    ]);
  }
  function renameDialog(hs) {
    const input = h('input', { type: 'text', maxlength: '80', value: hs.name, required: true });
    openDialog({ title: 'Rename house design', size: 'sm', body: field('Name', () => input, { required: true }),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api.saveHouse({ id: hs.id, name: input.value }); d.close(); await load(); }) }, 'Save')] });
  }

  // Three ways to add a design.
  function saveCurrent() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('ps.autosave.v1') || 'null');
    } catch {
      saved = null;
    }
    if (!saved?.levels) {
      openDialog({ title: 'Save the open design', size: 'sm', body: h('p', null, 'No design is open in Pocket Architect in this browser yet. Open Pocket Architect, draw or change a design, then come back. You can also import a design file or start from the Glide Inside library.'),
        footer: (d) => [h('a', { class: 'pp-btn pp-btn--primary', href: appLinkFor(), target: '_blank', rel: 'noopener' }, 'Open Pocket Architect'), h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Close')] });
      return;
    }
    nameDialog({ title: 'Save the open design to your library', project: saved, defaultName: saved.name || 'My design', note: 'This is the design currently open in Pocket Architect in this browser.' });
  }
  function importFile() {
    const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) return toast('That file is larger than 25 MB.', { kind: 'error' });
      const res = parseDesign(await file.text());
      if (res.error) return toast(`${res.error}${res.problems?.length ? ` ${res.problems[0]}` : ''}`, { kind: 'error', timeout: 9000 });
      nameDialog({ title: 'Import design file', project: res.project, defaultName: res.project.name || file.name.replace(/\.json$/i, ''), note: `File: ${file.name}` });
    };
    document.body.append(input);
    input.click();
    input.remove();
  }
  function nameDialog({ title, project, defaultName, note }) {
    const input = h('input', { type: 'text', maxlength: '80', value: defaultName, required: true });
    const s = houseStats(project);
    openDialog({ title, size: 'sm',
      body: h('div', null, h('p', { class: 'pp-sub' }, note), field('Name in your library', () => input, { required: true }), h('p', { class: 'pp-stats' }, statsLine(s))),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { const r = await api.saveHouse({ name: input.value, project }); d.close(); toast(`Added "${r.name}" to your library.`, { kind: 'ok' }); await load(); }) }, 'Add to library')] });
  }
  async function fromGlide() {
    const lib = await api.listGlideLibrary();
    const list = h('div', { class: 'pp-pick' }, lib.map((g) => h('button', { class: 'pp-pick-item', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { const r = await api.saveHouse({ fromGlideId: g.id, name: `${g.name} (${me.org.branding.displayName})` }); d.close(); toast(`Added "${r.name}". Edit it in Pocket Architect to make it your own.`, { kind: 'ok' }); await load(); }) },
      h('img', { src: svgDataUri(g.thumbnail), alt: '', width: 96, height: 60 }), h('span', null, h('strong', null, g.name), h('small', null, statsLine(g))))));
    const d = openDialog({ title: 'Start from the Glide Inside library', size: 'lg', body: h('div', null, h('p', { class: 'pp-sub' }, 'Pick a model. A copy goes into your library, where you can edit it and rename it.'), list), footer: (x) => h('button', { class: 'pp-btn', type: 'button', onclick: () => x.close() }, 'Cancel') });
  }

  host.append(
    h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'House designs'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Your default layouts. Clients you give access to can place these on their lot. The Glide Inside library is hidden from clients unless you tick Show Glide Inside sample designs to clients.')),
      h('a', { class: 'pp-btn pp-btn--primary pp-btn--lg', id: 'design-on-lot-houses', href: designHref(), target: '_blank', rel: 'noopener' }, icon('open', 18), 'Design on a lot')),
    canWrite ? h('div', { class: 'pp-add' },
      h('span', { class: 'pp-add-label' }, 'Add a house design'),
      h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: saveCurrent }, icon('plus', 16), 'Save the open design'),
      h('button', { class: 'pp-btn', type: 'button', onclick: importFile }, icon('upload', 16), 'Import a design file'),
      h('button', { class: 'pp-btn', type: 'button', onclick: () => fromGlide().catch((e) => toast(errorMessage(e), { kind: 'error' })) }, 'Start from the Glide Inside library')) : null,
    h('div', { class: 'pp-filters' },
      h('label', { class: 'pp-inline' }, h('span', null, 'Search'), h('input', { type: 'search', placeholder: 'Design name', oninput: (e) => { state.q = e.target.value; paint(); } })),
      h('label', { class: 'pp-inline' }, h('span', null, 'Bedrooms'), h('select', { onchange: (e) => { state.beds = e.target.value; paint(); } }, h('option', { value: '' }, 'Any'), ...['2', '3', '4', '5'].map((n) => h('option', { value: n }, n === '5' ? '5 or more' : n)))),
      h('label', { class: 'pp-inline pp-check' }, h('input', { type: 'checkbox', onchange: (e) => { state.archived = e.target.checked; paint(); } }), h('span', null, 'Show archived')),
      count),
    grid);
  return load();
}
