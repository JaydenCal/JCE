"""Imagery package tests: offline (fake provider, mocked HTTP); live test only with LIVE=1."""
from __future__ import annotations

import hashlib
import io
import os
import sys
from pathlib import Path

import ezdxf
import pymupdf
import pytest
from PIL import Image
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).parent))
from app.imagery.figure import OverlaySpec, render_figure  # noqa: E402
from app.imagery.licence import NSW_LICENCE  # noqa: E402
from app.imagery.provider import ImageMeta, ImageResult, NswImageryProvider, tile_grid  # noqa: E402


def synth(size, colour=(40, 120, 60)) -> bytes:
    b = io.BytesIO(); Image.new("RGB", size, colour).save(b, "PNG"); return b.getvalue()


class FakeProvider:
    name = "fake"; licence = None

    def __init__(self):
        self.calls = 0

    def fetch(self, bbox, srid, size_px, dpi=96):
        self.calls += 1
        d = synth(size_px)
        return ImageResult(d, ImageMeta("fake", srid, bbox, size_px, "2022-02-16", "Test only.", "Synthetic imagery",
                                        (bbox[2] - bbox[0]) / size_px[0], [], hashlib.sha256(d).hexdigest()))


class FakeResp:
    def __init__(self, content=b"", status=200, ctype="image/jpeg", js=None):
        self.content, self.status_code, self.headers, self._js, self.text = content, status, {"content-type": ctype}, js, ""

    def json(self):
        return self._js


class FakeHttp:
    def __init__(self, fail_mga=False):
        self.urls, self.fail_mga = [], fail_mga

    def get(self, url, params=None, timeout=None):
        self.urls.append((url, dict(params or {})))
        if "NSW_Imagery_Dates" in url:
            return FakeResp(ctype="application/json", js={"features": [{"attributes": {"BlockStartDate": 1644969600000}}]})
        w, h = map(int, params["size"].split(","))
        if self.fail_mga and params["bboxSR"] != 4326:
            return FakeResp(status=400)
        b = io.BytesIO(); Image.new("RGB", (w, h), (90, 90, 90)).save(b, "JPEG")
        return FakeResp(b.getvalue())


LOT = box(334000, 6263000, 334020, 6263040)


def test_nsw_tiles_cache_and_date(tmp_path):
    http = FakeHttp()
    p = NswImageryProvider(cache_dir=tmp_path, session=http, max_tile_px=512, retries=1)
    r = p.fetch((334000, 6263000, 334200, 6263200), 7856, (1000, 600))
    imgs = [u for u in http.urls if "export" in u[0]]
    assert len(imgs) == 4 and all(u[1]["imageSR"] == 7856 for u in imgs)
    assert Image.open(io.BytesIO(r.data)).size == (1000, 600)
    assert r.meta.capture_date == "2022-02-16" and r.meta.sha256 and not r.meta.warped
    n = len(http.urls)
    r2 = p.fetch((334000, 6263000, 334200, 6263200), 7856, (1000, 600))
    assert r2.meta.cached and len(http.urls) == n and r2.data == r.data


def test_nsw_warp_fallback(tmp_path):
    http = FakeHttp(fail_mga=True)
    p = NswImageryProvider(cache_dir=tmp_path, session=http, retries=1)
    r = p.fetch((334000, 6263000, 334100, 6263100), 7856, (200, 200))
    assert r.meta.warped and Image.open(io.BytesIO(r.data)).size == (200, 200)
    assert any(u[1]["bboxSR"] == 4326 for u in http.urls)


def test_tile_grid_and_licence():
    assert len(list(tile_grid((5000, 2048), 2048))) == 3
    assert "Department of Customer Service" in NSW_LICENCE.copyright_text and "verify terms" in NSW_LICENCE.licence_note


def test_figure_pdf(tmp_path):
    fig = render_figure(LOT, [OverlaySpec(box(334010, 6263020, 334040, 6263060), label="Flood")], FakeProvider(),
                        number=3, caption="Flood overlay")
    assert fig.meta.capture_date == "2022-02-16" and fig.image
    from reportlab.platypus import SimpleDocTemplate
    out = tmp_path / "f.pdf"
    SimpleDocTemplate(str(out)).build([fig.as_flowable()])
    t = pymupdf.open(out)[0].get_text()
    assert "Figure 3. Flood overlay" in t and "2022-02-16" in t and "Flood" in t


def test_figure_without_imagery():
    fig = render_figure(LOT, [], None)
    assert fig.image is None and "No aerial" in fig.source_line


def test_sa5_underlay(tmp_path):
    from tests.test_sa5_cad import make_request
    from app.agents.sa5_cad_dxf import Sa5CadDxf
    img = tmp_path / "bm.png"; img.write_bytes(synth((64, 64)))
    req = make_request(tmp_path)
    req = req.model_copy(update=dict(basemap_image_path=str(img), basemap_extent=(333950, 6262950, 334100, 6263100),
                                     basemap_note="Fake 2022-02-16"))
    res = Sa5CadDxf().run(req)
    res = getattr(res, "output", res)
    assert any(e.dxftype() == "IMAGE" for e in ezdxf.readfile(res.dxf_path).modelspace())
    assert "Aerial underlay" in pymupdf.open(res.pdf_path)[0].get_text()


@pytest.mark.skipif(os.environ.get("LIVE") != "1", reason="LIVE=1 required")
def test_live_nsw(tmp_path):
    r = NswImageryProvider(cache_dir=tmp_path).fetch((334000, 6263000, 334200, 6263200), 7856, (400, 400))
    assert Image.open(io.BytesIO(r.data)).size == (400, 400) and r.meta.capture_date
