"""Stage 3 terrain chain: provider order, QLD LiDAR coverage skip, hosted tile library, provenance labels. Fakes only: no network.

Every raster here is a SYNTHETIC TEST FIXTURE generated in the test; none of it is survey, LiDAR or real data.
"""
from __future__ import annotations

import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, TiffImagePlugin, TiffTags
from pyproj import Transformer
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.agents.sa3_terrain import chain as CH  # noqa: E402
from app.agents.sa3_terrain import provenance as PV  # noqa: E402
from app.agents.sa3_terrain import qld_lidar as QL  # noqa: E402
from app.agents.sa3_terrain import tile_library as TL  # noqa: E402
from app.agents.sa3_terrain.raster import raster_to_points, read_f32  # noqa: E402

SRID = 7856
E0, N0 = 238000.0, 6569000.0
LOT = box(E0 + 20, N0 + 20, E0 + 50, N0 + 40)        # 30 x 20 m = 600 m2
LOT_WKT = LOT.wkt
QLD_E0, QLD_N0 = 502000.0, 6961000.0                    # Brisbane area MGA 56 (SYNTHETIC lot, not a real parcel)
QLD_LOT = box(QLD_E0 + 20, QLD_N0 + 20, QLD_E0 + 50, QLD_N0 + 40)


def tiff_bytes(arr: np.ndarray) -> bytes:
    b = io.BytesIO()
    Image.fromarray(arr.astype("float32"), mode="F").save(b, "TIFF")
    return b.getvalue()


def write_geotiff(path: Path, arr: np.ndarray, bbox: tuple[float, float, float, float]) -> None:
    """SYNTHETIC TEST FIXTURE: single band F32 GeoTIFF (ModelPixelScale, ModelTiepoint and a projected GeoKey for MGA 56) written with Pillow only."""
    h, w = arr.shape
    ifd = TiffImagePlugin.ImageFileDirectory_v2()
    ifd.tagtype[33550] = ifd.tagtype[33922] = TiffTags.DOUBLE
    ifd.tagtype[34735] = TiffTags.SHORT
    ifd[33550] = ((bbox[2] - bbox[0]) / w, (bbox[3] - bbox[1]) / h, 0.0)
    ifd[33922] = (0.0, 0.0, 0.0, bbox[0], bbox[3], 0.0)
    ifd[34735] = (1, 1, 0, 1, 3072, 0, 1, 7856)
    Image.fromarray(arr.astype("float32"), mode="F").save(path, "TIFF", tiffinfo=ifd)


def ramp(h, w, base=100.0, gx=0.01, gy=0.02):
    """Elevation rising 1 cm per column and 2 cm per row (row 0 = north), so any cell value is predictable."""
    r, c = np.indices((h, w))
    return base + gx * c + gy * r


# ---- provenance ---------------------------------------------------------------------------------------------------------------
def test_status_labels_are_the_owner_wording():
    assert PV.STATUS_SURVEY == "SURVEY (AS SUPPLIED)"
    assert PV.STATUS_QLD_LIDAR == "LIDAR (QLD STATE SERVICE), CC BY SA, NOT SURVEY"
    assert PV.STATUS_NSW_5M == "INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY"
    assert PV.STATUS_NONE == "TERRAIN DATA NOT AVAILABLE"
    assert PV.LIDAR_PENDING_NOTE == "LIDAR PENDING: ELVIS 1 m TILES TO BE ORDERED AND LOADED; NO HOSTED TILE COVERS THIS LOT"
    # upper case label, but the unit token keeps its case: "5 m", never "5 M"
    assert PV.TerrainProvenance(tier=4, status=PV.STATUS_NSW_5M).label_text() == "TERRAIN: INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY"
    assert PV.TerrainProvenance(tier=4, status=PV.STATUS_NSW_5M).summary_rows()[0] == ("Terrain status", "INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY")


def test_dates_are_ddmmyyyy_and_unreadable_dates_are_none():
    assert PV.ddmmyyyy(1560211200000) == "11/06/2019"
    assert PV.ddmmyyyy("2019-06-11") == "11/06/2019" and PV.ddmmyyyy("11/06/2019") == "11/06/2019"
    assert PV.ddmmyyyy(datetime(2026, 10, 15, tzinfo=timezone.utc)) == "15/10/2026"
    assert PV.ddmmyyyy(None) is None and PV.ddmmyyyy("") is None and PV.ddmmyyyy("not a date") is None


def test_stated_accuracy_is_parsed_only_when_clean():
    assert PV.parse_accuracy_m("0.3 m @ 95% CL") == pytest.approx(0.3)
    assert PV.parse_accuracy_m("15 cm") == pytest.approx(0.15)
    assert PV.parse_accuracy_m("NOT STATED") is None and PV.parse_accuracy_m("") is None and PV.parse_accuracy_m(None) is None
    assert PV.parse_accuracy_m("better than expected") is None


