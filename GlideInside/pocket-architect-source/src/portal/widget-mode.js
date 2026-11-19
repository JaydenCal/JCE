// "See it on your block" widget mode (docs/WIDGET_LEADS.md). The app opens inside an iframe on a builder's own website as
// /plan-studio/app/?embed=1&widget=<builder id>[&host=<website origin>]. It is the existing ?embed=1 lot viewer with:
//   - the builder's own designs only (GET /api/widget/:id/designs), in the lot card carousel,
//   - the builder's logo and colours, and their details on the siting summary,
//   - a "Send me this design" form (name, email, optional phone, consent) that saves a lead for the builder (POST /api/widget/:id/lead).
// Nothing is emailed. Never imports the portal API: a visitor has no login, so these are plain public calls.

import { h } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { CONFIG } from '../config.js';
import { applyBrandTheme } from './theme-css.js';
import { builderDesigns } from '../lotcard/designs.js';
import { lotOf } from '../model/placement.js';

export const widgetIdFromSearch = (search = typeof location !== 'undefined' ? location.search : '') => {
  const v = (new URLSearchParams(search).get('widget') || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_:.-]{0,119}$/.test(v) ? v : '';
};

/** The website showing the widget. The browser's own ancestor origin wins (it cannot be set by the page), then the referrer, then ?host=. */
export function hostOrigin(loc = globalThis.location, doc = globalThis.document) {
  const clean = (v) => { try { const u = new URL(v); return u.protocol === 'https:' ? u.origin : ''; } catch { return ''; } };
  try { const a = loc.ancestorOrigins?.[0]; if (a && clean(a)) return clean(a); } catch { /* not available */ }
  try { if (doc?.referrer && clean(doc.referrer)) return clean(doc.referrer); } catch { /* none */ }
  return clean(new URLSearchParams(loc.search).get('host') || '');
}

export const LEAD_NO_LOT = 'Enter your address first, then send the design you like.';
export const LEAD_PRIVACY = 'We keep your name, email, optional phone, your address and the design you chose, and pass them to the builder only. We do not send you any email. Read the';

const STYLE = `
.gw-bar{position:absolute;left:12px;right:12px;bottom:12px;z-index:30;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--ps-panel,#fff);border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:500 13px var(--ps-font-ui,system-ui,sans-serif);color:var(--ps-text,#1a1c20)}
.gw-bar small{color:var(--ps-muted,#5a5e66)}.gw-bar-who{display:flex;gap:8px;align-items:center;min-width:0}.gw-bar-who img{height:26px;max-width:110px;object-fit:contain}
.gw-btn{font:600 14px var(--ps-font-ui,system-ui,sans-serif);min-height:38px;padding:0 16px;border-radius:8px;border:1px solid var(--ps-accent,#1b4fd1);background:var(--ps-accent,#1b4fd1);color:var(--ps-accent-ink,#fff);cursor:pointer}
.gw-btn--ghost{background:var(--ps-panel,#fff);color:var(--ps-text,#1a1c20);border-color:var(--ps-border-strong,#b6b8bd)}.gw-btn:disabled{opacity:.6;cursor:default}
.gw-scrim{position:fixed;inset:0;z-index:80;background:rgba(10,14,20,.55);display:flex;align-items:center;justify-content:center;padding:12px}
.gw-card{background:var(--ps-panel,#fff);color:var(--ps-text,#1a1c20);border-radius:12px;max-width:440px;width:100%;max-height:calc(100vh - 24px);overflow:auto;padding:18px 18px 14px;font:400 14px/1.45 var(--ps-font-ui,system-ui,sans-serif);box-shadow:0 20px 60px rgba(0,0,0,.35)}
.gw-card h2{margin:0 0 4px;font:700 18px var(--ps-font-ui,system-ui,sans-serif)}.gw-card p{margin:6px 0}
.gw-card label{display:block;font-weight:600;margin:10px 0 3px}.gw-card .gw-opt{font-weight:400;color:var(--ps-muted,#5a5e66)}
.gw-card input[type=text],.gw-card input[type=email],.gw-card input[type=tel]{width:100%;box-sizing:border-box;min-height:38px;border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:8px;padding:0 10px;font:inherit;background:var(--ps-field,#fff);color:inherit}
.gw-consent{display:flex;gap:8px;align-items:flex-start;margin:12px 0 4px;font-weight:400!important}.gw-consent input{margin-top:3px}
.gw-fine{font-size:12px;color:var(--ps-muted,#5a5e66)}.gw-err{color:#b52828;font-weight:600;min-height:1.2em}.gw-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}
.gw-widget .ps-embed-full,.gw-widget [data-ps="lc-full-editor"],.gw-widget [data-ps="lc-send-engineer"],.gw-widget [data-ps="lc-pdf"],.gw-widget [data-ps="lc-pdf-house"],.gw-widget [data-ps="lc-upload"],.gw-widget [data-ps="lc-menu"]{display:none!important}
.gw-row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
`;

