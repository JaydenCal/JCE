# Site review: pages (18/11/2026)

Scope: all public marketing and info pages in website-live (22 pages plus robots.txt and sitemap.xml), served locally on port 8711, tested at 1440x900 and 390x844 with Playwright. Third party hosts (Google Tag Manager, Google Fonts) and /api calls are blocked in this container and are not counted as bugs. Screenshots: /home/claude/growth/review-pages/.

## 1. Fixed
- CONFIRMED: gold eyebrow labels on light pages had about 1.7:1 contrast (gold #e9b66f on #f3f4f6). Affected the eyebrow on commercial, plan-studio, granny-flat-designs, shed-with-living-quarters, 3d-floor-plan-maker, all /plans/ pages, privacy, terms, trial-terms and plan-terms. framework.css now uses #8a5a14 on light backgrounds (about 5.5:1), keeping gold on dark bands.
- CONFIRMED: add-on prices ("A$10") on plan-studio were gold on white (1.84:1). Now #8a5a14.
- CONFIRMED: caption under the live viewer on / and /commercial/ was pale grey on light (1.92:1). Now the muted token; unchanged on dark sections (for-builders).
- CONFIRMED: table header text (Feature / Free / Plan Pack) on the dark band of plan-studio was 3.08:1. Now the on-night-2 token.
- Cache bust: framework.css ?v= set to 20261118b on all 26 pages that import it, except subdivision/ and portal/ (off limits, see section 3).
- Files: GlideInside/website-live/framework.css and the HTML pages. Commit: see git log on branch claude/site-review-a ("pages: contrast fixes").
- A contrast sweep (text against background, WCAG AA) over 11 key pages now reports zero failures where backgrounds are plain colours.

## 2. Found but not fixed (ranked)
1. SUSPECTED, low: privacy, terms, trial-terms and plan-terms are not in sitemap.xml. They are linked from every footer. Legal pages are commonly left out, so left as is.
2. CONFIRMED, low: /plan-studio/ heading order jumps h1 to h4 once. Cosmetic; changing tags can alter styling.
3. CONFIRMED, low: how-accurate-is-it and sample-plan-set footers omit the "Sample plan set" and "How accurate is it" Product links that the other pages have (probably deliberate: no self link).
4. CONFIRMED, low: small inline text links (breadcrumb "Home", "How accurate is it" in the banner, footer links) are 17 to 23 px tall, under the 24 px touch target guideline. Layout-wide; left.
5. SUSPECTED: pages with an inline hero video or visual that needs fonts cannot be fully judged here because Google Fonts is blocked; Playwright full-page screenshots of / and /commercial/ timed out once on font load. The live site loads fonts normally.

## 3. Owner decisions / notes
- portal/ and subdivision/ pages still reference framework.css ?v=20261115e (not touched per rules). They also pick up the eyebrow colour fix only after their cache query is bumped, so bump them to 20261118b when deploying.
- The brief lists framework.js at 20261118a; I did not change framework.js so left it.
- Decide whether legal pages should be in the sitemap.
- Decide whether to add the two missing footer links on how-accurate-is-it and sample-plan-set for consistency.

## Verified working (no action)
- All 19 sitemap URLs resolve (200); no sitemap URL missing a page; robots.txt valid and points to the sitemap.
- Static link crawl: no internal 404 (config placeholders like orderUrl/toolUrl are replaced by site.config.js at runtime; links resolve to plan-studio/app/ with the correct ?mode=).
- No broken images, no 4xx/5xx assets, no console or page errors apart from the blocked third party hosts, no horizontal scroll at either width, one h1 per page, alt on every image, canonical, description, og:title, og:description and og:image on every page, no em/en dashes in page text, no "compliant".
- Demo form: validation order (name, company, phone, email, day, past day, time, consent), success state and reference with stubbed API at both sizes. General enquiry form on home: same. Builder trial form: validation and success. Builder access code form renders.
- Mobile nav: Menu opens, aria-expanded toggles, Escape closes.
- Commercial and residential CTAs hand off to plan-studio/app/?mode=commercial|residential; viewer iframes request ?embed=1.
- Pricing calculator maths checked (20 logins: 15 x A$30 + 5 x A$25 = A$575).
- Tests run: terms, open-full-editor-handoff, commercial-lotcard, concierge-analytics, boot: 34 pass. The full suite was not run (time limit in this container); no app source changed.
