# Plan set v3: sections, contours and sheet quality

Date: 18/11/2026. Branch: `claude/plansets-v3`. Code root: `GlideInside/pocket-architect-source`.
Status: planning and review only. Nothing in `src/` was changed.

Owner request: "commercial plans needs sections for all and improvements to both builder and commercial plans ... also contours to be shown on all plans".

Wording rules for all drawing text and notes written under this plan:

- The word listed in `FORBIDDEN` in `src/premium/exporters/eng/kit.js` (the c word for meeting a rule) is never used. `clean()` already rewrites it, keep every string passing through `cleanedDoc`.
- No em dashes or en dashes. Use commas, "to" or a new sentence.
- Dates are DD/MM/YYYY (`ddmmyyyy()` in `planset/frame.js`).
- No builder brand names in any generated text, sample or fixture output.
- Every sheet says the drawings are indicative concept drawings (the `CONCEPT_NOTE` footer and the `STAMP` already do, the new sheets must keep both).

---

## 1. What exists today

There are two separate PDF exporters. They do not share a frame or a sheet numbering scheme.

| Exporter | Entry | Used by | Sheets |
|---|---|---|---|
| Lot viewer plan set | `exportPlanSet()` in `src/premium/exporters/planset/index.js` | Builder lot card (`src/lotcard/lot-card.js`, kind `site` or `house`), commercial lot card (`src/commercial/lotcard.js`, kind `commercial`), `buildPdfBytes()` for commercial | Residential: C000, C100, A100 (one per level). Commercial: C000, C100, C101, C102, C103, C104 |
| Engineering style set | `toEngineeringPDF()` in `src/premium/exporters/eng/index.js` | `buildPdfBytes()` in `src/premium/exporters/index.js` for residential designs in the editor | A-001 cover, A-002 site plan, A-003.. floor plans, roof plan, elevations, section, site analysis, schedules |

Terrain data, the same source for both:

- `project.site.lot.terrain = { cols, rows, cellMm, x0, y0, values }`, plan millimetres, row 0 at the north edge, values in metres RL. Built by `buildTerrain()` in `src/site/model.js` from the `/api/site/contours` response (`server/lib/site.js` `buildContours()`), which samples the state 5 m DEM.
- `project.site.lot.contours = [{ level, major, closed, pts: [x0, y0, x1, y1, ...] }]`, made on the server by `contourLines(grid, { minor, major })` in `src/site/contours.js` (marching squares, default minor 0.5 m, major 2.5 m). `lot.contourInterval` holds the interval used.
- Point lookup: `terrainAt(lot.terrain, x, y)` in `src/site/model.js`, and `groundLevelFn(lot)` in `planset/contours.js`.
- Floor level: `lot.floorRL` (residential, `defaultFloorRL()` is the centroid RL plus 0.15 m). For commercial `lot.floorRL` is normally null and the 3D uses `terrainModel(project)` in `src/viewer3d/terrain.js`, which returns `{ heightAt, rawAt, grading, floorRL, base, padY }`. `grading` comes from `planGrading()` in `src/viewer3d/grading.js`: one flat pad per building outline, graded paving zones, 1 in 3 batters back to natural ground. Checked in Node on 18/11/2026: `terrainModel()` runs headless for commercial projects and returns a `floorRL` and a graded `heightAt`.
- Design surface RL at a plan point: `rl = heightAt(x, y) - base + floorRL`. Natural RL: `rawAt(x, y) - base + floorRL` (equal to `terrainAt`).

Samples generated for this review (all in the scratchpad, see section 9):

- Residential lot viewer set, wide lot: 3 sheets.
- Commercial sets for warehouse plus showroom, warehouse, service station, office, retail strip, community facility (childcare or medical), strata units, self storage, mixed use, drive through, townhouse row and open canopy, each on a 60 m by 100 m lot with a synthetic terrain grid (3 m fall).
- Engineering style residential set (9 sheets).

---

## 2. Diagnosis

### 2.1 Commercial set

**C104 ELEVATIONS (the owner screenshot).** `drawElevations()` in `planset/commercial-elevations.js`.

- Only the street facade is drawn (`elevationFacades()` keeps walls whose outward normal is the building front). One building gives one small strip at the top of the sheet and about 75 percent of the sheet is blank. This is exactly the owner screenshot (mixed use building, sheet 6 of 6).
- Only the ground level is drawn: `elevationFacades()` reads `project.levels?.[0]` and nothing else. The mixed use type has four levels (0, 3600, 7200, 10800), the office and duplex two, the townhouse and terrace rows three. All of them are drawn as a single storey strip. This is wrong, not only sparse.
- Catalogue props are missing. The fuel canopy, pump islands, awnings, dock canopies and other boxes returned by `def.view3d(params, { place })` (`boxes` for `_kit.js` types, `items` for `_kitB.js` types and the warehouse) never reach the elevation. The service station elevation shows the kiosk only.
- The open canopy type is drawn as a solid clad wall 4.5 m high.
- Service station: the two shopfront windows run past the right end of the wall. `_kit.js` `materialise()` passes `op.offset` straight to `S.createOpening()`, but the model treats `offset` as the opening centre while several `_kit.js` type specs write it as the left edge (for example `offset: W / 2 - 500` for a 1000 mm rear door). To be confirmed against the 3D before changing: it looks like a data bug in `_kit.js` or in those type specs, and it needs an owner decision because it moves openings in the 3D model as well.
- The ground line is a flat hatch line at an assumed `DATUM_RL = 100`. The terrain is never used even when the lot has it.
- The scale comes from a fixed list and a grid of cells sized for the worst facade, so drawings sit small in the top left of each cell. There is no scale bar and no view title under the drawing.
- Text sizes are below what can be read on an A3 print: 3.8 pt panel marks, 4.4 pt signage, 4.8 pt datum note, 5.4 pt level tags.
- The roof over the wall is a flat block or a triangle guessed from `roofRise()`. A gable seen side on is a single dashed line.

