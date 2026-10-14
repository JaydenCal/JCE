import type { ProjectResults, Project } from "./api";
export const MOCK_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const mockProjects: Project[] = [
  { project_id: MOCK_PROJECT_ID, title: "Sample: 12 Example St, Hornsby", lotplan: "12/DP123456", jurisdiction: "NSW", updated_at: "2026-10-01T00:00:00Z" },
];
export const mockResults: ProjectResults = {
  lot: { lotplan: "12/DP123456", jurisdiction: "NSW", lga: "Hornsby", zone: "R2 Low Density Residential", area_m2: 702.4, frontage_m: 15.24, road: "Example Street" },
  setbacks: [
    { control: "Front setback", value_m: 6.5, citation: "Hornsby DCP 2013, Part 3.1.2, cl. 3.1.2(a)" },
    { control: "Side setback (ground)", value_m: 0.9, citation: "Hornsby DCP 2013, Part 3.1.2, cl. 3.1.2(c)" },
    { control: "Rear setback", value_m: 3.0, citation: "Hornsby DCP 2013, Part 3.1.2, cl. 3.1.2(e)" },
  ],
  driveway: { status: "pass_screening", width_m: 3.0, max_grade_pct: 12.5, design_vehicle: "B85", notes: ["Screening only; not AS/NZS 2890.1 certification."] },
  services: [
    { service: "sewer", label: "DN150 sewer main", conflict: false, detail: "Clear of proposed footprint" },
    { service: "water", label: "DN100 water main", conflict: true, detail: "Crossover passes within 0.4 m of main (buffer 1.0 m)" },
  ],
  dbyd_responses: 2,
  rwt: { tank_volume_l: 5000, diameter_m: 2.2, regime: "BASIX NSW", note: "Indicative sizing only." },
};
