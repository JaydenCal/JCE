// In-page toasts. Never alert().

import { h } from './dom.js';

let region = null;
// The same message shown again within this many ms is not stacked a second time (a tool that complains on every click).
export const TOAST_DEDUPE_MS = 2000;
const recent = new Map();

export function mountToasts(el) {
  region = el;
}

// kind: 'info' | 'ok' | 'warn' | 'error'. action: { label, onClick }.
export function toast(message, { kind = 'info', timeout, action } = {}) {
  if (!region) {
    (kind === 'error' ? console.error : console.log)(`[toast] ${message}`);
    return { dismiss() {} };
  }
  const nowT = Date.now();
  const prev = recent.get(message);
  if (prev && nowT - prev.at < TOAST_DEDUPE_MS && prev.el?.isConnected) { prev.at = nowT; return prev.handle; }
  let ms = timeout ?? (kind === 'error' ? 8000 : kind === 'warn' ? 6000 : 3800);
  // The phone house screen (src/phone/house-ui.js): notices hide themselves after 3 seconds and sit above the bottom bar (never over it). Errors stay.
  if (kind !== 'error' && typeof document !== 'undefined' && document.documentElement.classList.contains('ph-house')) ms = Math.min(ms || 3000, 3000);
  let timer = null;
  const el = h('div', { class: 'ps-toast', role: kind === 'error' ? 'alert' : 'status', dataset: { kind } }, h('span', null, message));
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    el.append(
      h('button', {
        type: 'button',
        onclick: () => {
          try {
            action.onClick();
          } finally {
            dismiss();
          }
        },
      }, action.label),
    );
  }
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.tagName === 'SPAN') dismiss();
  });
  while (region.children.length >= 3) region.firstChild.remove();
  region.append(el);
  if (ms > 0) timer = setTimeout(dismiss, ms);
  const handle = { dismiss };
  recent.set(message, { at: nowT, el, handle });
  if (recent.size > 20) recent.delete(recent.keys().next().value);
  return handle;
}
