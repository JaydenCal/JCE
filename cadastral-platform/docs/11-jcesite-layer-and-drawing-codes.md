# JCESITE layer and drawing codes

Applies to the reference (A1) plan set style only. The legacy A3 plan set keeps its own layer names and drawing numbers.
JCESITE is a platform product and is not affiliated with JCE Infrastructure. All codes live in one module,
`backend/app/agents/sa5_cad_dxf/planset/codes.py`; this file is generated from it (`layer_legend_markdown`, `sheet_table_markdown`).

## Drawing number scheme

`JCS-{job}-CIV-{NNN}`

- `JCS` is the JCESITE prefix, `CIV` is the civil discipline.
- `{job}` is the job number (upper case). When no job is set the placeholder `XXX` is shown.
- `NNN` is the digits of the sheet number, e.g. C101 gives `101`. The general notes sheet is C001 (sheet 2); the former C700 maps to it.

| Sheet | NNN | Title | Drawing number (job empty) | Drawing number (job 004) |
|---|---|---|---|---|
| C000 | 000 | Cover sheet and drawing register | `JCS-XXX-CIV-000` | `JCS-004-CIV-000` |
| C001 | 001 | General notes | `JCS-XXX-CIV-001` | `JCS-004-CIV-001` |
| C100 | 100 | Existing site plan | `JCS-XXX-CIV-100` | `JCS-004-CIV-100` |
| C101 | 101 | Proposed site plan | `JCS-XXX-CIV-101` | `JCS-004-CIV-101` |
| C200 | 200 | Earthworks | `JCS-XXX-CIV-200` | `JCS-004-CIV-200` |
| C300 | 300 | Stormwater | `JCS-XXX-CIV-300` | `JCS-004-CIV-300` |
| C310 | 310 | Water and sewer | `JCS-XXX-CIV-310` | `JCS-004-CIV-310` |
| C400 | 400 | Driveway plan | `JCS-XXX-CIV-400` | `JCS-004-CIV-400` |
| C410 | 410 | Driveway long section | `JCS-XXX-CIV-410` | `JCS-004-CIV-410` |
| C420 | 420 | Driveway layover details | `JCS-XXX-CIV-420` | `JCS-004-CIV-420` |
| C500 | 500 | Erosion and sediment control | `JCS-XXX-CIV-500` | `JCS-004-CIV-500` |
| C600 | 600 | Typical details | `JCS-XXX-CIV-600` | `JCS-004-CIV-600` |

## Layer scheme

`JCS-{DISC}-{ELEMENT}-{TYPE}`, upper case.

- `DISC` is one of `SITE` (drawn site elements), `ANNO` (annotation), `FRAM` (sheet frame and title block), `VIEW` (viewports).
- `ELEMENT` is a four character code (table below).
- `TYPE` is one of `LINE`, `HATCH`, `TEXT`, `SYMB`, `NONE`. The type follows the entity: text entities go on `TEXT`, hatches and solid fills on `HATCH`, polylines on `LINE`. `NONE` is used by the non-plotting viewport layer only; `SYMB` is reserved for symbol blocks (site symbols are currently drawn as lines and text on the `ANNO-SYMB` element).
- Layers are registered in the DXF only when used. The regular expression is `^JCS-(SITE|ANNO|FRAM|VIEW)-[A-Z0-9]{4}-(LINE|HATCH|TEXT|SYMB|NONE)$`.

Each element below exists as `-LINE`, `-HATCH` and `-TEXT` layers (the viewport is a single `-NONE` layer). Colour, lineweight and linetype are layer defaults; individual entities carry their own RGB and widths.

