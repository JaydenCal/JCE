# Plan set status (SA5 planset package)

Entry: `build_planset(PlansetInput, out_dir)`; CLI: `python scripts/run_site.py ... --planset` (needs `--acknowledge`).
Sheets: C000 cover/index/locality, C100 existing, C101 proposed, C200 earthworks, C300 stormwater, C310 water/sewer,
C400 driveway plan, C410 long section, C420 crossover details, C500 ESC, C600 details, C700 notes.

## Complete for supplied data
Frame/title block (logo, stamp, revisions), C000, C100, C101, C200 (when levels exist), C600 (cited values only), C700.

## Show DATA NOT AVAILABLE panels (by design, nothing invented)
- Existing services / DBYD (C100, C310), water+sewer connection points (C310, rural lots show no connection).
- Stormwater existing assets (C300), pavement thickness / crossing type (C420: "per Council standard drawing, to be confirmed").
- C500 shows "ESCP DATA PENDING" unless SA10 `Sa10Esc` returns output. C410 needs levels + driveway + FFL.

## Known issues not fixed
- Visual QA was limited: label clashes, callout placement and C410/C420 layout may need tuning.
- Contours stop at the extent of the DEM points; Quia lot uses a locally fetched window DEM only if the network call succeeds.
- Aerial site fetch can fail with HTTP 500 from the NSW service (retried at lower resolution; sheet notes absence).
- DXF viewports use frozen layers; DXF not opened in a real CAD package (ezdxf audit only).
- Text font: Liberation Sans Narrow in the PDF (bundled in ./fonts); DXF style ARIAL NARROW / arialn.ttf.
