import { describe, expect, it, vi } from "vitest";
import {
  CONSENT_VERSION, EnquiryError, MAX_TOTAL_BYTES, buildContextJson, buildFormData, checkFiles, emptyValues, submitEnquiry, validate,
} from "@/lib/enquiry";

const good = () => ({ ...emptyValues(), name: "Jo", email: "jo@example.com", role: "builder" as const, message: "Hi", consent: true });

describe("enquiry validation", () => {
  it("accepts a minimal valid enquiry", () => expect(validate(good())).toEqual({}));
  it("requires name, email, role, message and consent", () => {
    const e = validate(emptyValues());
    expect(Object.keys(e).sort()).toEqual(["consent", "email", "message", "name", "role"]);
  });
  it("rejects bad email and phone; phone required when preferred", () => {
    expect(validate({ ...good(), email: "a@b" }).email).toBeTruthy();
    expect(validate({ ...good(), phone: "abc" }).phone).toBeTruthy();
    expect(validate({ ...good(), contact: "phone" }).phone).toBeTruthy();
    expect(validate({ ...good(), contact: "phone", phone: "0412 345 678" })).toEqual({});
  });
  it("consent is mandatory", () => expect(validate({ ...good(), consent: false }).consent).toBeTruthy());
});

describe("attachment checks", () => {
  it("allows PDF/DXF/images", () => expect(checkFiles([{ name: "a.PDF", size: 5 }, { name: "b.dxf", size: 5 }, { name: "c.jpg", size: 5 }])).toBeNull());
  it("rejects other types, empties and >25MB total", () => {
    expect(checkFiles([{ name: "a.exe", size: 5 }])).toMatch(/only PDF/);
    expect(checkFiles([{ name: "a.pdf", size: 0 }])).toMatch(/empty/);
    expect(checkFiles([{ name: "a.pdf", size: MAX_TOTAL_BYTES }, { name: "b.pdf", size: 1 }])).toMatch(/25 MB/);
  });
  it("limits file count", () => expect(checkFiles(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.pdf`, size: 1 })))).toMatch(/at most/));
});

describe("form data and context sharing", () => {
  const ctx = { address: "1 Test St", summary: { zoning: "R2" }, planLinks: ["https://x/plan.pdf"], developmentType: "dwelling_house" };
  it("only includes the project summary when the box is ticked", () => {
    expect(buildContextJson(ctx, "p1", { ...good(), shareContext: false })).toBeNull();
    const j = JSON.parse(buildContextJson(ctx, "p1", { ...good(), shareContext: true })!);
    expect(j.findings.zoning).toBe("R2");
    expect(j.plan_links).toEqual(["https://x/plan.pdf"]);
    expect(buildFormData({ ...good(), shareContext: false }, [], { projectId: "p1", context: ctx }).has("context_json")).toBe(false);
  });
  it("builds multipart with types, consent version and files", () => {
    const f = buildFormData({ ...good(), types: ["civil_design", "services"] }, [new File(["%PDF-"], "a.pdf", { type: "application/pdf" })]);
    expect(f.getAll("enquiry_types")).toEqual(["civil_design", "services"]);
    expect(f.get("consent_version")).toBe(CONSENT_VERSION);
    expect((f.get("files") as File).name).toBe("a.pdf");
    expect(f.get("website")).toBe("");
  });
});

describe("submitEnquiry", () => {
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
  it("posts multipart to /enquiries and returns the reference", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(201, { reference: "ENQ-1" }));
    const r = await submitEnquiry(new FormData(), { userId: "u1", fetchImpl });
    expect(r.reference).toBe("ENQ-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/\/enquiries$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toEqual({ "X-User-Id": "u1" });
  });
  it("maps errors", async () => {
    await expect(submitEnquiry(new FormData(), { fetchImpl: vi.fn().mockResolvedValue(res(429, { code: "RATE_LIMITED" })) })).rejects.toMatchObject({ status: 429 });
    await expect(submitEnquiry(new FormData(), { fetchImpl: vi.fn().mockRejectedValue(new Error("x")) })).rejects.toBeInstanceOf(EnquiryError);
  });
});
