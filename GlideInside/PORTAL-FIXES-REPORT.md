# Portal fixes (claude/portal-fixes)

## Task 1: builders and clients see only their own designs
- Server (WIP commit): listGlide, getGlide and saveHouse fromGlideId only work for org.internal === true; everyone else gets [] / 404.
- UI hidden for non-internal orgs: Glide Inside library tab, "Start from the Glide Inside library" button (houses-tab.js), the clients-tab "show sample designs" setting row, and the text that mentioned the library (houses-tab lead, client access picker hint, save dialog).
- App: wantsGlide false unless internal; design-source.js only allows the Glide fallback for the internal account; mock-api.js mirrors the server.
- Tests fixed: portal-server (CSRF, role permissions, builder design mode, real browser client), portal (design mode, designers), trial. New: portal-server "ordinary builders and clients get [] and 404, internal account keeps the library"; wantsGlide matrix in portal.test.mjs.

## Task 2: opening an existing design goes straight into the editor
- Cause: app.js evaluates the guided flow with fromAutosave false on a portal open, so ?project= / ?house= started step 1 (with the tutorial popups); a project saved mid flow also carried project.flow step < 5.
- Fix: src/flow/state.js portalDeepLink(search) (?project, ?house, ?glide) and forEditing(project) (moves a mid-flow project to step 5). shouldStart returns false for a portal deep link; app.js skips the welcome card for it; client-mode.js loads projects and houses through forEditing.
- House design with no lot: editor opens with the design, and a toast "Find the lot" focuses the address search already shown in the Site panel.
- Unchanged: public visitor, "Design on a lot" (?design=new) and the home page card keep the guided flow.
- Tests: tests/portal-open-routing.test.mjs (routing decision, link builders, forEditing).
- Screenshots (/home/claude/shots/claude-portal-fixes/): 1 saved house design (no lot, Site panel address search), 2 client project, 3 Open as client view, 4 Design on a lot new (guided flow kept). Script: tools/portal-open-shots.cjs.
- Bundle website-live/plan-studio/app and portal/src rebuilt.

## Left
- "Open as client view" (?design=1&project=) opens the editor with the client strip (still the client experience, no guided steps); not changed to the bare full editor.