| Layer name | Colour (ACI) | Lineweight (mm) | Linetype | Description | Replaces (ref-style working name) |
|---|---|---|---|---|---|
| `JCS-SITE-BNDY-LINE` | 7 | 0.50 | CONTINUOUS | Lot boundary (black line) (line) | `C-PROP-BDY` |
| `JCS-SITE-BNDY-HATCH` | 7 | 0.50 | CONTINUOUS | Lot boundary (black line) (hatch) | `C-PROP-BDY` |
| `JCS-SITE-BNDY-TEXT` | 7 | 0.50 | CONTINUOUS | Lot boundary (black line) (text) | `C-PROP-BDY` |
| `JCS-SITE-BNDD-LINE` | 2 | 0.80 | CONTINUOUS | Lot boundary yellow dash overlay (line) | `C-PROP-BDYD` |
| `JCS-SITE-BNDD-HATCH` | 2 | 0.80 | CONTINUOUS | Lot boundary yellow dash overlay (hatch) | `C-PROP-BDYD` |
| `JCS-SITE-BNDD-TEXT` | 2 | 0.80 | CONTINUOUS | Lot boundary yellow dash overlay (text) | `C-PROP-BDYD` |
| `JCS-SITE-ADJN-LINE` | 9 | 0.13 | CONTINUOUS | Adjoining lot boundaries (line) | `C-PROP-ADJN` |
| `JCS-SITE-ADJN-HATCH` | 9 | 0.13 | CONTINUOUS | Adjoining lot boundaries (hatch) | `C-PROP-ADJN` |
| `JCS-SITE-ADJN-TEXT` | 9 | 0.13 | CONTINUOUS | Adjoining lot boundaries (text) | `C-PROP-ADJN` |
| `JCS-SITE-KERB-LINE` | 7 | 0.25 | CONTINUOUS | Kerb and gutter lines and fence lines (assumed kerb unless surveyed) (line) | `C-ROAD-KERB` |
| `JCS-SITE-KERB-HATCH` | 7 | 0.25 | CONTINUOUS | Kerb and gutter lines and fence lines (assumed kerb unless surveyed) (hatch) | `C-ROAD-KERB` |
| `JCS-SITE-KERB-TEXT` | 7 | 0.25 | CONTINUOUS | Kerb and gutter lines and fence lines (assumed kerb unless surveyed) (text) | `C-ROAD-KERB` |
| `JCS-SITE-XOVR-LINE` | 8 | 0.25 | CONTINUOUS | Crossover concrete (AR-CONC stipple) (line) | `C-ROAD-CONC` |
| `JCS-SITE-XOVR-HATCH` | 8 | 0.25 | CONTINUOUS | Crossover concrete (AR-CONC stipple) (hatch) | `C-ROAD-CONC` |
| `JCS-SITE-XOVR-TEXT` | 8 | 0.25 | CONTINUOUS | Crossover concrete (AR-CONC stipple) (text) | `C-ROAD-CONC` |
| `JCS-SITE-DRVW-LINE` | 8 | 0.25 | CONTINUOUS | Driveway concrete (AR-CONC stipple) (line) | `C-DRIV-SURF` |
| `JCS-SITE-DRVW-HATCH` | 8 | 0.25 | CONTINUOUS | Driveway concrete (AR-CONC stipple) (hatch) | `C-DRIV-SURF` |
| `JCS-SITE-DRVW-TEXT` | 8 | 0.25 | CONTINUOUS | Driveway concrete (AR-CONC stipple) (text) | `C-DRIV-SURF` |
| `JCS-SITE-ROAD-LINE` | 9 | 0.13 | CONTINUOUS | Assumed road pavement fill and road name (line) | `C-ROAD-PAVE`, `C-ANNO-ROAD` |
| `JCS-SITE-ROAD-HATCH` | 9 | 0.13 | CONTINUOUS | Assumed road pavement fill and road name (hatch) | `C-ROAD-PAVE`, `C-ANNO-ROAD` |
| `JCS-SITE-ROAD-TEXT` | 9 | 0.13 | CONTINUOUS | Assumed road pavement fill and road name (text) | `C-ROAD-PAVE`, `C-ANNO-ROAD` |
| `JCS-SITE-BLDG-LINE` | 7 | 0.25 | CONTINUOUS | Building outline and hatch (only when a footprint is supplied) (line) | `A-BLDG-PROP`, `A-BLDG-EXST` |
| `JCS-SITE-BLDG-HATCH` | 7 | 0.25 | CONTINUOUS | Building outline and hatch (only when a footprint is supplied) (hatch) | `A-BLDG-PROP`, `A-BLDG-EXST` |
| `JCS-SITE-BLDG-TEXT` | 7 | 0.25 | CONTINUOUS | Building outline and hatch (only when a footprint is supplied) (text) | `A-BLDG-PROP`, `A-BLDG-EXST` |
| `JCS-SITE-LAWN-LINE` | 3 | 0.13 | CONTINUOUS | Landscape area fill (line) | `C-LAND-LAWN` |
| `JCS-SITE-LAWN-HATCH` | 3 | 0.13 | CONTINUOUS | Landscape area fill (hatch) | `C-LAND-LAWN` |
| `JCS-SITE-LAWN-TEXT` | 3 | 0.13 | CONTINUOUS | Landscape area fill (text) | `C-LAND-LAWN` |
| `JCS-SITE-LOTS-LINE` | 7 | 0.13 | CONTINUOUS | Neighbour lot labels (line) | `C-ANNO-LOTN` |
| `JCS-SITE-LOTS-HATCH` | 7 | 0.13 | CONTINUOUS | Neighbour lot labels (hatch) | `C-ANNO-LOTN` |
| `JCS-SITE-LOTS-TEXT` | 7 | 0.13 | CONTINUOUS | Neighbour lot labels (text) | `C-ANNO-LOTN` |
| `JCS-SITE-RWTK-LINE` | 5 | 0.25 | CONTINUOUS | Rainwater tank (line) | `C-UTIL-RWTK` |
| `JCS-SITE-RWTK-HATCH` | 5 | 0.25 | CONTINUOUS | Rainwater tank (hatch) | `C-UTIL-RWTK` |
| `JCS-SITE-RWTK-TEXT` | 5 | 0.25 | CONTINUOUS | Rainwater tank (text) | `C-UTIL-RWTK` |
| `JCS-SITE-UTIL-LINE` | 4 | 0.18 | CONTINUOUS | Service lines and service labels (indicative) (line) | `C-UTIL-*`, `C-ANNO-SERV` |
| `JCS-SITE-UTIL-HATCH` | 4 | 0.18 | CONTINUOUS | Service lines and service labels (indicative) (hatch) | `C-UTIL-*`, `C-ANNO-SERV` |
| `JCS-SITE-UTIL-TEXT` | 4 | 0.18 | CONTINUOUS | Service lines and service labels (indicative) (text) | `C-UTIL-*`, `C-ANNO-SERV` |
| `JCS-SITE-CONT-LINE` | 8 | 0.13 | CONTINUOUS | Existing and proposed contours, contour labels and DEM spot levels (indicative) (line) | `C-TOPO-EXST`, `C-TOPO-PROP`, `C-ANNO-CNTR`, `C-TOPO-SPOT` |
| `JCS-SITE-CONT-HATCH` | 8 | 0.13 | CONTINUOUS | Existing and proposed contours, contour labels and DEM spot levels (indicative) (hatch) | `C-TOPO-EXST`, `C-TOPO-PROP`, `C-ANNO-CNTR`, `C-TOPO-SPOT` |
| `JCS-SITE-CONT-TEXT` | 8 | 0.13 | CONTINUOUS | Existing and proposed contours, contour labels and DEM spot levels (indicative) (text) | `C-TOPO-EXST`, `C-TOPO-PROP`, `C-ANNO-CNTR`, `C-TOPO-SPOT` |
| `JCS-SITE-EART-LINE` | 4 | 0.25 | CONTINUOUS | Earthworks: cut, fill, batters, pad and retaining wall screening (line) | `C-EART-CUTT`, `C-EART-FILL`, `C-EART-BATR`, `C-EART-PADD`, `C-WALL-RETN` |
| `JCS-SITE-EART-HATCH` | 4 | 0.25 | CONTINUOUS | Earthworks: cut, fill, batters, pad and retaining wall screening (hatch) | `C-EART-CUTT`, `C-EART-FILL`, `C-EART-BATR`, `C-EART-PADD`, `C-WALL-RETN` |
| `JCS-SITE-EART-TEXT` | 4 | 0.25 | CONTINUOUS | Earthworks: cut, fill, batters, pad and retaining wall screening (text) | `C-EART-CUTT`, `C-EART-FILL`, `C-EART-BATR`, `C-EART-PADD`, `C-WALL-RETN` |
| `JCS-SITE-STRM-LINE` | 5 | 0.18 | CONTINUOUS | Stormwater (schematic) and overland flow arrows (line) | `C-UTIL-STRM`, `C-UTIL-FLOW` |
| `JCS-SITE-STRM-HATCH` | 5 | 0.18 | CONTINUOUS | Stormwater (schematic) and overland flow arrows (hatch) | `C-UTIL-STRM`, `C-UTIL-FLOW` |
| `JCS-SITE-STRM-TEXT` | 5 | 0.18 | CONTINUOUS | Stormwater (schematic) and overland flow arrows (text) | `C-UTIL-STRM`, `C-UTIL-FLOW` |
| `JCS-SITE-WATR-LINE` | 5 | 0.18 | CONTINUOUS | Water service (schematic or supplied) (line) | `C-UTIL-WATR` |
| `JCS-SITE-WATR-HATCH` | 5 | 0.18 | CONTINUOUS | Water service (schematic or supplied) (hatch) | `C-UTIL-WATR` |
| `JCS-SITE-WATR-TEXT` | 5 | 0.18 | CONTINUOUS | Water service (schematic or supplied) (text) | `C-UTIL-WATR` |
| `JCS-SITE-SEWR-LINE` | 6 | 0.18 | CONTINUOUS | Sewer (schematic or supplied) (line) | `C-UTIL-SEWR` |
| `JCS-SITE-SEWR-HATCH` | 6 | 0.18 | CONTINUOUS | Sewer (schematic or supplied) (hatch) | `C-UTIL-SEWR` |
| `JCS-SITE-SEWR-TEXT` | 6 | 0.18 | CONTINUOUS | Sewer (schematic or supplied) (text) | `C-UTIL-SEWR` |
| `JCS-SITE-DRVC-LINE` | 7 | 0.18 | CONTINUOUS | Driveway centreline, chainage, turning path and long section (line) | `C-DRIV-CNTR`, `C-DRIV-TURN`, `C-DRIV-LONG`, `C-DRIV-EXGD` |
| `JCS-SITE-DRVC-HATCH` | 7 | 0.18 | CONTINUOUS | Driveway centreline, chainage, turning path and long section (hatch) | `C-DRIV-CNTR`, `C-DRIV-TURN`, `C-DRIV-LONG`, `C-DRIV-EXGD` |
| `JCS-SITE-DRVC-TEXT` | 7 | 0.18 | CONTINUOUS | Driveway centreline, chainage, turning path and long section (text) | `C-DRIV-CNTR`, `C-DRIV-TURN`, `C-DRIV-LONG`, `C-DRIV-EXGD` |
| `JCS-SITE-ESCP-LINE` | 3 | 0.25 | CONTINUOUS | Erosion and sediment control elements (SA10) (line) | `C-ESCP-GENL`, `C-ESCP-*` |
| `JCS-SITE-ESCP-HATCH` | 3 | 0.25 | CONTINUOUS | Erosion and sediment control elements (SA10) (hatch) | `C-ESCP-GENL`, `C-ESCP-*` |
| `JCS-SITE-ESCP-TEXT` | 3 | 0.25 | CONTINUOUS | Erosion and sediment control elements (SA10) (text) | `C-ESCP-GENL`, `C-ESCP-*` |
| `JCS-ANNO-DETL-LINE` | 7 | 0.25 | CONTINUOUS | Typical detail and section linework (line) | `C-DETL-LINE` |
| `JCS-ANNO-DETL-HATCH` | 7 | 0.25 | CONTINUOUS | Typical detail and section linework (hatch) | `C-DETL-LINE` |
| `JCS-ANNO-DETL-TEXT` | 7 | 0.25 | CONTINUOUS | Typical detail and section linework (text) | `C-DETL-LINE` |
| `JCS-ANNO-CALL-LINE` | 7 | 0.25 | CONTINUOUS | Call-out boxes, leaders and tags (line) | `C-ANNO-CALL` |
| `JCS-ANNO-CALL-HATCH` | 7 | 0.25 | CONTINUOUS | Call-out boxes, leaders and tags (hatch) | `C-ANNO-CALL` |
| `JCS-ANNO-CALL-TEXT` | 7 | 0.25 | CONTINUOUS | Call-out boxes, leaders and tags (text) | `C-ANNO-CALL` |
| `JCS-ANNO-DIMS-LINE` | 7 | 0.18 | CONTINUOUS | Dimensions and boundary lengths (line) | `C-ANNO-DIMS`, `C-ANNO-BRNG` |
| `JCS-ANNO-DIMS-HATCH` | 7 | 0.18 | CONTINUOUS | Dimensions and boundary lengths (hatch) | `C-ANNO-DIMS`, `C-ANNO-BRNG` |
| `JCS-ANNO-DIMS-TEXT` | 7 | 0.18 | CONTINUOUS | Dimensions and boundary lengths (text) | `C-ANNO-DIMS`, `C-ANNO-BRNG` |
| `JCS-ANNO-SYMB-LINE` | 8 | 0.18 | CONTINUOUS | Site symbols (HYD, T, WM, grate, tree canopy) (line) | `C-SITE-SYMB` |
| `JCS-ANNO-SYMB-HATCH` | 8 | 0.18 | CONTINUOUS | Site symbols (HYD, T, WM, grate, tree canopy) (hatch) | `C-SITE-SYMB` |
| `JCS-ANNO-SYMB-TEXT` | 8 | 0.18 | CONTINUOUS | Site symbols (HYD, T, WM, grate, tree canopy) (text) | `C-SITE-SYMB` |
| `JCS-ANNO-NRTH-LINE` | 7 | 0.18 | CONTINUOUS | North point and scale bar (line) | `C-ANNO-NRTH` |
| `JCS-ANNO-NRTH-HATCH` | 7 | 0.18 | CONTINUOUS | North point and scale bar (hatch) | `C-ANNO-NRTH` |
| `JCS-ANNO-NRTH-TEXT` | 7 | 0.18 | CONTINUOUS | North point and scale bar (text) | `C-ANNO-NRTH` |
| `JCS-ANNO-NOTE-LINE` | 7 | 0.18 | CONTINUOUS | General notes and labels (line) | `C-ANNO-NOTE` |
| `JCS-ANNO-NOTE-HATCH` | 7 | 0.18 | CONTINUOUS | General notes and labels (hatch) | `C-ANNO-NOTE` |
| `JCS-ANNO-NOTE-TEXT` | 7 | 0.18 | CONTINUOUS | General notes and labels (text) | `C-ANNO-NOTE` |
| `JCS-ANNO-DATA-LINE` | 1 | 0.35 | CONTINUOUS | NOT DRAWN, NO DATA SUPPLIED and placeholder panels (line) | `C-DATA-NONE` |
| `JCS-ANNO-DATA-HATCH` | 1 | 0.35 | CONTINUOUS | NOT DRAWN, NO DATA SUPPLIED and placeholder panels (hatch) | `C-DATA-NONE` |
| `JCS-ANNO-DATA-TEXT` | 1 | 0.35 | CONTINUOUS | NOT DRAWN, NO DATA SUPPLIED and placeholder panels (text) | `C-DATA-NONE` |
| `JCS-FRAM-TTLB-LINE` | 7 | 0.25 | CONTINUOUS | Border, title block and notes panel (line) | `C-ANNO-TTLB` |
| `JCS-FRAM-TTLB-HATCH` | 7 | 0.25 | CONTINUOUS | Border, title block and notes panel (hatch) | `C-ANNO-TTLB` |
| `JCS-FRAM-TTLB-TEXT` | 7 | 0.25 | CONTINUOUS | Border, title block and notes panel (text) | `C-ANNO-TTLB` |
| `JCS-FRAM-GRID-LINE` | 8 | 0.11 | CONTINUOUS | Zone grid ticks and references (line) | `C-ANNO-GRID` |
| `JCS-FRAM-GRID-HATCH` | 8 | 0.11 | CONTINUOUS | Zone grid ticks and references (hatch) | `C-ANNO-GRID` |
| `JCS-FRAM-GRID-TEXT` | 8 | 0.11 | CONTINUOUS | Zone grid ticks and references (text) | `C-ANNO-GRID` |
| `JCS-FRAM-TABL-LINE` | 7 | 0.18 | CONTINUOUS | Revision table (line) | `C-ANNO-TABL` |
| `JCS-FRAM-TABL-HATCH` | 7 | 0.18 | CONTINUOUS | Revision table (hatch) | `C-ANNO-TABL` |
| `JCS-FRAM-TABL-TEXT` | 7 | 0.18 | CONTINUOUS | Revision table (text) | `C-ANNO-TABL` |
| `JCS-FRAM-STMP-LINE` | 1 | 0.35 | CONTINUOUS | Status stamp (line) | `C-ANNO-STMP` |
| `JCS-FRAM-STMP-HATCH` | 1 | 0.35 | CONTINUOUS | Status stamp (hatch) | `C-ANNO-STMP` |
| `JCS-FRAM-STMP-TEXT` | 1 | 0.35 | CONTINUOUS | Status stamp (text) | `C-ANNO-STMP` |
| `JCS-FRAM-AICK-LINE` | 1 | 0.35 | CONTINUOUS | AI statement box and AI CHECK field (line) | new |
| `JCS-FRAM-AICK-HATCH` | 1 | 0.35 | CONTINUOUS | AI statement box and AI CHECK field (hatch) | new |
| `JCS-FRAM-AICK-TEXT` | 1 | 0.35 | CONTINUOUS | AI statement box and AI CHECK field (text) | new |
| `JCS-VIEW-VPRT-NONE` | 7 | 0.13 | CONTINUOUS | Layout viewport (non-plotting frame) | `C-ANNO-VPRT` |

