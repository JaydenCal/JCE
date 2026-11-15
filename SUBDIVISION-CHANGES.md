# /subdivision/ page changes (live server only)

Prepared 15/11/2026. make-upload-zip skips `website-live/subdivision/`, so these are exact find and replace pairs to apply to the live copy of `subdivision/index.html`. The pairs were written against the repository copy of that page, so check each "Find" string exists in the live copy first. Keep every other part of the page as it is. No em or en dashes, no "compliant", no builder names.

Also upload the shared files that changed (`framework.css`, `framework.js`, `site.config.js`, the new `sample-plan-set/` and `how-accurate-is-it/` pages and `assets/sample-sheets/`) in the normal upload zip first, because the banner and footer below use the new `.concept-banner` style and the new page URLs. Bump the `?v=` on the `framework.css` and `framework.js` links to match the other pages (`20261115d`).

## 1. Cache version (head)

Find: `<link rel="stylesheet" href="../framework.css?v=20261112">`
Replace with: `<link rel="stylesheet" href="../framework.css?v=20261115d">`

Find: `<script src="../site.config.js?v=20261112"></script><script src="../framework.js?v=20261112" defer></script>`
Replace with: `<script src="../site.config.js?v=20261115d"></script><script src="../framework.js?v=20261115d" defer></script>`

## 2. Header buttons (Pocket Architect renamed, one label per intent)

Find (appears twice, once in `.nav-logins` and once in `.head-end`): `<a class="btn" data-cfg-href="toolUrl" href="../plan-studio/launch/">Start designing</a>`
Replace with: `<a class="btn" data-cfg-href="toolUrl" data-app-mode="residential" href="../plan-studio/app/">Start residential</a>`

Find: `<a class="btn btn-sm" data-cfg-href="toolUrl" href="../plan-studio/launch/">Start designing</a>`
Replace with: `<a class="btn btn-sm" data-cfg-href="toolUrl" data-app-mode="residential" href="../plan-studio/app/">Start residential</a>`

## 3. One concept only banner (insert straight after the closing `</header>` of the site header, the one ending `</div></header>` before `<main`)

Find: `</div></header>\n<main`
Replace with:
```
</div></header>
<div class="concept-banner" role="note"><div class="shell">Concept layouts only. Not a survey, not a development application. Check with council. <a href="../how-accurate-is-it/">How accurate is it</a></div></div>
<main
```

## 4. Remove the repeated disclaimers (the banner and footer now carry them)

Find: `    <p class="fineprint">Preliminary feasibility and concept presentation only</p>\n`
Replace with: (empty)

Find: `  <p class="disclaimer" style="margin-top:36px">Concepts are for discussion only. They are not survey or development application documentation and do not replace engineering design, planning advice or legal advice. Verify boundaries, levels, services and requirements with a registered surveyor and your local council before relying on any figure shown.</p>\n`
Replace with: (empty)

## 5. One CTA label per intent

Find (two places): `Request a concept</a>`
Replace with: `Request a subdivision concept</a>`

Find: `Request a quote <span aria-hidden="true">→</span></a></div></div>` (quote bar at the foot of the page)
Replace with: `Request a subdivision concept <span aria-hidden="true">→</span></a></div></div>`

## 6. Footer product links and legal line

Find: `<a href="../index.html">Pocket Architect</a><a href="../commercial/">Commercial</a><a href="../plan-studio/index.html">How it works</a><a href="../pricing/">Pricing</a><a href="../plan-studio/index.html#addons">Add-ons</a><a href="../subdivision/">Subdivisions</a></nav>`
Replace with: `<a href="../index.html">Glide Inside Residential</a><a href="../commercial/">Glide Inside Commercial</a><a href="../plan-studio/index.html">How it works</a><a href="../pricing/">Pricing</a><a href="../plan-studio/index.html#addons">Add-ons</a><a href="../subdivision/">Subdivisions</a><a href="../sample-plan-set/">Sample plan set</a><a href="../how-accurate-is-it/">How accurate is it</a></nav>`

Find: `<p class="legal-line">Glide Inside provides concept planning tools only. Setbacks and other planning controls shown are indicative, are not a planning or building approval, and must be checked with the relevant council and a suitably qualified person before you rely on them. Prices include GST.</p>`
Replace with: `<p class="legal-line">Glide Inside provides concept planning tools only. Plans are not a survey, a development application, a building approval, or engineering, legal or financial advice. Setbacks, zoning, parking rates and other controls are indicative, can be wrong or out of date, and must be checked with the relevant council and suitably qualified people before you rely on them. Data has been cropped and redrawn and is not a survey. Glide Inside is a software tool. It is not an architect and does not provide architectural services. Prices include GST. See <a class="link" href="../how-accurate-is-it/">how accurate it is</a>, the <a class="link" href="../plan-terms.html">Plan set terms of use</a> and the <a class="link" href="../terms.html">Order terms</a>.</p>`

## 7. Not changed (owner decision)

The attribution line `Cadastre and imagery &copy; NSW Spatial Services (CC BY 3.0 AU); Queensland Government data.` is left as it stands. It is shorter than the attribution on the other pages. Make it match the other pages (`Cadastre and imagery &copy; NSW Spatial Services (CC BY 3.0 AU). Queensland cadastre &copy; State of Queensland (CC BY 4.0); Queensland aerial imagery and elevation data &copy; State of Queensland (CC BY-SA).`) if the live copy is still the short form.
