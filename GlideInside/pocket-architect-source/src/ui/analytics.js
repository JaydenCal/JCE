// Analytics hook (docs/SCOPE.md 12.7). The tool never sends anything itself: events go to the
// host page, which forwards them through its own analytics and consent mechanism.

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
