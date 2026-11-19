# Website widget, leads, webhook, site costs and engineering orders

Added 19/11/2026. Migration `server/migrations/0025_widget_leads_orders.sql` (also in `server/schema.sql`). All tables are additive.

## Website widget ("See it on your block")

- Builder id: the org slug (or org id). Portal tab "Website widget" shows the snippet (script or iframe), the allowed websites and the designs offered.
- Loader: `website-live/widget/v1.js` (`<script src=".../widget/v1.js" data-builder="ID" data-height="720">`). It inserts an iframe of `plan-studio/app/?embed=1&widget=ID`.
- Public routes: `GET /api/widget/:id/config`, `GET /api/widget/:id/designs`, `POST /api/widget/:id/lead` (needs header `x-gi-request: 1`, so a cross site form post is refused).
- Allowed websites are a spam control, not a security boundary: the host is read from `ancestorOrigins`, then the referrer, then `?host=`. An empty list allows any website.
- Only the builder's own saved designs are offered (Glide library designs are not).
- Cloudflare: the site sends `frame-ancestors 'self'` (see SECURITY-HEADERS.md). A transform rule must relax this for `/plan-studio/app/` when `embed=1` and `widget=` are present (or allow `frame-ancestors *` for that path only). Not changed by this branch.

## Leads

- Table `leads`; portal tab "Leads" (staff with clients.read) lists all, filters, CSV export (`/api/portal/leads/export`), status and notes, delete.
- Stored: name, email, optional phone, address, lot, design, host website, consent time and wording. No email is sent to the visitor or the builder.
- A duplicate (same email, address and design within a short time) updates the earlier lead.

## Webhook and Zapier

- Setting: portal Leads tab, webhook URL (https, public host). Per builder secret, rotate and test buttons.
- POST JSON `{ event: 'lead.created', ... }` with header `X-GlideInside-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256 of `t.body` with the secret.
- 5 attempts with back off (1 minute, 5 minutes, 30 minutes, 2 hours). Retries run when new leads arrive and in the existing housekeeping cron. Delivery log and manual retry in the portal.
- Zapier: "Webhooks by Zapier" with a Catch Hook trigger; steps are in the Leads tab help.

## Site costs

- Rates precedence: this design (`project.siteCosts`) over the builder default (`site_cost_defaults`, `/api/portal/site-costs`) over this browser over the standard defaults.
- The estimate is GST excluded; GST at 10 percent is shown with the note. The same figures go into the siting report, the one page summary and one plan set site sheet note.

## Engineering orders

- Export menu "Order engineering" opens an order request form. `POST /api/order/engineering` saves the request in `engineering_orders` (rate limited, honeypot, share link kept only when on this site). Visible in the admin portal (owner token). A mailto link to JCE is offered only if `GI_CONFIG.jceEmail` is set; it is not set today. Nothing is emailed by the site.

## Deploy notes

Needs a Worker deploy and migration 0025 applied by the owner's deploy script before the widget, leads, webhook, site cost defaults and order routes work. The static pages work without it but those features show an error.
