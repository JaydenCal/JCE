// Small helpers for the premium UI: DOM builder, safe storage, analytics hook, formatting.
// No dependencies, and nothing here imports the exporters.

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  return append(node, children);
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// localStorage can be missing or throw (private windows, blocked site data). Never let that break the tool.
export const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// Events go to the host page (docs/SCOPE.md 12.7). Same channel as src/ui/analytics.js.
export function track(event, props = {}) {
  try {
    window.dispatchEvent(new CustomEvent('ps:analytics', { detail: { event, props } }));
  } catch {
    /* analytics must never break the tool */
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pad = (n) => String(n).padStart(2, '0');

/** DD/MM/YYYY from a Date, an ISO string or epoch milliseconds. */
export function ddmmyyyy(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatAud(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? `A$${n}` : `A$${n.toFixed(2)}`;
}

export const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/** "Roof_colour" or "steel-charcoal" to "Roof colour" / "Steel charcoal". */
export function humanise(id) {
  const s = String(id ?? '').replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Blob to a data URL. Resolves null when the blob is missing or cannot be read. */
export function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    if (!blob) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
