import { describe, expect, it, vi } from "vitest";
import { canAccept, extractKeyRisks, isScrolledToEnd, needsReacceptance } from "@/lib/terms";
import { ALL_KINDS, exportEnabled, missingAcks } from "@/lib/acks";
import { ApiError, createApi, interceptError } from "@/lib/api";
import { checkFile } from "@/components/PlanUpload";

describe("terms scroll gating", () => {
  it("not at end until near the bottom", () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 400, scrollHeight: 2000 })).toBe(false);
    expect(isScrolledToEnd({ scrollTop: 1595, clientHeight: 400, scrollHeight: 2000 })).toBe(true);
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(true);
  });
  it("accept needs scroll AND tick", () => {
    expect(canAccept({ scrolledToEnd: false, ticked: true })).toBe(false);
    expect(canAccept({ scrolledToEnd: true, ticked: false })).toBe(false);
    expect(canAccept({ scrolledToEnd: true, ticked: true, busy: true })).toBe(false);
    expect(canAccept({ scrolledToEnd: true, ticked: true })).toBe(true);
  });
  it("re-acceptance on version change", () => {
    expect(needsReacceptance("v1", "v2")).toBe(true); expect(needsReacceptance("v2", "v2")).toBe(false); expect(needsReacceptance(null, "v2")).toBe(true);
  });
  it("extracts key risks", () => {
    const r = extractKeyRisks("# T\n> ## KEY RISKS SUMMARY (x)\n>\n> Guide only.\n>\n> 1. **A** one\n> 2. B two\n\nBody");
    expect(r.items).toHaveLength(2); expect(r.intro).toBe("Guide only."); expect(r.rest).toContain("Body"); expect(r.rest).not.toContain("KEY RISKS");
  });
});
describe("acknowledgement completeness", () => {
  it("has 9 kinds; export only when all present", () => {
    expect(ALL_KINDS).toHaveLength(9);
    expect(exportEnabled(ALL_KINDS.slice(0, 8))).toBe(false);
    expect(missingAcks(ALL_KINDS.slice(0, 8))).toEqual([ALL_KINDS[8]]);
    expect(exportEnabled([...ALL_KINDS, "bogus"])).toBe(true);
    expect(missingAcks([])).toHaveLength(9);
  });
});
describe("api interceptor", () => {
  it("flags only 403 TERMS_NOT_ACCEPTED", () => {
    expect(interceptError(403, { code: "TERMS_NOT_ACCEPTED", message: "m" }).redirectToTerms).toBe(true);
    expect(interceptError(403, { code: "OTHER" }).redirectToTerms).toBe(false);
    expect(interceptError(500, null).error.code).toBe("HTTP_500");
  });
  it("client redirects and throws; sends X-User-Id", async () => {
    const onTermsRequired = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: "TERMS_NOT_ACCEPTED", message: "no" }), { status: 403 })) as unknown as typeof fetch;
    const api = createApi({ baseUrl: "http://x", userId: "u1", fetchImpl, onTermsRequired });
    await expect(api.run("r")).rejects.toBeInstanceOf(ApiError);
    expect(onTermsRequired).toHaveBeenCalledOnce();
    expect(((fetchImpl as any).mock.calls[0][1].headers as Headers).get("X-User-Id")).toBe("u1");
  });
});
describe("upload checks", () => {
  it("validates type and size", () => {
    expect(checkFile({ name: "a.png", size: 5 })).toMatch(/PDF/); expect(checkFile({ name: "a.pdf", size: 201 * 1024 * 1024 })).toMatch(/200/); expect(checkFile({ name: "a.PDF", size: 5 })).toBeNull();
  });
});
