"""Stage 9: the stormwater helper (catchments, design rainfall, OSD sizing, infiltration trenches, overland flow, the routes).

Local coordinates are metres from the sample lot origin (see site_support): the lot is x 0 to 18 and y 0 to 34. The terrain is a SYNTHETIC plane. Every rule value, rainfall
value and soil value in this file is a SYNTHETIC TEST FIXTURE written for the test. None of it is an engineering value, a BoM value or a council value.
"""
from __future__ import annotations

import io
import json
import math
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

import site_support as H
from app.agents.requirements.models import Requirement, RequirementSet, Selectors, Source
from app.design import engine_limits as EL
from app.design.site_design import SiteDesign
from app.design.site_rules import SiteRules
from app.design.terrain_source import terrain_from_bundle
from app.report.knowledge import load_platform_default
from app.stormwater import catchment as CA
from app.stormwater import infiltration as INF
from app.stormwater import osd as OSD
from app.stormwater import overland as OVL
from app.stormwater import rainfall as RF
from app.stormwater.analyse import analyse
from app.stormwater.inputs import InfiltrationEntry, OverlandOptions, StormwaterInputs

E0, N0 = H.E0, H.N0
NOW = datetime(2026, 10, 15, 9, 0, tzinfo=timezone.utc)
SLOPE = lambda x, y: 100.0 + 0.05 * y + 0.0 * x           # noqa: E731
BACKEND = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------------------------------------------------------------- builders
def at(x, y):
    return [E0 + x, N0 + y]


def P(v):
    return {"value": v, "basis": "user"}


def bld(id_, ring, **params):
    o = {"id": id_, "type": "building", "geometry": {"kind": "polygon", "ring": [at(*p) for p in ring]}, "params": {k: P(v) for k, v in params.items()}}
    o["building"] = {"levels": [{"name": "GROUND", "elevation_m": 0.0, "rings": [[at(*p) for p in ring]]}], "frame": {"origin": at(0, 0)}, "exits": {"sewer": [], "water": []}}
    return o


def poly(id_, type_, ring, status="proposed", **params):
    return {"id": id_, "type": type_, "status": status, "geometry": {"kind": "polygon", "ring": [at(*p) for p in ring]}, "params": {k: P(v) for k, v in params.items()}}


def line(id_, type_, pts, status="proposed", **params):
    return {"id": id_, "type": type_, "status": status, "geometry": {"kind": "polyline", "pts": [at(*p) for p in pts]}, "params": {k: P(v) for k, v in params.items()}}


def pt(id_, type_, x, y, **params):
    return {"id": id_, "type": type_, "geometry": {"kind": "point", "p": at(x, y)}, "params": {k: P(v) for k, v in params.items()}}


def design(*objs) -> SiteDesign:
    return SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": list(objs)})


def row(key, value, unit=None, **status):
    return Requirement(key=key, applies_to=Selectors(jurisdiction="NSW", lga="Testshire"), value=value, unit=unit, status="resolved", extraction_method="table", confidence=1.0,
                       source=Source(document_title="Test Engineering Standard", authority="Testshire Council", page=3, section_ref="2.1", quote=f"{key} {value}"))


def rules(*rows, defaults=False) -> SiteRules:
    reqs = list(rows)
    if defaults:
        reqs = [Requirement.model_validate(r) for r in load_platform_default()] + reqs
    return SiteRules(RequirementSet(requirements=reqs, loaded=[Selectors(jurisdiction="NSW", lga="Testshire")]), "Testshire", "NSW")


NONE = rules()


@pytest.fixture(scope="module")
def terrain():
    return terrain_from_bundle(H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))


# SYNTHETIC TEST FIXTURE in the assumed BoM export layout. The values are NOT BoM data. The layout is the parser's assumption, not a confirmed BoM layout.
IFD_CSV = """SYNTHETIC TEST FIXTURE, NOT BOM DATA
Issued: 01/01/2016
Location label: Synthetic Test Point
Requested coordinate: Latitude -33.5000 S, Longitude 151.2000 E
Nearest grid cell: Latitude -33.5000 S, Longitude 151.2000 E
Intensity (mm/h)
Duration,50%,20%,10%,1%
5 min,120,140,150,200
10 min,80,95,100,140
20 min,50,56,60,85
30 min,38,43,45,66
60 min,25,28,30,45
"""


def ifd_table(raw=IFD_CSV):
    return RF.parse_ifd_csv(raw.encode(), "synthetic_ifd.csv", now=NOW)


def ifd_result(raw=IFD_CSV):
    return RF.IfdResult(ifd_table(raw), "OK", "", "UPLOAD")


ROOF_360 = [(0, 5), (18, 5), (18, 25), (0, 25)]            # 18 m by 20 m, 360 m2


def hand_design(*extra):
    """Roof 360 m2 with an OSD that holds 4.0 m3 (SYNTHETIC)."""
    return design(bld("b1", ROOF_360, drains_to_id="osd1"), poly("osd1", "osd_basin", [(2, 26), (6, 26), (6, 30), (2, 30)], storage_volume_m3=4.0, depth_m=0.5), pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"), *extra)


HAND = StormwaterInputs(runoff_coefficients={"roof": 1.0}, design_aep_pct=10, tc_post_min=5, osd_method="mass_balance_modified_rational")


# ---------------------------------------------------------------------------------------------------------------------------------- catchments
def sample_design(**kw):
    return design(bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)]), line("d1", "driveway", [(9, 0), (9, 8)], width_m=3, surface_kind="concrete"),
                  poly("l1", "landscape_area", [(0, 18), (18, 18), (18, 34), (0, 34)], surface_kind="turf"), pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"), *kw.get("extra", []))


def test_catchment_areas_by_surface_on_a_synthetic_design(terrain):
    r = analyse(sample_design(), NONE, terrain, StormwaterInputs(), now=NOW)
    post = r["catchment"]["comparison"]["post"]
    by = {b["surface"]: b for b in post["by_surface"]}
    assert by["roof"]["area_m2"] == pytest.approx(100.0) and by["concrete"]["area_m2"] == pytest.approx(24.0) and by["landscape_turf"]["area_m2"] == pytest.approx(288.0)
    assert post["area_m2"] == pytest.approx(412.0)
    un = r["catchment"]["comparison"]["post_unclassified"]
    assert un["lot_area_m2"] == pytest.approx(612.0) and un["unclassified_m2"] == pytest.approx(200.0)       # reported, never given a runoff behaviour
    roof = next(x for x in r["catchment"]["rows"] if x["object_id"] == "b1")
    assert "FOOTPRINT" in roof["area_basis"] and roof["runoff"]["basis"] == "UNRESOLVED"


