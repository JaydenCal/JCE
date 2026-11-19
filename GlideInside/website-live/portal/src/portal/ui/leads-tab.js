// "Leads": every person who tried the builder's designs through the website widget, in one inbox, with CSV export, a webhook (signed JSON, retries)
// and the Zapier "Webhooks by Zapier" steps. Nothing is emailed. See docs/WIDGET_LEADS.md.

import { h, field, busy, toast, errorMessage, copyText, confirmDialog, chip } from './kit.js?v=20261120a';
import { ddmmyyyy } from '../billing.js?v=20261120a';
import { CONFIG } from '../../config.js?v=20261120a';

export const ZAPIER_STEPS = [
  'In Zapier, choose Create Zap. For the trigger, search for "Webhooks by Zapier" and choose the event "Catch Hook".',
  'Leave "Pick off a child key" empty and continue. Zapier shows you a "Custom Webhook URL". Copy it.',
  'Paste that address into the Webhook address box on this page, tick Send new leads to this address, and press Save webhook.',
  'Press Send a test here. In Zapier, press Test trigger and pick the sample request. You should see fields such as lead name, lead email and lead design.',
  'Add the action you want, for example "Google Sheets, Create Spreadsheet Row" or a step in your CRM, and map the fields from the sample.',
  'Turn the Zap on. Each new lead is posted to Zapier as soon as the visitor presses send.',
];

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${ddmmyyyy(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const STATUSES = [['new', 'New'], ['contacted', 'Contacted'], ['closed', 'Closed']];

export async function renderLeads(host, { api, me }) {
  const canHooks = me.permissions.includes('branding.write');
  const canDelete = me.permissions.includes('clients.write'); // status, notes, the full CSV and delete are the builder admin's; a designer reads the inbox
  let data = await api.listLeads();
  const summary = h('p', { class: 'pp-lead', dataset: { ps: 'leads-summary' } });
  const tbody = h('tbody');
  const table = h('table', { class: 'pp-table pp-table--stack', dataset: { ps: 'leads-table' } },
    h('thead', null, h('tr', null, ...['Date', 'Name', 'Contact', 'Block', 'Design', 'Status', 'Note', ''].map((t) => h('th', { scope: 'col' }, t)))), tbody);
  const empty = h('p', { class: 'pp-empty', hidden: true }, 'No leads yet. When a visitor uses the website widget and presses send, they appear here.');

  function paint() {
    summary.textContent = `${data.total} lead${data.total === 1 ? '' : 's'}, ${data.newCount} new.`;
    empty.hidden = data.leads.length > 0;
    table.hidden = data.leads.length === 0;
    tbody.replaceChildren(...data.leads.map((l) => {
      const td = (label, ...kids) => h('td', { dataset: { label } }, ...kids);
      const sel = h('select', { 'aria-label': `Status for ${l.name}`, disabled: !canDelete, onchange: async () => { try { Object.assign(l, await api.updateLead(l.id, { status: sel.value })); data.newCount = data.leads.filter((x) => x.status === 'new').length; paint(); } catch (e) { toast(errorMessage(e), { kind: 'error' }); sel.value = l.status; } } }, ...STATUSES.map(([v, t]) => h('option', { value: v, selected: l.status === v }, t)));
      const note = h('input', { type: 'text', maxlength: '1000', disabled: !canDelete, value: l.note || '', 'aria-label': `Note for ${l.name}`, placeholder: 'Add a note', onchange: async () => { try { await api.updateLead(l.id, { note: note.value }); l.note = note.value; } catch (e) { toast(errorMessage(e), { kind: 'error' }); } } });
      return h('tr', { dataset: { id: l.id, ps: 'lead-row' } },
        td('Date', when(l.createdAt)), td('Name', h('strong', null, l.name)),
        td('Contact', h('a', { href: `mailto:${l.email}` }, l.email), l.phone ? h('div', null, l.phone) : null),
        td('Block', l.address || 'Not given', l.lotLabel ? h('div', { class: 'pp-sub' }, l.lotLabel) : null), td('Design', l.houseName || 'None chosen'), td('Status', sel), td('Note', note),
        td('', canDelete ? h('button', { class: 'pp-btn pp-btn--sm pp-btn--danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Delete this lead?', message: `${l.name} will be removed from your inbox. This cannot be undone.`, confirmLabel: 'Delete lead', danger: true })) { try { await api.deleteLead(l.id); data = await api.listLeads(); paint(); } catch (e) { toast(errorMessage(e), { kind: 'error' }); } } } }, 'Delete') : null));
    }));
  }
  host.append(h('h2', null, 'Leads'), summary,
    h('div', { class: 'pp-row' },
      canDelete ? h('a', { class: 'pp-btn pp-btn--sm', href: `${String(CONFIG.apiBase || '/api').replace(/\/+$/, '')}/portal/leads/export`, download: '', dataset: { ps: 'leads-csv' } }, 'Export CSV') : null,
      h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: async () => { data = await api.listLeads(); paint(); } }, 'Refresh')),
    empty, h('div', { class: 'pp-table-wrap' }, table),
    h('p', { class: 'pp-hint' }, 'Each lead is a person who ticked the consent box and asked you to contact them. Use their details only for that purpose. Glide Inside keeps the name, email, optional phone, the block address and the design they chose, and removes a lead when you delete it. Leads are never emailed.'));
  paint();
  if (canHooks) await renderIntegrations(host, { api });
}

