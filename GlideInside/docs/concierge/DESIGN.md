# Glide Inside AI booking and sales concierge: design (15/11/2026)

Branch `claude/concierge` (from `origin/claude/growth-base`). Status: built, tested offline, **OFF by default**, nothing deployed, no real booking created, no credential used. Companion files: `COSTS.md`, `CHANGELOG.md`, screenshots in `shots/`.

## 1. What it is

A floating assistant on five marketing pages (home, for-builders, commercial, book-a-demo, pricing). It identifies itself as AI, asks who the visitor is (Homeowner, Builder, Developer or estate, Real estate agent), answers questions from an approved knowledge file, offers the matching booking type, shows real appointment times from the scheduling provider, takes name and email, asks for an explicit Confirm click, books, and only then shows "confirmed". A non-AI route (the existing demo form, enquiry form, email) is always one click away.

**Hybrid by design.** Everything that matters is deterministic code: intent chips, qualification, FAQ answers, refusals, slots, proposals, confirmation, reconciliation, cancellation. A small model (Claude Haiku 5.5 by default, `CONCIERGE_MODEL`) is used only for free text the FAQ cannot answer, and it can only write a short reply or ask the page to show an allow-listed step.

## 2. Files

| Area | File | Purpose |
|---|---|---|
| Server | `server/lib/concierge.js` | Routes `/api/concierge/*`, config, flags, rate limits, Turnstile, per conversation cap |
| | `server/lib/booking.js` | Deterministic booking service: types, slots, propose, confirm, status (reconcile), manage |
| | `server/lib/booking-provider.js` | Provider interface, `MockProvider` (default, tests), `CalComProvider` |
| | `server/lib/booking-store.js` | Minimal booking record (D1 and memory) |
| | `server/lib/concierge-time.js` | Australia/Sydney, DST safe |
| | `server/lib/concierge-knowledge.js` | Approved knowledge, FAQ, refusals, intents |
| | `server/lib/concierge-ai.js` | Prompt, tool allow list, sanitising, budget, model call (reuses `callAnthropic` from `anthropic.js`) |
| | `server/migrations/0020_concierge_bookings.sql` | One additive table (0019 belongs to another branch) |
| Shared files edited (marked `CONCIERGE`) | `server/lib/app.js` (3 small hunks), `server/schema.sql` (table appended), `tests/live-merge.test.mjs` (migration number list) | |
| Site | `assets/concierge/launcher.js` (stub, 4 KB), `concierge.js` + `concierge.css` (fetched on first open) | |
| Shared site files (marked) | `analytics.js` (block `CONCIERGE`), `site.config.js` (`conciergeEnabled: false`), one `<script>` line in each of the 5 pages | |
| Tools and tests | `tools/concierge-dev-server.mjs`, `concierge-shots.cjs`, `concierge-cost.mjs`; `tests/concierge.test.mjs`, `concierge-analytics.test.mjs`, `concierge-helpers.mjs` | |

Reused, not duplicated: `callAnthropic`/`scrubClaims` (anthropic.js), `costMicros` (credits.js), the store's `hitRate`/`addSpend`/`getSpend` (rate limits and spend), `x-gi-request` and `HttpError`/`readJson`/`clientIp` (http.js), HMAC helpers (entitlement.js), the existing enquiry and demo forms as the handoff target.

## 3. Request flow

1. Visitor clicks the launcher. `concierge.css` and `concierge.js` load. `GET /api/concierge/config` returns flags, active booking types, intents.
2. First action calls `POST /session` (Turnstile token if configured, verified server side) and gets a signed conversation token (2 hours).
3. Intent chip and one qualifier chip (deterministic; `booking_agent_qualification_completed`).
4. Free text: `POST /message`. Order: booking words, then refusals and FAQ (free), then the model only if enabled and the monthly budget allows, else a deterministic fallback with the form links.
5. Slots: `POST /slots` (provider availability, Sydney time).
6. Details: name, email, booking consent tick (required), marketing tick (separate, unticked). `POST /propose` rechecks the slot and returns a signed 10 minute proposal. Nothing is booked or stored.
7. Confirm screen. The **Confirm booking** button sends `confirm: true` with a per attempt idempotency key to `POST /confirm`.
8. Server: verify proposal, claim atomically, recheck availability, ask the provider, store the minimal record, return `confirmed` only if the provider returned an accepted confirmation.
9. Unknown outcome: the page shows "Checking your booking", polls `POST /status`, which reconciles by provider lookup.