def test_none_provenance_label():
    p = PV.none_provenance([{"provider": "x"}])
    assert p.status == "TERRAIN DATA NOT AVAILABLE" and p.tier == 5 and p.attempts == [{"provider": "x"}]


# ---- chain order --------------------------------------------------------------------------------------------------------------
class Fake:
    def __init__(self, tier, name, behaviour):
        self.tier, self.name, self.behaviour, self.calls = tier, name, behaviour, 0

    def fetch(self, req):
        self.calls += 1
        if isinstance(self.behaviour, Exception):
            raise self.behaviour
        return CH.TerrainResult([(1.0, 2.0, 3.0)], PV.TerrainProvenance(tier=self.tier, status=f"STATUS {self.tier}", source_name=self.name, notes=[f"note {self.tier}"]), {})


REQ = CH.TerrainRequest(boundary_wkt=LOT_WKT, srid=SRID, state="NSW")


def test_first_available_provider_wins_and_lower_tiers_are_not_called():
    ps = [Fake(1, "survey", CH.ProviderSkip("none", notable=False)), Fake(2, "qld", CH.ProviderSkip("no coverage")), Fake(3, "tiles", None), Fake(4, "nsw", None)]
    out = CH.resolve_terrain(ps, REQ)
    assert out.provenance.tier == 3 and out.result is not None
    assert [p.calls for p in ps] == [1, 1, 1, 0]                       # tier 4 never called
    assert [a["outcome"] for a in out.attempts] == ["SKIPPED", "SKIPPED", "USED"]
    assert out.provenance.attempts == out.attempts
    assert out.provenance.notes == ["no coverage", "note 3"]          # the notable skip note travels, the plain "does not apply" one does not


def test_survey_beats_everything_when_present():
    ps = [Fake(1, "survey", None), Fake(2, "qld", None), Fake(4, "nsw", None)]
    assert CH.resolve_terrain(ps, REQ).provenance.tier == 1 and ps[1].calls == 0 and ps[2].calls == 0


def test_a_failing_provider_is_recorded_and_the_chain_continues():
    out = CH.resolve_terrain([Fake(2, "qld", RuntimeError("HTTP 500")), Fake(4, "nsw", None)], REQ)
    assert out.provenance.tier == 4
    assert out.attempts[0]["outcome"] == "ERROR" and "HTTP 500" in out.attempts[0]["note"]
    assert any("qld FAILED" in n and "HTTP 500" in n for n in out.provenance.notes)


def test_nothing_available_gives_terrain_data_not_available_with_the_reasons():
    out = CH.resolve_terrain([Fake(2, "qld", CH.ProviderSkip("no LiDAR coverage")), Fake(4, "nsw", RuntimeError("down"))], REQ)
    assert out.result is None and out.provenance.status == "TERRAIN DATA NOT AVAILABLE"
    assert [a["outcome"] for a in out.attempts] == ["SKIPPED", "ERROR"]
    assert "no LiDAR coverage" in out.provenance.notes and any("nsw FAILED" in n for n in out.provenance.notes)


# ---- tier 1: user survey ------------------------------------------------------------------------------------------------------
def survey_dict(**kw):
    pts = [(E0 + 20 + 10 * i, N0 + 20 + 10 * j, 100.0 + 0.1 * i + 0.2 * j) for i in range(4) for j in range(3)]
    return {"srid": SRID, "points": pts, "source": "Survey by A. Surveyor 01/10/2026", **kw}


def test_survey_provider_status_and_accuracy_stated_vs_not():
    r = CH.SurveyProvider().fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", survey=survey_dict()))
    assert r.provenance.status == "SURVEY (AS SUPPLIED)" and r.provenance.tier == 1 and len(r.points) == 12
    assert r.provenance.accuracy_text == "NOT STATED" and r.provenance.accuracy_m is None       # default 0.1 was never stated by the user
    r2 = CH.SurveyProvider().fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", survey=survey_dict(stated_vertical_accuracy_m=0.05)))
    assert r2.provenance.accuracy_text == "0.05 m (as supplied)" and r2.provenance.accuracy_m == 0.05


def test_survey_provider_skips_without_survey_and_a_bad_survey_falls_through_loudly():
    with pytest.raises(CH.ProviderSkip):
        CH.SurveyProvider().fetch(REQ)
    bad = CH.TerrainRequest(LOT_WKT, SRID, "NSW", survey=survey_dict(srid=7854))      # zone mismatch with the lot
    out = CH.resolve_terrain([CH.SurveyProvider(), Fake(4, "nsw", None)], bad)
    assert out.provenance.tier == 4 and any("USER SUPPLIED SURVEY COULD NOT BE USED" in n for n in out.provenance.notes)


# ---- tier 4: NSW 5 m DEM ------------------------------------------------------------------------------------------------------
def nsw_export(service, bbox, w, h, timeout=0.0):
    return tiff_bytes(ramp(h, w, 264.0, 0.0, -0.01))


