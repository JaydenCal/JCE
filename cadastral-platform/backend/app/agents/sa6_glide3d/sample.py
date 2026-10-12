"""Sample scene (612 m2 sloping lot) and CLI: python -m app.agents.sa6_glide3d.sample [out.json]"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, box

from app.common.contracts import BoundarySegment, DrivewayDesign, LotContext, RwtSummary, ServiceLine, OverlayPolygon
from .models import BuildingIn, PitIn, PlacedItem, SceneOptions, SceneRequest, TinArrays, WallIn, CutFillIn
from .scene import build_scene, dumps

E0, N0 = 334500.0, 6263900.0
W, D = 18.0, 34.0            # 612 m2


def sample_request() -> SceneRequest:
    ring = [(E0, N0), (E0 + W, N0), (E0 + W, N0 + D), (E0, N0 + D)]
    segs = [BoundarySegment(seq=i, bearing_deg=0, bearing_dms="0", distance_m=1, is_front=(i == 0), start_xy=ring[i], end_xy=ring[(i + 1) % 4]) for i in range(4)]
    lot = LotContext(lot_id="00000000-0000-0000-0000-000000000001", jurisdiction="NSW", lotplan="1/DP123456", lga_name="Sample Council", mga_srid=7856, area_m2_calculated=W * D,
                     boundary_wkt="POLYGON((%s))" % ",".join(f"{x} {y}" for x, y in ring + ring[:1]), segments=segs)
    g = np.arange(-8, W + 8.1, 2.0), np.arange(-8, D + 8.1, 2.0)
    X, Y = np.meshgrid(*g)
    z = lambda x, y: 100.0 + 0.06 * y + 0.01 * x          # falls to the front (south)
    V = np.c_[X.ravel() + E0, Y.ravel() + N0, z(X.ravel(), Y.ravel())]
    nx = X.shape[1]
    F = [t for j in range(X.shape[0] - 1) for i in range(nx - 1)
         for t in ((j * nx + i, j * nx + i + 1, (j + 1) * nx + i), (j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i))]
    ex = TinArrays(vertices=[tuple(map(float, v)) for v in V], triangles=F)
    pad = 101.6
    Vd = V.copy(); lx, ly = Vd[:, 0] - E0, Vd[:, 1] - N0
    inpad = (lx > 3) & (lx < 15) & (ly > 9) & (ly < 25)
    Vd[inpad, 2] = pad
    de = TinArrays(vertices=[tuple(map(float, v)) for v in Vd], triangles=F)
    house = box(E0 + 4.5, N0 + 12, E0 + 14, N0 + 22)
    wkt = lambda g: g.wkt
    drv = LineString([(E0 + 3.0, N0), (E0 + 3.0, N0 + 12)])
    drive = DrivewayDesign(centreline_wkt=wkt(drv), width_m=3.0, crossover_wkt=wkt(box(E0 + 1.5, N0 - 2, E0 + 4.5, N0 + 0.5)), max_grade_pct=14.0,
                           turning_path_wkt=wkt(drv.buffer(1.6, cap_style=2)), turning_circle_centre_xy=(E0 + 9, N0 + 6), turning_circle_radius_m=4.5,
                           dimensions=[("3.0 m", (E0 + 1.5, N0 + 6), (E0 + 4.5, N0 + 6))])
    svc = [ServiceLine(service="water", label="DN25 water", geometry_wkt=LineString([(E0 + 16, N0 - 2), (E0 + 16, N0 + 14)]).wkt, diameter_mm=25, depth_m=0.5,
                       exclusion_wkt=LineString([(E0 + 16, N0 - 2), (E0 + 16, N0 + 14)]).buffer(1.0).wkt),
           ServiceLine(service="sewer", label="DN100 sewer", geometry_wkt=LineString([(E0 + 12, N0 + 30), (E0 + 12, N0 + 33.9), (E0 + 18, N0 + 33.9)]).wkt, diameter_mm=100, depth_m=1.8,
                       exclusion_wkt=LineString([(E0 + 12, N0 + 30), (E0 + 12, N0 + 33.9), (E0 + 18, N0 + 33.9)]).buffer(1.5).wkt),
           ServiceLine(service="stormwater", label="DN150 stormwater (proposed)", geometry_wkt=LineString([(E0 + 9, N0 + 12), (E0 + 9, N0 + 1)]).wkt, diameter_mm=150, depth_m=0.6, is_proposed=True),
           ServiceLine(service="electricity", label="LV underground", geometry_wkt=LineString([(E0 + 17, N0 - 2), (E0 + 17, N0 + 15), (E0 + 14, N0 + 18)]).wkt, depth_m=None)]
    return SceneRequest(
        project_title="Sample lot - 612 m2 sloping site", subtitle="Illustrative sample bundle (unverified)", lot=lot, origin=(E0, N0), ffl=pad + 0.15,
        existing_tin=ex, design_tin=de, cut_fill=CutFillIn(cut_volume_m3=48.0, fill_volume_m3=21.0, pad_level_m=pad),
        walls=[WallIn(alignment=[(E0 + 3, N0 + 9), (E0 + 15, N0 + 9)], height_m=0.6, mode="fill", label="Retaining wall")],
        driveway=drive, services=svc, pits=[PitIn(xy=(E0 + 9, N0 + 1), label="Pit P1")],
        rwt=RwtSummary(tank_volume_l=3000, location_xy=(E0 + 16.5, N0 + 20), diameter_m=1.5, regime="on-site detention + reuse"),
        buildings=[BuildingIn(name="House", footprint_wkt=wkt(house), base_rl=pad + 0.15, wall_height_m=2.7, roof_type="hip", roof_pitch_deg=22.5, door_xy=(E0 + 9, N0 + 12))],
        council_overlays=[OverlayPolygon(label="Bushfire buffer", kind="bushfire", geometry_wkt=box(E0, N0 + 28, E0 + W, N0 + D).wkt)],
        items=[PlacedItem(item_id="i1", name="Outdoor table", x=E0 + 9, y=N0 + 26, dims_m=(1.8, 0.9, 0.75), retailer="Example Store", price=399.0),
               PlacedItem(item_id="i2", name="Planter", x=E0 + 12, y=N0 + 32, dims_m=(0.6, 0.6, 0.5))],
        options=SceneOptions(max_total_triangles=8000, contour_interval_m=0.25, tube_sides=6))


def main(argv: list[str] | None = None) -> Path:
    argv = argv if argv is not None else sys.argv[1:]
    out = Path(argv[0]) if argv else Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "sample_scene_bundle.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(dumps(build_scene(sample_request())))
    return out


if __name__ == "__main__":
    print(main())
