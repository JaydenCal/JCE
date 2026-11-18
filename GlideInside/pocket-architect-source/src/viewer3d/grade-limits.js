// Typical grade limits used by the grading and the grade check. INDICATIVE ONLY: these are typical AS 2890.1 style values written from memory
// and are TO BE CONFIRMED AGAINST THE CURRENT STANDARD before any wording that quotes them goes live. They guide the design surface and the
// "within typical guidance" / "steeper than typical guidance" lines. They are not a statement that a design meets the standard.
// One place only: nothing else in the code holds a limit.
export const LIMITS = Object.freeze({
  carParkAlongBays: 0.05, // 1 in 20 along the bays
  carParkOther: 0.0625, // 1 in 16 in other directions
  accessibleBay: 0.025, // 1 in 40
  minDrainageFall: 0.01, // minimum fall for drainage
  drivewayMax: 0.25, // domestic driveway, 1 in 4
  drivewayFirstSixM: 0.05, // first 6 m inside a commercial boundary, 1 in 20
  gradeChangeCrest: 0.125, // per 2 m transition
  gradeChangeSag: 0.15, // per 2 m transition
});
export const GRADE_CHANGE_SPAN_M = 2;
// What the automatic design aims for (inside the limits above).
export const DESIGN = Object.freeze({ pavingFallMax: 0.05, pavingFallMin: 0.01, drivewayFallMax: 0.2, roadGradeMax: 0.06 });