def test_nsw_5m_provider_status_and_no_pending_note_unless_the_index_has_no_coverage():
    out = CH.resolve_terrain([TL.TileLibraryProvider(None), CH.Nsw5mProvider(export=nsw_export)], REQ)
    p = out.provenance
    assert p.tier == 4 and p.status == "INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY" and p.resolution_m == 5.0
    assert p.accuracy_text == "NOT STATED" and p.capture_date is None and p.capture_text == "CAPTURE DATE NOT STATED"
    assert not [n for n in p.notes if n.startswith("LIDAR PENDING: ELVIS")]          # an unconfigured library is not "no coverage"
    assert any("not configured" in n for n in p.notes)
    assert len(out.result.points) > 20 and "NSW_5M_Elevation" in p.url
    assert out.result.survey["srid"] == SRID


def test_nsw_5m_alone_does_not_claim_the_pending_note():
    out = CH.resolve_terrain([CH.Nsw5mProvider(export=nsw_export)], REQ)
    assert PV.LIDAR_PENDING_NOTE not in out.provenance.notes
    assert out.provenance.effective_spacing_m == 5.0                                  # stride 1: sampled at the product spacing


def test_nsw_lot_with_no_tile_in_the_index_carries_the_pending_note_once(tmp_path):
    store = make_library(tmp_path, [tile_entry(bbox=(E0 + 5000, N0 + 5000, E0 + 5100, N0 + 5100))], {"SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif": ramp(100, 100)})
    out = CH.resolve_terrain([TL.TileLibraryProvider(store), CH.Nsw5mProvider(export=nsw_export)], REQ)
    assert out.provenance.tier == 4 and out.provenance.notes.count(PV.LIDAR_PENDING_NOTE) == 1


def test_nsw_5m_skips_qld_lots():
    with pytest.raises(CH.ProviderSkip):
        CH.Nsw5mProvider(export=nsw_export).fetch(CH.TerrainRequest(LOT_WKT, SRID, "QLD"))


# ---- tier 2: QLD LiDAR --------------------------------------------------------------------------------------------------------
def tile_feature(footprint, **attrs):
    a = {"tile_name": "SW_502000_6961000", "project_name": "Brisbane_2019_Prj", "title": "Queensland LiDAR Data - Brisbane 2019 Project",
         "start_date": 1560211200000, "end_date": 1565913600000, "mga_zone": 56, "geotif_dem": "1 m", "horiz_acc": "0.8 m @ 95% CL", "vert_acc": "0.3 m @ 95% CL",
         "available_for_download": "Yes"}
    a.update(attrs)
    return {"attributes": a, "geometry": {"rings": [[list(c) for c in footprint.exterior.coords]]}}


class QldFakes:
    """Query and export fakes for the two QLD services; records every call."""

    def __init__(self, projects=None, tiles=None, raster=None):
        self.projects = [{"attributes": {"project_name": "Brisbane_2019_Prj"}}] if projects is None else projects
        self.tiles = [tile_feature(box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 1000))] if tiles is None else tiles
        self.raster, self.calls, self.exports = raster, [], []

    def query(self, url, params):
        self.calls.append((url, params))
        return {"features": self.projects} if url.endswith("/200/query") else {"features": self.tiles}

    def export(self, url, params):
        self.exports.append((url, params))
        w, h = (int(v) for v in params["size"].split(","))
        return self.raster(w, h) if self.raster else tiff_bytes(np.full((h, w), 12.5))


QREQ = CH.TerrainRequest(QLD_LOT.wkt, SRID, "QLD", buffer_m=20.0)


def test_qld_provider_requests_in_3857_and_builds_a_lidar_result():
    f = QldFakes()
    r = QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    p = r.provenance
    assert p.status == "LIDAR (QLD STATE SERVICE), CC BY SA, NOT SURVEY" and p.tier == 2
    assert len(r.points) > 100 and all(abs(z - 12.5) < 1e-6 for _, _, z in r.points)
    url, params = f.exports[0]
    assert url == QL.DEM_SERVICE + "/exportImage" and params["bboxSR"] == 102100 and params["imageSR"] == 102100 and params["pixelType"] == "F32"
    w, h = (int(v) for v in params["size"].split(","))
    assert w <= 4096 and h <= 2048 and params["format"] == "tiff"
    # the coverage queries hit layers 200 and 100 of ElevationProjectExtents with the lot envelope in the lot CRS
    urls = [c[0] for c in f.calls]
    assert urls == [QL.EXTENTS_SERVICE + "/200/query", QL.EXTENTS_SERVICE + "/100/query"]
    assert f.calls[1][1]["inSR"] == SRID and f.calls[1][1]["returnGeometry"] == "true"
    # provenance carries the stated project values, in DD/MM/YYYY
    assert p.capture_date == "11/06/2019 TO 16/08/2019" and p.accuracy_text == "0.3 m @ 95% CL" and p.accuracy_m == pytest.approx(0.3)
    assert p.resolution_text == "1 m" and p.resolution_m == 1.0 and "CC BY SA" in p.licence and "NOT STATED BY THE SERVICE" in p.datum
    assert all(PV.ddmmyyyy(1) for _ in [0])
    # points are real MGA metres inside the lot zone
    zone = QLD_LOT.buffer(20.0)
    assert all(zone.contains(box(x, y, x, y).centroid) for x, y, _ in r.points[:50])
    assert r.survey["stated_vertical_accuracy_m"] == pytest.approx(0.3)