/** The lead form body. send(body) resolves { reference } or throws Error(message). Pure DOM, no network of its own. */
export function leadForm({ cfg, context, send, onDone, onSummary = null, privacyUrl = '/privacy.html' }) {
  const name = h('input', { type: 'text', id: 'gw-name', autocomplete: 'name', maxlength: '100', required: true, dataset: { gw: 'name' } });
  const email = h('input', { type: 'email', id: 'gw-email', autocomplete: 'email', maxlength: '200', required: true, dataset: { gw: 'email' } });
  const phone = h('input', { type: 'tel', id: 'gw-phone', autocomplete: 'tel', maxlength: '30', dataset: { gw: 'phone' } });
  const consent = h('input', { type: 'checkbox', id: 'gw-consent', dataset: { gw: 'consent' } });
  const hp = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
  const err = h('p', { class: 'gw-err', role: 'alert', dataset: { gw: 'error' } });
  const submit = h('button', { class: 'gw-btn', type: 'submit', dataset: { gw: 'send' } }, 'Send my details');
  const form = h('form', { novalidate: true, dataset: { gw: 'form' } },
    h('h2', null, `Send ${context.houseName || 'this design'} to ${cfg.name}`),
    h('p', { class: 'gw-fine' }, [context.address ? `Block: ${context.address}. ` : '', 'Concept only and indicative. Setbacks and planning controls are for the council to confirm.'].join('')),
    h('label', { for: 'gw-name' }, 'Your name'), name,
    h('label', { for: 'gw-email' }, 'Your email'), email,
    h('label', { for: 'gw-phone' }, 'Phone ', h('span', { class: 'gw-opt' }, '(optional)')), phone,
    h('label', { class: 'gw-consent', for: 'gw-consent' }, consent, h('span', null, cfg.consentText)),
    h('p', { class: 'gw-fine' }, `${LEAD_PRIVACY} `, h('a', { href: privacyUrl, target: '_blank', rel: 'noopener' }, 'privacy page'), '.'),
    h('div', { class: 'gw-hp' }, hp), err,
    h('div', { class: 'gw-row' }, h('button', { class: 'gw-btn gw-btn--ghost', type: 'button', onclick: () => onDone?.(false) }, 'Cancel'), submit));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Enter your name.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { err.textContent = 'Enter a valid email address.'; return; }
    if (phone.value.trim() && !/^[0-9 +()\-]{6,30}$/.test(phone.value.trim())) { err.textContent = 'Enter a valid phone number, or leave it blank.'; return; }
    if (!consent.checked) { err.textContent = 'Tick the box to agree to the builder contacting you.'; return; }
    submit.disabled = true;
    try {
      const out = await send({ name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim(), consent: true, website: hp.value, ...context.body });
      form.replaceWith(h('div', { dataset: { gw: 'done' } },
        h('h2', null, 'Thank you'),
        h('p', null, `${cfg.name} now has your details and can contact you about this design. Your reference is ${out.reference}.`),
        h('p', { class: 'gw-fine' }, 'Glide Inside does not send you an email. If you want a copy of what you saw, download the one page summary.'),
        h('div', { class: 'gw-row' }, onSummary ? h('button', { class: 'gw-btn', type: 'button', dataset: { gw: 'summary' }, onclick: () => onSummary() }, 'Download one page summary') : null, h('button', { class: 'gw-btn gw-btn--ghost', type: 'button', onclick: () => onDone?.(true) }, 'Close'))));
    } catch (ex) { err.textContent = ex?.message || 'That did not send. Try again.'; submit.disabled = false; }
  });
  return form;
}

