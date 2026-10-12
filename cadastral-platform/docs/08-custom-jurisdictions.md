# 08. Custom jurisdictions (any council, any country)

NSW and QLD stay built in (SA1 NSW/QLD services, Gunnedah knowledge base, AS/NZS references, MGA). A **custom
municipality** lets a customer use the platform anywhere else by loading their own engineering documents and choosing
their units. Code: `backend/app/jurisdiction/`. Migration: `db/006_jurisdictions.sql`.

## Workflow

1. **Create a `JurisdictionProfile`** (`make_profile(...)`, stored in `core.jurisdiction_profiles`, owner = user and/or org, RLS on).
   It holds: name, country, region, municipality, languages; unit system (`metric`, `imperial_us`, `imperial_uk`) with per-quantity
   display units (length m/ft/in, area m2/ft2/acre/ha, volume m3/yd3/ft3/L/gal, slope % or 1:n, flow L/s/cfs/gpm, pressure kPa/psi);
   CRS (any EPSG code, vertical datum name, north reference grid/true/magnetic with declination entry); locale (decimal comma, date
   format); cited standards (free text, e.g. "AASHTO", "County Code Ch. 9"); vehicle slots; legal pack key (placeholder
   `generic_international`); imagery config (your own tile/WMS URL or none); cadastre source (`custom`); paper size (A3, ARCH D, ANSI B).
2. **CRS rules.** The profile validates EPSG codes with pyproj. Geometry is always computed in a *metric projected working CRS*
   (`crs.working_epsg`). It is the horizontal CRS when that is projected in metres; otherwise (state plane in feet, geographic) you
   give `working_epsg` or an `anchor_lonlat` from which a UTM zone is derived. Geographic or non-metre working CRSs are rejected.
   `LotContext.mga_srid` carries the working EPSG for custom lots (`jurisdiction="CUSTOM"`).
3. **Load documents.** `CustomMunicipalityKnowledge.add_document(pdf, language="es", ...)` tags each PDF with the profile and its
   language, then `resolve()` runs the requirements resolver over the standard keys (setbacks, driveway grade/width, sewer/water
   cover and clearances, stormwater, ESC, RWT) and reports resolved vs unresolved with citations.
   * The stored `quote` is always the **original-language** text and the citation validator (`verify_citations`) checks only that.
     The English gloss (`quote_en`) is stored beside it, flagged `quote_en_machine_translated`, and never validated.
   * Non-English documents use the LLM path only (supply `llm=`; optional `translator=`, and `query_terms` per language for retrieval).
     Deterministic table/regex extraction runs only for English + metric profiles.
   * Units in the document are converted by dimensional analysis to the canonical unit of each key. A missing or ambiguous unit
     (bare `gal`, `FT`, no unit) leaves the key **unresolved** with a prompt; it is never guessed. Decimal commas are read per locale.
4. **Enter the rest by hand.** `enter_value(key, value, unit=..., who=...)` stores a `user_confirmed` requirement with the unit you
   chose (`entered_value`/`entered_unit` keep what you typed, `value`/`unit` hold the canonical form).
   `profile_requirements(profile, kb)` returns the `RequirementSet` that SA3/SA4/SA10 already accept. With no knowledge base it is empty,
   so every lookup raises `UnresolvedRequirement` (nothing is defaulted).
5. **Give the parcel.** `Sa1CustomParcel(profile).run(CustomParcelRequest(...))` returns the same `Sa1Result`/`LotContext`:
   GeoJSON (CRS must be stated or given as `source_epsg`), closed DXF polyline (units from `$INSUNITS`, or you confirm them),
   KML, shapefile zip (needs the optional `pyshp`), typed coordinates, or a bearings-and-distances **traverse** with a misclosure check
   (default 1:5000; worse is rejected unless `accept_misclosure`, optional compass-rule adjustment). Traverse bearings are relative to
   the profile's north reference and are rotated to grid north. Mark road frontage with `front_edges` or `road_lines`.
   `adapter.sa1_for_profile` and `run_site.py --profile P.json --parcel parcel.json` select this path when `cadastre_source.kind == 'custom'`.
6. **Export.** SA5 reads `CadRequestSa5.display` (`DisplaySpec.from_profile`; `adapter.cad_request_for_profile`). Geometry stays metric
   internally; dimension, area, scale-bar, level and depth *labels* use the profile units and locale. Imperial exports scale model space
   to feet and set `$INSUNITS` (2 = ft). Feet-based scales that are a multiple of 12 print as engineering scales (1:240 = `1"=20'`).
   Paper: A3 (default), ANSI B (431.8 x 279.4), ARCH D (914.4 x 609.6). Title block shows the profile's datum text and cited standards.

## Units (`units.py`)

Pint-free; exact `Fraction` factors to SI. `convert`, `Quantity` (dimension-checked add/compare, length x length = area),
`parse_slope` (`1:12` = 8.333 %, not 8.33 %), `parse_feet_inches`. Errors: `UnitMismatch` (dimension differs, e.g. m to m2),
`AmbiguousUnit` (`gal`, `gpm`, `FT`, `M`, resolved only by `UnitContext` from the profile, or by explicit user confirmation),
`UnknownUnit`. `ft` is the international foot; the US survey foot is the explicit unit `ft_us` (or `UnitSettings.foot="us_survey"`).
`Requirement.value_in("ft")` converts any numeric requirement.

## What is NOT verified for non-AU jurisdictions

* **No built-in data services.** No cadastre, zoning, flood, bushfire, heritage or utility data is fetched; SA9 constraints are skipped
  for custom profiles. Imagery is only what you configure.
* **Legal text needs local counsel.** `legal_pack_key = generic_international` is a placeholder. The Terms, acknowledgements and
  disclaimers were written for NSW/QLD and must be reviewed and replaced by local counsel before any custom-jurisdiction use.
* **Vehicle libraries and standards are yours to supply.** Only the existing AS/NZS B85/B99 entries ship (still flagged VERIFY).
  The `P`, `SU-30`, `WB-40` slots are empty on purpose; no AASHTO dimensions are asserted. SA3 refuses an incomplete slot.
* **Extracted values are unverified.** A citation proves the quote exists in your document, not that the document is current,
  applicable to the zone, or correctly extracted. Machine translations are for reading only. Engineering sign-off is the user's.
* Drawings remain "indicative only, not a survey". Parcel geometry is whatever you supplied; the platform does not check it against
  any registry. Area mismatch is flagged only when you give a registered area.
* SA2's setback pipeline, SA3 templates and SA9 rules were built around AU conventions; check each output against your standard.
* Not yet persisted by an API: the profile repository functions and endpoints are not part of this change (the table and the
  `to_db_row` mappings exist).
