// Free trial watermark. Applied as a post-process layer so the plan builders (pdf.js, eng/*) stay unaware of it.
// The decision is made on the server from the organisation account state (server/lib/trial.js); nothing here reads the client.
// Plan Pack (homeowner) exports never pass `watermark` and so are never marked. No dashes in any text.

export const TRIAL_TITLE = 'TRIAL · NOT FOR CONSTRUCTION OR LODGEMENT';
export const TRIAL_FOOTER = 'Free trial export from Glide Inside. Watermark removed once the account is active.';
export const TRIAL_DXF_TEXT = 'TRIAL NOT FOR CONSTRUCTION OR LODGEMENT';
export const TRIAL_NOTE = 'Glide Inside trial export';
export const TRIAL_DXF_LAYER = 'GI-TRIAL-WATERMARK';
export const TRIAL_NODE = 'GI_TRIAL_WATERMARK';
export const TRIAL_MATERIAL = 'GI_TRIAL_watermark_red';

/** Draw the mark on every page of a jsPDF document (diagonal title, small footer line), at about 22 percent opacity. */
export function stampPdf(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.saveGraphicsState();
    // Diagonal title: sized so the text spans about 62 percent of the page diagonal.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(100);
    const base = doc.getTextWidth(TRIAL_TITLE);
    const diag = Math.hypot(w, h);
    const size = Math.max(10, (100 * 0.62 * diag) / base);
    doc.setFontSize(size);
    const tw = doc.getTextWidth(TRIAL_TITLE);
    const theta = Math.atan2(h, w);
    const deg = (theta * 180) / Math.PI;
    doc.setGState(new doc.GState({ opacity: 0.2 }));
    doc.setTextColor(190, 50, 50);
    const x0 = w / 2 - (tw / 2) * Math.cos(theta);
    const y0 = h / 2 + (tw / 2) * Math.sin(theta);
    doc.text(TRIAL_TITLE, x0, y0, { angle: deg });
    // Footer line, small, near the bottom edge so the title block is not hidden.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setGState(new doc.GState({ opacity: 0.25 }));
    doc.setTextColor(150, 60, 60);
    doc.text(TRIAL_FOOTER, w / 2, h - 2.2, { align: 'center' });
    doc.restoreGraphicsState();
  }
  doc.setPage(1);
}

/** A jsPDF class whose documents are stamped when they are finalised (output). The builders only ever see a normal jsPDF. */
export function trialJsPDF(JsPDF) {
  function TrialPDF(...args) {
    const doc = new JsPDF(...args);
    const output = doc.output.bind(doc);
    let stamped = false;
    doc.output = (...a) => {
      if (!stamped) {
        stamped = true;
        stampPdf(doc);
        try { doc.setProperties({ keywords: TRIAL_NOTE }); } catch { /* optional */ }
      }
      return output(...a);
    };
    return doc;
  }
  Object.assign(TrialPDF, JsPDF);
  TrialPDF.prototype = JsPDF.prototype;
  return TrialPDF;
}

/** GLB and OBJ: a small flat "TRIAL" plate beside the model, named and with metadata (glTF extras). */
export function markTrialGroup(THREE, group) {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const plateW = Math.max(0.6, Math.min(3, size.x * 0.25));
  const mat = new THREE.MeshBasicMaterial({ color: 0xbe3232 });
  mat.name = TRIAL_MATERIAL;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateW, plateW * 0.3, 0.02), mat);
  plate.name = TRIAL_NODE;
  plate.position.set(Number.isFinite(box.min.x) ? box.min.x + plateW / 2 : 0, plateW * 0.15, Number.isFinite(box.max.z) ? box.max.z + 0.5 : 0);
  plate.userData = { note: TRIAL_NOTE, text: TRIAL_TITLE, detail: TRIAL_FOOTER };
  group.add(plate);
  group.userData = { ...group.userData, glideInside: TRIAL_NOTE, trial: true };
  group.updateMatrixWorld(true);
}

/** DXF: text on the watermark layer across the drawing extents (diagonal) and a line in the title area. */
export function dxfTrialEntities(writer, ext, titleAt) {
  const e = Number.isFinite(ext.minX) ? ext : { minX: 0, minY: 0, maxX: 10000, maxY: 10000 };
  const w = e.maxX - e.minX;
  const h = e.maxY - e.minY;
  const ang = (Math.atan2(h, w) * 180) / Math.PI;
  const height = Math.max(300, Math.hypot(w, h) / 22);
  const len = TRIAL_DXF_TEXT.length * height * 0.62;
  const theta = Math.atan2(h, w);
  const cx = (e.minX + e.maxX) / 2;
  const cy = (e.minY + e.maxY) / 2;
  // plan y is down, DXF y is up (the writer negates), so a plan line from bottom left to top right is a rising line in the file
  const start = { x: cx - (len / 2) * Math.cos(theta), y: cy + (len / 2) * Math.sin(theta) };
  writer.begin('TEXT', TRIAL_DXF_LAYER);
  writer.point(10, start);
  writer.pair(40, height);
  writer.pair(1, TRIAL_DXF_TEXT);
  writer.pair(50, ang);
  writer.grow(e.minX, e.minY);
  writer.grow(e.maxX, e.maxY);
  const at = titleAt || { x: e.minX, y: e.maxY + 800 };
  writer.text(TRIAL_DXF_LAYER, at, 220, `TRIAL: ${TRIAL_FOOTER}`);
  writer.text(TRIAL_DXF_LAYER, { x: at.x, y: at.y + 320 }, 300, TRIAL_DXF_TEXT);
}

/** HTML viewer: fixed corner badge and a faint diagonal overlay. Text only, no web links, so the file stays offline. */
export const TRIAL_CSS = `.gi-trial-badge{position:fixed;top:10px;right:10px;z-index:99999;background:#be3232;color:#fff;font:700 12px/1.2 Helvetica,Arial,sans-serif;letter-spacing:.08em;padding:6px 10px;border-radius:4px;opacity:.92;pointer-events:none}
.gi-trial-overlay{position:fixed;inset:0;z-index:99998;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden}
.gi-trial-overlay span{transform:rotate(-30deg);font:800 clamp(48px,14vw,220px)/1 Helvetica,Arial,sans-serif;color:#be3232;opacity:.1;letter-spacing:.1em;white-space:nowrap}
.gi-trial-foot{position:fixed;left:0;right:0;bottom:0;z-index:99999;text-align:center;font:11px/1.3 Helvetica,Arial,sans-serif;color:#7a3030;opacity:.8;padding:3px 8px;pointer-events:none}`;
export const TRIAL_HTML = `<div class="gi-trial-badge" role="note">TRIAL</div><div class="gi-trial-overlay" aria-hidden="true"><span>TRIAL</span></div><div class="gi-trial-foot">${TRIAL_FOOTER}</div>`;
