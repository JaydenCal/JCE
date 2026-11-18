# Plan set v3 report (18/11/2026)

Branch `claude/plansets-v3`, spec `GlideInside/PLANSET-PLAN.md`. Owner decisions applied: regrouped sheet codes, `_kit.js` opening offset fixed at the source, finest contour interval 0.5 m. No road surfaces are drawn by any new sheet. `claude/release-6` was merged first.

## Phases

| Phase | State |
|---|---|
| 0 Sample matrix and test scaffolding | Done (`tools/planset-matrix.mjs`, `tests/helpers/planset-fixtures.mjs`) |
| 1 Levels model and contours on all plan sheets | Done (levels.js, drawGroundLayer, 0.5 m finest interval, legend truth). Contours on commercial C100, C101, upper plans, residential C100, floor plans, engineering set plans |
| 2 Commercial elevations | Done: four sides, every storey, real roof shape, 3D props (canopy, pumps, posts, seals), natural and finished ground, level tags with RL, overall dimensions, view titles; 2x2 or row layouts by best scale |
| 3 Commercial sections | Done: section per building and strata row group (A-A, plus B-B at 6 m by 6 m or more), cut walls with hatches, partial mezzanine floors, roof along the cut, cut props, ground lines, RL tags, dimensions, key plan, letters run on across buildings |
| 4 Sheet list and codes | Mostly done: C000, C100, C101, C102, C110.., C200.., C300.., C900, C910; empty sheets not issued; cover thumbnail fixed; C103 references now C900. Not done: title strip changes (status and datum fields, flowing notes, check bar), shared scale bar helper, C900 empty-table removal and levels table |
| 5 Builder set | Done: A200 elevations, A300 section A-A, A301 section B-B (`eng/views.js` takes an axis and letter), section markers on floor plans, elevation scales 1:75 and 1:125 added. Not done: finished surface line beside natural on residential elevations |
| 6 C102 levels and grading plan | Done: existing and design contours, FFL tags, FSL spots, fall arrows, lowest boundary ground, indicative cut and fill. Not done: batter extents, site section |

## Owner decision fixes
- `_kit.js`: spec `offset` is the left edge, the model stores the centre; `materialise` now passes `offset + width / 2`. Test checks every opening of every type lies inside its wall.

## Tests
New: `tests/planset-sheets.test.mjs` (sheet codes, window offset, section and elevation models for all types, wording, 5.5 pt text), `tests/planset-contours.test.mjs` (interval table and contours). Pinned counts updated in planset, boundary-upload, commercial-fixes, catalogue-construction, siteplan-fill. Residential sheet counts (now A200, A300, A301 added) may still need pinned-test updates in planset.test and engplans; see the final run result in the hand-back message.

## Visual review
PNG renders in `/home/claude/shots/plansets-v3/` (p2 warehouse, service station, mixed use; p3 office, strata; p4 retail, storage, townhouse, canopy, garage; p6 C102; p7 residential A200 to A301). Known visual points: elevation sheets of long low buildings fill about a third of the viewport (the 45 percent target is not met, scale is limited by one common scale); section markers on floor plans cross a few room labels; room name "CORE (LIFTS, STAIRS, AMENITIES)" overflows its room on the office upper plan; the locality plan labels on the cover still touch.