**Sections.** There are none in the commercial set. `eng/views.js` has `sectionPlane()`, `sectionCut()` and `drawSection()` but only the engineering style residential set calls them, and only for one cut across the short axis.

**C100 EXISTING SITE.** `drawExisting()` calls `drawSite()` in `planset/site.js`.

- Contours are drawn only from `lot.contours`, and `contourLines()` in `planset/contours.js` throws away every level that is not a whole metre. A commercial lot with less than 1 m of fall shows no contour at all. In the samples (terrain grid present, 3 m fall, no stored contour list) the sheet showed four spot levels and no contour lines.
- `existingLegend()` always lists "Contour (minor, major)" even when the data row says "Ground levels: None for this lot".

**C101 PROPOSED LAYOUT.** `drawLayout()` in `planset/commercial.js`.

- No contours and no levels of any kind, although the OSD placeholder is placed with `groundLevelFn()` and its label says "AT THE LOWEST GROUND (INDICATIVE LEVELS)".
- At 1:400 to 1:750 most labels are 3 to 4.5 pt (pump island names, canopy sizes, dock labels, bay counts). They cannot be read on paper.
- Buildings have no overall dimensions and no FFL tag. Only two boundary offsets are dimensioned.
- No section cut markers (there are no sections to point to).

**C102 MEZZANINE LEVEL PLAN.** `drawMezzanine()`.

- The sheet is always issued. With no mezzanine it is a blank page with a legend ("Units with a mezzanine 0 of 0").
- Upper storeys of multi storey catalogue buildings (office level 1, homes above shops) have no plan at all.

**C103 YIELD SUMMARY.** Dense but readable. The body text is 6.2 to 6.8 pt, footnotes smaller. An empty "BOLLARD SCHEDULE (INDICATIVE)" table is printed with a zero total. It sits between the layout and the elevations, which splits the drawings.

**C000 COVER.** The "PROPOSED LAYOUT (OUTLINE)" box was empty for the warehouse plus showroom sample (`coverThumbnail()`), and the locality plan labels overlap ("SAMPLE" clipped behind the lot).

**Title strip (`drawStrip()` in `planset/frame.js`).**

- Field labels are about 4 pt. Notes are about 5.5 pt.
- There is an empty band of 40 to 60 mm between the legend and the revision table on most sheets while the drawing area is crowded.
- No original size check bar, no level datum field, no status field. Scale bar and north point are drawn only by the plan sheets, each in its own place.

### 2.2 Builder (residential) lot viewer set

- Three sheets only: C000, C100 SITE PLAN, A100 HOUSE PLAN. No elevations, no section, no roof plan, although the same project gets all of them from `toEngineeringPDF()`.
- C100: contours only at whole metres (same filter as above), so most suburban lots show one or two lines or none. The sample with no ground data prints "No ground levels for this lot" which is correct.
- A100: no site context, no contours, no section marker. Dimension text is about 5 pt.
- Sample tooling: `tools/siteplan-shots.mjs` loads a named builder's house file from `golive/builder-houses/`, so the sample project title carries a brand name. Review samples should use the generic designs.

### 2.3 Engineering style residential set

- A-002 site plan: contours at 1.0 m only (`eng/siteplan.js` line 273 to 274 repeats the whole metre filter).
- Floor plans, roof plan and site analysis: no contours.
- A-006: four elevations in a 2 by 2 grid, each drawing uses about a third of its cell.
- A-007: one section across the short axis. No long axis section.
- Different frame (title block along the bottom, `eng/frame.js`) and different drawing numbers (`GI-<code>-A-001`) from the lot viewer set (`GI-<code>-C100`).

---

## 3. Target sheet lists

### 3.1 Commercial

Ids stay as the keys used by `index.js`. Codes are regrouped so drawings read in order and the yield summary closes the set.

| Code | Id | Title | When issued |
|---|---|---|---|
| C000 | cover | COVER SHEET AND DRAWING INDEX | Always |
| C100 | existing | EXISTING SITE AND LEVELS | Always |
| C101 | layout | PROPOSED LAYOUT | Always |
| C102 | levels | LEVELS AND GRADING PLAN (INDICATIVE) | When `hasGround(lot)` |
| C110, C111.. | upper | UPPER LEVEL PLANS (mezzanines and upper storeys) | Only when a mezzanine or an upper level exists |
| C200, C201.. | elev | ELEVATIONS, one sheet per building or strata row group | Always when there is a building or row |
| C300, C301.. | sect | SECTIONS, one sheet per building or strata row group | Always when there is a building or row |
| C900 | yield | YIELD SUMMARY AND SCHEDULES | Always |

Notes:

- `COMMERCIAL_SHEET_LIST` in `src/commercial/sheet-list.js` becomes the list of sheet families (what is sold). `commercialSheetPlan()` expands it to the real pages for the project. `sheetListText()` already joins codes, check its output reads "C000, C100 to C102, C110, C200, C300 and C900" or similar and that the billing copy in `src/premium/ui/commercial-billing.js`, `src/premium/ui/topbar.js` and `src/commercial/lotcard.js` still makes sense.
- Fallback if the owner wants codes left alone: keep C100 to C104 and append C105 SECTIONS and C106 LEVELS AND GRADING. The drawing work below is the same either way.

### 3.2 Builder lot viewer set (kind `site`)

