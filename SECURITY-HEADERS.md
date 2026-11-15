# Security headers for glideinside.com.au (Cloudflare Transform Rules)

For the owner to apply in the Cloudflare dashboard. Nothing here has been applied: the live site and the Worker are untouched.
Written 15/11/2026 after the pre-launch security review (finding M5). The values below were tested locally with `node tools/csp-check.mjs`
(GlideInside/pocket-architect-source), which serves the whole static site with exactly these headers, opens every page and the app in headless
Chrome, clicks through the app and fails on any Content-Security-Policy violation. Result: 0 violations over 30 page loads and the app.

The static site is served from cPanel behind Cloudflare and has no `_headers` file, so the headers are added by Cloudflare.
The API (`glideinside.com.au/api/*`, the Worker) sets its own headers in code (`server/lib/http.js`: `nosniff`, `Referrer-Policy` and a
`default-src 'none'` CSP), so the rules below must NOT touch `/api/`.

## Where to click

Cloudflare dashboard, zone `glideinside.com.au`, then **Rules > Transform Rules > Modify Response Header > Create rule**. Make two rules, in this order
(rule 2 must be below rule 1 so its CSP replaces rule 1's on portal pages).

### Rule 1: "Site security headers" (everything except the API and the portal)

Custom filter expression (use "Edit expression"):

```text
not starts_with(http.request.uri.path, "/api/") and not starts_with(http.request.uri.path, "/portal/")
```

Then, for each line below, add an action **Set static** with that header name and value:

```headers
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://api.mapbox.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net; connect-src 'self' blob: data: https://api.mapbox.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; manifest-src 'self'
```

### Rule 2: "Portal security headers" (the builder and client portal and the owner admin page)

Custom filter expression:

```text
starts_with(http.request.uri.path, "/portal/")
```

Same five headers, but the CSP cannot be framed by anyone (`frame-ancestors 'none'`):

```headers
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://api.mapbox.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net; connect-src 'self' blob: data: https://api.mapbox.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; manifest-src 'self'
```

(Only `frame-ancestors` and `form-action` differ from rule 1. The portal does not need Stripe Checkout from a form: card setup goes through the Worker.)

## Turning on HSTS the right way

`Strict-Transport-Security` makes browsers refuse plain http for a year, for the apex AND every subdomain (`includeSubDomains`). Before saving rule 1:

1. Check that every subdomain of glideinside.com.au that exists works over https (cPanel, mail, anything else). A subdomain that is http only would stop loading for returning visitors.
2. Cloudflare dashboard > SSL/TLS > Edge Certificates: confirm "Always Use HTTPS" is on and the minimum TLS version is 1.2.
3. Do not add `preload` (a one way door). It can be added later once the site has run with HSTS for a few months.

If a subdomain is not ready, start with `max-age=300; includeSubDomains` for a day, then raise it to 31536000.

## What each header does (and the source inventory behind the CSP)

| Header | Value | Why |
| --- | --- | --- |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | Browsers only use https for a year. |
| X-Content-Type-Options | `nosniff` | A file is only ever treated as the type the server says it is. |
| Referrer-Policy | `strict-origin-when-cross-origin` | Other sites only learn the origin, never the path or query. |
| Permissions-Policy | camera, microphone, geolocation, payment and similar switched off | The site and app use none of them. The clipboard, share sheet and fullscreen are not listed, so they keep working. |
| Content-Security-Policy | see below | Limits what a page can load and run, and who can frame it. |

Sources the policy allows, from reading the code and from the local run (`node tools/csp-check.mjs` prints the hosts the pages actually requested):

| Directive | Allowed | Used by |
| --- | --- | --- |
| script-src | `'self'`, `'unsafe-inline'`, `https://www.googletagmanager.com` | The pages' own scripts (the app is one file plus chunks); many pages have small inline scripts; Google Analytics loads `gtag.js` from googletagmanager.com (`analytics.js`, GA4 id in `site.config.js`). |
| style-src | `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com` | Page and app styles (inline style attributes are used widely); Google Fonts stylesheets on two pages (Barlow, Manrope). |
| font-src | `'self'`, `data:`, `https://fonts.gstatic.com` | Self hosted woff2 files in `/assets/fonts/`; the Google Fonts files. |
| img-src | `'self'`, `data:`, `blob:`, `https://api.mapbox.com`, the Google Analytics hosts | Site images; the app draws aerials, thumbnails and plans from blob and data URLs; Mapbox Satellite tiles (`src/site/mapbox-aerial.js`); analytics beacons. |
| connect-src | `'self'`, `blob:`, `data:`, `https://api.mapbox.com`, the Google Analytics hosts | `/api/...` on the same origin (the Worker); `fetch()` of blob and data URLs (exports and image handling, no network); Mapbox tiles and address search (`src/site/upload/place-map.js`); analytics. |
| media-src | `'self'`, `blob:` | The hero video (`assets/plan-creation-v2.mp4`). |
| worker-src | `'self'`, `blob:` | Web workers created from blob URLs (the app's file handling). |
| frame-src | `'self'` | The site frames its own pages only: the 3D viewer (`plan-studio/app/?embed=1`), the subdivision model (`subdivision/ptm/models/warehouse.html`) and the launch page. |
| frame-ancestors | `'self'` on the site, `'none'` on `/portal/` | Stops other sites framing the site (clickjacking). The site's own pages can still embed each other. |
| form-action | `'self'`, `https://checkout.stripe.com` (site only) | Forms post to the same site. |
| object-src, base-uri | `'none'`, `'self'` | No plugins; a injected `<base>` tag cannot redirect relative URLs. |

Things that are deliberately NOT in the policy, and why:

- **Stripe Checkout.** The app sends the buyer to Stripe Checkout with a normal top level redirect (the Worker creates the session). CSP does not restrict navigating away, so no Stripe source is needed, and Stripe.js is not loaded. If Stripe.js or an embedded Checkout is ever added, add `https://js.stripe.com` to `script-src` and `frame-src`, and `https://api.stripe.com` to `connect-src`.
- **Government imagery and cadastre hosts** (NSW SIX, NSW Spatial, QLD Spatial). The browser never contacts them: the Worker fetches them server side (`server/lib/site.js`) and returns the result from `/api/site/...`, so they are covered by `'self'`. If the browser is ever changed to load their tiles directly, add the host to `img-src` (and `connect-src` for fetch).
- **Google Ads** (`adsConversion` in `site.config.js` is empty). If the owner sets an Ads conversion id, add `https://www.googleadservices.com` and `https://googleads.g.doubleclick.net` to `script-src`, `img-src` and `connect-src`.
- **The Anthropic and Stripe APIs.** Only the Worker calls them.

### Known trade-off: `'unsafe-inline'`

`script-src` and `style-src` keep `'unsafe-inline'` because the pages carry inline scripts and styles. That means the CSP will not stop an injected inline script by itself. What it does give: no scripts from other hosts, no framing, no plugins, no data exfiltration to arbitrary hosts (`connect-src`), no form hijack. Closing the gap needs nonces or hashes, which means a Worker or build step that rewrites every page; a later job (move the inline scripts to files, then drop `'unsafe-inline'` from `script-src`). The review found no XSS sink, so this is defence in depth, not a fix for a live hole.

## Checking after you save

1. Open the site in a private window with the browser console open: there should be no "Refused to ..." messages on the home page, `/commercial/`, `/pricing/`, `/for-builders/` and the app at `/plan-studio/app/`. Click through the app: start a design, 3D view, export menu, sign in, address search.
2. `curl -sI https://glideinside.com.au/ | grep -i -E "strict-transport|content-security|nosniff|referrer|permissions"` should list all five.
3. `curl -sI https://glideinside.com.au/api/health` should show the Worker's own `content-security-policy: default-src 'none'; ...` (not the site policy). If it shows the site policy, the `/api/` exclusion in rule 1 was not saved.
4. `curl -sI https://glideinside.com.au/portal/` should show `frame-ancestors 'none'`.

To roll back, disable the rule (the toggle on the rule) in Cloudflare; headers disappear at once. If anything in the app breaks, change `Content-Security-Policy` to `Content-Security-Policy-Report-Only` (same value) while it is looked at, so nothing is blocked and the browser console still reports what would have been.

## Other Cloudflare settings from the review (owner steps)

- **Turn off the workers.dev route** for the Worker (Workers & Pages > the worker > Settings > Domains & Routes: disable `workers.dev`), so the Worker is only reachable through Cloudflare on `glideinside.com.au/api/*`. The Worker trusts `CF-Connecting-IP` only (it no longer reads `X-Forwarded-For`).
- **Protect `/portal/admin/`** (the owner admin page, finding L14) with Cloudflare Access (Zero Trust > Access > Applications > Self-hosted, path `glideinside.com.au/portal/admin*`, policy: your email) or an IP allowlist WAF rule. Use an `ADMIN_TOKEN` of 32 or more random characters.
- **Scheduled cleanup.** In `wrangler.toml` the cron triggers are commented out. Housekeeping also runs on a 1 in 100 chance on write, so it works without them, but enable `crons = ["0 19 * * *", "0 20 * * *"]` when the month end invoicing is switched on; it then also runs daily.