def test_qld_no_lidar_project_coverage_is_skipped_with_a_note():
    f = QldFakes(projects=[], tiles=[])
    with pytest.raises(CH.ProviderSkip) as ex:
        QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert "no QLD LiDAR project coverage" in ex.value.note and "SRTM" in ex.value.note
    assert f.exports == []                                                         # the DEM service is never asked, so no SRTM fill can arrive


def test_qld_project_without_tile_footprint_is_skipped():
    f = QldFakes(tiles=[])
    with pytest.raises(CH.ProviderSkip) as ex:
        QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert "no LiDAR tile footprint" in ex.value.note and f.exports == []


def test_qld_partial_footprint_is_skipped_not_mixed_with_srtm():
    half = box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 30)                       # covers the south part of the lot only
    f = QldFakes(tiles=[tile_feature(half)])
    with pytest.raises(CH.ProviderSkip) as ex:
        QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert "cover only" in ex.value.note and f.exports == []


def test_qld_points_outside_the_footprint_are_excluded():
    fp = box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 45)                          # lot ends at +40, buffer to +60: the north strip is outside the footprint
    f = QldFakes(tiles=[tile_feature(fp)])
    r = QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert max(y for _, y, _ in r.points) <= QLD_N0 + 45 + 1e-6 and max(y for _, y, _ in r.points) > QLD_N0 + 40
    assert any("SRTM fill" in n for n in r.provenance.notes)


def test_qld_not_a_qld_lot_is_skipped_without_calling_the_services():
    f = QldFakes()
    with pytest.raises(CH.ProviderSkip) as ex:
        QL.QldLidarProvider(f.query, f.export).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW"))
    assert ex.value.notable is False and f.calls == [] and f.exports == []


def test_qld_overlapping_projects_are_reported_per_project_never_as_one_invented_value():
    t2 = tile_feature(box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 1000), project_name="Brisbane_2025_Prj", geotif_dem="0.5 m", vert_acc="0.2 m @ 95% CL",
                      start_date=1747872000000, end_date=1748131200000)
    t3 = tile_feature(box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 1000), project_name="Brisbane_2009_LGA", vert_acc="0.15 m @ 68% CL", geotif_dem="1 m")
    f = QldFakes(tiles=[tile_feature(box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 1000)), t2, t3])
    p = QL.QldLidarProvider(f.query, f.export).fetch(QREQ).provenance
    assert p.capture_date.startswith("PROJECT DEPENDENT, CELL SOURCE NOT STATED BY THE SERVICE")
    assert "Brisbane_2025_Prj" in p.capture_date and "Brisbane_2009_LGA" in p.capture_date
    assert p.accuracy_text.startswith("PROJECT DEPENDENT") and "0.2 m @ 95% CL (Brisbane_2025_Prj)" in p.accuracy_text
    assert p.accuracy_m == pytest.approx(0.3)                                    # largest stated value, conservative
    assert p.resolution_m == 0.5 and "(Brisbane_2025_Prj)" in p.resolution_text
    assert any("LARGEST value" in n for n in p.notes)


def test_qld_unparseable_accuracy_stays_not_stated_numerically():
    f = QldFakes(tiles=[tile_feature(box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 1000), vert_acc="see metadata")])
    r = QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert r.provenance.accuracy_m is None and r.provenance.accuracy_text == "see metadata"
    assert any("NOT STATED" in w for w in r.warnings)


def test_qld_export_that_is_not_a_tiff_is_an_error_not_data():
    f = QldFakes(raster=lambda w, h: b'{"error": {"code": 400}}')
    with pytest.raises(ValueError):
        QL.QldLidarProvider(f.query, f.export).fetch(QREQ)


def test_qld_large_lot_is_coarsened_to_the_service_limit():
    big = box(QLD_E0, QLD_N0, QLD_E0 + 6000, QLD_N0 + 3000)
    zone = big.buffer(10)
    bbox, w, h, pix, coarse = QL.export_geometry(zone, SRID, 1.0)
    assert coarse and w <= 4096 and h <= 2048 and pix > 1.0
    _, w2, h2, pix2, coarse2 = QL.export_geometry(QLD_LOT.buffer(20), SRID, 1.0)
    assert not coarse2 and 1.0 < pix2 < 1.2                                       # web pixel is ground size / cos(latitude), about 1.12 at Brisbane