| Code | Title |
|---|---|
| C000 | COVER SHEET AND DRAWING INDEX |
| C100 | SITE PLAN (contours, spot levels, FFL) |
| A100.. | FLOOR PLANS (contours outside the walls, section markers) |
| A200 | ELEVATIONS (four, from `eng/views.js`) |
| A300 | SECTIONS A-A and B-B (from `eng/views.js`) |

Kind `house` (no lot): C000, A100.., A200, A300 with no ground data and the assumed datum note.

### 3.3 Engineering style set

Same sheets as now, with contours on every plan sheet and a second section (B-B, long axis) on the section sheet.

---

## 4. Spec: levels and contours on all plan sheets

### 4.1 One levels model

New file `src/premium/exporters/planset/levels.js`:

```js
/** Everything the sheets need about ground and floor levels, or { has: false } with the assumed datum. */
export function levelsModel(project, lot)
// -> { has, source: 'dem' | 'assumed', datumNote,
//      natural(p) -> RL m | null,         // terrainAt(lot.terrain, p.x, p.y), else groundLevelFn(lot)
//      design(p)  -> RL m | null,         // terrainModel(project): heightAt - base + floorRL; equals natural() when there is no grading
//      floorRL,                           // lot.floorRL if finite, else terrainModel(project).floorRL, else 100 (assumed)
//      fflOf(key) -> RL m,                // per building or strata row, see below
//      reliefM, minRL, maxRL }            // natural surface over the lot boundary bbox plus 5 m
```

- `fflOf(key)`: design surface RL at the centroid of the building outline (or row polygon) plus 0.15 m slab. The implementer must first confirm from `planGrading()` zones that each pad sits at this level in the 3D (`padY` is `base - 0.15`), and write the test in 7.2 so the drawing and the 3D can never disagree.
- With no terrain: `has` false, `floorRL` 100, every tag reads "RL 100.00 FFL (ASSUMED DATUM)" as today. No ground profile is invented: the ground line is drawn level at 150 mm below FFL.
- `terrainModel()` is imported lazily (`await import('../../../viewer3d/terrain.js')`) inside `exportPlanSet()` before the sheet loop, so the browser bundle and the synchronous draw functions are unchanged. Pass the result in `cmodel.levels` and to `drawSite()` through its options.

### 4.2 Contour interval

Replace the whole metre filter in `planset/contours.js` `contourLines()` and in `eng/siteplan.js` (line 273 to 274). Contours are regenerated in the exporter from `lot.terrain`, so the interval no longer depends on what the server stored.

```js
export function chooseInterval(reliefM)   // -> { minor, major, decimals }
```

| Relief across the view | Minor | Major | Label |
|---|---|---|---|
| under 1.5 m | 0.25 m | 1.0 m | 2 decimals |
| 1.5 m to under 5 m | 0.5 m | 2.0 m | 1 decimal |
| 5 m to under 15 m | 1.0 m | 5.0 m | 1 decimal |
| 15 m and over | 2.0 m | 10.0 m | whole metres |

- If the chosen interval gives more than 40 contour lines inside the viewport, step up one row.
- If it gives none (dead flat ground), print no lines, keep the spot levels and add the note "Ground is near level, no contour crosses the site at 0.25 m."

```js
export function terrainContours(lot, { minor, major })     // existing ground
export function surfaceContours(fn, bbox, { minor, major, cellMm = 1000 })   // any RL function, for the design surface
```

- `terrainContours()` adapts `lot.terrain` to the grid of `src/site/contours.js` (`{ cols, rows, cell: cellMm, x0, y0: -terrain.y0, values }`, then flip y of each output point back to plan y) and calls `contourLines()` and `fillGaps()` from that module. Output shape stays `[{ level, major, pts: [{x, y}] }]` so `prepareContours()`, `strokeContours()` and `placeContourLabels()` keep working.
- Fallback when a lot has `contours` but no `terrain` (older projects): use the stored list, unfiltered.
- `surfaceContours()` samples `levels.design` on a 1 m grid over the lot bbox plus 5 m (cap at 300 by 300 nodes, raise `cellMm` to stay under it).

### 4.3 Line work and labels

| Item | Pen | Notes |
|---|---|---|
| Existing minor | 0.12 mm, `PEN.contourMinor`, dash `[2.2, 1.0]` | Dashed so existing and design never share a convention |
| Existing major | 0.26 mm, `PEN.contourMajor`, dash `[4.5, 1.2]` | Labelled |
| Design minor | 0.13 mm, solid, dark teal `[11, 122, 133]` | Only inside the lot, only where design differs from existing by more than 50 mm |
| Design major | 0.28 mm, solid, dark teal | Labelled |
| Spot level, existing | Cross 1.8 mm, text 5.6 pt, grey blue | Lot corners (`cornersOf()`), as now |
| Spot level, design | Filled dot, text 5.6 pt bold, teal, prefix "FSL" | Pavement corners, crossover, OSD low point |
| FFL tag | Boxed, 6.5 pt bold | One per building or row: "FFL 103.25" or "FFL 100.00 (ASSUMED)" |

- Labels along major lines use `placeContourLabels()` (extend `txt` to use `decimals`). Minor lines are labelled only when no major line reaches the view (already the behaviour).
- Contours are masked under buildings, labels and dimension text through `strokeContours(doc, lines, rect, masks)`. Reuse the page stream trick in `drawSite()` (stroke last, splice back to `contourMark`) in `drawLayout()` so contours sit under all other linework.
- Legend entries appear only when the thing is on the sheet. `legendBlock({ contours })` and `existingLegend()` take `contours: levels.has && lines.length > 0`.
- Every sheet with levels carries: "Levels are indicative, interpolated from the 5 m state elevation model, not survey. Contours at X m are an interpolation and show the fall only. A registered surveyor must confirm levels." The interval goes in the data block: "Contours: 0.25 m minor, 1.0 m major".

