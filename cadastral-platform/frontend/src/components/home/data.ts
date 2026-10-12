export type Dash = "dash" | "hatch";
export type Status = "Available" | "In development" | "Coming soon";
export const STEPS: { n: string; t: string; d: string; w: string; s: Status }[] = [
  { n: "01", t: "Site assessment and constraints", d: "Cadastre, zoning and mapped constraints (flood, bushfire, heritage and more) queried for the lot and marked affected, not affected or not checked, with figures. Aerial imagery is shown when available.", w: "Site assessment", s: "Available" },
  { n: "02", t: "Approval pathway", d: "Exempt, CDC or DA, shown as pathway cards with a Required, Possible or Not applicable pill for each. Reports list the triggers and next steps today. The cards are being built.", w: "Approval pathway", s: "In development" },
  { n: "03", t: "Civil plan set", d: "Site plan, driveway and swept path, services and setbacks are drawn today. Levels with floor level above flood level, a proposed erosion and sediment control plan (ESCP) and stormwater and rainwater tank sheets are in development.", w: "Civil plan set", s: "Available" },
  { n: "04", t: "Design it and walk it in 3D", d: "Orbit the lot, step inside in first person and furnish rooms from real products. Changing the design by asking the Design Assistant is in development.", w: "3D viewer", s: "Available" },
  { n: "05", t: "Compliance table and SEE", d: "Every control carries its cited source, and anything that cannot be resolved stays visible. A draft Statement of Environmental Effects is in development.", w: "Compliance", s: "Available" },
  { n: "06", t: "Application pack and export", d: "DXF and PDF export today, after nine acknowledgements. The full lodgement pack (plans, reports, checklist and index for the NSW Planning Portal) is in development.", w: "Application pack", s: "Available" },
  { n: "07", t: "Talk to an engineer", d: "JCE Infrastructure, our industry partner, for certification and engineering design of the works.", w: "Engineer", s: "Available" },
];
export const LEGEND: [string, string, string?][] = [["Lot boundary", "#1a8a2e"], ["Building envelope", "#e8222a"], ["Setback measurement", "#e8222a", "dash"], ["Driveway / crossover", "#111"], ["Driveway centreline", "#e63be6"], ["Turning path", "#e8872a"]];
export const CAPTION = "Example output for Lot 2 DP227508, Gunnedah NSW (public cadastre, illustrative only)";
