"""Stage 9 review fixes. Each test here fails on the code as it was committed in e573227 (stage 9: stormwater helper).

Every value is a SYNTHETIC TEST FIXTURE (see test_stage9_stormwater.py). None is an engineering value, a BoM value or a council value.
"""
from __future__ import annotations

import math
import time

import numpy as np
import pytest
from shapely.geometry import box

import site_support as H
from app.design import engine_limits as EL
from app.design.param_basis import Reader
from app.design.terrain_source import terrain_from_bundle
from app.stormwater import osd as OSD
from app.stormwater import overland as OVL
from app.stormwater import rainfall as RF
from app.stormwater import store as ST
from app.stormwater.analyse import analyse
from app.stormwater.inputs import InfiltrationEntry, OverlandOptions, StormwaterInputs
from test_stage9_stormwater import (ARR_TXT, HAND, IFD_CSV, NONE, NOW, ROOF_360, SOIL_CSV, api, at, bld, design, dump, hand_design, ifd_table, line, P, poly, pt, row, rules, terrain,  # noqa: F401
                                     trench)

ROOF_300 = [(0, 5), (15, 5), (15, 25), (0, 25)]            # 15 m by 20 m, 300 m2
IFD = ifd_table().to_json()
INP = StormwaterInputs(**{**HAND.model_dump(), "runoff_coefficients": {"roof": 1.0, "concrete": 0.9}})


def osd_only():
    return poly("osd1", "osd_basin", [(2, 26), (6, 26), (6, 30), (2, 30)], storage_volume_m3=4.0, depth_m=0.5)


def run(d, inp=INP, rl=None, **kw):
    return analyse(d, rl or rules(defaults=True), kw.pop("terrain"), inp, ifd_stored=IFD, now=NOW, **kw)


