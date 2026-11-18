# Stress test fixes (claude/stress-fixes, from release-6 0f238aa9)

Items 2 (re-check), 3, 4, 5, 6, 7, 8, 9 and 11 of REPORT-stress-test-20261119. All client side; server auth untouched.

- 2 Toolbar fits at 1536x730 (no inner scroll, residential 18 tools, commercial 19). No change needed.
- 3 Coach hides while a modal, terms dialog or profile prompt is open; profile prompt waits while the coach is up; coach falls back to a free screen corner (never over the lot card); Skip works on first press and is remembered.
- 4 Under 600 px the top bar is two rows with a More menu (src/ui/topbar-more.js); the lot card and pager step aside while the Confirm frontage card is up.
- 5 searchAddresses: 429 waits 2.5 s and retries once quietly (no error), empty results retry without "Busy"; createLiveSearch (300 ms debounce, AbortController per keystroke) used by both lot cards; find-block and the flow search abort on each keystroke.
- 6 /api/portal/me only called when localStorage gi.portal.hint is set at sign in (cleared on sign out or 401). Existing signed in browsers without the hint show as signed out until the next sign in.
- 7 The gate remembers a profile (session and device); only an explicit sign out or account delete forgets it.
- 8 arrangeOnLoad (auto fit, else best fitting design when none was chosen) on flow exit and sample or address lot in the editor; commercial fit wording says building.
- 9 One pill row (src/ui/pill-row.js) for Aerial, Use my own aerial and Grading; Back to placement sits beside it. No overlaps.
- 11 Council data, computed setbacks and printed or displayed citations turn en and em dashes into hyphens (src/site/plain-text.js).

Tests: new live-search, portal-me-hint, arrange-on-load, council-quote-dashes; extended tutorial, account-before-pdf, site-client-retry.
Screenshots: /home/claude/shots/stress-fixes/. Harness scripts: /home/claude/stress-fixes/.
