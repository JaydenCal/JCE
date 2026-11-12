// "Send plans to a registered engineer": the lot card button and the prompt after a plan set PDF download. Both open the existing enquiry
// form (src/premium/ui/enquiry.js, through window.__ps.premium.openEnquiry), pre-filled with the lot, with the plan set PDF attached.
// The enquiry is saved by the server before any email is attempted (server/lib/enquiry.js), so a request is never lost.

import { toast as defaultToast } from '../ui/toast.js';

export const SEND_LABEL = 'Send plans to a registered engineer';
export const AFTER_EXPORT_TEXT = 'Need engineering or DA plans? Send these plans to a registered engineer';
/** The server refuses a PDF over ENQUIRY_MAX_PDF_BYTES (6 MB). Over this the request goes without the PDF rather than not at all. */
export const MAX_PDF_BYTES = 5_500_000;

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Builds the site plan set PDF and resolves it as base64, or null when it is over the size the server accepts. */
export async function planSetBase64({ project, lot, builderName = '', exportPlanSet }) {
  const out = await exportPlanSet({ project, lot, kind: 'site', builderName, download: false });
  const blob = out?.blob || out?.bytes || out?.data || out;
  const bytes = blob instanceof Blob ? new Uint8Array(await blob.arrayBuffer()) : blob instanceof Uint8Array ? blob : blob instanceof ArrayBuffer ? new Uint8Array(blob) : null;
  if (!bytes || bytes.length > MAX_PDF_BYTES) return null;
  return bytesToBase64(bytes);
}

/**
 * The controller the lot card uses.
 *   available()            true when the premium layer is loaded and the person may send (a client login whose builder switched sending off may not)
 *   open()                 opens the enquiry form with the lot filled in and the plan set PDF attached when they press Send
 *   offerAfterExport(kind) after a Site plan PDF or House plan PDF download: a toast with the same button
 */
export function createSendToEngineer({ getApp, getProject, getLot, getBuilderName = () => '', toast = defaultToast, loadExporter = () => import('../premium/exporters/planset/index.js').then((m) => m.exportPlanSet) }) {
  const premium = () => getApp()?.premium || null;
  const available = () => { const p = premium(); return !!p?.openEnquiry && (typeof p.canSendPlans === 'function' ? !!p.canSendPlans() : true); };
  function open() {
    const p = premium();
    if (!available()) return null;
    return p.openEnquiry({
      anyone: true,
      buildPdf: async () => planSetBase64({ project: getProject(), lot: getLot(), builderName: getBuilderName(), exportPlanSet: await loadExporter() }),
    });
  }
  function offerAfterExport() {
    if (!available()) return null;
    return toast(AFTER_EXPORT_TEXT, { kind: 'info', timeout: 14000, action: { label: SEND_LABEL, onClick: () => open() } });
  }
  return { available, open, offerAfterExport };
}
