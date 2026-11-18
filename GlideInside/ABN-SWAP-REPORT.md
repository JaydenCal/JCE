# ABN swap report (18/11/2026)

Owner decision: Glide Inside is shown as "Glide Inside" with "ABN 11 549 431 925". "JCE Infrastructure Pty Ltd", ABN 29 699 165 663 and "trading as" phrasing removed from everything Glide Inside.

## What changed
- ABN 29 699 165 663 replaced by 11 549 431 925 everywhere; "JCE Infrastructure Pty Ltd trading as Glide Inside" replaced by "Glide Inside".
- Legal pages: contracting party is Glide Inside (ABN 11 549 431 925). "We, us and our" now defined as Glide Inside in terms.html, privacy.html, trial-terms.html and the plan set terms. Liability sentence now reads "Glide Inside accepts no liability" (JCE removed as a party).
- Dates and versions: terms, privacy and trial terms "Last updated 18/11/2026"; plan set terms version 1.1 to 1.2, effective 18/11/2026 (modal checkbox label, sheet note stamp and test expectations updated); TERMS_VERSION in src/profile/wording.js 2026-11-15 to 2026-11-18; trial TERMS_VERSION in server/lib/trial.js 11/11/2026 to 18/11/2026 (simple string, easy to merge with claude/job-billing).
- JSON-LD on website-live/index.html: parentOrganization (JCE) removed; the ABN and taxID now sit on the Glide Inside organisation; description no longer says "operated by JCE".
- Public plan footer (src/site/upload/flow.js FOOT_BASE) now "Concept only · Glide Inside".
- Concierge/AI answers (server/lib/concierge-knowledge.js) say Glide Inside, ABN 11 549 431 925 makes and sells the software; JCE Infrastructure remains only as the engineering provider.
- Consent text on index and book-a-demo, and concierge consent lines, now name Glide Inside.
- Exception kept: engineering enquiry flow still says "JCE Infrastructure" (no "Pty Ltd", no ABN) in src/premium/ui/enquiry.js, server/lib/enquiry.js, src/portal/mock-api.js (and portal copy), topbar.js, for-builders and home page "Send to JCE" copy, trial-terms "Send to JCE". Recipient addresses untouched.
- docs/SCOPE.md and docs/PORTAL_API.md updated to match.
- Bundle rebuilt (sync-portal, sync-plan-terms, build-single).

## Not changed (rules forbid touching wrangler/golive): ACTION NEEDED
These still hold the old values and would OVERRIDE the new code defaults in production (invoice seller name and ABN):
- GlideInside/pocket-architect-source/wrangler.toml (SELLER_NAME, SELLER_ABN)
- GlideInside/pocket-architect-source/server/wrangler.toml.example
- GlideInside/golive/wrangler.live.toml and golive/GO-LIVE.md
- GlideInside/staging/wrangler.staging.toml
Also unchanged: FP/ and REVIEW/ (JCE work, not Glide Inside) and live-v6-reference.

## Tests
Full suite run once (1852 tests): failures were free-profile (privacy date) and terms (v1.1 stamp), both fixed; planset/premium timeouts under load passed alone. Re-run of terms, free-profile, premium, pdf-terms-legible, planset, trial, portal, commercial-fixes, send-engineer: all pass.

## Files changed
- pocket-architect-source/docs/PORTAL_API.md
- pocket-architect-source/docs/SCOPE.md
- pocket-architect-source/server/README.md
- pocket-architect-source/server/lib/concierge-knowledge.js
- pocket-architect-source/server/lib/config.js
- pocket-architect-source/server/lib/enquiry.js
- pocket-architect-source/server/lib/trial.js
- pocket-architect-source/src/config.js
- pocket-architect-source/src/legal/plan-terms.js
- pocket-architect-source/src/portal/mock-api.js
- pocket-architect-source/src/premium/exporters/planset/frame.js
- pocket-architect-source/src/premium/ui/enquiry.js
- pocket-architect-source/src/profile/wording.js
- pocket-architect-source/src/site/upload/flow.js
- pocket-architect-source/tests/commercial-fixes.test.mjs
- pocket-architect-source/tests/generic-designs.test.mjs
- pocket-architect-source/tests/html-export.test.mjs
- pocket-architect-source/tests/pdf-terms-legible.test.mjs
- pocket-architect-source/tests/planner-ui.test.mjs
- pocket-architect-source/tests/planset.test.mjs
- pocket-architect-source/tests/portal-server.test.mjs
- pocket-architect-source/tests/portal.test.mjs
- pocket-architect-source/tests/premium.test.mjs
- pocket-architect-source/tests/reskin-subdivision.test.mjs
- pocket-architect-source/tests/send-engineer.test.mjs
- pocket-architect-source/tests/server.test.mjs
- pocket-architect-source/tests/terms.test.mjs
- pocket-architect-source/tests/trial.test.mjs
- pocket-architect-source/tools/reskin-subdivision.mjs
- pocket-architect-source/tools/review3d-export-shots.mjs
- pocket-architect-source/tools/subdivision-chrome/footer.html
- website-live/3d-floor-plan-maker/index.html
- website-live/assets/concierge/concierge.js
- website-live/book-a-demo/index.html
- website-live/commercial/index.html
- website-live/for-builders/index.html
- website-live/granny-flat-designs/index.html
- website-live/how-accurate-is-it/index.html
- website-live/index.html
- website-live/plan-studio/app/index.html
- website-live/plan-studio/index.html
- website-live/plan-studio/launch/index.html
- website-live/plan-terms.html
- website-live/plans/1-bedroom-granny-flat-plans/index.html
- website-live/plans/2-bedroom-granny-flat-plans/index.html
- website-live/plans/4-bedroom-house-plans/index.html
- website-live/plans/duplex-designs/index.html
- website-live/plans/home-extension-ideas/index.html
- website-live/plans/index.html
- website-live/plans/shed-house-plans/index.html
- website-live/portal/index.html
- website-live/portal/src/config.js
- website-live/portal/src/portal/mock-api.js
- website-live/pricing/index.html
- website-live/privacy.html
- website-live/sample-plan-set/index.html
- website-live/shed-with-living-quarters/index.html
- website-live/site.config.js
- website-live/subdivision/index.html
- website-live/terms.html
- website-live/trial-terms.html
- website-live/plan-studio/app/ps-*.js (regenerated bundle chunks)
- GlideInside/ABN-SWAP-REPORT.md
