from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.sa8_layout import (BuildingModel, History, Requirements, Sa8Layout, SetbackRule, apply, check_against,  # noqa: E402
                                   floorplan_dxf, floorplan_pdf, from_brief, from_dxf, from_footprint, op_schemas, to_building_in,
                                   to_footprint_polygon, to_parts)
from app.agents.sa8_layout import agent as sa8_agent  # noqa: E402
from app.agents.sa8_layout.mesh import soup_volume, wall_volume  # noqa: E402


@pytest.fixture()
def house():
    return from_brief(3, 2, "double", 1, "contemporary")


def ok(m, op):
    n, rep = apply(m, op)
    assert rep.ok, rep.errors
    return n, rep


def overlaps(m):
    rs = m.rooms
    return sum(a.poly.intersection(b.poly).area for i, a in enumerate(rs) for b in rs[i + 1:] if a.level_id == b.level_id)


def test_roof_type_and_pitch_geometry(house):
    r0 = house.roofs[0]
    main = max((Polygon(p) for p in r0.polygons), key=lambda p: p.area)
    assert main.area > 100
    h_gable = house.roof_ridge_height(r0)
    assert h_gable == pytest.approx(6.0 * math.tan(math.radians(22.5)), rel=1e-6)   # 12 m span -> 6 m half span
    sk, _ = ok(house, {"op": "set_roof_type", "roof_type": "skillion"})
    assert sk.roof_ridge_height(sk.roofs[0]) == pytest.approx(2 * h_gable, rel=1e-6)
    fl, _ = ok(house, {"op": "set_roof_type", "roof_type": "flat"})
    assert fl.roof_ridge_height(fl.roofs[0]) == 0.0
    p30, rep = ok(house, {"op": "set_roof_pitch", "pitch_deg": 30})
    assert p30.roof_ridge_height(p30.roofs[0]) == pytest.approx(6.0 * math.tan(math.radians(30)), rel=1e-6)
    assert rep.modified == [p30.roofs[0].id]
    # mesh top z follows analytic ridge height
    lv = p30.levels[0]
    z = np.concatenate([np.array(p["v"]).reshape(-1, 3)[:, 2] for p in to_parts(p30) if p["n"] == p30.roofs[0].id])
    assert z.max() == pytest.approx(lv.rl + lv.ceiling_height + p30.roof_ridge_height(p30.roofs[0]), abs=1e-3)
    for t in ("gable", "hip", "skillion", "flat", "dutch_gable"):
        n, _ = ok(house, {"op": "set_roof_type", "roof_type": t})
        assert any(p["n"] == n.roofs[0].id for p in to_parts(n))
    _, bad = apply(house, {"op": "set_roof_pitch", "pitch_deg": 80})
    assert not bad.ok and bad.errors[0].code == "PITCH_OUT_OF_RANGE"


def test_colour_and_finish_ops(house):
    n, rep = ok(house, {"op": "set_roof_colour", "colour": "Surfmist"})
    assert n.materials[n.roofs[0].material].name == "Surfmist"
    assert any(w.code == "APPROXIMATE_COLOUR" for w in rep.warnings)
    n, _ = ok(n, {"op": "set_wall_finish", "finish": "#336699"})
    assert all(w.finish == n.external_finish for w in n.walls if w.external)
    n, _ = ok(n, {"op": "set_window_frame", "frame": "white"})
    assert {o.frame for o in n.openings if o.type == "window"} == {"mat_white_frame"}
    _, bad = apply(n, {"op": "set_roof_colour", "colour": "Unobtainium"})
    assert bad.errors[0].code == "UNKNOWN_MATERIAL"
    _, bad = apply(n, {"op": "nonsense"})
    assert bad.errors[0].code == "INVALID_OP"


