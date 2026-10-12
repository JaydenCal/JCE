# Glide Inside launch audit: 12/10/2026

Owner: Jayden Callen. Audited by Claude from the Dropbox source. The live site and Dropbox download links can't be reached from this container. Nothing was deployed, signed in to, published or paid.

**What was checked**
- `/_GlideInside/_Launch_Workspace/03_brand_site/site/Glideinside_Website_v3/` (template source, with `[PRICE]`-style tokens).
- `.../Glideinside_Website_Launch_v3g/`, the **built package**. Its files match what Website_Update_v3g.md records as deployed (fix7, verified by SHA-256 on 7/10).
- Evidence below cites the built copy (`v3g/…`) unless it says `src/…`.

**Limit:** the Dropbox connector returns HTML with the tags stripped. So `<title>`, meta tags, `<script>` tags, `alt` attributes and JSON-LD inside the HTML **could not be read directly**. Those rows rely on the build script and the update notes and are marked "Unverified".

## CRITICAL (breaks orders, leaks secrets, or blocks Google Ads)

| # | Issue | Evidence | Impact | Fix |
|---|---|---|---|---|
| C1 | **No Google Ads conversion tracking is live.** `adsEnabled:false`, no tag ID, no labels. | `v3g/launch-config.json` lines 16-19; `launch-values.json` lines 12-13 and 16 are empty | Ads would spend with no conversion data, so you can't judge or optimise the A$250. | **Ready:** `conversion_tracking/` (2 files plus DEPLOY.md). Paste the real IDs, upload, then test with Tag Assistant. |
| C2 | **Stripe account showed "Action required: we need some information" (identity) on 6/10.** Stripe can pause payments until it's done. | `Website_Update_v3g.md`, "Stripe" section | Orders would break mid-campaign. The handover says $249 ordering works, but the source can't show whether verification was finished. | Before publishing ads, open Stripe Dashboard and clear any "Action required" banner. Confirm Payments and Payouts are both enabled. |
| C3 | **The confirmation email depends on same-tab browser storage and PHP `mail()` deliverability.** | `v3g/order-confirmed.js` (reads `sessionStorage['glideinside-order']`, posts to `order-confirm.php`); `order-lib.php` `gi_send_text_mail()` uses `mail()`; handover: warm-up message W004 never reached Gmail | A customer who pays on another device or tab, or whose mail is spam-filtered, gets only the Stripe receipt. The order email to hello@ is sent **before** payment, so it doesn't prove payment. | Turn on Stripe > Settings > Notifications > "Successful payments" email to you. Match each `GI-` reference in Stripe before starting work. Fix SPF/DKIM/DMARC for glideinside.com.au in cPanel > Email Deliverability (DNS changes are yours to make). |
| C4 | Secrets in client files: **none found** (pass). | No Stripe `sk_`/`pk_test`, no SMTP passwords and no API keys in the JS/JSON/PHP that were read. The Payment Link is live-mode `buy.stripe.com/dRm8…` (no `/test_`), `launch-values.json` line 15. The only secret is the HMAC salt in `v3g/contact-config.php` line 9. It's server-side and `.htaccess` (lines 8-10) blocks web access to it. | None for visitors. The salt also sits in Dropbox. | Optional: regenerate the salt when you next rebuild. Don't upload a new `contact-config.php` by accident, because that invalidates in-flight order tokens. |

## Pass/fail against the target spec