### 4.4 Which sheets

"All plans" means every sheet with a to scale plan view of the site. The cover locality plan (1:2500 and smaller) and the schedule sheets are excluded.

| Sheet | Function to change | Shows |
|---|---|---|
| Commercial C100 | `drawExisting()` via `drawSite()` | Existing contours, spot levels at lot corners |
| Commercial C101 | `drawLayout()` | Existing contours (light), FFL tag per building or row, section markers |
| Commercial C102 (new) | `drawLevelsPlan()` in new `planset/commercial-levels.js` | Existing dashed and design solid contours, FFL tags, FSL spots, fall arrows on paving (`grading.zones`), batter extents, indicative cut and fill from `earthworks()`, OSD low point |
| Commercial C110 upper levels | `drawMezzanine()` | Existing contours outside the building outline only, light |
| Residential C100 | `drawSite()` | Existing contours at the chosen interval, spot levels, FFL tag at the house |
| Residential A100 ground floor | `drawHouseSheet()` | Existing contours outside the external walls and outside the dimension strings, lot boundary where it falls in view. Needs the plan to sheet transform composed with the alignment used by `alignProject()` (the engineering set already passes `ctx.unalign`, do the same) |
| Engineering A-002, floor plans, roof plan, site analysis | `drawSitePlan()`, floor plan drawing in `eng/index.js`, `drawRoofPlan()`, `drawAnalysis()` | Same contour helper and interval |

Put the shared drawing step in one helper so no sheet does its own version:

```js
// planset/contours.js
export function drawGroundLayer(doc, { lot, levels, S, rect, field, masks, design = false, spots = [] })
// returns { lines, interval, note, legend: [...] }
```

---

## 5. Spec: commercial elevations that fill the sheet

Keep the analytic facade drawing (panel joints, coursing, cladding ribs are worth keeping) and generalise it.

### 5.1 Four sides, all storeys

- `elevationFacades(project)` becomes `buildingFacades(project, target)` returning the four sides of a target: `front`, `rear`, `left`, `right` (viewed from outside, named by compass with `compassOf()` from `eng/views.js`, for example "B1 NORTH ELEVATION (STREET)").
- For each side collect the exterior walls of **every** level of that building: `project.levels.flatMap(level => level.walls.filter(w => w.building === b.id && w.kind === 'exterior' && w.outside))`, matched by outward normal as now, each drawn at `level.elevation`. Strata rows: front (roller door side), rear and one end wall, from the row polygon.
- Floor lines: a thin line at each upper level elevation with a tag "FFL LEVEL 1 RL 106.85".

### 5.2 What else is drawn

- Roof: use the real roof from `roofsOf(b, project)` (`type`, `pitchDeg`, `baseMm`, `ridge`, `fall`, `overhangMm`). Gable end as a triangle, gable side as the eave to ridge slope face with sheet ribs, skillion from the high or low side, parapet hiding the roof with the roof line dashed behind it.
- Props: new helper `buildingProps(b)` in `src/commercial/catalogue/planset.js` that normalises `b.def.view3d(b.params, { place: b.place })` to `[{ x0, x1, y0, y1, z0, z1, slot }]` in building local millimetres (`boxes` as is, `items` with `shape === 'box'` as is, cylinders as their bounding box). Project each box onto the elevation: canopies as an outlined fascia with columns, pump islands and plinths at ground, awnings as a projecting line with a shadow tone. Draw props in front of the wall when nearer the viewer and lighter (0.1 mm, grey) when behind.
- Open sided types (canopy, lean to carport, fuel canopy): when a type has no exterior wall on a side, draw columns and the roof edge only. Never fill a wall that is not in the model.
- Ground line: natural surface dashed (`levels.natural` sampled every 2 m along the facade line, 600 mm outside the wall) and finished surface solid with a ground hatch (`levels.design`). Ground RL tags at both ends.
- Level tags at the right: FFL, each upper FFL, EAVE, TOP OF PARAPET or RIDGE, with RLs from `levels.fflOf(key)`. Overall height dimension string and overall length string, plus an opening width string for roller doors over 3 m.
- Material tags with leaders: wall system from `constructionLine()`, roof sheeting, glazing, roller doors.
- View title under each drawing with the scale, scale bar on the sheet.

### 5.3 Layout

- One sheet per target, four elevations in a 2 by 2 grid (`cell` from the viewport, like `elevationLayout()` in `eng/views.js`), front and rear on top, the two sides below.
- Scale: the largest of 1:50, 1:100, 1:200, 1:250, 1:500 at which all four fit their cells. Each drawing is centred in its cell.
- Small targets share a sheet: pack targets while each still gets a full row (two targets per sheet at most).
- Acceptance: the union of the drawn elevation bounding boxes covers at least 45 percent of the viewport area on every elevation sheet.

---

## 6. Spec: sections for every commercial building type

### 6.1 Targets and cuts

New file `src/premium/exporters/planset/commercial-sections.js`.

```js
export function sectionTargets(project)
// -> [{ key, kind: 'building' | 'row', label, frame: { o, u, v }, lengthMm, widthMm, outline, building?, row? }]
```

