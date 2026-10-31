// In-page dialogs and toasts for the premium layer. Never alert(), confirm() or prompt().
// createLayer(root) puts one fixed layer inside the host's modal root; the layer holds the dialogs and the toasts.

import { el, clear, append } from '../util.js';
import { icon } from '../icons.js';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function createLayer(root) {
  const host = root || document.body;
  const layer = el('div', { class: 'psp-layer psp-scope' });
  const toasts = el('div', { class: 'psp-toasts', 'aria-live': 'polite', role: 'status' });
  layer.append(toasts);
  host.append(layer);
  const stack = [];

  /**
   * Open a dialog. body and footer can be nodes or (close, api) => node.
   * Returns { el, close, setContent({ title, body, footer }), setBusy(bool) }.
   */
  function openModal({ title, body, footer, size = 'md', dismissible = true, onClose = null } = {}) {
    const previous = document.activeElement;
    const titleId = `psp-title-${Math.random().toString(36).slice(2, 8)}`;
    let closed = false;
    const titleEl = el('h2', { id: titleId }, title);
    const closeBtn = el('button', { class: 'psp-btn psp-btn--ghost psp-btn--icon', type: 'button', 'aria-label': 'Close', onclick: () => close('dismiss') }, icon('close', 18));
    const bodyEl = el('div', { class: 'psp-modal-body' });
    const footEl = el('div', { class: 'psp-modal-foot', hidden: true });
    const dialog = el('div', { class: `psp-modal${size === 'sm' ? ' psp-modal--sm' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      el('div', { class: 'psp-modal-head' }, titleEl, dismissible ? closeBtn : null), bodyEl, footEl);
    const scrim = el('div', { class: 'psp-scrim' }, dialog);
    let dismissible_ = dismissible;

    function close(reason = 'close') {
      if (closed) return;
      closed = true;
      const at = stack.indexOf(api);
      if (at >= 0) stack.splice(at, 1);
      scrim.remove();
      if (previous && previous.isConnected && previous.focus) {
        try {
          previous.focus({ preventScroll: true });
        } catch {
          /* element removed */
        }
      }
      onClose?.(reason);
    }

    function setContent(next = {}) {
      if (next.title !== undefined) titleEl.textContent = next.title;
      if (next.dismissible !== undefined) {
        dismissible_ = next.dismissible;
        closeBtn.hidden = !next.dismissible;
      }
      if (next.body !== undefined) {
        clear(bodyEl);
        append(bodyEl, [typeof next.body === 'function' ? next.body(close, api) : next.body]);
        bodyEl.scrollTop = 0;
      }
      if (next.footer !== undefined) {
        clear(footEl);
        const foot = typeof next.footer === 'function' ? next.footer(close, api) : next.footer;
        append(footEl, [foot]);
        footEl.hidden = !footEl.childNodes.length;
      }
      setTimeout(() => {
        if (closed) return;
        const first = bodyEl.querySelector('input, textarea, select') || footEl.querySelector('.psp-btn--primary') || dialog.querySelector(FOCUSABLE);
        first?.focus({ preventScroll: true });
      }, 0);
    }

    const api = { el: dialog, close, setContent, get closed() { return closed; } };
    scrim.addEventListener('pointerdown', (e) => {
      if (dismissible_ && e.target === scrim) close('dismiss');
    });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dismissible_ && stack.at(-1) === api) {
        e.stopPropagation();
        close('dismiss');
      } else if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    closeBtn.hidden = !dismissible;
    layer.append(scrim);
    stack.push(api);
    setContent({ body, footer });
    return api;
  }

  /** Yes or no inside the page. Resolves true when confirmed. */
  function confirmDialog({ title, message, confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      let answer = false;
      openModal({
        title,
        size: 'sm',
        body: el('p', { style: { margin: '0 0 4px' } }, message),
        footer: (close) => [
          el('button', { class: 'psp-btn', type: 'button', onclick: () => close('cancel') }, cancelLabel),
          el('button', {
            class: `psp-btn ${danger ? 'psp-btn--danger' : 'psp-btn--primary'}`,
            type: 'button',
            onclick: () => {
              answer = true;
              close('confirm');
            },
          }, confirmLabel),
        ],
        onClose: () => resolve(answer),
      });
    });
  }

  function notify(text, kind = 'info', ms = 5000) {
    const t = el('div', { class: 'psp-toast', 'data-kind': kind }, text);
    toasts.append(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => t.remove(), ms);
    return t;
  }

  return {
    el: layer,
    openModal,
    confirmDialog,
    notify,
    get openCount() {
      return stack.length;
    },
    closeAll() {
      for (const m of [...stack]) m.close('dispose');
    },
    dispose() {
      this.closeAll();
      layer.remove();
    },
  };
}
