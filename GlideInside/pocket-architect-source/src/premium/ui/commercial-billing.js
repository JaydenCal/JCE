// Commercial mode billing dialogs: the gate (export and assistant) with Subscribe, the account page (plan status, renewal date, Manage billing),
// the trial login sign in, restore, the AI top-up and the return from Stripe. The server decides everything; this only asks and shows.
//
//   createCommercialBilling({ layer, api, store, config, getCsub, setCsub, clearCsub, getCredits, refreshCredits, navigate, onReplace })

import { el, ddmmyyyy, formatAud, track, sleep as realSleep } from '../util.js';
import { icon } from '../icons.js';
import { friendlyError } from '../messages.js';
import { buyMessagesLabel, canBuyMessages, topUpOfferText, graceText } from '../credits.js';

export const COMMERCIAL_PRICE_AUD = 50;
export const PLAN_NAME = 'Commercial Developer';
export const GATE_LINE = `${PLAN_NAME}, ${formatAud(COMMERCIAL_PRICE_AUD)} per month, unlimited plan sets`;

const isSafeUrl = (url) => {
  try {
    const u = new URL(url, 'https://example.invalid');
    return u.protocol === 'https:' && /^[\w.-]+$/.test(u.hostname);
  } catch {
    return false;
  }
};

const STATUS_TEXT = { active: 'Active', past_due: 'Payment failed', canceled: 'Cancelled', ended: 'Ended' };

