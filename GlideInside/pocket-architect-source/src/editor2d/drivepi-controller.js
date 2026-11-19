// The Driveway PI tool's behaviour, with no DOM and no canvas (residential plan). Pointer, key and double click events arrive in plan
// coordinates (mm); every change is ONE undo step (store.apply). Click the driveway centreline to add a PI, drag a square to move it,
// Delete or a right click removes it, drag the green diamond to slide the kerb end. The garage door end is never a handle.
// The site logic lives in site/drivepi.js; tool-drivepi.js connects this to the canvas and draws draft().

import * as D from '../site/drivepi.js';

const DRAG_PX = 3;
const HANDLE_PX = 10;
const fmtM1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} m`;

export const DRIVEPI_HINT = 'Click the driveway centreline to add a PI. Drag a square to move it. Delete or a right click removes the PI. Drag the green diamond to slide the end along the kerb. The building end stays attached.';

export function createDrivePIController({ store, scale, toast = () => {}, redraw = () => {} }) {
  let selected = null; // index of the selected PI
  let drag = null; // { kind: 'pi' | 'end', index, moved, screen, to, ok }
  let hover = null;
  let drawing = null; // a driveway being drawn: { pts: [{x,y}], cursor }, the first point on the street frontage
  const mmPerPx = () => 1 / Math.max(1e-6, scale());
  const tolMm = () => HANDLE_PX * mmPerPx();
  const say = (msg, kind = 'ok', extra = {}) => { try { toast(msg, { kind, ...extra }); } catch { /* no toast host */ } };
  const state = () => D.driveEditState(store.project);

  function edit(label, fn) {
    let out = null;
    try {
      store.apply(label, (p) => {
        out = fn(p);
        if (out && out.ok === false) throw Object.assign(new Error(out.reason || 'That change was not possible.'), { name: 'DriveRefused' });
      });
    } catch (e) {
      if (e?.name === 'DriveRefused') { say(e.message, 'warn'); return { ok: false, reason: e.message }; }
      say(e?.message || 'That change was not possible.', 'warn');
      return { ok: false, reason: e?.message };
    }
    return out || { ok: true };
  }

  const select = (i) => { selected = i; };

  function addAt(pt) {
    const r = edit('Add driveway PI', (p) => D.addDrivewayPI(p, pt));
    if (r.ok) select(r.index);
    redraw();
    return r;
  }

  function removePI(index) {
    const r = edit('Delete driveway PI', (p) => D.deleteDrivewayPI(p, index));
    if (r.ok) { select(null); say('PI deleted.', 'ok'); }
    redraw();
    return r;
  }

  // Drawing a new driveway (no garage door, or none yet): click the frontage, click PIs, double click or Enter at the building.
  const KERB_PICK_PX = 40;
  function drawDown(w) {
    if (!drawing) {
      const k = D.kerbSnap(store.project, w);
      if (!k || (k.pickMm ?? k.distMm) > KERB_PICK_PX * mmPerPx() + 1500) { say('Start the driveway on the street frontage.', 'info'); return true; }
      drawing = { pts: [k.point], cursor: k.point };
      redraw();
      return true;
    }
    const last = drawing.pts.at(-1);
    if (Math.hypot(w.x - last.x, w.y - last.y) > tolMm()) drawing.pts.push({ x: w.x, y: w.y }); // a double click's second press adds nothing
    drawing.cursor = { x: w.x, y: w.y };
    redraw();
    return true;
  }
  function finishDrawing() {
    if (!drawing) return false;
    if (drawing.pts.length < 2) { say('Click at least one more point, at the building, to finish.', 'info'); return true; }
    const pts = drawing.pts;
    const r = edit('Draw driveway', (p) => D.createDrawnDriveway(p, pts));
    if (r.ok) { drawing = null; say('Driveway drawn. Drag a PI to shape it.', 'ok'); }
    redraw();
    return true;
  }
  const cancelDrawing = () => { if (!drawing) return false; drawing = null; redraw(); return true; };

  function deleteDriveway() {
    const r = edit('Delete driveway', (p) => (D.deleteDrawnDriveway(p) ? { ok: true } : { ok: false, reason: 'There is no drawn driveway to delete.' }));
    select(null); drag = null; hover = null;
    if (r.ok) say('Driveway deleted.', 'ok');
    redraw();
    return !!r.ok;
  }

  function pointerDown(w, mods = {}) {
    const st = state();
    if (!st.ok && st.canDraw) return drawDown(w);
    if (!st.ok) { say(D.driveEditBlock(st), 'info'); return false; }
    const hit = D.driveHit(st, w, tolMm());
    if (!hit) { if (selected != null) { select(null); redraw(); } return false; }
    if (hit.kind === 'pi') { select(hit.index); drag = { kind: 'pi', index: hit.index, moved: false, screen: mods.screen || null, to: null }; redraw(); return true; }
    if (hit.kind === 'end') { select(null); drag = { kind: 'end', index: -1, moved: false, screen: mods.screen || null, to: null }; redraw(); return true; }
    // On the line: add the PI now, and let the same press drag it into place.
    const r = addAt(hit.point);
    if (r.ok) drag = { kind: 'pi', index: r.index, moved: false, screen: mods.screen || null, to: null };
    return true;
  }

  function preview(d) {
    const prev = structuredClone(store.project);
    const r = d.kind === 'end' ? D.moveDrivewayEnd(prev, d.to) : D.moveDrivewayPI(prev, d.index, d.to);
    return { project: prev, ok: !!r.ok, reason: r.reason };
  }

  function pointerMove(w, mods = {}) {
    if (drag) {
      if (!drag.moved && drag.screen && mods.screen && Math.hypot(mods.screen.x - drag.screen.x, mods.screen.y - drag.screen.y) < DRAG_PX) return;
      drag.moved = true;
      drag.to = { x: w.x, y: w.y };
      drag.preview = preview(drag);
      redraw();
      return;
    }
    if (drawing) { drawing.cursor = { x: w.x, y: w.y }; redraw(); return; }
    const st = state();
    const h = st.ok ? D.driveHit(st, w, tolMm()) : null;
    const key = h ? `${h.kind}${h.index ?? ''}` : '';
    if (key !== (hover ? `${hover.kind}${hover.index ?? ''}` : '') || (h?.kind === 'line')) { hover = h; redraw(); }
  }

  function pointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved || !d.to) { redraw(); return; }
    if (d.kind === 'end') edit('Slide driveway end', (p) => D.moveDrivewayEnd(p, d.to));
    else edit('Move driveway PI', (p) => D.moveDrivewayPI(p, d.index, d.to));
    redraw();
  }

  function dblClick(w) {
    if (drawing) { finishDrawing(); return; }
    const st = state();
    if (!st.ok) return;
    const hit = D.driveHit(st, w, tolMm());
    if (hit?.kind === 'line') addAt(hit.point); // a PI that a single press already added is a PI hit, so it is not added twice
  }

  /** Right click: delete the PI under the pointer. Returns true when it was used. */
  function rightClick(w) {
    const st = state();
    if (!st.ok) return false;
    const hit = D.driveHit(st, w, tolMm());
    if (hit?.kind !== 'pi') return false;
    removePI(hit.index);
    return true;
  }

  function deleteSelected() {
    const st = state();
    if (!st.ok || selected == null) { say('Click a PI first, then delete it.', 'info'); return false; }
    return removePI(selected).ok;
  }

  /** Reset to auto: drop the edit so the automatic driveway comes back. One undo step. */
  function reset() {
    if (!store.project.site?.driveway) { say('The driveway is already automatic.', 'info'); return false; }
    const r = edit('Reset driveway to auto', (p) => { D.resetDrivewayToAuto(p); return { ok: true }; });
    select(null); drag = null;
    if (r.ok) say('Back to the automatic driveway.', 'ok');
    redraw();
    return r.ok;
  }

  function setRadius(radiusM) {
    const r = edit('Change driveway PI radius', (p) => D.setDrivewayRadius(p, radiusM));
    redraw();
    return r.ok;
  }

  function cancel() {
    if (cancelDrawing()) return true;
    if (drag) { drag = null; redraw(); return true; }
    if (selected != null) { select(null); redraw(); return true; }
    return false;
  }

  /** Returns true when the key was used. */
  function keyDown(e) {
    const k = e.key;
    if (k === 'Escape') return cancel();
    if (drawing && k === 'Enter') return finishDrawing();
    if (drawing && (k === 'Backspace' || k === 'Delete')) { if (drawing.pts.length > 1) drawing.pts.pop(); else drawing = null; redraw(); return true; }
    if (k === 'Delete' || k === 'Backspace') {
      const st = state();
      if (!st.ok) return false;
      if (selected == null) { say(st.pis.length ? 'Click a PI first, then press Delete.' : 'This driveway has no PIs to delete.', 'info'); return true; }
      deleteSelected();
      return true;
    }
    return false;
  }

  function hint() {
    const st = state();
    if (drawing) return 'Click to add a PI. Double click or press Enter at the building to finish. Backspace removes the last point. Escape cancels.';
    if (!st.ok) return D.driveEditBlock(st);
    return DRIVEPI_HINT;
  }

  /** What to draw: { ok, message, centre, polygon, pis, kerb, selected, hover, dragging, refused, reason, readout }. */
  function draft() {
    const st = state();
    if (drawing) return { ok: false, drawing: { pts: drawing.pts, cursor: drawing.cursor } };
    if (!st.ok) return { ok: false, message: D.driveEditBlock(st) };
    let src = st;
    let refused = false; let reason = '';
    if (drag?.moved && drag.preview) {
      if (drag.preview.ok) src = D.driveEditState(drag.preview.project); else { refused = true; reason = drag.preview.reason; }
    }
    const d = src.ok ? src.d : st.d;
    const readout = `Driveway ${fmtM1(d.lengthMm / 1000)} long, ${fmtM1(d.widthMm / 1000)} wide${d.minRadiusM != null && d.minRadiusM < 4 && src.pis?.length ? `. Tight bend, ${fmtM1(d.minRadiusM)} radius` : ''}`;
    return { ok: true, edited: st.edited, centre: d.centre, polygon: d.polygon, pis: src.ok ? src.pis : st.pis, kerb: d.kerbPoint, selected, hover, dragging: !!drag?.moved, refused, reason, readout, ghost: drag?.moved ? st.d.polygon : null };
  }

  return {
    pointerDown, pointerMove, pointerUp, dblClick, rightClick, keyDown, cancel, reset, deleteDriveway, finishDrawing, isDrawing: () => !!drawing, setRadius, deleteSelected, removePI, draft, hint, state,
    selectedPI: () => selected,
    selectPI: (i) => { select(i); redraw(); },
    clear: () => { selected = null; drag = null; hover = null; drawing = null; },
  };
}
