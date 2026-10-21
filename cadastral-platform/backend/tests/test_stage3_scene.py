"""Stage 3 scene tests: contour interval rule, terrain provenance in the bundle, aerial drape, adjoining lot labels, assumed kerb, banner removal.
Fakes only. Image data here is a SYNTHETIC TEST FIXTURE."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.agents.sa6_site3d import build_scene, dumps  # noqa: E402
from app.agents.sa6_site3d import sample as S  # noqa: E402
from app.agents.sa6_site3d.contours import DEFAULT_INTERVAL, contour_plan  # noqa: E402
from app.agents.sa6_site3d.models import AERIAL_NOTE as MODELS_NOTE  # noqa: E402
from app.agents.sa6_site3d.models import AerialIn, SceneOptions, TerrainProvenanceIn  # noqa: E402
from app.common.contracts import NeighbourLot  # noqa: E402
from app.imagery import aerial as AE  # noqa: E402
from app.imagery.provider import (ImageMeta, ImageResult, NswImageryProvider, QldImageryProvider, warp_to_mga)  # noqa: E402


# ---- contour interval ---------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("res,iv,major", [(0.5, 0.1, 5), (1.0, 0.25, 4), (2.0, 0.5, 2), (5.0, 1.0, 5), (10.0, 2.0, 5)])
def test_contour_interval_follows_data_resolution(res, iv, major):
    p = contour_plan(res, relief_m=3.0)
    assert (p.interval_m, p.major_every) == (iv, major)
    assert "display choice, not a requirement" in p.basis and f"{res:g} m" in p.basis


def test_contour_interval_unknown_resolution_is_the_labelled_default():
    p = contour_plan(None, 3.0)
    assert p.interval_m == DEFAULT_INTERVAL and "not stated" in p.basis and "not a requirement" in p.basis


def test_contour_interval_steps_up_when_too_many_lines():
    p = contour_plan(0.5, relief_m=40.0)                  # 0.1 m over 40 m would be 400 lines
    assert p.interval_m > 0.1 and 40.0 / p.interval_m <= 60 and "Increased to" in p.basis


# ---- terrain provenance in the bundle -----------------------------------------------------------------------------------------
PROV = TerrainProvenanceIn(status="INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY", source="NSW 5 m DEM", url="https://example.invalid/dem", resolution_text="5 m",
                           resolution_m=5.0, accuracy="NOT STATED", notes=["LIDAR PENDING: ELVIS 1 m tiles ordered, not yet loaded"])


def scene(**kw):
    base = S.sample_request()
    return build_scene(base.model_copy(update={"options": SceneOptions(), **kw}))


def existing_only(**kw):
    """The sample request without a design surface: contours are then of the existing ground and carry the terrain status."""
    return scene(design_tin=None, cut_fill=None, **kw)


def test_terrain_status_reaches_summary_notes_terrain_label_and_contour_labels():
    b = existing_only(terrain_provenance=PROV)
    sm = dict(b.summary)
    status = "INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY"            # upper case, but the unit token keeps its case
    assert sm["Terrain status"] == status and sm["Terrain resolution"] == "5 m"
    assert sm["Terrain capture date"] == "CAPTURE DATE NOT STATED" and sm["Terrain vertical accuracy"] == "NOT STATED"
    assert any(n.startswith("TERRAIN: " + status) for n in b.notes)
    texts = [l.t for l in b.labels]
    assert "TERRAIN: " + status in texts and "5 M DEM" not in " ".join(texts + b.notes + [str(v) for _, v in b.summary])
    cl = [l for l in b.labels if l.t.startswith("CONTOUR RL")]
    assert cl and all(l.t.endswith(status) for l in cl)
    assert all(l.c == "lab_cont" for l in cl) and "lab_cont" in {x.c for x in b.layers}
    assert "5 m" in dict(b.summary)["Contours"] and "display choice" in dict(b.summary)["Contours"]
    assert b.info.terrain["status"] == status


def test_unit_tokens_keep_their_case_in_upper_cased_labels():
    from app.common.labels import upper_label
    assert upper_label("indicative 5 m dem, lidar pending") == "INDICATIVE 5 m DEM, LIDAR PENDING"
    assert upper_label("0.3 m accuracy, 12 ha, 30 m2, 2 km") == "0.3 m ACCURACY, 12 ha, 30 m2, 2 km"
    assert upper_label("lidar (qld state service)") == "LIDAR (QLD STATE SERVICE)"          # words that merely contain m are upper cased
    assert upper_label("") == "" and upper_label(None) == ""


def test_design_contours_are_labelled_design_surface_contour_not_the_terrain_status():
    b = scene(terrain_provenance=PROV)                                       # the sample has a design surface
    cl = [l for l in b.labels if l.t.startswith("CONTOUR RL")]
    assert cl and all(l.t.endswith("DESIGN SURFACE CONTOUR") for l in cl)
    assert not any("INDICATIVE 5" in l.t for l in cl)
    assert "DESIGN SURFACE" in dict(b.summary)["Contours"]


def test_contour_interval_in_bundle_comes_from_resolution_when_not_set():
    b = existing_only(terrain_provenance=PROV)
    assert "Contour interval 1 m" in dict(b.summary)["Contours"]          # 5 m DEM -> 1 m
    b2 = existing_only(terrain_provenance=PROV.model_copy(update={"resolution_m": 1.0}))
    assert "Contour interval 0.25 m" in dict(b2.summary)["Contours"]


def test_contour_interval_follows_the_effective_spacing_actually_sampled():
    """A 1 m product sampled at 8 m spacing (coarsening or stride) must not draw 0.25 m contours."""
    coarse = PROV.model_copy(update={"resolution_m": 1.0, "effective_spacing_m": 8.0})
    c = dict(existing_only(terrain_provenance=coarse).summary)["Contours"]
    assert "Contour interval 2 m" in c and "8 m effective point spacing as sampled" in c
    fine = PROV.model_copy(update={"resolution_m": 1.0, "effective_spacing_m": 1.0})
    assert "Contour interval 0.25 m" in dict(existing_only(terrain_provenance=fine).summary)["Contours"]
    # the effective spacing is never taken as finer than the nominal product resolution
    odd = PROV.model_copy(update={"resolution_m": 5.0, "effective_spacing_m": 2.0})
    assert "Contour interval 1 m" in dict(existing_only(terrain_provenance=odd).summary)["Contours"]


def test_data_status_is_in_the_summary_and_the_notes_and_the_bundle_info():
    st = "OFFLINE FIXTURE (app/offline/lot2.py), NOT LIVE DATA"
    b = scene(data_status=st)
    assert dict(b.summary)["Data status"] == st and b.summary[0][0] == "Data status"
    assert any(st in n for n in b.notes) and b.info.data_status == st
    assert "Data status" not in dict(scene().summary) and not any("DATA STATUS" in n for n in scene().notes)


def test_no_provenance_says_source_not_stated():
    b = scene()
    assert any(l.t == "TERRAIN: TERRAIN SOURCE NOT STATED" for l in b.labels)


# ---- adjoining lots, road, assumed kerb (cadastre data only) ------------------------------------------------------------------
def neighbours():
    e, n = S.E0, S.N0
    return [NeighbourLot(label="lot 2 dp 123456", wkt=box(e + S.W, n, e + S.W + 20, n + S.D).wkt),
            NeighbourLot(label="", wkt=box(e - 20, n, e, n + S.D).wkt),
            NeighbourLot(label="ROAD", wkt=box(e - 10, n - 12, e + S.W + 10, n - 2).wkt, is_road=True)]


def test_adjoining_lots_are_labelled_from_the_cadastre_never_invented():
    base = S.sample_request()
    b = build_scene(base.model_copy(update={"lot": base.lot.model_copy(update={"neighbours": neighbours()})}))
    texts = [l.t for l in b.labels if l.c == "lab_lots"]
    assert "LOT 2 DP 123456" in texts and "LOT AND PLAN NOT AVAILABLE" in texts and "ROAD RESERVE: ROAD" in texts
    assert {p.c for p in b.parts if p.n.startswith("Adjoining")} == {"adjoining"}
    assert len({p.n for p in b.parts if p.n.startswith("Adjoining_") and not p.n.startswith("Adjoining_fill")}) == 3
    assert dict(b.summary)["Adjoining lots"].startswith("3 from the cadastre")
    none = build_scene(base)
    assert not any(p.c == "adjoining" for p in none.parts)


def test_assumed_kerb_is_labelled_platform_default_not_surveyed():
    b = scene()
    ks = [l.t for l in b.labels if l.t.startswith("ASSUMED KERB LINE")]
    assert ks and "PLATFORM DEFAULT, NOT SURVEYED" in ks[0]
    assert {"Kerb_assumed", "Kerb_line_assumed", "Road_carriageway"} <= {p.n for p in b.parts if p.c == "road"}
    assert "ASSUMED KERB LINE (PLATFORM DEFAULT, NOT SURVEYED)" in dict(b.summary)["Road and kerb"]


# ---- aerial drape --------------------------------------------------------------------------------------------------------------
def jpeg_uri(w=64, h=48):
    b = io.BytesIO()
    Image.new("RGB", (w, h), (90, 120, 60)).save(b, "JPEG")             # SYNTHETIC TEST FIXTURE
    return "data:image/jpeg;base64," + __import__("base64").b64encode(b.getvalue()).decode()


EXT = (S.E0 - 10, S.N0 - 10, S.E0 + S.W + 10, S.N0 + S.D + 10)


def aerial(**kw):
    d = dict(path=jpeg_uri(), extent=EXT, attribution="SYNTHETIC ATTRIBUTION", source="SYNTHETIC SOURCE", licence="SYNTHETIC LICENCE", resolution_m=0.1, capture_date="18/10/2011")
    d.update(kw)
    return AerialIn(**d)


def test_aerial_drape_part_uv_and_info():
    b = scene(aerial=aerial())
    p = next(p for p in b.parts if p.n == "AERIAL_drape")
    assert p.c == "aerial" and any(l.c == "aerial" and l.on for l in b.layers)            # on by default
    assert len(p.uv) == len(p.v) // 3 * 2 and min(p.uv) >= -1e-6 and max(p.uv) <= 1 + 1e-6
    z = np.array(p.v).reshape(-1, 3)[:, 2]
    assert 99.0 < z.min() and z.max() < 104.0                                          # follows the sample slope, not a flat quad
    i = b.info
    assert i.ground_texture.startswith("data:image/jpeg;base64,") and tuple(i.ground_texture_extent) == pytest.approx(EXT)         # georeference stays in the scene CRS
    assert i.ground_texture_date == "18/10/2011" and i.ground_texture_source == "SYNTHETIC SOURCE" and i.ground_texture_licence == "SYNTHETIC LICENCE"
    assert i.ground_texture_note == AERIAL_NOTE_TEXT
    assert any(AERIAL_NOTE_TEXT in n for n in b.notes) and "Aerial imagery" in dict(b.summary)


AERIAL_NOTE_TEXT = "AERIAL IMAGERY FOR INFORMATION ONLY, TO BE CONFIRMED ON SITE"


def test_aerial_uv_maps_north_to_v_1_and_east_to_u_1():
    """Image row 0 is north: the northern edge of the extent must carry v = 1 (three.js flips Y on upload, so v = 1 is the top row) and the southern edge v = 0."""
    b = scene(aerial=aerial(), existing_tin=None, design_tin=None, cut_fill=None)         # a flat quad on the image extent
    p = next(p for p in b.parts if p.n == "AERIAL_drape")
    v = np.array(p.v).reshape(-1, 3)
    uv = np.array(p.uv).reshape(-1, 2)
    y_local = v[:, 1]
    north, south = y_local == y_local.max(), y_local == y_local.min()
    assert north.any() and south.any()
    assert np.allclose(uv[north, 1], 1.0, atol=1e-4) and np.allclose(uv[south, 1], 0.0, atol=1e-4)
    x_local = v[:, 0]
    assert np.allclose(uv[x_local == x_local.max(), 0], 1.0, atol=1e-4) and np.allclose(uv[x_local == x_local.min(), 0], 0.0, atol=1e-4)
    # on a draped TIN the mapping is the same linear function of the position
    d = scene(aerial=aerial())
    q = next(p for p in d.parts if p.n == "AERIAL_drape")
    vq, uq = np.array(q.v).reshape(-1, 3), np.array(q.uv).reshape(-1, 2)
    ex0, ey0, ex1, ey1 = EXT[0] - S.E0, EXT[1] - S.N0, EXT[2] - S.E0, EXT[3] - S.N0
    assert np.allclose(uq[:, 1], (vq[:, 1] - ey0) / (ey1 - ey0), atol=1e-4) and np.allclose(uq[:, 0], (vq[:, 0] - ex0) / (ex1 - ex0), atol=1e-4)
    assert uq[vq[:, 1].argmax(), 1] > uq[vq[:, 1].argmin(), 1]                           # the more northern vertex has the larger v


def noisy_image(w, h):
    rng = np.random.default_rng(1)                                                  # SYNTHETIC TEST FIXTURE: noise does not compress
    b = io.BytesIO()
    Image.fromarray(rng.integers(0, 255, (h, w, 3), dtype=np.uint8)).save(b, "JPEG", quality=90)
    return b.getvalue()


def jpeg_bytes_small():
    b = io.BytesIO(); Image.new("RGB", (64, 48), (90, 120, 60)).save(b, "JPEG"); return b.getvalue()


def test_embedded_aerial_is_capped_at_about_1_5_mb_with_final_size_and_resolution_recorded():
    raw = noisy_image(2400, 2400)
    assert len(raw) > 1_500_000
    img = AE.AerialImage(jpeg=raw, extent=(0.0, 0.0, 240.0, 240.0), srid=7856, size_px=(2400, 2400), source="SYNTHETIC", licence="L", attribution="A",
                         capture_date=None, resolution_m=0.1)
    sc = img.to_scene()
    jpg = __import__("base64").b64decode(sc["path"].split(",", 1)[1])
    assert len(jpg) <= AE.MAX_EMBED_BYTES <= 1_500_000
    w, h = Image.open(io.BytesIO(jpg)).size
    assert sc["size_px"] == (w, h) and (w, h) != (2400, 2400)
    assert sc["resolution_m"] == pytest.approx(240.0 / w) and sc["resolution_m"] > 0.1       # a smaller image has coarser ground pixels
    AerialIn(**sc)
    assert img.jpeg == raw                                                             # the original is not modified
    # a small image passes through unchanged
    small = AE.AerialImage(jpeg=jpeg_bytes_small(), extent=(0.0, 0.0, 6.4, 4.8), srid=7856, size_px=(64, 48), source="S", licence="L", attribution="A", capture_date=None, resolution_m=0.1)
    assert small.to_scene()["size_px"] == (64, 48) and small.to_scene()["resolution_m"] == pytest.approx(0.1)


def test_aerial_summary_records_the_embedded_pixel_size():
    b = scene(aerial=aerial(size_px=(640, 480)))
    assert "embedded image: 640 x 480 px" in dict(b.summary)["Aerial imagery"]


def test_aerial_note_is_one_string_everywhere():
    assert MODELS_NOTE == AE.AERIAL_NOTE == AERIAL_NOTE_TEXT


def test_aerial_without_capture_date_says_so():
    b = scene(aerial=aerial(capture_date=None))
    assert "CAPTURE DATE NOT STATED" in dict(b.summary)["Aerial imagery"]
    assert b.info.ground_texture_date is None


def test_aerial_off_extent_is_not_draped_and_says_so():
    far = (S.E0 + 5000, S.N0 + 5000, S.E0 + 5100, S.N0 + 5100)
    b = scene(aerial=aerial(extent=far))
    assert not any(p.c == "aerial" for p in b.parts) and any("does not overlap" in n for n in b.notes)


def test_no_aerial_means_no_layer_part():
    b = scene()
    assert not any(p.c == "aerial" for p in b.parts) and b.info.ground_texture is None


# ---- banner removal ------------------------------------------------------------------------------------------------------------
def test_banner_text_is_nowhere_in_the_bundle_json():
    b = scene(terrain_provenance=PROV, aerial=aerial())
    s = dumps(b)
    d = json.loads(s)
    assert "statement" not in d["info"] or d["info"]["statement"] is None
    assert "AI GENERATED DRAFT" not in s.upper() and d["info"]["status"] == "unverified"


def test_info_statement_is_optional_and_not_forced():
    from app.agents.sa6_site3d.models import Info
    assert Info.model_fields["statement"].default is None
    assert Info(title="X", origin=(0, 0, 0), srid=7856).statement is None


# ---- aerial providers: georeference and capture date ----------------------------------------------------------------------------
class FakeResp:
    def __init__(self, data=b"", ctype="image/jpeg", js=None, status=200):
        self.content, self.headers, self.status_code, self._js = data, {"content-type": ctype}, status, js
        self.text = json.dumps(js) if js is not None else ""

    def json(self):
        return self._js


class FakeSession:
    def __init__(self, handler):
        self.handler, self.calls = handler, []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        return self.handler(url, params or {})


def jpg_bytes(w, h, col=(10, 200, 30)):
    b = io.BytesIO(); Image.new("RGB", (w, h), col).save(b, "JPEG"); return b.getvalue()


def img_for(params):
    w, h = (int(v) for v in params["size"].split(","))
    return FakeResp(jpg_bytes(w, h))


BOX = (E := 334480.0, N := 6263880.0, E + 60, N + 60)


def test_nsw_provider_georeference_is_the_request_bbox_and_capture_date_is_from_dates_service(tmp_path):
    def h(url, p):
        if url.endswith("/NSW_Imagery/MapServer/export"):
            return img_for(p)
        if "NSW_Imagery_Dates" in url:
            return FakeResp(js={"features": [{"attributes": {"BlockStartDate": 1318896000000}}]}, ctype="application/json")   # 18/10/2011 UTC
        raise AssertionError(url)
    sess = FakeSession(h)
    out = AE.fetch_aerial([("NSW", NswImageryProvider(session=sess, cache_dir=tmp_path, retries=1))], "POLYGON((334500 6263900,334520 6263900,334520 6263920,334500 6263920,334500 6263900))",
                          7856, "NSW", margin_m=20.0, target_res_m=0.2)
    im = out.image
    assert im is not None and im.extent == pytest.approx((334480.0, 6263880.0, 334540.0, 6263940.0)) and im.srid == 7856
    assert im.size_px == (300, 300) and im.resolution_m == pytest.approx(0.2)
    assert im.capture_date == "18/10/2011" and im.capture_label == "18/10/2011"
    assert im.data_uri.startswith("data:image/jpeg;base64,") and Image.open(io.BytesIO(im.jpeg)).size == (300, 300)
    exp = next(p for u, p in sess.calls if u.endswith("/export"))
    assert exp["bboxSR"] == 7856 and exp["imageSR"] == 7856 and exp["size"] == "300,300" and exp["format"] == "jpg"
    sc = im.to_scene()
    AerialIn(**sc)                                                       # validates against the scene model
    assert out.attempts == [{"provider": "nsw_imagery", "outcome": "USED", "note": "300 x 300 px"}]


def ident(items):
    return lambda url, p: FakeResp(js={"objectId": items[0]["objectid"], "catalogItems": {"features": [{"attributes": i} for i in items]}}, ctype="application/json")


def test_qld_provider_reports_the_capture_interval_and_does_not_lock_the_mosaic(tmp_path):
    item = {"objectid": 7, "capturestart": 1560211200000, "captureend": 1565913600000}

    def h(url, p):
        if url.endswith("/identify"):
            return ident([item, {"objectid": 3, "capturestart": 1000000000000, "captureend": 1000000000000}])(url, p)
        if url.endswith("/exportImage"):
            return img_for(p)
        raise AssertionError(url)
    sess = FakeSession(h)
    prov = QldImageryProvider(session=sess, cache_dir=tmp_path, retries=1)
    r = prov.fetch((502000.0, 6961000.0, 502060.0, 6961060.0), 7856, (120, 120))
    assert r.meta.capture_date == "2019-06-11/2019-08-16" and r.meta.bbox == (502000.0, 6961000.0, 502060.0, 6961060.0)
    exp = next(p for u, p in sess.calls if u.endswith("/exportImage"))
    assert "mosaicRule" not in exp                                                    # never locked to one image
    idents = [json.loads(p["geometry"]) for u, p in sess.calls if u.endswith("/identify")]
    assert len(idents) == 5 and all(12_500_000 < g["x"] < 17_500_000 for g in idents)   # centre plus four corners, Web Mercator metres
    assert len({(g["x"], g["y"]) for g in idents}) == 5
    assert AE.capture_text(r.meta.capture_date) == "11/06/2019 TO 16/08/2019"


def test_qld_provider_with_several_images_in_the_bbox_reports_the_interval_that_covers_them(tmp_path):
    a = {"objectid": 1, "capturestart": 1560211200000, "captureend": 1560211200000}      # 11/06/2019
    b = {"objectid": 2, "capturestart": 1717200000000, "captureend": 1717200000000}      # 01/06/2024
    n = {"i": 0}

    def h(url, p):
        if url.endswith("/identify"):
            n["i"] += 1
            return ident([a if n["i"] % 2 else b])(url, p)
        return img_for(p)
    sess = FakeSession(h)
    r = QldImageryProvider(session=sess, cache_dir=tmp_path, retries=1).fetch((502000.0, 6961000.0, 502060.0, 6961060.0), 7856, (60, 60))
    assert r.meta.capture_date == "2019-06-11/2024-06-01"
    assert not any("mosaicRule" in p for u, p in sess.calls if u.endswith("/exportImage"))


def test_qld_capture_date_never_raises(tmp_path):
    """A malformed catalog value used to raise out of capture_date and fail the whole fetch; it must read CAPTURE DATE NOT STATED."""
    def h(url, p):
        return ident([{"objectid": 1, "capturestart": "not-a-number", "captureend": None}])(url, p) if url.endswith("/identify") else img_for(p)
    r = QldImageryProvider(session=FakeSession(h), cache_dir=tmp_path, retries=1).fetch((502000.0, 6961000.0, 502060.0, 6961060.0), 7856, (60, 60))
    assert r.meta.capture_date is None
    prov = QldImageryProvider(session=FakeSession(h), cache_dir=tmp_path, retries=1)
    prov._items = [{"capturestart": object()}]
    assert prov.capture_date((0, 0, 1, 1), 7856) is None
    prov._items = [{"capturestart": 1560211200000}, {"objectid": 9}]                  # one item without dates: no date is claimed
    assert prov.capture_date((0, 0, 1, 1), 7856) is None


def test_qld_provider_without_identify_result_reports_capture_date_not_stated(tmp_path):
    def h(url, p):
        return FakeResp(js={}, ctype="application/json") if url.endswith("/identify") else img_for(p)
    prov = QldImageryProvider(session=FakeSession(h), cache_dir=tmp_path, retries=1)
    r = prov.fetch((502000.0, 6961000.0, 502060.0, 6961060.0), 7856, (60, 60))
    assert r.meta.capture_date is None


class Stub:
    def __init__(self, name, res=None, exc=None):
        self.name, self.res, self.exc, self.calls = name, res, exc, 0
        self.licence = None

    def fetch(self, bbox, srid, size, dpi=96):
        self.calls += 1
        if self.exc:
            raise self.exc
        return self.res


def stub_result(date=None):
    b = io.BytesIO(); Image.new("RGB", (30, 30)).save(b, "PNG")
    return ImageResult(b.getvalue(), ImageMeta(source="stub", srid=7856, bbox=(0, 0, 3, 3), size_px=(30, 30), capture_date=date, licence="L", attribution="A"))


WKT = "POLYGON((0 0,10 0,10 10,0 10,0 0))"


def test_aerial_chain_state_gating_and_fall_through():
    nsw, qld = Stub("nsw", stub_result("2011-10-18")), Stub("qld", stub_result())
    out = AE.fetch_aerial([("NSW", nsw), ("QLD", qld)], WKT, 7856, "QLD")
    assert out.image.source == "stub" and nsw.calls == 0 and qld.calls == 1
    assert out.attempts[0] == {"provider": "nsw", "outcome": "SKIPPED", "note": "covers NSW only"} and out.attempts[1]["outcome"] == "USED"
    assert out.image.capture_date is None and out.image.capture_label == "CAPTURE DATE NOT STATED"
    bad = Stub("nsw", exc=RuntimeError("HTTP 503"))
    out2 = AE.fetch_aerial([(None, bad), (None, Stub("any", stub_result("2011-10-18")))], WKT, 7856, "NSW")
    assert out2.image.capture_date == "18/10/2011" and out2.attempts[0]["outcome"] == "ERROR" and "HTTP 503" in out2.attempts[0]["note"]
    none = AE.fetch_aerial([("NSW", bad)], WKT, 7856, "NSW")
    assert none.image is None and none.attempts[0]["outcome"] == "ERROR"


def test_capture_text_and_pixel_size():
    assert AE.capture_text("2019-06-11") == "11/06/2019" and AE.capture_text("2019-06-11/2019-08-16") == "11/06/2019 TO 16/08/2019"
    assert AE.capture_text(None) is None and AE.capture_text("garbage") is None
    assert AE.pixel_size((0, 0, 1000, 500), 0.1, 4096) == (4096, 2048)
    assert AE.pixel_size((0, 0, 10, 5), 0.1) == (100, 50)


def test_warp_to_mga_places_a_marker_in_the_right_spot():
    from pyproj import Transformer
    bbox = (334480.0, 6263880.0, 334540.0, 6263940.0)
    t = Transformer.from_crs(7856, 3857, always_xy=True)
    x0, y0 = t.transform(bbox[0] - 30, bbox[1] - 30)
    x1, y1 = t.transform(bbox[2] + 30, bbox[3] + 30)
    src = Image.new("RGB", (400, 400), (0, 0, 0))
    mx, my = t.transform(bbox[0] + 15, bbox[1] + 45)                            # NW quarter of the target
    px, py = int((mx - x0) / (x1 - x0) * 400), int((y1 - my) / (y1 - y0) * 400)
    for dx in range(-6, 7):
        for dy in range(-6, 7):
            src.putpixel((px + dx, py + dy), (255, 0, 0))
    out = np.asarray(warp_to_mga(src, (x0, y0, x1, y1), 3857, bbox, 7856, (60, 60)))
    ys, xs = np.nonzero(out[..., 0] > 200)
    assert len(xs) > 0 and abs(xs.mean() - 15) < 3 and abs(ys.mean() - 15) < 3          # 15 m east, 45 m north of the SW corner = 15 px from the left and 15 px from the top
