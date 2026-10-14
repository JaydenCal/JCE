# 16. Stage 4: editing core

Date: 15/10/2026. Status: STAGE 4 COMPLETE, AWAITING OWNER REVIEW. Local commit only; nothing pushed.

## 1. What was built

| Item | Where |
|---|---|
| `site_design.v1` types and helpers | `frontend/src/lib/site/types.ts` |
| Pydantic model of the same schema | `backend/app/design/site_design.py` (shared fixture `backend/tests/fixtures/site_design_v1.json` is validated by both sides) |
| Operation registry, `applyOp`, `runBatch`, `toolSchemas` | `frontend/src/lib/site/ops.ts` |
| JSON patch with exact inverses | `frontend/src/lib/site/patch.ts` |
| Store with patch undo and redo, events | `frontend/src/lib/site/store.ts` |
| Geometry checks (issues) | `frontend/src/lib/site/checks.ts` |
| Pure geometry and snapping | `frontend/src/lib/site/geom.ts`, `snap.ts` |
| Terrain height field, lot ring, terrain availability | `terrain.ts`, `lot.ts` |
| Incremental three.js scene | `siteScene.ts` |
| Tools (place, draw, select, handles, drag, delete) | `designController.ts`, wired into `lib/viewer/engine.ts` |
| Design tab | `components/viewer/DesignPanel.tsx`, `ViewerShell.tsx` |
| Persistence | `frontend/src/lib/site/persist.ts`, `backend/app/api/site_design.py` |

## 2. Design choices

- **Patch format.** RFC 6902 subset (add, remove, replace). An operation does not mutate; `run(doc, args, ctx)` returns a patch and a result. `applyPatch` copies only the nodes along each path, so unchanged objects keep their identity, and it returns the exact inverse computed from the state it was applied to. A history step is `{label, patch, inverse}`; the limit is 200. A batch is the concatenation of its step patches with one combined inverse, so it is one undo step.
- **Issues are derived data.** They are recomputed for the objects an edit, undo or redo touched, and for every object when the environment (lot ring, terrain) changes. They are never part of a history step, so the terrain and the bundle stay outside the undoable document.
- **Server version.** `version` in the document is the server save counter. Edits and undo never change it.
- **Snapping.** The pointer ray is cast against the terrain mesh (the same meshes first person uses for ground). The hit is snapped in MGA: boundary or object vertex, then edge, then the optional grid (off by default). The capture radius is 10 pixels converted to metres at the hit distance. Alt turns snapping off. The snapped point is lifted back onto the terrain with a height field built from the mesh triangles, so there is no flat plane anywhere.
- **Incremental rebuild.** One three.js group per object id. A store change event lists the ids that changed, were added or removed (by object identity), and only those groups are rebuilt. During a drag only the dragged object is rebuilt as a preview; the document changes once, when the pointer is released.
- **No invented dimensions.** New objects carry no parameters. `OBJECT_KINDS[type].dims` lists the parameter keys that give each type its size (placeholders until stage 7). While any is unset the object is a marker or an outline labelled DIMENSIONS NOT SET.

## 3. API: GET and PUT `/projects/{project_id}/site-design`

