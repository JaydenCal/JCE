import re
from pathlib import Path
from uuid import uuid4

import pymupdf
from shapely.geometry import box

from app.agents.sa9_constraints.intersect import LayerResult
from app.report import SiteReportInputs, build_site_report
from app.report import fmt
from app.report.acks import ACK_TEXT

LOT = box(0, 0, 20, 40)


def _inp():
    res = [LayerResult(key="nsw_bushfire", label="Bushfire", status="affected", overlap_area_m2=0.0, nearest_distance_m=54.0,
                       attributes=[{"Category": 3, "d_Category": "Vegetation Category 3"}], geometries_wkt=[box(0, 94, 50, 120).wkt],
                       data_currency="source currency 2024-12-13; fetched 2026-10-12"),
           LayerResult(key="nsw_contamination", label="Contam", status="not_checked", error="no endpoint configured")]
    return SiteReportInputs(meta={"lotplan": "2//DP227508", "lga_name": "Test", "jurisdiction": "NSW", "development_type": "Dwelling house",
                                  "date": "2026-10-12", "zone_code": "R2", "area_m2": 800.0}, results=res, triggers=[], lot_wkt=LOT.wkt, imagery=None)


def test_report_pure_and_readable():
    pdf, js = build_site_report(_inp())
    txt = "".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf"))
    assert "What matters for this site" in txt and "Not checked is not clear" in txt and "Lot 2 DP 227508" in txt
    assert "{'" not in txt and "Source: to be cited" not in txt
    assert js["counts"]["nearby"] == 1 and js["counts"]["unchecked"] == 1


def test_formats():
    assert fmt.hdate("2024-12-13") == "13 Dec 2024"
    assert fmt.parse_currency("source currency 2024-12-13; fetched 2026-10-12")["source"].year == 2024


def test_ack_wording_matches_legal():
    t = Path(__file__).parents[2] / "legal" / "TERMS_AND_CONDITIONS.md"
    if t.exists():
        s = t.read_text()
        for k, (_, _, w) in ACK_TEXT.items():
            assert w in s
