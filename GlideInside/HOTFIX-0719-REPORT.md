# Hotfix 19/11/2026 (claude/hotfix-0719, from release-6 64de2002)

1. Neighbour context off: NEIGHBOUR_CONTEXT_ENABLED = false in src/viewer3d/site-extras.js (code kept); the "Neighbour houses (3D)" toggle is hidden.
2. Restored projects refetch the aerial and missing or empty contours once, quietly: src/site/restore-site.js, wired in src/app.js.
3. Labels: one source (lotIdentity in src/lotcard/stats.js); the address pill is rewritten from the loaded lot after every search outcome and while the card is hidden.
4. /plan-studio/portal/ 404: portalUrl, billing link and signInUrl are now absolute /portal/; website-live/plan-studio/portal/index.html redirects.
5. Toolbox: Driveway PIs sits beside Move house; short windows (max-height 860px) use a two column toolbox.
6. Click on the driveway with Select or Move house enters Driveway PIs (src/editor2d/drivepi-autoenter.js); Escape or a click off returns.
7. Draw a driveway with no garage (drawn driveway, Delete driveway button), and change type/design from the bottom left card (chevron).
8. Contours on by default in 3D; 2D RL labels larger and on every long contour.

Screenshots: /home/claude/shots/hotfix-0719/ (tools/hotfix-0719-shots.cjs).