# ------------------------------------------------------------------------------------------------------------------------------ 1. broken routes block the sizing
def test_tank_overflow_route_without_an_osd_blocks_the_osd_sizing(terrain):
    # a 300 m2 roof is all connected to a tank whose overflow route names no OSD: the roof reaches nothing. The only surface routed to the OSD is a 12 m2 driveway.
    # Old code sized the OSD on the driveway alone (a tiny, wrong storage). The roof must block the sizing.
    d = design(bld("b1", ROOF_300), pt("tank", "rwt", 3, 3, roof_building_id="b1", connected_roof_area_m2=300, capacity_l=5000), osd_only(),
               {"id": "of1", "type": "overflow_route", "geometry": {"kind": "polyline", "pts": [at(3, 3), at(4, 27)]}, "params": {"rwt_id": P("tank")}},
               pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"), line("d1", "driveway", [(9, 0), (9, 4)], width_m=3, surface_kind="concrete", drains_to_id="osd1"))
    r = run(d, terrain=terrain)
    o = r["osd"]
    assert o["status"] == "NOT EVALUATED" and o["required_storage_m3"] is None and o["critical"] is None
    assert "b1:rwt:tank" in o["message"] and "OVERFLOW" in o["message"] and "NO VALID ROUTE" in o["message"]
    un = [m for m in o["missing"] if m["id"].startswith("unrouted:")]
    assert [m["id"] for m in un] == ["unrouted:b1:rwt:tank"] and "overflow route of tank tank" in un[0]["how"]
    assert [u["id"] for u in o["catchment"]["unrouted"]] == ["b1:rwt:tank"] and o["catchment"]["unrouted"][0]["area_m2"] == pytest.approx(300.0)


def test_a_driveway_with_an_unknown_drains_to_id_blocks_the_osd_sizing(terrain):
    d = design(bld("b1", ROOF_360, drains_to_id="osd1"), osd_only(), pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"),
               line("d1", "driveway", [(9, 0), (9, 4)], width_m=3, surface_kind="concrete", drains_to_id="nope"))
    r = run(d, terrain=terrain)
    o = r["osd"]
    assert o["status"] == "NOT EVALUATED" and o["required_storage_m3"] is None
    assert "d1" in o["message"] and "NOPE" in o["message"] and "EACH MUST BE LINKED" in o["message"]
    m = next(m for m in o["missing"] if m["id"] == "unrouted:d1")
    assert "drains to" in m["how"] and "d1" in m["how"]


def test_every_unrouted_surface_is_listed_and_a_fully_routed_design_still_sizes(terrain):
    d = design(bld("b1", ROOF_360, drains_to_id="osd1"), osd_only(), pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"),
               line("d1", "driveway", [(9, 0), (9, 4)], width_m=3, surface_kind="concrete", drains_to_id="nope"),
               line("f1", "footpath", [(1, 0), (1, 4)], width_m=1.5, surface_kind="concrete", drains_to_id="nowhere"))
    o = run(d, terrain=terrain)["osd"]
    assert "d1" in o["message"] and "f1" in o["message"] and {u["object_id"] for u in o["catchment"]["unrouted"]} == {"d1", "f1"}
    ok = run(hand_design(), terrain=terrain)["osd"]
    assert ok["status"] == "EVALUATED" and ok["catchment"]["unrouted"] == []


def test_unrouted_surfaces_block_the_per_hectare_basis_of_the_osd_catchment_only(terrain):
    d = design(bld("b1", ROOF_360, drains_to_id="osd1"), osd_only(), line("d1", "driveway", [(9, 0), (9, 4)], width_m=3, surface_kind="concrete", drains_to_id="nope"),
               pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"))
    base = dict(osd_method="user_ssr", ssr_m3_per_ha=100.0, runoff_coefficients={"roof": 1.0, "concrete": 0.9})
    blocked = run(d, StormwaterInputs(**base, ssr_area_basis="osd_catchment"), terrain=terrain)["osd"]
    assert blocked["required_storage_m3"] is None and "d1" in blocked["message"]
    lot = run(d, StormwaterInputs(**base, ssr_area_basis="lot"), terrain=terrain)["osd"]
    assert lot["required_storage_m3"] == pytest.approx(100.0 * 612.0 / 10000.0)


# ------------------------------------------------------------------------------------------------------------------------------ 2. rates at or below zero
@pytest.mark.parametrize("raw", ["soil_unit,rate_mm_h\nA,0\n", "soil_unit,rate_mm_h\nA,-3\n", "soil_unit,ksat_m_day\nA,0\n"])
def test_the_soil_parser_refuses_a_rate_of_zero_or_below(raw):
    with pytest.raises(RF.RainfallError) as e:
        RF.parse_soil_table(raw.encode(), "s.csv", source="x", source_date=None)
    assert e.value.code == "BAD_RATE" and "ABOVE ZERO" in e.value.message


def test_a_soil_file_with_a_zero_rate_is_422_through_the_route(api):
    c, pid, _ = api
    r = c.post(f"/projects/{pid}/stormwater/soil", data={"source": "Synthetic atlas"}, files={"file": ("s.csv", b"soil_unit,rate_mm_h\nA,0\n", "text/csv")})
    assert r.status_code == 422 and r.json()["code"] == "BAD_RATE"
    assert c.get(f"/projects/{pid}/stormwater/data").json()["soil"] is None


def test_a_stored_zero_rate_reports_does_not_empty_and_never_crashes(terrain):
    # a soil table stored before the parser refused zero rates
    soil = {"schema": "soil_table.v1", "rows": [{"soil_unit": "SYN-C", "rate_mm_h": 0.0, "description": ""}], "label": "INDICATIVE, SITE TESTING REQUIRED",
            "provenance": {"source": "Synthetic", "source_date": None, "file_name": "s.csv"}}
    inp = StormwaterInputs(infiltration=InfiltrationEntry(source="soil_table", soil_unit="SYN-C"))
    r = analyse(design(trench()), rules(row("infiltration.max_emptying_time_h", 24.0, "h"), defaults=True), terrain, inp, soil_stored=soil, now=NOW)
    t = r["infiltration"]["trenches"][0]
    assert t["emptying_time_h"] is None and t["does_not_empty"] is True and t["status"] == "EVALUATED"
    assert t["check"]["status"] == "FAIL" and t["check"]["message"].startswith("DOES NOT EMPTY")
    assert "DOES NOT EMPTY" in t["steps"][1]["result"]["text"]


# ------------------------------------------------------------------------------------------------------------------------------ 3. hostile files
HEAD = "Intensity (mm/h)\nDuration,10%,5%\n"


@pytest.mark.parametrize("raw,code", [
    (HEAD + "5 min," + "9" * 131073 + ",2\n", "FIELD_TOO_LONG"),                       # a field over the csv module limit (131072)
    (HEAD + "5 min," + "9" * 2500 + ",2\n", "FIELD_TOO_LONG"),                        # a field over this tool's own limit
    (HEAD + "5 min,1,2,3\n", "RAGGED_ROW"),                                           # more cells than the header
    (HEAD + "5 min,1,2,3,4,5\n10 min,1,2\n", "RAGGED_ROW"),
    (HEAD + "5 min," + ",".join(["1"] * 300) + "\n", "TOO_MANY_COLUMNS"),
    (HEAD + "5 min,nan,2\n", "BAD_VALUE"), (HEAD + "5 min,inf,2\n", "BAD_VALUE"), (HEAD + "5 min,-1,2\n", "BAD_VALUE"), (HEAD + "5 min,1,-2\n", "BAD_VALUE"),
    (HEAD + "5 min,1e308,2\n", "BAD_VALUE"),                                          # finite, but would overflow the sizing arithmetic
])
def test_hostile_ifd_files_are_refused_with_a_code_never_an_exception(raw, code):
    with pytest.raises(RF.RainfallError) as e:
        RF.parse_ifd_csv(raw.encode(), "x.csv", now=NOW)
    assert e.value.code == code and e.value.message == e.value.message.upper()


def test_a_short_row_is_still_a_bad_row_and_a_file_of_nul_bytes_is_refused():
    with pytest.raises(RF.RainfallError) as e:
        RF.parse_ifd_csv((HEAD + "5 min,1\n").encode(), "x.csv", now=NOW)
    assert e.value.code == "BAD_ROW"
    with pytest.raises(RF.RainfallError):
        RF.parse_ifd_csv(b"\x00" * 50 + b"\n" + b"a,b\x00\n" * 5, "x.csv", now=NOW)


def test_the_csv_module_failure_is_reported_as_a_rainfall_error(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("synthetic failure inside a parser")
    monkeypatch.setattr(RF, "decode", boom)
    for fn, args in ((RF.parse_ifd_csv, (b"x", "x.csv")), (RF.parse_arr_datahub, (b"x", "x.txt")), (RF.parse_soil_table, (b"x", "x.csv"))):
        kw = {"source": "s", "source_date": None} if fn is RF.parse_soil_table else {}
        with pytest.raises(RF.RainfallError) as e:
            fn(*args, **kw)
        assert e.value.code == "PARSE_FAILED"


def test_hostile_soil_files_are_refused():
    big = "soil_unit,rate_mm_h,description\nA,1," + "d" * 131073 + "\n"
    for raw, code in ((big, "FIELD_TOO_LONG"), ("soil_unit,rate_mm_h\nA,1,extra\n", "RAGGED_ROW"), ("soil_unit,rate_mm_h\nA,nan\n", "BAD_ROW"), ("soil_unit,rate_mm_h\nA,1e308\n", "BAD_RATE")):
        with pytest.raises(RF.RainfallError) as e:
            RF.parse_soil_table(raw.encode(), "s.csv", source="x", source_date=None)
        assert e.value.code == code


def test_hostile_uploads_are_422_through_the_routes(api):
    c, pid, _ = api
    r = c.post(f"/projects/{pid}/stormwater/ifd", files={"file": ("h.csv", (HEAD + "5 min," + "9" * 131073 + ",2\n").encode(), "text/csv")})
    assert r.status_code == 422 and r.json()["code"] == "FIELD_TOO_LONG"
    r = c.post(f"/projects/{pid}/stormwater/ifd", files={"file": ("h.csv", (HEAD + "5 min,1,2,3\n").encode(), "text/csv")})
    assert r.status_code == 422 and r.json()["code"] == "RAGGED_ROW"
    r = c.post(f"/projects/{pid}/stormwater/soil", data={"source": "x"}, files={"file": ("s.csv", ("soil_unit,rate_mm_h,description\nA,1," + "d" * 131073 + "\n").encode(), "text/csv")})
    assert r.status_code == 422 and r.json()["code"] == "FIELD_TOO_LONG"
    r = c.post(f"/projects/{pid}/stormwater/arr", files={"file": ("a.txt", b"[LOSSES]\n" + b"Storm Initial Losses (mm)," + b"9" * 3000 + b"\n", "text/plain")})
    assert r.status_code == 422 and r.json()["code"] == "FIELD_TOO_LONG"
    assert c.get(f"/projects/{pid}/stormwater/data").json()["ifd"] is None


# ------------------------------------------------------------------------------------------------------------------------------ 4. closed basins
def walled_courtyard():
    # four buildings whose corners overlap, so no diagonal leaks: the courtyard is x 5 to 13, y 10 to 18 (8 m by 8 m, 64 m2)
    return design(bld("n", [(3, 18), (15, 18), (15, 20), (3, 20)]), bld("s", [(3, 8), (15, 8), (15, 10), (3, 10)]), bld("w", [(3, 8), (5, 8), (5, 20), (3, 20)]),
                  bld("e", [(13, 8), (15, 8), (15, 20), (13, 20)]))


def test_a_basin_walled_by_buildings_is_reported_as_a_closed_basin_with_no_outlet(terrain):
    o = analyse(walled_courtyard(), NONE, terrain, StormwaterInputs(), overland=OverlandOptions(enabled=True, threshold_m2=10.0), now=NOW)["overland"]
    assert o["status"] == "EVALUATED" and o["closed_basins_total"] == 1 and len(o["closed_basins"]) == 1
    b = o["closed_basins"][0]
    assert b["id"] == "CB1" and b["status"] == "NO OUTLET" and b["area_m2"] == pytest.approx(64.0, abs=0.01) and b["cells"] == 256
    assert o["enclosed_cells"] == 256 and o["enclosed_area_m2"] == pytest.approx(64.0, abs=0.01)
    assert b["lowest_rl"] == pytest.approx(100.0 + 0.05 * 10.25, abs=0.03)             # the SYNTHETIC plane z = 100 + 0.05 y, lowest cell centre at y = 10.25
    assert 5.0 < b["centroid"][0] - 0 and len(b["outline"]) >= 4
    # D8 sinks are counted and listed, each inside the basin
    assert o["sinks"]["count"] >= 1 and o["sinks"]["listed"] and all(s["basin"] == "CB1" for s in o["sinks"]["listed"]) and b["sink_count"] == o["sinks"]["count"]
    assert b["sinks"] and b["sinks"][0]["contributing_area_m2"] >= 64.0 - 1e-6 or max(s["contributing_area_m2"] for s in b["sinks"]) >= 4.0
    note = next(n for n in o["notes"] if "CLOSED BASIN" in n)
    assert "NO OUTLET" in note and "64.0 M2" in note and any("D8 SINK" in n for n in o["notes"])


def test_without_the_walls_there_is_no_closed_basin(terrain):
    o = analyse(walled_courtyard(), NONE, terrain, StormwaterInputs(), overland=OverlandOptions(enabled=True, surface="existing"), now=NOW)["overland"]
    assert o["closed_basins"] == [] and o["closed_basins_total"] == 0 and o["enclosed_cells"] == 0 and o["sinks"]["count"] == 0
    assert not any("CLOSED BASIN" in n for n in o["notes"])


def test_closed_basins_at_the_raster_level_are_found_and_never_dropped():
    ny, nx, cell = 30, 30, 0.5
    z = np.full((ny, nx), 5.0) - 0.01 * np.arange(nx)[None, :]
    valid = np.ones((ny, nx), bool)
    valid[10:20, 10:12] = valid[10:20, 18:20] = valid[10:12, 10:20] = valid[18:20, 10:20] = False        # a ring of obstacle cells
    edge = np.zeros((ny, nx), bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    s = OVL.solve(z, valid, valid & edge, np.where(valid, cell * cell, 0.0), cell, 0.0, 0.0)
    cb = s["closed"]
    assert cb["total"] == 1 and cb["cells"] == 36 and cb["basins"][0]["area_m2"] == pytest.approx(9.0) and not s["reached"][14, 14] and s["reached"][2, 2]


# ------------------------------------------------------------------------------------------------------------------------------ 5. Tc as a searched duration
def test_tc_between_table_rows_is_searched_as_an_interpolated_duration():
    t = ifd_table()
    res = OSD.mass_balance(360.0, 12.0, 2.0, t, 10.0, 12.0)                  # old code: no table row from Tc to the limit, so no result at all
    assert res["error"] is None and len(res["rows"]) == 1
    r = res["rows"][0]
    # log duration, log intensity between 10 min (100 mm/h) and 20 min (60 mm/h):  I = 100 x (60 / 100) ^ ((ln 12 - ln 10) / (ln 20 - ln 10))
    i12 = 100.0 * (60.0 / 100.0) ** ((math.log(12) - math.log(10)) / (math.log(20) - math.log(10)))
    qp = 360.0 * i12 / 3.6e6
    s = (qp - 0.002) * (12 * 60.0 - 12 * 60.0 * 0.002 / qp)
    assert r["duration_min"] == 12.0 and r["is_tc"] and r["intensity_method"] == "INTERPOLATED"
    assert r["intensity_mm_h"] == pytest.approx(i12, abs=1e-3) and r["qp_l_s"] == pytest.approx(qp * 1000, abs=1e-3) and r["storage_m3"] == pytest.approx(s, abs=1e-3)
    assert "INTERPOLATED" in res["tc_search"]


def test_tc_that_is_a_table_row_adds_no_duration_and_tc_outside_the_table_is_stated():
    t = ifd_table()
    assert [r["duration_min"] for r in OSD.mass_balance(360.0, 10.0, 2.0, t, 10.0, 30.0)["rows"]] == [10, 20, 30]
    low = OSD.mass_balance(360.0, 3.0, 2.0, t, 10.0, 30.0)
    assert [r["duration_min"] for r in low["rows"]] == [5, 10, 20, 30] and "OUTSIDE" in low["tc_search"]


def test_the_interpolation_note_is_reachable_in_the_full_sizing(terrain):
    inp = StormwaterInputs(**{**HAND.model_dump(), "tc_post_min": 12})
    r = run(hand_design(), inp, terrain=terrain)
    assert r["osd"]["status"] == "EVALUATED" and any("INTERPOLATED" in n and "12 MIN" in n for n in r["notes"])
    rows = r["osd"]["search"]["rows"]
    assert rows[0]["duration_min"] == 12 and rows[0]["intensity_method"] == "INTERPOLATED"
    assert all("INTERPOLATED" not in n for n in run(hand_design(), terrain=terrain)["notes"])          # Tc 5 min is a table row


# ------------------------------------------------------------------------------------------------------------------------------ 6. AEP columns and tolerance
EY_CSV = "Intensity (mm/h)\nDuration,63.2%,1EY,10%\n5 min,130,130,150\n10 min,90,90,110\n20 min,60,60,75\n"


def test_63_2_percent_and_1ey_are_one_column_with_the_exact_ey_aep():
    t = RF.parse_ifd_csv(EY_CSV.encode(), "ey.csv", now=NOW)
    assert len(t.aeps_pct) == 2 and t.aeps_pct[0] == pytest.approx(100 * (1 - math.exp(-1)), abs=1e-3) and t.aeps_pct[1] == 10
    assert any("MERGED" in w and "63.2%" in w for w in t.warnings) and any("0.05" in a for a in t.provenance["assumptions"])
    assert t.intensity(10, 63.2) == (90.0, "TABLE") and t.intensity(10, 63.2121) == (90.0, "TABLE")
    swapped = RF.parse_ifd_csv(EY_CSV.replace("63.2%,1EY", "1EY,63.2%").encode(), "ey2.csv", now=NOW)
    assert swapped.aeps_pct == t.aeps_pct


def test_two_columns_for_the_same_aep_with_different_values_are_refused():
    with pytest.raises(RF.RainfallError) as e:
        RF.parse_ifd_csv(EY_CSV.replace("5 min,130,130", "5 min,130,131").encode(), "ey.csv", now=NOW)
    assert e.value.code == "DUPLICATE_COLUMN" and "DIFFER" in e.value.message


def test_a_user_aep_matches_a_column_within_the_stated_tolerance_only():
    t = ifd_table()
    assert RF.AEP_MATCH_TOL_PCT == 0.05
    assert t.aep_index(10.04) == 2 and t.aep_index(9.96) == 2 and t.aep_index(10.06) is None and t.aep_index(7) is None
    assert t.intensity(10, 10.04) == (100.0, "TABLE")


def test_the_sizing_runs_with_a_63_2_aep_against_a_1ey_column(terrain):
    ifd = RF.parse_ifd_csv("Intensity (mm/h)\nDuration,1EY,10%\n5 min,130,150\n10 min,90,100\n20 min,60,60\n30 min,45,45\n".encode(), "ey.csv", now=NOW).to_json()
    inp = StormwaterInputs(**{**HAND.model_dump(), "design_aep_pct": 63.2})
    r = analyse(hand_design(), rules(defaults=True), terrain, inp, ifd_stored=ifd, now=NOW)
    assert r["osd"]["status"] == "EVALUATED" and r["osd"]["required_storage_m3"] > 0


# ------------------------------------------------------------------------------------------------------------------------------ 7. tank detention only when the tank reaches the OSD
def test_tank_detention_is_counted_only_for_a_tank_whose_overflow_reaches_the_osd(terrain):
    tank = pt("tank", "rwt", 3, 3, roof_building_id="b1", connected_roof_area_m2=100, capacity_l=5000, detention_volume_l=1000)
    of = {"id": "of1", "type": "overflow_route", "geometry": {"kind": "polyline", "pts": [at(3, 3), at(4, 27)]}, "params": {"rwt_id": P("tank"), "osd_id": P("osd1")}}
    excl_false = rules(row("stormwater.rainwater_tank_excluded_from_detention_volume", False), defaults=True)
    reaching = run(hand_design(tank, of), rl=excl_false, terrain=terrain)["osd"]
    assert reaching["comparison"]["provided_m3"] == pytest.approx(5.0) and reaching["provided"]["tanks"][0]["reaches_osd"] is True
    # no overflow route: the tank overflows to the discharge point, so its detention does not serve the OSD
    apart = run(hand_design(tank), rl=excl_false, terrain=terrain)["osd"]
    p = apart["provided"]
    assert p["tanks"] == [] and [t["object_id"] for t in p["tanks_not_reaching_osd"]] == ["tank"] and p["tank_detention_m3"] == 0
    assert apart["comparison"]["provided_m3"] == pytest.approx(4.0) and "DOES NOT REACH AN OSD" in p["tank_note"]          # old code counted the 1.0 m3 as well: 5.0


# ------------------------------------------------------------------------------------------------------------------------------ 8. the entered head wins
def test_the_head_entered_by_the_user_wins_over_the_head_from_the_osd_levels(terrain):
    osd = poly("osd1", "osd_basin", [(2, 26), (6, 26), (6, 30), (2, 30)], storage_volume_m3=4.0, depth_m=0.5, top_water_level_rl=101.0, orifice_invert_rl=100.0)
    d = design(bld("b1", ROOF_360, drains_to_id="osd1"), osd, pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"))
    both = run(d, StormwaterInputs(**{**HAND.model_dump(), "discharge_coefficient": 0.6, "orifice_head_m": 0.5}), terrain=terrain)["osd"]["orifice"]
    want = math.sqrt(4 * 0.002 / (math.pi * 0.6 * math.sqrt(2 * 9.81 * 0.5))) * 1000
    assert both["status"] == "EVALUATED" and both["diameter_mm"] == pytest.approx(want, abs=0.01) and both["head_used_m"] == 0.5
    head = next(i for i in both["inputs"] if i["symbol"] == "h")
    ref = next(i for i in both["inputs"] if i["symbol"] == "h ref")
    assert head["value"] == 0.5 and head["basis"] == "USER" and ref["value"] == pytest.approx(1.0) and ref["basis"] == "MODEL" and "NOT USED" in ref["ref"]
    only = run(d, StormwaterInputs(**{**HAND.model_dump(), "discharge_coefficient": 0.6}), terrain=terrain)["osd"]["orifice"]
    assert only["head_used_m"] < 1.0 and not any(i["symbol"] == "h ref" for i in only["inputs"])          # the computed head is used when none is entered


# ------------------------------------------------------------------------------------------------------------------------------ 9. pre and post cover different areas
def test_a_pre_development_that_does_not_cover_the_lot_labels_the_comparison(terrain):
    old = poly("old", "landscape_area", [(0, 0), (18, 0), (18, 17), (0, 17)], status="existing", surface_kind="turf")          # half the 612 m2 lot
    d = design(old, bld("b1", ROOF_360))
    r = run(d, StormwaterInputs(runoff_coefficients={"landscape_turf": 0.3, "roof": 0.9}, design_aep_pct=10, tc_pre_min=5, tc_post_min=5), terrain=terrain)
    pk = r["peak_flows"]
    assert pk["comparison_label"] == "PRE AND POST COVER DIFFERENT AREAS" and "PRE DEVELOPMENT: 306.0 M2" in pk["comparison_note"]
    m = next(m for m in r["missing"] if m["id"] == "unclassified_pre")
    assert m["area"] == "PEAK FLOW" and "306.0 M2" in m["what"] and "PRE AND POST COVER DIFFERENT AREAS" in m["what"] and m["how"]
    whole = poly("old", "landscape_area", [(0, 0), (18, 0), (18, 34), (0, 34)], status="existing", surface_kind="turf")
    r2 = run(design(whole), StormwaterInputs(runoff_coefficients={"landscape_turf": 0.3}, design_aep_pct=10, tc_pre_min=5, tc_post_min=5), terrain=terrain)
    assert r2["peak_flows"]["comparison_label"] == "" and not [m for m in r2["missing"] if m["id"].startswith("unclassified_")]


# ------------------------------------------------------------------------------------------------------------------------------ 10. overland performance and the wall clock limit
def _edge(shape):
    e = np.zeros(shape, bool)
    e[0, :] = e[-1, :] = e[:, 0] = e[:, -1] = True
    return e


def test_overland_solve_at_the_cell_cap_on_a_noisy_surface_is_under_three_seconds():
    n = int(math.isqrt(EL.MAX_OVERLAND_CELLS))                    # 632 x 632 = 399,424 cells
    rng = np.random.default_rng(7)
    Y = np.arange(n)[:, None] * 0.5 + np.zeros((1, n))
    z = 20.0 - 0.03 * Y + rng.normal(0.0, 0.05, (n, n))           # SYNTHETIC: tens of thousands of small depressions, the worst case for the depression pass
    valid = np.ones((n, n), bool)
    t0 = time.perf_counter()
    s = OVL.solve(z, valid, valid & _edge(z.shape), np.full((n, n), 0.25), 0.5, 0.0, 0.0)
    dt = time.perf_counter() - t0
    assert dt < 3.0, dt
    assert len(s["depressions"]) > 1000


def test_overland_analyse_at_the_cell_cap_is_under_three_seconds():
    rough = lambda x, y: 100.0 + 0.03 * y + 0.6 * np.sin(x / 9.0) * np.cos(y / 11.0)           # noqa: E731
    big = terrain_from_bundle(H.bundle(z=rough, extent=(-10.0, 320.0, -10.0, 320.0), step=2.0))
    lot = box(H.E0, H.N0, H.E0 + 305.0, H.N0 + 305.0)                                   # (305 + 10) / 0.5 + 1 = 631 cells a side: 398,161 cells
    blds = [bld(f"b{i}", [(10 + 30 * (i % 10), 10 + 30 * (i // 10)), (30 + 30 * (i % 10), 10 + 30 * (i // 10)), (30 + 30 * (i % 10), 25 + 30 * (i // 10)), (10 + 30 * (i % 10), 25 + 30 * (i // 10))])
            for i in range(40)]
    t0 = time.perf_counter()
    o = OVL.analyse(design(*blds), big, lot, Reader(NONE), cell_m=0.5)
    dt = time.perf_counter() - t0
    assert o["status"] == "EVALUATED" and o["grid"]["cells"] > 390_000 and dt < 3.0, dt


def test_the_wall_clock_limit_stops_the_calculation_with_overland_timeout(terrain, monkeypatch):
    monkeypatch.setattr(EL, "MAX_OVERLAND_SECONDS", 0.0)
    with pytest.raises(EL.EngineLimitError) as e:
        analyse(design(bld("b1", ROOF_360)), NONE, terrain, StormwaterInputs(), overland=OverlandOptions(enabled=True), now=NOW)
    assert e.value.code == "OVERLAND_TIMEOUT" and "LONGER THAN" in e.value.message and e.value.message == e.value.message.upper()


def test_the_wall_clock_limit_is_422_through_the_route(api, monkeypatch):
    c, pid, _ = api
    monkeypatch.setattr(EL, "MAX_OVERLAND_SECONDS", 0.0)
    r = c.post(f"/projects/{pid}/stormwater/analyse", json={"design": dump(design(bld("b1", ROOF_360))), "overland": {"enabled": True}})
    assert r.status_code == 422 and r.json()["code"] == "OVERLAND_TIMEOUT"


# ------------------------------------------------------------------------------------------------------------------------------ 11. overflow route targets
def tank_design(*extra, bld_id="b1"):
    return design(bld("b1", ROOF_300), pt("tank", "rwt", 3, 3, roof_building_id="b1", connected_roof_area_m2=300, capacity_l=5000), osd_only(), pt("dp1", "discharge_point", 9, -1, discharge_kind="kerb_outlet"),
                  line("d1", "driveway", [(9, 0), (9, 4)], width_m=3, surface_kind="concrete", drains_to_id="osd1"), *extra)


def of(id_, **params):
    return {"id": id_, "type": "overflow_route", "geometry": {"kind": "polyline", "pts": [at(3, 3), at(4, 27)]}, "params": {k: P(v) for k, v in params.items()}}


def test_an_overflow_route_must_end_at_an_osd_or_a_trench_by_type(terrain):
    # old code accepted any object id that exists: here a building
    r = run(tank_design(of("of1", rwt_id="tank", osd_id="b1")), terrain=terrain)
    tank = next(x for x in r["catchment"]["post_rows"] if x["id"] == "b1:rwt:tank")
    assert tank["route"]["to"] is None and "BUILDING" in tank["route"]["reason"] and "NOT AN OSD" in tank["route"]["reason"]
    assert any(m["id"] == "overflow:of1" and "BUILDING" in m["what"] for m in r["missing"])
    assert r["osd"]["status"] == "NOT EVALUATED" and "b1:rwt:tank" in r["osd"]["message"]
    gone = run(tank_design(of("of1", rwt_id="tank", osd_id="ghost")), terrain=terrain)
    assert next(x for x in gone["catchment"]["post_rows"] if x["id"] == "b1:rwt:tank")["route"]["to"] is None
    ok = run(tank_design(of("of1", rwt_id="tank", osd_id="osd1")), terrain=terrain)
    assert next(x for x in ok["catchment"]["post_rows"] if x["id"] == "b1:rwt:tank")["route"]["to"] == "osd1" and ok["osd"]["status"] == "EVALUATED"
    tr = run(tank_design(of("of1", rwt_id="tank", trench_id="t1"), trench()), terrain=terrain)
    assert next(x for x in tr["catchment"]["post_rows"] if x["id"] == "b1:rwt:tank")["route"]["to"] == "t1"


def test_a_tank_with_more_than_one_overflow_route_is_refused(terrain):
    r = run(tank_design(of("of1", rwt_id="tank", osd_id="osd1"), of("of2", rwt_id="tank", osd_id="osd1")), terrain=terrain)
    tank = next(x for x in r["catchment"]["post_rows"] if x["id"] == "b1:rwt:tank")
    assert tank["route"]["to"] is None and "MULTIPLE OVERFLOW ROUTES" in tank["route"]["reason"] and "of1" in tank["route"]["reason"] and "of2" in tank["route"]["reason"]
    m = next(m for m in r["missing"] if m["id"] == "overflow_multi:tank")
    assert "2 OVERFLOW ROUTES" in m["what"] and "Keep one" in m["how"]
    assert r["osd"]["status"] == "NOT EVALUATED"


# ------------------------------------------------------------------------------------------------------------------------------ 12. stored file too large
def test_a_parsed_upload_over_the_stored_limit_is_422_never_500(api, monkeypatch):
    c, pid, _ = api
    monkeypatch.setattr(ST, "MAX_STORED_BYTES", 200)
    r = c.post(f"/projects/{pid}/stormwater/arr", files={"file": ("arr.txt", ARR_TXT.encode(), "text/plain")})
    assert r.status_code == 422 and r.json()["code"] == "STORED_FILE_TOO_LARGE" and r.json()["message"] == r.json()["message"].upper()
    assert c.post(f"/projects/{pid}/stormwater/ifd", files={"file": ("i.csv", IFD_CSV.encode(), "text/csv")}).json()["code"] == "STORED_FILE_TOO_LARGE"
    assert c.post(f"/projects/{pid}/stormwater/soil", data={"source": "x"}, files={"file": ("s.csv", SOIL_CSV.encode(), "text/csv")}).json()["code"] == "STORED_FILE_TOO_LARGE"
    assert c.put(f"/projects/{pid}/stormwater/inputs", json={"runoff_coefficients": {f"s{i}": 0.5 for i in range(30)}}).json()["code"] == "STORED_FILE_TOO_LARGE"
    d = c.get(f"/projects/{pid}/stormwater/data").json()
    assert d["arr"] is None and d["ifd"] is None and d["soil"] is None