- Catalogue buildings: every entry of `buildingsOf(project.commercial)`. `u` is along the frontage (`b.frame.u`), `v` into the lot. Length and width from the outline in that frame.
- Strata rows: every row of `project.commercial.rows` using `rowFrame()`, `rowLength()` and `row.unit.depthMm` from `src/commercial/layout.js`. A mirrored pair is one target (both rows and the common wall in the cross section).
- Every type in `TYPES` (`src/commercial/catalogue/types/index.js`, 33 types on 18/11/2026) must produce at least one section. No type list is hard coded.

```js
export function sectionPlanes(target, project)
// -> [{ id: 'A', normal, c, right, label: 'SECTION A-A', note }, { id: 'B', ... }]
```

- Section A: across the short axis (the cut line runs along the short dimension), looking toward the left end.
- Section B: along the long axis, looking toward the rear.
- Both are issued when the footprint is at least 6 m in both directions. Smaller footprints (kiosk, single garage, amenities block) get section A only.
- Cut position, in order of preference: through a mezzanine or upper floor if one exists, through the largest roller or dock door, through a canopy prop, otherwise the centre. Then nudge by up to 1.2 m so the plane does not run along an interior wall (within 300 mm of parallel) or through a column prop.
- Strata rows: A is through one typical unit front to back (through the roller door, the ground office and the mezzanine), B is along the row through the first three units, with a break line and "UNITS 4 TO 8 SIMILAR".
- Letters run through the set: building B1 has A-A and B-B, building B2 has C-C and D-D.

### 6.2 Cut model (analytic, testable without a PDF)

```js
export function sectionModel(project, target, plane, levels)
// -> { extent: { s0, s1, z0, z1 },            // mm along the cut and mm above this target's FFL
//      ground: { natural: [{ s, z }], design: [{ s, z }] },
//      floors: [{ name, z, s0, s1, slabMm, rl }],
//      walls: [{ s0, s1, z0, z1, kind: 'exterior' | 'interior', system, openings: [{ z0, z1, kind }] }],
//      ceilings: [{ s0, s1, z }],
//      roof: { type, pitchDeg, profile: [{ s, z }], sheetMm, parapets: [{ s, z0, z1 }] , ridgeZ, eaveZ },
//      props: [{ s0, s1, z0, z1, slot, cut: boolean }],
//      beyond: [{ s0, s1, z0, z1, kind }],    // openings and walls seen in elevation behind the cut
//      tags: [{ z, text }], dims: [...] }
```

Sources:

- Levels: every `project.levels` entry that has a wall tagged with this building (`w.building === b.id`), with `elevation` and `height`. Rows: ground plus the mezzanine from `row.unit.mezzanine` (`levelMm`, `depthMm`, `slabMm`, `position`).
- Walls: intersect the plane with `G.wallPolygon(w)` exactly as `crossings()` and `sectionCut()` do in `eng/views.js`. Export `crossings` from there and reuse it, or lift `sectionCut()` to accept `{ wallFilter, sRange }` so it can be limited to one building. Height from `w.height` or the level height.
- Openings in a cut wall: an opening whose span contains the cut point gives a void from sill to head with a lintel above. Openings on walls behind the plane go to `beyond`.
- Floors: ground slab 150 mm between the outermost exterior wall crossings. Upper floors 300 mm wherever a room polygon of that level crosses the plane, so a mezzanine comes out as a partial floor with its balustrade (1000 mm, from the mezzanine notes).
- Roof: analytic from `roofsOf(b, project)`: polygon, `type`, `pitchDeg`, `baseMm`, `ridge`, `fall`, `overhangMm`. A gable cut across the ridge is two slopes to the ridge, cut along the ridge is a level line at the ridge with the eave line beyond. Skillion as a single slope or a level line by direction. Flat at 2 degrees. Parapet height from `constructionSpec(b.params).parapetMm`. Rows: `row.unit.roof` and 3 degrees toward the rear, as `elevationFacades()` assumes today.
- Props: `buildingProps(b)` from 5.2, cut when the plane passes through the box, otherwise in `beyond` when it is on the viewing side.
- Ground: `levels.natural` and `levels.design` sampled every 1 m along the cut from 6 m before the building to 6 m past it, relative to this target's FFL. Rows and site sections can extend to the lot boundary (see 6.4).

### 6.3 Drawing

```js
export function drawSections(doc, model, sheetTargets)   // one sheet: returns { kv, notes, blocks }
```

- Layout: section A on the top half and section B on the bottom half of the viewport (or side by side when both are narrower than tall). Largest common scale from 1:50, 1:100, 1:200, 1:250. Acceptance: drawn bounds cover at least 45 percent of the viewport.
- Pens: cut elements 0.5 mm outline, elements beyond 0.13 mm, ground line 0.5 mm, natural surface 0.18 mm dashed and labelled "NATURAL SURFACE (INDICATIVE)", finished surface labelled "FINISHED SURFACE (INDICATIVE)".
- Hatches for cut material, using `hatch()` and `HATCH` in `eng/kit.js` (add entries where missing):

| Material | Hatch |
|---|---|
| Concrete slab, tilt up and precast panel | Solid light grey with dot stipple |
| Blockwork | Diagonal pair at 45 degrees |
| Metal clad wall and roof sheeting | Single heavy line with a thin parallel line (girt or purlin zone 200 mm) |
| Framed wall and partition | Single diagonal at 45 degrees, wide spacing |
| Fill | Dotted, between natural and finished surface where finished is higher |
| Cut | Light diagonal, where finished is lower |
| Earth | Short ground ticks below the finished surface |
| Canopy and steel props | Solid dark grey |

