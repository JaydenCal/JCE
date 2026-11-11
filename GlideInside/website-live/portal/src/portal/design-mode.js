// Which Pocket Architect experience a portal login gets. Pure, so it is unit tested.
//   client login                           client mode always
//   builder or staff login, ?design=...    "Design on a lot": the same client mode, plus the staff extras (full editor, exports, send)
//   builder or staff login, no ?design     the full editor, as before
// A builder only ever sees their own designs: the Glide Inside sample library is not offered in Design on a lot.

export const designMode = (role, params) => role !== 'client' && !!params?.get?.('design');
export const clientLike = (role, params) => role === 'client' || designMode(role, params);

/** Whether the Glide Inside sample library is listed: clients only when the builder allows it, staff in the full editor, never in Design on a lot. */
export function wantsGlide(me, params) {
  if (me.user.role === 'client') return me.org.showGlideToClients === true;
  return !designMode(me.user.role, params);
}

const base = (here) => new URL(here, 'http://localhost/');
/** The same page without the design parameters: the whole editor. The open design stays (it is autosaved in this browser). */
export function fullEditorHref(here) {
  const u = base(here);
  u.searchParams.delete('design');
  u.searchParams.delete('project');
  return u.href;
}
/** The same page as Design on a lot with a new design on a blank lot. */
export function designNewHref(here) {
  const u = base(here);
  for (const k of ['house', 'glide', 'project']) u.searchParams.delete(k);
  u.searchParams.set('design', 'new');
  return u.href;
}
