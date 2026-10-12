"""Custom parcel input: traverse + misclosure, GeoJSON CRS, DXF units, front edges, bearings."""
from __future__ import annotations

import math

import ezdxf
import pytest

from app.agents.base import AgentError
from app.jurisdiction.parcel import (CustomParcelRequest, Sa1CustomParcel, Traverse, TraverseLeg, build_custom_lot, parse_bearing,
                                     run_traverse)
from app.jurisdiction.profile import make_profile


def us_profile(**kw):
    return make_profile("Test County TX", horizontal_epsg=32614, system="imperial_us", country="US", **kw)


def rect_legs(w_ft=100.0, d_ft=150.0, unit="ft"):
    return [TraverseLeg(bearing=90, distance=w_ft, unit=unit), TraverseLeg(bearing=180, distance=d_ft, unit=unit),
            TraverseLeg(bearing=270, distance=w_ft, unit=unit), TraverseLeg(bearing=0, distance=d_ft, unit=unit)]


def test_bearing_parsing():
    assert parse_bearing("87°14'30\"") == pytest.approx(87.241667, abs=1e-5)
    assert parse_bearing("N 45°30' E") == pytest.approx(45.5)
    assert parse_bearing("S10W") == pytest.approx(190.0)
    assert parse_bearing("S 10 E") == pytest.approx(170.0)
    assert parse_bearing("N20W") == pytest.approx(340.0)
    assert parse_bearing(400) == pytest.approx(40.0)
    with pytest.raises(AgentError):
        parse_bearing("N 95 E")


def test_traverse_in_feet_gives_metric_lot_and_area():
    p = us_profile()
    req = CustomParcelRequest(format="traverse", lot_label="Lot 7", traverse=Traverse(start=(600000.0, 3350000.0), legs=rect_legs()))
    res = Sa1CustomParcel(p).run(req)
    lot = res.lot
    assert lot.jurisdiction == "CUSTOM" and lot.mga_srid == 32614 and lot.lga_name == "Test County TX"
    assert lot.area_m2_calculated == pytest.approx(100 * 150 * 0.3048 ** 2, rel=1e-6)
    assert len(lot.segments) == 4
    assert sorted(round(s.distance_m, 3) for s in lot.segments) == [30.48, 30.48, 45.72, 45.72]
    assert res.identifier.jurisdiction == "CUSTOM"


def test_misclosure_rejected_then_accepted_explicitly():
    p = us_profile()
    legs = rect_legs()
    legs[3] = TraverseLeg(bearing=0, distance=152.0, unit="ft")          # 2 ft short of closing: 1:~250
    tv = Traverse(start=(600000.0, 3350000.0), legs=legs)
    with pytest.raises(AgentError) as ei:
        run_traverse(tv, p)
    assert ei.value.error_code == "PARCEL_MISCLOSURE"
    tv2 = tv.model_copy(update={"accept_misclosure": True})
    ring, rep = run_traverse(tv2, p)
    assert not rep.within_tolerance and rep.misclosure_m == pytest.approx(2 * 0.3048)
    res = build_custom_lot(CustomParcelRequest(format="traverse", traverse=tv2), p)
    assert "misclosure_accepted_by_user" in res.flags
    # compass rule adjustment closes the ring
    ring3, rep3 = run_traverse(tv.model_copy(update={"accept_misclosure": True, "adjust": "compass"}), p)
    assert len(ring3) == 5 and ring3[0] == ring3[-1]


def test_traverse_unit_defaults_to_profile_and_gallon_style_ambiguity_is_error():
    p = us_profile()
    legs = [TraverseLeg(bearing=b, distance=d) for b, d in ((90, 100), (180, 150), (270, 100), (0, 150))]   # no unit -> profile ft
    ring, rep = run_traverse(Traverse(start=(0, 0), legs=legs), p)
    assert rep.perimeter_m == pytest.approx(500 * 0.3048)
    with pytest.raises(AgentError) as ei:
        run_traverse(Traverse(start=(0, 0), legs=[TraverseLeg(bearing=0, distance=1, unit="FT")] * 4), p)
    assert ei.value.error_code == "PARCEL_UNIT_AMBIGUOUS"


def test_declination_and_convergence_rotate_bearings():
    p = us_profile(north_reference="magnetic", declination_deg=10.0)
    ring, _ = run_traverse(Traverse(start=(0, 0), legs=rect_legs(), accept_misclosure=True), p)
    # first leg is nominally magnetic east (090): grid bearing 100 -> dy negative
    (x0, y0), (x1, y1) = ring[0], ring[1]
    assert math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360 == pytest.approx(100.0, abs=1e-6)


