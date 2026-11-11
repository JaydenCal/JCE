# Builder and client accounts: API contract

Status: the Worker routes below are built (`server/lib/portal*.js`, branch `claude/glide-portal-backend`, tests in `tests/portal-server.test.mjs`) and the front end still runs on the in-browser mock until `CONFIG.portalMock` is turned off. This file is the contract both sides meet so the screens work unchanged. Section 13 lists where the real server differs from the first draft of this contract and how to go live.

How the pieces fit:

| File | Purpose |
|---|---|
| `src/portal/api.js` | One function per call (`CALLS`). `CONFIG.portalMock` true picks the mock, false picks `createHttpApi` (fetch to `{apiBase}/portal/...`). |
| `src/portal/mock-api.js` | Same contract in the browser (localStorage). Keeps plain-text passwords for review only. |
| `src/portal/place-house.js` | Puts a house design on the lot as ordinary editable walls, rooms and openings (with `mirrored`). |
| `src/portal/fit.js`, `envelope.js` | Fit ranking for the house picker. `envelope.js` uses `buildEnvelope` from `src/site/setbacks.js` (branch claude/glide-setbacks) when present, otherwise a convex-lot stub with the same signature. |
| `src/portal/client-mode.js` | The signed-in strip and house picker inside Pocket Architect. |
| `website-live/portal/` | The portal page (sign in and dashboard). `node tools/sync-portal.mjs` copies the modules it needs into `portal/src/`. |

Launch gating: everything is behind `CONFIG.portalEnabled`. `REVIEW_BUILD` in `src/config.js` is `false` by default, so a production build keeps it closed; the review build sets `REVIEW_BUILD = true` (portal on, in-browser mock on). The host page can override with `GI_CONFIG.portalEnabled` and `GI_CONFIG.portalMock`. The Worker has its own switch, `PORTAL_ENABLED`. When false the portal page shows "not open yet" and Pocket Architect ignores any portal session.

## 1. Conventions

- JSON in and out. Errors: `{ "error": { "code": "...", "message": "...", ...extra } }` with the HTTP status below.
- Sessions: an `HttpOnly; Secure; SameSite=Lax; Path=/api` cookie `gi_session` holding a random 32 byte token (only its SHA-256 is stored in D1). 30 day **sliding** expiry (the cookie is refreshed while in use), with a 90 day absolute cap. Every state changing call (any method but GET) needs the header `X-GI-Request: 1` (a cross-site form cannot send it; `src/portal/api.js` always sends it) and, when the browser sends an `Origin` header, it must equal `SITE_URL`, otherwise `403 FORBIDDEN`. CORS allows credentials only for `SITE_URL`.
- Money is integer cents, A$ incl. GST. GST is `total / 11`.
- Dates are ISO 8601 UTC. Billing months use the Sydney calendar (`Australia/Sydney`), key `YYYY-MM`.
- Roles: `admin` (everything), `designer` (houses, read clients, read projects; no issuing logins, billing, team, branding or settings), `client`. Permissions: admin has `houses.write clients.read clients.write billing.read billing.write team.read team.write branding.write projects.read`; designer `houses.write clients.read projects.read`; client none. `org.billingContact` in `me` is sent to admins only.
- Error codes: `UNAUTHORISED` 401, `INVALID_CREDENTIALS` 401, `PASSWORD_EXPIRED` 401, `ACCOUNT_LOCKED` 423 (with `retryAfter` seconds), `ACCOUNT_DISABLED` 403, `PASSWORD_CHANGE_REQUIRED` 403, `FORBIDDEN` 403, `TOPUPS_DISABLED` 403, `NOT_FOUND` 404, `CONFLICT` 409, `BAD_REQUEST` 400, `PAYLOAD_TOO_LARGE` 413, `CREDITS_EXHAUSTED` 402, `RATE_LIMITED` 429.

## 2. Calls

Paths are under `{apiBase}` (default `/api`). "Staff" means admin or designer.

### Session and password