- Same access dependency pattern as the scene bundle route. 401 without a user, 404 for a project the caller cannot see.
- GET with no stored design returns 200 and an EMPTY document at version 0 (chosen over 404: a new project is a normal state, and 404 stays reserved for an unknown project).
- PUT takes the whole document. The body `version` must equal the stored version (0 when nothing is stored). A stale version returns 409 with `current_version` and nothing is written. A successful PUT stores version + 1, stamps `updated_at` and the project id, and returns the stored document. An invalid document returns 422.
- File location: `<SCENE_BUNDLE_DIR or export dir>/<project_id>/site_design.json`, written atomically.
- **Limits (sanity limits, not engineering values).** The PUT body is at most 5 MB (`MAX_BODY_BYTES`): 413 above it, decided from the declared length and again while the body streams, before anything is parsed or written. A document holds at most 200000 positions in total over all objects (`MAX_POSITIONS`), 5000 objects, 10000 vertices per object and 64 parameters per object; above any of them the answer is 422. A text parameter value is at most 200 characters (frontend and backend alike).
- **Strict numbers.** Positions and `yaw_deg` accept JSON numbers only. A boolean or a numeric string such as `"12.5"` is a 422, so the backend refuses what the frontend would never produce.
- **Drift check in both directions.** `frontend/tests/site/fixture_export.test.ts` builds a document only through registry operations (all eleven types, a vertex RL, every basis, an issue) and compares it with the committed `backend/tests/fixtures/site_design_v1_frontend.json`; it fails when the frontend output changes until `UPDATE_SITE_FIXTURE=1 npx vitest run tests/site/fixture_export.test.ts` regenerates the file. `backend/tests/test_site_design.py` validates that file with the Pydantic model. The older fixture `site_design_v1.json` is parsed and edited by the frontend in `persist.test.ts`.

## 4. Known limitations

- Objects sit on the same terrain meshes first person walks on (the highest of design surface and existing ground). Choosing existing ground for existing objects and the design surface for proposed ones waits for the grading stage.
- The lot ring is read from the scene bundle boundary line part. Without one, the outside lot check is not run and the panel says so.
- The PUT lock is per process. Several API workers would need a file or database lock.
- A rejected AI proposal is hidden in the model (kept in the list). There is no toggle to show rejected proposals yet.
- Labels are world sized sprites, like the existing labels.
- Pointer routing in the engine and the React panel are not covered by the unit tests; they were exercised in headless Chromium during development.
- `next build` needs Google Fonts; in a sandbox without network it only compiles when `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` points at a stub.

## 5. Review fixes (15/10/2026)

- **Shortcut.** D toggles Design only outside first person (D strafes right there), outside placing, outside any text field and without Ctrl, Meta or key repeat (`lib/viewer/shortcuts.ts`).
- **Loading the saved design.** The store is locked (read only) from creation until the saved design has loaded. While locked, `run`, `runBatch`, undo and redo refuse, the drawing tools do not start, nothing can be dragged and the panel shows LOADING SAVED DESIGN with the tools disabled. If the load fails the tools stay read only and the panel shows the error with two choices: try again, or edit a new local document after a confirmation in the panel. Autosave of that local document still runs under the version check, so it cannot replace a saved design without the conflict choice.
- **Surface length.** With no usable terrain the surface length is null and the panel shows SURFACE LENGTH: DATA NOT AVAILABLE (the plan length is still shown). The design height field is built only from terrain surface parts (classes surface, existing and context, further limited to the bundle's named walkable parts when it names any). There is no fallback to other meshes; with none, the terrain is unavailable. First person walking keeps its own mesh list.
- **Vertex drag** keeps an RL the vertex already had.
- **Operations.** `set_param` detects an existing key with `hasOwnProperty`; the keys `__proto__`, `constructor` and `prototype` are refused (also inside `add_object` params). `runBatch` reports any error of one step (OpError, PatchError or other) and carries on. A 65th parameter is refused (OpError). New op `remove_param` (undo restores the parameter). `edit_vertices.index` is an integer in `toolSchemas`.
- **Persistence.** The unload flush uses `fetch` with `keepalive: true` (it keeps the auth header, which `sendBeacon` cannot send); a body over 60000 bytes, above the browser keepalive limit, is sent as a normal request. Errors from Reload saved copy and Keep my copy are shown in the panel.
- **Scene.** The tool ghost is disposed when the tool ends. `disposeGroup` never disposes the Sprite geometry that every sprite shares. With the design layer hidden, objects cannot be picked, dragged or snapped to (the lot boundary still snaps) and the handles are hidden.
- **Double click.** A final vertex within the pixel capture radius (10 px converted to metres at the current camera scale) of the one before it is dropped when drawing is finished by double click.
- Not changed: the PUT route no longer declares its body model, so the OpenAPI document does not list the `site_design.v1` request schema (the body is read raw to enforce the size cap before parsing).