export async function initWidgetMode(app, { fetchImpl = (...a) => globalThis.fetch(...a), loc = globalThis.location } = {}) {
  const id = widgetIdFromSearch(loc.search);
  if (!id) return null;
  const host = hostOrigin(loc);
  const base = String(CONFIG.apiBase || '/api').replace(/\/+$/, '');
  const q = host ? `?host=${encodeURIComponent(host)}` : '';
  const get = async (path) => {
    const res = await fetchImpl(`${base}/widget/${encodeURIComponent(id)}/${path}${q}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || 'The widget is not available.'), { status: res.status });
    return data;
  };
  let cfg; let all;
  try { [cfg, all] = await Promise.all([get('config'), get('designs')]); } catch (e) {
    const msg = e.status === 403 ? 'This website is not on the builder\'s list for the widget.' : 'This widget is not switched on.';
    toast(msg, { kind: 'warn', timeout: 12000 });
    return { error: msg };
  }
  const designs = (all.designs || []).map((d) => ({ id: d.id, name: d.name, project: d.project, group: 'builder' }));
  if (cfg.colours) applyBrandTheme(cfg.colours);
  const bname = cfg.name || 'Your builder';
  app.builder = { name: bname, logo: cfg.logoDataUrl || null, colours: cfg.colours || null, details: cfg.details || null, widget: true, client: null };
  app.lotDesigns = (project) => Promise.resolve(builderDesigns(project || app.store.project, designs, { allowGlide: false }));
  const prod = document.querySelector('.ps-brand .ps-product');
  if (prod) prod.textContent = bname;
  try { document.title = `${bname} | See it on your block`; } catch { /* no title */ }
  if (!document.getElementById('gw-style')) { const s = document.createElement('style'); s.id = 'gw-style'; s.textContent = STYLE; document.head.append(s); }

  const { store } = app;
  document.body.classList.add('gw-widget');
  const bar = h('div', { class: 'gw-bar', role: 'region', 'aria-label': `${bname} design offer`, dataset: { gw: 'bar' } },
    h('div', { class: 'gw-bar-who' }, cfg.logoDataUrl ? h('img', { src: cfg.logoDataUrl, alt: '' }) : null, h('div', null, h('strong', null, bname), h('div', null, h('small', null, 'Concept only, indicative. Check with council.')))),
    h('button', { class: 'gw-btn', type: 'button', dataset: { gw: 'open' }, onclick: () => openForm() }, 'Send me this design'));
  (document.querySelector('.ps-stage') || document.body).append(bar);

  let scrim = null;
  const closeForm = () => { scrim?.remove(); scrim = null; };
  function context() {
    const lot = lotOf(store.project);
    const real = lot && lot.lotLabel !== 'Sample lot';
    const placed = store.ui?.placedDesign || null;
    return { ok: !!real, address: real ? String(lot.address || '').trim() : '', lotLabel: real ? String(lot.lotLabel || '') : '', houseName: placed?.name || '', body: { host, address: real ? String(lot.address || '') : '', lotLabel: real ? String(lot.lotLabel || '') : '', designId: placed?.id && designs.some((d) => d.id === placed.id) ? placed.id : undefined } };
  }
  async function send(body) {
    const res = await fetchImpl(`${base}/widget/${encodeURIComponent(id)}/lead`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gi-request': '1', accept: 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || 'That did not send. Try again.');
    return data;
  }
  function openForm() {
    const ctx = context();
    if (!ctx.ok) { toast(LEAD_NO_LOT, { kind: 'info', timeout: 8000 }); return; }
    closeForm();
    const card = h('div', { class: 'gw-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Send me this design' },
      leadForm({ cfg, context: ctx, send, onDone: closeForm, privacyUrl: new URL('/privacy.html', loc.origin).href, onSummary: () => app.premium?.sitingSummary?.({ widget: true }) }));
    scrim = h('div', { class: 'gw-scrim', onclick: (e) => { if (e.target === scrim) closeForm(); } }, card);
    document.body.append(scrim);
    card.querySelector('input')?.focus();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeForm(); });
  app.widget = { id, host, cfg, openForm };
  app.lotCard?.refresh?.();
  return { cfg, designs };
}
