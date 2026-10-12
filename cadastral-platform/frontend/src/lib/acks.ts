export const ACK_KINDS = [
  { kind: "dbyd_physical_verification", id: "A1", text: "I acknowledge that the underground service information shown is indicative only and that, before any excavation, I must obtain current BYDA plans from the asset owners and have all services physically located (for example by potholing or other non-destructive methods), with all work health and safety responsibility remaining with me." },
  { kind: "setback_user_verification", id: "A2", text: "I acknowledge that the setbacks and planning controls shown were extracted automatically from council documents, may be wrong or out of date, and that I must verify them against the current LEP, DCP or planning scheme (including overlays and performance-based provisions) and with the relevant council before relying on them." },
  { kind: "cut_fill_indicative_only", id: "A3", text: "I acknowledge that cut and fill volumes are indicative estimates based on third-party terrain data and assumptions, and are not to be used for pricing, ordering or earthworks without independent verification by a qualified surveyor or engineer." },
  { kind: "retaining_wall_not_structural", id: "A4", text: "I acknowledge that retaining wall outputs are indicative only, are not structural or geotechnical design, rely on assumed soil and loading conditions, and that any wall over 1.0 m (and any other wall as required) must be designed by a suitably qualified engineer." },
  { kind: "crossover_not_certified", id: "A5", text: "I acknowledge that the driveway crossover check is a preliminary screening only, is not certified compliance with AS/NZS 2890.1, and that council engineering standards and approval requirements govern." },
  { kind: "cadastre_not_survey", id: "A6", text: "I acknowledge that the cadastral boundaries shown are indicative and are not a survey, and that I must obtain an identification survey from a registered surveyor before relying on boundary positions." },
  { kind: "uploaded_plan_accuracy", id: "A7", text: "I acknowledge that the alignment of my uploaded plans is only as accurate as the plans I provided, may be affected by scale, print-to-fit or mirroring errors, is not a survey set-out, and that the architect or designer remains responsible for the plans and their current revision." },
  { kind: "upload_rights_warranty", id: "A8", text: "I warrant that I have all rights, licences and consents (including client and confidentiality consents) to upload this material and to allow the Operator and its service providers, including AI providers that may be located overseas, to process it." },
  { kind: "hydrology_not_certified", id: "A9", text: "I acknowledge that the rainwater tank and hydrology outputs are indicative only, are not engineering design or certification, and that BASIX or Queensland Development Code compliance certificates and any stormwater approvals remain my responsibility." },
] as const;
export type AckKind = (typeof ACK_KINDS)[number]["kind"];
export const ALL_KINDS: AckKind[] = ACK_KINDS.map((a) => a.kind);

/** Kinds still missing from `present` (order preserved, unknown kinds ignored). */
export function missingAcks(present: Iterable<string>): AckKind[] {
  const s = new Set(present); return ALL_KINDS.filter((k) => !s.has(k));
}
export const exportEnabled = (present: Iterable<string>) => missingAcks(present).length === 0;
