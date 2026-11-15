// "Have a local builder in mind?" panel for step 2 (Choose a home) of the residential flow.
// A visitor types a builder name. Only builders who opted in to being listed come back, with name, region and logo (never private data).
// "Request a login" sends the visitor's contact details to THAT builder's own queue (the builder approves or declines; the system sends no
// email to anyone). A name that is not listed shows "Not listed yet", a copyable link for the builder and the visitor carries on.

import { h } from '../ui/dom.js';

export const FOR_BUILDERS_URL = 'https://glideinside.com.au/for-builders/';
export const FINDER_TITLE = 'Have a local builder in mind?';
export const NOT_LISTED = 'Not listed yet';
export const NOT_LISTED_TEXT = 'That builder has not joined Glide Inside yet. You can pass them the link below, and carry on with our designs.';
export const CONSENT_TEXT = 'I agree that Glide Inside passes these details to this builder so they can contact me about a client login. Glide Inside does not email me about this.';
export const MIN_QUERY = 2;

/** The cleaned search text, or '' when it is too short to search. */
export const cleanQuery = (v) => { const q = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 60); return q.length >= MIN_QUERY ? q : ''; };

/** The request body for the server, from the form values, the chosen builder, the lot and the chosen design. */
export function requestBody({ builder, name, email, phone, lotAddress, design = null, consent = false, website = '' }) {
  return { builder: builder?.ref || '', name: String(name || '').trim(), email: String(email || '').trim(), phone: String(phone || '').trim(), lotAddress: String(lotAddress || '').trim(), designId: design?.id || '', designName: design?.name || '', consent: consent === true, website };
}

/** First problem with the form in plain words, or '' when it can be sent. */
export function formProblem(b) {
  if (!b.name) return 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return 'Enter a valid email address.';
  if (!/^\d{8,15}$/.test(b.phone.replace(/[\s()+-]/g, ''))) return 'Enter a phone number the builder can call.';
  if (!b.consent) return 'Tick the box so we can pass your details to the builder.';
  return '';
}

export const sentText = (builderName) => `Request sent to ${builderName}. They will contact you.`;

const safeLogo = (u) => (typeof u === 'string' && /^data:image\/(png|jpeg);base64,/.test(u) ? u : '');

/**
 * mountBuilderFinder({ api, getLot, getDesign, debounceMs }) -> { el, dispose }
 *   api         { searchBuilders({ q }), requestClientAccess(body) } (the portal API; tests pass a fake)
 *   getLot      () => lot address text
 *   getDesign   () => { id, name } | null  (the home chosen so far)
 */
