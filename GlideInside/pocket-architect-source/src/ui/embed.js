// Embed API (docs/SCOPE.md 10.5). Messages are { type, ...payload }. Both directions are checked against
// an origin allowlist: this page's own origin plus the origin named in ?host=.

import { applyTheme } from './theme.js';

function hostOrigin() {
  try {
    const raw = new URLSearchParams(location.search).get('host');
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}

const isEmbedded = () => {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
};

// handlers: { loadTemplate(id), setMode('demo'|'full'), getProjectId() }
export function createEmbed({ handlers = {} } = {}) {
  const host = hostOrigin();
  const allowed = new Set([location.origin, host].filter((o) => o && o !== 'null'));
  const targetOrigin = host || location.origin;

  function post(type, payload = {}) {
    if (!isEmbedded()) return false;
    try {
      window.parent.postMessage({ type, ...payload }, targetOrigin);
      return true;
    } catch {
      return false;
    }
  }

  function onMessage(ev) {
    if (!allowed.has(ev.origin)) return;
    if (ev.source !== window.parent && ev.source !== window) return;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'ps:load-template':
        if (typeof msg.id === 'string') handlers.loadTemplate?.(msg.id);
        break;
      case 'ps:set-mode':
        if (msg.mode === 'demo' || msg.mode === 'full') handlers.setMode?.(msg.mode);
        break;
      case 'ps:set-theme':
        if (msg.theme === 'light' || msg.theme === 'dark') applyTheme(msg.theme);
        break;
      default:
        break;
    }
  }

  // Analytics events raised inside the tool (ui/analytics.js) go to the host page, which owns consent.
  const onAnalytics = (e) => post('ps:analytics', { event: e.detail?.event, props: e.detail?.props || {} });
  // Any module can ask the host to start checkout with window.dispatchEvent(new CustomEvent('ps:upgrade')).
  const onUpgrade = () => post('ps:upgrade', { projectId: handlers.getProjectId?.() });

  window.addEventListener('message', onMessage);
  window.addEventListener('ps:analytics', onAnalytics);
  window.addEventListener('ps:upgrade', onUpgrade);

  return {
    allowed: [...allowed],
    embedded: isEmbedded(),
    post,
    ready: () => post('ps:ready'),
    openFull: () => post('ps:open-full', { projectId: handlers.getProjectId?.() }),
    upgrade: () => post('ps:upgrade', { projectId: handlers.getProjectId?.() }),
    dispose() {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('ps:analytics', onAnalytics);
      window.removeEventListener('ps:upgrade', onUpgrade);
    },
  };
}
