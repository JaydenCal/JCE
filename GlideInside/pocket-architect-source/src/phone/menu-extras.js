// The phone editor Menu: what used to float over the 3D view lives here instead (owner 25/11/2026). Room tour, the top view, Edit room, the
// Edit toggle, the design switcher, the lot label, the aerial photo, the concept line, and a note about the desktop tool with a link to send
// to yourself. The pieces are the real controls of the 3D view, kept in the page but hidden on a phone, so each row simply taps its control.

import { h } from '../ui/dom.js';
import { hasAerial, aerialOn, setAerial } from '../site/aerial-pref.js';
import { shareDesign } from './actions.js';
import { isGrannyDesign } from '../model/granny-sizes.js';

export const COMPUTER_NOTE = 'For the detailed design tool, open glideinside.com.au on a computer';
export const CONCEPT_SHORT = 'Concept design only';

const q = (sel, root = document) => root.querySelector(sel);
const textOf = (sel) => (q(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
const tap = (el) => { try { el?.click(); } catch { /* gone */ } };

/** The list of rows for the current view, as plain data (so it can be tested): { kind, label, ... }. */
export function extrasModel({ store, doc = document } = {}) {
  const view = store?.ui?.view;
  const in3d = view === '3d';
  const rows = [];
  const lot = [...(doc.querySelector('[data-ps=lot-head]')?.children || [])].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' \u00b7 ');
  if (lot && in3d) rows.push({ kind: 'text', ps: 'pme-lot', label: lot });
  const back = doc.querySelector('[data-ps=flow-back-to-placement]');
  if (back && !back.hidden) rows.push({ kind: 'button', ps: 'pme-placement', label: 'Back to placement', hint: 'Move, add or turn the home', run: () => tap(back) });
  if (store && isGrannyDesign(store.project)) rows.push({ kind: 'button', ps: 'pme-size-rooms', label: 'Size and rooms', hint: 'Type the width and length of the flat and each room', run: () => window.__ps?.openGrannyDesigner?.() });
  if (in3d) {
    const tabs = [...doc.querySelectorAll('[data-ps=lc-tabs-compact] .lc-tab')];
    if (tabs.length) rows.push({ kind: 'chips', ps: 'pme-rooms', label: 'Room tour', hint: 'Look at the house from a room', chips: tabs.map((t) => ({ label: t.textContent.trim(), selected: t.getAttribute('aria-selected') === 'true', run: () => tap(t) })) });
    const prev = doc.querySelector('[data-ps=lc-pager] button[aria-label="Previous design"]');
    const next = doc.querySelector('[data-ps=lc-pager] button[aria-label="Next design"]');
    if (prev && next) rows.push({ kind: 'switcher', ps: 'pme-design', label: 'Design', current: textOf('[data-ps=lc-pager-text]'), prev: () => tap(prev), next: () => tap(next) });
    const mini = doc.querySelector('[data-ps=lc-mini]');
    if (mini) rows.push({ kind: 'button', ps: 'pme-topview', label: 'Top view', hint: 'See the lot from above', run: () => tap(mini) });
    const roomEdit = doc.querySelector('.ps3d-redit-arm');
    if (roomEdit) rows.push({ kind: 'button', ps: 'pme-edit-room', label: 'Edit room', hint: 'Change the size of a room', run: () => tap(roomEdit) });
    const toggle = doc.querySelector('.ps3d-editbar .ps3d-edit:not(.ps3d-redit-arm)');
    if (toggle) rows.push({ kind: 'toggle', ps: 'pme-edit', label: 'Edit in 3D', hint: 'Move walls, doors and furniture', on: toggle.getAttribute('aria-pressed') === 'true', run: () => tap(toggle) });
    if (store && hasAerial(store.project)) rows.push({ kind: 'toggle', ps: 'pme-aerial', label: 'Aerial photo', hint: 'Show or hide the aerial under the lot', on: aerialOn(store.project), run: () => setAerial(store, !aerialOn(store.project)) });
    const credit = (doc.querySelector('.ps-credit')?.textContent || '').replace(/\s+/g, ' ').trim();
    if (credit) rows.push({ kind: 'small', ps: 'pme-credit', label: credit });
  }
  rows.push({ kind: 'small', ps: 'pme-concept', label: CONCEPT_SHORT, run: () => tap(doc.querySelector('.ps-status-btn[title]')) });
  rows.push({ kind: 'note', ps: 'pme-computer', label: COMPUTER_NOTE, button: { ps: 'pme-send-link', label: 'Send me the link' } });
  return rows;
}

/** Draw the rows into one block that sits at the top of the Menu sheet. `close` closes the Menu after an action. */
export function buildMenuExtras({ store, close = () => {}, doc = document } = {}) {
  const wrap = h('div', { class: 'ps-pme', dataset: { ps: 'phone-menu-extras' } });
  const done = (fn) => () => { close(); fn?.(); };
  for (const r of extrasModel({ store, doc })) {
    if (r.kind === 'text') wrap.append(h('p', { class: 'ps-pme-lot', dataset: { ps: r.ps } }, r.label));
    else if (r.kind === 'button') wrap.append(h('button', { class: 'ps-pme-row', type: 'button', dataset: { ps: r.ps }, onclick: done(r.run) }, h('b', null, r.label), r.hint ? h('small', null, r.hint) : null));
    else if (r.kind === 'toggle') wrap.append(h('button', { class: 'ps-pme-row', type: 'button', 'aria-pressed': String(!!r.on), dataset: { ps: r.ps }, onclick: done(r.run) }, h('b', null, `${r.label}: ${r.on ? 'On' : 'Off'}`), r.hint ? h('small', null, r.hint) : null));
    else if (r.kind === 'chips') wrap.append(h('div', { class: 'ps-pme-block', dataset: { ps: r.ps } }, h('b', null, r.label), h('small', null, r.hint), h('div', { class: 'ps-pme-chips' }, ...r.chips.map((c) => h('button', { class: 'ps-pme-chip', type: 'button', 'aria-pressed': String(!!c.selected), onclick: done(c.run) }, c.label)))));
    else if (r.kind === 'switcher') wrap.append(h('div', { class: 'ps-pme-block ps-pme-design', dataset: { ps: r.ps } }, h('b', null, r.label), h('div', { class: 'ps-pme-switch' }, h('button', { class: 'ps-pme-chip', type: 'button', 'aria-label': 'Previous design', onclick: () => { r.prev(); } }, '‹'), h('span', { class: 'ps-pme-cur' }, r.current || ''), h('button', { class: 'ps-pme-chip', type: 'button', 'aria-label': 'Next design', onclick: () => { r.next(); } }, '›'))));
    else if (r.kind === 'small') wrap.append(h('p', { class: 'ps-pme-small', dataset: { ps: r.ps } }, r.label));
    else if (r.kind === 'note') wrap.append(h('div', { class: 'ps-pme-block ps-pme-computer', dataset: { ps: r.ps } }, h('p', { class: 'ps-pme-note' }, r.label), h('button', { class: 'ps-pme-row ps-pme-send', type: 'button', dataset: { ps: r.button.ps }, onclick: async () => { const out = await shareDesign(); if (out) close(); } }, h('b', null, r.button.label))));
  }
  return wrap;
}

