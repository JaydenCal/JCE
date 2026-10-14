import type { Invocation } from "./api";
/** Stages A to F of the run graph (brief section 4.3). */
export const STAGES = [
  { key: "A", title: "Lot and zoning", detail: "Lot, boundary, roads, zoning and overlays; the architect plan is aligned if one was uploaded.", agents: ["SA1", "SA7"] },
  { key: "B", title: "Council rules", detail: "Setbacks and controls read from council documents, each with a citation.", agents: ["SA2"] },
  { key: "C", title: "Building envelope", detail: "Envelope worked out from the resolved setbacks.", agents: ["ENV"] },
  { key: "D", title: "Terrain and driveway", detail: "Cut and fill, retaining walls, crossover and driveway checks.", agents: ["SA3"] },
  { key: "E", title: "Services and water", detail: "Dial Before You Dig responses, conflicts, rainwater tank and connections.", agents: ["SA4"] },
  { key: "F", title: "Plans and 3D", detail: "Plan sheets and the 3D scene, behind the export gate.", agents: ["SA5", "SA6"] },
] as const;
export type StageState = "waiting" | "running" | "done" | "failed" | "held";
const DONE = ["succeeded", "skipped"], FAIL = ["failed", "error"];
export function stageStates(inv: Invocation[], runStatus: string): { key: string; title: string; detail: string; state: StageState; errors: Invocation[] }[] {
  return STAGES.map((s) => {
    const mine = inv.filter((i) => (s.agents as readonly string[]).includes(i.agent));
    const errors = mine.filter((i) => FAIL.includes(i.status));
    let state: StageState = "waiting";
    if (errors.length) state = "failed";
    else if (mine.length && mine.every((i) => DONE.includes(i.status))) state = "done";
    else if (mine.some((i) => i.status === "blocked_by_gate") || (s.key === "F" && runStatus === "blocked_by_gate")) state = "held";
    else if (mine.length) state = "running";
    return { key: s.key, title: s.title, detail: s.detail, state, errors };
  });
}
export const isTerminal = (s: string) => ["succeeded", "failed", "cancelled"].includes(s);