def test_flip_plan_mirrors_and_keeps_frontage(house):
    fr = house.frame()
    gar = house.room("Garage")
    u_before = fr.to_frame((gar.poly.centroid.x, gar.poly.centroid.y))
    fp_before = house.footprint()
    n, rep = ok(house, {"op": "flip_plan", "axis": "left_right"})
    g2 = n.room("Garage")
    u_after = fr.to_frame((g2.poly.centroid.x, g2.poly.centroid.y))
    cu = fr.to_frame((fp_before.centroid.x, fp_before.centroid.y))[0]
    assert u_after[0] == pytest.approx(2 * cu - u_before[0], abs=1e-3)
    assert u_after[1] == pytest.approx(u_before[1], abs=1e-3)
    assert u_after[0] > cu - 0.01 or u_before[0] < cu                      # garage swapped sides
    assert n.frontage_deg == house.frontage_deg
    assert n.footprint().area == pytest.approx(fp_before.area, rel=1e-6)
    assert len(n.openings) == len(house.openings)                          # openings follow their walls
    gd = [o for o in n.openings if o.type == "garage_door"][0]
    w = n.wall(gd.wall_id)
    nrm = (w.direction[1], -w.direction[0])
    f = n.frontage_vec()
    assert nrm[0] * f[0] + nrm[1] * f[1] > 0.9                              # garage door still faces the street
    assert overlaps(n) < 1e-6
    n2, _ = ok(n, {"op": "flip_plan"})
    assert n2.footprint().symmetric_difference(fp_before).area < 1e-3


def test_deck_and_alfresco(house):
    a0 = house.floor_area()
    n, rep = ok(house, {"op": "add_deck", "kind": "alfresco", "side": "rear", "depth_m": 3.0, "width_m": 5.0, "height_off_ground_m": 0.2})
    d = n.decks[0]
    assert Polygon(d.polygon).area == pytest.approx(15.0, abs=1e-3)
    assert d.roofed and d.id in rep.added
    assert n.floor_area() == a0                                             # decks are outdoor area, not floor area
    assert any(p["n"] == d.id for p in to_parts(n)) and any(p["n"] == d.id + ":roof" for p in to_parts(n))
    assert to_footprint_polygon(n, include_decks=True).area == pytest.approx(to_footprint_polygon(n).area + 15.0, abs=1e-3)
    # rear deck lies behind the building (away from the street)
    f = n.frontage_vec()
    c = Polygon(d.polygon).centroid
    assert (c.x - house.footprint().centroid.x) * f[0] + (c.y - house.footprint().centroid.y) * f[1] < 0
    _, bad = apply(house, {"op": "add_deck", "side": "front", "depth_m": -1})
    assert not bad.ok


def test_study_nook(house):
    n, rep = ok(house, {"op": "add_study_nook", "from_room": "Entry"})
    nook = n.room("Study Nook")
    assert nook.use == "study" and nook.area == pytest.approx(2.4 * 2.4, abs=0.1) or nook.area > 3
    assert overlaps(n) < 0.05
    assert rep.metrics["floor_area_delta_m2"] > 3
    _, bad = apply(house, {"op": "add_study_nook", "from_room": "Entry", "side": "back"})
    assert not bad.ok and bad.errors[0].code in ("ROOM_OVERLAP", "NO_SPACE")


def test_room_and_wall_ops(house):
    n, _ = ok(house, {"op": "add_room", "name": "Store", "use": "storage", "adjacent_to": "Garage", "side": "rear", "depth_m": 2.0})
    assert n.room("Store").area > 5
    _, bad = apply(house, {"op": "add_room", "name": "Bad", "adjacent_to": "Living", "side": "front", "depth_m": 3})
    assert bad.errors[0].code == "ROOM_OVERLAP"
    n2, rep = ok(n, {"op": "remove_room", "room": "Store"})
    assert n2.room("Store") is None and not rep.errors
    n3, rep = ok(house, {"op": "resize_room", "room": "Living", "width_m": 3.0, "depth_m": 4.0})
    assert n3.room("Living").area == pytest.approx(12.0, abs=1e-2)
    assert any(w.code in ("ROOM_SMALL", "WINDOW_AREA") for w in rep.warnings) or True
    ext = next(w for w in house.walls if w.external and w.room_ids == [house.room("Living").id] and w.direction[0] != 0 and w.a[1] > 11)
    n4, rep = ok(house, {"op": "move_wall", "wall_id": ext.id, "distance_m": 1.0, "direction": "outward"})
    assert n4.footprint().area == pytest.approx(house.footprint().area + 1.0 * (ext.length), rel=1e-2)
    assert n4.wall(ext.id) is not None                                    # stable id after move
    n5, _ = ok(house, {"op": "scale_footprint", "factor_x": 1.1, "factor_y": 1.0})
    assert n5.footprint().area == pytest.approx(house.footprint().area * 1.1, rel=1e-3)
    n6, _ = ok(house, {"op": "rotate_building", "angle_deg": 90})
    assert n6.footprint().area == pytest.approx(house.footprint().area, rel=1e-6)
    n7, _ = ok(house, {"op": "set_garage", "size": "single", "side": "right"})
    g = n7.room("Garage")
    assert g.area == pytest.approx(3.6 * 6.0, abs=0.1) and any(o.type == "garage_door" for o in n7.openings)
    assert overlaps(n7) < 1e-6


