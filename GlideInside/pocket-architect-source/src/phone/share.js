// Send a design link with the phone's share sheet (navigator.share), or copy it when there is no share sheet. Nothing goes to a server.
export const SHARE_TITLE = 'My Glide Inside design';
export const SHARE_TEXT = 'My home on my block, made with Glide Inside.';

async function legacyCopy(url, doc) {
  try {
    const ta = doc.createElement('textarea');
    ta.value = url; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    doc.body.append(ta); ta.select();
    const ok = !!doc.execCommand?.('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/**
 * Share `url`. Returns { how: 'shared' | 'copied' | 'cancelled' | 'manual', url }.
 *   shared     the share sheet took it
 *   cancelled  the person closed the share sheet (nothing else is done)
 *   copied     no share sheet (or it failed): the link is on the clipboard
 *   manual     nothing could copy: the caller shows the link for the person to copy by hand
 */
export async function shareOrCopy({ url, title = SHARE_TITLE, text = SHARE_TEXT, nav = globalThis.navigator, doc = globalThis.document } = {}) {
  if (!url) return { how: 'manual', url: '' };
  const data = { title, text, url };
  if (typeof nav?.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))) {
    try { await nav.share(data); return { how: 'shared', url }; } catch (e) {
      if (e?.name === 'AbortError') return { how: 'cancelled', url };
      /* the share sheet failed: copy instead */
    }
  }
  try { if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(url); return { how: 'copied', url }; } } catch { /* try the older way */ }
  if (doc && await legacyCopy(url, doc)) return { how: 'copied', url };
  return { how: 'manual', url };
}
