// The Glide Inside library: every model Glide Inside has made, always available to every builder and client.

import { h, busy, toast, icon, chip, errorMessage } from './kit.js';
import { houseCard } from './houses-tab.js';
import { appLink } from '../links.js';

export async function renderGlide(host, { api, me, appLinkFor = appLink }) {
  const canWrite = me.permissions.includes('houses.write');
  const state = { cat: '' };
  const lib = await api.listGlideLibrary();
  const grid = h('div', { class: 'pp-grid', role: 'list' });
  const cats = [...new Set(lib.map((g) => g.category))];
  function paint() {
    grid.replaceChildren(...lib.filter((g) => !state.cat || g.category === state.cat).map((g) => houseCard(g, [
      h('a', { class: 'pp-btn pp-btn--sm', href: appLinkFor({ glide: g.id }), target: '_blank', rel: 'noopener' }, icon('open', 15), 'Open in Pocket Architect'),
      canWrite ? h('button', { class: 'pp-btn pp-btn--sm pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const r = await api.saveHouse({ fromGlideId: g.id, name: `${g.name} (${me.org.branding.displayName})` });
          toast(`Added "${r.name}" to your library.`, { kind: 'ok' });
        } catch (ex) {
          toast(ex.code === 'CONFLICT' ? 'That model is already in your library.' : errorMessage(ex), { kind: ex.code === 'CONFLICT' ? 'warn' : 'error' });
        }
      }) }, 'Add to my library') : null,
    ])));
  }
  host.append(
    h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'Glide Inside library'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Generic house, granny flat, duplex and shed models made by Glide Inside. They are always available to you. Clients see them only when you tick Show Glide Inside sample designs to clients. More models are added over time.'))),
    h('div', { class: 'pp-filters' }, h('label', { class: 'pp-inline' }, h('span', null, 'Type'), h('select', { onchange: (e) => { state.cat = e.target.value; paint(); } }, h('option', { value: '' }, 'All'), ...cats.map((c) => h('option', { value: c }, c)))), chip(`${lib.length} models`, 'muted')),
    grid);
  paint();
}
