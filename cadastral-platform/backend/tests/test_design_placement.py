from shapely.geometry import LineString, box

from app.design.placement import PlacementContext, footprint, snap_yaw, validate_placement

DIMS = (1.0, 0.5, 0.8)


def kinds(r, sev=None):
    return {(i.kind) for i in r.issues if sev is None or i.severity == sev}


def test_yaw_snap_and_footprint():
    assert snap_yaw(22, 15) == 15 and snap_yaw(-10, 15) == 345
    fp = footprint(10, 10, 1.0, 0.5, 90)
    assert abs(fp.bounds[2] - fp.bounds[0] - 0.5) < 1e-9


def test_ground_snap_via_terrain():
    ctx = PlacementContext(terrain=lambda x, y: 12.5 + x * 0.01)
    r = validate_placement(DIMS, 10, 5, 99, 20, 1, "ground", ctx)
    assert r.z == 12.6 and r.yaw_deg == 15 and not r.issues
    r = validate_placement(DIMS, 10, 5, None, 0, 1, "ground", PlacementContext(terrain=lambda x, y: None))
    assert "terrain" in kinds(r, "warning")


def test_floor_snap():
    r = validate_placement(DIMS, 1, 1, 0, 0, 1, "floor", PlacementContext(floor_rl=21.2))
    assert r.z == 21.2


def test_missing_dimensions_blocks():
    r = validate_placement((None, 1, 1), 0, 0, 0, 0, 1, "ground", PlacementContext())
    assert r.blocked and kinds(r) == {"dimensions"}


def test_wall_collision_and_boundary_block():
    ctx = PlacementContext(boundary=box(0, 0, 20, 20), walls=[("w1", LineString([(5, 0), (5, 10)]), 0.2)])
    assert "collision" in kinds(validate_placement(DIMS, 5, 5, 0, 0, 1, "floor", ctx), "blocking")
    assert "boundary" in kinds(validate_placement(DIMS, 19.8, 5, 0, 0, 1, "ground", ctx), "blocking")
    assert not validate_placement(DIMS, 10, 10, 0, 0, 1, "ground", ctx).issues


def test_item_overlap_respects_height_and_self():
    ctx = PlacementContext(others=[("o1", footprint(5, 5, 1, 1, 0), 0.0, 1.0)])
    assert "collision" in kinds(validate_placement(DIMS, 5, 5, 0.5, 0, 1, "floor", ctx), "warning")
    assert not validate_placement(DIMS, 5, 5, 1.5, 0, 1, "ceiling", ctx).issues
    assert not validate_placement(DIMS, 5, 5, 0.5, 0, 1, "floor", ctx, self_id="o1").issues


def test_compliance_warnings_only():
    ctx = PlacementContext(envelope=box(0, 0, 10, 10), dbyd_buffers=[("b1", box(14, 14, 18, 18))],
                           driveways=[("d1", box(20, 0, 24, 10))])
    r = validate_placement(DIMS, 15, 15, 0, 0, 1, "floor", ctx)
    assert kinds(r) == {"envelope", "dbyd_buffer"} and not r.blocked
    r = validate_placement(DIMS, 22, 5, 0, 0, 1, "ground", ctx)
    assert kinds(r) == {"driveway"} and not r.blocked   # ground items are not envelope-checked