def test_qld_project_query_requests_all_fields():
    f = QldFakes()
    QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert f.calls[0][0].endswith("/200/query") and f.calls[0][1]["outFields"] == "*"


def test_qld_only_tiles_with_a_dem_product_count_as_coverage():
    """Layer 100 footprints with an empty geotif_dem value are not DEM coverage (the DEM service would return SRTM fill there)."""
    full = box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 1000)
    for empty in ("", None, "   "):
        f = QldFakes(tiles=[tile_feature(full, geotif_dem=empty)])
        with pytest.raises(CH.ProviderSkip) as ex:
            QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
        assert "no LiDAR tile footprint" in ex.value.note and f.exports == []
    # a tile with a DEM product next to a tile without one: only the first is coverage, so the south-only footprint is a partial cover
    f = QldFakes(tiles=[tile_feature(box(QLD_E0, QLD_N0, QLD_E0 + 1000, QLD_N0 + 30)), tile_feature(box(QLD_E0, QLD_N0 + 30, QLD_E0 + 1000, QLD_N0 + 1000), geotif_dem="")])
    with pytest.raises(CH.ProviderSkip) as ex:
        QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert "cover only" in ex.value.note and f.exports == []


def test_qld_georeferencing_with_a_position_coded_raster_detects_a_flip():
    """SYNTHETIC TEST FIXTURE: the fake service returns z = a linear function of the Web Mercator position of each cell centre (row 0 = north).
    Every returned point must carry the z of its own position; a north/south or east/west flip would break the match."""
    f = QldFakes()
    to_web = Transformer.from_crs(SRID, 3857, always_xy=True)

    def code(x, y):
        return 10.0 + 0.001 * (x - 16_800_000.0) + 0.002 * (y - -3_000_000.0)

    def raster(w, h):
        x0, y0, x1, y1 = (float(v) for v in f.exports[-1][1]["bbox"].split(","))
        cx = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w
        cy = y1 - (np.arange(h) + 0.5) * (y1 - y0) / h                           # row 0 is the north edge
        gx, gy = np.meshgrid(cx, cy)
        return tiff_bytes(code(gx, gy))

    f.raster = raster
    r = QL.QldLidarProvider(f.query, f.export).fetch(QREQ)
    assert len(r.points) > 100
    worst = 0.0
    for e, n, z in r.points:
        x, y = to_web.transform(e, n)
        worst = max(worst, abs(z - code(x, y)))
    assert worst < 0.01                                                            # float32 storage only
    zs = {round(z, 3) for _, _, z in r.points}
    assert len(zs) > 50 and min(z for _, n, z in r.points if n > QLD_N0 + 40) > min(z for _, n, z in r.points if n < QLD_N0 + 20)   # rises to the north


def test_qld_effective_spacing_follows_the_coarsened_request():
    big = box(QLD_E0, QLD_N0, QLD_E0 + 3000, QLD_N0 + 2500)
    f = QldFakes(tiles=[tile_feature(box(QLD_E0 - 100, QLD_N0 - 100, QLD_E0 + 4000, QLD_N0 + 3000))])
    r = QL.QldLidarProvider(f.query, f.export).fetch(CH.TerrainRequest(big.wkt, SRID, "QLD", buffer_m=20.0))
    p = r.provenance
    assert p.resolution_m == 1.0 and p.effective_spacing_m > 1.5                   # the product is 1 m but the points are far apart
    assert PV.scene_provenance(p)["effective_spacing_m"] == p.effective_spacing_m
    assert any("ground spacing" in n for n in p.notes)


def test_qld_query_error_object_is_raised():
    q = QL.default_query(lambda url, params: (json.dumps({"error": {"code": 499, "message": "Token Required"}}).encode(), None))
    with pytest.raises(RuntimeError):
        q("https://x/query", {})


# ---- tier 3: hosted tile library ----------------------------------------------------------------------------------------------
def make_library(tmp_path: Path, tiles: list[dict], arrays: dict[str, np.ndarray]) -> TL.LocalDirTileStore:
    entries = []
    for t in tiles:
        write_geotiff(tmp_path / t["file"], arrays[t["file"]], tuple(t["bbox"]))
        entries.append(t)
    (tmp_path / "index.json").write_text(json.dumps({"schema": TL.INDEX_SCHEMA, "tiles": entries}))
    return TL.LocalDirTileStore(tmp_path)


def tile_entry(name="SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif", bbox=(E0, N0, E0 + 100, N0 + 100), **kw):
    return {"file": name, "bbox": list(bbox), "crs": SRID, "source_dataset": "SYNTHETIC TEST FIXTURE 1 m DEM", "capture_date": "2019-05-14", "licence": "CC BY 4.0 (SYNTHETIC)",
            "resolution_m": 1.0, "vertical_accuracy": "0.2 m @ 95% CL", **kw}