## 4. Booking types (all INACTIVE until the owner approves)

| Type | Duration | Audience |
|---|---|---|
| homeowner | 15 min | Homeowner consultation |
| builder | 30 min | Builder demonstration |
| developer | 30 min | Developer or estate presentation |
| agent | 20 min | Real estate agent demonstration |

Activation is the Worker variable `CONCIERGE_APPROVED_TYPES` (for example `builder,agent`). A type not listed cannot be offered, listed or booked (tested). Durations are the proposed ones and also need owner approval. Timezone Australia/Sydney throughout.

DST: all conversion goes through `Intl` with the IANA zone; days are walked by calendar date. Tested on both 2026 transitions: 05/04/2026 (03:00 AEDT to 02:00 AEST: 25 hour day, 02:30 happens twice) and 04/10/2026 (02:00 AEST to 03:00 AEDT: 23 hour day, 02:30 does not exist). The same 9:00 am local maps to different UTC either side of each change, and mock slots stay at 9:00 local across both.

## 5. Booking integrity

| Requirement | Enforced by | Test |
|---|---|---|
| Never "confirmed" without provider confirmation | `confirmed` only after `createBooking` returns `accepted`; `pending` is shown as "requested" | `never confirmed without the provider` |
| Explicit confirm click, not model text | `confirm` must be literal boolean `true` from the Confirm button; `confirm_booking` is not a model tool and a model call to it is dropped | `confirm without the explicit confirm flag`, injection tests |
| Recheck availability | at propose and again immediately before the provider call | `conflict: a slot taken between propose and confirm` |
| Idempotency key per attempt | key validated, unique index, same key returns the same result | `idempotency: the same key sent twice` |
| Duplicate submit protection | atomic claim on proposal id AND key; double click blocked in the UI | `ten simultaneous confirms`, `different key replay`, browser double click |
| Competing bookings | slot recheck plus provider conflict mapping; alternatives offered | `two visitors racing`, browser conflict flow |
| Expired availability | 10 minute proposal life, notice period, tamper check | `expired:` tests |
| Calendar outage | provider `unavailable` gives a retryable failure and nothing booked; slots show the form fallback | `provider down` |
| Ambiguous timeout | provider timeout or unclear answer gives UNKNOWN, no blind retry, reconcile by lookup (email comes from the signed proposal, never stored); 2 minute grace then "not created" | `timeout:` tests, browser checking screen |
| Unauthorised cancel or reschedule | ownership token, shown once, only its SHA-256 stored; wrong token and unknown reference answer identically; cancel needs the token | `ownership:` test |
| Minimal storage | table holds reference, idempotency key, type, slot time, status, provider id, token hash. No name, email, phone or text | `privacy: the stored booking row` |
| No live bookings in tests | `MockProvider` only; `CalComProvider` is tested with a stubbed `fetch`; `BOOKING_LIVE` defaults off | `flags:` tests |

Cal.com's v2 docs describe no idempotency header, so idempotency is implemented in our layer (claim per proposal and per key) and in reconciliation. We pass only our reference (`metadata.giRef`) to Cal.com, never personal data beyond the attendee name and email the booking needs.

Reschedule is not offered (cancel and rebook). Cal.com's own confirmation email carries its own reschedule and cancel links.

## 6. Security

