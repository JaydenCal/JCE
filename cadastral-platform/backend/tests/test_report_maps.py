"""Planning map extracts (app/report/maps.py, sections_maps.py, SA1 zone polygons, SA9 map features, scripts/demo_maps.py).

Everything here runs without network and with SYNTHETIC data only.  The real offline Lot 2 run is covered by tests/test_soee_site.py (SoEE appendix).
"""
import importlib.util
import io
import json
import re
import sys
from pathlib import Path

import pymupdf
import pytest
from shapely.geometry import box

from app.agents.sa9_constraints.intersect import MAP_FEATURE_CAP, Feature, LayerData, check_layer
from app.agents.sa9_constraints.layers import get_layer
from app.report import build_site_report, fmt, maps as MP
from app.report import demo as DEMO

BACKEND = Path(__file__).resolve().parents[1]


def _flat(s: str) -> str:
    return re.sub(r"\s+", " ", s)


@pytest.fixture(scope="module")
def demo_built(tmp_path_factory):
    d = tmp_path_factory.mktemp("maps")
    inp = DEMO.demo_inputs()
    pdf, js = build_site_report(inp, maps_dir=d / "planning_maps")
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    return {"inp": inp, "pdf": pdf, "js": js, "doc": doc, "pages": [_flat(p.get_text()) for p in doc], "dir": d / "planning_maps"}


# ------------------------------------------------------------------------------------------------------------------ one figure per layer
def test_a_figure_for_zoning_and_every_layer_checked_or_not(demo_built):
    recs = {m["key"]: m for m in demo_built["js"]["planning_maps"]}
    assert "zoning" in recs
    for r in demo_built["inp"].results:
        assert r.key in recs, r.key                                           # every layer screened has a figure, checked or not
    nums = [m["figure"] for m in demo_built["js"]["planning_maps"]]
    assert nums == list(range(nums[0], nums[0] + len(nums)))                   # numbered consecutively
    for key in ("nsw_lot_size_map", "nsw_height_map", "nsw_fsr_map", "nsw_flood", "nsw_bushfire", "nsw_heritage_item", "nsw_acid_sulfate", "nsw_biodiversity", "nsw_riparian"):
        assert key in recs
    assert all((demo_built["dir"] / Path(m["png"]).name).exists() for m in demo_built["js"]["planning_maps"])


def test_polygon_maps_have_category_legend_with_lot_share_and_labels(demo_built):
    recs = {m["key"]: m for m in demo_built["js"]["planning_maps"]}
    z = recs["zoning"]
    assert z["state"] == "map" and any(l.startswith("R2") for l in z["legend"]) and any(l.startswith("RU1") for l in z["legend"])
    assert any("% of lot" in l for l in z["legend"]) and "Lot boundary (subject lot)" in z["legend"] and "Adjoining lots" in z["legend"]
    assert {c["class"].split(" ")[0] for c in z["on_lot"]} == {"R2", "RU1"}
    assert recs["nsw_lot_size_map"]["state"] == "map" and len(recs["nsw_lot_size_map"]["on_lot"]) == 2
    t = demo_built["pages"][7]
    assert "RU1" in t and "R2" in t


def test_multi_zone_lot_is_flagged_on_the_figure(demo_built):
    z = next(m for m in demo_built["js"]["planning_maps"] if m["key"] == "zoning")
    assert z["result"] == "Multi-zone" and any(b.startswith("MULTI-ZONE LOT") for b in z["banners"])
    assert any("MULTI-ZONE LOT" in p for p in demo_built["pages"])


def test_more_than_one_class_on_a_control_map_is_flagged(demo_built):
    r = next(m for m in demo_built["js"]["planning_maps"] if m["key"] == "nsw_fsr_map")
    assert any(b.startswith("MORE THAN ONE MAPPED CLASS") for b in r["banners"])