def test_synthetic_geotiff_reads_back_and_carries_geotags(tmp_path):
    p = tmp_path / "SYNTHETIC_TEST_FIXTURE.tif"
    write_geotiff(p, ramp(100, 100), (E0, N0, E0 + 100, N0 + 100))
    a = read_f32(p.read_bytes())
    assert a.shape == (100, 100) and a[0, 0] == pytest.approx(100.0) and a[99, 99] == pytest.approx(100.0 + 0.99 + 1.98, abs=1e-4)
    with Image.open(p) as im:
        assert im.tag_v2[33550][:2] == (1.0, 1.0) and im.tag_v2[33922][3:5] == (E0, N0 + 100)


def test_tile_library_samples_the_lot_with_provenance(tmp_path):
    store = make_library(tmp_path, [tile_entry()], {"SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif": ramp(100, 100)})
    r = TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=10.0))
    p = r.provenance
    assert p.status == "LIDAR (HOSTED TILE LIBRARY), NOT SURVEY" and p.tier == 3
    assert p.source_name == "Hosted LiDAR tile library: SYNTHETIC TEST FIXTURE 1 m DEM" and p.licence == "CC BY 4.0 (SYNTHETIC)"
    assert p.capture_date == "14/05/2019" and p.accuracy_text == "0.2 m @ 95% CL" and p.accuracy_m == pytest.approx(0.2) and p.resolution_text == "1 m"
    # a cell at known position: cell centre (E0+30.5, N0+30.5) is column 30, row 100-31=69 -> z = 100 + 0.01*30 + 0.02*69
    z = {(x, y): v for x, y, v in r.points}[(E0 + 30.5, N0 + 30.5)]
    assert z == pytest.approx(100 + 0.30 + 1.38, abs=1e-4)
    assert len(r.points) >= 40 * 30 - 5                                           # lot 30 x 20 plus 10 m buffer, 1 m cells
    assert r.survey["stated_vertical_accuracy_m"] == pytest.approx(0.2)


def test_tile_library_no_tile_returns_nothing_with_the_pending_note(tmp_path):
    store = make_library(tmp_path, [tile_entry(bbox=(E0 + 5000, N0 + 5000, E0 + 5100, N0 + 5100))], {"SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif": ramp(100, 100)})
    with pytest.raises(CH.ProviderSkip) as ex:
        TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW"))
    assert ex.value.note == "LIDAR PENDING: ELVIS 1 m TILES TO BE ORDERED AND LOADED; NO HOSTED TILE COVERS THIS LOT"


def test_tile_library_unconfigured_and_missing_index_are_skips_without_the_pending_wording(tmp_path):
    for store in (None, TL.LocalDirTileStore(tmp_path)):
        with pytest.raises(CH.ProviderSkip) as ex:
            TL.TileLibraryProvider(store).fetch(REQ)
        assert "LIDAR PENDING" not in ex.value.note and "tile" in ex.value.note


def test_tile_library_is_a_silent_skip_for_qld_lots(tmp_path):
    store = make_library(tmp_path, [tile_entry(bbox=(E0 + 5000, N0 + 5000, E0 + 5100, N0 + 5100))], {"SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif": ramp(100, 100)})
    for st in (store, None):
        with pytest.raises(CH.ProviderSkip) as ex:
            TL.TileLibraryProvider(st).fetch(CH.TerrainRequest(LOT_WKT, SRID, "QLD"))
        assert ex.value.notable is False and "LIDAR PENDING" not in ex.value.note
    out = CH.resolve_terrain([TL.TileLibraryProvider(store), CH.Nsw5mProvider(export=nsw_export)], CH.TerrainRequest(LOT_WKT, SRID, "QLD"))
    assert out.result is None and not any("LIDAR PENDING: ELVIS" in n for n in out.provenance.notes)


def test_tile_library_partial_coverage_is_not_used(tmp_path):
    arr = ramp(100, 100)
    arr[:, 45:] = -9999.0                                                          # nodata over the east part of the lot
    store = make_library(tmp_path, [tile_entry()], {"SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif": arr})
    with pytest.raises(CH.ProviderSkip) as ex:
        TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW"))
    assert "cover only" in ex.value.note and "LIDAR PENDING" not in ex.value.note


def test_tile_covering_half_the_lot_is_not_accepted_and_the_chain_falls_through_to_the_5m_dem(tmp_path):
    """SYNTHETIC TEST FIXTURE: the tile ends at E0+35, the lot spans E0+20 to E0+50, so the tile covers 15 of 30 m (half the lot) with every cell valid.
    The old code divided by the cells inside the tile only (100 percent) and accepted it."""
    half = tile_entry("SYNTHETIC_HALF.tif", (E0, N0, E0 + 35, N0 + 100))
    store = make_library(tmp_path, [half], {"SYNTHETIC_HALF.tif": ramp(100, 35)})
    with pytest.raises(CH.ProviderSkip) as ex:
        TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0))
    assert "cover only 50%" in ex.value.note
    out = CH.resolve_terrain([TL.TileLibraryProvider(store), CH.Nsw5mProvider(export=nsw_export)], CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0))
    assert out.provenance.tier == 4 and [a["outcome"] for a in out.attempts] == ["SKIPPED", "USED"]


