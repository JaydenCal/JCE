import math
import uuid

import numpy as np

from app.agents.sa5_cad_dxf.planset import PlansetInput, build_planset, fonts
from app.agents.sa5_cad_dxf.planset.contours import contours_from_mesh, grid_mesh, pick_interval
from app.agents.sa5_cad_dxf.planset.core import pick_scale
from app.agents.sa5_cad_dxf.planset.logo import logo_polygons
from app.common.contracts import BoundarySegment, LotContext, NeighbourLot


def test_contours_plane():
    V, T = grid_mesh(lambda x, y: 0.1 * x, (0, 0, 40, 20), 2.0)
    cs = contours_from_mesh(V, T, 1.0, smooth=False)
    assert {c.level for c in cs} == {0.0, 1.0, 2.0, 3.0, 4.0}
    for c in cs:
        assert all(abs(x - c.level * 10) < 1e-6 for x, _ in c.pts)


def test_scale_and_interval():
    assert pick_scale(120, 80, 250, 270) == 500
    assert pick_interval(0.8, 0.5) == 0.5


def test_font_and_logo():
    assert "Narrow" in fonts.info().name
    from app.branding.brand import Brand
    polys, asp = logo_polygons(str(Brand().logo_path))
    assert len(polys) >= 3 and asp > 2


def _lot():
    pts = [(0, 0), (30, 0), (30, 50), (0, 50)]
    segs = [BoundarySegment(seq=i, bearing_deg=0, bearing_dms="0°00'00\"", distance_m=30, adjoins="road" if i == 0 else "unknown", is_front=i == 0,
                            start_xy=pts[i], end_xy=pts[(i + 1) % 4]) for i in range(4)]
    wkt = "POLYGON((" + ",".join(f"{x} {y}" for x, y in pts + [pts[0]]) + "))"
    nb = NeighbourLot(label="LOT 9 DP1", wkt="POLYGON((30 0,60 0,60 50,30 50,30 0))")
    return LotContext(lot_id=uuid.uuid4(), jurisdiction="NSW", lotplan="1//DP1", lga_name="X", mga_srid=7856, area_m2_calculated=1500, boundary_wkt=wkt,
                      segments=segs, road_names=["Test Road"], zone_code="R2", neighbours=[nb])


def test_planset_builds_without_data(tmp_path):
    res = build_planset(PlansetInput(lot=_lot(), project_title="T", issue_date="2026-01-01"), tmp_path)
    assert len(res["sheets"]) == 12 and res["dxf_stats"]["audit_errors"] == 0
    import pymupdf
    assert len(pymupdf.open(res["pdf"])) == 12
    missing = {n: m for n, _t, m in res["sheets"]}
    assert missing["C410"] and missing["C500"]          # sheets still produced with DATA NOT AVAILABLE
