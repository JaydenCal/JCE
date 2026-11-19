// "Website widget": the See it on your block widget for the builder's own website. Switch, allowed websites, designs offered, the snippet to
// copy (script or iframe) and a live preview. A visitor enters an address, picks one of these designs and leaves their details; the lead
// goes to the Leads tab. Nothing is emailed. See docs/WIDGET_LEADS.md.

import { h, field, busy, toast, errorMessage, copyText } from './kit.js?v=20261119e';
import { widgetSnippets, widgetFrameUrl, originsFromText, WIDGET_HEIGHT } from '../widget-snippet.js?v=20261119e';
import { appBase } from '../links.js?v=20261119e';

export async function renderWidget(host, { api, me }) {
  const canWrite = me.permissions.includes('branding.write');
  let st = await api.getWidget();
  const origin = new URL(appBase(), location.href).origin;

  const enabled = h('input', { type: 'checkbox', checked: st.enabled, disabled: !canWrite, dataset: { ps: 'widget-enabled' } });
  const origins = h('textarea', { rows: '3', maxlength: '800', disabled: !canWrite, placeholder: 'https://www.yourbuilder.com.au', dataset: { ps: 'widget-origins' }, 'aria-label': 'Websites that may show the widget' });
  origins.value = st.origins.join('\n');
  const picked = new Set(st.houseIds);
  const houseBoxes = st.houses.map((x) => h('label', { class: 'pp-check' }, h('input', { type: 'checkbox', value: x.id, checked: picked.has(x.id), disabled: !canWrite, onchange: (e) => { if (e.target.checked) picked.add(x.id); else picked.delete(x.id); } }), h('span', null, x.name)));
  const snippetHost = h('div', { dataset: { ps: 'widget-snippets' } });
  const previewHost = h('div', { class: 'pp-widget-preview', dataset: { ps: 'widget-preview' } });

  function snippetBlock(title, code, hint) {
    const pre = h('pre', { class: 'pp-code', tabindex: '0' }, code);
    return h('div', { class: 'pp-field pp-field--wide' }, h('label', null, title), pre, h('p', { class: 'pp-hint' }, hint),
      h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: async () => toast((await copyText(code)) ? 'Copied.' : 'Select the text and copy it.', { kind: 'info' }) }, 'Copy'));
  }
  function paint() {
    const sn = widgetSnippets(origin, st.id);
    snippetHost.replaceChildren(
      snippetBlock('Script snippet (recommended)', sn.script, 'Paste it into your page where the widget should appear. It adds the frame there and sizes it to the page.'),
      snippetBlock('Plain iframe snippet', sn.iframe, 'Use this if your website builder does not allow scripts.'));
    previewHost.replaceChildren(st.enabled
      ? h('iframe', { src: widgetFrameUrl(origin, st.id, { host: location.origin }), title: 'Widget preview', loading: 'lazy', style: { width: '100%', height: `${WIDGET_HEIGHT}px`, border: '1px solid var(--pp-line, #cfd8dc)', borderRadius: '8px', maxWidth: '100%' } })
      : h('p', { class: 'pp-empty' }, 'Switch the widget on and save to see the preview.'));
  }
  const save = h('button', { class: 'pp-btn pp-btn--primary', type: 'button', disabled: !canWrite, dataset: { ps: 'widget-save' }, onclick: () => busy(save, async () => {
    st = await api.setWidget({ enabled: enabled.checked, origins: originsFromText(origins.value), houseIds: [...picked] });
    origins.value = st.origins.join('\n');
    paint();
    toast('Saved.', { kind: 'ok' });
  }) }, 'Save widget settings');

  host.append(
    h('h2', null, 'Website widget'),
    h('p', { class: 'pp-lead' }, 'Put "See it on your block" on your own website. A visitor enters their address, sees one of your designs on the block, and leaves their details if they want you to get in touch. Each visitor lead goes to your Leads tab.'),
    h('section', { class: 'pp-card' },
      h('h3', null, 'Settings'),
      h('label', { class: 'pp-check' }, enabled, h('span', null, 'Show the widget on my website')),
      field('Websites that may show the widget', () => origins, { hint: 'One website address per line, for example https://www.yourbuilder.com.au. The widget only works on these websites. This is a spam control, not a lock: leave the list to the sites you own.', required: true, wide: true }),
      h('fieldset', { class: 'pp-fieldset' }, h('legend', null, 'Designs the widget offers', h('span', { class: 'pp-opt' }, ' (none ticked offers all of your designs)')), h('div', { class: 'pp-checklist' }, ...(houseBoxes.length ? houseBoxes : [h('p', { class: 'pp-empty' }, 'Add a house in the House designs tab first.')]))),
      h('p', { class: 'pp-hint' }, `Consent wording shown to the visitor: "${st.consentText}" A short privacy line links to the Glide Inside privacy page. Visitors are not emailed by Glide Inside, and you are not emailed either: leads appear in the Leads tab.`),
      save),
    h('section', { class: 'pp-card' }, h('h3', null, 'Your snippet'), h('p', { class: 'pp-lead pp-lead--sm' }, `Your builder id is ${st.id}. The widget shows your logo and colours from the Branding tab and plain concept wording: indicative only, check with council.`), snippetHost),
    h('section', { class: 'pp-card' }, h('h3', null, 'Preview'), previewHost));
  paint();
}