## Stage 3b conventions (no new layer codes)
- Batter lines use `C-EART-BATR` (SITE EART); detail linework and hatches use `C-DETL-LINE` (ANNO DETL).
- Detail hatches: existing "/" and proposed "\\" from `style.REF`, concrete AR-CONC stipple, bitumen grey solid.
- A rotated plan view is a DXF viewport with a twist angle; the north point is drawn rotated by the same angle and labelled.

## Stage 3b round 2 additions
Linetype `JCS_BDY` replaces `JCE_BDY`. Requirement text on the sheets is generated from `planset/phrases.py` (one readable sentence plus a short source per key). Sheet C600 draws pavement layers by cited surface type; with no type cited the layers are plain, numbered and marked "PAVEMENT TYPE NOT SELECTED, THICKNESS TBC".

## Stage 11 export layers (DXF export of the site design)
The DXF export of the 3D site tool (`GET /projects/{id}/exports/dxf`, versions R2010 (default), R2000 and R12) draws the site design in plan on the JCS scheme above. Every layer name matches the pattern `JCS-(SITE|ANNO)-XXXX-(LINE|HATCH|TEXT)`. The element code has four characters: a three character object type code and one status letter, E for existing, P for proposed and R for to be removed. Existing services use V for verified by the user and U for UNVERIFIED; UNVERIFIED services are drawn with the DASHED linetype, and objects to be removed with HIDDEN. The fixed elements are BNDY (lot boundary), ADJN (adjoining lots), KERB (assumed kerb line, not surveyed), CONT (contours and their labels), LOTS (neighbour lot labels), NOTE (title note with the terrain status, the services status, the date and the coordinate system) and NRTH (north arrow and 10 m scale bar). Coordinates are MGA. All text is upper case. The HATCH layers exist in R2010 and R2000 only (R12 has no hatch).

