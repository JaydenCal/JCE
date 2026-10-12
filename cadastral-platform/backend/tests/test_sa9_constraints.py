import json
from uuid import uuid4

import pymupdf
from shapely.geometry import box

from app.agents.sa9_constraints import Sa9Constraints, Sa9Input
from app.agents.sa9_constraints import layers as L
from app.agents.sa9_constraints.intersect import Feature, LayerData
from app.agents.sa9_constraints.triggers import evaluate
from app.common.contracts import LotContext

LOT = box(0, 0, 20, 30)  # 600 m2
FP = box(5, 5, 15, 15)


class Loader:
    def load(self, layer, bbox):
        if layer.key == "nsw_flood":
            return LayerData(features=[Feature(geometry_wkt=box(-5, 0, 20, 6).wkt, attrs={"FPL_M_AHD": 12.3, "X": 1})], currency="2026-01")
        if layer.key == "nsw_bushfire":
            return LayerData(features=[Feature(geometry_wkt=box(-40, -40, -1, 40).wkt.replace("-1 ", "-1 "), attrs={"VEG_CAT": "1"}),
                                       Feature(geometry_wkt=box(16, 5, 40, 12).wkt, attrs={"VEG_CAT": "2"})], currency="2026-02")
        if layer.key == "nsw_heritage_item":
            return LayerData(features=[Feature(geometry_wkt=box(100, 100, 120, 120).wkt, attrs={"ITEM_NAME": "Far"})])
        if layer.key == "nsw_biodiversity":
            raise TimeoutError("down")
        return LayerData(features=[])


def _cfg():
    L.set_endpoints({k: {"endpoint": "http://x/" + k} for k in L.REGISTRY})


def _inp(tmp):
    lot = LotContext(lot_id=uuid4(), jurisdiction="NSW", lotplan="1/DP1", lga_name="Test", mga_srid=7856,
                     area_m2_calculated=600, boundary_wkt=LOT.wkt, segments=[])
    return Sa9Input(lot=lot, footprint_wkt=FP.wkt, output_dir=str(tmp))


def test_end_to_end(tmp_path):
    _cfg()
    r = Sa9Constraints(Loader()).run(_inp(tmp_path))
    by = {x.key: x for x in r.layers}
    f = by["nsw_flood"]
    assert f.status == "affected" and f.overlap_area_m2 == 120.0 and f.pct_of_lot == 20.0
    assert f.footprint_affected is True and f.attributes == [{"FPL_M_AHD": 12.3}] and f.snapshot_sha256
    bf = by["nsw_bushfire"]  # buffer 100 m: nearest feature touches footprint
    assert bf.status == "affected" and bf.footprint_affected is True
    assert by["nsw_heritage_item"].status == "not_affected" and by["nsw_heritage_item"].nearest_distance_m > 50
    assert by["nsw_biodiversity"].status == "not_checked" and "TimeoutError" in by["nsw_biodiversity"].error
    assert by["nsw_acid_sulfate"].status == "not_affected"
    assert r.overlays and all(o.geometry_wkt for o in r.overlays)
    doc = pymupdf.open(r.pdf_path)
    txt = "".join(p.get_text() for p in doc)
    for s in ("Planning Constraints", "Summary of layers", "Not checked", "Triggers and next steps", "s10.7", "Acknowledgements", "TO BE CONFIRMED"):
        assert s in txt
    gj = json.load(open(r.geojson_path))
    assert gj["type"] == "FeatureCollection" and any(x["properties"].get("layer") == "nsw_flood" for x in gj["features"])
    assert json.load(open(r.json_path))["layers"]


def test_trigger_unresolved_and_resolved(tmp_path):
    _cfg()
    r = Sa9Constraints(Loader()).run(_inp(tmp_path))
    t = [x for x in r.triggers if x.rule_id == "flood.fpl"][0]
    assert t.unresolved and all(c.status == "to_be_confirmed" and "s10.7" in c.instruction for c in t.consequences)
    res = lambda rid, item, key, a: {"value": "0.5 m", "citation": "DCP 4.2"} if item == "freeboard" else None
    t2 = [x for x in evaluate(r.layers, "NSW", res) if x.rule_id == "flood.fpl"][0]
    assert [c for c in t2.consequences if c.item == "freeboard"][0].status == "resolved"
    assert "may apply" in t2.development_pathway_hint


def test_no_endpoint_not_checked():
    L._CONFIG.clear()
    from app.agents.sa9_constraints.intersect import check_layer
    assert check_layer(L.get_layer("nsw_contamination"), LOT, FP, Loader()).status == "not_checked"