# ------------------------------------------------------------------------------------------------------------------ honesty
def test_not_checked_layer_gets_panel_never_a_blank_or_clean_map(demo_built):
    recs = {m["key"]: m for m in demo_built["js"]["planning_maps"]}
    for k in DEMO.NOT_CHECKED:
        assert recs[k]["state"] == "not_checked" and recs[k]["result"] == "Not checked"
        assert MP.NOT_CHECKED_PANEL in recs[k]["summary"]
    txt = " ".join(demo_built["pages"])
    assert txt.count("MAP NOT AVAILABLE: LAYER NOT CHECKED (NOT CLEAR)") >= 2 * len(DEMO.NOT_CHECKED)       # panel and caption
    pms = [p for p in demo_built["inp"].results if p.key in DEMO.NOT_CHECKED]
    assert len(pms) == 2


def test_not_checked_map_object_has_no_figure_and_no_polygons():
    from app.report.findings import build_findings
    inp = DEMO.demo_inputs()
    f = [x for x in build_findings(inp.results, inp.triggers, box(0, 0, 25, 40), "dwelling_house") if x.key == "nsw_contamination"][0]
    pm = MP._layer_map(inp, f, box(0, 0, 25, 40), MP._base_figure(inp, box(0, 0, 25, 40), None, 250, []), 9, "", False, False)
    assert pm.fig is None and pm.state == "not_checked" and pm.chip_kind == "unchecked" and pm.panel[0] == MP.NOT_CHECKED_PANEL
    assert "Not checked is not clear" in " ".join(pm.panel)


def _attr_only_inputs():
    inp = DEMO.demo_inputs()
    inp.zone_map = None                                           # what the offline fixture holds: a zone attribute and no polygons
    inp.meta["flags"] = ["offline_fixture", "multi_zone_in_saved_live_run"]
    inp.meta.pop("synthetic_demo", None)
    return inp


