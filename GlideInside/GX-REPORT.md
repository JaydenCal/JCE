# GX-REPORT: siting report, site costs, JCE engineering

Branch claude/gx-report. Built on the earlier commit db5a810 (siting report, site cost estimator with council rules, Order engineering menu), merged into this branch, not duplicated.

## What the earlier commit already had
- `src/premium/exporters/siting-report.js`: branded A4 report (cover with 3D view, site summary and siting plan, setbacks, design summary, indicative site costs, council rules, next steps).
- `src/premium/site-costs/*`: house site cost estimator (earthworks, retaining, driveway, services, editable rates) and council rules.
- `src/premium/engineering-services.js` and `ui/order-engineering.js`: "Order engineering" menu that opens the existing enquiry form (saved through /api/enquiry/jce; prices stay "Request a quote" until the owner confirms them).

## Added here
- Siting report: new "Site constraints and ground" page: flood, bushfire, heritage and easement rows from the overlays (with "Check the council map" where there is no open data or the layer was not checked), contours and fall across the lot (high and low RL, relief, percent fall and direction, rise or fall from the street), and limitations (indicative, not a survey, confirm with council). `src/premium/exporters/siting-facts.js`.
- Siting plan now draws contours (inside the lot) and hatched overlay areas.
- Commercial editor: report no longer refused. Building summary (GFA, footprint, coverage, parking) and an allowance estimator for commercial (hardstand, cut and fill from the design surface, retaining, services, editable rates, labelled indicative): `src/premium/site-costs/commercial-estimate.js`. Menu shows Siting report for commercial; the house Site costs panel stays residential only.
- Pages are 5 (was 4). Headings are placed by fixed layout per page; checked visually.

## Tests
tests/siting-ground.test.mjs (new), siting-report, council-rules and premium tests adjusted for the 5 page layout and commercial menu item. Full suite run once at the end.

## Screenshots
/home/claude/shots/claude-gx-report/res-contact.png, com-contact.png (PDF pages rendered to PNG and checked), res-N.png, com-N.png.

## Left
- No in-browser Playwright run of the panels this session (the stalled run was stopped); PDF checked via rendered pages.
- JCE services list differs slightly from the brief (site classification and footing design stands in for footing certification; civil plans for DA for site plan for DA).
- Commercial report cost block has no low/likely/high range, only one allowance figure.
- Bundle (website-live/plan-studio/app) rebuilt at the end.
