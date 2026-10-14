import { describe, expect, it } from "vitest";
import { LAYER_WORDS, bufferNote, complianceStatus, effectiveRequirementStatus, layerCounts, layerProblems } from "../src/lib/status";
import type { Citation, ConstraintLayer } from "../src/lib/types";

const cite: Citation = { document: "Example DCP", page: 4, quote: "Minimum front setback 6 m" };
const layer = (o: Partial<ConstraintLayer>): ConstraintLayer => ({ id: "x", name: "X", group: "g", state: "not_affected", what: "w", source: "NSW service", ...o });

describe("layer wording", () => {
  it("never calls a screened layer clear or free of issues", () => {
    for (const w of Object.values(LAYER_WORDS)) expect(w.toLowerCase()).not.toMatch(/clear|no issues|safe|ok\b/);
  });
  it("flags a not-checked layer without a reason", () => {
    expect(layerProblems(layer({ state: "not_checked" }))).toContain("not_checked layer has no reason");
    expect(layerProblems(layer({ state: "not_checked", reason_not_checked: "Source unavailable" }))).toEqual([]);
  });
  it("counts the three states separately", () => {
    expect(layerCounts([layer({ state: "affected", figure: "f" }), layer({}), layer({ state: "not_checked", reason_not_checked: "r" }), layer({ state: "not_checked", reason_not_checked: "r" })])).toEqual({ affected: 1, not_affected: 1, not_checked: 2 });
  });
  it("states that buffer distances are not legal thresholds", () => {
    expect(bufferNote({ buffer_m: 100 })).toMatch(/100 m.*not a legal threshold/);
    expect(bufferNote({})).toBeNull();
  });
});

describe("requirements", () => {
  it("shows a value only when cited or user entered", () => {
    expect(effectiveRequirementStatus({ status: "resolved", value: 6, citation: cite })).toBe("resolved");
    expect(effectiveRequirementStatus({ status: "resolved", value: 6 })).toBe("unresolved");
    expect(effectiveRequirementStatus({ status: "user_confirmed", value: 6 })).toBe("user_confirmed");
    expect(effectiveRequirementStatus({ status: "resolved", citation: cite })).toBe("unresolved");
  });
});

describe("compliance rows", () => {
  it("passes or fails only from a numeric comparison with a cited value", () => {
    expect(complianceStatus({ status: "UNRESOLVED", proposed: 7, required: 6, compare: "min", citation: cite })).toBe("PASS");
    expect(complianceStatus({ status: "UNRESOLVED", proposed: 5, required: 6, compare: "min", citation: cite })).toBe("FAIL");
    expect(complianceStatus({ status: "UNRESOLVED", proposed: 8.5, required: 9, compare: "max", citation: cite })).toBe("PASS");
  });
  it("is UNRESOLVED without a citation, a required value or a proposed value", () => {
    expect(complianceStatus({ status: "PASS", proposed: 7, required: 6, compare: "min" })).toBe("UNRESOLVED");
    expect(complianceStatus({ status: "PASS", proposed: 7, compare: "min", citation: cite })).toBe("UNRESOLVED");
    expect(complianceStatus({ status: "PASS", required: 6, compare: "min", citation: cite })).toBe("UNRESOLVED");
  });
  it("keeps NOT_APPLICABLE", () => expect(complianceStatus({ status: "NOT_APPLICABLE" })).toBe("NOT_APPLICABLE"));
});

import { isTerminal, stageStates } from "../src/lib/runs";
const inv = (agent: string, status: string) => ({ invocation_id: agent, agent, attempt: 1, status });
describe("run stages", () => {
  it("maps agents to stages A to F", () => {
    const s = stageStates([inv("SA1", "succeeded"), inv("SA2", "running")], "running");
    expect(s.map((x) => x.state)).toEqual(["done", "running", "waiting", "waiting", "waiting", "waiting"]);
  });
  it("waits for every agent in a stage before calling it done", () => {
    expect(stageStates([inv("SA1", "succeeded"), inv("SA7", "running")], "running")[0].state).toBe("running");
  });
  it("shows a failed stage with its invocations", () => {
    const s = stageStates([inv("SA3", "failed")], "failed")[3];
    expect(s.state).toBe("failed"); expect(s.errors).toHaveLength(1);
  });
  it("holds stage F at the export gate", () => expect(stageStates([inv("SA5", "blocked_by_gate")], "blocked_by_gate")[5].state).toBe("held"));
  it("knows terminal statuses", () => { expect(isTerminal("succeeded")).toBe(true); expect(isTerminal("waiting_user")).toBe(false); });
});