- **Server side validation** of every field; text stripped of control characters and angle brackets; bodies size limited (`readJson`).
- **Request integrity**: every POST needs `x-gi-request: 1` (same pattern as profiles and portal) and a same-site `Origin` when one is sent.
- **Turnstile** (`TURNSTILE_SECRET_KEY` secret, `TURNSTILE_SITE_KEY` public) verified server side at session start. Skipped only for the mock provider with no secret. A real calendar with no secret fails closed (503).
- **Rate limits** (existing `hitRate` store): per IP per minute (20), sessions per IP per hour (10), confirm attempts per IP per hour (6) and per conversation per day (6), per hashed email per day, manage per IP; **per conversation message cap** (12). All env tunable.
- **Budget**: `AI_MONTHLY_BUDGET_AUD` (default A$10, set to 0 to disable AI) is a hard ceiling. A worst case cost is reserved before each call, settled to the real cost after. At the ceiling, or if Anthropic reports "credit balance is too low", the model is not called and the deterministic fallback is used until the next month (or UTC day for the credit error). Booking is unaffected.
- **Prompt injection**: fixed system prompt; visitor text sits inside `<visitor>` tags with angle brackets stripped so it cannot close the tag or fake a role; only the last two visitor messages are replayed as quoted data, and **no client supplied assistant turns are ever accepted**; the model gets three tools only (get_slots, propose_booking, handoff) validated against enums; replies are sanitised: false "booked or confirmed" claims replaced, system prompt leakage (canary and distinctive phrases) replaced, foreign links removed, dashes and the banned word removed.
- **No secrets in files or browser**: `CALCOM_API_KEY`, `ANTHROPIC_API_KEY`, `TURNSTILE_SECRET_KEY`, `CONCIERGE_SIGNING_SECRET` are Worker secrets only. The browser receives only the public Turnstile site key. Tests check the secret never appears in responses.
- **Privacy**: no transcripts stored anywhere (the chat exists only in the page). Proposal tokens carry name and email in the browser, signed, so the server holds nothing before confirmation. Logs carry codes only (no personal data). Nothing personal goes to GA4 (section 8).
- **Marketing opt-in** is a separate unticked box and only recorded in the proposal summary shown to the visitor. **No marketing email is sent and none is wired.** (There is no list to add to; recording the choice server side is a decision for the owner.)
- The mock provider cannot appear on the public site: it needs `CONCIERGE_ALLOW_MOCK=1`, and its bookings are labelled "test booking, nothing was scheduled".

## 7. Knowledge and AI rules

`concierge-knowledge.js` is built only from the live pages (home, pricing, for-builders, commercial, how-accurate-is-it, privacy) as at 15/11/2026: published prices only (A$30, A$25, A$10, A$50, A$15), concept only limits, data sources, contact details. It contains no feasibility, approval or setback promises, no engineering fees, no builder or competitor names, no dashes and not the word "compliant" (tested). Refusals are deterministic: "can I build / will it be approved / guarantee setbacks", engineering fees or quotes, planning and legal advice, each handing off to the enquiry form. The site has no real estate agent page, so the agent route only explains the demo and does not describe agent features. Update the knowledge file when site copy changes; nothing else may be asserted.

## 8. Analytics (GA4)

Eight events through a new helper `window.giTrackBooking` in `analytics.js` (the existing GA4 setup, no second property, no new page view tracking): `booking_agent_opened`, `booking_agent_intent_selected`, `booking_agent_qualification_completed`, `booking_slots_viewed`, `booking_agent_booking_attempt`, `booking_agent_booking_confirmed`, `booking_agent_booking_failed`, `booking_agent_handoff_requested`.

Parameters are a fixed schema of enums plus a path: `booking_type`, `intent`, `qualifier`, `slot_count` bucket, `target`, `reason`, `page_path` (path only), plus existing UTM attribution. Any other key, or a value outside its list, is dropped by the helper, so no name, email, phone, reference or chat text can leave the page. `booking_agent_booking_confirmed` is sent only when the server returned `confirmed`, once per booking (deduped), never for "requested", "unknown" or failure. Framed pages send nothing. The non-confirmation events do not use GA4 standard names; mark `booking_agent_booking_confirmed` as a key event in GA4 once live (owner action). Test and production separation: the events use the page's `ga4Id`; the staging build removes analytics.

## 9. Frontend