def test_runoff_is_never_defaulted_and_the_calculation_names_what_is_missing(terrain):
    r = analyse(sample_design(), NONE, terrain, StormwaterInputs(), now=NOW)
    assert not r["catchment"]["comparison"]["post"]["complete"] and r["catchment"]["comparison"]["post"]["weighted_c"] is None
    keys = {m["key"] for m in r["missing"] if m["area"] == "RUNOFF"}
    assert keys == {"stormwater.runoff_coefficient.roof", "stormwater.runoff_coefficient.concrete", "landscape.runoff_coefficient.turf"}
    assert all(m["how"] for m in r["missing"])


def test_user_runoff_coefficients_give_c_times_a_with_the_user_basis(terrain):
    inp = StormwaterInputs(runoff_coefficients={"roof": 0.9, "concrete": 0.8, "landscape_turf": 0.3})
    r = analyse(sample_design(), NONE, terrain, inp, now=NOW)
    post = r["catchment"]["comparison"]["post"]
    assert post["complete"] and post["ca_m2"] == pytest.approx(100 * 0.9 + 24 * 0.8 + 288 * 0.3)
    assert {x["runoff"]["basis"] for x in r["catchment"]["rows"]} == {"USER"}


def test_runoff_from_a_requirement_key_carries_its_citation(terrain):
    rl = rules(row("stormwater.runoff_coefficient.roof", 0.95, "ratio"))
    r = analyse(sample_design(), rl, terrain, StormwaterInputs(), now=NOW)
    roof = next(x for x in r["catchment"]["rows"] if x["object_id"] == "b1")
    assert roof["runoff"]["value"] == 0.95 and roof["runoff"]["basis"] == "LGA RULE" and "Testshire" in roof["runoff"]["ref"]


def test_routing_roof_to_tank_overflow_to_osd_and_the_rest_to_the_discharge_point(terrain):
    d = design(bld("b1", ROOF_360), pt("tank", "rwt", 3, 3, roof_building_id="b1", connected_roof_area_m2=100, capacity_l=5000),
               poly("osd1", "osd_basin", [(2, 26), (6, 26), (6, 30), (2, 30)], storage_volume_m3=4.0),
               {"id": "of1", "type": "overflow_route", "geometry": {"kind": "polyline", "pts": [at(3, 3), at(4, 27)]}, "params": {"rwt_id": P("tank"), "osd_id": P("osd1")}},
               pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"),
               line("d1", "driveway", [(9, 0), (9, 5)], width_m=3, surface_kind="concrete", drains_to_id="osd1"))
    r = analyse(d, NONE, terrain, StormwaterInputs(runoff_coefficients={"roof": 1.0, "concrete": 0.9}), now=NOW)
    rows = {x["id"]: x for x in r["catchment"]["post_rows"]}
    tank = rows["b1:rwt:tank"]
    assert tank["area_m2"] == pytest.approx(100.0) and tank["route"]["to"] == "osd1" and tank["route"]["path"][:2] == ["tank", "osd1"] and "OVERFLOW ROUTE of1" in tank["route"]["basis"]
    direct = rows["b1:direct"]
    assert direct["area_m2"] == pytest.approx(260.0) and direct["route"]["to"] == "dp1" and direct["route"]["basis"].startswith("DEFAULT")
    drive = rows["d1"]
    assert drive["route"]["to"] == "osd1" and drive["route"]["basis"] == "LINKED"
    dests = {d["destination"]: d for d in r["catchment"]["routing"]}
    assert set(dests) == {"dp1"} and dests["dp1"]["area_m2"] == pytest.approx(360.0 + 15.0)      # every row ends at the legal point of discharge (through the OSD where linked)
    assert {tuple(x["path"]) for x in dests["dp1"]["rows"]} == {("tank", "osd1", "dp1"), ("osd1", "dp1"), ("dp1",)}


def test_no_discharge_point_leaves_the_route_unset_and_says_so(terrain):
    r = analyse(design(bld("b1", ROOF_360)), NONE, terrain, StormwaterInputs(runoff_coefficients={"roof": 1.0}), now=NOW)
    assert r["catchment"]["post_rows"][0]["route"]["to"] is None
    assert any("DISCHARGE" in m["what"] for m in r["missing"] if m["area"] == "ROUTING")


def test_pre_development_is_not_set_without_existing_surfaces_and_set_with_them(terrain):
    r = analyse(sample_design(), NONE, terrain, StormwaterInputs(), now=NOW)
    cmp = r["catchment"]["comparison"]
    assert cmp["pre_status"] == "NOT SET" and any(m["id"] == "pre_dev" for m in r["missing"])
    d = design(poly("old", "landscape_area", [(0, 0), (18, 0), (18, 34), (0, 34)], status="existing", surface_kind="turf"), bld("b1", ROOF_360))
    r2 = analyse(d, NONE, terrain, StormwaterInputs(runoff_coefficients={"landscape_turf": 0.3, "roof": 0.9}), now=NOW)
    pre = r2["catchment"]["comparison"]["pre"]
    assert r2["catchment"]["comparison"]["pre_status"] == "OK" and pre["area_m2"] == pytest.approx(612.0) and pre["ca_m2"] == pytest.approx(612 * 0.3)


# ---------------------------------------------------------------------------------------------------------------------------------- design rainfall
def test_ifd_parser_reads_the_synthetic_table_with_provenance():
    t = ifd_table()
    assert t.kind == RF.INTENSITY and t.durations_min == [5, 10, 20, 30, 60] and t.aeps_pct == [50, 20, 10, 1]
    p = t.provenance
    assert p["file_name"] == "synthetic_ifd.csv" and p["issued"] == "2016-01-01" and p["requested"] == {"lat": -33.5, "lon": 151.2} and len(p["sha256"]) == 64
    assert p["location_label"] == "Synthetic Test Point" and any("NOT CONFIRMED" in a for a in p["assumptions"])
    assert t.intensity(10, 10) == (100.0, "TABLE")
    v, how = t.intensity(15, 10)
    assert how == "INTERPOLATED" and 60 < v < 100
    assert t.intensity(10, 7) is None and t.intensity(2, 10) is None                       # no AEP column, outside the durations: nothing is made up


def test_ifd_parser_converts_ey_columns_and_depth_tables():
    raw = "Depth (mm)\nDuration,12EY,1EY\n1 hour,10,30\n2 hour,15,45\n"
    t = RF.parse_ifd_csv(raw.encode(), "d.csv", now=NOW)
    assert t.kind == RF.DEPTH and t.aeps_pct[0] == pytest.approx(100 * (1 - math.exp(-12)), rel=1e-6) and t.aeps_pct[1] == pytest.approx(100 * (1 - math.exp(-1)))
    assert t.intensity(60, t.aeps_pct[1])[0] == pytest.approx(30.0) and t.intensity(120, t.aeps_pct[1])[0] == pytest.approx(22.5)


