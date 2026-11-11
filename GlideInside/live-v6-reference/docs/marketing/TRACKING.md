# Glide Inside tracking plan (GA4 and Google Ads)

Prepared 14/10/2026. Code: `site/analytics.js`. Config: `site/site.config.js` (`ga4Id`, `adsConversion`, both empty until you set them). With `ga4Id` empty the site loads no Google scripts and sends nothing. Only UTM passthrough runs.

## What the site sends

| GA4 event | When | Parameters |
|---|---|---|
| `design_started` | First real edit in Pocket Architect (the app store reports a change that can be undone), once per browser session. Also fires on a first AI request, save or export. Picking a template alone does not count. | `method` (`edit`, `ps_ai_request`, ...), `template` |
| `purchase` | Return from Stripe with `?checkout=success&session_id=...`, once per Stripe session id | `transaction_id`, `value` 35, `currency` AUD, `items` |
| `generate_lead` | Click on any `mailto:` link (quote or contact) | `lead_type` (`subdivision_quote`, `pocket_architect_enquiry`, `general_enquiry`, `email_link`), `method`, `link_text`, `page_path` |
| `start_design_click` | Click on a link into the tool (library pages, home, product page) | `template`, `page_path` |
| `ps_template_selected`, `ps_upgrade_click`, `ps_checkout_started`, `ps_export` | Forwarded from the app for funnel analysis | `item_id`, `export_type` |

Notes:
- A `mailto:` click records intent, not a sent email. Count it as a lead signal. If you add a quote form later, fire `generate_lead` on submit instead.
- Add-on purchases (A$5 fly-through, A$10 renderings) are sent as `purchase` only if the Stripe Payment Link redirects to `https://glideinside.com.au/plan-studio/?checkout=success&session_id={CHECKOUT_SESSION_ID}&addon=fly` (use `renders` or `both` for the others). Value comes from `site.config.js` (5, 10, or 15 for both). Confirm in Stripe that the Payment Link "After payment" redirect accepts that placeholder before relying on it.

## Required change to the app page (not done in this pass)

`site/plan-studio/app/index.html` is generated and was not edited. Stripe returns the buyer to the app page, which is a top level page, so `purchase` and the direct (non-embedded) `design_started` only work if the app page loads the tracker. Add this line to the generated head, ideally in `tools/install_app.py` so it survives rebuilds:

```html
<script src="../../site.config.js"></script><script src="../../analytics.js"></script>
```

Until then: `design_started` still works when the tool is opened from the launch page or the plan library (the launch page hosts the app in an iframe and watches it), but `purchase` will not fire, because the buyer lands on the bare app page.

## GA4 setup (about 15 minutes)

1. analytics.google.com, Admin, Create property "Glide Inside", time zone Sydney, currency AUD.
2. Add a Web data stream for `https://glideinside.com.au`. Copy the Measurement ID (`G-XXXXXXXXXX`) into `ga4Id` in `site/site.config.js`, then deploy.
3. Admin, Events: after the first test, mark `design_started`, `purchase` and `generate_lead` as key events (conversions).
4. Admin, Data streams, Configure tag settings, List unwanted referrals: add `checkout.stripe.com` and `stripe.com` so a purchase is not credited to Stripe.
5. Admin, Data display, Custom definitions: add event-scoped dimensions `lead_type`, `template`, `method` (optional, for reporting).
6. Test: open the site with `?utm_source=test&utm_medium=test&utm_campaign=test`, then Admin, DebugView. Draw a wall in the tool and expect `design_started`. Click a mailto link and expect `generate_lead`. Use a Stripe test-mode checkout and expect one `purchase`; refresh the return URL and confirm no second one.

## Google Ads conversions

Glide Inside shares one Ads account with JCE Infrastructure. Keep Glide Inside campaigns, conversions and budget separate (name everything `GI - ...`). Do not start ads without written approval (A$250 first month cap).

1. Ads, Goals, Conversions, New conversion action, Website, enter `https://glideinside.com.au`, choose Add a conversion manually.
2. Create "GI Purchase" (category Purchase, value: use different values per conversion, A$35 default, count One). Copy the tag: the string `AW-123456789/AbCdEfGh` goes into `adsConversion` in `site/site.config.js`. The site then sends the conversion with the real value and transaction id.
3. Link GA4 to Ads (GA4 Admin, Product links, Google Ads links). Then import `design_started` (as a secondary conversion, do not optimise bidding on it at first) and `generate_lead` (primary for the Subdivision campaign) from GA4 into Ads. This avoids pasting more tags.
4. Set "GI Purchase" and subdivision `generate_lead` as primary conversions; set `design_started` as secondary.
5. Turn on auto-tagging (default on) so `gclid` is attached. The site does not need to handle `gclid`.

## UTM convention

Lowercase, no spaces, hyphens between words. Always set the first three.

| Parameter | Rule | Examples |
|---|---|---|
| `utm_source` | where the click came from | `google`, `facebook`, `instagram`, `youtube`, `tiktok`, `email`, `partner-name` |
| `utm_medium` | channel type | `cpc`, `social`, `video`, `email`, `referral`, `qr` |
| `utm_campaign` | `gi-product-theme` | `gi-pa-granny-flat`, `gi-pa-duplex`, `gi-pa-shed`, `gi-pa-extension`, `gi-pa-floorplan-test`, `gi-pa-draftsman-test`, `gi-sub-consultant`, `gi-sub-feasibility`, `gi-sub-outreach` |
| `utm_content` | ad group, creative or post id | `rsa-1`, `video-granny-flat-01`, `fb-group-owner-builder` |
| `utm_term` | paid keyword (Ads ValueTrack `{keyword}`) | `granny-flat-designs` |

Examples:
- Ad: `https://glideinside.com.au/plans/2-bedroom-granny-flat-plans/?utm_source=google&utm_medium=cpc&utm_campaign=gi-pa-granny-flat&utm_content=rsa-1&utm_term={keyword}`
- YouTube description: `...?utm_source=youtube&utm_medium=video&utm_campaign=gi-pa-granny-flat&utm_content=video-granny-flat-01`
- Outreach email: `...?utm_source=email&utm_medium=email&utm_campaign=gi-sub-outreach&utm_content=developers-batch-1`

How passthrough works: the first UTM set seen in a session is stored in the browser (session, with a 7 day fallback) and appended to internal links, so UTMs survive the move from a landing page to the launch page and back from Stripe. UTMs are also attached to `generate_lead` and `purchase`.

## Weekly report fields mapped to the data

Spend and clicks (Ads), `design_started`, `purchase` (count and value), cost per purchase (Ads spend divided by purchases), `generate_lead` split by `lead_type`. Design-to-purchase rate = `purchase` / `design_started`.

## Privacy

`privacy.html` now mentions Google Analytics and Google Ads measurement. It is a draft for owner review. Consider a cookie notice if you run paid campaigns at volume; not added here.
