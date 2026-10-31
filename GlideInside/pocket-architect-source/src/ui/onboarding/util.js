// Shared helpers for onboarding: safe storage, small DOM builder, reduced motion, element lookup.

export const KEYS = { tourDone: 'ps.tour.done', hintsSeen: 'ps.hints.seen', off: 'ps.hints.off' };

export const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch { /* storage may be blocked */ }
  },
  remove(k) {
    try {
      localStorage.removeItem(k);
    } catch { /* ignore */ }
  },
};

export function readSeen() {
  try {
    const v = JSON.parse(store.get(KEYS.hintsSeen) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function writeSeen(list) {
  store.set(KEYS.hintsSeen, JSON.stringify([...new Set(list)]));
}
export const isOff = () => store.get(KEYS.off) === '1';

export function reducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export const isTyping = (t) => !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// Finds a toolbox or view button by hook first, then by title or text (fallback for older shells).
export function findButton(kind, id) {
  const hook = kind === 'tool' ? `[data-tool="${id}"]` : `button[data-view="${id}"]`;
  const direct = [...document.querySelectorAll(hook)].find(visible) || document.querySelector(hook);
  if (direct) return direct;
  const words = kind === 'tool' ? { room: 'room', wall: 'wall', window: 'window', door: 'door', select: 'select', measure: 'measure', tank: 'tank', underlay: 'underlay', furniture: 'furniture', stairs: 'stairs', deck: 'deck', status: 'status' } : { '2d': '2d', '3d': '3d', walk: 'walk' };
  const w = words[id] || id;
  return [...document.querySelectorAll('button')].find((b) => (b.title || b.textContent || b.getAttribute('aria-label') || '').toLowerCase().includes(w)) || null;
}

export function planCanvas() {
  return document.querySelector('[data-ps="plan-canvas"]') || document.getElementById('ps-plan-host') || document.querySelector('.ps-plan-host');
}
export function stageEl() {
  return document.getElementById('ps-stage') || document.querySelector('.ps-stage');
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// Place a floating card beside a rect, preferring the given sides, kept inside the viewport.
export function placeBeside(card, rect, prefer = ['right', 'below', 'left', 'above'], gap = 14) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  for (const side of prefer) {
    let x;
    let y;
    if (side === 'right') { x = rect.right + gap; y = rect.top + rect.height / 2 - ch / 2; }
    else if (side === 'left') { x = rect.left - gap - cw; y = rect.top + rect.height / 2 - ch / 2; }
    else if (side === 'below') { x = rect.left + rect.width / 2 - cw / 2; y = rect.bottom + gap; }
    else { x = rect.left + rect.width / 2 - cw / 2; y = rect.top - gap - ch; }
    if (x >= 8 && y >= 8 && x + cw <= vw - 8 && y + ch <= vh - 8) {
      card.style.left = `${Math.round(x)}px`;
      card.style.top = `${Math.round(y)}px`;
      card.dataset.side = side;
      return side;
    }
  }
  card.style.left = `${Math.round(clamp(rect.right + gap, 8, vw - cw - 8))}px`;
  card.style.top = `${Math.round(clamp(rect.top, 8, vh - ch - 8))}px`;
  card.dataset.side = 'free';
  return 'free';
}
