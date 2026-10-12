"use client";
import { useState } from "react";
import EngineerEnquiryModal from "./EngineerEnquiryModal";
import { ENQUIRY_CSS } from "./styles";
import type { EnquiryContext } from "@/lib/enquiry";

export interface EngineerEnquiryButtonProps {
  projectId?: string;
  context?: EnquiryContext | string;
  userId?: string;
  label?: string;
  /** Custom content; takes precedence over `label`. */
  children?: React.ReactNode;
  /** Pass your own classes (e.g. the nav-link class) to style the trigger; the default is unstyled-neutral. */
  className?: string;
}

/** Nav tab / CTA that opens the enquiry modal. Drop it anywhere: <EngineerEnquiryButton className="nav-link" /> */
export function EngineerEnquiryButton({ projectId, context, userId, label = "Talk to an engineer", className, children }: EngineerEnquiryButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? "enq enq-btn enq-btn-primary enq-trigger"} onClick={() => setOpen(true)}
        aria-haspopup="dialog" aria-expanded={open}>
        {!className && <style>{ENQUIRY_CSS}</style>}
        {children ?? label}
      </button>
      <EngineerEnquiryModal open={open} onClose={() => setOpen(false)} projectId={projectId} context={context} userId={userId} />
    </>
  );
}

export default EngineerEnquiryButton;