| Object type | Element codes (status letter last) | Statuses | ACI | Lineweight (mm) | Linetype | Example layer |
|---|---|---|---|---|---|---|
| building (building) | `BLDE`, `BLDP`, `BLDR` | existing, proposed, to be removed | 7 | 0.35 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-BLDP-LINE` |
| driveway (driveway) | `DRVE`, `DRVP`, `DRVR` | existing, proposed, to be removed | 8 | 0.35 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-DRVP-LINE` |
| footpath (footpath) | `FTPE`, `FTPP`, `FTPR` | existing, proposed, to be removed | 9 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-FTPP-LINE` |
| landscape_area (landscape area) | `LNDE`, `LNDP`, `LNDR` | existing, proposed, to be removed | 3 | 0.18 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-LNDP-LINE` |
| grading_area (grading area) | `GRDE`, `GRDP`, `GRDR` | existing, proposed, to be removed | 4 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-GRDP-LINE` |
| retaining_wall (retaining wall) | `RTWE`, `RTWP`, `RTWR` | existing, proposed, to be removed | 6 | 0.35 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-RTWP-LINE` |
| pool (pool) | `POLE`, `POLP`, `POLR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-POLP-LINE` |
| pool_barrier (pool barrier) | `PBRE`, `PBRP`, `PBRR` | existing, proposed, to be removed | 6 | 0.18 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-PBRP-LINE` |
| tree (tree) | `TREE`, `TREP`, `TRER` | existing, proposed, to be removed | 3 | 0.18 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-TREP-LINE` |
| furniture (furniture) | `FURE`, `FURP`, `FURR` | existing, proposed, to be removed | 8 | 0.13 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-FURP-LINE` |
| rwt (rainwater tank) | `RWTE`, `RWTP`, `RWTR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-RWTP-LINE` |
| osd (osd tank) | `OSDE`, `OSDP`, `OSDR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-OSDP-LINE` |
| osd_basin (osd basin) | `OSBE`, `OSBP`, `OSBR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-OSBP-LINE` |
| infiltration_trench (infiltration trench) | `TRNE`, `TRNP`, `TRNR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-TRNP-LINE` |
| stormwater_pit (stormwater pit) | `PITE`, `PITP`, `PITR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-PITP-LINE` |
| stormwater_pipe (stormwater pipe) | `PIPE`, `PIPP`, `PIPR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-PIPP-LINE` |
| overflow_route (overflow route) | `OFRE`, `OFRP`, `OFRR` | existing, proposed, to be removed | 5 | 0.18 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-OFRP-LINE` |
| discharge_point (discharge point) | `DCHE`, `DCHP`, `DCHR` | existing, proposed, to be removed | 1 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-DCHP-LINE` |
| sewer_drain (sewer drain) | `SWDE`, `SWDP`, `SWDR` | existing, proposed, to be removed | 6 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-SWDP-LINE` |
| water_service (water service) | `WSVE`, `WSVP`, `WSVR` | existing, proposed, to be removed | 5 | 0.25 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-WSVP-LINE` |
| service_node (service node) | `SNDE`, `SNDP`, `SNDR` | existing, proposed, to be removed | 2 | 0.18 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-SNDP-LINE` |
| service_trace (traced service) | `TRCE`, `TRCP`, `TRCR` | existing, proposed, to be removed | 4 | 0.18 | CONTINUOUS (HIDDEN when to be removed) | `JCS-SITE-TRCP-LINE` |
| service_existing, water | `WATV`, `WATU` | verified by the user, UNVERIFIED | 5 | 0.18 | CONTINUOUS (DASHED when unverified) | `JCS-SITE-WATU-LINE` |
| service_existing, sewer | `SWRV`, `SWRU` | verified by the user, UNVERIFIED | 6 | 0.18 | CONTINUOUS (DASHED when unverified) | `JCS-SITE-SWRU-LINE` |
| service_existing, stormwater | `STWV`, `STWU` | verified by the user, UNVERIFIED | 4 | 0.18 | CONTINUOUS (DASHED when unverified) | `JCS-SITE-STWU-LINE` |
| service_existing, gas | `GASV`, `GASU` | verified by the user, UNVERIFIED | 2 | 0.18 | CONTINUOUS (DASHED when unverified) | `JCS-SITE-GASU-LINE` |
| service_existing, electricity | `ELCV`, `ELCU` | verified by the user, UNVERIFIED | 1 | 0.18 | CONTINUOUS (DASHED when unverified) | `JCS-SITE-ELCU-LINE` |
| service_existing, telecommunications | `TELV`, `TELU` | verified by the user, UNVERIFIED | 200 | 0.18 | CONTINUOUS (DASHED when unverified) | `JCS-SITE-TELU-LINE` |
| service_existing, other | `OTHV`, `OTHU` | verified by the user, UNVERIFIED | 8 | 0.18 | CONTINUOUS (DASHED when unverified) | `JCS-SITE-OTHU-LINE` |
