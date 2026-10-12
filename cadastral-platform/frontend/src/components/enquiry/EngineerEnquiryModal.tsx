"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EngineerEnquiryForm from "./EngineerEnquiryForm";
import { ENQUIRY_CSS } from "./styles";
import type { EnquiryContext } from "@/lib/enquiry";

export interface EngineerEnquiryModalProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  context?: EnquiryContext | string;
  /** Dev-stub user id (X-User-Id) for signed-in submissions. */
  userId?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function EngineerEnquiryModal({ open, onClose, projectId, context, userId }: EngineerEnquiryModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
      returnTo.current?.focus?.();
      setFormKey((k) => k + 1); // fresh form next time
    };
  }, [open]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="enq">
      <style>{ENQUIRY_CSS}</style>
      <div className="enq-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div ref={dialogRef} className="enq-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
          <div className="enq-head">
            <div>
              <div className="enq-eyebrow">Industry partner enquiry</div>
              <h2 id={titleId}>Talk to a civil engineer</h2>
            </div>
            <button type="button" className="enq-close" onClick={onClose} aria-label="Close dialog">&times;</button>
          </div>
          <div className="enq-body">
            <EngineerEnquiryForm key={formKey} projectId={projectId} context={context} userId={userId} onDone={onClose} firstFieldRef={firstRef} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default EngineerEnquiryModal;
