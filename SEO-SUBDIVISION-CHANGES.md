# /subdivision/ SEO changes (live server only)

Prepared 15/11/2026 (SEO-005). `GlideInside/website-live/subdivision/index.html` is edited only on the live server, so these are find and replace pairs for the live copy. Check each "Find" string exists in the live copy first. Apply together with `SUBDIVISION-CHANGES.md` (the earlier list) and keep every other part of the page as it is. No em or en dashes, no "compliant".

## 1. Internal links to index.html (7 links; clean URLs only)

| Find | Replace with |
|---|---|
| `<a class="logo" href="../index.html"` | `<a class="logo" href="../"` |
| `<a href="../index.html">Residential</a>` | `<a href="../">Residential</a>` |
| `<a href="../index.html">Home</a><span>/</span>Subdivision modelling` | `<a href="../">Home</a><span>/</span>Subdivision modelling` |
| `href="../commercial/index.html">Open it full size` | `href="../commercial/">Open it full size` |
| `<a href="../index.html">Pocket Architect</a>` (footer; the earlier list renames this label, keep that rename) | `<a href="../">Glide Inside Residential</a>` |
| `<a href="../plan-studio/index.html">How it works</a>` | `<a href="../plan-studio/">How it works</a>` |
| `<a href="../plan-studio/index.html#addons">` | `<a href="../plan-studio/#addons">` |

## 2. Footer: link to the demo page (gives /book-a-demo/ a sitewide inbound link)

Find: `<a href="../for-builders/">For builders</a><a href="../portal/" data-portal hidden>Builder login</a>`
Replace with: `<a href="../for-builders/">For builders</a><a href="../book-a-demo/">Book a demo</a><a href="../portal/" data-portal hidden>Builder login</a>`

## 3. Footer headings (optional, fixes the h1 to h4 heading skip)

Find: `<nav aria-label="Product"><h4>Product</h4>` Replace: `<nav aria-label="Product"><p class="foot-h">Product</p>`
Find: `<nav aria-label="Builders and plans"><h4>Builders and plans</h4>` Replace: `<nav aria-label="Builders and plans"><p class="foot-h">Builders and plans</p>`
Find: `<nav aria-label="Company"><h4>Glide Inside</h4>` Replace: `<nav aria-label="Company"><p class="foot-h">Glide Inside</p>`
Needs the new `framework.css` (`?v=20261115e`) uploaded first, which styles `.foot-h`. The old `h4` rule stays in the file, so skipping this item is safe.

## 4. Cache versions (head)

Find: `framework.css?v=20261112` (or the `20261115d` the earlier list sets) Replace: `framework.css?v=20261115e`
Find: `framework.js?v=20261112` (or `20261115c`) Replace: `framework.js?v=20261115e`

## 5. Structured data (optional)

The page's `Service` JSON-LD names a `LocalBusiness` provider carrying the ABN. To match the home page graph, in the `"provider"` object change `"@type": "LocalBusiness"` to `"@type": "Organization"` and add `"@id": "https://glideinside.com.au/#organization"`. Leave every other field. If unsure, skip: it is valid as it stands.

## 6. Not changed

Title (65 chars), description (150), canonical and H1 are already fine. The title is 5 characters over the 60 target; shortening is optional: `Subdivision Concepts and Development Feasibility | Glide Inside` (63).
