// Google Analytics for the standalone app page (the page phones land on after the home page search).
// Only a fixed list of events with fixed, checked parameters is ever sent: no address, name, email or free text can reach Google.
// The page address is cleaned before it is used (query values are dropped unless they are on the short allow list below), so a looked up
// address in ?address= never leaves the browser. Internal traffic: any page opened with ?gi_internal=1 tags this browser as internal
// (traffic_type=internal) until ?gi_internal=0. No emails are sent to visitors from here.
//
// Events: app_opened, lot_loaded, design_started, house_placed, ps_profile_prompt, ps_profile_signup (+ generate_lead), ps_template_selected,
// ps_project_saved, ps_share_copy, ps_share_open, ps_export, ps_upgrade_click, ps_checkout_started, ps_checkout_completed (+ purchase).

import { setAnalyticsSender, isStandalonePage } from './analytics.js';

const INTERNAL_KEY = 'gi_internal';
/** The only query parameters that stay on the page address sent to Google (and only with a plain value). */
export const KEEP_PARAMS = new Set(['embed', 'mode', 'sample', 'template', 'view', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

const area = (win, kind) => { try { return win[kind]; } catch { return null; } };
const readItem = (win, kind, key) => { try { return area(win, kind)?.getItem(key) ?? null; } catch { return null; } };
const writeItem = (win, kind, key, value) => { try { area(win, kind)?.setItem(key, value); } catch { /* storage can be blocked */ } };
const removeItem = (win, kind, key) => { try { area(win, kind)?.removeItem(key); } catch { /* storage can be blocked */ } };

/** Internal traffic: ?gi_internal=1 tags this browser (kept in localStorage), ?gi_internal=0 clears it, automated browsers count as internal. */
export function isInternalTraffic(win = window) {
  try {
    const flag = new URLSearchParams(win.location?.search || '').get(INTERNAL_KEY);
    if (flag === '1') writeItem(win, 'localStorage', INTERNAL_KEY, '1');
    else if (flag === '0') removeItem(win, 'localStorage', INTERNAL_KEY);
  } catch { /* no query string */ }
  if (readItem(win, 'localStorage', INTERNAL_KEY) === '1') return true;
  try { return win.navigator?.webdriver === true; } catch { return false; }
}

/** The page address for Google: origin and path, with only the allow listed parameters that have a plain value. Never the address. */
export function cleanPageLocation(location) {
  try {
    const u = new URL(location.href);
    const keep = new URLSearchParams();
    u.searchParams.forEach((value, key) => { if (KEEP_PARAMS.has(key) && /^[a-z0-9_.-]{1,60}$/i.test(value)) keep.set(key, value); });
    const q = keep.toString();
    return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`;
  } catch {
    return '';
  }
}

/** The referrer for Google: origin and path only. */
export function cleanReferrer(referrer) {
  try {
    if (!referrer) return '';
    const u = new URL(referrer);
    if (u.hostname === 'checkout.stripe.com') return ''; // the return from Stripe must not take over attribution
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

const PLAIN = /^[a-z0-9_.-]{1,40}$/i;
/** A short lower case token: from a list when one is given, otherwise a plain pattern. null when it does not qualify. */
const token = (value, list) => {
  const v = String(value ?? '').toLowerCase();
  if (list) return list.includes(v) ? v : null;
  return PLAIN.test(v) ? v : null;
};
const yesNo = (v) => (v === true || v === 'yes' ? 'yes' : v === false || v === 'no' ? 'no' : null);
const whole = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

/** "A$30" or 30 -> 30. Falls back to the standard Plan Pack price. */
export function priceNumber(v, fallback = 30) {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * mapEvent(name, props, { once, utm, price }) -> [{ name, params }]. Pure: the list of Google events for one tool event (none when the
 * event is not on the list). `once(key)` says whether a once only event (generate_lead, purchase) has not been sent yet.
 */
export function mapEvent(name, props = {}, options = {}) {
  const p = props && typeof props === 'object' ? props : {};
  const once = options.once || (() => true);
  const utm = options.utm || {};
  switch (name) {
    case 'app_opened':
      return [{ name: 'app_opened', params: defined({ entry: token(p.entry, ['phone', 'desktop']), from: token(p.from, ['home_search', 'sample', 'direct']) }) }];
    case 'lot_loaded':
      return [{ name: 'lot_loaded', params: defined({ result: p.success === false ? 'fail' : 'success', ms: whole(p.ms, 600000), sample: yesNo(p.sample) }) }];
    case 'design_started':
      return [{ name: 'design_started', params: defined({ method: token(p.method) || 'edit', template: token(p.template) || 'none' }) }];
    case 'house_placed':
      return [{ name: 'house_placed', params: defined({ sample: yesNo(p.sample) }) }];
    case 'ps_profile_prompt':
      return [{ name: 'ps_profile_prompt', params: defined({ reason: token(p.reason), card: token(p.card, ['compact', 'full']) }) }];
    case 'ps_profile_signup': {
      const out = [{ name: 'ps_profile_signup', params: defined({ marketing: yesNo(p.marketing) }) }];
      if (once('gi_lead_profile')) out.push({ name: 'generate_lead', params: { lead_type: 'free_profile', method: 'app', ...utm } });
      return out;
    }
    case 'ps_template_selected':
      return [{ name: 'ps_template_selected', params: defined({ item_id: token(p.id) }) }];
    case 'ps_project_saved':
    case 'ps_share_copy':
    case 'ps_share_open':
    case 'ps_checkout_started':
      return [{ name, params: {} }];
    case 'ps_export':
      return [{ name: 'ps_export', params: defined({ export_type: token(p.type) }) }];
    case 'ps_upgrade_click':
      return [{ name: 'ps_upgrade_click', params: defined({ source: token(p.source) }) }];
    case 'ps_checkout_completed': {
      const id = typeof p.sessionId === 'string' && /^[A-Za-z0-9_-]{6,120}$/.test(p.sessionId) ? p.sessionId : null;
      const out = [{ name: 'ps_checkout_completed', params: {} }];
      // purchase: once per Stripe session (a reload of the return page must not count twice), value in AUD.
      if (id && once(`gi_purchase_${id.slice(0, 80)}`)) {
        const price = options.price || 30;
        out.push({ name: 'purchase', params: { transaction_id: id, value: price, currency: 'AUD', items: [{ item_id: 'plan_pack', item_name: 'Glide Inside Plan Pack', price, quantity: 1 }], ...utm } });
      }
      return out;
    }
    default:
      return [];
  }
}

function savedUtm(win) {
  try {
    const t = JSON.parse(readItem(win, 'sessionStorage', 'gi_utm') || 'null');
    if (t && typeof t === 'object') return Object.fromEntries(UTM_KEYS.filter((k) => typeof t[k] === 'string').map((k) => [k, t[k].slice(0, 100)]));
  } catch { /* no saved campaign */ }
  return {};
}

/**
 * initGoogleAnalytics({ win, widget, idle }) -> { active, internal, reason, ctx? }
 * Does nothing in a frame (the host page reports), in the builder widget, without GI_CONFIG.ga4Id, or when the page opted out.
 * The gtag library is added once the browser is idle so it never competes with the first paint.
 */
export function initGoogleAnalytics({ win = window, widget = false, idle = null } = {}) {
  const internal = isInternalTraffic(win);
  if (widget) return { active: false, internal, reason: 'widget' };
  if (!isStandalonePage(win)) return { active: false, internal, reason: 'framed' };
  const id = win.GI_CONFIG?.ga4Id;
  if (!id) return { active: false, internal, reason: 'no-id' };
  if (win[`ga-disable-${id}`] === true) return { active: false, internal, reason: 'opt-out' };
  win.dataLayer = win.dataLayer || [];
  win.gtag = win.gtag || function () { win.dataLayer.push(arguments); };
  const gtag = (...a) => win.gtag(...a);
  gtag('js', new Date());
  const page = { page_location: cleanPageLocation(win.location), page_referrer: cleanReferrer(win.document?.referrer), page_title: 'Glide Inside app' };
  gtag('set', { ...page, ...(internal ? { traffic_type: 'internal' } : {}) });
  gtag('config', id, { send_page_view: false, ...page, ...(internal ? { traffic_type: 'internal' } : {}) });
  gtag('event', 'page_view', { ...page, ...(internal ? { traffic_type: 'internal' } : {}) });
  const later = idle || ((fn) => (typeof win.requestIdleCallback === 'function' ? win.requestIdleCallback(fn, { timeout: 2500 }) : win.setTimeout(fn, 1200)));
  later(() => {
    try {
      const s = win.document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      win.document.head.appendChild(s);
    } catch { /* analytics must never break the tool */ }
  });
  const sent = new Set();
  const ctx = {
    price: priceNumber(win.GI_CONFIG?.planPackPrice ?? win.__PS_PLAN_PRICE__, 30),
    get utm() { return savedUtm(win); },
    /** True the first time a key is seen on this device (kept in both storages, so a reload does not repeat it). */
    once(key) {
      if (sent.has(key) || readItem(win, 'localStorage', key) || readItem(win, 'sessionStorage', key)) return false;
      sent.add(key);
      writeItem(win, 'localStorage', key, '1');
      writeItem(win, 'sessionStorage', key, '1');
      return true;
    },
  };
  setAnalyticsSender((event, props) => {
    for (const g of mapEvent(event, props, ctx)) gtag('event', g.name, internal ? { ...g.params, traffic_type: 'internal' } : g.params);
  });
  return { active: true, internal, reason: 'ok', ctx };
}

/** design_started: the first real edit of the session (the store reports canUndo after it), once per session. */
export function watchDesignStarted(store, { win = window, track } = {}) {
  let done = readItem(win, 'sessionStorage', 'gi_ds') === '1';
  if (done) return () => {};
  return store.on('history', (h) => {
    if (done || !h?.canUndo) return;
    done = true;
    writeItem(win, 'sessionStorage', 'gi_ds', '1');
    track('design_started', { method: 'edit', template: 'none' });
  });
}
