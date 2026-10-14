"""run_site stage 3 wiring: --levels auto|nsw|none and --aerial, with mocked HTTP only (synthetic fixture lot; not a real site)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.sa3_terrain.chain import Nsw5mProvider, SurveyProvider  # noqa: E402
from app.agents.sa3_terrain.qld_lidar import QldLidarProvider  # noqa: E402
from app.agents.sa3_terrain.tile_library import TileLibraryProvider  # noqa: E402
from scripts import run_site as RS  # noqa: E402
from test_run_site import ENV, args, routes  # noqa: E402
from test_sa1_cadastre import Mock  # noqa: E402


def test_parser_defaults_levels_auto_and_nsw_still_accepted():
    p = RS.build_parser()
    a = p.parse_args([])
    assert a.levels == "auto" and a.aerial == "auto" and a.terrain_buffer_m == 30.0
    assert p.parse_args(["--levels", "nsw"]).levels == "nsw" and p.parse_args(["--levels", "none"]).levels == "none"


def test_provider_order_for_auto_and_nsw():
    names = [type(p) for p in RS.terrain_providers("auto", lambda u, q: (b"", None), None, {})]
    assert names == [SurveyProvider, QldLidarProvider, TileLibraryProvider, Nsw5mProvider]
    assert [type(p) for p in RS.terrain_providers("nsw", None, None, {})] == [Nsw5mProvider]
    assert RS.terrain_providers("auto", None, None, {})[2].store is None            # no JCESITE_LIDAR_TILE_DIR: tier 3 reports LIDAR PENDING


def test_tile_dir_env_configures_the_tile_library(tmp_path):
    p = RS.terrain_providers("auto", None, None, {"JCESITE_LIDAR_TILE_DIR": str(tmp_path)})[2]
    assert p.store is not None and p.store.describe() == str(tmp_path)


def test_aerial_providers_none_mode_and_injected_fetcher_make_no_calls():
    assert RS.aerial_providers("none", None, None) == []
    assert RS.aerial_providers("auto", lambda u, p: (b"", None), None) == []


def test_auto_with_blocked_network_ends_with_terrain_data_not_available_and_no_invented_levels(tmp_path):
    rep = RS.run_site(args(tmp_path, address="1 Test St Hornsby", development_type="shed", acknowledge=True, levels="auto"),
                      env=ENV, fetcher=Mock(routes()), echo=lambda s: None)
    st = {s.name: s for s in rep.steps}
    t = st["terrain chain"]
    assert t.status == RS.UNRESOLVED and "TERRAIN DATA NOT AVAILABLE" in t.detail
    assert "User supplied survey: SKIPPED" in t.detail and "NSW 5 m DEM: ERROR" in t.detail
    assert rep.facts["terrain_provenance"]["status"] == "TERRAIN DATA NOT AVAILABLE"
    assert st["SA3 terrain"].status == RS.SKIPPED


def test_levels_none_skips_the_chain(tmp_path):
    rep = RS.run_site(args(tmp_path, address="1 Test St Hornsby", development_type="shed", acknowledge=True, levels="none"),
                      env=ENV, fetcher=Mock(routes()), echo=lambda s: None)
    assert not any(s.name in ("terrain chain", "levels (NSW 5 m DEM)") for s in rep.steps) and "terrain_provenance" not in rep.facts


def test_levels_nsw_keeps_its_step_name(tmp_path):
    rep = RS.run_site(args(tmp_path, address="1 Test St Hornsby", development_type="shed", acknowledge=True, levels="nsw"),
                      env=ENV, fetcher=Mock(routes()), echo=lambda s: None)
    assert any(s.name == "levels (NSW 5 m DEM)" for s in rep.steps)


# ---- offline fixture runs must never read as live (stage 3 review) ------------------------------------------------------------
def _offline_outcome(env):
    import app.offline.lot2 as OFF
    lot = OFF.sa1_result().lot
    from app.agents.sa3_terrain.chain import TerrainRequest, mark_offline_outcome, resolve_terrain
    out = resolve_terrain(RS.terrain_providers("auto", None, OFF, env), TerrainRequest(boundary_wkt=lot.boundary_wkt, srid=lot.mga_srid, state="NSW", buffer_m=30.0))
    return OFF, mark_offline_outcome(out)


def test_offline_run_ignores_the_tile_dir_and_labels_the_terrain_as_an_offline_fixture(tmp_path):
    from app.agents.sa3_terrain.provenance import OFFLINE_SOURCE, scene_provenance
    import app.offline.lot2 as OFF
    (tmp_path / "index.json").write_text("{}")
    assert RS.terrain_providers("auto", None, OFF, {"JCESITE_LIDAR_TILE_DIR": str(tmp_path)})[2].store is None        # a live run would read the directory
    assert RS.terrain_providers("auto", None, None, {"JCESITE_LIDAR_TILE_DIR": str(tmp_path)})[2].store is not None
    _, out = _offline_outcome({"JCESITE_LIDAR_TILE_DIR": str(tmp_path)})
    p = out.provenance
    assert OFFLINE_SOURCE == "OFFLINE FIXTURE (app/offline/lot2.py), NOT LIVE DATA"
    assert p.tier == 4 and p.source_name == OFFLINE_SOURCE and p.url == OFFLINE_SOURCE and p.retrieved is None
    assert "NSW_5M_Elevation" not in p.source_name and "arcgis" not in p.url.lower() and "http" not in p.url
    assert out.result.survey["source"].startswith(OFFLINE_SOURCE)
    sp = scene_provenance(p)
    assert sp["source"] == OFFLINE_SOURCE and sp["url"] == OFFLINE_SOURCE
    assert any(a["provider"] == "Hosted LiDAR tile library" and "ignored" in a["note"] for a in out.attempts)


def test_a_live_run_keeps_the_service_name_and_url_and_a_retrieved_date():
    from app.agents.sa3_terrain.chain import Nsw5mProvider, TerrainRequest, mark_offline_outcome, resolve_terrain
    import app.offline.lot2 as OFF
    lot = OFF.sa1_result().lot
    out = resolve_terrain([Nsw5mProvider(export=OFF.export_tiff)], TerrainRequest(boundary_wkt=lot.boundary_wkt, srid=lot.mga_srid, state="NSW"))
    assert "NSW_5M_Elevation" in out.provenance.source_name and out.provenance.retrieved       # no mark_offline: nothing changes for a live run
    assert mark_offline_outcome(out) is out and out.provenance.retrieved is None
