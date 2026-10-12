"use client";
import { useState, type ReactNode } from "react";
import { EngineerEnquiryModal } from "./EngineerEnquiryModal";
/** STUB: to be overwritten by the enquiry feature owner. */
export function EngineerEnquiryButton({ className = "", children = "Talk to an engineer", projectId, context }: { className?: string; children?: ReactNode; projectId?: string; context?: string }) {
  const [open, setOpen] = useState(false);
  return (<><button type="button" className={className} onClick={() => setOpen(true)}>{children}</button><EngineerEnquiryModal open={open} onClose={() => setOpen(false)} projectId={projectId} context={context} /></>);
}
export default EngineerEnquiryButton;
