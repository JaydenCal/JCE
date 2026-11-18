# Glide Inside 3D auto grading: improvement plan

Date: 18/11/2026. Planning only, no code changed. Code read: branch claude/grading-fix, `GlideInside/pocket-architect-source`. Paths below are relative to `src/`.

## 1. Diagnosis (from the code)

- **The 3D objects read the mesh, not the design.** `planGrading` (viewer3d/grading.js) produces design levels, but every surface is draped on `surf`, the bilinear terrain grid (`S.surfaceAt`). The grid cell is 0.75 m at best and grows to about 2 m on large sites (`gridDims`, 260 cells per side). Edge quality therefore depends on cell size, which is why a 1.2 m or 1.5 cell "flat band" exists around every footprint.
- **Nearest zone wins, with no transition.** `heightAt` picks one zone (containing by rank, else nearest). Where two planes meet, the level difference lands in one mesh cell. The test `batters are a clean 1 in 3 band` allows for this with a 99.5th percentile tolerance.
- **Ties are attempted, then clamped away.** A paving cluster is one least squares plane pinned to the pad at one vertex, tied to the road at one vertex, then clamped to 1 to 5 percent. When the clamp wins, the step at the crossover remains. Nothing stops a plane falling towards a building.
- **One pad level for the whole project.** `padY = base - 0.15` is shared by every building (17 strata units on a 4 m fall sit on one level).
- **The existing road is regraded.** `corridorProfile` smooths the public road and treats it as a design zone, and `earthworks` counts that as cut and fill. The road should be a fixed constraint.
- **The corridor is one plane from footpath to far kerb.** Kerb and footpath height exists only as mesh lifts, so the verge is not at top of kerb level.
- **About twelve unrelated lifts and offsets.** Asphalt 0.025, gutter 0.015, footpath 0.04, driveway 0.04, crossover 0.072, door path 0.045, beds 0.03 (site-extras.js); `GROUND` 0.025 and paint 0.012 (pavements/view3d.js); `LIFT_M` 0.03 (pave3d.js); cars 0.06 (entourage3d.js); polygon offsets from -1 to -7. This is the source of stepped kerbs, paths and beds and the driveway kink.
- **Batters ignore the boundary.** `REACH_M = 36` lets a batter run onto neighbours and the road.
- **Gaps in inputs and outputs.** Residential ways drawn with the Road or pavement tool are not passed to `planGrading` (terrain.js passes only `deriveDriveway`). `earthworks` is returned from `addSiteTerrain` and used nowhere. Drawn roads store absolute centre lines, so they do not move with a building. `pavementModel` is rebuilt three times per scene build.

## 2. Target model

- **One finished design surface (FDS)**: a pure module with `levelAt(x, y) -> { y, elementId }`, analytic and independent of the mesh. Built from ordered design elements, solved from the fixed end inwards:
  - Existing road: held at existing levels (light smoothing for display only), excluded from earthworks. Cross section template by offset: carriageway crossfall, gutter invert, top of kerb at +150 mm, verge and footpath rising at about 2.5 percent to the boundary.
  - Crossover: ties to the gutter invert at the kerb line (layback) and to the verge level at the boundary.
  - Driveway or aisle: a profile between the boundary level and the car park or pad, with grade changes spread over a 2 m transition.
  - Car park or hardstand cluster: a plane with fall direction and percentage, solved to meet its tie edges, falling away from buildings.
  - Building pad: level at FFL less 150 mm, one per building. Apron meets the pad flush at doors.
  - Raised elements inside the lot: kerb top +150 mm above the adjacent pavement, footpath at top of kerb, landscape bed at top of kerb less 25 mm.
  - Batters: 1 in 4 default, 1 in 3 steepest, stopped at the lot boundary. Where a batter does not fit, show a retaining edge and report its height.
- **Transitions, not steps.** Along a shared edge the lower priority element blends to its neighbour over a transition width T (default 2 m): `level = own + w(d) x (neighbour - own)` with w from 1 at the edge to 0 at T. Deliberate steps (kerbs) are the only discontinuities and each has a face.
- **Everything reads the FDS.** One table (`viewer3d/levels.js`) holds every offset above the FDS: asphalt 0, concrete 0, paint +3 mm, kerb profile, bed, cars 0. Asphalt, concrete, kerbs, beds, lines, cars, forecourts and building bases call `fds.levelAt`, never `surf`.
- **Crisp edges.** The terrain grid is cut at element boundaries (cut cells): each straddled cell is split along the footprint edge and both parts take analytic FDS levels, with a vertical skirt wherever the two sides differ by more than 5 mm. The flat band is then only a 0.3 m shoulder.

## 3. Grading controls

- **Automatic**: pad level (mean ground under each pad plus 150 mm), car park fall along the natural fall within 1 to 5 percent, road and crossover ties, kerb and footpath levels, batters, retaining edges.
- **Optional for the user** (a "Grading" panel, each with an Auto reset):
  - Pad level per building, as an RL, with 50 mm nudges.
  - Car park fall direction (drag arrow) and percentage, per paved area.
  - Batter slope: 1 in 3 or 1 in 4.
  - Cut and fill heat map toggle (red cut, blue fill, legend), with cut, fill and net volumes in m3 and the deepest cut and fill.
