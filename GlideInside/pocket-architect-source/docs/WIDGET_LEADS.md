# Website widget, leads, webhook, site costs and engineering orders

Added 19/11/2026. Migration `server/migrations/0025_widget_leads_orders.sql` (also in `server/schema.sql`). All tables are additive.

## Website widget ("See it on your block")

- Builder id: the org slug (or org id). Portal tab "Website widget" shows the snippet (script or iframe), the allowed websites and the designs offered.
- Loader: `website-live/widget/v1.js` (`<script src=".../widget/v1.js" data-builder="ID" data-height="720">`). It inserts an iframe of `plan-studio/app/?embed=1&widget=ID`.
- Public routes: `GET /api/widget/:id/config`, `GET /api/widget/:id/designs`, `POST /api/widget/:id/lead`. The lead post needs header `x-gi-request: 1` and an `Origin` equal to the Glide Inside site (the widget is the app in an iframe, so its posts are same origin). Another website cannot post leads directly.
- Allowed websites: the host is read from `ancestorOrigins`, then the referrer, then `?host=`, and checked against the builder's list. `?host=` is a claim by the caller, so the list is a spam control, not a security boundary. An empty list allows no website except the Glide Inside site itself (the portal preview). The real control over who may frame the app is the Cloudflare `frame-ancestors` rule below.
- In widget mode the app has no route to the full editor, the Glide library, Upload boundary, PDF downloads or the engineer menu. It takes no messages from the page around it and posts nothing to it (no `ps:analytics`), and Google Analytics is not loaded in the app page at all (only the site pages load `analytics.js`). If the widget cannot start (not switched on, website not on the list, server fault) it shows "This widget is not available right now" and nothing else.
- Only the builder's own saved designs are offered (Glide library designs are not).
- Framing (owner step, not applied by this branch): see "Cloudflare setup for framing" below. Until that rule is live the widget cannot load on a builder's website, and the website cards say so ("Coming soon").

## Leads

- Table `leads`; portal tab "Leads" (staff with clients.read) lists all, filters, CSV export (`/api/portal/leads/export`), status and notes, delete.
- Stored: name, email, optional phone, address, lot, design, host website, consent time and wording. No email is sent to the visitor or the builder.
- A duplicate (same email and same design within 10 minutes) is not stored again. The visitor is given the earlier lead's reference (`duplicate: true` in the response).
- Status, notes, delete and the full CSV (`clients.write`, builder admin). A designer (`clients.read`) can read the inbox only.
- Consent: each lead stores the exact wording shown, its version (`LEAD_CONSENT_VERSION`) and the time. Engineering orders store the same (`ORDER_CONSENT_VERSION`).
- Retention (run by the cron, `server/lib/app.js` housekeeping): leads and their deliveries 24 months, engineering orders 24 months, webhook delivery log 90 days. Stated on `privacy.html`. Deletion on request: the builder deletes a lead in the portal; the owner deletes an order with `DELETE /api/portal/admin/engineering-orders/:id` (also a Delete button on the admin page).

## Webhook and Zapier