@pytest.mark.parametrize("raw,code", [("", "EMPTY_FILE"), ("a,b\n1,2\n", "NO_HEADER"), ("Duration,10%,5%\nsoon,1,2\n", "UNITS_NOT_STATED"),
                                      ("Intensity\nDuration,10%,5%\nsoon,1,2\n", "NO_ROWS"), ("Intensity\nDuration,10%,5%\n5 min,1\n", "BAD_ROW"),
                                      ("Intensity\nDuration,10%,5%\n5 min,0,2\n", "BAD_VALUE"), ("Intensity\nDuration,10%,5%\n5 min,1,2\n5 min,1,2\n", "DUPLICATE_DURATION")])
def test_ifd_parser_refuses_what_it_cannot_read(raw, code):
    with pytest.raises(RF.RainfallError) as e:
        RF.parse_ifd_csv(raw.encode(), "x.csv", now=NOW)
    assert e.value.code == code and e.value.message == e.value.message.upper()


def test_declared_units_are_recorded_when_the_file_does_not_say():
    raw = "Duration,10%,5%\n5 min,100,120\n10 min,80,100\n"
    with pytest.raises(RF.RainfallError):
        RF.parse_ifd_csv(raw.encode(), "x.csv", now=NOW)
    t = RF.parse_ifd_csv(raw.encode(), "x.csv", declared_units=RF.INTENSITY, now=NOW)
    assert t.provenance["units_declared_by_user"] is True and any("DECLARED BY THE USER" in a for a in t.provenance["assumptions"])


def test_location_check_flags_a_distant_table_and_is_not_evaluated_without_a_site():
    t = ifd_table()
    assert RF.location_check(t, {"lat": -33.5, "lon": 151.2})["status"] == "OK"
    assert RF.location_check(t, {"lat": -33.0, "lon": 151.2})["status"] == "WARNING"
    assert RF.location_check(t, None)["status"] == "NOT EVALUATED"


class FakeClient:
    def __init__(self):
        self.calls = []

    def fetch_ifd_csv(self, lat, lon):
        self.calls.append((lat, lon))
        return IFD_CSV.encode()


def test_live_provider_is_unconfirmed_by_default_and_never_guesses():
    res = RF.LiveBomProvider().design_rainfall(-33.5, 151.2)
    assert res.table is None and res.status == "LIVE UNCONFIRMED" and "UNCONFIRMED" in res.message
    assert RF.LiveBomProvider().design_rainfall(None, None).status == "NOT AVAILABLE"


def test_live_provider_with_an_injected_client_parses_with_live_provenance():
    c = FakeClient()
    res = RF.LiveBomProvider(c, now=NOW).design_rainfall(-33.5, 151.2)
    assert c.calls == [(-33.5, 151.2)] and res.status == "OK" and res.table.provenance["source"].startswith("BOM 2016 IFD DESIGN RAINFALL, LIVE")


def test_uploaded_provider_without_an_upload_says_not_available():
    assert RF.UploadedIfdProvider(None).design_rainfall(None, None).status == "NOT AVAILABLE"


ARR_TXT = """SYNTHETIC TEST FIXTURE, NOT ARR DATA HUB OUTPUT
[INPUT_DATA]
Latitude,-33.5
Longitude,151.2
[LOSSES]
Storm Initial Losses (mm),10.5
Storm Continuing Losses (mm/h),2.5
Impervious Initial Loss (mm),1.0
Impervious Continuing Loss (mm/h),0
[TEMPORAL_PATTERNS]
Pattern,1
"""


def test_arr_export_is_parsed_with_provenance_and_marked_not_used_by_the_engine():
    a = RF.parse_arr_datahub(ARR_TXT.encode(), "arr.txt", now=NOW)
    assert a["storm_initial_loss_mm"] == 10.5 and a["storm_continuing_loss_mm_h"] == 2.5 and a["location"] == {"lat": -33.5, "lon": 151.2}
    assert a["temporal_pattern_sections"] == ["TEMPORAL_PATTERNS"] and "NOT USED" in a["provenance"]["used_by"] and len(a["provenance"]["sha256"]) == 64
    with pytest.raises(RF.RainfallError):
        RF.parse_arr_datahub(b"nothing here", "x.txt")


# ---------------------------------------------------------------------------------------------------------------------------------- OSD sizing
def test_mass_balance_on_a_hand_checkable_case():
    # sum(C x A) = 360 m2, Tc = 5 min, PSD = 2 L/s, AEP 10 percent. Qp = 360 x I / 3.6e6 = I / 10000 m3/s.
    # 5 min: Qp 15 L/s, S = 0.013 x (300 - 300 x 0.002 / 0.015) = 3.38.  10 min: Qp 10 L/s, S = 0.008 x (600 - 60) = 4.32.
    # 20 min: Qp 6 L/s, S = 0.004 x (1200 - 100) = 4.40.  30 min: Qp 4.5 L/s, S = 0.0025 x (1800 - 133.333) = 4.1667.  60 min: Qp 3 L/s, S = 0.001 x (3600 - 200) = 3.40.
    res = OSD.mass_balance(360.0, 5.0, 2.0, ifd_table(), 10.0, 1440.0)
    got = {r["duration_min"]: r["storage_m3"] for r in res["rows"]}
    assert got == pytest.approx({5: 3.38, 10: 4.32, 20: 4.40, 30: 4.1667, 60: 3.40}, abs=1e-3)
    assert res["critical"]["duration_min"] == 20 and res["critical"]["storage_m3"] == pytest.approx(4.4, abs=1e-6) and res["critical"]["qp_l_s"] == pytest.approx(6.0)
    assert not res["at_range_end"]


def test_mass_balance_gives_zero_when_the_inflow_never_exceeds_the_psd():
    res = OSD.mass_balance(36.0, 5.0, 50.0, ifd_table(), 10.0, 1440.0)
    assert res["critical"]["storage_m3"] == 0.0


def test_mass_balance_only_searches_durations_from_tc_to_the_limit():
    res = OSD.mass_balance(360.0, 12.0, 2.0, ifd_table(), 10.0, 30.0)
    assert [r["duration_min"] for r in res["rows"]] == [12, 20, 30]                       # Tc itself is searched (12 min is not a table row: INTERPOLATED)
    assert [r["intensity_method"] for r in res["rows"]] == ["INTERPOLATED", "TABLE", "TABLE"] and res["rows"][0]["is_tc"]
    assert OSD.mass_balance(360.0, 100.0, 2.0, ifd_table(), 10.0, 1440.0)["error"]


