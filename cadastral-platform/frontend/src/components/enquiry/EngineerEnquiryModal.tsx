"use client";
/** STUB: to be overwritten by the enquiry feature owner. */
export function EngineerEnquiryModal({ open, onClose }: { open: boolean; onClose: () => void; projectId?: string; context?: string }) {
  if (!open) return null;
  return (<div role="dialog" aria-modal="true" aria-label="Talk to an engineer" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="card max-w-md"><p>Enquiry form coming soon.</p><button className="btn-primary mt-4" onClick={onClose}>Close</button></div></div>);
}
export default EngineerEnquiryModal;
