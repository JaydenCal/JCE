// Title block form: every TITLE_BLOCK_FIELDS entry in an in-page modal, saved with set_titleblock.
// Opened from the design summary and, through window.__ps.openTitleBlock(), from the PDF preview.

import { TITLE_BLOCK_FIELDS, defaultTitleBlock } from '../model/schema.js';
import { h } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';

export function todayDDMMYYYY(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
}

const LOGO_KEY = 'ps.logo';
const LOGO_MAX_W = 600;

export function getLogo() {
  try {
    const v = localStorage.getItem(LOGO_KEY);
    return v && v.startsWith('data:image/') ? v : null;
  } catch {
    return null;
  }
}

function setLogo(url) {
  try {
    if (url) localStorage.setItem(LOGO_KEY, url);
    else localStorage.removeItem(LOGO_KEY);
    return true;
  } catch {
    return false;
  }
}

// Reads a PNG or JPG, scales it to at most 600 px wide and resolves with a data URL.
export function scaleLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) return reject(new Error('Choose a PNG or JPG image.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.onload = () => {
        const k = Math.min(1, LOGO_MAX_W / img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function openTitleBlockForm(store, { onSaved } = {}) {
  const current = { ...defaultTitleBlock(), ...(store.project.titleBlock || {}) };
  if (!String(current.date || '').trim()) current.date = todayDDMMYYYY();
  const inputs = {};
  const grid = h('div', { class: 'ps-tb-form' });
  for (const [key, label] of TITLE_BLOCK_FIELDS) {
    const id = `ps-tb-${key}`;
    const long = key === 'notes';
    const input = long
      ? h('textarea', { class: 'ps-input ps-tb-notes', id, rows: '3', maxlength: '200', spellcheck: 'true' })
      : h('input', { class: 'ps-input', id, type: 'text', maxlength: '200', autocomplete: 'off', spellcheck: 'false', placeholder: key === 'date' ? 'DD/MM/YYYY' : null });
    input.value = current[key] ?? '';
    inputs[key] = input;
    grid.append(h('div', { class: `ps-tb-field${long || key === 'projectName' || key === 'address' ? ' ps-tb-field--wide' : ''}` }, h('label', { for: id }, label), input));
  }
  // Company logo: stored in this browser only, printed in the title block.
  let logo = getLogo();
  const preview = h('div', { class: 'ps-logo-preview' });
  const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true, dataset: { ps: 'logo-input' } });
  const removeBtn = h('button', { class: 'ps-btn', type: 'button', onclick: () => { logo = null; setLogo(null); paintLogo(); } }, 'Remove');
  function paintLogo() {
    preview.replaceChildren(logo ? h('img', { src: logo, alt: 'Company logo preview' }) : h('span', { class: 'ps-hint' }, 'No logo added'));
    removeBtn.hidden = !logo;
  }
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const url = await scaleLogoFile(f);
      if (!setLogo(url)) toast('The logo could not be kept in this browser, so it will not be saved.', { kind: 'warn' });
      logo = url;
      paintLogo();
    } catch (e) {
      toast(e?.message || 'That image could not be used.', { kind: 'warn' });
    }
  });
  paintLogo();
  grid.append(h('div', { class: 'ps-tb-field ps-tb-field--wide' }, h('label', null, 'Company logo'),
    h('div', { class: 'ps-logo-row' }, preview, h('div', { class: 'ps-logo-actions' }, fileIn,
      h('button', { class: 'ps-btn', type: 'button', dataset: { action: 'upload-logo' }, onclick: () => fileIn.click() }, 'Upload PNG or JPG'), removeBtn))));
  return openModal({
    title: 'Title block',
    body: h('div', null, h('p', { class: 'ps-hint', style: { marginTop: 0 } }, 'These details print in the title block of every exported drawing sheet.'), grid),
    footer: (close) => [
      h('button', { class: 'ps-btn', type: 'button', onclick: () => close('cancel') }, 'Cancel'),
      h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { action: 'save-titleblock' }, onclick: () => {
        const values = Object.fromEntries(TITLE_BLOCK_FIELDS.map(([k]) => [k, inputs[k].value.trim()]));
        try {
          store.run('set_titleblock', values);
        } catch (e) {
          toast(e?.message || 'The title block could not be saved', { kind: 'warn' });
          return;
        }
        close('save');
        onSaved?.(values);
        toast('Title block saved.', { kind: 'ok' });
      } }, 'Save'),
    ],
  });
}