def test_the_full_osd_sizing_with_platform_default_psd_is_stamped(terrain):
    rl = rules(defaults=True)
    r = analyse(hand_design(), rl, terrain, HAND, ifd_stored=ifd_table().to_json(), now=NOW)
    o = r["osd"]
    assert o["status"] == "EVALUATED" and o["required_storage_m3"] == pytest.approx(4.4, abs=1e-3) and o["critical"]["duration_min"] == 20
    psd = next(i for i in o["inputs"] if i["symbol"] == "PSD")
    assert psd["value"] == 2.0 and psd["basis"] == "PLATFORM DEFAULT" and "PLATFORM DEFAULT" in psd["stamp"] and psd["key"] == "stormwater.psd_l_s"
    assert o["osd_required"]["value"] is True and "PLATFORM DEFAULT" in o["osd_required"]["stamp"]
    assert [s["id"] for s in o["steps"]] == ["inflow", "storage", "critical"] and all(s["formula"] for s in o["steps"])
    assert "S = (0.006000 - 0.002000)" in o["steps"][1]["result"]["text"]


def test_the_psd_rule_of_the_lga_wins_over_the_default(terrain):
    rl = rules(row("stormwater.psd_l_s", 5.0, "L/s"), defaults=True)
    r = analyse(hand_design(), rl, terrain, HAND, ifd_stored=ifd_table().to_json(), now=NOW)
    psd = next(i for i in r["osd"]["inputs"] if i["symbol"] == "PSD")
    assert psd["value"] == 5.0 and psd["basis"] == "LGA RULE" and "stamp" not in psd
    assert r["osd"]["required_storage_m3"] < 4.4


def test_a_psd_with_no_rule_and_no_default_is_unresolved_and_not_invented(terrain):
    r = analyse(hand_design(), rules(), terrain, HAND, ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["status"] == "NOT EVALUATED" and r["osd"]["required_storage_m3"] is None
    assert any(m["key"] == "stormwater.psd_l_s" for m in r["missing"])


def test_osd_sizing_is_not_evaluated_without_a_method_but_shows_the_resolved_inputs(terrain):
    inp = StormwaterInputs(runoff_coefficients={"roof": 1.0}, design_aep_pct=10, tc_post_min=5)
    r = analyse(hand_design(), rules(defaults=True), terrain, inp, ifd_stored=ifd_table().to_json(), now=NOW)
    o = r["osd"]
    assert o["status"] == "NOT EVALUATED" and "METHOD" in o["message"] and o["required_storage_m3"] is None and o["steps"] == []
    shown = {i["symbol"]: i for i in o["inputs"]}
    assert shown["PSD"]["value"] == 2.0 and shown["AEP"]["value"] == 10 and shown["Tc"]["value"] == 5 and shown["sum(C x A)"]["value"] == pytest.approx(360.0)
    miss = next(m for m in r["missing"] if m["id"] == "osd_method")
    assert miss["key"] == "stormwater.osd_method" and "mass_balance_modified_rational" in miss["how"]


def test_the_method_comes_from_the_requirement_key_when_the_user_gives_none(terrain):
    rl = rules(row("stormwater.osd_method", "mass_balance_modified_rational"), defaults=True)
    inp = StormwaterInputs(runoff_coefficients={"roof": 1.0}, design_aep_pct=10, tc_post_min=5)
    r = analyse(hand_design(), rl, terrain, inp, ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["method"]["basis"] == "LGA RULE" and r["osd"]["status"] == "EVALUATED"
    odd = rules(row("stormwater.osd_method", "some local procedure"), defaults=True)
    r2 = analyse(hand_design(), odd, terrain, inp, ifd_stored=ifd_table().to_json(), now=NOW)
    assert r2["osd"]["status"] == "NOT EVALUATED" and any("NOT ONE THIS TOOL CAN RUN" in m["what"] for m in r2["missing"])


def test_osd_is_not_evaluated_without_design_rainfall_and_names_the_upload(terrain):
    r = analyse(hand_design(), rules(defaults=True), terrain, HAND, now=NOW)
    assert r["osd"]["status"] == "NOT EVALUATED" and r["rainfall"]["status"] == "NOT AVAILABLE"
    m = next(m for m in r["osd"]["missing"] if m["id"] == "ifd")
    assert "Upload" in m["how"]


@pytest.mark.parametrize("field", ["design_aep_pct", "tc_post_min", "runoff_coefficients"])
def test_each_missing_input_makes_the_sizing_not_evaluated(terrain, field):
    data = HAND.model_dump()
    data[field] = {} if field == "runoff_coefficients" else None
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**data), ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["status"] == "NOT EVALUATED" and r["osd"]["required_storage_m3"] is None


def test_aep_that_is_not_a_table_column_is_not_evaluated(terrain):
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**{**HAND.model_dump(), "design_aep_pct": 7}), ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["status"] == "NOT EVALUATED" and any("NO COLUMN FOR AEP 7" in m["what"] for m in r["osd"]["missing"])


def test_user_site_storage_requirement_needs_no_rainfall(terrain):
    inp = StormwaterInputs(osd_method="user_ssr", ssr_m3=6.5)
    r = analyse(hand_design(), rules(defaults=True), terrain, inp, now=NOW)
    assert r["osd"]["status"] == "EVALUATED" and r["osd"]["required_storage_m3"] == 6.5 and r["osd"]["steps"][0]["id"] == "ssr"
    assert r["osd"]["comparison"]["status"] == "PROVIDED STORAGE IS SHORT" and r["osd"]["comparison"]["difference_m3"] == pytest.approx(-2.5)


def test_ssr_per_hectare_needs_the_area_basis_and_uses_it(terrain):
    base = dict(osd_method="user_ssr", ssr_m3_per_ha=100.0)
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**base), now=NOW)
    assert r["osd"]["required_storage_m3"] is None and any(m["id"] == "ssr_area_basis" for m in r["missing"])
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**base, ssr_area_basis="lot"), now=NOW)
    assert r["osd"]["required_storage_m3"] == pytest.approx(100.0 * 612.0 / 10000.0)
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**base, ssr_area_basis="osd_catchment", runoff_coefficients={"roof": 1.0}), now=NOW)
    assert r["osd"]["required_storage_m3"] == pytest.approx(100.0 * 360.0 / 10000.0)


