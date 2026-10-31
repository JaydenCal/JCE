// Small in-page popovers anchored inside a host element (the plan overlay layer).

import { h } from './dom.js';

// Place `el` near (x, y) inside `host`, keeping it fully visible.
export function placeNear(host, el, x, y, gap = 12) {
  const hw = host.clientWidth;
  const hh = host.clientHeight;
  const w = el.offsetWidth || 272;
  const hgt = el.offsetHeight || 160;
  let left = x + gap;
  let top = y + gap;
  if (left + w > hw - 8) left = x - w - gap;
  // Always end up fully inside the host, even when the anchor point is outside it.
  left = Math.max(8, Math.min(hw - w - 8, left));
  top = Math.max(8, Math.min(hh - hgt - 8, top));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

// content: Node. Returns { el, close }. Esc closes (calls onCancel), Enter in a field calls onEnter.
export function openPopover(host, { x, y, title, content, onCancel, onEnter, width }) {
  const el = h('div', { class: 'ps-popover', role: 'dialog', 'aria-label': title || 'Options' }, title ? h('h4', null, title) : null, content);
  if (width) el.style.width = `${width}px`;
  host.append(el);
  placeNear(host, el, x, y);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      onCancel?.();
    } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      e.stopPropagation();
      onEnter?.();
    }
  });
  const first = el.querySelector('input, select, button');
  setTimeout(() => first?.focus({ preventScroll: true }), 0);
  return { el, close, get closed() { return closed; } };
}