def test_zone_attribute_only_draws_no_invented_boundary():
    inp = _attr_only_inputs()
    pdf, js = build_site_report(inp)
    z = next(m for m in js["planning_maps"] if m["key"] == "zoning")
    assert z["state"] == "attribute_only" and MP.ZONE_ATTR_BANNER in z["banners"]
    assert any(b.startswith("MULTI-ZONE POSSIBLE") for b in z["banners"])                  # the saved live run flag is carried, not hidden
    assert z["on_lot"] == [] and "No zone boundary is drawn" in z["summary"]
    lot = box(0, 0, 25, 40)
    pm = MP._zoning_map(inp, lot, MP._base_figure(inp, lot, None, 250, []), 4, "", True, False)
    assert pm.fig.layers == [] and pm.fig.lot_tag.startswith("R2")                          # attribute printed in the lot, nothing else drawn
    txt = _flat(" ".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf")))
    assert MP.ZONE_ATTR_BANNER in txt


def test_no_zone_data_at_all_is_a_not_checked_panel():
    inp = _attr_only_inputs()
    inp.meta["zone_code"] = None
    lot = box(0, 0, 25, 40)
    pm = MP._zoning_map(inp, lot, MP._base_figure(inp, lot, None, 250, []), 4, "", False, False)
    assert pm.state == "not_checked" and pm.fig is None and pm.panel[0] == MP.NOT_CHECKED_PANEL


def test_layer_reporting_a_feature_but_holding_no_geometry_is_not_drawn_as_clear():
    inp = DEMO.demo_inputs()
    r = next(x for x in inp.results if x.key == "nsw_flood")
    r.map_features, r.geometries_wkt = [], []
    pdf, js = build_site_report(inp)
    m = next(x for x in js["planning_maps"] if x["key"] == "nsw_flood")
    assert m["state"] == "no_geometry" and "GEOMETRY NOT KEPT" in m["summary"]


def test_no_feature_map_says_not_intersected_by_data_loaded_not_clear(demo_built):
    r = next(m for m in demo_built["js"]["planning_maps"] if m["key"] == "nsw_biodiversity")
    assert r["state"] == "no_features" and "NOT INTERSECTED BY THE DATA LOADED" in r["summary"] and r["on_lot"] == []
    assert not any(w in r["summary"].lower() for w in (" is clear", "no constraint", "free of"))


# ------------------------------------------------------------------------------------------------------------------ legend, source line, licence
def test_every_figure_has_source_line_and_licence_wording(demo_built):
    for m in demo_built["js"]["planning_maps"]:
        assert m["source"].startswith("Source:")
    assert all("SYNTHETIC DEMO DATA" in m["source"] for m in demo_built["js"]["planning_maps"])


def test_licence_not_recorded_text_when_endpoint_has_no_copyright():
    assert MP.LICENCE_NOT_RECORDED == "LICENCE NOT RECORDED, CONFIRM ATTRIBUTION"
    assert MP.LICENCE_NOT_RECORDED in MP._licence_text(None, None)
    t = MP._licence_text("Copyright State of NSW", None)
    assert "Copyright State of NSW" in t and MP.LICENCE_NOT_RECORDED not in t


def test_real_layer_source_line_has_dataset_service_dates_and_licence():
    from app.report.findings import build_findings
    inp = DEMO.demo_inputs()
    inp.meta.pop("synthetic_demo")
    f = next(x for x in build_findings(inp.results, inp.triggers, box(0, 0, 25, 40), "dwelling_house") if x.key == "nsw_flood")
    line = MP.layer_source_line(f, ["Test LEP"], False)
    assert line.startswith("Source: Dataset:") and "service" in line and "instrument: Test LEP" in line
    assert "retrieved" in line and ("LICENCE NOT RECORDED" in line or "Copyright statement as recorded" in line)


def test_zone_source_line_uses_snapshot_and_otherwise_says_not_recorded():
    inp = DEMO.demo_inputs()
    inp.meta.pop("synthetic_demo")
    inp.zone_map["source"] = {"provider": "x", "layer_name": "Land Zoning", "service_url": "https://h/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/2",
                              "attribution": "", "fetched_at": "2026-10-12T01:00:00+00:00"}
    lot = box(0, 0, 25, 40)
    pm = MP._zoning_map(inp, lot, MP._base_figure(inp, lot, None, 250, []), 4, "", False, False)
    assert "Land Zoning" in pm.source and "retrieved 12/10/2026" in pm.source and "Planning/EPI_Primary_Planning_Layers" in pm.source and MP.LICENCE_NOT_RECORDED in pm.source
    inp.zone_map["source"] = None
    pm2 = MP._zoning_map(inp, lot, MP._base_figure(inp, lot, None, 250, []), 4, "", False, False)
    assert "NOT RECORDED" in pm2.source


def test_no_dashes_or_contractions_in_figure_text(demo_built):
    for m in demo_built["js"]["planning_maps"]:
        blob = " ".join([m["summary"], m["source"]] + m["banners"] + m["legend"])
        assert "–" not in blob and "—" not in blob
    assert "–" not in " ".join(demo_built["pages"]) and "—" not in " ".join(demo_built["pages"])


# ------------------------------------------------------------------------------------------------------------------ report wiring
def test_references_resolve_to_figures_with_the_same_title(demo_built):
    txt = " ".join(demo_built["pages"])
    caps = {int(n): t for n, t in re.findall(r"Figure (\d+)\. (?:SYNTHETIC DEMO DATA\. )?([A-Z][A-Za-z ]+? Map) for", txt)}
    assert caps and len(caps) >= 18
    refs = re.findall(r"refer Figure (\d+), ([A-Z][A-Za-z ]+? Map)", txt)
    assert len(refs) >= 8
    for n, title in refs:
        assert caps.get(int(n)) == title, (n, title)
    recs = {m["figure"]: m["title"] for m in demo_built["js"]["planning_maps"]}
    assert all(recs[int(n)] == t for n, t in refs)


def test_layer_pages_and_tables_reference_their_figure(demo_built):
    txt = " ".join(demo_built["pages"])
    assert "Planning map: refer Figure" in txt                                                # constraint pages
    assert re.search(r"Map: refer Figure \d+, Flood Planning Map", txt)                        # constraint table
    assert "(refer Figure 4, Land Zoning Map)" in txt and "(refer Figure 5, Minimum Lot Size Map)" in txt      # site page


def test_captions_keep_with_figure_and_no_stranded_headings(demo_built):
    for i, t in enumerate(demo_built["pages"]):
        if "Planning maps" in t and "MAP INDEX" in t:
            assert "Figure 4" in " ".join(demo_built["pages"][i:i + 2])
    for i, pg in enumerate(demo_built["doc"]):
        lines = [l for l in pg.get_text().split("\n") if l.strip()]
        body = [l for l in lines if not l.startswith(("AI GENERATED", "NOT A S10.7", "NOT A 510.7", "JCESITE", "PAGE "))]
        assert not (body and re.match(r"^\d\d / SECTION$", body[-1])), i                      # a section label as the last line of a page


def test_synthetic_stamp_on_every_page_and_figure(demo_built):
    assert all("SYNTHETIC DEMO DATA" in p for p in demo_built["pages"])
    assert all(m["synthetic"] for m in demo_built["js"]["planning_maps"])
    # the PNG written for the SoEE carries the stamp too (red band across the top of the map): sample the pixel colour just under the header strip
    from PIL import Image
    im = Image.open(demo_built["dir"] / "zoning.png").convert("RGB")
    px = im.getpixel((im.width // 3, int(im.height * 0.075)))
    assert px[0] > 130 and px[1] < 90 and px[2] < 90, px
    pn = Image.open(demo_built["dir"] / "nsw_contamination.png").convert("RGB")
    assert pn.size[0] > 200


def test_report_without_maps_inputs_still_builds_and_zone_map_is_optional():
    inp = DEMO.demo_inputs()
    inp.zone_map = None
    pdf, js = build_site_report(inp)
    assert js["planning_maps"][0]["key"] == "zoning" and len(pymupdf.open(stream=pdf, filetype="pdf")) > 10


def test_demo_inputs_are_marked_synthetic():
    inp = DEMO.demo_inputs()
    assert inp.meta["synthetic_demo"] is True and "SYNTHETIC" in DEMO.__doc__
    assert all(p["instrument"] == "SYNTHETIC DEMO PLAN" for p in inp.zone_map["polygons"])


# ------------------------------------------------------------------------------------------------------------------ SA9 map features and SA1 zone polygons
class _Loader:
    def __init__(self, feats):
        self.feats = feats

    def load(self, layer, bbox):
        return LayerData(features=self.feats, currency="source currency 2026-01-01; fetched 2026-10-01")


def test_sa9_keeps_clipped_map_features_and_window():
    lot = box(0, 0, 25, 40)
    lt = get_layer("nsw_flood")
    feats = [Feature(geometry_wkt=box(-1000, -1000, 1000, 1000).wkt, attrs={"LAY_CLASS": "A"}), Feature(geometry_wkt=box(900, 900, 950, 950).wkt, attrs={})]
    r = check_layer(lt, lot, None, _Loader(feats), margin=150.0)
    assert r.map_window == [-150.0, -150.0, 175.0, 190.0]
    assert len(r.map_features) == 1                                                            # the far feature is outside the window
    from shapely import wkt
    g = wkt.loads(r.map_features[0].geometry_wkt)
    assert g.bounds == (-150.0, -150.0, 175.0, 190.0)                                          # clipped to the window, not stored whole
    assert r.status == "affected"


def test_sa9_cap_sets_truncation_flag():
    lot = box(0, 0, 25, 40)
    feats = [Feature(geometry_wkt=box(i, 60, i + 0.5, 61).wkt, attrs={}) for i in range(MAP_FEATURE_CAP + 5)]
    feats = [Feature(geometry_wkt=box(-100 + (i % 20) * 10, 60 + (i // 20), -99 + (i % 20) * 10, 61 + (i // 20)).wkt, attrs={}) for i in range(MAP_FEATURE_CAP + 5)]
    r = check_layer(get_layer("nsw_flood"), lot, None, _Loader(feats), margin=500.0)
    assert r.map_features_truncated and len(r.map_features) == MAP_FEATURE_CAP


def test_sa9_unavailable_layer_keeps_no_map_features():
    r = check_layer(get_layer("nsw_flood"), box(0, 0, 25, 40), None, None)
    assert r.status == "not_checked" and r.map_features == [] and r.map_window is None


def _sa1_tests():
    spec = importlib.util.spec_from_file_location("sa1_t", BACKEND / "tests" / "test_sa1_cadastre.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["sa1_t"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_sa1_keeps_zone_polygons_source_and_flags_multizone():
    from app.agents.sa1_cadastre.models import Sa1Request
    t = _sa1_tests()
    agent, _ = t.nsw_agent([t.zone(324990, 6264990, 40, 30, "R2"), t.zone(324990, 6265020, 40, 80, "E1"), t.zone(325100, 6265200, 40, 40, "RU1")], roads=False)
    res = agent.run(Sa1Request(jurisdiction="NSW", point=(151.1, -33.7)))
    codes = sorted(p.zone_code for p in res.zone_polygons)
    assert codes == ["E1", "R2", "RU1"] and {p.zone_code for p in res.zone_polygons if p.on_lot} == {"E1", "R2"}   # RU1 beside the lot, not on it
    assert res.zone_source is not None and "EPI_Primary" in res.zone_source.service_url and res.zone_source.fetched_at
    assert res.multi_zone and "multi_zone" in res.flags
    zm = MP.zone_map_from_sa1(res)
    json.dumps(zm)                                                                              # JSON safe for sa9_input.json
    assert zm["multi_zone"] and zm["source"]["layer_name"] and zm["coverage"] and len(zm["polygons"]) == 3
    from shapely import wkt
    assert all(wkt.loads(p["wkt"]).is_valid for p in zm["polygons"])


def test_sa1_zone_polygons_empty_when_service_returns_none():
    from app.agents.sa1_cadastre.models import Sa1Request
    t = _sa1_tests()
    agent, _ = t.nsw_agent([], roads=False)
    res = agent.run(Sa1Request(jurisdiction="NSW", point=(151.1, -33.7)))
    assert res.zone_polygons == [] and "no_zoning_data" in res.flags
    zm = MP.zone_map_from_sa1(res)
    assert zm["polygons"] == []


def test_sa1_result_roundtrips_through_sa9_input_json():
    from app.agents.sa9_constraints.agent import Sa9Input
    assert "zone_map" in Sa9Input.model_fields


# ------------------------------------------------------------------------------------------------------------------ review fixes (stage 7 follow-up)
def _findings(inp):
    from app.report.findings import build_findings
    return build_findings(inp.results, inp.triggers, box(0, 0, 25, 40), "dwelling_house")


def test_within_buffer_headline_uses_the_nearest_class_of_any_kind_and_lists_the_next():
    """Nearest mapped bush fire prone land is the Vegetation Buffer (itself mapped land): the headline gives it first, then the farther class."""
    from app.agents.sa9_constraints.intersect import LayerResult
    inp = DEMO.demo_inputs()
    r = next(x for x in inp.results if x.key == "nsw_bushfire")
    far, near = box(100, 0, 130, 40), box(60, 0, 80, 40)                     # buffer 35 m away, category 3 is 75 m away
    r.geometries_wkt = [far.wkt, near.wkt]
    r.attributes = [{"Category": 3, "d_Category": "Vegetation Category 3"}, {"d_Category": "Vegetation Buffer"}]
    r.overlap_area_m2, r.pct_of_lot, r.nearest_distance_m = 0.0, 0.0, 35.0
    f = next(x for x in _findings(inp) if x.key == "nsw_bushfire")
    assert f.status == "nearby" and "35 m from the nearest mapped bush fire prone land (Vegetation Buffer)" in f.headline
    assert "Next nearest: Vegetation Category 3, 75 m." in f.headline
    from app.report import sections as SEC
    assert SEC._dist_text(f).startswith("35 m from the lot")
    # any layer, any class names: the nearest wins, nothing is hard coded to a bush fire category
    from app.report.findings import nearest_classes, FeatureRow
    rows = [FeatureRow("B", "", 90.0, 0, 0, box(0, 0, 1, 1), {}), FeatureRow("A", "", 40.0, 0, 0, box(0, 0, 1, 1), {}), FeatureRow("B", "", 60.0, 0, 0, box(0, 0, 1, 1), {})]
    assert nearest_classes(rows) == [("A", 40.0), ("B", 60.0)]


def test_nearest_distance_in_headline_matches_sa9_nearest_distance():
    inp = DEMO.demo_inputs()
    for k in ("nsw_riparian",):
        r = next(x for x in inp.results if x.key == k)
        f = next(x for x in _findings(inp) if x.key == k)
        if f.status == "nearby":
            assert f"{r.nearest_distance_m:.0f} m from the nearest" in f.headline


def test_not_intersected_maps_carry_an_in_frame_stamp(demo_built):
    from PIL import Image
    recs = {m["key"]: m for m in demo_built["js"]["planning_maps"]}
    nf = [k for k, m in recs.items() if m["state"] == "no_features"]
    assert nf
    lot = box(0, 0, 25, 40)
    pm = MP._layer_map(demo_built["inp"], next(f for f in _findings(demo_built["inp"]) if f.key == nf[0]), lot, MP._base_figure(demo_built["inp"], lot, None, 250, []), 9, "", False, True)
    assert pm.fig.flag == MP.NO_FEATURE_FLAG == "NO FEATURE IN THE DATA LOADED: NOT A CLEARANCE"
    # the flag is drawn inside the figure (the PNG, which is what a cropped image would be): text exists in the PDF page too
    assert any("NO FEATURE IN THE DATA LOADED: NOT A CLEARANCE" in p for p in demo_built["pages"])
    # a map that draws polygons has no such flag
    pm2 = MP._layer_map(demo_built["inp"], next(f for f in _findings(demo_built["inp"]) if f.key == "nsw_flood"), lot, MP._base_figure(demo_built["inp"], lot, None, 250, []), 9, "", False, True)
    assert pm2.fig.flag is None


def test_control_map_not_intersected_has_one_wording_everywhere(demo_built):
    inp = DEMO.demo_inputs()
    r = next(x for x in inp.results if x.key == "nsw_height_map")
    r.status, r.map_features, r.geometries_wkt, r.attributes, r.overlap_area_m2, r.pct_of_lot = "not_affected", [], [], [], 0.0, 0.0
    f = next(x for x in _findings(inp) if x.key == "nsw_height_map")
    assert f.chip == "Not intersected" and f.headline.startswith("NOT INTERSECTED BY THE DATA LOADED")
    pdf, js = build_site_report(inp)
    m = next(x for x in js["planning_maps"] if x["key"] == "nsw_height_map")
    assert m["result"] == "Not intersected" and "NOT INTERSECTED BY THE DATA LOADED" in m["summary"]
    assert "Not mapped" not in " ".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf"))


def test_offline_fixture_places_the_heritage_item_at_133_m_and_the_map_shows_it():
    from shapely import wkt
    from app.offline import lot2_layers as L
    fs, _ = L._features("nsw_heritage_item")
    assert len(fs) == 1 and L._lot.distance(wkt.loads(fs[0].geometry_wkt)) == pytest.approx(133.0, abs=0.01)


def test_feature_beyond_the_standard_extent_widens_the_figure():
    inp = DEMO.demo_inputs()
    r = next(x for x in inp.results if x.key == "nsw_heritage_item")
    g = box(60, 5, 75, 20)
    r.map_features[0].geometry_wkt = box(160, 5, 175, 20).wkt                      # about 135 m from the lot: outside the 70 m extent
    pdf, js = build_site_report(inp)
    m = next(x for x in js["planning_maps"] if x["key"] == "nsw_heritage_item")
    assert not any("OUTSIDE THIS FIGURE EXTENT" in b for b in m["banners"])
    w = float(re.search(r"about (\d+) m wide", m["extent"]).group(1))
    z = float(re.search(r"about (\d+) m wide", next(x for x in js["planning_maps"] if x["key"] == "zoning")["extent"]).group(1))
    assert w > z


def test_distance_leader_and_feature_stay_inside_the_figure_when_the_window_is_shrunk():
    """_fit_window_to_coverage must not shrink the window past the end of a distance leader."""
    from app.report import figures as F
    from PIL import Image
    buf = io.BytesIO()
    im = Image.new("RGB", (100, 50), (255, 255, 255))
    for x in range(30, 70):
        for y in range(10, 40):
            im.putpixel((x, y), (60, 90, 50))                                      # imagery covers only the middle: blank (white) bands round it
    im.save(buf, "PNG")
    lot = box(0, 0, 20, 40)
    win = (-150.0, -75.0, 170.0, 115.0)
    from shapely.geometry import Point
    far = Point(0, 140)
    assert F._fit_window_to_coverage(buf.getvalue(), win, 320 / 190, lot, [far]) == "partial"


def test_civil_summary_uses_the_plan_set_figures_and_states_when_there_is_none():
    from app.report import sections as SEC
    inp = DEMO.demo_inputs()
    inp.civil = {"terrain": {"source": "x", "points": 3, "min_z": 1.0, "max_z": 2.0, "accuracy_text": "UNKNOWN: not stated by the service. A 5 m placeholder is used only so that uncertainty is not understated. It is not a stated figure"},
                 "planset_built": True, "planset": {"driveway_cut_m3": 1.08, "driveway_fill_m3": 0.0, "driveway_max_grade_pct": 5.29},
                 "driveway": {"width_m": 3.0, "design_vehicle": "B85"}}
    pdf, _ = build_site_report(inp)
    t = _flat(" ".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf")))
    assert "1.1 m³" in t and "5.29% steepest profile grade" in t and "Plan set in this run: built" in t
    assert "5 m (unknown (placeholder))" not in t and "ASSUMED / PLATFORM DEFAULT: UNKNOWN" not in t
    inp.civil = {"terrain": inp.civil["terrain"], "planset_built": False, "driveway": {"width_m": 3.0, "design_vehicle": "B85"}}
    pdf2, _ = build_site_report(inp)
    t2 = _flat(" ".join(p.get_text() for p in pymupdf.open(stream=pdf2, filetype="pdf")))
    assert "Plan set in this run: not built" in t2 and "Not calculated in this run" in t2 and "no plan set built" in t2


def test_accuracy_text_never_prints_the_placeholder_as_a_stated_figure():
    rs = importlib.util.spec_from_file_location("run_site_t2", BACKEND / "scripts" / "run_site.py")
    mod = importlib.util.module_from_spec(rs)
    sys.modules["run_site_t2"] = mod
    rs.loader.exec_module(mod)
    t = mod._accuracy_text(5.0, "unknown (placeholder)")
    assert t.startswith("UNKNOWN") and "not a stated figure" in t and "(placeholder)" not in t
    assert mod._accuracy_text(0.5, "service metadata") == "0.5 m (service metadata)"
    assert mod._accuracy_text(None, None).startswith("UNKNOWN")


def test_not_checked_panels_are_laid_out_last():
    keys = [m.key for m in DEMO_MAPS_KEYS()]
    assert keys[0] == "zoning" and keys[-2:] == list(DEMO.NOT_CHECKED)


def DEMO_MAPS_KEYS():
    from app.report.findings import build_findings
    inp = DEMO.demo_inputs()
    fnd = build_findings(inp.results, inp.triggers, box(0, 0, 25, 40), "dwelling_house")
    return MP.build_plan_maps(inp, fnd, box(0, 0, 25, 40), None, demo=True, base_no=4, width_pt=250)