def test_provided_storage_is_compared_and_the_tank_detention_follows_the_rule(terrain):
    tank = pt("tank", "rwt", 3, 3, roof_building_id="b1", connected_roof_area_m2=100, capacity_l=5000, detention_volume_l=1000)
    of = {"id": "of1", "type": "overflow_route", "geometry": {"kind": "polyline", "pts": [at(3, 3), at(4, 27)]}, "params": {"rwt_id": P("tank"), "osd_id": P("osd1")}}
    d = hand_design(tank, of)                                   # the tank overflows to the OSD, so the whole roof still reaches it
    base = rules(defaults=True)
    r = analyse(d, base, terrain, HAND, ifd_stored=ifd_table().to_json(), now=NOW)
    c = r["osd"]["comparison"]
    assert c["provided_m3"] == pytest.approx(4.0) and c["status"] == "PROVIDED STORAGE IS SHORT" and "UNRESOLVED" in r["osd"]["provided"]["tank_note"]
    # excluded from the detention volume: the tank detention is not counted; not excluded: it is counted
    r = analyse(d, rules(row("stormwater.rainwater_tank_excluded_from_detention_volume", False), defaults=True), terrain, HAND, ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["comparison"]["provided_m3"] == pytest.approx(5.0) and r["osd"]["comparison"]["status"] == "PROVIDED STORAGE IS ENOUGH"
    r = analyse(d, rules(row("stormwater.rainwater_tank_excluded_from_detention_volume", True), defaults=True), terrain, HAND, ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["comparison"]["provided_m3"] == pytest.approx(4.0)


def test_orifice_is_given_only_with_a_resolved_discharge_coefficient(terrain):
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**{**HAND.model_dump(), "orifice_head_m": 1.0}), ifd_stored=ifd_table().to_json(), now=NOW)
    o = r["osd"]["orifice"]
    assert o["status"] == "NOT EVALUATED" and o["diameter_mm"] is None and any(m["key"] == "stormwater.orifice_discharge_coefficient" for m in o["missing"])
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**{**HAND.model_dump(), "orifice_head_m": 1.0, "discharge_coefficient": 0.6}), ifd_stored=ifd_table().to_json(), now=NOW)
    o = r["osd"]["orifice"]
    want = math.sqrt(4 * 0.002 / (math.pi * 0.6 * math.sqrt(2 * 9.81 * 1.0))) * 1000
    assert o["status"] == "EVALUATED" and o["diameter_mm"] == pytest.approx(want, abs=0.01) and "USER" in {i["basis"] for i in o["inputs"]}


