import numpy as np
from shapely.geometry import box

from app.agents.sa3_terrain.tin import Tin
from app.flood import FloodLevelInput, compute_min_ffl, ffl_label, freeboard_from_knowledge, UNRESOLVED_PROMPT


def tin(z0=99.0, slope=0.0):
    xs, ys = np.meshgrid(np.linspace(0, 40, 9), np.linspace(0, 40, 9))
    V = np.column_stack([xs.ravel(), ys.ravel(), z0 + slope * xs.ravel()])
    return Tin(V)


def test_min_ffl_is_level_plus_freeboard():
    c = compute_min_ffl(FloodLevelInput(level_ahd=100.0), 0.5)
    assert c.min_ffl == 100.5 and c.result == "PASS" and c.freeboard_source == "user_entered"
    assert ffl_label(100.5, c) == "FFL RL 100.50 (flood level RL 100.00 + 0.50 freeboard)"


def test_fill_depth_ground_below_and_above():
    assert compute_min_ffl(FloodLevelInput(level_ahd=100.0), 0.5, existing_ground_at_footprint=99.2).fill_depth_m == 1.3
    hi = compute_min_ffl(FloodLevelInput(level_ahd=100.0), 0.5, existing_ground_at_footprint=101.0)
    assert hi.fill_depth_m == 0.0 and not any("Fill" in w for w in hi.warnings)


def test_fill_depth_from_synthetic_tin_uses_lowest_point():
    c = compute_min_ffl(FloodLevelInput(level_ahd=100.0), 0.5, tin(99.0, slope=0.01), footprint=box(10, 10, 20, 20))
    assert abs(c.existing_ground_at_footprint - 99.1) < 1e-6 and abs(c.fill_depth_m - 1.4) < 1e-6
    assert any("check council flood policy" in w for w in c.warnings)


def test_proposed_floor_pass_fail():
    f = FloodLevelInput(level_ahd=100.0)
    assert compute_min_ffl(f, 0.5, proposed_ffl=100.5).result == "PASS"
    bad = compute_min_ffl(f, 0.5, proposed_ffl=100.3)
    assert bad.result == "FAIL" and bad.floor_above_flood_ok is False


def test_unresolved_when_flood_level_unknown():
    c = compute_min_ffl(FloodLevelInput(), 0.5, proposed_ffl=99.0)
    assert c.result == "UNRESOLVED" and c.min_ffl is None and c.prompt == UNRESOLVED_PROMPT
    assert compute_min_ffl(None, 0.5).result == "UNRESOLVED"


def test_unresolved_when_freeboard_unknown():
    c = compute_min_ffl(FloodLevelInput(level_ahd=100.0), freeboard_from_knowledge("Nowhere"))
    assert c.result == "UNRESOLVED" and c.min_ffl is None


def test_user_override_freeboard():
    cited = freeboard_from_knowledge("Gunnedah")
    c = compute_min_ffl(FloodLevelInput(level_ahd=100.0), cited, freeboard_override_m=0.3)
    assert c.min_ffl == 100.3 and c.freeboard_source == "user_entered"


def test_gunnedah_dcp_freeboard_picked_up():
    fb = freeboard_from_knowledge("Gunnedah")
    assert fb.value_m == 0.5 and fb.source == "requirements" and "1% Annual Exceedance" in fb.citation
    c = compute_min_ffl(FloodLevelInput(level_ahd=250.0), fb)
    assert c.min_ffl == 250.5 and c.freeboard_source == "requirements"


def test_sa3_agent_raises_pad_to_flood_ffl():
    from app.agents.sa3_terrain.agent import Sa3Terrain
    from app.agents.sa3_terrain.models import PadDesign
    import inspect
    assert "flood_level_ahd" in PadDesign.model_fields and inspect.isfunction(Sa3Terrain.run)