- Level tags down the left with RLs: FFL GROUND, FFL each upper level or MEZZANINE, UNDERSIDE OF CEILING where a ceiling exists, EAVE or SPRINGING, TOP OF PARAPET, RIDGE. Format "FFL GROUND RL 103.25". With no terrain: "RL 100.00 (ASSUMED DATUM)".
- Dimension strings (use `dimLine()` from `eng/kit.js`): overall width along the bottom, internal clear spans between cut walls on a second string, floor to floor and floor to eave heights up the right, clear height under a mezzanine, roller door clear opening height where cut, roof pitch as text along the slope.
- Space labels inside the section from the room names the plane passes through ("WAREHOUSE", "OFFICE", "MEZZANINE OFFICE", "FUEL CANOPY").
- View title "SECTION A-A  1:100 @ A3" under each drawing and a small key plan (building outline with the cut line and arrows) at the right of the title.
- Section markers on C101 and on the upper level plans: reuse `drawSectionMarker()` and `sectionLinePlan()` from `eng/views.js`, generalised to take a plane and a letter, with the sheet code ("SEE C300").
- Notes on every section sheet: "Indicative concept section. Structure, footings, slab thickness, roof framing and levels are assumed for presentation and are not designed. To be designed and checked by suitably qualified persons." No member sizes are stated beyond the nominal slab and wall thicknesses already in the model.

### 6.4 Optional site section (phase 6)

One long section through the lot from the street centreline to the rear boundary through the main building: road, kerb, verge, boundary, paving falls, building, rear boundary, at a vertical exaggeration of 1 (no exaggeration). It makes the grading readable for a client. Drawn on C102 under the plan.

---

## 7. Improvements to both sets

### 7.1 Sheet furniture and consistency

- **Title strip (`planset/frame.js`).** Raise field labels to 5 pt and notes to 6 pt. Add fields: STATUS ("CONCEPT"), LEVEL DATUM ("AHD, indicative from 5 m DEM" or "Assumed RL 100.00"), ORIGINAL SIZE A3. Let the notes and legend blocks flow into the empty band above the revision table (compute the free height instead of fixed block heights) so long legends stop crowding. Add a 100 mm check bar ("0 to 100 mm when printed at A3") at the foot of the drawing area.
- **Scale bar and north point.** One helper pair for all plan sheets (`northAndScale()` in `commercial.js` and the copies in `site.js` and `house.js` become one export in `planset/frame.js`), always bottom left for the bar and top right for north, with the bar length chosen so its end value is a round number. Elevation and section sheets get the scale bar, no north point.
- **View titles.** Every drawing has a title under it: name, scale, underline (`viewTitle()` in `eng/kit.js`).
- **Text height.** Nothing under 5.5 pt on a paid set. On C101 replace tiny in place labels with numbered key tags and a key table in the strip when a label cannot be set at 5.5 pt (pump islands, canopies, dock labels).
- **Line weights.** One table in `eng/kit.js` (`PEN_W`): boundary 0.6, cut 0.5, building outline 0.35, secondary 0.25, kerb 0.25, dimension and hatch 0.13, contour as 4.3. Remove the literal widths scattered through `commercial.js` and `commercial-elevations.js` as files are touched.
- **Legends.** Built from what was drawn (each draw function returns the legend keys it used) so a legend never lists an absent item.
- **Dimensions.** C101: overall building length and width, offsets to all boundaries from the nearest building face (not two only), aisle and apron widths, crossover width. Residential C100 already has boundary offsets, add the house overall size.
- **Schedules.** C900: drop empty tables (bollards with zero), add a drawing index repeat and a building levels table (building, FFL RL, eave RL, top RL, storeys). Residential: add the window and door schedule from `drawSchedules()` in `eng/sheets.js` as an optional last sheet later.
- **Page numbering.** "SHEET n of N" stays. The cover index, `planSetSheets()` and the page count must come from one list (they do, keep it so with the dynamic sheets). Drawing numbers stay `GI-<job>-<code>`.
- **Empty sheets.** A sheet with nothing to draw is not issued (mezzanine sheet with no mezzanine). Where a sheet is fixed by the family list but empty, it must not exist rather than carry a message.
- **Cover.** Fix the empty layout thumbnail (`coverThumbnail()`), add a 3D or elevation image slot later, keep the locality plan labels clear of the lot.
- **Preview.** `withoutScales()` regex must cover the new scale strings in view titles ("1:100 @ A3").

### 7.2 Builder set specifics

- Add A200 ELEVATIONS and A300 SECTIONS to `planSetSheets()` and the sheet loop in `planset/index.js` by calling `collectTriangles()`, `drawElevations()` and `drawSection()` from `eng/views.js` with `area` set to the lot viewer drawing area (`AREA` from `planset/frame.js` less margins). `collectTriangles()` is async and loads the 3D builder, so collect once before the sheet loop.
- Make the elevation drawings larger: in `elevationLayout()` (`eng/views.js`) choose the scale per sheet from the cell less the margins and add 1:75 and 1:125 to `SCALES`, so each drawing uses most of its cell.
- Second section: `sectionPlane(project, axis = 'short' | 'long')`, `drawSection()` takes the plane and a letter. Section sheet shows A-A (short axis) on top and B-B (long axis) below, or two sheets when the house is over 20 m long at 1:50.
- Ground lines on residential elevations and sections already come from `groundProfile()`. Add the finished surface from `levelsModel().design` beside the natural surface.

---

## 8. File by file change list