def test_orifice_without_a_head_is_not_evaluated(terrain):
    r = analyse(hand_design(), rules(defaults=True), terrain, StormwaterInputs(**{**HAND.model_dump(), "discharge_coefficient": 0.6}), ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["orifice"]["status"] == "NOT EVALUATED" and any(m["id"] == "head" for m in r["osd"]["orifice"]["missing"])


def test_orifice_head_to_the_invert_is_solved_by_iteration():
    d, h = OSD.orifice_diameter_mm(2.0, 0.6, 1.0, None)
    assert h == pytest.approx(1.0 - d / 2000.0, abs=1e-6)
    q = 0.6 * math.pi * (d / 2000.0) ** 2 * math.sqrt(2 * 9.81 * h)
    assert q == pytest.approx(0.002, rel=1e-6)
    assert OSD.orifice_diameter_mm(2.0, 0.6, 0.0, None) is None and OSD.orifice_diameter_mm(2.0, 0.0, 1.0, None) is None


def test_osd_not_required_by_the_rule_is_stated_and_nothing_is_sized(terrain):
    r = analyse(hand_design(), rules(row("stormwater.osd_required", False), defaults=True), terrain, HAND, ifd_stored=ifd_table().to_json(), now=NOW)
    assert r["osd"]["status"] == "NOT REQUIRED" and r["osd"]["required_storage_m3"] is None


def test_surfaces_that_bypass_the_osd_are_listed_not_deducted(terrain):
    d = hand_design(line("d1", "driveway", [(9, 0), (9, 4)], width_m=3, surface_kind="concrete"))
    d = design(*[o.model_dump(by_alias=True, mode="json") for o in d.objects])
    r = analyse(d, rules(defaults=True), terrain, StormwaterInputs(**{**HAND.model_dump(), "runoff_coefficients": {"roof": 1.0, "concrete": 0.9}}), ifd_stored=ifd_table().to_json(), now=NOW)
    # the roof is linked to the OSD; the driveway is not, so it goes to the discharge point, is listed as a bypass and is NOT part of the sized catchment
    assert r["osd"]["status"] == "EVALUATED" and [b["object_id"] for b in r["osd"]["catchment"]["bypass"]] == ["d1"]
    assert r["osd"]["catchment"]["ca_m2"] == pytest.approx(360.0) and "NOT DEDUCTED" in r["osd"]["catchment"]["bypass_note"]


# ---------------------------------------------------------------------------------------------------------------------------------- infiltration
def trench(**kw):
    p = dict(width_m=1.0, depth_m=1.0, void_ratio=0.4)
    p.update(kw)
    return line("t1", "infiltration_trench", [(2, 28), (12, 28)], **p)


def test_trench_emptying_time_from_the_trench_object_and_the_site_test(terrain):
    d = design(trench(infiltration_rate_mm_h=36, infiltration_basis="site_test", test_date="2026-09-30", test_method="Synthetic falling head"))
    r = analyse(d, rules(row("infiltration.max_emptying_time_h", 24.0, "h"), defaults=True), terrain, StormwaterInputs(), now=NOW)
    t = r["infiltration"]["trenches"][0]
    # V = 10 x 1 x 1 x 0.4 = 4 m3, A = 10 m2, q = 0.036 m/h, t = 4 / (0.036 x 10) = 11.11 h
    assert t["volume_m3"] == pytest.approx(4.0) and t["emptying_time_h"] == pytest.approx(11.1111, abs=1e-3) and t["check"]["status"] == "PASS"
    assert "30/09/2026" in t["rate"]["ref"] and t["rate_label"] == ""
    assert t["steps"][1]["result"]["text"].endswith("11.11 h")


def test_trench_emptying_time_fails_against_a_lower_limit_and_is_reported_without_a_limit(terrain):
    d = design(trench(infiltration_rate_mm_h=36, infiltration_basis="site_test", test_date="2026-09-30", test_method="Synthetic falling head"))
    r = analyse(d, rules(row("infiltration.max_emptying_time_h", 6.0, "h"), defaults=True), terrain, StormwaterInputs(), now=NOW)
    assert r["infiltration"]["trenches"][0]["check"]["status"] == "FAIL"
    r = analyse(d, rules(defaults=True), terrain, StormwaterInputs(), now=NOW)
    t = r["infiltration"]["trenches"][0]
    assert t["emptying_time_h"] == pytest.approx(11.11, abs=0.01) and t["check"]["status"] == "NOT EVALUATED" and any(m["key"] == "infiltration.max_emptying_time_h" for m in r["missing"])


def test_trench_is_not_evaluated_without_a_rate(terrain):
    r = analyse(design(trench()), rules(defaults=True), terrain, StormwaterInputs(), now=NOW)
    t = r["infiltration"]["trenches"][0]
    assert t["status"] == "NOT EVALUATED" and t["emptying_time_h"] is None and t["volume_m3"] == pytest.approx(4.0)
    assert any("NO INFILTRATION RATE" in m["what"] for m in r["missing"]) and r["infiltration"]["status"] == "NOT EVALUATED"


def test_site_test_from_the_panel_needs_the_date_and_the_method(terrain):
    d = design(trench())
    bad = StormwaterInputs(infiltration=InfiltrationEntry(source="site_test", rate_mm_h=36))
    r = analyse(d, rules(defaults=True), terrain, bad, now=NOW)
    assert r["infiltration"]["trenches"][0]["emptying_time_h"] is None and "THE TEST DATE" in r["infiltration"]["rate"]["ref"] and "THE TEST METHOD" in r["infiltration"]["rate"]["ref"]
    ok = StormwaterInputs(infiltration=InfiltrationEntry(source="site_test", rate_mm_h=36, test_date="2026-09-30", test_method="Synthetic"))
    r = analyse(d, rules(defaults=True), terrain, ok, now=NOW)
    assert r["infiltration"]["trenches"][0]["emptying_time_h"] == pytest.approx(11.11, abs=0.01)


def test_an_indicative_rate_is_labelled_site_testing_required(terrain):
    d = design(trench())
    inp = StormwaterInputs(infiltration=InfiltrationEntry(source="indicative", rate_mm_h=36, source_note="Synthetic desktop table"))
    r = analyse(d, rules(defaults=True), terrain, inp, now=NOW)
    t = r["infiltration"]["trenches"][0]
    assert t["rate_label"] == "INDICATIVE, SITE TESTING REQUIRED" and r["infiltration"]["label"] == "INDICATIVE, SITE TESTING REQUIRED" and "INDICATIVE" in t["rate"]["ref"]
    assert t["emptying_time_h"] == pytest.approx(11.11, abs=0.01)
    r = analyse(d, rules(defaults=True), terrain, StormwaterInputs(infiltration=InfiltrationEntry(source="indicative", rate_mm_h=36)), now=NOW)
    assert r["infiltration"]["trenches"][0]["emptying_time_h"] is None


# SYNTHETIC TEST FIXTURE: a soil table in the format the parser reads. Not real soil data.
SOIL_CSV = "soil_unit,rate_mm_h,description\nSYN-A,36,synthetic sand\nSYN-B,2.5,synthetic clay\n"


def test_soil_table_is_parsed_with_provenance_and_the_selected_row_is_indicative(terrain):
    soil = RF.parse_soil_table(SOIL_CSV.encode(), "soil.csv", source="Synthetic soil atlas", source_date="2020-05-01", now=NOW)
    assert soil["label"] == "INDICATIVE, SITE TESTING REQUIRED" and soil["provenance"]["source_date"] == "2020-05-01" and [r["soil_unit"] for r in soil["rows"]] == ["SYN-A", "SYN-B"]
    inp = StormwaterInputs(infiltration=InfiltrationEntry(source="soil_table", soil_unit="SYN-A"))
    r = analyse(design(trench()), rules(defaults=True), terrain, inp, soil_stored=soil, now=NOW)
    t = r["infiltration"]["trenches"][0]
    assert t["emptying_time_h"] == pytest.approx(11.11, abs=0.01) and "INDICATIVE, SITE TESTING REQUIRED" in t["rate"]["ref"] and "SYNTHETIC SOIL ATLAS" in t["rate"]["ref"]
    none = analyse(design(trench()), rules(defaults=True), terrain, inp, now=NOW)
    assert none["infiltration"]["trenches"][0]["emptying_time_h"] is None and any("SOIL TABLE" in m["what"] for m in none["missing"])


def test_soil_table_refuses_a_missing_source_and_bad_rows():
    with pytest.raises(RF.RainfallError) as e:
        RF.parse_soil_table(SOIL_CSV.encode(), "soil.csv", source=" ", source_date=None)
    assert e.value.code == "SOURCE_REQUIRED"
    for raw, code in (("soil_unit,rate_mm_h\nA,x\n", "BAD_ROW"), ("soil_unit\nA\n", "NO_RATE"), ("a,b\n1,2\n", "NO_SOIL_UNIT"), ("soil_unit,rate_mm_h\nA,1\nA,2\n", "DUPLICATE_SOIL")):
        with pytest.raises(RF.RainfallError) as e:
            RF.parse_soil_table(raw.encode(), "s.csv", source="x", source_date=None)
        assert e.value.code == code


def test_emptying_time_function():
    assert INF.emptying_time_h(4.0, 10.0, 36.0) == pytest.approx(4.0 / (0.036 * 10.0))
    assert INF.emptying_time_h(4.0, 10.0, 0.0) is None


# ---------------------------------------------------------------------------------------------------------------------------------- overland flow
def _edge(shape):
    e = np.zeros(shape, bool)
    e[0, :] = e[-1, :] = e[:, 0] = e[:, -1] = True
    return e


def test_d8_on_a_synthetic_tilted_plane_runs_straight_down_the_slope():
    ny, nx, cell = 40, 40, 0.5
    X, _ = np.meshgrid((np.arange(nx) + 0.5) * cell, (np.arange(ny) + 0.5) * cell)
    z = 10.0 - 0.1 * X                                           # falls towards +x
    valid = np.ones((ny, nx), bool)
    s = OVL.solve(z, valid, valid & _edge(z.shape), np.full((ny, nx), cell * cell), cell, 0.0, 0.0, threshold_m2=2.0)
    recv = s["recv"].reshape(ny, nx)
    j, i = 10, 10
    assert recv[j, i] == j * nx + (i + 1)                          # every interior cell drains to its +x neighbour
    assert s["acc"][:, -1].min() == pytest.approx(nx * cell * cell)          # each row collects its whole length: 40 cells x 0.25 m2
    assert s["depressions"] == []                                  # a plane has no depression
    assert all(p["points"][0][0] < p["points"][-1][0] for p in s["paths"]["paths"])


def test_d8_on_a_synthetic_pit_detects_and_reports_the_ponding():
    ny, nx, cell = 40, 40, 0.5
    X, Y = np.meshgrid((np.arange(nx) + 0.5) * cell, (np.arange(ny) + 0.5) * cell)
    z = 10.0 - 0.02 * X
    pit = (np.hypot(X - 10.0, Y - 10.0) < 1.5)
    z = np.where(pit, z - 0.4, z)
    valid = np.ones((ny, nx), bool)
    s = OVL.solve(z, valid, valid & _edge(z.shape), np.full((ny, nx), cell * cell), cell, 0.0, 0.0, threshold_m2=2.0)
    assert len(s["depressions"]) == 1
    p = s["depressions"][0]
    assert p["max_depth_m"] > 0.3 and p["area_m2"] == pytest.approx(pit.sum() * cell * cell, rel=0.6) and p["volume_m3"] > 0 and len(p["outline"]) >= 4
    assert abs(p["centroid"][0] - 10.0) < 1.0 and abs(p["centroid"][1] - 10.0) < 1.0
    # the ground is not silently filled: the input levels are untouched, and the paths still reach an outlet across the pond
    assert z[pit].min() < 10.0 - 0.02 * 10.0 - 0.3
    assert s["acc"].max() > 5.0 and np.isfinite(s["f"][pit]).all()


def test_an_enclosed_flat_pad_is_not_a_pit():
    ny, nx, cell = 30, 30, 0.5
    z = np.full((ny, nx), 5.0)
    valid = np.ones((ny, nx), bool)
    s = OVL.solve(z, valid, valid & _edge(z.shape), np.full((ny, nx), cell * cell), cell, 0.0, 0.0)
    assert s["depressions"] == []


def test_overland_with_the_design_building_as_an_obstacle_and_the_terrain_label(terrain):
    d = design(bld("b1", [(4, 8), (14, 8), (14, 18), (4, 18)]))
    r = analyse(d, NONE, terrain, StormwaterInputs(), overland=OverlandOptions(enabled=True, threshold_m2=10.0), now=NOW)
    o = r["overland"]
    assert o["status"] == "EVALUATED" and o["labels"] == [terrain.status, "FLOW PATHS INDICATIVE, NOT A FLOOD STUDY"] and "INDICATIVE 5 M DEM" in o["terrain_status"]
    assert o["obstacles"] == [{"object_id": "b1", "kind": "BUILDING", "cells": o["obstacles"][0]["cells"]}] and o["grid"]["obstacle_cells"] == pytest.approx(400, abs=40)
    assert o["paths"] and o["parameters"]["notes"]["threshold_m2"].startswith("DISPLAY PARAMETER")
    ex = analyse(d, NONE, terrain, StormwaterInputs(), overland=OverlandOptions(enabled=True, surface="existing"), now=NOW)["overland"]
    assert ex["grid"]["obstacle_cells"] == 0 and any("EXISTING GROUND ONLY" in n for n in ex["notes"])


def test_overland_flows_from_the_high_side_to_the_street_on_the_synthetic_terrain(terrain):
    o = analyse(design(), NONE, terrain, StormwaterInputs(), overland=OverlandOptions(enabled=True, threshold_m2=20.0), now=NOW)["overland"]
    longest = max(o["paths"], key=lambda p: p["max_area_m2"])
    assert longest["points"][0][1] > longest["points"][-1][1]              # the terrain falls towards the street (y decreasing)
    assert o["depressions"] == []


def test_a_grading_area_sets_a_flat_pad_and_the_batters_are_stated_as_not_applied(terrain):
    g = poly("g1", "grading_area", [(4, 10), (14, 10), (14, 20), (4, 20)], target_level_m=101.0, surface_kind="turf")
    o = analyse(design(g), NONE, terrain, StormwaterInputs(), overland=OverlandOptions(enabled=True), now=NOW)["overland"]
    assert o["graded"] and o["graded"][0]["mode"] == "level" and any("BATTERS ARE NOT APPLIED" in n for n in o["notes"])


def test_overland_flow_performance_60_by_60_at_half_a_metre_under_two_seconds():
    n, cell = 120, 0.5
    X, Y = np.meshgrid((np.arange(n) + 0.5) * cell, (np.arange(n) + 0.5) * cell)
    z = 20.0 - 0.03 * Y + 0.6 * np.sin(X / 5.0) * np.cos(Y / 7.0)             # a synthetic undulating slope with real depressions
    valid = np.ones((n, n), bool)
    t0 = time.perf_counter()
    s = OVL.solve(z, valid, valid & _edge(z.shape), np.full((n, n), cell * cell), cell, 0.0, 0.0)
    dt = time.perf_counter() - t0
    assert dt < 2.0, dt
    assert s["depressions"]


def test_overland_caps_are_enforced():
    with pytest.raises(EL.EngineLimitError):
        EL.check_overland(60, 60, 0.1)
    with pytest.raises(EL.EngineLimitError):
        EL.check_overland(2000, 2000, 0.5)
    assert EL.check_overland(60, 60, 0.5) == (121, 121)


def test_overland_without_terrain_is_not_evaluated():
    o = OVL.analyse(design(), None, None, __import__("app.design.param_basis", fromlist=["Reader"]).Reader(None))
    assert o["status"] == "NOT EVALUATED" and o["missing"]


# ---------------------------------------------------------------------------------------------------------------------------------- wording
DASH = re.compile("[–—]")


def _strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from _strings(k)
            yield from _strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v)