Vanilla JS and CSS, Glide Inside colours and fonts. Launcher stub 4 KB; the panel loads on first click only (tested: no `concierge.*` resource before the click). States: intent chips, chat, slots, contact form, confirm, success (with private manage link and cancel), error, checking (unknown), non-AI fallback, privacy note. Accessibility: dialog role with focus trap, Escape closes and returns focus to the launcher, `aria-live` announcements, labelled controls, 40 px or larger targets, visible focus. Mobile: full width bottom sheet at 390 px. The stub does nothing unless `site.config.js` sets `conciergeEnabled: true`, never runs inside `/plan-studio/`, `/portal/` or an iframe (tested), and **never covers the embedded viewer**: where the full launcher would overlap the viewer on home or commercial it shrinks to a round button, and where that would still overlap it hides until the viewer scrolls away. (This means on a narrow screen the launcher is not visible while the viewer is on screen. That is the intended trade off; the owner may prefer a fixed placement, see open decisions.)

## 10. Research (verified 15/11/2026) and what it means

**Cal.com API v2**
- Slots: `GET /v2/slots` with `eventTypeId`, `start`, `end` (UTC), `timeZone`, optional `duration`, `format=range`; header `cal-api-version: 2024-09-04`; returns `data` keyed by date. The page is inconsistent about string versus object slots, so the adapter accepts both. https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type
- Create booking: `POST /v2/bookings`, header `cal-api-version: 2026-02-25`, body `start` (UTC), `attendee {{name, timeZone, email}}`, `eventTypeId`, `lengthInMinutes`, `metadata` (50 keys, 500 chars); `201` with `status` and `data` (uid, status). No idempotency mechanism and no named error code for an unavailable slot are documented, so the adapter maps 409 and unavailable style 400s to conflict and treats 5xx and timeouts as UNKNOWN. https://cal.com/docs/api-reference/v2/bookings/create-a-booking
- Get and list: `GET /v2/bookings/{{uid}}` (2026-02-25); `GET /v2/bookings` with `attendeeEmail`, `eventTypeId`, `afterStart`, `beforeEnd`, `status`, `cursor`, `limit` (version 2026-05-01), used for reconciliation. Booking status values: accepted, pending, cancelled, rejected, awaiting_host. https://cal.com/docs/api-reference/v2/bookings/get-a-booking and .../get-all-bookings
- Cancel: `POST /v2/bookings/{{uid}}/cancel` (2026-02-25), body `cancellationReason`. https://cal.com/docs/api-reference/v2/bookings/cancel-a-booking
- Auth: `Authorization: Bearer <API key>` (keys from Settings, Security; `cal_` test, `cal_live_` live); OAuth recommended for integrations. **Rate limit 120 requests per minute per key** (raisable). https://cal.com/docs/api-reference/v2/introduction
- Plans: Individuals free (one user), Teams US$12 per user per month (yearly billing), Organizations US$28. The pricing page does not say which plans include API access, so **the owner must confirm API key creation on the plan he intends to use**. https://cal.com/pricing
- Versions in the adapter are constants (overridable) because Cal.com versions each endpoint independently.

**Fallback provider: Calendly.** `GET /event_type_available_times` (31 day window max, scope `event_types:read`) and `POST /invitees` (Scheduling API, scope `scheduled_events:write`, 201 with invitee, cancel and reschedule URLs). From 06/11/2026 POST /invitees works on the Free plan, limited to 5 bookings per user per day. https://developer.calendly.com/api-docs/calendly-api/scheduled-events/create-event-invitee and https://community.calendly.com/developer-faq-62/scheduling-api-post-invitees-and-webhooks-now-available-on-the-free-plan-6162. The provider interface is small (four methods), so a `CalendlyProvider` can be added without touching booking logic. Not built, because Cal.com meets the requirement.

**Anthropic and Cloudflare prices, and which credits can pay**: see `COSTS.md`, including the Ultra plan US$200 monthly API credits (apply to live inference, not Claude Code), the shared organisation recommendation, auto reload off, and the credit exhausted hard stop.

