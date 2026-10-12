"use client";
import { useId, useRef, useState } from "react";
import {
  ACCEPT_ATTR, CONTACT_METHODS, EnquiryError, ENQUIRY_TYPES, PARTNER_NAME, PARTNER_STATEMENT, PRIVACY_POLICY_URL, ROLES, TIMEFRAMES,
  buildFormData, emptyValues, normaliseContext, submitEnquiry, validate, type EnquiryContext, type EnquiryValues, type FieldErrors,
} from "@/lib/enquiry";

export interface EnquiryFormProps {
  projectId?: string;
  context?: EnquiryContext | string;
  userId?: string;
  onDone?: () => void;
  /** Called after a successful send with the reference number. */
  onSent?: (reference: string) => void;
  doneLabel?: string;
  firstFieldRef?: React.RefObject<HTMLInputElement>;
}

const fmtMB = (n: number) => (n / 1048576).toFixed(1) + " MB";

export default function EngineerEnquiryForm({ projectId, context: contextProp, userId, onDone, onSent, doneLabel = "Close", firstFieldRef }: EnquiryFormProps) {
  const context = normaliseContext(contextProp);
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;
  const [v, setV] = useState<EnquiryValues>(() => emptyValues(context));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasProject = Boolean(projectId || context?.summary || context?.planLinks?.length);
  const set = <K extends keyof EnquiryValues>(k: K, val: EnquiryValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const err = (k: keyof FieldErrors) => errors[k] ? <div className="enq-err" id={id(`${k}-err`)} role="alert">{errors[k]}</div> : null;
  const inv = (k: keyof FieldErrors) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? id(`${k}-err`) : undefined } as const);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    setFiles(next);
    setErrors((e) => ({ ...e, files: validate(v, next).files }));
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate(v, files);
    setErrors(e);
    setSendError(null);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      (document.getElementById(id(first === "files" ? "files" : first)) as HTMLElement | null)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await submitEnquiry(buildFormData(v, files, { projectId, context }), { userId });
      setReference(res.reference);
      onSent?.(res.reference);
    } catch (x) {
      if (x instanceof EnquiryError && Object.keys(x.fields).length) {
        setErrors(Object.fromEntries(Object.entries(x.fields).map(([k, m]) => [k, m])) as FieldErrors);
      }
      setSendError(x instanceof Error ? x.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  if (reference) {
    return (
      <div className="enq-success" role="status" aria-live="polite" data-testid="enquiry-success">
        <h3 style={{ margin: "0 0 4px", fontSize: 20 }}>Enquiry sent</h3>
        <p style={{ margin: 0 }}>Thanks. We have passed your enquiry to {PARTNER_NAME}. Your reference number is</p>
        <div className="enq-ref">{reference}</div>
        <p className="enq-hint" style={{ maxWidth: 480, margin: "0 auto 14px" }}>
          Keep this number if you need to follow up. {PARTNER_NAME} will contact you by your preferred method; a response time is not guaranteed.
        </p>
        {onDone && <button type="button" className="enq-btn enq-btn-primary" onClick={onDone}>{doneLabel}</button>}
      </div>
    );
  }

  const total = files.reduce((a, f) => a + f.size, 0);
  return (
    <form onSubmit={onSubmit} noValidate aria-busy={busy}>
      <p className="enq-note" data-testid="partner-statement">{PARTNER_STATEMENT}</p>
      {sendError && <div className="enq-banner" role="alert" data-testid="enquiry-error">{sendError} Your answers have been kept; you can try again.</div>}
      <div className="enq-grid">
        <div>
          <label className="enq-l" htmlFor={id("name")}>Name <span className="enq-req" aria-hidden>*</span></label>
          <input ref={firstFieldRef} id={id("name")} type="text" autoComplete="name" required value={v.name} onChange={(e) => set("name", e.target.value)} {...inv("name")} />
          {err("name")}
        </div>
        <div>
          <label className="enq-l" htmlFor={id("email")}>Email <span className="enq-req" aria-hidden>*</span></label>
          <input id={id("email")} type="email" autoComplete="email" required value={v.email} onChange={(e) => set("email", e.target.value)} {...inv("email")} />
          {err("email")}
        </div>
        <div>
          <label className="enq-l" htmlFor={id("phone")}>Phone <span className="enq-hint">(optional)</span></label>
          <input id={id("phone")} type="tel" autoComplete="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} {...inv("phone")} />
          {err("phone")}
        </div>
        <div>
          <label className="enq-l" htmlFor={id("company")}>Company <span className="enq-hint">(optional)</span></label>
          <input id={id("company")} type="text" autoComplete="organization" value={v.company} onChange={(e) => set("company", e.target.value)} />
        </div>
        <div>
          <label className="enq-l" htmlFor={id("role")}>I am a <span className="enq-req" aria-hidden>*</span></label>
          <select id={id("role")} required value={v.role} onChange={(e) => set("role", e.target.value as EnquiryValues["role"])} {...inv("role")}>
            <option value="">Choose...</option>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          {err("role")}
        </div>
        <div>
          <label className="enq-l" htmlFor={id("timeframe")}>Timeframe</label>
          <select id={id("timeframe")} value={v.timeframe} onChange={(e) => set("timeframe", e.target.value)}>
            <option value="">No preference</option>
            {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <fieldset className="enq-full">
          <legend>What do you need help with?</legend>
          <div className="enq-checks">
            {ENQUIRY_TYPES.map((t) => (
              <label key={t.value} className="enq-check">
                <input type="checkbox" checked={v.types.includes(t.value)}
                  onChange={(e) => set("types", e.target.checked ? [...v.types, t.value] : v.types.filter((x) => x !== t.value))} />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="enq-l" htmlFor={id("address")}>Site address</label>
          <input id={id("address")} type="text" autoComplete="street-address" value={v.address} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div>
          <label className="enq-l" htmlFor={id("lot")}>Lot / plan</label>
          <input id={id("lot")} type="text" placeholder="e.g. 12/DP123456" value={v.lotPlan} onChange={(e) => set("lotPlan", e.target.value)} />
        </div>
        <div className="enq-full">
          <label className="enq-l" htmlFor={id("message")}>Message <span className="enq-req" aria-hidden>*</span></label>
          <textarea id={id("message")} required maxLength={5000} value={v.message} onChange={(e) => set("message", e.target.value)} {...inv("message")} />
          {err("message")}
        </div>
        <fieldset className="enq-full">
          <legend>Preferred contact method</legend>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            {CONTACT_METHODS.map((c) => (
              <label key={c.value} className="enq-check">
                <input type="radio" name={id("contact")} checked={v.contact === c.value} onChange={() => set("contact", c.value)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="enq-full">
          <label className="enq-l" htmlFor={id("files")}>Attachments <span className="enq-hint">(PDF, DXF or images, up to 25 MB in total)</span></label>
          <input ref={fileInput} id={id("files")} type="file" multiple accept={ACCEPT_ATTR} onChange={(e) => addFiles(e.target.files)} {...inv("files")} />
          {err("files")}
          {files.length > 0 && (
            <ul className="enq-files" aria-label="Selected files">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span>{f.name} <span className="enq-hint">({fmtMB(f.size)})</span></span>
                  <button type="button" className="enq-link" aria-label={`Remove ${f.name}`}
                    onClick={() => { const n = files.filter((_, j) => j !== i); setFiles(n); setErrors((e) => ({ ...e, files: validate(v, n).files })); }}>Remove</button>
                </li>
              ))}
              <li className="enq-hint">Total {fmtMB(total)}</li>
            </ul>
          )}
        </div>
        {hasProject && (
          <label className="enq-check enq-full">
            <input type="checkbox" checked={v.shareContext} onChange={(e) => set("shareContext", e.target.checked)} />
            <span>Share my project summary with {PARTNER_NAME}
              <span className="enq-hint"> (lot, zoning, constraints findings, development type and links to generated plans). Not shared unless ticked.</span></span>
          </label>
        )}
        {/* honeypot: hidden from people and assistive tech; bots fill it */}
        <div className="enq-hp" aria-hidden="true">
          <label>Website <input type="text" tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set("website", e.target.value)} /></label>
        </div>
        <section className="enq-privacy enq-full" aria-labelledby={id("priv")}>
          <h3 id={id("priv")}>Collection notice (Privacy Act 1988 and the Australian Privacy Principles)</h3>
          <p><strong>Who collects:</strong> the operator of this platform. <strong>Why:</strong> to pass your enquiry to {PARTNER_NAME}, the platform&apos;s industry partner (a civil engineering consultancy), so it can contact you, respond to your enquiry and, if you ask, quote for engineering services. We also keep a record and may email you an acknowledgement.</p>
          <p><strong>Disclosure:</strong> your details, any files you attach and, only if you tick the option above, your project summary are disclosed to {PARTNER_NAME}. If you do not provide them we cannot send your enquiry. Our hosting and email providers may process the data on our behalf.</p>
          <p><strong>Access and correction:</strong> you can ask to access or correct your information, or complain about a privacy matter, by replying to the acknowledgement email or using the contact in our <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">Privacy Policy</a> (placeholder link: the owner to publish).</p>
          <label className="enq-check" style={{ marginTop: 8 }}>
            <input id={id("consent")} type="checkbox" required checked={v.consent} onChange={(e) => set("consent", e.target.checked)} {...inv("consent")} />
            <span>I have read the collection notice and consent to my enquiry being sent to {PARTNER_NAME}. <span className="enq-req" aria-hidden>*</span></span>
          </label>
          {err("consent")}
        </section>
      </div>
      <div className="enq-actions" style={{ marginTop: 16 }}>
        {onDone && <button type="button" className="enq-btn" onClick={onDone}>Cancel</button>}
        <button type="submit" className="enq-btn enq-btn-primary" disabled={busy}>{busy ? "Sending..." : "Send enquiry"}</button>
      </div>
    </form>
  );
}