export function createCommercialBilling({ layer, api, store, config = {}, getCsub, setCsub, clearCsub, getCredits = () => null, refreshCredits = async () => null, navigate = (url) => window.location.assign(url), onReplace = null, sleep = realSleep, timing = {} }) {
  const errorBox = () => el('p', { class: 'psp-error', role: 'alert', hidden: true });
  const show = (box, text) => {
    box.textContent = text;
    box.hidden = !text;
  };
  const links = () => {
    const out = [];
    if (config.links?.terms) out.push(el('a', { href: config.links.terms, target: '_blank', rel: 'noopener' }, 'Terms'));
    if (config.links?.privacy) out.push(el('a', { href: config.links.privacy, target: '_blank', rel: 'noopener' }, 'Privacy'));
    return out.length ? el('p', { class: 'psp-fine' }, out.flatMap((a, i) => (i ? [' and ', a] : [a])), ' apply.') : null;
  };

  // Whether Subscribe works is the server's call (a Stripe price must exist); until then the button reads Coming soon.
  let subscribable = null;
  async function checkSubscribable() {
    if (subscribable !== null) return subscribable;
    try {
      const st = await api.commercialStatus();
      subscribable = st?.subscribable === true;
    } catch {
      subscribable = false;
    }
    return subscribable;
  }

  // The gate -----------------------------------------------------------------------------------------------------------------
  function openGate({ source = 'unknown' } = {}) {
    if (getCsub()) return openAccount();
    track('ps_commercial_gate', { source });
    const err = errorBox();
    const subscribeBtn = el('button', { class: 'psp-btn psp-btn--primary', type: 'button', disabled: true }, 'Subscribe');
    let modal;
    const email = el('input', { class: 'psp-input', type: 'email', name: 'email', autocomplete: 'email', placeholder: 'you@example.com (for your receipt)', 'aria-label': 'Email address for your receipt' });
    subscribeBtn.addEventListener('click', async () => {
      show(err, '');
      subscribeBtn.disabled = true;
      subscribeBtn.replaceChildren(el('span', { class: 'psp-spin', 'aria-hidden': 'true' }), 'Opening secure checkout');
      try {
        store.saveNow?.(); // the design must be safe in this browser before the person leaves for the payment page
        const { url } = await api.commercialSubscribe(email.value.trim() || undefined);
        if (!isSafeUrl(url)) throw Object.assign(new Error('Checkout did not return a safe address.'), { code: 'BAD_URL' });
        track('ps_commercial_checkout_started', {});
        navigate(url);
      } catch (e) {
        show(err, e?.code === 'SUBSCRIPTION_COMING_SOON' ? 'The subscription is coming soon.' : friendlyError(e, { area: 'checkout' }));
        subscribeBtn.disabled = false;
        subscribeBtn.replaceChildren('Subscribe');
      }
    });
    checkSubscribable().then((ok) => {
      if (modal?.closed) return;
      subscribeBtn.disabled = !ok;
      subscribeBtn.replaceChildren(ok ? 'Subscribe' : 'Coming soon');
      email.hidden = !ok;
    });
    email.hidden = true;
    modal = layer.openModal({
      title: PLAN_NAME,
      body: el('div', null,
        el('div', { class: 'psp-hero' },
          el('span', { class: 'psp-price' }, formatAud(COMMERCIAL_PRICE_AUD)),
          el('span', { class: 'psp-price-note' }, 'per month, GST inclusive')),
        el('p', null, el('strong', null, GATE_LINE), '.'),
        el('ul', { class: 'psp-includes' },
          ['Unlimited commercial plan set PDFs (sheets C000 to C103) and DXF drawings.',
            'AI design assistant with a monthly allowance of messages. Buy more AI messages when you need them, A$15 for 100 more.',
            'Monthly subscription. Cancel anytime from Manage billing.']
            .map((t) => el('li', null, icon('check', 16), el('span', null, t)))),
        el('div', { class: 'psp-field' }, email),
        el('p', { class: 'psp-fine' }, 'Plans are indicative concept documents for developers. ', config.disclaimer || ''),
        links(),
        el('p', { class: 'psp-fine' },
          'Already subscribed? ', el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => openRestore({ back: () => openGate({ source }) }) }, 'Restore subscription'),
          '. Have a trial login? ', el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => openTrialLogin({ back: () => openGate({ source }) }) }, 'Sign in'), '.'),
        err),
      footer: (close) => [el('button', { class: 'psp-btn', type: 'button', onclick: () => close('cancel') }, 'Not now'), subscribeBtn],
    });
    return modal;
  }

  // Restore and trial sign in ----------------------------------------------------------------------------------------------
  function simpleForm({ title, intro, fields, submitLabel, back, run }) {
    const err = errorBox();
    const submit = el('button', { class: 'psp-btn psp-btn--primary', type: 'submit' }, submitLabel);
    const inputs = fields.map((f) => el('input', { class: 'psp-input', type: f.type || 'text', name: f.name, autocomplete: f.autocomplete || 'off', required: true, spellcheck: 'false', 'aria-label': f.label, placeholder: f.placeholder || '' }));
    const form = el('form', { novalidate: true },
      el('p', null, intro),
      ...fields.map((f, i) => el('div', { class: 'psp-field' }, el('label', { class: 'psp-label' }, f.label), inputs[i])),
      err);
    let modal;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      show(err, '');
      submit.disabled = true;
      try {
        await run(Object.fromEntries(fields.map((f, i) => [f.name, inputs[i].value.trim()])), modal);
      } catch (ex) {
        show(err, friendlyError(ex, { area: 'restore' }));
        submit.disabled = false;
      }
    });
    modal = layer.openModal({
      title, size: 'sm', body: form,
      footer: (close) => [el('button', { class: 'psp-btn', type: 'button', onclick: () => (back ? (close('back'), back()) : close('cancel')) }, back ? 'Back' : 'Cancel'), submit],
    });
    submit.addEventListener('click', () => form.requestSubmit?.());
    return modal;
  }

  function openRestore({ back = null } = {}) {
    return simpleForm({
      title: 'Restore subscription', back, submitLabel: 'Restore',
      intro: 'Use the email address you gave at checkout and the receipt reference shown on your account page (it starts with csub_).',
      fields: [{ name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' }, { name: 'ref', label: 'Receipt reference', placeholder: 'csub_...' }],
      async run({ email, ref }, modal) {
        const res = await api.commercialRestore({ email, sessionOrReceipt: ref });
        setCsub({ token: res.token, kind: 'subscription' });
        modal.close('done');
        layer.notify('Your Commercial Developer subscription is active on this browser.', 'ok');
        await refreshCredits();
      },
    });
  }

  function openTrialLogin({ back = null } = {}) {
    return simpleForm({
      title: 'Commercial trial login', back, submitLabel: 'Sign in',
      intro: 'Enter the trial username and password you were given. The trial has full commercial mode. Plan sets carry a trial watermark and the assistant has a small allowance of messages.',
      fields: [{ name: 'username', label: 'Username', autocomplete: 'username' }, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' }],
      async run({ username, password }, modal) {
        const res = await api.commercialTrialLogin({ username, password });
        setCsub({ token: res.token, kind: 'trial' });
        modal.close('done');
        layer.notify('Signed in to the commercial trial.', 'ok');
        track('ps_commercial_trial_login', {});
        await refreshCredits();
      },
    });
  }

  /** Open the Stripe billing page for the signed in subscriber (throws on failure, the caller shows it). */
  async function openPortal() {
    const csub = getCsub();
    if (!csub || csub.kind !== 'subscription') throw new Error('No subscription is signed in.');
    const { url } = await api.commercialPortal(csub.token);
    if (!isSafeUrl(url)) throw new Error('bad url');
    navigate(url);
  }

  // Account page -------------------------------------------------------------------------------------------------------------
  function openAccount() {
    const csub = getCsub();
    if (!csub) return openGate({ source: 'account' });
    const body = el('div', null, el('p', { class: 'psp-muted', role: 'status' }, 'Loading your account'));
    const modal = layer.openModal({ title: csub.kind === 'trial' ? 'Commercial trial' : PLAN_NAME, body, footer: (close) => el('button', { class: 'psp-btn', type: 'button', onclick: () => close('done') }, 'Close') });
    paintAccount(body, modal, csub);
    return modal;
  }

  async function paintAccount(body, modal, csub) {
    let account = null;
    try {
      account = (await api.commercialAccount(csub.token)).account;
    } catch (e) {
      if (e?.code === 'UNAUTHORISED' || e?.code === 'NOT_ENTITLED' || e?.code === 'TRIAL_EXPIRED' || e?.code === 'TRIAL_DISABLED') {
        clearCsub();
        body.replaceChildren(el('p', { class: 'psp-error', role: 'alert' }, e.message), el('p', null, 'Your sign in has been removed from this browser.'));
        return;
      }
      body.replaceChildren(el('p', { class: 'psp-error', role: 'alert' }, friendlyError(e, { area: 'general' })));
      return;
    }
    if (modal.closed) return;
    const credits = getCredits();
    const aiLine = credits?.commercial
      ? el('li', null, el('strong', null, 'AI messages: '), `${credits.remaining + (credits.topUpRemaining || 0)} left`, credits.topUpRemaining ? ` (${credits.topUpRemaining} extra)` : '', credits.total ? ` of a ${credits.total} message ${credits.trial ? 'trial allowance' : 'monthly allowance'}` : '', '.')
      : null;
    if (account.kind === 'trial') {
      body.replaceChildren(
        el('ul', { class: 'psp-includes' },
          el('li', null, el('strong', null, 'Login: '), account.username),
          el('li', null, el('strong', null, 'Plan sets: '), account.unlimitedPlanSets ? 'Unlimited' : `Up to ${account.caps.dailyPdfs} per day`, account.watermark ? ', watermarked TRIAL, NOT FOR CONSTRUCTION.' : '.'),
          aiLine,
          account.expiresAt ? el('li', null, el('strong', null, 'Trial ends: '), ddmmyyyy(account.expiresAt)) : null),
        el('p', { class: 'psp-fine' }, `Designs saved to the trial are kept for ${account.keepDays} days. The trial login cannot change its password or see billing.`),
        trialProjectsBlock(csub, modal),
        el('p', null, el('button', { class: 'psp-btn', type: 'button', onclick: () => { clearCsub(); modal.close('signout'); layer.notify('Signed out of the trial.', 'info'); } }, 'Sign out')));
      return;
    }
    const active = account.status === 'active';
    const topUpBtn = canBuyMessages(credits) ? el('button', { class: 'psp-btn', type: 'button', disabled: !credits.commercialTopUp.available, onclick: () => buyMore() }, buyMessagesLabel(credits)) : null;
    const portalErr = errorBox();
    const portalBtn = el('button', { class: 'psp-btn psp-btn--primary', type: 'button' }, 'Manage billing');
    portalBtn.addEventListener('click', async () => {
      show(portalErr, '');
      portalBtn.disabled = true;
      try {
        await openPortal();
      } catch (e) {
        show(portalErr, friendlyError(e, { area: 'checkout' }));
        portalBtn.disabled = false;
      }
    });
    body.replaceChildren(
      el('ul', { class: 'psp-includes' },
        el('li', null, el('strong', null, 'Plan: '), `${account.plan}, ${formatAud(account.priceAud)} per month, GST inclusive`),
        el('li', null, el('strong', null, 'Status: '), STATUS_TEXT[account.status] || account.status),
        account.grace ? el('li', { class: 'psp-warn-line', role: 'status' }, graceText(account.grace.daysLeft), ` Access continues until ${ddmmyyyy(account.grace.endsAt)}.`) : null,
        account.currentPeriodEnd ? el('li', null, el('strong', null, active ? 'Renews on: ' : 'Access ends on: '), ddmmyyyy(account.currentPeriodEnd)) : null,
        el('li', null, el('strong', null, 'Plan sets: '), 'Unlimited commercial plan set PDFs.'),
        aiLine,
        el('li', null, el('strong', null, 'Receipt reference: '), el('span', { class: 'psp-mono' }, account.receipt))),
      el('p', { class: 'psp-fine' }, 'Keep the receipt reference. With your checkout email it restores this subscription on another browser. Cancel anytime from Manage billing and keep access until the renewal date.'),
      el('p', null, portalBtn, ' ', topUpBtn, topUpBtn ? el('small', null, ` ${topUpOfferText(credits)}, GST inclusive.`) : null),
      portalErr,
      el('p', null, el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => { clearCsub(); modal.close('signout'); layer.notify('Removed from this browser. Your subscription is unchanged.', 'info'); } }, 'Remove from this browser')));
  }

  // Trial saved projects ------------------------------------------------------------------------------------------------------
  function trialProjectsBlock(csub, modal) {
    const list = el('ul', { class: 'psp-includes' }, el('li', null, 'Loading saved designs'));
    const err = errorBox();
    async function load() {
      try {
        const items = await api.trialProjects(csub.token);
        list.replaceChildren(...(items.length ? items.map((p) => el('li', null,
          el('span', null, `${p.name}, cleared on ${ddmmyyyy(p.expiresAt)} `),
          el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => openOne(p) }, 'Open'), ' ',
          el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => remove(p) }, 'Delete'))) : [el('li', null, 'No saved designs yet.')]));
      } catch (e) {
        list.replaceChildren();
        show(err, friendlyError(e, { area: 'general' }));
      }
    }
    async function openOne(p) {
      try {
        const res = await api.trialProjectGet(csub.token, p.id);
        if (onReplace && (await layer.confirmDialog({ title: 'Open saved design', message: 'Opening it replaces the design on screen. Continue?', confirmLabel: 'Open', cancelLabel: 'Cancel' }))) {
          onReplace(res.project);
          modal.close('open');
        }
      } catch (e) {
        show(err, friendlyError(e, { area: 'general' }));
      }
    }
    async function remove(p) {
      try {
        await api.trialProjectDelete(csub.token, p.id);
        await load();
      } catch (e) {
        show(err, friendlyError(e, { area: 'general' }));
      }
    }
    const saveBtn = el('button', { class: 'psp-btn', type: 'button', onclick: async () => {
      show(err, '');
      saveBtn.disabled = true;
      try {
        await api.trialProjectSave(csub.token, { name: store.project?.name, project: store.project });
        layer.notify('Saved to the trial account.', 'ok');
        await load();
      } catch (e) {
        show(err, friendlyError(e, { area: 'general' }));
      } finally {
        saveBtn.disabled = false;
      }
    } }, 'Save this design to the trial account');
    load();
    return el('div', null, el('h3', null, 'Saved designs'), list, el('p', null, saveBtn), err);
  }

  // Buy more AI messages ------------------------------------------------------------------------------------------------------
  async function buyMore() {
    const csub = getCsub();
    if (!csub || csub.kind !== 'subscription') return;
    try {
      store.saveNow?.();
      const { url } = await api.commercialAiTopup(csub.token);
      if (!isSafeUrl(url)) throw new Error('bad url');
      navigate(url);
    } catch (e) {
      layer.notify(e?.code === 'SUBSCRIPTION_COMING_SOON' ? 'Extra AI messages are coming soon.' : friendlyError(e, { area: 'checkout' }), e?.code === 'SUBSCRIPTION_COMING_SOON' ? 'info' : 'error', 8000);
    }
  }

  // Return from Stripe: ?csub=success|topup|cancel&session_id=... ------------------------------------------------------------------
  async function handleReturn({ status, sessionId }) {
    if (status === 'cancel') {
      layer.notify('Checkout cancelled. You have not been charged.', 'info');
      return null;
    }
    const interval = timing.intervalMs ?? 2000;
    const limit = timing.timeoutMs ?? 30000;
    let waited = 0;
    for (;;) {
      try {
        if (status === 'success') {
          const res = await api.commercialSubscription(sessionId);
          if (res?.token) {
            setCsub({ token: res.token, kind: 'subscription' });
            layer.notify('Welcome. Your Commercial Developer subscription is active.', 'ok', 8000);
            track('ps_commercial_subscribed', {});
            await refreshCredits();
            return res;
          }
        } else if (status === 'topup' && getCsub()?.token) {
          const res = await api.commercialAiTopupConfirm(getCsub().token, sessionId);
          if (res?.credits) {
            layer.notify('Your extra AI messages have been added.', 'ok', 8000);
            await refreshCredits();
            return res;
          }
        } else return null;
      } catch (e) {
        if (!(e?.code === 'NETWORK' || e?.code === 'TIMEOUT' || e?.status === 404 || e?.status >= 500)) {
          layer.notify(friendlyError(e, { area: 'checkout' }), 'error', 8000);
          return null;
        }
      }
      waited += interval;
      if (waited > limit) {
        layer.notify('Your payment has not been confirmed yet. It can take a minute. Reload this page shortly, or restore the subscription with your receipt reference.', 'warn', 12000);
        return null;
      }
      await sleep(interval);
    }
  }

  return { openPortal, openGate, openAccount, openRestore, openTrialLogin, buyMore, handleReturn, checkSubscribable };
}
