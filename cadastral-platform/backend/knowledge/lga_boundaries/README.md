# LGA boundary files (offline fallback)

`app/jurisdiction/lga.py` tests the site point against every `*.geojson` file in this folder when the live LGA boundary
services cannot be reached. No boundary data is shipped here: add the files from the state sources once confirmed
(NSW Spatial Services, Queensland spatial catalogue) and record the source, licence and download date beside them.

File shape:

* GeoJSON `FeatureCollection` in EPSG:4326 or GDA2020 longitude and latitude degrees.
* One Polygon or MultiPolygon feature per LGA with the LGA name in one of the properties `lganame`, `lga_name`, `lga`,
  `shire_name`, `name` or `abs_name`.
* The state comes from a `state` property ("NSW" or "QLD") or from the file name starting `nsw` or `qld`
  (for example `nsw_lga.geojson`, `qld_lga.geojson`). Features without a state give a result with no LGA code.

Tests use SYNTHETIC TEST FIXTURE polygons built in a temporary folder. They are never real boundaries.
