export type Dash = "dash" | "hatch";
export const STEPS = [
  { n: "01", t: "Assess the site", d: "Cadastre, zoning, constraints and aerial in one pass. Every mapped layer is queried and marked affected, not affected or not checked.", w: "Site assessment" },
  { n: "02", t: "Design", d: "Start from a dwelling, granny flat or shed. Setbacks, site cover and height come only from rules for that development type.", w: "Development type" },
  { n: "03", t: "Civil plan", d: "Cut and fill, retaining, driveway crossover with swept path, services and rainwater tank, drawn on a titled plan sheet.", w: "Civil plan" },
  { n: "04", t: "Constraints and pathway report", d: "A report with figures for each affected layer, the likely approval pathway and the next steps. Unresolved items stay visible.", w: "Constraints report" },
  { n: "05", t: "Walk it in 3D", d: "Orbit the lot, then step inside in first person. Furnish rooms from real store products and check clearances as you go.", w: "3D viewer" },
  { n: "06", t: "Export DXF and PDF", d: "CAD-ready DXF and a printable PDF, released only after all nine acknowledgements are given.", w: "Export" },
];
export const LEGEND: [string, string, string?][] = [["Lot boundary", "#1a8a2e"], ["Building envelope", "#e8222a"], ["Setback measurement", "#e8222a", "dash"], ["Proposed slab (unverified)", "#1c2cf0"], ["Driveway / crossover", "#111"], ["Driveway centreline", "#e63be6"], ["Turning path", "#e8872a"], ["Water service", "#2a2af0"], ["Sewer service", "#1a8a2e"], ["Stormwater service", "#18d6e8"], ["Service exclusion buffer", "#e8222a", "dash"], ["Council overlay", "#a8842f", "hatch"]];
