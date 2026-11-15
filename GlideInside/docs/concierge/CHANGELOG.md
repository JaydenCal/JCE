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

## 15/11/2026 (later), owner decision: Request a call back replaces booking as the default

Changed
- Default flow is a call back request. Form: name, phone (required), email, customer type, best time (morning, afternoon, evening or a note), notes, page and campaign added by the page. Review screen, then an explicit send button.
- Goes through the existing `handleEnquiry` (`server/lib/enquiry.js`): saved to `jce_enquiries` first, then emailed to the owner through Resend when `RESEND_API_KEY` is set, reply-to the visitor. Still saved when email is not configured or fails. No email to the visitor.
- Visitor wording: "Thanks, your request is with Jayden at Glide Inside. He will call you, usually within one business day." Neither the page nor the AI says a booking or appointment exists or promises a time (replies that do are replaced).
- Cal.com and slot code kept, behind `BOOKING_PROVIDER=calcom` and `BOOKING_LIVE=1`, off by default. Slot UI hidden unless that is on. The mock provider is used only in tests and preview.
- GA4: `booking_agent_callback_requested` (server success only, once per request, no personal data) replaces `booking_agent_booking_confirmed` in the default flow; reason `callback_error` added to the failed event.
- New tests `tests/concierge-callback.test.mjs` (13): success, email not configured, email failure, validation, rate limits, duplicate and concurrent submit, injection, no promise replies, slot UI off, flags. Analytics test added. Shots regenerated with the call back flow (`*-cb-*`).
- COSTS.md: calendar cost removed; token figures refreshed. DESIGN.md: section 0 and the owner setup list rewritten (Resend key and the existing `ENQUIRY_TO`).
- Shared file edit: `server/lib/enquiry.js` (marked CONCIERGE).
