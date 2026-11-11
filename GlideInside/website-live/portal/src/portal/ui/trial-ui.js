// Free trial pieces shared by the dashboard, the Clients tab and the Billing tab: the banner, the "Add billing details" action and
// the return from Stripe Checkout (card details are entered on Stripe's page, never on ours).

import { h, toast, icon, busy, errorMessage } from './kit.js';
import { ddmmyyyy } from '../billing.js';

export const TRIAL_PRICING_TEXT = 'After the trial: A$20 incl. GST per new client login, charged when your client first signs in, and A$10 incl. GST per 300 AI credits top-up, billed monthly. No monthly fee.';

/** me().account, with safe defaults for a server that does not send it yet. */
export const accountOf = (me) => me?.account || { status: 'active', readOnly: false, canIssueClients: true, daysLeft: 0 };
export const isTrial = (me) => accountOf(me).status === 'trial';
export const isReadOnly = (me) => !!accountOf(me).readOnly;

/** Starts Stripe Checkout in setup mode and sends the browser there. Errors show as a toast (for example: billing details missing). */
export async function startAddBilling(api, button, { goBilling = null } = {}) {
  await busy(button, async () => {
    try {
      const r = await api.startBillingSetup();
      location.href = r.url;
    } catch (e) {
      if (e?.code === 'BAD_REQUEST' && goBilling) goBilling();
      throw e;
    }
  });
}

export function addBillingButton(api, { label = 'Add billing details', goBilling = null, primary = true } = {}) {
  const b = h('button', { class: `pp-btn${primary ? ' pp-btn--primary' : ''}`, type: 'button', id: 'add-billing-details', onclick: () => startAddBilling(api, b, { goBilling }) }, icon('lock', 16), label);
  return b;
}

/** The banner under the brand bar. Nothing for a paid account. */
export function trialBanner(me, api, { goBilling } = {}) {
  const a = accountOf(me);
  if (a.status === 'trial') {
    const left = a.daysLeft === 1 ? '1 day left' : `${a.daysLeft} days left`;
    return h('div', { class: 'pp-trial', role: 'status', id: 'trial-banner' },
      h('div', { class: 'pp-trial-days' }, h('strong', null, String(a.daysLeft)), h('span', null, a.daysLeft === 1 ? 'day left' : 'days left')),
      h('div', { class: 'pp-trial-text' },
        h('strong', null, `Free trial: ${left}`),
        h('p', null, `Your staff can use everything in the portal until the end of ${a.lastTrialDay || ddmmyyyy(a.trialEndsAt)}. Client logins unlock when you add billing details. ${TRIAL_PRICING_TEXT}`)),
      addBillingButton(api, { goBilling }));
  }
  if (a.readOnly) {
    const kept = a.dataKeptUntil ? ` Your projects are kept until ${ddmmyyyy(a.dataKeptUntil)}.` : '';
    return h('div', { class: 'pp-trial pp-trial--ended', role: 'status', id: 'trial-banner' },
      h('div', { class: 'pp-trial-days' }, icon('lock', 26)),
      h('div', { class: 'pp-trial-text' },
        h('strong', null, a.status === 'trial_ended' ? 'Your free trial has ended. This account is read only.' : 'This account is read only.'),
        h('p', null, `You can still view and open your projects. Add billing details to make changes, export and issue client logins again.${kept}`)),
      addBillingButton(api, { goBilling }));
  }
  return null;
}

/** On the return from Stripe (?billing=success&session_id=cs_...), confirm the card without waiting for the webhook. */
export async function handleBillingReturn(api, refreshMe) {
  const q = new URLSearchParams(location.search);
  const state = q.get('billing');
  if (!state) return null;
  const sid = q.get('session_id');
  history.replaceState(null, '', location.pathname + location.hash);
  if (state === 'cancel') {
    toast('No card was added. You can try again from the Billing tab.', { kind: 'info' });
    return 'cancel';
  }
  if (state === 'success' && sid) {
    for (let i = 0; i < 3; i += 1) {
      try {
        await api.confirmBillingSetup({ sessionId: sid });
        await refreshMe();
        toast('Card details saved. Your account is active.', { kind: 'ok' });
        return 'success';
      } catch (e) {
        if (i === 2) toast(`${errorMessage(e)} If you finished on Stripe, refresh this page in a minute.`, { kind: 'error', timeout: 9000 });
        else await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  return 'error';
}
