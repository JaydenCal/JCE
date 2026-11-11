// Builder branding: logo, name and colour scheme. Glide Inside keeps a small credit on every sheet.

import { h, field, busy, toast, scaleLogoFile, errorMessage } from './kit.js';
import { GI_DEFAULT, normaliseHex, validateColours, deriveTheme, pickColoursFromLogo, hasBrand } from '../theme.js';
import { previewStyle, injectSettingsStyles } from '../theme-css.js';

export function renderBranding(host, { api, me, refreshMe }) {
  injectSettingsStyles();
  const canWrite = me.permissions.includes('branding.write');
  // Colour scheme state. useDefault means "Glide Inside look": nothing is stored for the org.
  const saved = me.org.branding.colours;
  const cols = { primary: saved?.primary || GI_DEFAULT.primary, accent: saved?.accent || (saved ? saved.primary : GI_DEFAULT.accent), darkInk: saved?.darkInk || '', darkBg: saved?.darkBg || '' };
  let useDefault = !hasBrand(saved);
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
  const colPreview = h('div', { class: 'gi-prev', role: 'img', 'aria-label': 'Colour scheme preview' });
  const adjustNote = h('ul', { class: 'gi-adjust', 'aria-live': 'polite' });
  const inputs = {};
  const swatchHost = h('div', { class: 'gi-swatches' });
  function paintColours() {
    const c = useDefault ? GI_DEFAULT : cols;
    const t = deriveTheme(c);
    colPreview.setAttribute('style', previewStyle(c));
    colPreview.replaceChildren(
      h('div', { class: 'gi-prev-bar' }, logo ? h('img', { src: logo, alt: '' }) : null, h('strong', null, name.value || 'Your name'), h('small', null, 'Builder dashboard')),
      h('div', { class: 'gi-prev-body' },
        h('div', { class: 'gi-prev-tabs' }, h('span', null, 'House designs'), h('span', null, 'Clients'), h('span', null, 'Billing')),
        h('div', { class: 'gi-prev-row' }, h('span', { class: 'gi-prev-btn' }, 'Open Pocket Architect'), h('span', { class: 'gi-prev-link' }, 'View client list')),
        h('div', { class: 'gi-prev-note' }, 'Notices and highlights use a soft tint of your accent.')),
      h('div', { class: 'gi-prev-foot' }, 'Powered by Glide Inside'));
    adjustNote.replaceChildren(...(useDefault ? [h('li', null, 'Using the Glide Inside default colours.')] : t.adjusted.map((x) => h('li', null, x))));
  }
  function colourField(key, label, hint, { optional = false } = {}) {
    const val = () => (useDefault ? GI_DEFAULT[key] || '' : cols[key]);
    const picker = h('input', { type: 'color', value: normaliseHex(val()) || '#000000', disabled: !canWrite, 'aria-label': `${label} picker`, oninput: () => set(picker.value) });
    const text = h('input', { type: 'text', maxlength: '7', value: val(), placeholder: optional ? 'none' : '#rrggbb', readonly: !canWrite, 'aria-label': `${label} hex`, oninput: () => set(text.value, true) });
    function set(v, fromText = false) {
      const n = normaliseHex(v);
      if (fromText && v.trim() === '' && optional) { cols[key] = ''; text.removeAttribute('aria-invalid'); useDefault = false; return paintColours(); }
      if (!n) { text.setAttribute('aria-invalid', 'true'); return; }
      text.removeAttribute('aria-invalid');
      if (useDefault) { Object.assign(cols, { primary: GI_DEFAULT.primary, accent: GI_DEFAULT.accent }); useDefault = false; }
      cols[key] = n;
      if (!fromText) text.value = n; else picker.value = n;
      paintColours();
    }
    inputs[key] = { picker, text, sync() { const x = val(); picker.value = normaliseHex(x) || '#000000'; text.value = x; text.removeAttribute('aria-invalid'); } };
    return h('div', { class: 'gi-col-field' }, h('label', null, label), h('div', { class: 'gi-col-row' }, picker, text), h('p', { class: 'pp-hint' }, hint));
  }
  const syncInputs = () => Object.values(inputs).forEach((i) => i.sync());
  const pickBtn = h('button', { class: 'pp-btn pp-btn--sm', type: 'button', disabled: !canWrite, onclick: async () => {
    if (!logo) return toast('Upload a logo first, then pick colours from it.', { kind: 'error' });
    const found = await pickColoursFromLogo(logo, 3);
    if (!found.length) return toast('No strong colours found in that logo. Choose colours with the pickers.', { kind: 'error' });
    swatchHost.replaceChildren(...found.map((hex) => h('div', { class: 'gi-swatch' }, h('i', { style: { background: hex }, title: hex }), hex,
      h('span', null, h('button', { type: 'button', onclick: () => use('primary', hex) }, 'Primary'), h('button', { type: 'button', onclick: () => use('accent', hex) }, 'Accent')))));
    if (useDefault) { use('primary', found[0]); if (found[1]) use('accent', found[1]); }
  } }, 'Pick from logo');
  function use(key, hex) {
    if (useDefault) { Object.assign(cols, { primary: GI_DEFAULT.primary, accent: GI_DEFAULT.accent }); useDefault = false; }
    cols[key] = hex;
    if (key === 'primary' && !saved?.accent && cols.accent === GI_DEFAULT.accent) cols.accent = hex;
    syncInputs(); paintColours();
  }
  const resetBtn = h('button', { class: 'pp-btn pp-btn--sm', type: 'button', disabled: !canWrite, onclick: () => { useDefault = true; cols.darkInk = ''; cols.darkBg = ''; swatchHost.replaceChildren(); syncInputs(); paintColours(); } }, 'Reset to Glide Inside default');
  const colourSection = h('section', { class: 'gi-colours', 'aria-labelledby': 'gi-col-h' },
    h('div', null, h('h3', { id: 'gi-col-h' }, 'Colour scheme'), h('p', { class: 'pp-hint' }, 'When your team or clients sign in, the dashboard and Pocket Architect switch to these colours, with a small "Powered by Glide Inside" credit. The public site and the free app keep the Glide Inside look.')),
    h('div', { class: 'gi-col-grid' },
      colourField('primary', 'Primary colour', 'Top bar and headers.'),
      colourField('accent', 'Accent colour', 'Buttons, links, tabs and highlights. Defaults to your primary.')),
    h('details', { class: 'gi-dark' }, h('summary', null, 'Dark mode colours (optional)'),
      h('div', { class: 'gi-col-grid' }, colourField('darkInk', 'Dark mode text', 'Text colour in dark mode.', { optional: true }), colourField('darkBg', 'Dark mode background', 'Page background in dark mode.', { optional: true }))),
    h('div', { class: 'pp-actions' }, pickBtn, resetBtn), swatchHost,
    h('div', null, h('h4', null, 'Preview'), colPreview, adjustNote));
  function preview() {
    paintColours();
    pv.replaceChildren(
      h('div', { class: 'pp-tb-brand' }, logo ? h('img', { src: logo, alt: '' }) : h('span', { class: 'pp-tb-nologo' }, 'No logo'), h('strong', null, name.value || 'Your name')),
      h('div', { class: 'pp-tb-cell' }, h('small', null, 'Project'), 'Lot 14, 22 Banksia Rise'),
      h('div', { class: 'pp-tb-cell' }, h('small', null, 'Sheet'), 'A-101 Ground floor plan'),
      h('div', { class: 'pp-tb-credit' }, 'Made with Pocket Architect by Glide Inside'));
  }
  const save = h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => busy(save, async () => {
    let colours = null;
    if (!useDefault) {
      const v = validateColours({ primary: cols.primary, accent: cols.accent, darkInk: cols.darkInk, darkBg: cols.darkBg });
      if (!v.ok) { toast(Object.values(v.errors)[0], { kind: 'error' }); return; }
      colours = v.colours;
    }
    await api.setBranding({ displayName: name.value, logoDataUrl: logo || null, colours });
    toast('Branding saved. Your team and clients see it next time they sign in.', { kind: 'ok' });
    refreshMe?.();
  }) }, 'Save branding');
  host.append(
    h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'Branding'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Your logo and name appear in Pocket Architect for your clients and in the title block of every plan they produce. Glide Inside keeps a small credit line on the sheet.'))),
    h('div', { class: 'pp-two' },
      h('div', { class: 'pp-form' }, field('Name shown on plans', () => name, { required: true }),
        field('Logo (PNG or JPG)', () => fileInput, { hint: 'Scaled to 600 px wide. A wide logo on a plain background works best.' }),
        h('div', { class: 'pp-actions' }, canWrite ? save : null, canWrite && logo ? h('button', { class: 'pp-btn', type: 'button', onclick: () => { logo = null; fileInput.value = ''; preview(); } }, 'Remove logo') : null)),
      h('div', null, h('h3', null, 'Title block preview'), pv)),
    colourSection);
  preview();
}