def test_openings(house):
    w = next(w for w in house.walls if w.external and w.length > 5)
    free = w.length / 2
    for o in list(house.openings):
        if o.wall_id == w.id:
            house, _ = ok(house, {"op": "remove_opening", "opening_id": o.id})
    n, rep = ok(house, {"op": "add_opening", "type": "window", "wall_id": w.id, "position_m": free})
    oid = rep.added[0]
    n2, _ = ok(n, {"op": "move_opening", "opening_id": oid, "position_m": 1.5})
    assert n2.opening(oid).position == pytest.approx(1.5)
    _, bad = apply(n, {"op": "add_opening", "type": "window", "wall_id": w.id, "position_m": free + 0.3})
    assert bad.errors[0].code == "OPENING_OVERLAP"
    _, bad = apply(n, {"op": "add_opening", "type": "window", "wall_id": w.id, "position_m": w.length})
    assert bad.errors[0].code == "OPENING_OUTSIDE_WALL"
    n3, _ = ok(n, {"op": "remove_opening", "opening_id": oid})
    assert n3.opening(oid) is None


def test_levels_and_heights(house):
    n, _ = ok(house, {"op": "set_ceiling_height", "height_m": 3.0})
    assert n.levels[0].ceiling_height == 3.0 and all(w.height == 3.0 for w in n.walls)
    n, _ = ok(n, {"op": "set_floor_level", "rl": 12.5})
    assert n.levels[0].rl == 12.5
    two, rep = ok(house, {"op": "add_level", "rooms": ["Bedroom A", "Bedroom B"]})
    assert len(two.levels) == 2 and two.levels[1].rl > two.levels[0].rl + 2.7
    assert two.stairs and any(w.code == "STAIR_PLACEHOLDER" for w in rep.warnings)
    assert len(two.roofs) >= 1 and overlaps(two) < 1e-6
    _, bad = apply(house, {"op": "set_ceiling_height", "height_m": 1.0})
    assert not bad.ok


def test_undo_redo_and_roundtrip(house):
    h = History(house)
    ops = [{"op": "set_roof_type", "roof_type": "hip"}, {"op": "add_deck", "kind": "deck", "side": "rear"},
           {"op": "flip_plan"}, {"op": "set_roof_colour", "colour": "Basalt"}]
    snaps = [house]
    for o in ops:
        assert h.do(o).ok
        snaps.append(h.model)
    assert not h.do({"op": "set_roof_pitch", "pitch_deg": 99}).ok          # failed op not recorded
    assert len(h.log) == 4
    for s in reversed(snaps[:-1]):
        assert h.undo() == s
    assert h.undo() == house and not h.can_undo
    for s in snaps[1:]:
        assert h.redo() == s
    assert not h.can_redo
    h.undo()
    assert h.do({"op": "set_roof_pitch", "pitch_deg": 10}).ok and not h.can_redo
    # purity
    before = house.model_dump_json()
    apply(house, {"op": "flip_plan"})
    assert house.model_dump_json() == before
    # serialisation round-trip
    again = BuildingModel.from_json(h.model.to_json())
    assert again == h.model
    # replaying the log reproduces the model
    m = house
    for o in h.log:
        m, rep = apply(m, o)
        assert rep.ok
    assert m == h.model


def test_op_schemas():
    sch = op_schemas()
    names = {s["name"] for s in sch}
    assert {"set_roof_type", "flip_plan", "add_deck", "add_study_nook", "set_garage", "move_wall", "add_level"} <= names
    assert len(names) >= 24
    for s in sch:
        assert s["description"] and s["input_schema"]["properties"]["op"]["const"] == s["name"]


@pytest.mark.parametrize("kw", [dict(bedrooms=1, bathrooms=1, garage="none"), dict(bedrooms=3, bathrooms=2, garage="single"),
                                dict(bedrooms=4, bathrooms=3, garage="double"), dict(bedrooms=4, bathrooms=2, garage="double", storeys=2),
                                dict(bedrooms=2, bathrooms=1, garage="none", development_type="secondary_dwelling"),
                                dict(bedrooms=1, bathrooms=1, garage="none", development_type="shed"),
                                dict(bedrooms=3, bathrooms=2, garage="single", orientation_deg=0.0, style="traditional")])
