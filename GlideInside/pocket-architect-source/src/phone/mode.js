// Phone mode: the Residential tool as a native feeling phone app. Pure decision plus a small DOM installer.
//
//   phone mode  =  a coarse pointer (a finger) AND a narrow window (700 px or less), unless the person chose "Desktop view" in the menu.
//   html[data-phone="1"] is set while it is on, so the phone styles and the phone screens all key off one flag.
//   "Desktop view" is remembered in this browser (localStorage ps.desktopView = "1") and also widens the page, as a phone browser's own
//   desktop site switch does. "Phone view" in the same menu puts it back.

export const PHONE_QUERY = '(pointer: coarse) and (max-width: 700px)';
export const DESKTOP_KEY = 'ps.desktopView';
export const DESKTOP_WIDTH = 1100;

/** Pure: is this phone mode? `coarse` and `width` come from the window, `desktop` is the person's override. */
export function phoneModeFor({ coarse = false, width = 1024, desktop = false } = {}) {
  if (desktop) return false;
  return !!coarse && Number(width) <= 700;
}

const listeners = new Set();
let installed = null;

const read = (win) => { try { return win.localStorage?.getItem(DESKTOP_KEY) === '1'; } catch { return false; } };

/** Is phone mode on right now? Safe before install (reads the page). */
export function isPhoneMode(win = globalThis) {
  const el = win.document?.documentElement;
  if (el && el.dataset.phone != null && el.dataset.phone !== '') return el.dataset.phone === '1';
  return computeNow(win);
}

function computeNow(win) {
  const mm = win.matchMedia?.bind(win);
  const coarse = !!mm?.('(pointer: coarse)')?.matches;
  const width = win.innerWidth || 1024;
  return phoneModeFor({ coarse, width, desktop: read(win) });
}

/** The person's own choice to use the desktop layout on a phone. */
export const desktopViewChosen = (win = globalThis) => read(win);

function viewportMeta(win, desktop) {
  const doc = win.document;
  let m = doc.querySelector('meta[name="viewport"]');
  if (!m) { m = doc.createElement('meta'); m.name = 'viewport'; doc.head.append(m); }
  if (!m.dataset.psOrig) m.dataset.psOrig = m.getAttribute('content') || 'width=device-width, initial-scale=1';
  m.setAttribute('content', desktop ? `width=${DESKTOP_WIDTH}, initial-scale=0.35, minimum-scale=0.25, maximum-scale=3` : m.dataset.psOrig);
}

/**
 * Start tracking. Sets html[data-phone] (and data-desktop-view when chosen) and keeps them current when the window changes.
 * Returns { isPhone(), setDesktopView(on), onChange(fn), dispose() }.
 */
export function installPhoneMode(win = globalThis) {
  if (installed) return installed;
  const doc = win.document;
  const root = doc.documentElement;
  let current = null;
  const apply = () => {
    const desktop = read(win);
    const on = computeNow(win);
    root.dataset.desktopView = desktop ? '1' : '0';
    if (on === current) return;
    current = on;
    root.dataset.phone = on ? '1' : '0';
    for (const fn of [...listeners]) { try { fn(on); } catch (e) { console.warn('[phone] listener failed', e); } }
  };
  const mqs = [win.matchMedia?.('(pointer: coarse)'), win.matchMedia?.('(max-width: 700px)')].filter(Boolean);
  for (const mq of mqs) (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener?.(apply));
  win.addEventListener?.('resize', apply);
  apply();
  viewportMeta(win, read(win));
  installed = {
    isPhone: () => current === true,
    setDesktopView(on) {
      try { if (on) win.localStorage.setItem(DESKTOP_KEY, '1'); else win.localStorage.removeItem(DESKTOP_KEY); } catch { /* not remembered */ }
      viewportMeta(win, !!on);
      current = null;
      apply();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { for (const mq of mqs) (mq.removeEventListener ? mq.removeEventListener('change', apply) : mq.removeListener?.(apply)); win.removeEventListener?.('resize', apply); listeners.clear(); installed = null; },
  };
  return installed;
}

/** Subscribe without needing the installer handle. */
export const onPhoneChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const phoneApi = () => installed;
