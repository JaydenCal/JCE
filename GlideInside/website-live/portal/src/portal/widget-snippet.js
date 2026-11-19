// The "See it on your block" website widget snippets a builder copies from the portal (docs/WIDGET_LEADS.md). Pure functions.
//   <script src="https://glideinside.com.au/widget/v1.js" data-builder="hunter-homes" async></script>
// builds an iframe of Glide Inside in widget mode (?embed=1&widget=<builder id>). The iframe form needs no script.

export const WIDGET_HEIGHT = 720;

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The app address the widget frame loads. origin is the Glide Inside site origin; appPath is the app path on it. */
export function widgetFrameUrl(origin, id, { host = null, appPath = '/plan-studio/app/' } = {}) {
  const u = new URL(appPath, origin);
  u.searchParams.set('embed', '1');
  u.searchParams.set('widget', id);
  if (host) u.searchParams.set('host', host);
  return u.href;
}

/** The script snippet (recommended) and the plain iframe snippet, both carrying the builder id. */
export function widgetSnippets(origin, id, { height = WIDGET_HEIGHT } = {}) {
  const frame = widgetFrameUrl(origin, id);
  return {
    script: `<script src="${attr(new URL('/widget/v1.js', origin).href)}" data-builder="${attr(id)}" data-height="${height}" async></script>`,
    iframe: `<iframe src="${attr(frame)}" title="See it on your block" width="100%" height="${height}" style="border:0;max-width:100%" loading="lazy" allow="fullscreen"></iframe>`,
  };
}

/** Websites the builder typed, one per line or comma separated, to the list sent to the server (the server cleans each one). */
export const originsFromText = (text) => String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
