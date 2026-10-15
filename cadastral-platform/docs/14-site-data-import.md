# JCESITE: site data folder import

Date: 15/10/2026. Status: BUILT (app/sitedata, scripts/run_site.py --site-data, scripts/run_soee.py --site-data, tests/test_sitedata.py).

JCESITE is a platform product and is not affiliated with JCE Infrastructure. Every output is an AI generated draft, not checked or certified.

## 1. Purpose

The owner's PC data collector saves one folder per site. `--site-data DIR` reads that folder and feeds the lot boundary, the LiDAR levels and contours and the BYDA status into the plan set, the site report and the SoEE. Each item carries its provenance (file, dataset, capture date, stated accuracy, coordinate system). An item that is not in the folder is listed as missing and is never filled in.

## 2. Folder contract

All names are matched without regard to case. Every file is optional. The importer never raises on a missing, empty or corrupt file: it lists the item as missing and carries on.

| Path | Content | Used for |
|---|---|---|
| `lot_boundary.geojson` | GDA2020 (EPSG:7844) polygon; properties `name` and `area_ha` | Subject lot when the cadastre (SA1) returns none, or with `--use-site-boundary` |
| `lot_boundary_mga.csv` | `vertex, easting_mga56, northing_mga56` | Cross-check of the GeoJSON vertices (MGA zone taken from the CSV column name) |
| `site_controls.md` | Free text | Read as text, listed as NOT USED. It is never interpreted |
| `LiDAR/lidar_status.md` | Dataset, status, coordinate system, stated accuracy, collector's own site statistics | Terrain label, vertical accuracy, datum, provenance |
| `LiDAR/dem_2m_xyz.csv` | `easting_mga56, northing_mga56, rl_ahd` | Terrain survey (replaces the NSW 5 m DEM) |
| `LiDAR/*.tif` | Clipped GeoTIFF | Read only when there is no XYZ file |
| `LiDAR/contours_1m.geojson` | EPSG:7856 lines; properties `rl` and `major` | Existing contours on the plans (used as supplied, not regenerated) |
| `LiDAR/contours_1m.dxf` | Same contours | Fallback only when the GeoJSON is absent; otherwise listed as NOT USED |
| `BYDA/byda_status.md` | Job number, enquiry number, lodged and job dates, valid until, owner table | BYDA panels and statements |
| `BYDA/<owner>/*.pdf` | Asset owner plans | Listed by file name only. Never opened, copied, traced or redistributed |
| `BYDA/gis/*.geojson, *.dxf` | Owner vector data | Stored as DRAFT, UNVERIFIED features in the run JSON. Never drawn |

### Parsing rules

- Markdown is read with regular expressions on known keys and on the owner table. A BOM, CRLF, bold marks, backticks, extra columns and a reversed column order are accepted. Text that looks like an instruction is data and is ignored.
- The terrain label is built only from the parsed status: capture year, `LIDAR`, resolution, `(ELVIS)` when the file says so, and the stated vertical accuracy (for example `2022 LIDAR 1 m DEM (ELVIS), +/-0.30 m`). No accuracy in the file gives `ACCURACY NOT STATED`. Nothing is typed in the code.
- An owner counts as responded only on a positive statement (`response received`, `no assets`, and similar). `awaiting`, `pending`, `overdue`, an empty cell or anything unrecognised is not a response.
- A validity date that is absent is flagged as not stated. A date before the run date is flagged as expired.

## 3. How to run

```
python3 scripts/run_site.py --site-data /path/to/site_folder --lotplan 143//DP753851 --development-type dwelling_house \
    --acknowledge --planset --planset-style ref --report --out OUT
python3 scripts/run_soee.py --site-data /path/to/site_folder --lotplan 143//DP753851 --out OUT_SOEE
```

| Flag | Meaning |
|---|---|
| `--site-data DIR` | The collector folder |
| `--use-site-boundary` | Use the collector boundary as the subject lot even when SA1 returns a lot (SA1 frontage and neighbours are then carried over) |
| `--run-date DD/MM/YYYY` | Date the BYDA validity is compared with (default today) |
| `--lotplan`, `--address` | Optional with a site data folder. The lot identifier is otherwise read from the boundary name |