| Call | Route | Body / result |
|---|---|---|
| `signIn` | `POST /portal/session` | `{ identifier, password }` (email or username). Returns `me`. Sets the cookie. A client's first successful sign in creates the billing row (section 4). |
| `signOut` | `DELETE /portal/session` | `{ ok }`. |
| `me` | `GET /portal/me` | `{ user, org, permissions[], houseAccess, lotAddress, ai, canTopUp, plansIncluded, enquiry, exports[] }`. `exports` is `['pdf','dxf','glb','obj']` for staff and `['pdf']` for clients unless the org allows CAD. `enquiry` is false for a client when `allowClientEnquiries` is off. While `mustChangePassword` is true every call except `me`, `changePassword` and `signOut` answers `PASSWORD_CHANGE_REQUIRED`. |
| `changePassword` | `POST /portal/password` | `{ currentPassword, newPassword }`. Rules in section 6. Clears `mustChangePassword`. |
| `requestPasswordReset` | `POST /portal/password/reset-request` | `{ email }`. Always answers `{ ok: true }` (no account enumeration). **The real server sends no email, so it creates no link**: staff ask an admin, who generates a temporary password (`resetStaffPassword`). Clients have no self service reset: the builder issues a new password. |
| `completePasswordReset` | `POST /portal/password/reset` | `{ token, newPassword }`. The real server has no tokens, so it always answers `400 BAD_REQUEST` (expired link). Built only for the day an email sender is added. |

### House library (staff)

`listHouses({ includeArchived })` `GET /portal/houses`; `getHouse(id)` `GET /portal/houses/:id` (returns `project`); `saveHouse({ id?, name, project?, fromGlideId?, description? })` `POST /portal/houses`; `duplicateHouse(id)` `POST .../duplicate`; `archiveHouse(id)` `POST .../archive`. Clients get `listHouses` and `getHouse` filtered by their `houseAccess` (`'all'` or a list of house ids). A house record: `{ id, name, description, source, stats: { bedrooms, bathrooms, garage, floorAreaM2, widthMm, depthMm, storeys }, thumbnail?, archived, updatedAt }`. Proposal: also return a precomputed `footprint` (ground floor convex outline) in the list so the picker can rank without fetching every project.

### Glide Inside library

`listGlideLibrary()` `GET /portal/glide-library`, `getGlideModel(id)` `GET /portal/glide-library/:id`. Read only, shared by all builders. The server lists `src/portal/glide-library.generated.js` and builds each model's project from the `src/catalogue/tpl` templates on request. For client logins both answer empty / `NOT_FOUND` when the org setting `showGlideToClients` is false.

### Clients (staff; issuing needs admin)

- `listClients()` `GET /portal/clients`: `[{ id, name, username, email, status, lotAddress, houseAccess, projectCount, lastSignInAt, mustChangePassword, tempPasswordExpiresAt, billed, ai: { month, monthlyCap, used, monthlyRemaining, topUpBalance, remaining, total } }]`.
- `issueClientLogin({ firstName, email?, lotAddress?, houseAccess? })` `POST /portal/clients`: only `firstName` is required. Returns `{ client, credentials: { username, password }, charge: { amountCents: 2000, trigger: 'first_sign_in', note } }`. The password is returned this once and never again. Nothing is billed here.
- `updateClient(id, patch)`, `disableClient(id)`, `enableClient(id)`, `resetClientPassword(id)` (new temporary password, shown once, free).
- `deleteClient(id)` `DELETE /portal/clients/:id`: removes the login and all their projects. Returns `{ ok, removedProjects, charged }` (`charged` is true if the login had already been billed; that charge stays). An unused login (never signed in) is deleted free and never appears on an invoice.
- `exportClientProjects(id)` `GET /portal/clients/:id/export`: `{ client, exportedAt, projects: [{ id, name, updatedAt, project }] }`.

### Projects

