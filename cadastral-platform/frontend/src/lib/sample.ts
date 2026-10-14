import type { ActivityEvent, Artifact, ConstraintLayer, LotCandidate, PathwayData, PlanSheet, Requirement, RunSummary } from "./types";

/** SAMPLE DATA ONLY. Used when an endpoint from the brief (section 6.5) does not exist yet or the API is unreachable.
 *  Every surface that renders it shows a "Sample data" banner. Nothing here is a real result, and no value from here may reach production. */

const DOC = "SAMPLE: placeholder citation (not a real document)";

export const SAMPLE_LOTS: LotCandidate[] = [
  { lotplan: "2//DP227508", address: "Sample lot, Gunnedah NSW", lga: "Gunnedah", zone: "R2 Low Density Residential", area_m2: 956, jurisdiction: "NSW",
    ring: [[0, 0], [24.4, 0], [24.4, 39.2], [0, 39.2]] },
];

const L = (o: Partial<ConstraintLayer> & Pick<ConstraintLayer, "id" | "name" | "group" | "state" | "what">): ConstraintLayer => ({ source: "NSW public spatial service (sample)", data_date: "2026-10-12", ...o });
export const SAMPLE_LAYERS: ConstraintLayer[] = [
  L({ id: "flood", name: "Flood planning area", group: "Water", state: "not_affected", what: "Land the council has mapped as likely to flood in a planning-level event." }),
  L({ id: "bushfire", name: "Bushfire prone land", group: "Hazard", state: "affected", figure: "Vegetation Category 3, 38 m from lot", buffer_m: 100,
    what: "Land the RFS maps as bushfire prone because of nearby vegetation.", may_trigger: "A bushfire assessment and construction to AS 3959 may be needed.", next_step: "Ask a bushfire consultant or certifier to confirm the BAL." }),
  L({ id: "heritage", name: "Heritage item or conservation area", group: "Heritage", state: "not_affected", what: "Items and areas listed in the LEP for their heritage value." }),
  L({ id: "riparian", name: "Riparian land and watercourses", group: "Water", state: "not_affected", buffer_m: 40, what: "Creeks and rivers, with a vegetated corridor around them." }),
  L({ id: "coastal", name: "Coastal zone", group: "Water", state: "not_affected", buffer_m: 100, what: "Land close to the coast that is covered by coastal planning rules." }),
  L({ id: "biodiv", name: "Biodiversity values map", group: "Environment", state: "not_checked", what: "Land with mapped biodiversity values.", reason_not_checked: "The source did not respond when queried. This is not a clear result." }),
  L({ id: "acid", name: "Acid sulfate soils", group: "Soil", state: "not_affected", what: "Soils that release acid when disturbed or drained." }),
  L({ id: "contam", name: "Contaminated land", group: "Soil", state: "not_checked", what: "Sites known or suspected to be contaminated.", reason_not_checked: "No public layer exists for this. Ask the council for a s10.7 certificate." }),
  L({ id: "transport", name: "Transport corridor", group: "Infrastructure", state: "not_checked", buffer_m: 60, what: "Land near a railway or classified road where noise and vibration rules can apply.", reason_not_checked: "No public layer exists for this." }),
];

const R = (o: Partial<Requirement> & Pick<Requirement, "id" | "control" | "group" | "status">): Requirement => ({ ...o });
export const SAMPLE_REQUIREMENTS: Requirement[] = [
  R({ id: "front", control: "Front setback", group: "Setbacks", status: "resolved", value: 6, unit: "m", citation: { document: DOC, version: "v0", page: 12, quote: "Sample quote: the minimum front setback is 6 m." } }),
  R({ id: "side", control: "Side setback (ground floor)", group: "Setbacks", status: "resolved", value: 0.9, unit: "m", citation: { document: DOC, version: "v0", page: 12, quote: "Sample quote: the minimum side setback is 0.9 m." } }),
  R({ id: "rear", control: "Rear setback", group: "Setbacks", status: "user_confirmed", value: 3, unit: "m" }),
  R({ id: "height", control: "Maximum building height", group: "Building envelope", status: "unresolved", unresolved_reason: "No cited source found in the council documents loaded for this area.", next_step: "Enter a value you have confirmed, or upload the document." }),
  R({ id: "xover", control: "Maximum crossover width", group: "Driveway", status: "unresolved", unresolved_reason: "The council engineering standard has not been loaded.", next_step: "Upload the council engineering design specification." }),
  R({ id: "tank", control: "Rainwater tank minimum volume", group: "Water", status: "unresolved", unresolved_reason: "BASIX sets this per dwelling, and the platform does not issue BASIX.", next_step: "Ask a BASIX assessor, or enter the value from your certificate." }),
];