- **Grade check, worded as indicative** ("within typical guidance", "steeper than typical guidance, check with your engineer and council"; never "compliant"). Typical AS 2890.1 style values, to be confirmed against the current standard before release:
  - Car park: 1 in 20 (5 percent) along the bays, 1 in 16 (6.25 percent) other directions; accessible bays 1 in 40.
  - Minimum fall for drainage: 1 percent.
  - Domestic driveway: 1 in 4 (25 percent) maximum; first 6 m inside a commercial boundary 1 in 20.
  - Grade change: 12.5 percent at a crest, 15 percent at a sag, per 2 m transition.

## 4. Performance

- Targets: grading plus mesh at most 150 ms on a 1 ha lot and 400 ms on 25 ha with 400 footprints (the existing budget test); terrain at most 180,000 triangles; slider drags at 10 updates per second or better.
- Approach: keep the bucket index; compute `pavementModel` once per build and pass it down; cut only straddled cells; a level only change rewrites vertex heights in place (topology unchanged) instead of a full `rebuild()`; no new dependencies (three earcut and the existing `polybool.js`).

## 5. Phases

**Phase 1. One surface, read by everything** (fixes steps, kinks, mixed offsets)
- Files: new `viewer3d/fds.js` and `viewer3d/levels.js`; `grading.js` becomes the element builder (keep `fitPlane`, `clusterPolys`, `corridorProfile`, index); `terrain.js` (per building pads, residential drawn ways passed in, existing road excluded from `earthworks`, expose `tm.fds`); `site-extras.js` `strip()`, `pavements/view3d.js` `addArea`, `addKerb`, `addPaint`, `pave3d.js`, `entourage3d.js` switch from `surf` to `fds.levelAt` plus `levels.js`.
- Invariants: level is continuous across every shared edge (difference under 5 mm) except kerb edges; grade change at most 12.5 percent per 2 m on driveways; no surface vertex below the terrain; no file other than `levels.js` contains a numeric lift; no paved plane falls towards a building face; existing tests still pass.
- Visual checks: sample lot 70 x 110 m strata U shape (17 units), warehouse, service station, house with driveway, each on the 4 m fall fixture; views Aerial, 3D, Street, plus a low oblique at the crossover and at an apron door; aerial on and off. Extend `tools/grading-shots.cjs`.
- Effort: 3 Sonnet sessions, then one review.

**Phase 2. Crisp edges and real kerbs**
- Files: `site-geom.js` (cut cell indices, skirts), `terrain.js` mesh build, `fds.js` (road cross section template, in lot raised kerb, footpath and bed elements, boundary limited batters, retaining edge), `site-extras.js` and `view3d.js` kerbs sit on the step.
- Invariants: every terrain vertex within 1 mm of `fds.levelAt`; no terrain triangle crosses an element edge; kerb and footpath tops 100 to 150 mm above the adjacent pavement, 0 at laybacks and kerb ramps; no level change outside the lot except the crossover; mesh watertight; budget tests in section 4.
- Visual checks: the same lots; kerb close ups at 2 m eye height; a 500 m lot (coarse grid) to confirm edges stay sharp; boundary batter and retaining edge on a steep narrow lot.
- Effort: 4 Sonnet sessions, then one review. Highest risk phase.

**Phase 3. Controls, cut and fill, checks**
- Files: new `ui/panel-grading.js` and commercial equivalent; model fields (`building.place.padRL`, per area `fall { dirDeg, pct }`, `lot.batter`); `viewer3d/terrain.js` heat map as vertex colours; `flow/com-logic.js` `checkSummary` and `flow/residential.js` step 4 (volumes and grade lines); `premium/exporters/planset/site.js` and `eng/siteplan.js` (heat map figure, volumes, design levels); `pavements/roads.js` (a road end snapped to a door stores the door id and is re-solved in `refreshSiteWorks`).
- Invariants: volumes match an analytic wedge within 2 percent; raising a pad 100 mm raises fill and never lowers it; Auto reset restores phase 1 output exactly; check wording never contains "compliant"; a door anchored road end stays within 50 mm of the door after a move.
- Visual checks: heat map on all four lots; step 4 card and the PDF site sheet; drag a building and confirm the road follows.
- Effort: 3 Sonnet sessions, then one review.

## 6. Risks and deferrals

- Cut cells are the main technical risk (slivers, cracks). Fallback: keep the regular grid and render the shoulder and batter ring as exact geometry over it.
- Blended transitions can conflict on small sites with short runs; report "steeper than typical guidance" instead of forcing a fit.
- The grade limits in section 3 are from memory and need checking against the standard before any wording goes live.
- Volumes are indicative: no topsoil strip, bulking or pavement boxing.
- Defer: stormwater pits and overland flow paths, vertical curves on internal roads, retaining wall design, multi level pads within one building, replacing draped pavement meshes with material groups on the terrain itself, design contours and spot level labels in 3D.
