# Glide Inside AI booking and sales concierge: design (15/11/2026)

Branch `claude/concierge` (from `origin/claude/growth-base`). Status: built, tested offline, **OFF by default**, nothing deployed, no real request sent, no credential used. **Revised 15/11/2026 on the owner's decision: the default flow is "Request a call back" (no calendar). The booking calendar code is kept but is off.** Companion files: `COSTS.md`, `CHANGELOG.md`, screenshots in `shots/`.

## 0. Revision 15/11/2026: Request a call back is the default

Owner decision: no calendar integration for now. The visitor asks for a call and the owner is emailed.

- Flow: intent chip, qualifier chip, optional questions, then the call back form: name, phone (required), email, customer type, best time to call (morning, afternoon, evening, or a note), short notes. A separate consent box (required) and a separate marketing box (unticked). The page path and the `utm_campaign` value are added by the page, not typed by the visitor. A review screen follows, then an explicit **Send call back request** button.
- Server: `POST /api/concierge/callback` checks the conversation token, the explicit `confirm: true`, consent, an attempt key, then calls the **existing** `handleEnquiry` in `server/lib/enquiry.js`: validation reused, saved to `jce_enquiries` first, then emailed through Resend only when `RESEND_API_KEY` is set (reply-to is the visitor), enquiry rate limits reused. No new email provider and no new table. If email is not configured, or Resend fails, the request is still saved (the owner reads it in the admin route) and the visitor still sees the thanks.
- The email goes to the owner only (`ENQUIRY_TO`). Subject `[GI-XXXXX] Call back request (Builder): name, phone`. The body holds name, phone, email, type, best time, notes, page, campaign, marketing opt in, reference, and states that nothing has been booked. Nothing is ever sent to the visitor.
- Visitor message: "Thanks, your request is with Jayden at Glide Inside. He will call you, usually within one business day." The page and the AI never say a booking or appointment exists and never promise a time (a reply that does is replaced, tested).
- Edits to a shared file, `server/lib/enquiry.js` (marked CONCIERGE): `callback` added to the allowed needs, a call back summary and subject, optional `callback` details, and an optional fixed `reference` so a replayed submit is idempotent. The existing `/api/enquiry/jce` behaviour for the other needs is unchanged (`enquiry.test.mjs` passes).
- Calendar code: `booking.js`, `booking-provider.js` (Cal.com and mock), slot and booking screens remain, but appear only when `BOOKING_PROVIDER=calcom` with `BOOKING_LIVE=1` and approved types. The mock provider is used only in tests and the preview server. With the default settings `/slots`, `/propose`, `/confirm` answer 503 and the page shows no slot UI.
- GA4: `booking_agent_callback_requested` replaces `booking_agent_booking_confirmed` in the default flow. It is sent only after the server accepted the request, once per request (deduplicated, never sent as a parameter), with only the intent and page path. `booking_agent_booking_confirmed` remains for the calendar flag only. The other events are unchanged. `booking_agent_booking_failed` gains the reason `callback_error`.
- Duplicate submit: one attempt key makes one request; a replay returns the same reference and sends nothing again (tested with six simultaneous submits). The page generates a new key after any definite error. Known gap (SUSPECTED): if the first attempt dies after the key is counted but before the request is saved, a replay of the same key would report success. The page never replays a key after a definite error, and the enquiry is saved before email.
- Rate limits: concierge per IP per minute, sessions per IP per hour, call back requests per IP per hour (4) and per conversation per day (3), plus the enquiry pipeline's own limits (per IP 5 an hour and per email 3 a day). Invalid requests do not use up the limits.
- Prompt injection: the model has no tool that sends anything. It may only ask the page to open the form (`request_callback`), and the visitor must press the send button. Tests: model output claiming a booking or a time is replaced; fake tool names and `confirm_booking` are dropped; text asking to submit only opens the form; a non literal `confirm` is refused.

