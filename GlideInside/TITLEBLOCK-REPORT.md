# Builder title blocks (claude/builder-titleblocks)

Owner request: every plan set sheet and engineering site plan exported by a builder account, or a client of that builder, carries THAT builder's title block with a small "Powered by Glide Inside" mark in the bottom corner.

## What changed
- `src/premium/exporters/planset/titleblock.js` (new, self contained): `builderOf`, `drawBuilderBrand` (logo scaled to fit, name, licence, ABN, address, phone, email, website; blank fields are left off), `drawPoweredBy` (small Glide Inside G mark plus the real text "Powered by Glide Inside"), `initialsOf`.
- `src/portal/brand-details.js` (new): the six detail fields, validation (ABN 11 digits stored as `51 824 753 556`, phone, email, website without http, licence, address, no `<` or `>`), shared by the server, the demo API, the Branding tab and the exporters.
- Migration `server/migrations/0024_org_title_block.sql` (6 nullable columns `brand_licence, brand_abn, brand_address, brand_phone, brand_email, brand_website`; numbered 0024 because another branch adds 0023_job_billing). `server/schema.sql` and `portal-store.js` column map updated. These are separate from the billing legal name and ABN, which stay private to billing.
- `server/lib/portal.js`: `setBranding` accepts `details` (undefined keeps, object replaces all six, blank clears, invalid gives 400); `branding.details` is returned to staff and to that org's clients in `/portal/me`. The public `getBrand` sign in endpoint does not expose details. Designers still cannot write (branding.write).
- `src/portal/mock-api.js`, `client-mode.js`, `viewer-mode.js`: demo API validates and stores details; `app.builder` now carries `{ name, logo, details, client }`.
- Plan set: `exportPlanSet` takes `builder` (object) as well as the old `builderName`. `frame.js` has minimal hooks (import, builder brand cell replaces the Glide Inside cell, a 7 mm "Powered by" row under the drawing number, Drawn and By cells use the builder). Call sites pass `app().builder`: `lotcard/lot-card.js`, `commercial/lotcard.js`, `lotcard/send-engineer.js`, `premium/exporters/index.js`. Output filename starts with the builder name for builder sets.
- Engineering plans (`eng/brand.js`, `eng/frame.js`): the builder panel uses the same module; the credit line on the sheet footer now reads "Powered by Glide Inside". CLIENT shows the client name for client logins.
- Branding tab: new "Title block details" fields with inline validation (and a 400 style message on save), and a live title block preview (logo, name, details, client, project, title, scale, date, rev, number, Powered by Glide Inside).
- Bundle rebuilt (website-live plan-studio app and portal copy).

## Isolation
Details come only from the exporting login's own org (`/portal/me` returns the caller's org). A builder never receives another org's details. Public (non portal) users have no `app.builder`, so they keep the existing Glide Inside block (unchanged, verified by test and screenshot). A builder name only (no other details) still gives a builder block with the name and the credit; nothing is invented.

## Tests
- `tests/titleblock.test.mjs` (9 tests): all fields on builder sheets, "Powered by Glide Inside" on every sheet, no JCE name or old ABN in the title block, no cross-org leakage (A and B sheets), name only builder, public unchanged with no credit, long values, engineering plans, validation.
- `tests/portal-server.test.mjs`: new test (memory and D1 shim): saved per org, validated, client sees own builder, other org sees nothing, designers get 403, blank clears.
- Full suite result: see the end of this file.

## Screenshots (/home/claude/shots/builder-titleblocks/)
- `planset-site-sheet-builder.png`: sample site plan sheet for the fake builder "Sample Homes Pty Ltd" with a placeholder logo. No clipped or overlapping text, logo scaled to fit, legend still fits, credit in the bottom corner. (`corner-2.png` is a 300 dpi crop of the credit.)
- `plan-public-2.png`: public sheet, unchanged.
- `eng-crop.png`: engineering plan title block with the builder panel.
- `branding-tab-preview.png`, `branding-tab.png`: Branding tab with fields and preview.
- Re-render: `node tools/titleblock-sample.mjs`, `node tools/titleblock-eng-sample.mjs`, `node tools/titleblock-shots.cjs` (they read a placeholder logo at /tmp/sample-logo.png).

## Notes for merging and the owner
- Merge risk with `claude/plansets-v3` and `claude/abn-swap`: `frame.js` has about 12 changed lines (builder hooks in `drawStrip`; the public Glide Inside block lines are wrapped in `if (!bld) {` without re-indenting, to keep the diff small). Everything else is in the new module.
- Legal notes: the cover and sheet notes (`src/legal/plan-terms.js`, "6. JCE Infrastructure Pty Ltd trading as Glide Inside, ABN 29 699 165 663") still print the Glide Inside legal entity on builder sheets. That is the terms of use notice, not the title block, and it belongs to the ABN swap branch; the tests exclude those two sentences. The owner should decide whether those notes stay on builder sheets once the entity wording changes.
- The existing diagonal watermark "Prepared for <builder>" and the cover line "Prepared for <builder>" are unchanged.
- The client name on plan set sheets comes from the client login's name (client users). Staff exports show "Not stated" unless a client name is supplied; there is no client name field on a project yet.
- Nothing deployed. Migration 0024 must be applied to D1 before the new code is.
