// Phone Export sheet (25/11/2026). Opened from the phone bottom toolbar. Every file for the design is free for homeowners behind the one lead
// form: the first tap opens the form, after that every file downloads without asking again. The files are built in this browser by the premium layer
// (window.__ps.premium.exportFree). The desktop Exports menu uses the same path.
import { h } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { openSheet, sheetButton } from './sheet.js';

export const EXPORT_SHEET_ITEMS = Object.freeze([
  { type: 'pdf', label: 'Plan set (PDF)', hint: 'A3 sheets to scale, with schedules' },
  { type: 'glb', label: '3D model', hint: 'GLB file for Blender and 3D viewers' },
  { type: 'html', label: 'Interactive 3D file', hint: 'One file that opens offline in any browser' },
  { type: 'dxf', label: 'CAD file (DXF)', hint: 'Layered, for CAD software' },
]);
export const DESKTOP_LINE = 'For the detailed design tool, open glideinside.com.au on a computer';
const SWIPE_PX = 70;

const prem = () => (typeof window !== 'undefined' ? window.__ps?.premium : null) || null;

/** Open the bottom sheet. Returns { close, el }. Close button, a tap outside and a swipe down all close it. */
export function openExportSheet() {
  let sheet = null;
  const run = async (type) => {
    sheet?.close();
    const p = prem();
    if (!p) { toast('Not ready yet. Try again in a moment.', { kind: 'info', timeout: 6000 }); return; }
    try {
      if (typeof p.exportFree === 'function') await p.exportFree(type, { surface: 'phone' });
      else await p.exportAs?.(type);
    } catch (e) { toast(e?.message || 'That file could not be built. Try again.', { kind: 'error', timeout: 8000 }); }
  };
  const list = h('div', { class: 'ps-sheet-list', dataset: { ps: 'export-sheet-list' } },
    ...EXPORT_SHEET_ITEMS.map((it) => sheetButton({ label: it.label, hint: it.hint, ps: `export-${it.type}`, onClick: () => run(it.type) })));
  const note = h('p', { class: 'ps-sheet-note', dataset: { ps: 'export-sheet-note' }, style: { margin: '12px 2px 0' } }, 'Free. Share your details once and every file downloads for this design. ', DESKTOP_LINE, '.');
  sheet = openSheet({ title: 'Export', body: h('div', null, list, note), id: 'export-sheet' });
  // Swipe down on the grab bar or the title closes the sheet (a tap outside is the scrim, and Close is in the title bar).
  const head = sheet.el;
  let y0 = null;
  head.addEventListener('touchstart', (e) => { if (e.target.closest?.('.ps-sheet-body') && sheet.el.querySelector('.ps-sheet-body').scrollTop > 0) { y0 = null; return; } y0 = e.touches?.[0]?.clientY ?? null; }, { passive: true });
  head.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = (e.touches?.[0]?.clientY ?? y0) - y0;
    if (dy > 0) sheet.el.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const end = (e) => {
    if (y0 == null) return;
    const dy = (e.changedTouches?.[0]?.clientY ?? y0) - y0;
    y0 = null;
    if (dy > SWIPE_PX) sheet.close(); else sheet.el.style.transform = '';
  };
  head.addEventListener('touchend', end);
  head.addEventListener('touchcancel', () => { y0 = null; sheet.el.style.transform = ''; });
  return sheet;
}
