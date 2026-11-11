// Builder branding: logo and name for the builder's plan title blocks. Glide Inside keeps a small credit on every sheet.

import { h, field, busy, toast, scaleLogoFile, errorMessage } from './kit.js';

export function renderBranding(host, { api, me, refreshMe }) {
  const canWrite = me.permissions.includes('branding.write');
  let logo = me.org.branding.logoDataUrl;
  const name = h('input', { type: 'text', maxlength: '60', value: me.org.branding.displayName, required: true, readonly: !canWrite, oninput: preview });
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg', disabled: !canWrite, onchange: async () => {
    try {
      logo = await scaleLogoFile(fileInput.files[0]);
      preview();
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    }
  } });
  const pv = h('div', { class: 'pp-titleblock', role: 'img', 'aria-label': 'Title block preview' });
  function preview() {
    pv.replaceChildren(
      h('div', { class: 'pp-tb-brand' }, logo ? h('img', { src: logo, alt: '' }) : h('span', { class: 'pp-tb-nologo' }, 'No logo'), h('strong', null, name.value || 'Your name')),
      h('div', { class: 'pp-tb-cell' }, h('small', null, 'Project'), 'Lot 14, 22 Banksia Rise'),
      h('div', { class: 'pp-tb-cell' }, h('small', null, 'Sheet'), 'A-101 Ground floor plan'),
      h('div', { class: 'pp-tb-credit' }, 'Made with Pocket Architect by Glide Inside'));
  }
  const save = h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => busy(save, async () => { await api.setBranding({ displayName: name.value, logoDataUrl: logo || null }); toast('Branding saved. New plans carry it.', { kind: 'ok' }); refreshMe?.(); }) }, 'Save branding');
  host.append(
    h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'Branding'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Your logo and name appear in Pocket Architect for your clients and in the title block of every plan they produce. Glide Inside keeps a small credit line on the sheet.'))),
    h('div', { class: 'pp-two' },
      h('div', { class: 'pp-form' }, field('Name shown on plans', () => name, { required: true }),
        field('Logo (PNG or JPG)', () => fileInput, { hint: 'Scaled to 600 px wide. A wide logo on a plain background works best.' }),
        h('div', { class: 'pp-actions' }, canWrite ? save : null, canWrite && logo ? h('button', { class: 'pp-btn', type: 'button', onclick: () => { logo = null; fileInput.value = ''; preview(); } }, 'Remove logo') : null)),
      h('div', null, h('h3', null, 'Title block preview'), pv)));
  preview();
}
