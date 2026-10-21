"""LGA lookup (stage 2B). No network: a fake client is injected. Polygons below are SYNTHETIC TEST FIXTURES, not real LGA boundaries."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.requirements.lgacode import lga_slug, normalise_lga_code, same_lga  # noqa: E402
from app.jurisdiction import lga as G  # noqa: E402

GUNNEDAH_PT = (150.2700, -30.9800)           # a point only; the polygons below are synthetic


class FakeClient:
    """Stands in for the ArcGIS client. ``replies`` maps a URL fragment to a JSON dict or an Exception."""

    def __init__(self, replies: dict):
        self.replies, self.calls = replies, []

    def get_json(self, url: str, params: dict) -> dict:
        self.calls.append((url, params))
        for frag, rep in self.replies.items():
            if frag in url:
                if isinstance(rep, Exception):
                    raise rep
                return rep
        raise G.LgaServiceError(f"{url}: no route in FakeClient")


ENV = {"JCESITE_LGA_URL_NSW": "http://fake/nsw_lga/0", "JCESITE_LGA_URL_QLD": "http://fake/qld_lga/0"}


def feats(**attrs):
    return {"features": [{"attributes": attrs}]}


# ---------------------------------------------------------------- normalisation
@pytest.mark.parametrize("name,slug", [
    ("GUNNEDAH", "gunnedah"), ("Gunnedah Shire Council", "gunnedah"), ("Gunnedah Shire", "gunnedah"),
    ("Mid-Western Regional Council", "mid-western"), ("MID-WESTERN REGIONAL", "mid-western"),
    ("Cairns Regional Council", "cairns"), ("City of Newcastle", "newcastle"), ("Newcastle City Council", "newcastle"),
    ("Hornsby Council", "hornsby"), ("Moreton Bay Regional", "moreton-bay"), ("Cairns (R)", "cairns"),
    ("Port Macquarie-Hastings Council", "port-macquarie-hastings"), ("Tweed Shire Council", "tweed"),
    ("Council", "council"), ("", ""), (None, "")])
def test_slug(name, slug):
    assert lga_slug(name) == slug


def test_code_and_same_lga():
    assert normalise_lga_code("NSW", "Gunnedah Shire Council") == "nsw-gunnedah"
    assert normalise_lga_code("qld", "Cairns Regional Council") == "qld-cairns"
    assert normalise_lga_code("NSW", "nsw-gunnedah") == "nsw-gunnedah"          # a code stays a code
    assert normalise_lga_code(None, "Gunnedah") is None and normalise_lga_code("VIC", "Yarra") is None
    assert normalise_lga_code("NSW", "") is None
    assert same_lga("GUNNEDAH", "nsw-gunnedah") and same_lga("Gunnedah Shire Council", "Gunnedah")
    assert not same_lga("Gunnedah", "Narrabri") and not same_lga("", "")


# ---------------------------------------------------------------- live point query
def test_arcgis_nsw_query_shape_and_result():
    c = FakeClient({"nsw_lga": feats(lganame="GUNNEDAH", other="x")})
    r = G.lookup_lga(*GUNNEDAH_PT, client=c, env=ENV, offline_paths=[])
    assert (r.state, r.lga_name, r.lga_code, r.method) == ("NSW", "GUNNEDAH", "nsw-gunnedah", "arcgis_point_query")
    assert (r.boundary_tested, r.source_verified, r.verified, r.ambiguous) == (True, False, False, False)      # tested, but the layer is an unverified default
    assert "boundary tested, source not yet verified" in r.summary() and "NOT verified by a boundary test" not in r.summary()
    assert r.source == "http://fake/nsw_lga/0"
    url, p = c.calls[0]
    assert url == "http://fake/nsw_lga/0/query"
    assert p["geometryType"] == "esriGeometryPoint" and p["inSR"] == 4326 and p["spatialRel"] == "esriSpatialRelIntersects"
    assert p["outFields"] == "*" and p["returnGeometry"] == "false"
    assert json.loads(p["geometry"]) == {"x": GUNNEDAH_PT[0], "y": GUNNEDAH_PT[1], "spatialReference": {"wkid": 4326}}


def test_arcgis_qld_after_nsw_empty():
    c = FakeClient({"nsw_lga": {"features": []}, "qld_lga": feats(LGA="Cairns Regional")})
    r = G.lookup_lga(145.77, -16.92, client=c, env=ENV, offline_paths=[])
    assert (r.state, r.lga_code, r.method) == ("QLD", "qld-cairns", "arcgis_point_query")
    assert [u for u, _ in c.calls] == ["http://fake/nsw_lga/0/query", "http://fake/qld_lga/0/query"]


def test_source_verified_only_when_the_layer_is_recorded_verified(monkeypatch):
    monkeypatch.setitem(G.LGA_LAYER_DEFAULTS, "NSW", G.LgaLayer("NSW", "http://fake/nsw_lga/0", ("lganame",), "JCESITE_LGA_URL_NSW", verified=True))
    r = G.lookup_lga(*GUNNEDAH_PT, client=FakeClient({"nsw_lga": feats(lganame="GUNNEDAH")}), env={"JCESITE_LGA_URL_QLD": ""}, offline_paths=[])
    assert (r.boundary_tested, r.source_verified, r.verified) == (True, True, True) and "boundary tested, source verified" in r.summary()
    # an environment override is never verified, even over a verified default
    r2 = G.lookup_lga(*GUNNEDAH_PT, client=FakeClient({"nsw_lga": feats(lganame="GUNNEDAH")}), env=ENV, offline_paths=[])
    assert (r2.boundary_tested, r2.source_verified, r2.verified) == (True, False, False)
    assert G.configured_layers({"JCESITE_LGA_URL_NSW": "http://x/y/3"})["NSW"].verified is False


def test_point_in_several_lgas_is_flagged_ambiguous():
    c = FakeClient({"nsw_lga": {"features": [{"attributes": {"lganame": "GUNNEDAH"}}, {"attributes": {"lganame": "NARRABRI"}}]}})
    r = G.lookup_lga(*GUNNEDAH_PT, client=c, env=ENV, offline_paths=[])
    assert r.lga_name == "GUNNEDAH" and r.boundary_tested and r.ambiguous
    assert any(n.startswith("AMBIGUOUS: point intersects several LGAs: GUNNEDAH, NARRABRI") for n in r.notes)
    assert "AMBIGUOUS" in r.summary()
    same = FakeClient({"nsw_lga": {"features": [{"attributes": {"lganame": "GUNNEDAH"}}, {"attributes": {"lganame": "Gunnedah Shire Council"}}]}})
    assert not G.lookup_lga(*GUNNEDAH_PT, client=same, env=ENV, offline_paths=[]).ambiguous       # one LGA twice is not ambiguous


def test_state_hint_orders_the_query():
    c = FakeClient({"nsw_lga": feats(lganame="X"), "qld_lga": feats(lga="Cairns Regional")})
    r = G.lookup_lga(145.77, -16.92, client=c, env=ENV, offline_paths=[], state_hint="QLD")
    assert r.state == "QLD" and len(c.calls) == 1


def test_service_failure_falls_through_with_note():
    c = FakeClient({"nsw_lga": G.LgaServiceError("down"), "qld_lga": {"features": []}})
    r = G.lookup_lga(*GUNNEDAH_PT, client=c, env=ENV, offline_paths=[], lot_lga_name="GUNNEDAH", state_hint="NSW")
    assert r.method == "lot_attribute" and r.verified is False and r.boundary_tested is False and r.lga_code == "nsw-gunnedah"
    assert "NOT verified by a boundary test" in r.summary()
    assert any("NSW LGA service failed" in n for n in r.notes)


def test_env_override_empty_disables_live_query():
    c = FakeClient({})
    r = G.lookup_lga(*GUNNEDAH_PT, client=c, env={"JCESITE_LGA_URL_NSW": "", "JCESITE_LGA_URL_QLD": ""}, offline_paths=[])
    assert c.calls == [] and r.method == "not_found"


def test_defaults_are_unverified_and_overridable():
    d = G.configured_layers({})
    assert d["NSW"].url and d["QLD"].url and not d["NSW"].verified and not d["QLD"].verified
    o = G.configured_layers({"JCESITE_LGA_URL_NSW": "http://x/y/3"})
    assert o["NSW"].url == "http://x/y/3" and o["QLD"].url == d["QLD"].url


def test_injected_fetcher_and_error_mapping():
    seen = {}

    def fetcher(url, params):
        seen["url"], seen["params"] = url, params
        return json.dumps(feats(lganame="HORNSBY")).encode(), None
    r = G.lookup_lga(151.1, -33.7, client=G.PointQueryClient(fetcher), env=ENV, offline_paths=[])
    assert r.lga_code == "nsw-hornsby" and seen["params"]["geometryType"] == "esriGeometryPoint"
    with pytest.raises(G.LgaServiceError):
        G.PointQueryClient(lambda u, p: (json.dumps({"error": {"code": 400}}).encode(), None)).get_json("http://x", {})
    with pytest.raises(G.LgaServiceError):
        G.PointQueryClient(lambda u, p: (b"<html>", None)).get_json("http://x", {})


# ---------------------------------------------------------------- offline geojson
def synthetic_geojson(path: Path, name: str, box: tuple[float, float, float, float], **props):
    """SYNTHETIC TEST FIXTURE: a rectangle labelled with an LGA name. It is NOT a real boundary."""
    x0, y0, x1, y1 = box
    ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"lganame": name, **props}, "geometry": {"type": "Polygon", "coordinates": [ring]}}]}))
    return path


def test_offline_geojson_hit_state_from_file_name(tmp_path):
    f = synthetic_geojson(tmp_path / "nsw_lga_SYNTHETIC.geojson", "Synthetic Shire Council", (150.0, -31.5, 150.6, -30.5))
    r = G.lookup_lga(*GUNNEDAH_PT, client=FakeClient({}), network=False, offline_paths=[f])
    assert (r.method, r.state, r.lga_code, r.boundary_tested, r.source_verified, r.verified, r.source) == (
        "offline_geojson", "NSW", "nsw-synthetic", True, False, False, str(f))


def test_offline_overlap_is_ambiguous_and_projected_file_is_skipped(tmp_path):
    a = synthetic_geojson(tmp_path / "nsw_a.geojson", "Alpha Shire Council", (150.0, -31.5, 150.6, -30.5))
    b = synthetic_geojson(tmp_path / "nsw_b.geojson", "Beta Shire Council", (150.2, -31.2, 150.9, -30.7))
    r = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[a, b])
    assert r.lga_name == "Alpha Shire Council" and r.ambiguous and any(n.startswith("AMBIGUOUS:") for n in r.notes)
    proj = synthetic_geojson(tmp_path / "nsw_projected.geojson", "Gamma Shire Council", (300000.0, 6000000.0, 310000.0, 6010000.0))
    r2 = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[proj, a])
    assert r2.lga_name == "Alpha Shire Council" and "OFFLINE FILE NOT IN WGS84, SKIPPED: nsw_projected.geojson" in r2.notes
    only = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[proj], lot_lga_name="Gunnedah", state_hint="NSW")
    assert only.method == "lot_attribute" and any("NOT IN WGS84" in n for n in only.notes)


def test_offline_geojson_state_property_and_miss(tmp_path):
    f = synthetic_geojson(tmp_path / "lga.geojson", "Synthetic Regional", (145.0, -17.5, 146.0, -16.5), state="QLD")
    hit = G.lookup_lga(145.5, -17.0, network=False, offline_paths=[f])
    assert hit.state == "QLD" and hit.lga_code == "qld-synthetic"
    miss = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[f])
    assert miss.method == "not_found"


def test_offline_geojson_without_state_gives_no_code(tmp_path):
    f = synthetic_geojson(tmp_path / "lga.geojson", "Synthetic", (150.0, -31.5, 150.6, -30.5))
    r = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[f])
    assert r.method == "offline_geojson" and r.state is None and r.lga_code is None


def test_arcgis_wins_over_offline_and_offline_over_attribute(tmp_path):
    f = synthetic_geojson(tmp_path / "nsw.geojson", "Offline Name", (150.0, -31.5, 150.6, -30.5))
    c = FakeClient({"nsw_lga": feats(lganame="LIVE NAME")})
    assert G.lookup_lga(*GUNNEDAH_PT, client=c, env=ENV, offline_paths=[f]).lga_name == "LIVE NAME"
    r = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[f], lot_lga_name="ATTR", state_hint="NSW")
    assert r.method == "offline_geojson" and r.lga_name == "Offline Name"


def test_unreadable_offline_file_is_noted(tmp_path):
    bad = tmp_path / "bad.geojson"
    bad.write_text("{not json")
    r = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[bad], lot_lga_name="Gunnedah", state_hint="NSW")
    assert r.method == "lot_attribute" and any("unreadable" in n for n in r.notes)


def test_no_boundary_data_ships_in_the_repo():
    assert G.default_offline_paths() == []          # the owner adds real files; none are invented


# ---------------------------------------------------------------- lot attribute, not found
def test_lot_attribute_nsw_and_qld():
    n = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[], lot_lga_name="GUNNEDAH", state_hint="NSW")
    assert (n.method, n.verified, n.state, n.lga_code) == ("lot_attribute", False, "NSW", "nsw-gunnedah")
    q = G.lookup_lga(145.77, -16.92, network=False, offline_paths=[], lot_lga_name="Cairns Regional", state_hint="QLD")
    assert q.lga_code == "qld-cairns" and q.method == "lot_attribute"


def test_lot_attribute_without_state_has_no_code():
    r = G.lookup_lga(*GUNNEDAH_PT, network=False, offline_paths=[], lot_lga_name="GUNNEDAH")
    assert r.method == "lot_attribute" and r.lga_name == "GUNNEDAH" and r.lga_code is None


def test_not_found():
    r = G.lookup_lga(0.0, 0.0, client=FakeClient({"nsw_lga": {"features": []}, "qld_lga": {"features": []}}), env=ENV, offline_paths=[])
    assert (r.method, r.state, r.lga_name, r.lga_code, r.verified, r.found) == ("not_found", None, None, None, False, False)
    assert "UNRESOLVED" in r.summary()


def test_user_entered():
    r = G.from_user_entry("Gunnedah", "NSW")
    assert (r.method, r.verified, r.lga_code) == ("user_entered", False, "nsw-gunnedah")


# ---------------------------------------------------------------- lot centroid and run_site wiring
def test_centroid_of_the_saved_lot2_is_in_gunnedah():
    import app.offline.lot2 as OFF
    lot = OFF.sa1_result().lot
    lon, lat = G.centroid_lonlat(lot.boundary_wkt, lot.mga_srid)
    assert 150.2 < lon < 150.3 and -31.0 < lat < -30.9


def test_run_site_offline_lot2_resolves_via_lot_attribute_not_a_boundary(tmp_path):
    from scripts import run_site as RS
    import app.offline.lot2 as OFF
    lines = []
    rep = RS.Report(lines.append)
    a = RS.build_parser().parse_args(["--out", str(tmp_path)])
    assert a.lga == "auto"
    res = RS.lookup_site_lga(a, OFF.sa1_result().lot, client=None, rep=rep, offline=True)
    assert (res.method, res.lga_code, res.verified) == ("lot_attribute", "nsw-gunnedah", False)
    RS.apply_requirements_context(res, OFF.sa1_result().lot, rep)
    assert rep.facts["requirements_context"]["lga"] == "nsw-gunnedah"
    assert rep.facts["platform_defaults"] == ["stormwater.osd_required", "stormwater.psd_l_s"]
    assert "UNRESOLVED" in rep.facts["stormwater_requirements"]["stormwater.osd_method"]
    # the Gunnedah rules are loaded but hold no PSD row: the default says so (owner decision D3, transparent about why)
    assert "PLATFORM DEFAULT, LGA VALUE NOT FOUND" in rep.facts["stormwater_requirements"]["stormwater.psd_l_s"]


def test_run_site_typed_lga_and_auto_default(tmp_path):
    from scripts import run_site as RS
    import app.offline.lot2 as OFF
    assert RS.explicit_lga("auto") is None and RS.explicit_lga("AUTO") is None and RS.explicit_lga(None) is None
    assert RS.explicit_lga("Gunnedah") == "Gunnedah"
    rep = RS.Report(lambda s: None)
    a = argparse.Namespace(lga="Gunnedah")
    res = RS.lookup_site_lga(a, OFF.sa1_result().lot, client=None, rep=rep, offline=True)
    assert res.method == "user_entered" and res.lga_code == "nsw-gunnedah"
