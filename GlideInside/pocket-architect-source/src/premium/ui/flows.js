// Upgrade, restore, checkout return and Plan Pack details: the dialogs around buying and recovering a Plan Pack.

import { el, formatAud, ddmmyyyy, track } from '../util.js';
import { icon } from '../icons.js';
import { friendlyError } from '../messages.js';
import { waitForEntitlement, tokenInfo } from '../entitlement.js';

const isSafeCheckoutUrl = (url) => {
  try {
    const u = new URL(url, 'https://example.invalid');
    return u.protocol === 'https:' && /^[\w.-]+$/.test(u.hostname);
  } catch {
    return false;
  }
};

/**
 * createFlows({ layer, store, config, api, accept, getState, navigate, dev, timing })
 *   accept(res): called with { token, projectId, credits, receipt, expiresAt } once a purchase is confirmed or restored.
 *                Returns { active } where active is true when the token belongs to the design that is open.
 *   getState():  { entitled, token, credits, devUnlock }
 */
export function createFlows({ layer, store, config, api, accept, getState, navigate = (url) => window.location.assign(url), timing = {} }) {
  const dev = () => !!getState().devUnlock;
  const pack = config.planPack || {};
  const isOn = () => !!config.premiumEnabled;
  const priceText = `${formatAud(pack.priceAud ?? 30)}${pack.gstInclusive ? ' incl. GST' : ''}`;

  const includes = () => [
    `AI design assistant. Describe a change in plain English and it edits your plan. ${pack.credits ?? 500} AI credits for this project.`,
    'PDF plan set. A3 sheets to scale with dimensions, door and window schedules, and a title block.',
    'DXF drawing for your CAD software.',
    '3D model files (GLB and OBJ) for Blender, viewers and game engines.',
    `Re-export this project as often as you like for ${pack.reexportMonths ?? 12} months.`,
  ];

  const linkRow = () => {
    const links = [];
    if (config.links?.terms) links.push(el('a', { href: config.links.terms, target: '_blank', rel: 'noopener' }, 'Terms'));
    if (config.links?.privacy) links.push(el('a', { href: config.links.privacy, target: '_blank', rel: 'noopener' }, 'Privacy'));
    if (!links.length) return null;
    return el('p', { class: 'psp-fine' }, links.flatMap((a, i) => (i ? [' and ', a] : [a])), ' apply.');
  };

  // Upgrade ------------------------------------------------------------------------------------------------------------
  function openUpgrade({ source = 'unknown' } = {}) {
    if (getState().token) return openDetails();
    track('ps_upgrade_click', { source });
    const projectName = store.project?.name || 'this design';
    const errorBox = el('p', { class: 'psp-error', role: 'alert', hidden: true });
    let modal;
    let checkoutBtn;

    const showError = (text) => {
      errorBox.textContent = text;
      errorBox.hidden = !text;
    };

    async function startCheckout() {
      showError('');
      checkoutBtn.disabled = true;
      checkoutBtn.replaceChildren(el('span', { class: 'psp-spin', 'aria-hidden': 'true' }), 'Opening secure checkout');
      try {
        store.saveNow?.(); // the design must be safe in this browser before the person leaves for the payment page
        const { url } = await api.checkout({ projectId: store.project.id, projectName: store.project.name });
        if (!isSafeCheckoutUrl(url)) throw Object.assign(new Error('Checkout did not return a safe address.'), { code: 'BAD_URL' });
        track('ps_checkout_started', {});
        navigate(url);
        setTimeout(() => {
          if (!modal.closed && checkoutBtn.isConnected) {
            checkoutBtn.disabled = false;
            checkoutBtn.replaceChildren('Continue to secure checkout');
          }
        }, 10000);
      } catch (e) {
        showError(friendlyError(e, { area: 'checkout', dev: dev() }));
        checkoutBtn.disabled = false;
        checkoutBtn.replaceChildren('Continue to secure checkout');
      }
    }

    checkoutBtn = el('button', { class: 'psp-btn psp-btn--primary', type: 'button', disabled: !isOn(), onclick: startCheckout },
      isOn() ? 'Continue to secure checkout' : 'Plan Pack coming soon');

    modal = layer.openModal({
      title: isOn() ? 'Unlock the Plan Pack' : 'Plan Pack coming soon',
      body: el('div', null,
        !isOn() ? el('div', { class: 'psp-note psp-note--warn' }, icon('info', 16), el('span', null, 'The Plan Pack is not on sale yet. The drawing tools, 3D view and walk-through stay free and need no account.')) : null,
        el('div', { class: 'psp-hero' },
          el('span', { class: 'psp-price' }, priceText.replace(' incl. GST', '')),
          el('span', { class: 'psp-price-note' }, `${pack.gstInclusive ? 'incl. GST, ' : ''}one payment for this project`)),
        el('p', null, 'The Plan Pack unlocks ', el('strong', null, projectName), ' only. Other designs need their own Plan Pack.'),
        el('ul', { class: 'psp-includes' }, includes().map((t) => el('li', null, icon('check', 16), el('span', null, t)))),
        el('p', { class: 'psp-fine' }, config.disclaimer || ''),
        linkRow(),
        isOn() ? el('p', { class: 'psp-fine' }, 'Already bought a Plan Pack? ', el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => openRestore({ modal }) }, 'Restore purchase'), '.') : null,
        errorBox),
      footer: (close) => [
        el('button', { class: 'psp-btn', type: 'button', onclick: () => close('cancel') }, isOn() ? 'Not now' : 'Close'),
        checkoutBtn,
      ],
    });
    return modal;
  }

  // Restore ------------------------------------------------------------------------------------------------------------
  function openRestore({ modal: existing = null, prefill = {}, back = null } = {}) {
    const email = el('input', { class: 'psp-input', type: 'email', name: 'email', autocomplete: 'email', required: true, value: prefill.email || '', placeholder: 'you@example.com' });
    const ref = el('input', { class: 'psp-input psp-mono', type: 'text', name: 'reference', autocomplete: 'off', spellcheck: 'false', required: true, value: prefill.reference || '', placeholder: 'cs_... or ent_...' });
    const errorBox = el('p', { class: 'psp-error', role: 'alert', hidden: true });
    const submit = el('button', { class: 'psp-btn psp-btn--primary', type: 'submit' }, 'Restore purchase');
    const form = el('form', { novalidate: true },
      el('p', null, 'Use the email address you gave at checkout and the receipt reference or checkout session ID. Your Plan Pack will unlock on this browser.'),
      el('div', { class: 'psp-field' }, el('label', { class: 'psp-label', for: 'psp-restore-email' }, 'Email address'), email),
      el('div', { class: 'psp-field' }, el('label', { class: 'psp-label', for: 'psp-restore-ref' }, 'Receipt reference or session ID'), ref),
      errorBox);
    email.id = 'psp-restore-email';
    ref.id = 'psp-restore-ref';

    const showError = (text) => {
      errorBox.textContent = text;
      errorBox.hidden = !text;
    };
    let modal = existing;
    const footerFor = (close) => [
      el('button', { class: 'psp-btn', type: 'button', onclick: () => (back ? back() : close('cancel')) }, back ? 'Back' : 'Cancel'),
      submit,
    ];
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const em = email.value.trim();
      const rf = ref.value.trim();
      if (!/^[^@\s]+@[^@\s]+$/.test(em)) return showError('Enter the email address used at checkout.'), email.focus();
      if (rf.length < 6) return showError('Enter the receipt reference or checkout session ID.'), ref.focus();
      submit.disabled = true;
      submit.replaceChildren(el('span', { class: 'psp-spin', 'aria-hidden': 'true' }), 'Checking');
      try {
        const res = await api.restore({ email: em, sessionOrReceipt: rf });
        const outcome = accept(res);
        modal.setContent({ title: 'Plan Pack restored', body: restoredBody(res, outcome), footer: (close) => el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: () => close('done') }, 'Done') });
      } catch (err) {
        showError(friendlyError(err, { area: 'restore', dev: dev() }));
        submit.disabled = false;
        submit.replaceChildren('Restore purchase');
      }
    });
    // The footer's submit button sits outside the form element, so connect it.
    submit.setAttribute('form', 'psp-restore-form');
    form.id = 'psp-restore-form';

    if (modal) modal.setContent({ title: 'Restore your purchase', body: form, footer: footerFor(modal.close) });
    else modal = layer.openModal({ title: 'Restore your purchase', body: form, footer: footerFor });
    return modal;
  }

  function restoredBody(res, outcome) {
    return el('div', null,
      el('div', { class: `psp-note ${outcome.active ? 'psp-note--ok' : 'psp-note--warn'}` }, icon(outcome.active ? 'check' : 'info', 16),
        el('span', null, outcome.active
          ? 'Your Plan Pack is active for the design that is open now.'
          : 'This Plan Pack belongs to a different design from the one open now. Open that design (File, Open) and the Plan Pack will unlock on this browser.')),
      detailsList(res));
  }

  function detailsList(res) {
    const info = tokenInfo(res.token);
    const rows = [];
    const credits = res.credits;
    if (credits && Number.isFinite(credits.remaining)) rows.push(['AI credits', `${credits.remaining} of ${credits.total} left`]);
    const until = res.expiresAt || (info?.exp ? info.exp * 1000 : null);
    if (until) rows.push(['Exports until', ddmmyyyy(until)]);
    const receipt = res.receipt || info?.eid;
    if (receipt) rows.push(['Receipt reference', el('span', { class: 'psp-mono' }, receipt)]);
    if (!rows.length) return null;
    return el('dl', { class: 'psp-kv' }, rows.flatMap(([k, v]) => [el('dt', null, k), el('dd', null, v)]));
  }

  // Checkout return ---------------------------------------------------------------------------------------------------------
  function waitingBody() {
    return el('div', { class: 'psp-center', role: 'status' },
      el('span', { class: 'psp-spin', 'aria-hidden': 'true' }),
      el('p', { style: { margin: 0 } }, 'Thanks. We are waiting for the payment to be confirmed. This usually takes a few seconds.'),
      el('p', { class: 'psp-muted', style: { margin: 0 } }, 'Please keep this page open.'));
  }

  /** Called when the page opens with ?checkout=success&session_id=...&project=... */
  async function handleReturn({ sessionId, projectId }) {
    const modal = layer.openModal({ title: 'Confirming your payment', dismissible: false, body: waitingBody() });
    const attempt = async () => {
      modal.setContent({ title: 'Confirming your payment', dismissible: false, body: waitingBody(), footer: [] });
      try {
        const res = await waitForEntitlement({ api, sessionId, projectId, ...timing });
        const outcome = accept(res);
        track('ps_checkout_completed', {});
        modal.setContent({
          title: 'Plan Pack unlocked',
          dismissible: true,
          body: el('div', null,
            el('div', { class: `psp-note ${outcome.active ? 'psp-note--ok' : 'psp-note--warn'}` }, icon(outcome.active ? 'check' : 'info', 16),
              el('span', null, outcome.active
                ? 'Payment received. The assistant and the exports are now unlocked for this design.'
                : 'Payment received, but it is for a different design from the one open now. Open that design (File, Open) to use it.')),
            detailsList(res),
            el('p', { class: 'psp-fine' }, 'Stripe emails your receipt. Keep the receipt reference above: with your email address it restores this Plan Pack on another browser.')),
          footer: (close) => el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: () => close('done') }, 'Start using it'),
        });
        return res;
      } catch (e) {
        const pending = e?.code === 'PAYMENT_PENDING';
        modal.setContent({
          title: pending ? 'Still confirming your payment' : 'We could not unlock your Plan Pack',
          dismissible: true,
          body: el('div', null,
            el('div', { class: `psp-note ${pending ? 'psp-note--warn' : 'psp-note--danger'}` }, icon(pending ? 'info' : 'warning', 16),
              el('span', null, pending
                ? 'Payments can take a minute to be confirmed. If you were charged, your Plan Pack will unlock shortly. Check again in a moment.'
                : friendlyError(e, { area: 'checkout', dev: dev() }))),
            el('p', { class: 'psp-fine' }, 'Your checkout reference is ', el('span', { class: 'psp-mono' }, sessionId), '. Keep it: with your email address it restores your Plan Pack if this page does not.')),
          footer: (close) => [
            el('button', { class: 'psp-btn psp-btn--link psp-grow', type: 'button', onclick: () => openRestore({ modal, prefill: { reference: sessionId }, back: () => attempt() }) }, 'Restore purchase'),
            el('button', { class: 'psp-btn', type: 'button', onclick: () => close('later') }, 'Close'),
            pending ? el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: attempt }, 'Check again') : null,
          ],
        });
        return null;
      }
    };
    return attempt();
  }

  // Details ---------------------------------------------------------------------------------------------------------------
  function openDetails() {
    const state = getState();
    const info = tokenInfo(state.token);
    const credits = state.credits;
    const rows = [];
    if (credits && Number.isFinite(credits.remaining)) rows.push(['AI credits', `${credits.remaining} of ${credits.total} left`]);
    if (info?.exp) rows.push(['Exports until', ddmmyyyy(info.exp * 1000)]);
    if (info?.eid) rows.push(['Receipt reference', el('span', { class: 'psp-mono' }, info.eid)]);
    return layer.openModal({
      title: 'Your Plan Pack',
      body: el('div', null,
        state.devUnlock && !state.token
          ? el('div', { class: 'psp-note psp-note--warn' }, icon('info', 16), el('span', null, 'Developer unlock is on (localhost only). Exports are built in this browser for testing. The assistant still needs the server (see server/README.md).'))
          : el('div', { class: 'psp-note psp-note--ok' }, icon('check', 16), el('span', null, 'The assistant and all exports are unlocked for this design.')),
        rows.length ? el('dl', { class: 'psp-kv' }, rows.flatMap(([k, v]) => [el('dt', null, k), el('dd', null, v)])) : null,
        info ? el('p', { class: 'psp-fine' }, 'Keep the receipt reference. With your email address it restores this Plan Pack on another browser. Credits are for this project only. Exports and manual editing never use credits.') : null),
      footer: (close) => el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: () => close('done') }, 'Close'),
    });
  }

  return { openUpgrade, openRestore, handleReturn, openDetails, priceText };
}