async function renderIntegrations(host, { api }) {
  let hv = await api.getWebhook();
  const url = h('input', { type: 'url', maxlength: '500', value: hv.url, placeholder: 'https://hooks.zapier.com/hooks/catch/...', dataset: { ps: 'webhook-url' }, 'aria-label': 'Webhook address' });
  const on = h('input', { type: 'checkbox', checked: hv.configured ? hv.enabled : true, dataset: { ps: 'webhook-enabled' } });
  const secretBox = h('code', { class: 'pp-code', dataset: { ps: 'webhook-secret' } });
  const log = h('div', { dataset: { ps: 'webhook-log' } });
  const result = h('p', { class: 'pp-hint', role: 'status' });
  let showSecret = false;
  // The server never sends the signing secret with the settings, only its last 4 characters. The full secret arrives once when it is made
  // (first save, new secret) or when asked for with Show or Copy, and is kept here only while this page is open.
  let secret = null;
  const take = (r) => { if (r?.secret) secret = r.secret; return r; };
  const fullSecret = async () => { if (!secret) secret = (await api.revealWebhookSecret()).secret; return secret; };
  function paint() {
    secretBox.textContent = hv.configured ? (showSecret && secret ? secret : `${'*'.repeat(16)}${String(hv.secretHint || '').replace(/^\.+/, '').slice(-4)}`) : 'Created when you save the address.';
    log.replaceChildren(hv.deliveries.length
      ? h('table', { class: 'pp-table pp-table--stack' }, h('thead', null, h('tr', null, ...['When', 'Result', 'Attempts', 'Detail', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, ...hv.deliveries.map((d) => h('tr', null, h('td', { dataset: { label: 'When' } }, when(d.createdAt)), h('td', { dataset: { label: 'Result' } }, chip(d.status === 'delivered' ? 'Delivered' : d.status === 'failed' ? 'Failed' : 'Retrying', d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'warn' : 'muted')), h('td', { dataset: { label: 'Attempts' } }, `${d.attempts} of ${hv.maxAttempts}`), h('td', { dataset: { label: 'Detail' } }, d.lastError || ''),
          h('td', null, d.status !== 'delivered' ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: async (e) => busy(e.currentTarget, async () => { hv = await api.retryWebhookDelivery(d.id); paint(); }) }, 'Retry now') : null)))))
      : h('p', { class: 'pp-empty' }, 'No deliveries yet.'));
  }
  const save = h('button', { class: 'pp-btn pp-btn--primary', type: 'button', dataset: { ps: 'webhook-save' }, onclick: () => busy(save, async () => { hv = take(await api.setWebhook({ url: url.value, enabled: on.checked })); if (secret && !showSecret) showSecret = true; paint(); toast('Webhook saved.', { kind: 'ok' }); }) }, 'Save webhook');
  const test = h('button', { class: 'pp-btn', type: 'button', dataset: { ps: 'webhook-test' }, onclick: () => busy(test, async () => { const r = await api.testWebhook(); result.textContent = r.ok ? `The address accepted the test (HTTP ${r.status}).` : `The test did not go through. ${r.error}`; }) }, 'Send a test');
  paint();
  host.append(h('section', { class: 'pp-card', id: 'integrations', dataset: { ps: 'integrations' } },
    h('h3', null, 'Webhook and Zapier'),
    h('p', { class: 'pp-lead pp-lead--sm' }, 'Send each new lead to your CRM, a spreadsheet or Zapier as soon as it arrives. Glide Inside posts JSON to the address you give. A delivery that fails is tried again up to five times.'),
    field('Webhook address', () => url, { hint: 'Must start with https://. Use a public web address.', wide: true }),
    h('label', { class: 'pp-check' }, on, h('span', null, 'Send new leads to this address')),
    h('div', { class: 'pp-row' }, save, test, hv.configured ? h('button', { class: 'pp-btn pp-btn--sm pp-btn--danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Remove the webhook?', message: 'New leads will no longer be sent. Your inbox is not affected.', confirmLabel: 'Remove', danger: true })) { hv = await api.deleteWebhook(); secret = null; showSecret = false; url.value = ''; paint(); } } }, 'Remove webhook') : null), result,
    h('h4', null, 'Signing secret'),
    h('p', { class: 'pp-hint' }, 'Every delivery carries a signature made with this secret, so your system can check it came from Glide Inside and was not changed. Keep it private.'),
    h('div', { class: 'pp-row' }, secretBox,
      h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: async (e) => { if (!showSecret && hv.configured) { await busy(e.currentTarget, fullSecret); if (!secret) return; } showSecret = !showSecret; paint(); } }, 'Show or hide'),
      h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: async () => { if (!hv.configured) return; try { toast((await copyText(await fullSecret())) ? 'Copied.' : 'Select the text and copy it.', { kind: 'info' }); } catch (err) { toast(errorMessage(err), { kind: 'error' }); } } }, 'Copy'),
      h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: async () => { if (!hv.configured) return; if (await confirmDialog({ title: 'Make a new secret?', message: 'The old secret stops working at once. Update your system with the new one.', confirmLabel: 'New secret' })) { hv = take(await api.rotateWebhookSecret()); showSecret = true; paint(); } } }, 'New secret')),
    h('details', { class: 'pp-help' }, h('summary', null, 'What is posted and how to check the signature'),
      h('p', null, 'Each request is a POST with a JSON body: event (lead.created), id, createdAt, builder (id, name) and lead (name, email, phone, address, lot, design, website, consentAt). Headers: X-GlideInside-Event, X-GlideInside-Delivery and X-GlideInside-Signature, which reads t=<unix seconds>,v1=<hex>.'),
      h('p', null, 'To check it, compute HMAC SHA-256 of the text "<t>.<raw body>" with your secret, as lower case hex, and compare it with v1. Reject a request whose t is more than five minutes old. Answer with any 2xx status to confirm. A delivery may repeat, so use the id to skip duplicates.')),
    h('details', { class: 'pp-help', open: false, dataset: { ps: 'zapier-help' } }, h('summary', null, 'Connect Zapier (Webhooks by Zapier, Catch Hook)'),
      h('ol', null, ...ZAPIER_STEPS.map((t) => h('li', null, t))),
      h('p', { class: 'pp-hint' }, 'Zapier does not check the signature, so leave the secret to systems that do. Zapier also gives you a link to turn the Zap off at any time.')),
    h('h4', null, 'Recent deliveries'), log));
}