def test_metric_traverse_in_metres():
    p = make_profile("Metric", horizontal_epsg=32633, system="metric")
    res = build_custom_lot(CustomParcelRequest(format="traverse", traverse=Traverse(
        start=(500000, 5400000), legs=rect_legs(20, 30, "m"))), p)
    assert res.lot_context.area_m2_calculated == pytest.approx(600.0)


def test_geojson_requires_crs_and_transforms():
    p = us_profile()
    gj = {"type": "Polygon", "coordinates": [[(-97.70, 30.30), (-97.699, 30.30), (-97.699, 30.301), (-97.70, 30.301), (-97.70, 30.30)]]}
    with pytest.raises(AgentError) as ei:
        build_custom_lot(CustomParcelRequest(format="geojson", geojson=gj), p)
    assert ei.value.error_code == "PARCEL_CRS_REQUIRED"
    res = build_custom_lot(CustomParcelRequest(format="geojson", geojson=gj, source_epsg=4326), p)
    assert 8000 < res.lot_context.area_m2_calculated < 11000          # ~96 m x 111 m
    gj2 = {**gj, "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::4326"}}}
    assert build_custom_lot(CustomParcelRequest(format="geojson", geojson=gj2), p).lot_context.mga_srid == 32614


def test_state_plane_feet_coordinates_converted_to_metric_working_crs():
    from app.jurisdiction.profile import CrsSettings, JurisdictionProfile, UnitSettings
    p = JurisdictionProfile(name="TX central", crs=CrsSettings(horizontal_epsg=2277, working_epsg=32614), units=UnitSettings(system="imperial_us"))
    pts = [(3100000.0, 10070000.0), (3100100.0, 10070000.0), (3100100.0, 10070150.0), (3100000.0, 10070150.0)]
    res = build_custom_lot(CustomParcelRequest(format="coordinates", coordinates=pts), p)
    assert res.lot_context.mga_srid == 32614
    assert res.lot_context.area_m2_calculated == pytest.approx(100 * 150 * (1200 / 3937) ** 2, rel=2e-3)


def test_dxf_polyline_units_must_be_known(tmp_path):
    p = us_profile()
    doc = ezdxf.new("R2018")
    doc.modelspace().add_lwpolyline([(0, 0), (100, 0), (100, 150), (0, 150)], close=True, dxfattribs={"layer": "LOT"})
    doc.header["$INSUNITS"] = 0
    f = tmp_path / "unitless.dxf"
    doc.saveas(f)
    with pytest.raises(AgentError) as ei:
        build_custom_lot(CustomParcelRequest(format="dxf", path=str(f), source_epsg=32614), p)
    assert ei.value.error_code == "PARCEL_UNIT_AMBIGUOUS"
    res = build_custom_lot(CustomParcelRequest(format="dxf", path=str(f), source_epsg=32614, dxf_units="ft"), p)
    assert res.lot_context.area_m2_calculated == pytest.approx(100 * 150 * 0.3048 ** 2)
    doc.header["$INSUNITS"] = 6
    f2 = tmp_path / "m.dxf"
    doc.saveas(f2)
    assert build_custom_lot(CustomParcelRequest(format="dxf", path=str(f2), source_epsg=32614), p).lot_context.area_m2_calculated == pytest.approx(15000)
    with pytest.raises(AgentError):       # confirmation contradicts the file
        build_custom_lot(CustomParcelRequest(format="dxf", path=str(f2), source_epsg=32614, dxf_units="ft"), p)


def test_front_edge_marking_and_invalid_polygon():
    p = us_profile()
    pts = [(600000.0, 3350000.0), (600030.0, 3350000.0), (600030.0, 3350045.0), (600000.0, 3350045.0)]
    res = build_custom_lot(CustomParcelRequest(format="coordinates", coordinates=pts, front_edges=[0]), p)
    fronts = [s for s in res.lot_context.segments if s.is_front]
    assert len(fronts) == 1 and fronts[0].distance_m == pytest.approx(30.0)
    bow = [(0, 0), (10, 10), (10, 0), (0, 10)]
    with pytest.raises(AgentError) as ei:
        build_custom_lot(CustomParcelRequest(format="coordinates", coordinates=bow, source_epsg=32614), p)
    assert ei.value.error_code == "PARCEL_INVALID"


def test_builtin_profile_cannot_use_custom_agent():
    from app.jurisdiction.profile import builtin_profile
    with pytest.raises(AgentError):
        Sa1CustomParcel(builtin_profile("NSW"))