| Item | Result | Evidence (file / location) |
|---|---|---|
| Title "Glide Inside, 3D Floor Plans for Real Estate, Regional" (<60) | **FAIL (deliberate)** | Live is "Glide Inside, 3D Floor Plans for Builders and Developers", per Website_Update_v3g.md "Developers and builders first" (Jayden, 6/10). Patch ready in `seo_fixes/`. |
| Meta description (spec text with $249) | **FAIL (deliberate)** | Same note: "...site models for builders and developers... Volume pricing on request." (no $249) |
| One H1 "3D Floor Plans for Real Estate That Buyers Can Walk Through" | **FAIL (deliberate)** | `v3g/index.html` hero H1 text is "3D Floor Plans and Site Models for Builders and Developers". There is only one H1 per the notes. |
| H2 "Display Home Virtual Tours and Off-the-Plan Fly-Throughs" | PASS | `v3g/index.html`, builders section |
| H2 "3D Floor Plans for Real Estate Listings" | PASS | `v3g/index.html`, agents section |
| Section order Hero > How > Builders > Agents > Samples > Pricing > Testimonials > Regions > FAQ > Form | **FAIL** | Live order: Hero > Site model > Builders > How it works > Samples > Rooms > Pricing > Subdivision > Drone > **Agents** > Regions > FAQ > Form (`v3g/index.html`; notes "New order"). Builders-first was Jayden's choice. |
| Hero: muted autoplay sample, $249, Upload button | PASS | `script.js` lines 5-40 (`heroVideo.muted=true`, starts by script, respects reduced motion and data saver); hero shows "Upload a Floor Plan · $249"; poster `assets/glide-inside-hero-poster.webp`. The poster attribute itself is unverified. |
| Testimonials | **FAIL (correctly empty)** | Website_Update_v3g.md: "left out until real client quotes exist". Don't invent any. |
| Regions Served | PASS | `v3g/index.html` "Regions we serve" (Orange, Bathurst, Dubbo, Mudgee, Tamworth, Gunnedah, Wagga Wagga, Albury plus other states) |
| FAQ | PASS | `v3g/index.html`, 13 questions |
| One form: details + plan upload PDF/JPG/PNG | PASS | `script.js` form handler (`brief-form`, 2 files, 8 MB, extension check); `contact.php` MIME check via `finfo` (`$allowed` pdf/png/jpeg) |
| $249 hosted card checkout (Stripe) | PASS (verify C2) | `script.js` redirects to Payment Link with `client_reference_id` and `prefilled_email`; `launch-values.json` line 15 is a live link |
| Automatic confirmation email | PASS with risk (C3) | `order-confirm.php` sends once per ref with Bcc to hello@; quote mode sends an acknowledgement in `contact.php` (`gi_enquiry_ack_text`) |
| Builders/volume contact | PASS | Form mode "Builders and volume orders"; `services/display-home-virtual-tours.html` |
| Refund and revisions policy | PASS | `v3g/terms.html` "Changes" (1 round within 14 days) and "Cancellations and refunds"; FAQ; tick box |
| Only hero autoplays; others lazy-load | PASS | `script.js` "Sample clips load only when chosen"; the 60 s demo (36 MB) loads only in the dialog; site model iframe loads on IntersectionObserver |
| Alt text | PARTIAL / Unverified | Room renders get descriptive alts in `script.js` `demoRooms[].alt`. Static `<img>` alts couldn't be read. Spot-check with Lighthouse. |
| LocalBusiness/Service schema with areas and price | **FAIL** | `search-pages.json` line 5: the homepage is `Organization` only. Service schema is on service pages, but there's no LocalBusiness and no `areaServed`. Snippet ready: `seo_fixes/schema-service-area.html`. |
| Sitemap | PASS | `v3g/sitemap.xml`: 6 URLs (home plus 5 services); `robots.txt` points to it |
| Mobile first | Unverified | Touch-specific hints exist. The homepage loads `glide-3d.js` (590 KB) plus a 2.5 MB hero loop. Run PageSpeed Insights (mobile) before spending. |
| Analytics on form start and completed order | **FAIL now, ready to fix** | Events exist (`script.js` `glideinside:form-start`, `glideinside:checkout`; `analytics-ready.js` purchase block) but are inert, because no GA4 or Ads IDs are set (C1). |
| No JCE branding mixing | **FAIL (minor)** | Website_Update_v3g.md "Plans to model": the site-model sheet `assets/site-plan-sheet*.webp` "**The JCE Infrastructure title block is kept**", and it's shown on the Glide homepage ("Open the full sheet"). Blank or replace the title block, or get the client's OK. |
| No placeholders (TBC, lorem, example.com, [TOKENS]) | PASS (built) | The build stops on leftover tokens (`build_launch_v3.py` TOKENS_LEFT). Built index, terms and privacy show real name, ABN, email and phone. `src/` still has `[PRICE]` etc. by design. Never upload `src/` files directly. |
| Broken links | Unverified | Couldn't crawl the live site. Every sitemap URL exists in the build. Run a link check (e.g. Screaming Frog free) after deploying. |
| Test Stripe keys/links | PASS | No `test_` or `buy.stripe.com/test` found; `build_launch_v3.py` only accepts `https://buy.stripe.com/...` |
| Exposed secrets in client files | PASS | See C4 |

## Other findings (not blocking)
1. **Mixed message above the form:** "Nothing is charged until you accept it" sits next to the pay-on-upload single order (`v3g/index.html`, "Quotes and orders"). Reword it to "Quotes: nothing is charged until you accept."
2. **Purchase tracking accuracy:** the live `analytics-ready.js` would count a purchase on any visit to `order-confirmed.html`, even without an order. The new version counts only a real `GI-` reference, once.
3. **Holiday list:** `order-lib.php` `GI_HOLIDAYS` and `order-confirmed.js` cover NSW to the end of 2027. Add any days you won't be working.
4. **Gunnedah** is listed on the page but missing from `launch-config.json` `targetHubs` (cosmetic, unused by the site).
5. **Uniplan village model:** keep it off the site until Uniplan approves (workboard task glide-inside-07).
6. The source folder has no `sitemap.xml`. Only the build does, which is expected.
