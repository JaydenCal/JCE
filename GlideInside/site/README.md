# Glide Inside v4 framework (PlanningAI-style, two products)

Drop-in files for the live site root (hosted static, cPanel). Existing pages, assets, `terms.html`, `privacy.html`, `services/`, `commercial/` stay as they are.

- `index.html` new home: hero, two product cards, workflow, services strip, FAQ. Replace the `#enquire` placeholder with the existing form.
- `plan-studio/index.html` product 1, 2D plan output, worked example: farm shed.
- `framework.css`, `framework.js`, `site.config.js` shared tokens, behaviour, prices and links (edit prices only in `site.config.js`).
- `_partials.html` header/footer to copy into new pages.

Colours, font and logo are the live brand (paper #f3f4ef, ink #232a28, terracotta #a3532d, Manrope).
Source of the live site is not in this repo, so the existing `style.css`, analytics and quote dock scripts are not linked here. Add them to each page's head if wanted.
Pocket Architect (PS-SCOPE-001) tool and Stripe/AI back end are not built here: the product page shows it as "Coming soon" (`premiumEnabled:false`).