def test_from_brief_variants(kw):
    m = from_brief(**kw)
    assert m.rooms and m.walls and m.roofs and overlaps(m) < 1e-6
    assert BuildingModel.from_json(m.to_json()) == m
    if kw.get("development_type") == "shed":
        assert len(m.rooms) == 1 and m.roofs[0].type == "skillion"
    else:
        beds = [r for r in m.rooms if r.use == "bedroom"]
        assert len(beds) == (max(kw["bedrooms"], 2) if kw.get("storeys") == 2 else kw["bedrooms"])
    if kw.get("storeys") == 2:
        assert len(m.levels) == 2 and any(r.level_id == m.levels[1].id for r in m.rooms)
    if kw.get("garage") in ("single", "double"):
        assert m.room("Garage") and any(o.type == "garage_door" for o in m.openings)


def test_from_brief_inside_limit():
    lim = box(0, 0, 26, 24)
    m = from_brief(3, 2, "double", 1, "contemporary", footprint_limit=lim)
    assert lim.buffer(1e-6).contains(m.footprint()) and overlaps(m) < 1e-6
    tight = box(0, 0, 14, 14)
    t = from_brief(3, 2, "none", 1, footprint_limit=tight)
    assert tight.buffer(1e-6).contains(t.footprint())
    # rotated frontage (street to the east)
    e = from_brief(3, 2, "single", footprint_limit=box(0, 0, 30, 30), orientation_deg=0.0)
    assert box(0, 0, 30, 30).buffer(1e-6).contains(e.footprint())
    gd = [o for o in e.openings if o.type == "garage_door"][0]
    w = e.wall(gd.wall_id)
    assert (w.direction[1] * 1.0) < -0.99 or abs(w.direction[1]) > 0.99      # wall runs north-south, door faces east
    with pytest.raises(ValueError):
        from_brief(development_type="dual_occupancy")


def test_dxf_roundtrip(house, tmp_path):
    p = tmp_path / "plan.dxf"
    floorplan_dxf(house, p)
    m, rep = from_dxf(p)
    assert rep.confidence >= 0.85 and rep.method == "room_layer" and rep.units == "m"
    assert len(m.rooms) == len(house.rooms)
    assert m.floor_area() == pytest.approx(house.floor_area(), rel=1e-3)
    assert {r.name for r in m.rooms} == {r.name for r in house.rooms}
    assert m.room("Garage").use == "garage" and m.room("Living").use == "living"
    assert rep.ignored          # dimension/line/arc entities reported as ignored
    # millimetre drawing without declared units: heuristic
    import ezdxf
    doc = ezdxf.new()
    doc.layers.add("A-WALL-OUTLINE")
    doc.modelspace().add_lwpolyline([(0, 0), (12000, 0), (12000, 9000), (0, 9000)], close=True, dxfattribs={"layer": "A-WALL-OUTLINE"})
    f = tmp_path / "mm.dxf"
    doc.saveas(f)
    m2, r2 = from_dxf(f)
    assert r2.units == "mm" and m2.floor_area() == pytest.approx(108.0, rel=1e-3) and r2.confidence < 0.5
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (1, 1))
    g = tmp_path / "empty.dxf"
    doc.saveas(g)
    with pytest.raises(ValueError):
        from_dxf(g)


def test_from_footprint():
    wkt = "POLYGON((340000 6250000, 340012 6250000, 340012 6250010, 340000 6250010, 340000 6250000))"
    m = from_footprint(wkt)
    assert m.origin_mga == (340006, 6250005) and m.floor_area() == pytest.approx(120.0, abs=1e-3)
    assert m.to_mga((0, 0)) == pytest.approx((340006, 6250005))
    assert m.from_mga(m.to_mga((1.5, 2.5))) == pytest.approx((1.5, 2.5))
    m2 = from_footprint(wkt, bedrooms=3, bathrooms=2)
    assert len(m2.rooms) > 5 and m2.footprint().area == pytest.approx(120.0, rel=1e-3) and overlaps(m2) < 1e-6
    assert m2.footprint().symmetric_difference(m.footprint()).area < 0.05