**Turnstile**: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response`, `remoteip`; token valid 5 minutes, single use. https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## 11. Configuration reference

Plain variables (`[vars]` in the Worker config) and secrets (`wrangler secret put`). Nothing here is set by this build.

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `CONCIERGE_ENABLED` | var | off | Master switch. Off means every concierge route answers "not available" |
| `BOOKING_LIVE` | var | off | Must be `1` before any real calendar is read or written |
| `BOOKING_PROVIDER` | var | `mock` | `mock` or `calcom` |
| `CONCIERGE_ALLOW_MOCK` | var | off | Allows the mock provider (tests and staging only) |
| `CONCIERGE_APPROVED_TYPES` | var | empty | Comma list of approved booking types |
| `CALCOM_EVENT_TYPE_HOMEOWNER` / `_BUILDER` / `_DEVELOPER` / `_AGENT` | var | none | Cal.com event type ids |
| `CALCOM_API_KEY` | **secret** | none | Cal.com API key |
| `CALCOM_API_BASE`, `CALCOM_TIMEOUT_MS` | var | `https://api.cal.com`, 8000 | |
| `CONCIERGE_MODEL` | var | `claude-haiku-5-5` | Model for free text |
| `CONCIERGE_AI` | var | on | `0` disables the model (FAQ and booking only) |
| `AI_MONTHLY_BUDGET_AUD` | var | 10 | Monthly hard ceiling for concierge model spend |
| `ANTHROPIC_API_KEY` | secret (existing) | | Shared with the design assistant |
| `TURNSTILE_SECRET_KEY` | **secret** | none | Server side check |
| `TURNSTILE_SITE_KEY` | var | none | Public key handed to the widget |
| `CONCIERGE_SIGNING_SECRET` | **secret** | falls back to `ENTITLEMENT_SECRET` | Signs conversation and proposal tokens |
| `CONCIERGE_MAX_MESSAGES`, `_IP_PER_MIN`, `_IP_SESSIONS_PER_HOUR`, `_IP_CONFIRMS_PER_HOUR`, `_EMAIL_BOOKINGS_PER_DAY` | var | 12, 20, 10, 6, 3 | Limits |
| `CONCIERGE_NOTICE_HOURS`, `_HORIZON_DAYS`, `_PROPOSAL_TTL_MIN`, `_RECONCILE_GRACE_MS` | var | 12, 21, 10, 120000 | Booking window |
| `conciergeEnabled` | site.config.js | false | Shows the launcher |

## 12. Owner setup steps (in order; none done by this build)