- Setting: portal Leads tab, webhook URL (https, public host, not Glide Inside itself, not `*.workers.dev`, not a wildcard DNS name such as nip.io or sslip.io, no IP address or local name, trailing dots ignored). The address is checked again before every attempt. Workers cannot reach private address ranges at all, which is the backstop if a public name ever resolves inwards. A name cannot be resolved from a Worker before the call, so the rules above are on the name.
- The signing secret is never returned with the settings (`secretHint` only). The full secret is returned by the first save, by `POST /portal/webhook/rotate-secret` and by `POST /portal/webhook/reveal-secret` (builder admin, CSRF header, rate limited).
- POST JSON `{ event: 'lead.created', ... }` with header `X-GlideInside-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256 of `t.body` with the secret.
- 5 attempts with back off (1 minute, 5 minutes, 30 minutes, 2 hours). The first attempt runs after the visitor's response has gone (`ctx.waitUntil`); retries run only in the cron, for every builder, oldest first, at most 25 deliveries per run. Opening the portal makes no outbound call. Delivery log and manual retry (rate limited) in the portal. A delivery can occasionally repeat: receivers should skip a repeated `id`.
- Zapier: "Webhooks by Zapier" with a Catch Hook trigger; steps are in the Leads tab help.

## Site costs

- Rates precedence: this design (`project.siteCosts`) over the builder default (`site_cost_defaults`, `/api/portal/site-costs`) over this browser over the standard defaults.
- The estimate is GST excluded; GST at 10 percent is shown with the note. The same figures go into the siting report, the one page summary and one plan set site sheet note.

## Engineering orders

- Export menu "Order engineering" opens an order request form. `POST /api/order/engineering` saves the request in `engineering_orders`. It needs header `x-gi-request: 1` and refuses a sent `Origin` that is not this site, so a cross site `text/plain` post fails. Limits: 6 an hour per address and 200 a day in total. Honeypot. The share link is kept only when on this site. Visible in the admin portal (owner token). A mailto link to JCE is offered only if `GI_CONFIG.jceEmail` is set; it is not set today. Nothing is emailed by the site.

## Deploy notes

Needs a Worker deploy and migration 0025 applied by the owner's deploy script before the widget, leads, webhook, site cost defaults and order routes work. Before it runs, those routes answer 503 "This feature needs the 0025 database update." (not a generic 500). 0025 has not shipped yet, so `consent_version` was added to its `leads` and `engineering_orders` tables rather than as a later ALTER.

## Cloudflare setup for framing (owner step)

Why: the site sends `frame-ancestors 'self'` on every page except `/api/` and `/portal/` (SECURITY-HEADERS.md, rule 1), so a builder's website cannot frame `/plan-studio/app/` until a rule relaxes it for the widget URL only.

Which mechanism applies: Cloudflare. The framing header is added by Cloudflare Transform Rules (SECURITY-HEADERS.md: the static site on cPanel has no `_headers` file). There is no `.htaccess` in this repository to read (it is a hidden file that is never uploaded or overwritten, see golive/UPLOAD-STEPS.md), and the only Apache header rule in the repository (`seo_fixes/htaccess-seo-block.conf`) sets `Cache-Control` and nothing about framing. The live cPanel `.htaccess` was not changed and cannot be read from here. If it does contain its own `Header set Content-Security-Policy` or `X-Frame-Options` line, Cloudflare would still replace the CSP value (Transform Rules "Set static" overwrites the origin header), but an `X-Frame-Options` header from cPanel would still block framing: check with `curl -sI "https://glideinside.com.au/plan-studio/app/?embed=1&widget=x" | grep -i -E "x-frame|content-security"` after step 4 and remove any `X-Frame-Options` line from the live `.htaccess` only if it appears.

Steps (Cloudflare dashboard, zone `glideinside.com.au`):

1. Rules > Transform Rules > Modify Response Header > Create rule. Name: "Widget framing". Place it BELOW rule 1 ("Site security headers") and below rule 2. Transform rules run in order and a later rule replaces an earlier one's value for the same header, so it must come after rule 1 (not before).
2. Custom filter expression (Edit expression):

```text
(http.request.uri.path eq "/plan-studio/app/" or http.request.uri.path eq "/plan-studio/app/index.html") and http.request.uri.query contains "widget="
```

3. Action: Set static, header name `Content-Security-Policy`, value: the same string as rule 1 in SECURITY-HEADERS.md with `frame-ancestors 'self'` replaced by `frame-ancestors https:`. (Everything else in the policy stays identical, so the app loads exactly as before. `https:` lets any https website frame it; a per builder list cannot be set in a static rule, so the builder's allowed websites remain a spam control, enforced in the app and on the lead post as described above.)
4. Save, then check: `curl -sI "https://glideinside.com.au/plan-studio/app/?embed=1&widget=test"` shows `frame-ancestors https:`, and `curl -sI "https://glideinside.com.au/plan-studio/app/"` (no `widget=`) still shows `frame-ancestors 'self'`.
5. Put the widget on a test page on another https site, load it, and confirm the frame shows (or "This widget is not available right now" if that site is not on the builder's list). Then change the website cards on `index.html` and `for-builders/` for "See it on your block widget" from Coming soon back to Available.

To switch it off, disable the rule: the widget stops loading on other websites at once.

Stronger option for later: serve `/plan-studio/app/` through the Worker for `widget=` requests and send `frame-ancestors <the builder's saved origins>`. That turns the allowed list into a real control, at the cost of serving the app HTML from the Worker.