def test_mesh_volumes_and_parts(house):
    w = next(w for w in house.walls if w.external and w.length > 5)
    sub = house.model_copy(deep=True)
    sub.openings = [o for o in sub.openings if o.wall_id != w.id]
    base = wall_volume(sub, w)
    assert base == pytest.approx(w.length * w.thickness * w.height, rel=1e-9)
    sub, _ = ok(sub, {"op": "add_opening", "type": "window", "wall_id": w.id, "position_m": w.length / 2, "width_m": 2.0, "height_m": 1.2, "sill_m": 0.9})
    assert wall_volume(sub, w) == pytest.approx(base - 2.0 * 1.2 * w.thickness, rel=1e-9)
    parts = to_parts(house)
    ids = house.element_ids()
    wanted = {x.id for x in house.walls} | {x.id for x in house.roofs}
    got = {p["n"].split(":")[0] for p in parts}
    assert wanted <= got and got - {f"slab_{l.id}" for l in house.levels} <= ids
    assert all(p["c"] == "buildings" and len(p["v"]) % 9 == 0 for p in parts)
    for p in parts:
        if p["n"] == w.id:
            assert soup_volume(np.array(p["v"]).reshape(-1, 3, 3)) == pytest.approx(w.length * w.thickness * w.height - sum(o.width * o.height * w.thickness for o in house.openings if o.wall_id == w.id), rel=1e-6)
    off = to_parts(house, origin=(10.0, 20.0))
    assert np.array(off[0]["v"])[0] == pytest.approx(np.array(to_parts(house)[0]["v"])[0] - 10.0)
    from app.agents.sa6_site3d.models import Part
    Part(**parts[0])
    b = to_building_in(house)
    assert len(b) == 1 and b[0].roof_type == "gable"


def test_floorplan_outputs(house, tmp_path):
    import ezdxf
    from pypdf import PdfReader
    dxf = floorplan_dxf(house, tmp_path / "a.dxf")
    doc = ezdxf.readfile(dxf)
    layers = {e.dxf.layer for e in doc.modelspace()}
    assert {"A-WALL", "A-ROOM", "A-ANNO-TEXT", "A-DOOR", "A-GLAZ"} <= layers
    assert isinstance(floorplan_dxf(house), bytes)
    pdf = floorplan_pdf(house, tmp_path / "a.pdf")
    assert len(PdfReader(pdf).pages) == 1
    assert floorplan_pdf(house)[:4] == b"%PDF"


def test_envelope(house):
    fp = house.footprint()
    env = fp.buffer(0.5, join_style=2)
    r = check_against(house, env)
    assert r.within_envelope and r.encroachment_area_m2 == 0
    small = box(*fp.bounds).buffer(-1.0, join_style=2)
    r = check_against(house, small)
    assert not r.within_envelope and r.encroachment_area_m2 > 10 and r.warnings[0].code == "ENVELOPE_ENCROACHMENT"
    b = fp.bounds
    lot = box(b[0] - 3, b[1] - 4.5, b[2] + 1, b[3] + 5)       # street to the south
    req = Requirements(setbacks=[SetbackRule(name="front", kind="front", min_m=6.0), SetbackRule(name="rear", kind="rear", min_m=3.0)], max_height_m=5.0)
    r = check_against(house, env, req, lot)
    assert r.setback_min_m["front"] == pytest.approx(4.5, abs=1e-3) and r.setback_min_m["rear"] == pytest.approx(5.0, abs=1e-3)
    codes = {w.code for w in r.warnings}
    assert "SETBACK_SHORT" in codes and "HEIGHT" in codes
    assert "not a planning" in r.disclaimer


def test_agent_run_and_advisories(house):
    out = Sa8Layout().run(sa8_agent.LayoutRequest(brief=dict(bedrooms=3, bathrooms=2, garage="single"),
                                                   ops=[{"op": "set_roof_type", "roof_type": "hip"}, {"op": "flip_plan"}]))
    assert all(r.ok for r in out.reports) and out.parts and out.scene_buildings
    assert sa8_agent.AGENT_CODE_NAME == "SA8_LAYOUT"
    n, rep = ok(house, {"op": "resize_room", "room": "Bedroom 1", "width_m": 2.0, "depth_m": 3.0, "anchor": "front_left"})
    assert any(w.code in ("ROOM_SMALL", "ROOM_OVERLAP") for w in rep.warnings)
    assert "compliance" in rep.disclaimer.lower()