def test_no_em_or_en_dashes_in_the_sources_or_the_results(terrain):
    for p in list((BACKEND / "app" / "stormwater").glob("*.py")) + [BACKEND / "app" / "api" / "stormwater.py"]:
        assert not DASH.search(p.read_text(encoding="utf-8")), p.name
    d = hand_design(trench(), pt("tank", "rwt", 3, 3, roof_building_id="b1", connected_roof_area_m2=100, capacity_l=5000))
    r = analyse(d, rules(defaults=True), terrain, StormwaterInputs(**{**HAND.model_dump(), "discharge_coefficient": 0.6, "orifice_head_m": 1.0}), ifd_stored=ifd_table().to_json(),
                overland=OverlandOptions(enabled=True), now=NOW)
    bad = [s for s in _strings(r) if DASH.search(s)]
    assert not bad, bad[:3]
    assert not [s for s in _strings(r["missing"]) if "  " in s]


# ---------------------------------------------------------------------------------------------------------------------------------- routes
@pytest.fixture
def api(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.api.app import create_app
    from app.api.settings import Settings
    from app.api.site_design import site_design_access, site_rules_dep
    from app.design import terrain_source as TS
    monkeypatch.delenv("SCENE_BUNDLE_DIR", raising=False)
    TS.clear_cache()
    app = create_app(Settings(export_dir=str(tmp_path)), pool=object())
    app.dependency_overrides[site_design_access] = lambda: uuid.uuid4()
    app.dependency_overrides[site_rules_dep] = lambda: rules(defaults=True)
    pid = uuid.uuid4()
    H.write_bundle(tmp_path, pid, H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
    return TestClient(app), pid, app


def dump(d: SiteDesign) -> dict:
    return json.loads(d.model_dump_json(by_alias=True))


def test_analyse_route_uses_the_uploaded_ifd_and_the_saved_entries(api):
    c, pid, _ = api
    up = c.post(f"/projects/{pid}/stormwater/ifd", files={"file": ("ifd.csv", IFD_CSV.encode(), "text/csv")})
    assert up.status_code == 201 and up.json()["provenance"]["file_name"] == "ifd.csv"
    assert c.put(f"/projects/{pid}/stormwater/inputs", json=HAND.model_dump(mode="json")).status_code == 200
    r = c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(hand_design())})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    out = r.json()
    assert out["schema"] == "stormwater.v1" and out["osd"]["required_storage_m3"] == pytest.approx(4.4, abs=1e-3) and out["rainfall"]["table"]["provenance"]["file_name"] == "ifd.csv"
    assert out["rainfall"]["location"]["status"] in ("OK", "WARNING", "NOT EVALUATED")
    data = c.get(f"/projects/{pid}/stormwater/data").json()
    assert data["ifd"]["provenance"]["issued"] == "2016-01-01" and data["inputs"]["design_aep_pct"] == 10
    # entries in the request win over the saved ones
    r2 = c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(hand_design()), "inputs": {"osd_method": "user_ssr", "ssr_m3": 3.0}}).json()
    assert r2["osd"]["required_storage_m3"] == 3.0
    assert c.delete(f"/projects/{pid}/stormwater/ifd").json() == {"deleted": True}
    assert c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(hand_design())}).json()["rainfall"]["status"] == "NOT AVAILABLE"