`listProjects({ clientId? })` `GET /portal/projects` (clients: their own; staff: all, optionally one client), `openProject(id)` `GET /portal/projects/:id` (staff can open any client's project), `saveProject({ id?, name, project, lotAddress? })` `POST /portal/projects` (validates with `migrate`, max 4 MB).

### Billing (admin; designers read nothing)

- `monthUsage({ month? })` `GET /portal/billing/usage`: `{ month, logins: [{ loginId, clientName, firstSignInAt, amountCents }], topUps: [{ id, loginId, clientName, credits, amountCents, createdAt }], totals: { loginsCount, loginsCents, topUpsCount, topUpsCents, totalCents, gstCents } }`.
- `listInvoices()`, `getInvoice(id)`: see section 5.
- `getBillingContact()` / `setBillingContact({ name, email, phone, legalName, abn })`: `legalName` and an 11 digit `abn` are required (stored as `51 824 753 556`).

### AI credits

- `aiBalance()` `GET /portal/ai`: monthly allowance per login (default cap 150, org setting `aiMonthlyCap`), a top-up balance, `remaining = monthlyRemaining + topUpBalance`. Monthly credits are used first. **Hard stop at zero**: the AI proxy answers `CREDITS_EXHAUSTED` 402.
- `aiTopUp()` `POST /portal/ai/top-up`: 300 credits for A$10 incl. GST, added at once. Creates the billable event `{ orgId, loginId, credits: 300, amountCents: 1000, createdAt }` (table `ai_topups`), charged on the builder's end of month invoice. Clients may only do this when `allowClientTopUps` is true (default true); staff always can.
- `spendAiCredits({ credits })`: server side use by the AI proxy, not called from screens.

### Team (admin)

`listTeam()`, `inviteStaff({ firstName, email?, role })` (Generate account for staff: same generator, no charge, role `admin` or `designer`), `updateStaff(id, patch)`, `resetStaffPassword(id)`, `disableStaff(id)`, `enableStaff(id)`. Staff are not charged.

### Branding and settings (admin)

- `setBranding({ displayName, logoDataUrl })`: PNG or JPEG or SVG data URL, scaled to 600 px wide by the screen, max 400 KB.
- `setOrgSettings({ allowClientTopUps, allowClientEnquiries, showGlideToClients, allowClientCadExports })` `PATCH /portal/org/settings`. Defaults: top-ups on, enquiries on, show Glide library on, client CAD exports **off**.

### Send to JCE

`enquiryJce(body)` `POST /api/enquiry/jce` (not under `/portal`; also open to public Plan Pack users, no cookie needed). See section 9.

## 3. Generated usernames and passwords

`src/portal/credentials.js` (crypto RNG, `crypto.getRandomValues` with rejection sampling).

- Username: first name lower-cased, accents and punctuation removed (spaces and hyphens split the name; the first part is used), then `-` and four digits from `2-9` only (no 0, 1: they look like O, l, I). Example `sarah-4821`. Unique across the whole system (the sign in form takes only a username for clients), regenerated on a clash.
- Password: two words from a built-in list of 508 short, common, simple words plus two digits `2-9`, for example `river-maple-47`. The list excludes offensive words and look-alikes (checked by substring and whole-word rules in the tests). About 508 x 507 x 64 = 16.5 million combinations: acceptable only because it is temporary, expires in 7 days, is forced to change on first sign in and sign in is rate limited.
- Shown once with Copy and Copy both. The same generator is used for staff logins and for resets.

## 4. Billing rules

- A$20 incl. GST per client login, **no monthly fee**.
- Charged at the client's **first successful sign in**, not when the login is generated. The row `{ orgId, loginId, chargedAt, amountCents: 2000 }` is created once (unique on `login_id`) in the Sydney month of that first sign in. Generate screen text: "A$20 incl. GST is charged on your monthly invoice once your client first signs in."
- Resetting passwords, disabling logins, staff logins and deleting an unused login are free.
- AI top-up: A$10 incl. GST per 300 credits, charged on the end of month invoice.
- Month total = A$20 x new logins (first sign in that month) + A$10 x top-ups.
- Invoices are produced after month end by a scheduled Worker (06:00 on the 1st, Sydney time) through the Stripe REST API: one invoice per organisation per month, `send_invoice`, due in 14 days, prices GST inclusive (an inclusive 10% GST tax rate on each item). Stripe emails the invoice; this server sends no email. Idempotent per organisation and month. **Test mode only** until the owner gives written go-ahead for live billing (a live key is refused). The login charge row is `login_issues` (this draft called it `login_charges`) and top-ups are the AI branch's `ai_topup` events. See `server/README.md`.

## 5. Tax invoices

`getInvoice(id)` returns a valid Australian tax invoice:

```json
{
  "title": "Tax invoice",
  "number": "GI-SHM-202610",
  "issuedAt": "2026-11-01T...", "dueAt": "2026-11-15T...", "month": "2026-10",
  "seller": { "name": "JCE Infrastructure Pty Ltd trading as Glide Inside", "abn": "29 699 165 663" },
  "buyer": { "name": "<billing legalName>", "abn": "<billing ABN>", "email": "..." },
  "lines": [ { "description": "New client logins first signed in during October 2026 (A$20 each, incl. GST)", "quantity": 3, "unitCents": 2000, "totalCents": 6000 },
             { "description": "AI credit top-ups of 300 credits (A$10 each, incl. GST)", "quantity": 1, "unitCents": 1000, "totalCents": 1000 } ],
  "subtotalExGstCents": 6364, "gstCents": 636, "totalInclGstCents": 7000,
  "status": "due"
}
```

The seller is set by the owner's decision of 11/11/2026 and held in the server variables `SELLER_NAME` and `SELLER_ABN` (defaults as above). It carries the seller name and ABN, the words "Tax invoice", the date, a description of the supply, the GST amount and the total including GST. The builder's legal name and ABN are required in Billing settings before an invoice can be generated (the Billing tab warns until they are set). A buyer ABN is required for the invoice to be a valid tax invoice above A$1,000 and is good practice always.

## 6. Passwords, sessions and lockout

- Temporary passwords (generated for clients, staff and resets) expire after **7 days** if unused (`PASSWORD_EXPIRED`). The builder issues a new one.
- First sign in with a temporary password forces a change before anything else (`PASSWORD_CHANGE_REQUIRED`). New passwords: minimum **10 characters**, not on the common password list (`src/portal/common-passwords.js`, extend it with the top 10,000 list on the server), must not contain the username or email local part, must differ from the temporary one.
- **Lockout**: 5 consecutive failed sign ins lock the account for 15 minutes (`ACCOUNT_LOCKED`, `retryAfter`). A successful sign in clears the counter. Also rate limit by IP (`store.hitRate`), 20 attempts per 10 minutes. Failed attempts answer the same `INVALID_CREDENTIALS` message for unknown users and wrong passwords.
- **Hashing: PBKDF2-HMAC-SHA-256 through Web Crypto (`crypto.subtle.deriveBits`)**, a 16 byte random salt per user, a 32 byte output, stored as `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>` so the iteration count can be raised later and old hashes upgraded at next sign in. **Iteration limit:** Cloudflare Workers caps PBKDF2 at **100,000 iterations**; requests above the cap throw. Use 100,000 (the maximum allowed). That is below the OWASP figure of 600,000 for SHA-256, so the length rule, the common password list, the lockout and the rate limit carry more weight. Confirm the cap against current Workers documentation at build time, and compare in constant time. If the cap makes this unacceptable, hash in a separate Node service or use a Workers-compatible Argon2 (WASM) build.
- Session cookie as section 1. Sign out deletes the row. Changing a password signs out the user's other sessions. Disabling a login deletes its sessions at once.
- Reset tokens: 32 random bytes, SHA-256 stored, 1 hour, single use.

## 7. Export policy and terms

- **Clients** get a builder-branded **PDF plan set only** by default (`me().exports = ['pdf']`). DXF and the 3D models (GLB, OBJ) are enabled per builder with `allowClientCadExports` (default off). The Exports menu shows only the allowed types, and the client app refuses the others.
- **Builder staff always** get the PDF plans plus DXF and 3D (`['pdf','dxf','glb','obj']`).
- PDFs carry the builder's logo in the title block.
- **Terms: IP licence clause (to be added to the Glide Inside terms of use).** The Glide Inside house designs and Pocket Architect output remain the intellectual property of Glide Inside (and of the builder for the builder's own designs). A client login holder is licensed to use the plans supplied through the portal only for their own project on their own lot, through their builder, and may not copy, resell, share, or use the designs, drawings or model files for any other project, or give them to another builder or designer, without written permission. Editable CAD and 3D files are provided only when the builder has chosen to supply them, under the same licence. A client who asks a builder for CAD or 3D files is dealing with the builder.

## 8. Data handling

- A builder admin can delete a client login and all of the client's projects (`deleteClient`) and export a client's projects as JSON (`exportClientProjects`). Deleting is permanent; the billing row of a billed login remains (financial record, no project data).
- Passwords are never stored in plain text or returned after generation. Project JSON is stored as given (underlay image removed on export).
- Personal data held: names, optional email, lot address, project designs. No marketing use. Retention: logins and projects are kept until deleted by the builder; invoices seven years.
- The system never sends email by itself except the explicit JCE enquiry (section 9) and, later, builder staff password reset links.

## 9. Send to JCE for engineering and DA plans

`POST /api/enquiry/jce` (`server/lib/enquiry.js`).

Who sees the button: public Plan Pack users, builder staff, and client logins when `allowClientEnquiries` is on (default on). Nothing is sent until the person ticks consent and presses Send.

Body:

```json
{
  "name": "Sarah Lee", "phone": "0412 345 678", "email": "sarah@example.com",
  "need": "engineering | da | both", "notes": "...",
  "consent": true,
  "lot": { "address": "", "lot": "", "dp": "", "lga": "", "zone": "" },
  "project": { "...project JSON..." },
  "pdfBase64": "<PDF plan set, base64>",
  "source": "public | builder | client", "orgName": "Sample Homes"
}
```

Consent text shown: "I agree to my plans and details being sent to JCE Infrastructure Pty Ltd to prepare a quote".

Behaviour: 503 `ENQUIRY_NOT_CONFIGURED` when `RESEND_API_KEY` is unset (the UI says it is not set up yet); 400 for missing consent, name, phone, email or `need`; 413 over the size limits (PDF `ENQUIRY_MAX_PDF_BYTES`, default 6,000,000; project 2,000,000); 429 over 5 sends per IP per hour or 3 per email address per day. Otherwise it saves a copy in the `jce_enquiries` table, then sends one email through the Resend REST API (`POST https://api.resend.com/emails`, `fetch`, no SDK) from `ENQUIRY_FROM` to `ENQUIRY_TO` (default enquiries@jceinfrastructure.com.au), reply-to the person, with a plain text summary and two attachments (the PDF and the design `.planstudio.json`), and answers `{ ok: true, reference: "GI-XXXXX" }`. If Resend refuses, the copy is kept and the answer is 502 `EMAIL_FAILED` with the `reference`. Success text: "Sent to JCE Infrastructure, reference GI-xxxx; JCE will be in touch." In mock mode no email is sent and a fake reference is returned. Resend setup is in `server/README.md`.

## 10. D1 tables

The tables are in `server/schema.sql` (all `CREATE ... IF NOT EXISTS`, purely additive, re-run it after deploying: `wrangler d1 execute plan-studio --remote --file server/schema.sql`). They follow the first proposal with these changes:

- `login_charges` is `login_issues` (`login_id` PRIMARY KEY, so the A$20 charge can exist once; no foreign key, so it survives deleting the client). It also keeps `client_name` and `month`.
- `ai_topups` and `ai_usage` are not tables. AI credits live in the `entitlements` rows of the AI branch (monthly pool and top-up pool per login) and each top-up is an `ai_topup` row in `events`. `users.ai_top_up_balance` is gone for the same reason.
- `users` has no `failed_attempts` or `locked_until`; lockout counters are in `auth_failures` (keys `u:<identifier>` and `ip:<address>`), so unknown usernames lock the same way as real ones.
- `reset_tokens` is not built (no email, see section 2). `portal_settings` holds one value, the Stripe GST tax rate id.
- `invoices` adds `stripe_invoice_id`, `stripe_step` (created, items, finalized, sent), `stripe_hosted_url` and `error`; status is `pending`, `due`, `paid`, `void` or `failed`. `orgs` adds `stripe_customer_id`; `ai_monthly_cap` defaults to 300.
- `users.email` and `users.username` are lower case and globally unique (a partial unique index lets many users have no email).
- `projects.project_json` is capped at 1,800,000 bytes (`PORTAL_PROJECT_MAX_BYTES`) because D1 rows are limited to 2 MB, not the 4 MB the mock allowed. A larger design answers `413 PAYLOAD_TOO_LARGE`; the underlay image is the usual cause.
- `jce_enquiries` was already in the schema.

## 11. Integration hooks

- `window.openSiteSearch()`: if the site defines it, "Find my block" calls it. Otherwise a placeholder dialog offers "Use a sample lot" (14 m x 36 m).
- `window.__ps.portal.setLot({ name, polygonMm, frontEdgeIndices, picked, address, lot, dp, lga, zone })`: the lot search calls this to give the house picker its lot. `picked` is `{ front, secondaryFront, side, rear }` each `{ minM }`, the same shape `pickRules` returns in `claude/glide-setbacks`. `getLot()` supplies the address, lot, DP, LGA and zone to the JCE form.
- `premium.setPortalEntitlement({ entitled, role, orgName, credits, exports, enquiry, sendEnquiry })`: portal sessions include plans without the A$35 step.
- Fit ranking (`rankDesigns`): "Fits", "Fits rotated", "Fits mirrored", "Does not fit" with a reason such as "2.1 m too wide". Guidance only; a design that does not fit can still be placed and edited. The footprint is the convex outline of the ground floor.
- Deep links into Pocket Architect: `?house=`, `?project=`, `?glide=`, `?signin=1`.

## 12. Open decisions

See the final report: AI monthly cap default and top-up expiry, designer permissions, staff password reset by email versus admin reset, Pocket Architect bundle rebuild, title block logo treatment, global username uniqueness, handling of project JSON and PDF in enquiries, and the PBKDF2 iteration cap.

## 13. Real server notes

Routes added to the contract above:

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/portal/admin/orgs` | bearer `ADMIN_TOKEN` | `{ name, shortCode?, adminFirstName, adminEmail? }`. Creates an organisation and its first admin; returns the temporary login once. There is no self service sign up. |
| `POST /api/billing/run-month` | bearer `ADMIN_TOKEN` | `{ month?, orgId? }`. Creates the Stripe invoices for a finished Sydney month (default: the previous one). Idempotent. The Worker cron calls the same code. |
| `POST /api/portal/ai/token` | cookie | `{ token, role, expiresAt }`: the org token (`issueOrgToken`) the AI endpoints accept as a bearer token. |

Differences from the first draft:

- Lockout: 5 failures per username lock it for 15 minutes (`423 ACCOUNT_LOCKED`, `retryAfter`), also for names that do not exist; 20 failures per IP address lock that address for 15 minutes (`429 RATE_LIMITED`). A correct password does not unlock early. Both limits are variables (`LOGIN_MAX_FAILURES`, `LOGIN_IP_MAX_FAILURES`).
- Org settings accept `showGlideLibrary` as an alias of `showGlideToClients` and `allowClientCad` as an alias of `allowClientCadExports`; values must be booleans. `me().org` returns the names the screens use.
- AI: monthly allowance defaults to 300 credits per login (`ORG_MONTHLY_CREDITS`; the mock used 150), top-ups carry over 12 months.
- Logos: PNG or JPEG only (SVG is refused), at most 400,000 characters of data URL, the file signature is checked.
- Role or password changes and resets end the person's sessions at once; a disabled login loses its sessions at once.
- `enquiryJce` stays public (no cookie needed), so `allowClientEnquiries` is enforced by the screens only.

Going live: (1) apply `server/schema.sql`; (2) set the secrets and variables in `server/README.md`; (3) create the first organisation; (4) in the site config set `GI_CONFIG.portalEnabled = true` and `GI_CONFIG.portalMock = false` (or build with `REVIEW_BUILD = false`, the default, and no mock), run `node tools/sync-portal.mjs` to refresh `website-live/portal/src`, and set `PORTAL_ENABLED=1` on the Worker; (5) live Stripe only with the owner's written go-ahead.

## 14. Free builder trial (11/11/2026)

Builders ask for a free 14 day trial on `/for-builders/#trial`. The owner approves each request on the private admin page `/portal/admin/`; approval creates the organisation and its first admin login. Code: `server/lib/trial.js` (rules, validation, owner email), `server/lib/portal.js` (routes), `src/portal/ui/trial-ui.js` and `src/portal/ui/admin-app.js` (screens), tests in `tests/trial.test.mjs`.

**Account states.** `me().account.status` is `trial`, `trial_ended`, `active` or `read_only`. They live in the new table `org_accounts` (an org with no row is a legacy `active` org, so the ADMIN_TOKEN create-org job is unchanged). `trial` past `trial_ends_at` is treated as `trial_ended` at request time, so no cron is needed.

**Dates.** The approval day is day 1. `trial_ends_at` is 00:00 Sydney on the day 14 calendar days after the approval date (approved 11/11/2026: read only from 00:00 on 25/11/2026, last full day 24/11/2026). Daylight saving safe (`sydneyDayStartPlus` in `src/portal/billing.js`). Extending adds 7 calendar days from the current end (or from today when already ended). Builder data is kept 90 days after a trial ends.

**Rules.**

| State | Staff | Client logins | AI top-ups | Writes | Exports |
|---|---|---|---|---|---|
| trial | everything else | issue, reset, enable refused: `403 TRIAL_NO_CLIENTS` | refused: `403 TRIAL_NO_TOPUPS` (portal and `/api/ai/topup`); monthly cap applies | allowed | `["pdf","dxf","glb","obj"]` |
| trial_ended, read_only | sign in, view, open projects, save billing details, start card setup | refused | refused | every non GET route: `403 READ_ONLY` (also AI edit, AI token) | `[]`, `enquiry` false |
| active | everything | allowed | allowed | allowed | normal |

Routes still open while read only: sign in/out, password change, `PUT /billing/contact`, `POST /billing/setup`, `POST /billing/setup/confirm`.

**New routes.**

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/portal/trial-request` | none (public, no CSRF header needed) | `{ companyLegalName, abn, tradingName?, firstName, lastName, email, mobile, region, homesPerYear?, howHeard?, consent: true, website: "" }`. `website` is the honeypot. ABN checksum validated. Rate limit 5 per IP per hour and 3 per email per day (`429 RATE_LIMITED`). A second request with an ABN that already has a pending or approved request answers the same success and stores nothing. Stored in `trial_requests` as `pending`. Answers `{ ok: true, message: "Thanks, we will be in touch within one business day." }`. Works while `PORTAL_ENABLED` is 0. |
| `GET /api/portal/admin/trial-requests?status=` | bearer `ADMIN_TOKEN` | pending, approved, declined |
| `POST .../admin/trial-requests/:id/approve` | bearer | creates the org (billing details prefilled from the request) and first admin; returns `credentials` once. `409` if already decided or the email already has a login |
| `POST .../admin/trial-requests/:id/decline` | bearer | `{ note }` |
| `GET /api/portal/admin/orgs` | bearer | each org: account state, first admin, client logins issued, AI use this month, invoices |
| `POST .../admin/orgs/:id/extend-trial` | bearer | +7 days; `409` for an active org |
| `POST .../admin/orgs/:id/convert` | bearer | manual convert to paid (`{ note? }`) |
| `POST .../admin/orgs/:id/reset-admin` | bearer | new temporary password for the first admin, shown once |
| `POST /api/portal/billing/setup` | cookie, `billing.write` | Stripe Checkout Session in `setup` mode (card only); needs legal name, ABN and billing email saved. Returns `{ url }` |
| `POST /api/portal/billing/setup/confirm` | cookie, `billing.write` | `{ sessionId }`. Runs the same completion as the webhook when the customer returns before it arrives |

**Card capture.** The Stripe webhook already receives `checkout.session.completed`. For `mode: "setup"` the server reads the SetupIntent, sets the payment method as the customer's `invoice_settings.default_payment_method`, stores it on the org (brand and last 4 are shown, the id is never sent to the browser), sets the org `active` and fills any missing billing contact from Stripe's customer details. No new webhook event is needed.

**Monthly billing.** An org with a saved card gets a `charge_automatically` invoice with `default_payment_method`, finalized and paid at once (`POST /invoices/:id/pay`, off session); Stripe does not email it. A declined card leaves the invoice `due` with the reason in `error` (shown on the admin page). An org without a card is invoiced as before (`send_invoice`, 14 days). Tax invoice rules are unchanged: seller JCE Infrastructure Pty Ltd trading as Glide Inside, ABN 29 699 165 663; buyer legal name and ABN; the invoice snapshot adds `payment: { method: "card" | "invoice", brand, last4 }`. Test mode only; a live key is refused unless `STRIPE_LIVE_BILLING_APPROVED` is set.

**Owner email.** On a new request, one email to `TRIAL_NOTIFY_TO` (default hello@glideinside.com.au) through Resend: subject `Trial request: <company>`, the details and a link to `/portal/admin/`. Skipped silently when `TRIAL_NOTIFY=0`, `RESEND_API_KEY` is unset or `TRIAL_NOTIFY_TO` is empty. A failure never loses the request. The builder is never emailed by the server.

**Tables** (additive, in `server/schema.sql`): `trial_requests`, `org_accounts`.

**me().** Adds `account` `{ status, trialStartedAt, trialEndsAt, daysLeft, lastTrialDay, readOnly, canIssueClients, canTopUp, cardOnFile, card, dataKeptUntil }`. `canTopUp`, `exports` and `enquiry` follow the state.