1. **Approve** the booking types and durations (section 4) and the page set.
2. **Cal.com account**: create or use the owner's account. Set availability in the Australia/Sydney timezone. Confirm API keys are available on the plan (Settings, Security). If not, Teams at US$12 per user per month.
3. **Event types**: create four, with the durations above, a minimum notice of at least 12 hours, buffers as wanted, no host approval (so a booking is `accepted`; if approval is required the UI says "requested", not "confirmed"). Collect only name and email. Choose the meeting location. Note each event type id.
4. **API key**: create a key in Cal.com, then in a terminal run `wrangler secret put CALCOM_API_KEY` and paste it. **Never paste it into chat or files.**
5. **Turnstile**: in the Cloudflare dashboard create a widget for glideinside.com.au; `wrangler secret put TURNSTILE_SECRET_KEY`; set `TURNSTILE_SITE_KEY` as a var.
6. **Anthropic**: claim the Ultra API credits by linking one Console organisation (claude.ai, Settings, Billing, API credits); create a workspace and key for production; auto reload OFF; set a workspace spend limit; `wrangler secret put ANTHROPIC_API_KEY` (already set for the design assistant: the same organisation serves both).
7. **Apply the migration**: `npx wrangler d1 migrations apply pocket-architect` (adds `concierge_bookings`; additive). Migration 0019 is on another branch; D1 applies in order, so apply after that branch merges or accept the gap (the numbering test in `live-merge.test.mjs` lists 0020 after 0018).
8. **Staging first**: deploy to the staging Worker with `BOOKING_PROVIDER=calcom`, `BOOKING_LIVE=1`, one approved type, and a Cal.com test event type; make one booking and cancel it; check the confirmation email and the GA4 DebugView.
9. **Privacy policy and notifications review** (section 13).
10. **Go live**: set `CONCIERGE_ENABLED=1`, `BOOKING_LIVE=1`, `CONCIERGE_APPROVED_TYPES`, and `conciergeEnabled: true` in `site.config.js` (the upload zip's `find assets` picks up `assets/concierge/`; `golive/UPLOAD_FILES.txt` is generated and needs regenerating).

## 13. Approvals and reviews needed before activation

- Booking types and durations (owner).
- Cal.com plan and API availability, meeting location, event type settings (owner).
- **Privacy policy**: `privacy.html` already names Anthropic (United States) and Cloudflare. It does not mention the booking calendar provider or the booking assistant. Proposed addition (not applied, needs the owner's and legal review): "Booking assistant: if you use the assistant on this site to book a time, your name and email are sent to our scheduling provider, Cal.com, to make and confirm the booking. We keep only a booking reference and the time. We do not keep the chat. Your questions to the assistant are processed by Anthropic in the United States. Marketing is opt in and never ticked for you." Also add Cal.com to the list of providers, and Cloudflare Turnstile.
- **Transactional notifications**: the booking confirmation and reminder emails come from Cal.com, not from us. Review its default templates (wording, "compliant" free, branding) before go live. This build sends no email and no SMS.
- Marketing opt-in handling: the box is recorded in the proposal only; no marketing is sent. Decide whether to store opt-ins.
- GA4: mark `booking_agent_booking_confirmed` as a key event.

## 14. Rollback

Every layer is independently switchable, fastest first:
1. Set `CONCIERGE_ENABLED` to `0` (or delete it) in the Worker vars: the API answers "not available", the launcher shows the plain form fallback on next open. Takes effect on deploy of vars only.
2. Set `conciergeEnabled: false` in `site.config.js` and re-upload that one file: the launcher stub does nothing and no panel loads.
3. Remove the `<script ... launcher.js>` line from the five pages (marked `CONCIERGE`) and the `CONCIERGE` block in `analytics.js`.
4. Revert the branch merge. The only schema change is the additive table `concierge_bookings` (no live table depends on it, so it can stay or be dropped later). No shared table or existing endpoint changed.
5. Cal.com side: events already booked stay in Cal.com; cancel from its dashboard. Revoke the API key to stop all access.

## 15. Findings and open items

| Class | Item |
|---|---|
| CONFIRMED | `live-merge.test.mjs` hard codes the migration number list; this branch adds `0020` and the other branch adds `0019`; expect a merge edit to that one line |
| CONFIRMED | The existing assistants treat Anthropic's "credit balance too low" as a generic AI error (not changed here) |
| SUSPECTED | `CalComProvider` has never spoken to the real Cal.com (no key); request and response shapes follow the docs. The slot response format and the 400 body for a taken slot need one real test on staging |
| SUSPECTED | Cal.com free plan may not include API keys |
| SUSPECTED | Turnstile was exercised only against a stub |
| SUSPECTED | Rate limit rows hold the raw IP transiently (existing pattern in this Worker); consider hashing |
| PROPOSED | Treat the credit error as AI_PAUSED in the existing assistants |
| PROPOSED | `CalendlyProvider` as a second provider |
| PROPOSED | Store marketing opt-in server side only once a list exists |
| PROPOSED | Real estate agent landing page (the site has none; the concierge cannot describe agent features) |
| DECISION | Launcher placement over embedded viewers (hide or compact versus a fixed placement) |

## 16. Verification

`node --test tests/concierge.test.mjs tests/concierge-analytics.test.mjs` (61 tests, offline). `PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright node tools/concierge-shots.cjs growth/concierge/shots` runs 100+ browser checks at 1440 and 390 px and writes the screenshots. See `CHANGELOG.md` for the run results.