def test_analyse_route_rejects_bad_bodies_and_overland_over_the_cap(api):
    c, pid, _ = api
    assert c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(design()), "inputs": {"psd_l_s": -1}}).status_code == 422
    assert c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(design()), "extra": 1}).status_code == 422
    assert c.post(f"/projects/{pid}/stormwater/analyse", content=b"not json").status_code == 422
    big = c.post(f"/projects/{pid}/stormwater/analyse", content=b"x" * (6 * 1024 * 1024), headers={"content-type": "application/json"})
    assert big.status_code == 413
    # a design that is long enough to need a raster over the cap: 1000 m of lot at 0.25 m is over 400,000 cells
    wide = poly("w", "landscape_area", [(0, 0), (900, 0), (900, 900), (0, 900)], surface_kind="turf")
    r = c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(design(wide)), "overland": {"enabled": True, "cell_m": 0.25}})
    assert r.status_code in (200, 422)
    if r.status_code == 422:
        assert r.json()["code"] in ("OVERLAND_INPUT_TOO_LARGE", "ENGINE_INPUT_TOO_LARGE")


def test_overland_over_the_cell_cap_is_422_through_the_route(api, monkeypatch):
    c, pid, _ = api
    monkeypatch.setattr(EL, "MAX_OVERLAND_CELLS", 1000)
    r = c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(design(bld("b1", ROOF_360))), "overland": {"enabled": True}})
    assert r.status_code == 422 and r.json()["code"] == "OVERLAND_INPUT_TOO_LARGE" and "CELLS" in r.json()["message"]


def test_ifd_upload_parse_errors_are_422_and_nothing_is_stored(api):
    c, pid, _ = api
    r = c.post(f"/projects/{pid}/stormwater/ifd", files={"file": ("bad.csv", b"hello", "text/csv")})
    assert r.status_code == 422 and r.json()["code"] == "NO_HEADER"
    assert c.get(f"/projects/{pid}/stormwater/data").json()["ifd"] is None
    assert c.post(f"/projects/{pid}/stormwater/ifd", files={"file": ("e.csv", b"", "text/csv")}).json()["code"] == "EMPTY_FILE"
    ok = c.post(f"/projects/{pid}/stormwater/ifd", data={"declared_units": "intensity_mm_h"}, files={"file": ("u.csv", b"Duration,10%,5%\n5 min,100,120\n10 min,80,100\n", "text/csv")})
    assert ok.status_code == 201


def test_uploads_over_the_cap_are_413(api):
    c, pid, _ = api
    r = c.post(f"/projects/{pid}/stormwater/ifd", files={"file": ("big.csv", b"a" * (3 * 1024 * 1024), "text/csv")})
    assert r.status_code == 413 and r.json()["code"] == "FILE_TOO_LARGE"
    r = c.post(f"/projects/{pid}/stormwater/soil", data={"source": "x"}, files={"file": ("big.csv", b"a" * (3 * 1024 * 1024), "text/csv")})
    assert r.status_code == 413


def test_arr_and_soil_uploads_are_stored_with_provenance(api):
    c, pid, _ = api
    a = c.post(f"/projects/{pid}/stormwater/arr", files={"file": ("arr.txt", ARR_TXT.encode(), "text/plain")})
    assert a.status_code == 201 and a.json()["storm_initial_loss_mm"] == 10.5
    assert c.post(f"/projects/{pid}/stormwater/arr", files={"file": ("x.txt", b"zzz", "text/plain")}).status_code == 422
    s = c.post(f"/projects/{pid}/stormwater/soil", data={"source": "Synthetic atlas", "source_date": "01/05/2020"}, files={"file": ("soil.csv", SOIL_CSV.encode(), "text/csv")})
    assert s.status_code == 201 and s.json()["provenance"]["source_date"] == "2020-05-01"
    assert c.post(f"/projects/{pid}/stormwater/soil", data={"source": "x", "source_date": "someday"}, files={"file": ("soil.csv", SOIL_CSV.encode(), "text/csv")}).json()["code"] == "BAD_DATE"
    assert c.post(f"/projects/{pid}/stormwater/soil", files={"file": ("soil.csv", SOIL_CSV.encode(), "text/csv")}).status_code == 422       # the source is required
    d = c.get(f"/projects/{pid}/stormwater/data").json()
    assert d["arr"]["provenance"]["file_name"] == "arr.txt" and d["soil"]["label"] == "INDICATIVE, SITE TESTING REQUIRED"
    r = c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(design(trench())), "inputs": {"infiltration": {"source": "soil_table", "soil_unit": "SYN-A"}}}).json()
    assert r["infiltration"]["trenches"][0]["emptying_time_h"] == pytest.approx(11.11, abs=0.01) and r["rainfall"]["arr"]["storm_initial_loss_mm"] == 10.5


def test_live_source_is_unconfirmed_without_a_client_and_works_with_an_injected_one(api):
    from app.api.stormwater import live_ifd_client
    c, pid, app = api
    body = {"design": dump(hand_design()), "inputs": HAND.model_dump(mode="json"), "rainfall_source": "live"}
    r = c.post(f"/projects/{pid}/stormwater/analyse", json=body).json()
    assert r["rainfall"]["status"] in ("LIVE UNCONFIRMED", "NOT AVAILABLE") and r["osd"]["status"] == "NOT EVALUATED"
    fake = FakeClient()
    app.dependency_overrides[live_ifd_client] = lambda: fake
    r = c.post(f"/projects/{pid}/stormwater/analyse", json=body).json()
    assert fake.calls and r["rainfall"]["status"] == "OK" and r["osd"]["required_storage_m3"] == pytest.approx(4.4, abs=1e-3)


def test_routes_need_the_same_access_as_the_other_site_design_routes():
    from app.api.app import create_app
    from app.api.settings import Settings
    from app.api.site_design import site_design_access
    app = create_app(Settings(export_dir="/tmp/none"), pool=object())
    for route in app.routes:
        if getattr(route, "path", "").startswith("/projects/{project_id}/stormwater"):
            deps = {d.call for d in route.dependant.dependencies}
            assert site_design_access in deps or any(getattr(d, "dependencies", None) and any(x.call is site_design_access for x in d.dependencies) for d in route.dependant.dependencies), route.path