`run_soee.py` runs the pipeline itself when `--site-data` is given (no offline fixture and no default rules file). Faster runs when the NSW services are not reachable: `SA1_HTTP_RETRIES=0 SA1_HTTP_TIMEOUT=5`.

## 4. What the import does

1. Boundary. When SA1 returns no lot, the collector boundary is the subject lot, labelled `SITE DATA COLLECTOR: lot_boundary.geojson, <name>`. No road, neighbour, frontage or zone is invented. When SA1 also returns a lot the areas are compared and a difference over 2 percent is flagged (neither is silently chosen). The stated `area_ha` is checked against the computed area with the same tolerance.
2. Terrain. The LiDAR points are the terrain survey in place of the NSW 5 m DEM. Points are kept over the lot plus a 60 m margin. A lot with up to 15,000 points keeps all of them. A larger lot is thinned to one point per grid cell (the point nearest the cell centre, deterministic) so about 15,000 remain. The thinning is recorded (points read, points used, cell size).
3. Labels. Every place that said `5 m DEM` or `INDICATIVE, 5 m DEM` (plans, terrain notes, ESC basis, report, SoEE) states the parsed label. A run without `--site-data` is unchanged, byte for byte in text and entity counts.
4. Contours. The supplied contours are drawn as given (minor interval and major interval read from the file) and labelled with their source file. The fall direction and the discharge note are recomputed from the levels used. The collector's own best fit plane is shown beside the recomputed fall, and a difference is reported.
5. BYDA. The job headline is printed on C100, C310, the cover, the report and the SoEE: `BYDA JOB <no>: <n> OF <m> OWNERS RESPONDED; PLANS RECEIVED, NOT TRACED. EXISTING SERVICES NOT CONFIRMED ON THIS DRAWING`. The panel also states the enquiry dates, the validity against the run date, the owners without a response, that asset owner plans are for that project only, and that locations are to be confirmed by potholing. No service is drawn from a PDF. Vector files in `BYDA/gis` are held as DRAFT features (`drawn: false`) for the verification step in docs/12 and are not drawn.
6. Sources table. The report (data sources section) and the SoEE (1.5) carry a "Site data sources" table: item, source file, date, accuracy and datum, status (USED, NOT USED, MISSING, FLAGGED, DRAFT).
7. Large lots. The scale chooser steps through the standard scale list (1:100 up to 1:2500 and beyond) and prints the reason, for example `SCALE 1:1000 CHOSEN: LOT EXTENT EXCEEDS 1:100 VIEWPORT`. With no frontage the view is rotated to align the long axis of the lot with the sheet.
8. No frontage, no envelope. SA2, ENV, SA4, SA6 and the SA10 ESC layout need a zone, a front boundary and rules. When they are not available the sheets that depend on them print `NOT DRAWN` or `DATA NOT AVAILABLE` (C101, C310, C400, C410, C420, C500). The ESC layout is gated off because SA10 would otherwise assume the longest boundary is the frontage. No subdivision, driveway or building is designed.

## 5. Where the data is stored

`run_steps.json` facts: `site_data` (folder, run date, missing list, warnings, boundary check and comparison, LiDAR record with thinning and fall check, BYDA record with the panel text, owners and draft features, sources table), `levels_provenance` (kind `lidar`), plus the usual steps. The report JSON and the SoEE JSON (`soee.json`) keep the source of every statement.

## 6. Honest limits

- Without SA1 there is no zone, council, road, frontage or adjoining lot. Council requirements are UNRESOLVED unless the council knowledge file exists.
- Levels are indicative. The stated accuracy is the supplier's and is not verified. The TIN is thinned on large lots, so the steepest gradient check is understated.
- The collector's best fit plane can disagree with the recomputed fall (it did for Henrys Lane). Both are printed. The platform does not choose the collector's figure.
- The DXF is audited with ezdxf only, not opened in a CAD package.
- The BYDA plans are never read. A responded owner means plans exist, not that any service was traced.
- The legend on C001 still lists fixed entries (kerb, pavement, crossover) even when the sheets show them as not drawn.
