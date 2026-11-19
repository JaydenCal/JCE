// Top bar slot: the Exports menu and the unlock button (or, once unlocked, the Plan Pack chip).

import { el, clear, formatAud, ddmmyyyy, clamp } from '../util.js';
import { icon } from '../icons.js';
import { EXPORT_ITEMS, exportLabel } from '../export-client.js';
import { tokenInfo } from '../entitlement.js';
import { PLAN_TERMS_URL, planTermsLinkText } from '../../legal/terms-gate.js';
import { sheetListText } from '../../commercial/sheet-list.js';

/**
 * createTopbarUI({ root, config, getState, actions })
 *   getState(): { entitled, token, devUnlock, credits }
 *   actions:   { unlock(source), details(), restore(), exportAs(type) }
 */
export function createTopbarUI({ root, config, getState, actions }) {
  const pack = config.planPack || {};
  const isOn = () => !!config.premiumEnabled;
  const menuId = `psp-menu-${Math.random().toString(36).slice(2, 7)}`;
  let busyType = null;
  let open = false;

  const bar = el('div', { class: 'psp-bar psp-scope' });
  const live = el('span', { class: 'psp-sr', role: 'status', 'aria-live': 'polite' });
  const menuBtn = el('button', { class: 'psp-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId, onclick: () => toggle() },
    'Exports', icon('caret', 14));
  const menu = el('div', { class: 'psp-menu', id: menuId, role: 'menu', 'aria-label': 'Exports', hidden: true });
  const wrap = el('div', { class: 'psp-menu-wrap' }, menuBtn, menu);
  const slot = el('span', { class: 'psp-bar-slot' });
  bar.append(wrap, slot, live);
  root.append(bar);

  const itemButtons = new Map();

  function renderMenu() {
    const st = getState();
    const locked = !st.entitled;
    clear(menu);
    itemButtons.clear();
    menu.append(el('div', { class: 'psp-menu-head' }, locked ? (st.commercial ? 'Part of the Commercial Developer subscription' : 'Part of the Plan Pack') : 'Download for this design'));
    const allowed = st.portal?.exports || null; // client logins: the builder's choice, PDF only by default
    for (const base of EXPORT_ITEMS) {
      if (allowed && !allowed.includes(base.type)) continue;
      // Commercial layouts export the commercial plan set and the DXF; the 3D and HTML files come with the commercial 3D stage.
      if (st.commercial && !['pdf', 'dxf'].includes(base.type)) continue;
      const item = st.commercial && base.type === 'pdf' ? { ...base, label: 'Commercial plan set (PDF)', hint: `A3 sheets ${sheetListText()}, indicative` } : base;
      const busy = busyType === item.type;
      const btn = el('button', {
        class: 'psp-menu-item', type: 'button', role: 'menuitem', tabindex: '-1', dataset: { type: item.type },
        'aria-disabled': locked ? 'true' : null, 'aria-busy': busy ? 'true' : null, disabled: !!busyType,
        onclick: () => {
          closeMenu(false);
          if (item.type === 'pdf' && actions.previewPdf) actions.previewPdf();
          else if (locked) actions.unlock(`export-${item.type}`);
          else actions.exportAs(item.type);
        },
      },
      el('span', null, item.label),
      busy ? el('span', { class: 'psp-spin', 'aria-hidden': 'true' }) : icon(locked && item.type !== 'pdf' ? 'lock' : item.type === 'pdf' ? 'eye' : 'download', 16),
      el('small', null, item.type === 'pdf' && locked ? `${item.hint}. Free preview.` : locked ? `${item.hint}. Locked.` : item.hint));
      itemButtons.set(item.type, btn);
      menu.append(btn);
    }
    if (st.enquiry && actions.enquiry) {
      menu.append(el('button', { class: 'psp-menu-item', type: 'button', role: 'menuitem', tabindex: '-1', dataset: { type: 'enquiry' }, onclick: () => { closeMenu(false); actions.enquiry(); } },
        el('span', null, 'Send plans to a registered engineer'), icon('check', 16), el('small', null, 'Quote from JCE Infrastructure, civil engineers')));
    }
    if (actions.sitingReport) {
      menu.append(el('button', { class: 'psp-menu-item', type: 'button', role: 'menuitem', tabindex: '-1', dataset: { type: 'siting-report' }, onclick: () => { closeMenu(false); actions.sitingReport(); } },
        el('span', null, 'Siting report'), icon(locked ? 'lock' : 'download', 16), el('small', null, locked ? 'Branded PDF with site plan and indicative site costs. Locked.' : 'Branded PDF with site plan and indicative site costs')));
      if (actions.sitingSummary && !st.commercial) menu.append(el('button', { class: 'psp-menu-item', type: 'button', role: 'menuitem', tabindex: '-1', dataset: { type: 'siting-summary' }, onclick: () => { closeMenu(false); actions.sitingSummary(); } },
        el('span', null, 'One page siting summary'), icon(locked ? 'lock' : 'download', 16), el('small', null, locked ? 'One page PDF: site plan and the key numbers. Locked.' : 'One page PDF: site plan and the key numbers')));
      if (!st.commercial && st.portal?.role !== 'client' && actions.siteCosts) menu.append(el('button', { class: 'psp-menu-item', type: 'button', role: 'menuitem', tabindex: '-1', dataset: { type: 'site-costs' }, onclick: () => { closeMenu(false); actions.siteCosts(); } },
        el('span', null, 'Site costs'), icon('eye', 16), el('small', null, 'Indicative estimate and your rates')));
    }
    if (st.enquiry && actions.orderEngineering) {
      menu.append(el('button', { class: 'psp-menu-item', type: 'button', role: 'menuitem', tabindex: '-1', dataset: { type: 'order-engineering' }, onclick: () => { closeMenu(false); actions.orderEngineering(); } },
        el('span', null, 'Order engineering'), icon('check', 16), el('small', null, 'Footings, stormwater, driveway, retaining, DA plans')));
    }
    if (st.portal?.watermark) menu.append(trialNote());
    const info = tokenInfo(st.token);
    menu.append(el('div', { class: 'psp-menu-foot' },
      locked
        ? el('span', null, st.commercial ? `Commercial Developer, ${formatAud(50)} per month, unlimited plan sets. ` : `Exports come with the Plan Pack, ${formatAud(pack.priceAud ?? 30)} per job. `, el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => { closeMenu(false); actions.restore(); } }, 'Restore purchase'))
        : st.csub ? el('span', null, st.csub.kind === 'trial' ? 'Trial login: unlimited plan sets, watermarked.' : 'Unlimited plan sets while your subscription is active.')
        : el('span', null, st.devUnlock && !st.token ? 'Developer unlock: files are built in this browser.' : info?.exp ? `Re-export as often as you like until ${ddmmyyyy(info.exp * 1000)}.` : 'Re-export as often as you like.')));
    // The plan set terms apply to every PDF and DXF; the link opens the public page with the same text.
    menu.append(el('div', { class: 'psp-menu-foot psp-menu-terms' }, el('a', { class: 'psp-btn psp-btn--link', href: PLAN_TERMS_URL, target: '_blank', rel: 'noopener', dataset: { ps: 'terms-link' } }, planTermsLinkText())));
  }

  const billingHref = () => { return '/portal/#/billing'; };
  function trialNote() {
    return el('div', { class: 'psp-trial', role: 'note' },
      el('span', { class: 'psp-trial-badge' }, 'Trial'),
      el('span', null, ' Exports are watermarked during your free trial. ', el('a', { href: billingHref() }, 'Add a card in Billing')));
  }

  function renderSlot() {
    const st = getState();
    clear(slot);
    menuBtn.style.display = '';
    if (st.portal?.watermark) slot.append(el('span', { class: 'psp-trial-badge', title: 'Exports are watermarked during your free trial' }, 'Trial'));
    if (st.entitled) {
      const left = st.credits && Number.isFinite(st.credits.remaining) ? ` ${st.credits.remaining} of ${st.credits.total} AI credits left.` : '';
      slot.append(el('button', { class: 'psp-chip', type: 'button', title: st.csub ? 'Your commercial account' : `Plan Pack active.${left}`, onclick: () => actions.details() },
        icon('check', 14), st.csub ? (st.csub.kind === 'trial' ? 'Commercial trial' : 'Commercial Developer') : st.portal ? 'Plans included' : st.token ? 'Plan Pack' : 'Dev unlock'));
    } else if (st.portalPending) {
      // The sign-in check is still running: show nothing rather than a paywall that a builder's client would not see.
    } else if (isOn() || st.commercial) {
      // Commercial mode always offers the subscription (the gate says Coming soon until a Stripe price is set), never the A$30 Plan Pack.
      slot.append(el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: () => actions.unlock('topbar') },
        icon('lock', 14), st.commercial ? `Subscribe, ${formatAud(50)} per month` : `Unlock plans, ${formatAud(pack.priceAud ?? 30)}`));
    } else {
      slot.append(el('button', { class: 'psp-btn', type: 'button', disabled: true, title: 'The Plan Pack (AI assistant and exports) is unavailable right now. Try again shortly.' }, icon('lock', 14), 'Plan Pack unavailable, try again'));
    }
  }

  function position() {
    const r = menuBtn.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    menu.style.width = `${w}px`;
    menu.style.left = `${clamp(r.left, 8, Math.max(8, window.innerWidth - w - 8))}px`;
    const below = r.bottom + 6;
    menu.style.top = `${below}px`;
    const room = window.innerHeight - below - 8;
    menu.style.maxHeight = `${Math.max(160, room)}px`;
    menu.style.overflowY = 'auto';
  }

  function openMenu() {
    if (open) return;
    renderMenu();
    open = true;
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    position();
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    const first = menu.querySelector('.psp-menu-item:not(:disabled)');
    first?.focus({ preventScroll: true });
  }

  function closeMenu(returnFocus = true) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onViewport);
    window.removeEventListener('scroll', onViewport, true);
    if (returnFocus) menuBtn.focus({ preventScroll: true });
  }

  const toggle = () => (open ? closeMenu() : openMenu());
  const onOutside = (e) => {
    if (!wrap.contains(e.target)) closeMenu(false);
  };
  const onViewport = (e) => {
    if (e?.target && menu.contains(e.target)) return;
    closeMenu(false);
  };

  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.psp-menu-item:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items.at(-1)?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  });
  menuBtn.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
      e.preventDefault();
      openMenu();
    }
  });

  function render() {
    renderSlot();
    if (open) renderMenu();
  }

  render();

  return {
    el: bar,
    render,
    open: openMenu,
    close: closeMenu,
    get isOpen() {
      return open;
    },
    /** Show one export as running (null clears it) and tell assistive technology. */
    setBusy(type, message = '') {
      busyType = type;
      live.textContent = message || (type ? `Preparing ${exportLabel(type)}` : '');
      if (open) renderMenu();
    },
    announce(text) {
      live.textContent = text;
    },
    dispose() {
      closeMenu(false);
      bar.remove();
    },
  };
}
