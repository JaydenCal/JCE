// Analytics hook (docs/SCOPE.md 12.7). The tool never sends anything itself: events go to the
// host page, which forwards them through its own analytics and consent mechanism. On the standalone
// app page (where phones land after the home page search) src/ui/ga.js registers the sender below.

let sender = null;

export function setAnalyticsSender(fn) {
  sender = fn;
}

export function track(event, props = {}) {
  try {
    window.dispatchEvent(new CustomEvent('ps:analytics', { detail: { event, props } }));
    sender?.(event, props);
  } catch {
    /* analytics must never break the tool */
  }
}

/** True on the app's own page: not inside a frame (the home page hero, a builder site) and not an ?embed= page. The host page of a frame reports for itself. */
export function isStandalonePage(win = window) {
  try {
    return win.self === win.top && !/[?&]embed=/.test(win.location?.search || '');
  } catch {
    return false;
  }
}