def test_two_tiles_that_together_cover_the_lot_are_accepted_and_coverage_is_summed(tmp_path):
    w = tile_entry("SYNTHETIC_W2.tif", (E0, N0, E0 + 35, N0 + 100))
    e = tile_entry("SYNTHETIC_E2.tif", (E0 + 35, N0, E0 + 100, N0 + 100))
    store = make_library(tmp_path, [w, e], {"SYNTHETIC_W2.tif": ramp(100, 35), "SYNTHETIC_E2.tif": ramp(100, 65)})
    assert TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0)).provenance.tier == 3


def test_overlapping_tiles_give_one_value_per_cell_latest_capture_then_finest_resolution(tmp_path):
    """SYNTHETIC TEST FIXTURE: two tiles cover the same ground with levels 100 and 200 m.  A position never carries both and coverage is not double counted."""
    old = tile_entry("SYNTHETIC_OLD.tif", capture_date="2015-01-01")
    new = tile_entry("SYNTHETIC_NEW.tif", capture_date="2021-06-30")
    store = make_library(tmp_path, [old, new], {"SYNTHETIC_OLD.tif": ramp(100, 100, base=100.0, gx=0, gy=0), "SYNTHETIC_NEW.tif": ramp(100, 100, base=200.0, gx=0, gy=0)})
    r = TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0))
    xy = [(x, y) for x, y, _ in r.points]
    assert len(xy) == len(set(xy)) and {z for _, _, z in r.points} == {200.0}          # latest capture supplies every cell
    assert "SYNTHETIC_NEW.tif" in r.provenance.notes[0] and "SYNTHETIC_OLD.tif" not in r.provenance.notes[0] and r.provenance.capture_date == "30/06/2021"
    # same date: the finest resolution wins
    c1 = tile_entry("SYNTHETIC_COARSE.tif", capture_date="2020-01-01", resolution_m=2.0)
    c2 = tile_entry("SYNTHETIC_FINE.tif", capture_date="2020-01-01", resolution_m=1.0)
    (tmp_path / "b").mkdir()
    store2 = make_library(tmp_path / "b", [c1, c2],
                          {"SYNTHETIC_COARSE.tif": ramp(100, 100, base=100.0, gx=0, gy=0), "SYNTHETIC_FINE.tif": ramp(100, 100, base=200.0, gx=0, gy=0)})
    r2 = TL.TileLibraryProvider(store2).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0))
    assert {z for _, _, z in r2.points} == {200.0}


def test_overlap_does_not_double_count_coverage(tmp_path):
    """Two tiles that each cover half the lot but overlap in a strip: 15 + 15 m of tile over a 30 m lot, with a 5 m overlap, is 25 m, i.e. below the 95 percent threshold."""
    a = tile_entry("SYNTHETIC_A.tif", (E0, N0, E0 + 35, N0 + 100))
    b = tile_entry("SYNTHETIC_B.tif", (E0 + 30, N0, E0 + 45, N0 + 100))
    store = make_library(tmp_path, [a, b], {"SYNTHETIC_A.tif": ramp(100, 35), "SYNTHETIC_B.tif": ramp(100, 15)})
    with pytest.raises(CH.ProviderSkip) as ex:
        TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0))
    assert "cover only 83%" in ex.value.note


def test_tile_library_merges_two_tiles_and_reports_both_dates(tmp_path):
    a, b = ramp(100, 50), ramp(100, 50, base=100.5)
    ents = [tile_entry("SYNTHETIC_W.tif", (E0, N0, E0 + 50, N0 + 100), capture_date="2019-05-14"),
            tile_entry("SYNTHETIC_E.tif", (E0 + 50, N0, E0 + 100, N0 + 100), capture_date="2021-03-02")]
    store = make_library(tmp_path, ents, {"SYNTHETIC_W.tif": a, "SYNTHETIC_E.tif": b})
    p = TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(box(E0 + 40, N0 + 20, E0 + 60, N0 + 40).wkt, SRID, "NSW", buffer_m=5.0)).provenance
    assert p.capture_date == "14/05/2019 TO 02/03/2021" and "SYNTHETIC_W.tif" in p.notes[0] and "SYNTHETIC_E.tif" in p.notes[0]


def test_tile_library_missing_capture_date_is_flagged_not_invented(tmp_path):
    store = make_library(tmp_path, [tile_entry(capture_date=None, vertical_accuracy=None)], {"SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif": ramp(100, 100)})
    r = TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0))
    assert r.provenance.capture_date is None and r.provenance.capture_text == "CAPTURE DATE NOT STATED"
    assert r.provenance.accuracy_text == "NOT STATED" and r.provenance.accuracy_m is None and r.warnings