export function mountBuilderFinder({ api: givenApi = null, getLot = () => '', getDesign = () => null, debounceMs = 350 } = {}) {
  // The portal client (and its review mock) loads only when someone searches, so step 2 stays light.
  const getApi = async () => givenApi || (await import('../portal/api.js')).portalApi;
  let timer = null;
  let seq = 0;
  let disposed = false;
  const input = h('input', { type: 'search', maxlength: '60', autocomplete: 'off', placeholder: 'Builder name', 'aria-label': 'Builder name', dataset: { ps: 'finder-input' } });
  const searchBtn = h('button', { class: 'gf-btn gf-btn--sm', type: 'button', dataset: { ps: 'finder-search' }, onclick: () => run() }, 'Search');
  const out = h('div', { class: 'gf-finder-out', role: 'status', 'aria-live': 'polite', dataset: { ps: 'finder-out' } });
  const el = h('section', { class: 'gf-card gf-finder', dataset: { ps: 'flow-finder' } },
    h('h3', { class: 'gf-finder-h' }, FINDER_TITLE),
    h('p', { class: 'gf-note', style: { margin: '0 0 10px' } }, 'Search for your builder by name to see whether they are on Glide Inside. If they are, you can ask them for a login to their own homes.'),
    h('div', { class: 'gf-field', style: { maxWidth: '520px' } }, input, searchBtn), out);

  const say = (...kids) => out.replaceChildren(...kids.filter(Boolean));
  const note = (t, cls = '') => h('p', { class: `gf-note ${cls}`.trim() }, t);

  async function run() {
    const q = cleanQuery(input.value);
    clearTimeout(timer);
    if (!q) { say(); return; }
    const mine = ++seq;
    say(note('Searching'));
    let res;
    try { res = await (await getApi()).searchBuilders({ q }); } catch (e) {
      if (!disposed && mine === seq) say(note('The builder search is not available right now. You can carry on with our designs.', 'gf-note--bad'));
      return;
    }
    if (disposed || mine !== seq) return;
    const list = Array.isArray(res?.builders) ? res.builders : [];
    if (!list.length) { notListed(); return; }
    say(h('ul', { class: 'gf-finder-list', dataset: { ps: 'finder-results' } }, ...list.map((b) => {
      const logo = safeLogo(b.logoUrl);
      return h('li', { class: 'gf-finder-item', dataset: { ps: 'finder-builder' } },
        logo ? h('img', { src: logo, alt: '', width: '44', height: '44', class: 'gf-finder-logo' }) : h('span', { class: 'gf-finder-logo gf-finder-logo--blank', 'aria-hidden': 'true' }, String(b.name || '?').trim().charAt(0).toUpperCase()),
        h('div', { class: 'gf-finder-meta' }, h('strong', null, b.name), b.region ? h('span', { class: 'gf-note', style: { margin: 0 } }, b.region) : null),
        h('button', { class: 'gf-btn gf-btn--sm gf-btn--primary', type: 'button', dataset: { ps: 'finder-request' }, onclick: () => form(b) }, 'Request a login'));
    })));
  }

  function notListed() {
    const link = h('input', { type: 'text', readonly: true, value: FOR_BUILDERS_URL, 'aria-label': 'Link to send to your builder', dataset: { ps: 'finder-link' }, onfocus: (e) => e.target.select() });
    const copy = h('button', { class: 'gf-btn gf-btn--sm', type: 'button', dataset: { ps: 'finder-copy' }, onclick: async () => {
      try { await navigator.clipboard.writeText(FOR_BUILDERS_URL); copy.textContent = 'Copied'; } catch { link.focus(); link.select(); copy.textContent = 'Select and copy'; }
    } }, 'Copy link');
    say(h('div', { class: 'gf-finder-nl', dataset: { ps: 'finder-notlisted' } }, h('strong', null, NOT_LISTED), note(NOT_LISTED_TEXT), h('div', { class: 'gf-field', style: { maxWidth: '520px' } }, link, copy)));
  }

  function form(b) {
    const d = getDesign();
    const f = {
      name: h('input', { type: 'text', maxlength: '100', autocomplete: 'name', required: true }),
      email: h('input', { type: 'email', maxlength: '160', autocomplete: 'email', required: true }),
      phone: h('input', { type: 'tel', maxlength: '30', autocomplete: 'tel', required: true }),
      lot: h('input', { type: 'text', maxlength: '200', value: getLot() || '', autocomplete: 'off' }),
      consent: h('input', { type: 'checkbox', dataset: { ps: 'finder-consent' } }),
      website: h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', style: { position: 'absolute', left: '-5000px', width: '1px', height: '1px', opacity: '0' } }),
    };
    const err = h('p', { class: 'gf-note gf-note--bad', role: 'alert', hidden: true, dataset: { ps: 'finder-error' } });
    const lab = (t, c) => h('label', { class: 'gf-finder-f' }, h('span', null, t), c);
    const send = h('button', { class: 'gf-btn gf-btn--primary', type: 'submit', dataset: { ps: 'finder-send' } }, 'Send request');
    const fm = h('form', { class: 'gf-finder-form', novalidate: true, dataset: { ps: 'finder-form' }, onsubmit: async (e) => {
      e.preventDefault();
      const body = requestBody({ builder: b, name: f.name.value, email: f.email.value, phone: f.phone.value, lotAddress: f.lot.value, design: getDesign(), consent: f.consent.checked, website: f.website.value });
      const problem = formProblem(body);
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      err.hidden = true; send.disabled = true;
      try {
        const r = await (await getApi()).requestClientAccess(body);
        if (disposed) return;
        say(h('div', { class: 'gf-status', dataset: { state: 'inside', ps: 'finder-sent' }, role: 'status' }, h('span', { 'aria-hidden': 'true' }, '✓'), h('span', null, sentText(r?.builderName || b.name))));
      } catch (ex) {
        err.textContent = ex?.message || 'The request could not be sent. Please try again.'; err.hidden = false; send.disabled = false;
      }
    } },
      h('p', { class: 'gf-note', style: { margin: '0 0 8px' } }, `Request a login from ${b.name}. They will see these details in their own list and decide whether to approve it.`),
      lab('Your name', f.name), lab('Email', f.email), lab('Phone', f.phone), lab('Lot address', f.lot),
      d?.name ? h('p', { class: 'gf-note', dataset: { ps: 'finder-design' } }, `Chosen design: ${d.name}`) : null,
      h('label', { class: 'gf-finder-consent' }, f.consent, h('span', null, CONSENT_TEXT)),
      f.website, err,
      h('div', { class: 'gf-row' }, send, h('button', { class: 'gf-btn', type: 'button', onclick: () => run() }, 'Back to results')));
    say(fm);
    f.name.focus();
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, debounceMs); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  return { el, dispose() { disposed = true; clearTimeout(timer); } };
}

export const FINDER_CSS = `
.gf-finder{margin:0 0 16px}
.gf-finder-h{margin:0 0 4px;font-size:16px}
.gf-finder-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px;max-width:620px}
.gf-finder-item{display:flex;align-items:center;gap:12px;border:1px solid var(--gf-border);border-radius:10px;padding:8px 10px}
.gf-finder-logo{width:44px;height:44px;object-fit:contain;border-radius:8px;background:#fff;flex:none}
.gf-finder-logo--blank{display:grid;place-items:center;background:var(--gf-acc-soft);color:var(--gf-acc);font-weight:700}
.gf-finder-meta{display:flex;flex-direction:column;flex:1;min-width:0}
.gf-finder-form{display:grid;gap:8px;max-width:520px;margin-top:10px;position:relative}
.gf-finder-f{display:flex;flex-direction:column;gap:3px;font-weight:600;font-size:13px}
.gf-finder-f input{border:1px solid var(--gf-border);border-radius:8px;padding:9px 11px;font:inherit;background:var(--ps-field,#fff);color:var(--gf-text);min-height:40px}
.gf-finder-consent{display:flex;gap:10px;align-items:flex-start;font-size:13px}
.gf-finder-consent input{width:18px;height:18px;margin-top:2px;flex:none}
.gf-finder-nl{margin-top:10px;display:grid;gap:6px}
@media (max-width:640px){.gf-finder-item{flex-wrap:wrap}.gf-finder-item .gf-btn{flex:1}}
`;