Sections 1 to 16 below describe the whole build. Where they speak of booking, slots or a calendar they now apply only to the optional calendar flag. Section 12 has the updated owner setup list.

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
| `RESEND_API_KEY`, `ENQUIRY_TO`, `ENQUIRY_FROM` | secret and vars (existing, enquiry form) | | Call back email to the owner. Unset key: saved only |
| `CONCIERGE_IP_CALLBACKS_PER_HOUR` | var | 4 | Call back requests per IP per hour |
| `BOOKING_LIVE` | var | off | Must be `1` before any real calendar is read or written |
| `BOOKING_PROVIDER` | var | none (call back only) | `calcom` switches the optional calendar flow on (with `BOOKING_LIVE=1`). `mock` only with `CONCIERGE_ALLOW_MOCK=1` for tests |
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

Default flow (call back). Everything is a Worker variable or secret that the owner sets himself:

1. **Resend** (already used by the enquiry form): the existing `RESEND_API_KEY` secret and verified sending domain serve the concierge too. If the enquiry form already emails the owner, nothing more is needed. The email goes to the address already used by the enquiry form, `ENQUIRY_TO` (code default `enquiries@jceinfrastructure.com.au`); the sender is `ENQUIRY_FROM`. Without `RESEND_API_KEY` requests are still saved and are read in the admin enquiry route.
2. **Turnstile**: create a widget for glideinside.com.au in the Cloudflare dashboard; `wrangler secret put TURNSTILE_SECRET_KEY`; set `TURNSTILE_SITE_KEY` as a variable. (Without a secret the concierge refuses to start a chat on the live site by design.)
3. **Anthropic**: claim the Ultra API credits by linking one Console organisation (claude.ai, Settings, Billing, API credits); create a workspace and a production key; auto reload OFF; set a workspace spend limit; `ANTHROPIC_API_KEY` is already a secret for the design assistant (the same organisation serves both). Set `AI_MONTHLY_BUDGET_AUD` (section COSTS 6). Or set `CONCIERGE_AI=0` to run with the free FAQ only.
4. **Signing secret**: the existing `ENTITLEMENT_SECRET` is used unless `CONCIERGE_SIGNING_SECRET` is set.
5. **Privacy policy and the notification wording** (section 13) approved and applied.
6. **Staging first**: deploy to the staging Worker with `CONCIERGE_ENABLED=1`; send one request from the staging site; check the email arrives with name, phone, email, type, best time, notes, page and reference, the row appears in the admin route, and GA4 DebugView shows `booking_agent_callback_requested` once with no personal data. Then send one with `RESEND_API_KEY` unset to confirm it is still saved.
7. **Go live**: set `CONCIERGE_ENABLED=1` in the Worker variables, then `conciergeEnabled: true` in `site.config.js`, then upload the five pages, `analytics.js`, `site.config.js` and `assets/concierge/*` (the upload zip's `find assets` picks the folder up; `golive/UPLOAD_FILES.txt` is generated and needs regenerating). Mark `booking_agent_callback_requested` as a key event in GA4.
8. The owner is the person who calls back. Decide who answers the new email and keep to "usually within one business day", which is what the page promises.

Not needed for this flow: Cal.com account, event types, `CALCOM_API_KEY`, migration 0020 (the migration only adds the calendar's `concierge_bookings` table; the call back flow uses the existing `jce_enquiries` table).

Optional calendar flow (later, only if the owner decides): the original steps. Approve the booking types and durations (section 4); create the Cal.com account and four event types (Sydney availability, notice at least 12 hours, no host approval, name and email only); confirm API key access on the plan; `wrangler secret put CALCOM_API_KEY`; apply migration 0020 (`npx wrangler d1 migrations apply pocket-architect`; 0019 is on another branch); set `BOOKING_PROVIDER=calcom`, `CALCOM_EVENT_TYPE_*`, `CONCIERGE_APPROVED_TYPES`, `BOOKING_LIVE=1`; run a staging smoke test with a test event type before go live.

## 13. Approvals and reviews needed before activation

- **Privacy policy**: `privacy.html` already names Anthropic (United States) and Cloudflare. It does not mention the website assistant or call back requests. Proposed addition (not applied, needs the owner's and legal review): "Website assistant: if you use the assistant on this site to ask for a call back, your name, phone number, email address and note are sent to us by email and kept so we can call you. We do not keep the chat. Your questions to the assistant are processed by Anthropic in the United States. Marketing is opt in and never ticked for you." Also add Cloudflare Turnstile (spam check) if it is not already listed.
- **Notification wording**: the only email is the one to the owner. No email or SMS goes to the visitor. Check the call back email text in `enquiry.js` (`summaryText`) reads as the owner wants.
- **The promise on the page**: "usually within one business day" is the owner's chosen wording. Confirm he can keep it.
- Marketing opt-in handling: the box is recorded in the request (the email says yes or no); no marketing is sent. Decide whether to keep a list.
- GA4: mark `booking_agent_callback_requested` as a key event.
- Calendar flag only, if ever used: booking types and durations (section 4), Cal.com plan and API availability, meeting location, event type settings, Cal.com's own confirmation emails.

## 14. Rollback

Every layer is independently switchable, fastest first:
1. Set `CONCIERGE_ENABLED` to `0` (or delete it) in the Worker vars: the API answers "not available", the launcher shows the plain form fallback on next open. Takes effect on deploy of vars only.
2. Set `conciergeEnabled: false` in `site.config.js` and re-upload that one file: the launcher stub does nothing and no panel loads.
3. Remove the `<script ... launcher.js>` line from the five pages (marked `CONCIERGE`) and the `CONCIERGE` block in `analytics.js`.
4. Revert the branch merge. The only schema change is the additive table `concierge_bookings` (no live table depends on it, so it can stay or be dropped later). No shared table or existing endpoint changed.
5. Call back requests already received stay in `jce_enquiries` (read them in the admin route); reverting the `enquiry.js` hunk does not remove them.
6. Calendar flag only: events already booked stay in Cal.com; cancel from its dashboard. Revoke the API key to stop all access.

## 15. Findings and open items

| Class | Item |
|---|---|
| CONFIRMED | `live-merge.test.mjs` hard codes the migration number list; this branch adds `0020` and the other branch adds `0019`; expect a merge edit to that one line |
| CONFIRMED | `jce_enquiries.need` now also holds `callback` (a TEXT column, no constraint); the admin route lists it like any need. Any report that groups by need must expect the new value |
| CONFIRMED | The existing assistants treat Anthropic's "credit balance too low" as a generic AI error (not changed here) |
| SUSPECTED | A replayed attempt key reports success even if the first attempt failed after the key was counted (the page never replays a key after an error; the enquiry is saved before email) |
| SUSPECTED | Call back email deliverability depends on the existing Resend domain; not tested live |
| SUSPECTED | (calendar flag only) `CalComProvider` has never spoken to the real Cal.com (no key); request and response shapes follow the docs. The slot response format and the 400 body for a taken slot need one real test on staging |
| SUSPECTED | Cal.com free plan may not include API keys |
| SUSPECTED | Turnstile was exercised only against a stub |
| SUSPECTED | Rate limit rows hold the raw IP transiently (existing pattern in this Worker); consider hashing |
| PROPOSED | Treat the credit error as AI_PAUSED in the existing assistants |
| PROPOSED | `CalendlyProvider` as a second provider |
| PROPOSED | Store marketing opt-in server side only once a list exists |
| PROPOSED | Real estate agent landing page (the site has none; the concierge cannot describe agent features) |
| DECISION | Launcher placement over embedded viewers (hide or compact versus a fixed placement) |

## 16. Verification

`node --test tests/concierge.test.mjs tests/concierge-callback.test.mjs tests/concierge-analytics.test.mjs` (75 tests, offline). `PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright node tools/concierge-shots.cjs growth/concierge/shots` runs 103 browser checks (call back flow, then the optional calendar flow) at 1440 and 390 px and writes the screenshots. See `CHANGELOG.md` for the run results.