| File | Change |
|---|---|
| `src/premium/exporters/planset/levels.js` (new) | `levelsModel()`, `fflOf()`, relief, RL formatters (`rlText(rl, decimals)`) |
| `src/premium/exporters/planset/contours.js` | `chooseInterval()`, `terrainContours()`, `surfaceContours()`, `drawGroundLayer()`. Remove the whole metre filter in `contourLines()`. `placeContourLabels()` takes `decimals`. Dash patterns for existing lines in `strokeContours()` |
| `src/premium/exporters/planset/site.js` | `drawSite()` uses `drawGroundLayer()`, takes `levels`, FFL tag at the house. `legendBlock()` driven by what was drawn |
| `src/premium/exporters/planset/house.js` | `drawHouseSheet()` draws contours outside the walls, lot boundary in view, section markers |
| `src/premium/exporters/planset/commercial.js` | `commercialModel()` carries `levels`. `drawLayout()` draws the ground layer, FFL tags, more dimensions, section markers, key tags for small labels. `drawExisting()` and `existingLegend()` fixed. `drawMezzanine()` becomes upper level plans and is skipped when empty. `commercialSheetPlan()` builds the dynamic list. `coverThumbnail()` fix. `drawYield()` drops empty tables, adds the levels table |
| `src/premium/exporters/planset/commercial-levels.js` (new) | `drawLevelsPlan()` for C102 |
| `src/premium/exporters/planset/commercial-elevations.js` | `buildingFacades()` (four sides, all levels), real roof, props, terrain ground line, level tags from `levels`, 2 by 2 layout per target, text sizes, `drawElevations(doc, model, targets)` per sheet |
| `src/premium/exporters/planset/commercial-sections.js` (new) | `sectionTargets()`, `sectionPlanes()`, `sectionModel()`, `drawSections()` |
| `src/premium/exporters/planset/index.js` | Await `terrainModel` and (residential) `collectTriangles` before the loop. Dispatch the new sheet ids (`levels`, `upper`, `elev` and `sect` with a target index). Residential A200 and A300. Extend `noScaleText` |
| `src/premium/exporters/planset/frame.js` | Strip fields, flowing notes and legend, check bar, shared `scaleBar()` and `northPoint()` placement |
| `src/premium/exporters/planset/cover.js` | Index handles the longer list (two columns over 12 rows), thumbnail fallback |
| `src/premium/exporters/eng/views.js` | Export `crossings`. `sectionPlane()` and `drawSection()` take an axis and letter. `sectionCut()` takes a wall filter. `elevationLayout()` scale list. `drawSectionMarker()` takes a plane, letter and sheet code |
| `src/premium/exporters/eng/siteplan.js`, `eng/index.js`, `eng/sheets.js` | Contours through the shared helper on the site plan, floor plans, roof plan and site analysis. Second section |
| `src/premium/exporters/eng/kit.js` | `PEN_W` table, extra `HATCH` entries (stipple, block, fill, cut), minimum text size constant |
| `src/commercial/sheet-list.js` | New families and codes, `sheetListText()` check |
| `src/commercial/catalogue/planset.js` | `buildingProps(b)` |
| `src/commercial/catalogue/types/_kit.js` | Only after the owner confirms: opening `offset` centre versus left edge (see 2.1). Not part of the plan set phases |
| `src/commercial/lotcard.js`, `src/premium/ui/commercial-billing.js`, `src/premium/ui/topbar.js` | Sheet list copy only, if codes change |
| `tools/planset-matrix.mjs` (new) | Sample generator across all types with terrain (the script in section 9) |
| `tests/planset.test.mjs`, `tests/boundary-upload.test.mjs` (page count 6), `tests/commercial-fixes.test.mjs`, `tests/catalogue-construction.test.mjs`, `tests/siteplan-fill.test.mjs`, `tests/engplans.test.mjs` (sheet counts 8 and 9), `tools/tiltup-sheet.mjs` | Update pinned counts and codes |
| `tests/planset-sections.test.mjs`, `tests/planset-contours.test.mjs`, `tests/planset-elevations.test.mjs` (new) | Invariants in section 10 |

---

## 9. Sample generation for review

Scratchpad for this review (may be cleared, regenerate with the script):

- `/tmp/claude-0/-home-claude/cb890751-a0e1-5a47-adec-4422936b8022/scratchpad/gen.mjs` : commercial matrix with terrain. Run `node gen.mjs <outDir> [type,type,...]`.
- `/tmp/claude-0/-home-claude/cb890751-a0e1-5a47-adec-4422936b8022/scratchpad/probe.mjs` : per type levels, roofs, props and facade counts.

The matrix script is the pattern for `tools/planset-matrix.mjs`: `commercialProject({ width, depth, rows: 'none' })` from `tests/helpers/commercial-fixture.mjs`, `applyBuildingChoice(store, chooseBuilding(store.project, typeId))`, `injectTerrain(project, { w, d, fall })` from `tests/helpers/grading-harness.mjs`, then `exportPlanSet({ project, kind: 'commercial', download: false, jsPDF, fetchSite: null })`. Add three terrain cases (fall 0.6 m, 3 m, 9 m) so all contour intervals are exercised, and a no terrain case. Rasterise with `pdftoppm -r 60 -png`.

---

## 10. Invariants for tests

Use the recording jsPDF pattern already in `tests/planset.test.mjs` (text and line calls captured) and pure model functions. No pixel comparison.

Sections:

