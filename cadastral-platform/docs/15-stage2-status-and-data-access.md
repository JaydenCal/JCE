# 15. Stage 2 status, LiDAR access and DBYD access

Date: 15/10/2026. Status: STAGE 2 COMPLETE, AWAITING OWNER REVIEW. Local commits only; nothing pushed to `jaydencal/jce`.

## 1. Stage 2 delivered

| Item | Result |
|---|---|
| Rebrand | SA6 is now `sa6_site3d` (`AgentCode.SA6_SITE3D`). Migration `db/008_sa6_site3d_rename.sql` renames the database enum value. No GlideInside text remains outside docs 13 and 14 and the original 001 schema. |
| AI draft statement | One constant (`app/common/statement.py`), forced into every scene bundle by the model and the API, and always rendered from the constant by the viewer: review, place, assistant and first person views, loading and error states, and burned into snapshots. A bundle cannot replace it. |
| Site only | The scene builds with no house, no FFL and no development type. With no terrain the ground is a flat placeholder labelled TERRAIN DATA NOT AVAILABLE; grades, pit depths and service depths that were never supplied show DATA NOT AVAILABLE. Levels outside the supplied terrain are labelled EXTRAPOLATED, NOT SURVEYED. |
| Contract fixes | `GET /projects/{id}/scene-bundle` added. The viewer no longer falls back to demo data; the demo page is labelled DEMO DATA, NOT A REAL SITE. Backend items are normalised for the viewer, and an item without a model is drawn as a labelled proxy. `services` and `dbyd` layers are handled alike. |
| LGA lookup | `app/jurisdiction/lga.py`: point query against the NSW LocalGovernmentArea layer and the QLD Local government layer (layer metadata confirmed 14/10/2026), then offline boundary files, then the lot attribute. The result records whether the boundary was tested, whether the source is verified, and any ambiguity. |
| Rules | Status `platform_default` with three stamps: LGA RULE NOT LOADED, LGA VALUE NOT FOUND, LGA VALUE UNRESOLVED. A cited LGA or state value always wins; a conflict still blocks; one LGA's rows cannot answer for another. Default profile: OSD required and PSD 2 L/s, NSW and QLD. Migration `db/007_platform_default.sql` and loader `scripts/load_requirements.py`. |
| Review | Two Opus review passes. All findings closed except the items in section 2. |
| Tests | Backend 632 passed, 60 skipped (database tests). Frontend type check clean, 57 passed. |

## 2. Known limitations carried forward

- An LGA rule row that carries no state matches by name only. All shipped rows carry a state; the loader must keep it that way.
- A state is inferred from an LGA code prefix (for example `nsw-`) when no jurisdiction is passed.
- Gunnedah has cited OSD rules but no PSD value, so Gunnedah sites show 2 L/s stamped PLATFORM DEFAULT, LGA VALUE NOT FOUND (owner decision D3).
- Live endpoints (LGA layers, terrain services) have not been called from the backend host; this sandbox blocks them. First live run is needed.
- TODO (stage 3 review finding 15): the orchestrator and API wiring of `terrain_provenance` is not done. The terrain chain, `terrain_provenance` and the aerial layer are wired only in `scripts/run_site.py`, so scenes built through the orchestrator or the scene API carry no terrain provenance and no aerial until that wiring is added.
- The remaining hard coded SA6 display values (kerb, gutter, wall thickness, building wall height and roof pitch for a placed house) are listed for stage 4 and stage 5.

- Tile library overlap priority works on tile footprints, not valid cells: a newer tile that is all no data over the lot shuts out a valid older tile and the run falls back to the labelled 5 m DEM. To be changed to cell by cell filling when real ELVIS tiles are loaded (stage 3 review, 15/10/2026).
- Offline fixture runs still show licence and datum rows quoted from the NSW service metadata, although no service was called.

## 3. LiDAR access

| State | Primary | Fallback | Notes |
|---|---|---|---|
| QLD | `spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer` exportImage by bounding box (0.5 m and 1 m bare earth LiDAR) | Geoscience Australia 5 m LiDAR DEM (WCS) | Check LiDAR coverage first with `Elevation/ElevationProjectExtents/MapServer`, otherwise the service returns 30 m SRTM fill. Licence CC BY SA: confirm the effect on outputs. |
| NSW | No automatic 1 m service exists. ELVIS orders are a web form with an emailed 48 hour link. Proposal: order ELVIS 1 m DEM tiles for the target areas, convert to cloud optimised GeoTIFF and host them for the platform (CC BY 4.0). | NSW 5 m DEM (existing), labelled indicative | Tiles can also be uploaded by the user per project. |
| Both | User supplied survey or LiDAR file (GeoTIFF, LAZ, DXF contours) always takes priority. | | ICSM LiDAR specification: 0.30 m vertical at 95 percent confidence. |

## 4. DBYD access

- BYDA offers a member API (per user API key, JSON, enquiry lodgement with a GeoJSON site polygon). Responses remain asset owner plans, mostly PDF. Whether plan files can be retrieved through the API is unconfirmed.
- BYDA and asset owner terms (for example Telstra) restrict copying, redistribution and commercial use of plans without consent.
- Proposed workflow: each end user lodges their own enquiry (in BYDA or with their own key), uploads the response plans privately to their own project, traces or imports the services into that project only, and marks each service verified. The platform records the plan date and expiry and shows INDICATIVE ONLY. Nothing is shared across users. A shared digitised dataset needs written consent from BYDA and the asset owners.

## 5. Questions for the owner

1. NSW LiDAR: is a hosted tile library from manual ELVIS orders acceptable, starting with which areas?
2. QLD terrain licence (CC BY SA): accept, or check before use?
3. BYDA: is there an existing BYDA membership and API key, and should JCESITE seek written consent for digitising plans?
4. Can a first live run of the LGA and terrain endpoints be made from your machine or the server?