export const SAMPLE_PATHWAY: PathwayData = {
  cards: [
    { id: "exempt", label: "Exempt development", state: "NOT_APPLICABLE", pill: "Not applicable", failing: [] },
    { id: "cdc", label: "Complying development certificate (CDC)", state: "UNRESOLVED", pill: "Unresolved", failing: [{ criterion: "Lot is mapped as bushfire prone land; CDC criteria for this cannot be resolved from loaded sources." }] },
    { id: "da", label: "Development application (DA)", state: "ELIGIBLE", pill: "Required", failing: [] },
  ],
  compliance: [
    { id: "c1", control: "Front setback", proposed: 7.2, required: 6, unit: "m", compare: "min", status: "PASS", citation: { document: DOC, version: "v0", page: 12, quote: "Sample quote: the minimum front setback is 6 m." } },
    { id: "c2", control: "Side setback (ground floor)", proposed: 0.7, required: 0.9, unit: "m", compare: "min", status: "FAIL", citation: { document: DOC, version: "v0", page: 12, quote: "Sample quote: the minimum side setback is 0.9 m." } },
    { id: "c3", control: "Building height", status: "UNRESOLVED" },
    { id: "c4", control: "Landscaped area", status: "UNRESOLVED" },
    { id: "c5", control: "Secondary dwelling floor area", status: "NOT_APPLICABLE" },
  ],
  soee: { status: "draft", to_be_completed: 14 },
};

export const SAMPLE_SHEETS: PlanSheet[] = [
  { code: "C000", title: "Cover, index and locality" }, { code: "C100", title: "Existing site conditions" }, { code: "C101", title: "Proposed site" },
  { code: "C200", title: "Earthworks" }, { code: "C300", title: "Stormwater" }, { code: "C310", title: "Water and sewer" },
  { code: "C400", title: "Driveway and crossover plan" }, { code: "C410", title: "Driveway long section" }, { code: "C420", title: "Crossover details" },
  { code: "C500", title: "Erosion and sediment control" }, { code: "C600", title: "Typical sections and details" }, { code: "C700", title: "General notes" },
];
/** The 12 sheet codes and titles above come from the brief (section 5). */
export const SHEET_STATUS = "PRELIMINARY: NOT FOR CONSTRUCTION";

export const SAMPLE_ARTIFACTS: Artifact[] = [
  { id: "a1", kind: "planset_pdf", name: "Civil plan set", format: "PDF", status: "ready", pages: 12, bytes: 4_800_000, produced_at: "2026-10-12T02:00:00Z" },
  { id: "a2", kind: "planset_dxf", name: "Civil plan set", format: "DXF", status: "ready", bytes: 2_100_000, produced_at: "2026-10-12T02:00:00Z" },
  { id: "a3", kind: "site_report_pdf", name: "Site report", format: "PDF", status: "ready", pages: 17, bytes: 3_200_000, produced_at: "2026-10-12T02:00:00Z" },
  { id: "a4", kind: "constraints_report_pdf", name: "Constraints report", format: "PDF", status: "ready", pages: 9, bytes: 1_900_000, produced_at: "2026-10-12T02:00:00Z" },
  { id: "a5", kind: "esc_pdf", name: "Erosion and sediment control plan", format: "PDF", status: "ready", pages: 1, bytes: 900_000, produced_at: "2026-10-12T02:00:00Z" },
  { id: "a6", kind: "application_pack_zip", name: "Application pack", format: "ZIP", status: "pending", note: "Not yet produced by the API run (brief section 4.4)." },
];

export const SAMPLE_RUNS: RunSummary[] = [{ run_id: "00000000-0000-4000-8000-0000000000aa", status: "succeeded", started_at: "2026-10-12T02:00:00Z", label: "Sample run" }];
export const SAMPLE_ACTIVITY: ActivityEvent[] = [
  { at: "2026-10-12T02:03:00Z", kind: "run", text: "Run finished (sample)." },
  { at: "2026-10-12T01:58:00Z", kind: "upload", text: "Architect plan uploaded (sample)." },
  { at: "2026-10-12T01:50:00Z", kind: "terms", text: "Terms accepted (sample)." },
];
