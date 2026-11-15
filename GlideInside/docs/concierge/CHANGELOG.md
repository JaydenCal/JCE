# Concierge changelog

## 15/11/2026, branch claude/concierge (OFF by default)

Added
- Booking service with provider adapter, MockProvider (default) and CalComProvider (never run live), minimal booking store, migration 0020, Sydney DST safe time.
- Concierge API `/api/concierge/*`, deterministic FAQ and refusals, optional small model with budget hard stop, Turnstile, rate limits, CSRF header.
- Launcher stub and on demand panel (marketing pages only, behind `conciergeEnabled`), GA4 helper `giTrackBooking`.
- Tests: 56 concierge and 5 analytics (node --test); 286 pass in the regression set (live-merge, server, commercial-assistant, enquiry, portal-server, free-profile with the above). Playwright shots at 1440 and 390 px in `shots/`.

Changed (shared files, marked CONCIERGE): `server/lib/app.js`, `server/schema.sql`, `tests/live-merge.test.mjs` (migration list), `analytics.js`, `site.config.js`, five page `<script>` lines.

Not done: any deploy, upload, Cloudflare change, secret, real booking, email or SMS.

Rollback: see DESIGN.md section 14.
