/** Engineer enquiry ("Talk to a civil engineer"): types, validation and the multipart POST /enquiries client. */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
export const CONSENT_VERSION = "enquiry-consent-2026-10-12";
export const PARTNER_NAME = "JCE Infrastructure";
export const PRIVACY_POLICY_URL = "/legal/privacy"; // placeholder: owner to publish the privacy policy at this path
export const PARTNER_STATEMENT =
  "JCE Infrastructure is an industry partner of this platform; outputs from this tool are indicative and are not engineering advice until you engage an engineer.";

export const ROLES = [
  { value: "homeowner", label: "Homeowner" }, { value: "builder", label: "Builder" }, { value: "designer", label: "Designer" },
  { value: "developer", label: "Developer" }, { value: "other", label: "Other" },
] as const;
export type EnquiryRole = (typeof ROLES)[number]["value"];

export const ENQUIRY_TYPES = [
  { value: "civil_design", label: "Civil design" },
  { value: "earthworks_retaining", label: "Earthworks and retaining" },
  { value: "driveway_stormwater", label: "Driveway / crossover and stormwater" },
  { value: "services", label: "Services: sewer, water, DBYD" },
  { value: "subdivision", label: "Subdivision" },
  { value: "flood_bushfire", label: "Flood / bushfire assessment" },
  { value: "site_plan_certification", label: "Site plan certification" },
  { value: "other", label: "Other" },
] as const;

export const CONTACT_METHODS = [{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }, { value: "either", label: "Either" }] as const;
export const TIMEFRAMES = ["As soon as possible", "Within 2 weeks", "Within 1-3 months", "Just exploring"] as const;

export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 10;
export const ALLOWED_EXT = [".pdf", ".dxf", ".png", ".jpg", ".jpeg", ".webp"];
export const ACCEPT_ATTR = ALLOWED_EXT.join(",");

/** Optional project context. `summary` (lot, zoning, constraints findings) is only sent when the user ticks the share box. */
export interface EnquiryContext {
  /** Where the enquiry was opened from (e.g. "project", "export"). */
  source?: string;
  address?: string;
  lotPlan?: string;
  developmentType?: string;
  summary?: Record<string, unknown>;
  planLinks?: string[];
}

export interface EnquiryValues {
  name: string; email: string; phone: string; company: string; role: EnquiryRole | "";
  types: string[]; address: string; lotPlan: string; message: string;
  contact: "email" | "phone" | "either"; timeframe: string; shareContext: boolean; consent: boolean; website: string;
}
/** Accepts a plain string as a shorthand for { source }. */
export const normaliseContext = (c?: EnquiryContext | string): EnquiryContext | undefined => (typeof c === "string" ? { source: c } : c);
export const emptyValues = (ctx?: EnquiryContext): EnquiryValues => ({
  name: "", email: "", phone: "", company: "", role: "", types: [], address: ctx?.address ?? "", lotPlan: ctx?.lotPlan ?? "",
  message: "", contact: "email", timeframe: "", shareContext: false, consent: false, website: "",
});

export type FieldErrors = Partial<Record<"name" | "email" | "phone" | "role" | "message" | "consent" | "files", string>>;

const EMAIL_RE = /^[A-Za-z0-9._%+\-']+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PHONE_RE = /^[0-9 +()\-.]{6,40}$/;

export function checkFiles(files: { name: string; size: number }[]): string | null {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files.`;
  let total = 0;
  for (const f of files) {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return `${f.name}: only PDF, DXF, PNG, JPG or WEBP files can be attached.`;
    if (f.size === 0) return `${f.name} is empty.`;
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) return `Attachments total ${(total / 1048576).toFixed(1)} MB; the limit is 25 MB.`;
  return null;
}

export function validate(v: EnquiryValues, files: { name: string; size: number }[] = []): FieldErrors {
  const e: FieldErrors = {};
  if (!v.name.trim()) e.name = "Enter your name.";
  if (!EMAIL_RE.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (v.phone.trim() && !PHONE_RE.test(v.phone.trim())) e.phone = "Enter a valid phone number.";
  if (v.contact === "phone" && !v.phone.trim()) e.phone = "Add a phone number, or choose email as the preferred contact.";
  if (!v.role) e.role = "Choose the option that best describes you.";
  if (!v.message.trim()) e.message = "Tell us briefly what you need.";
  else if (v.message.length > 5000) e.message = "Please keep the message under 5000 characters.";
  if (!v.consent) e.consent = "You must agree to the collection notice to send this enquiry.";
  const fe = checkFiles(files);
  if (fe) e.files = fe;
  return e;
}

export function buildContextJson(ctx: EnquiryContext | undefined, projectId: string | undefined, v: EnquiryValues): string | null {
  if (!v.shareContext || (!ctx && !projectId)) return null;
  return JSON.stringify({
    project_id: projectId ?? null, site_address: v.address || ctx?.address || null, lot_plan: v.lotPlan || ctx?.lotPlan || null,
    source: ctx?.source ?? null, development_type: ctx?.developmentType ?? null, findings: ctx?.summary ?? null, plan_links: ctx?.planLinks ?? [],
  });
}

export function buildFormData(v: EnquiryValues, files: File[], opts: { projectId?: string; context?: EnquiryContext } = {}): FormData {
  const f = new FormData();
  f.set("name", v.name.trim()); f.set("email", v.email.trim()); f.set("phone", v.phone.trim()); f.set("company", v.company.trim());
  f.set("role", v.role || "other"); v.types.forEach((t) => f.append("enquiry_types", t));
  f.set("message", v.message.trim()); f.set("address", v.address.trim()); f.set("lot_plan", v.lotPlan.trim());
  f.set("preferred_contact", v.contact); f.set("timeframe", v.timeframe);
  if (opts.projectId) f.set("project_id", opts.projectId);
  f.set("share_context", v.shareContext ? "true" : "false");
  const ctx = buildContextJson(opts.context, opts.projectId, v);
  if (ctx) f.set("context_json", ctx);
  f.set("consent", v.consent ? "true" : "false"); f.set("consent_version", CONSENT_VERSION);
  f.set("website", v.website); // honeypot
  files.forEach((file) => f.append("files", file, file.name));
  return f;
}

export class EnquiryError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) { super(message); }
}

export async function submitEnquiry(form: FormData, opts: { userId?: string; fetchImpl?: typeof fetch } = {}): Promise<{ reference: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    // No Content-Type header: the browser sets the multipart boundary.
    res = await doFetch(`${API_BASE}/enquiries`, { method: "POST", body: form, headers: opts.userId ? { "X-User-Id": opts.userId } : undefined });
  } catch {
    throw new EnquiryError(0, "NETWORK", "We could not reach the server. Check your connection and try again.");
  }
  let body: { reference?: string; code?: string; message?: string; fields?: Record<string, string> } = {};
  try { body = await res.json(); } catch { /* non-JSON error */ }
  if (!res.ok || !body.reference) {
    const friendly = res.status === 429 ? "Too many enquiries from your network. Please try again later."
      : res.status === 413 ? "Your attachments are too large (25 MB total)." : body.message || `Something went wrong (${res.status}).`;
    throw new EnquiryError(res.status, body.code ?? "ERROR", friendly, body.fields ?? {});
  }
  return { reference: body.reference };
}
