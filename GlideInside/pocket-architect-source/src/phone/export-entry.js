// The phone editor's Export slot (the dock button between Plan and Details). The dock calls openExportSheet() and nothing else, so the
// export flow can change without touching the dock. For now it opens the existing exports menu (the premium layer's Exports).

/** Open the exports UI. Returns true when something opened. */
export function openExportSheet() {
  const app = typeof window !== 'undefined' ? window.__ps : null;
  try {
    if (app?.premium?.openExports) { app.premium.openExports(); return true; }
  } catch (e) { console.warn('[phone] exports did not open', e); }
  // The premium layer has not loaded yet (or is off): the menu holds the Exports group, so open that.
  const more = typeof document !== 'undefined' ? document.querySelector('[data-ps="topbar-more"]') : null;
  if (more) { more.click(); return true; }
  return false;
}