1. For every type in `TYPES` and for a strata pair: `sectionTargets()` returns one target per building or row group and `sectionPlanes()` returns at least one plane, two when both footprint sides are 6 m or more.
2. `sectionModel()` for every type: `walls.length >= 1` or `props.some(p => p.cut)` (open canopies), `floors[0].z === 0`, `roof.profile.length >= 2`, `roof.ridgeZ >= roof.eaveZ > 0`.
3. Multi storey types (office, duplex, townhouse row, terrace row, mixed use): `floors.length` equals the number of levels the building has in `project.levels`. Warehouse with mezzanine: a partial floor at the mezzanine level whose span is shorter than the ground slab.
4. Plane position: no plane lies within 300 mm of an interior wall line it is parallel to.
5. With terrain: `ground.natural` and `ground.design` both cover the full extent, and the FFL tag text equals `levels.fflOf(key)` to 2 decimals. Without terrain: tags contain "ASSUMED" and no natural surface polyline is drawn.
6. The pad level used by `fflOf()` equals the 3D pad level from `terrainModel(project).grading` at the building centroid within 10 mm.
7. Every section sheet contains the strings "SECTION", "FFL", "RL", at least one dimension string, and the indicative concept note.

Contours:

8. `chooseInterval()` returns the table values at 0.5, 1.5, 3, 5, 10 and 20 m of relief.
9. `terrainContours()` on a planar test grid: every output vertex is within 20 mm of the analytic contour, every level is a multiple of `minor`, `major` flags are multiples of `major`.
10. With terrain of 0.6 m, 3 m and 9 m fall, every plan sheet (commercial C100, C101, C102, upper level plan; residential C100 and ground floor plan; engineering site plan, floor plans, roof plan, site analysis) draws at least three contour polylines and at least one RL label matching `/^\d{2,4}\.\d{1,2}$/`.
11. With no terrain: no contour is drawn, no legend entry mentions contours, and the data block says there are no ground levels.
12. The legend lists contours if and only if contour lines were stroked on that sheet.
13. No contour segment is stroked inside a building outline on C101 (sample midpoints against the outlines).

Elevations and sheets:

14. Each building target has four elevations, a strata row at least three. For multi storey types the drawn wall height is at least the top level elevation plus its height.
15. Service station: the elevation and section include a prop with slot `canopy` whose top is above the kiosk eave.
16. No opening rectangle extends past its wall run (catches the offset problem in 2.1).
17. Fill: on every elevation and section sheet the union of drawing bounds is at least 45 percent of the viewport area.
18. No sheet is issued with nothing but frame and legend: a project with no mezzanine and no upper level has no C110.
19. Cover index rows equal `pages` equal `planSetSheets().length`, sheet text "n of N" is correct on every page, drawing numbers are unique.
20. Wording: no text on any sheet matches the `FORBIDDEN` patterns of `eng/kit.js`, contains an em dash or en dash, or contains a date not in DD/MM/YYYY. Sample outputs contain no builder brand name (assert against the names in `golive/builder-houses/` file names).
21. Minimum text size on a paid set is 5.5 pt (record `setFontSize` before each `text` call), with a short allow list for superscripts.
22. Preview: no "1:NNN" scale string anywhere, including view titles.

---

## 11. Visual checks (human or reviewer model, after each phase)

Run `tools/planset-matrix.mjs`, rasterise, and look at:

- Warehouse with docks, service station, strata pair, office, retail strip, community facility, mixed use, self storage, drive through, townhouse row, open canopy, single garage. Then the residential lot viewer set and the engineering set.
- Elevation sheets: four views, real storeys, canopies present, ground follows the terrain, nothing crossing the level tags, sheet looks full.
- Section sheets: cut walls and slabs hatched and heavier than what is beyond, roof shape matches the 3D, mezzanine reads as a partial floor, RL tags and dimension strings do not overlap, both ground lines labelled.
- Plans: contours readable but lighter than the design, labels upright along the lines, no contour through text or buildings, existing and design contours clearly different, FFL tags present.
- Title strip: no empty band, nothing clipped, sheet count right.
- Print one A3 page at 100 percent and confirm the smallest text is readable and the check bar measures 100 mm.
- Read every note for the wording rules.

---

## 12. Phases for a Sonnet implementer

Each phase ends with `npm test` green, the matrix samples regenerated and a reviewer pass on the page images before the next phase starts.

| Phase | Scope | Effort |
|---|---|---|
| 0 | `tools/planset-matrix.mjs`, terrain cases, test scaffolding with the recording PDF. No drawing change | 0.5 day |
| 1 | `levels.js`, contour interval and generation, `drawGroundLayer()`, contours on commercial C100 and C101 and residential C100, legend truth, invariants 8 to 13 | 1.5 days |
| 2 | Commercial elevations: four sides, all storeys, real roofs, props, terrain ground line, level tags, 2 by 2 sheets, invariants 14 to 17 | 2 days |
| 3 | Commercial sections: targets, planes, `sectionModel()`, `drawSections()`, markers on plans, invariants 1 to 7 | 2.5 to 3 days |
| 4 | Sheet list and codes, dynamic sheets, skip empty sheets, upper level plans, title strip, shared scale bar and north point, minimum text size, C900 tidy, pinned test updates, invariants 18 to 22 | 1.5 days |
| 5 | Builder set: A200 and A300 through `eng/views.js`, second section, contours on floor plans, contours on the engineering set plan sheets, larger elevation scale | 1.5 days |
| 6 | C102 levels and grading plan with design contours, FSL spots, cut and fill, optional site section | 1.5 days |

Order matters: phase 1 gives the levels model that phases 2, 3 and 6 use. Phase 4 can run in parallel with phase 3 if two implementers are used, but both touch `commercialSheetPlan()` and `index.js`, so merge phase 3 first.

Open decisions for the owner before phase 2:

1. Sheet codes: regroup as in 3.1, or keep C100 to C104 and append.
2. The `_kit.js` opening offset question in 2.1 (it changes the 3D model as well as the drawings).
3. Whether sub metre contours from a 5 m elevation model are acceptable on paid sheets with the indicative note in 4.3, or whether 0.5 m should be the finest interval offered.