def test_tile_library_reprojects_a_tile_in_another_zone(tmp_path):
    # the same ground in MGA 55 (7855): the lot is in zone 56, so the provider must transform the lot into the tile CRS
    from pyproj import Transformer
    t = Transformer.from_crs(SRID, 7855, always_xy=True)
    x0, y0 = t.transform(E0 + 20, N0 + 20)
    bb = (round(x0) - 200, round(y0) - 200, round(x0) + 200, round(y0) + 200)
    e = tile_entry("SYNTHETIC_Z55.tif", bb, crs=7855)
    store = make_library(tmp_path, [e], {"SYNTHETIC_Z55.tif": ramp(400, 400, base=50.0)})
    r = TL.TileLibraryProvider(store).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0))
    assert len(r.points) > 400 and all(49.0 < z < 60.0 for _, _, z in r.points)
    assert all(E0 + 10 < x < E0 + 60 for x, _, _ in r.points)                      # returned in the lot CRS


def test_tile_index_validation():
    with pytest.raises(TL.TileIndexError):
        TL.parse_index({"tiles": [{"file": "a.tif", "bbox": [0, 0, 1, 1], "crs": 7856, "source_dataset": "x"}]})        # licence missing
    with pytest.raises(TL.TileIndexError):
        TL.parse_index({"tiles": [tile_entry(bbox=(5, 5, 1, 1))]})
    with pytest.raises(TL.TileIndexError):
        TL.parse_index({"nope": []})
    assert TL.parse_index({"tiles": [tile_entry()]})[0]["crs"] == SRID


def test_local_store_cannot_read_outside_its_directory(tmp_path):
    (tmp_path / "lib").mkdir()
    (tmp_path / "secret.tif").write_bytes(b"x")
    with pytest.raises(TL.TileIndexError):
        TL.LocalDirTileStore(tmp_path / "lib").read_tile("../secret.tif")


def test_store_from_env_is_the_local_directory_only_when_configured(tmp_path):
    assert TL.store_from_env({}) is None
    s = TL.store_from_env({"JCESITE_LIDAR_TILE_DIR": str(tmp_path)})
    assert isinstance(s, TL.LocalDirTileStore) and s.describe() == str(tmp_path)


def test_tile_store_is_a_thin_abstraction_an_in_memory_store_works(tmp_path):
    class MemStore:
        def __init__(self, idx, blobs): self.idx, self.blobs = idx, blobs
        def describe(self): return "memory"
        def read_index(self): return self.idx
        def read_tile(self, name): return self.blobs[name]
    p = tmp_path / "t.tif"
    write_geotiff(p, ramp(100, 100), (E0, N0, E0 + 100, N0 + 100))
    st = MemStore({"tiles": [tile_entry("t.tif")]}, {"t.tif": p.read_bytes()})
    assert TL.TileLibraryProvider(st).fetch(CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0)).provenance.tier == 3


# ---- the chain end to end with the real providers over fakes --------------------------------------------------------------------
def test_full_chain_order_over_fakes(tmp_path):
    store = make_library(tmp_path, [tile_entry()], {"SYNTHETIC_TEST_FIXTURE_E238000_N6569000.tif": ramp(100, 100)})
    chain = lambda survey=None, tiles=store: [CH.SurveyProvider(), QL.QldLidarProvider(lambda u, p: pytest.fail("QLD service called for an NSW lot"), None),  # noqa: E731
                                              TL.TileLibraryProvider(tiles), CH.Nsw5mProvider(export=nsw_export)]
    req = lambda **kw: CH.TerrainRequest(LOT_WKT, SRID, "NSW", buffer_m=5.0, **kw)  # noqa: E731
    assert CH.resolve_terrain(chain(), req(survey=survey_dict())).provenance.tier == 1
    assert CH.resolve_terrain(chain(), req()).provenance.tier == 3                       # NSW lot with a tile library: LiDAR beats the 5 m DEM
    out = CH.resolve_terrain(chain(tiles=None), req())
    assert out.provenance.tier == 4 and out.provenance.status.endswith("LIDAR PENDING, NOT SURVEY")
    assert [a["provider"] for a in out.attempts] == ["User supplied survey", "QLD LiDAR", "Hosted LiDAR tile library", "NSW 5 m DEM"]


def test_raster_sampling_thins_distant_cells_but_keeps_the_dense_zone():
    arr = ramp(400, 400)
    lot = box(E0 + 180, N0 + 180, E0 + 220, N0 + 220)
    s = raster_to_points(arr, (E0, N0, E0 + 400, N0 + 400), SRID, SRID, lot, lot.buffer(150), max_points=6000, max_outer_points=2500)
    assert s.stride_inner == 1 and s.stride_outer > 1 and s.valid_in_lot == s.cells_in_lot == 1600
    assert len(s.points) < 400 * 400
