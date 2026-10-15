"""The terrain chain and the aerial image for a scene: one implementation shared by ``scripts/run_site.py`` and the orchestrator adapter ``Sa6Adapter``.

``gather_site_data`` resolves the ground levels (the stage 3 chain: user survey, QLD LiDAR, hosted LiDAR tiles, NSW 5 m DEM, nothing) and the aerial image for the lot, and returns
the keyword arguments of ``SceneRequest`` that carry them with their provenance. Nothing is invented: a chain that finds nothing gives a scene with TERRAIN DATA NOT AVAILABLE.
Network clients are built from an injected ``fetcher`` (tests) or the default urllib fetcher; ``off`` is the offline fixture module (``app.offline.lot2``) for test runs.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from app.agents.sa1_cadastre import clients as C
from app.agents.sa3_terrain.chain import ChainOutcome, Nsw5mProvider, SurveyProvider, TerrainRequest, mark_offline_outcome, resolve_terrain, terrain_note
from app.agents.sa3_terrain.provenance import scene_provenance
from app.agents.sa3_terrain.qld_lidar import QldLidarProvider, default_export, default_query
from app.agents.sa3_terrain.tile_library import TileLibraryProvider, store_from_env
from app.imagery.aerial import AerialOutcome, fetch_aerial

Fetcher = Callable[[str, dict], "tuple[bytes, str | None]"]
OFFLINE_ENV = "JCESITE_OFFLINE_FIXTURE"          # 'lot2': use the saved Lot 2 fixture (test runs only; no service is called)
TEST_ENV = "JCESITE_ENV"                         # the offline fixture is honoured only when this is 'test'
log = logging.getLogger(__name__)


def offline_fixture_name(env: Mapping[str, str]) -> str | None:
    """The offline fixture named by ``JCESITE_OFFLINE_FIXTURE``, but ONLY in a test run (``JCESITE_ENV=test``). Anywhere else the variable is ignored with a warning, so a stray setting
    cannot make a real project's scene come from the saved fixture and look like live data."""
    name = (env.get(OFFLINE_ENV) or "").strip()
    if not name:
        return None
    if env.get(TEST_ENV) != "test":
        log.warning("%s=%s is ignored: the offline fixture is only used when %s=test", OFFLINE_ENV, name, TEST_ENV)
        return None
    return name


def _no_network(*_a, **_k):
    raise ConnectionError("no network access in this run (an HTTP fetcher was injected without terrain data)")


def terrain_providers(mode: str, fetcher: Fetcher | None, off, env: dict[str, str]) -> list:
    """'auto' = survey, QLD LiDAR, hosted tile library, NSW 5 m DEM; 'nsw' = the NSW 5 m DEM only. The offline fixture serves the 5 m DEM itself and never reads the hosted tiles."""
    fx = fetcher or (lambda u, p: C.default_fetcher(u, p, 120.0))
    nsw_export = off.export_tiff if off is not None else (_no_network if fetcher is not None else None)
    nsw = Nsw5mProvider(export=nsw_export)
    if mode == "nsw":
        return [nsw]
    tiles = TileLibraryProvider(None, disabled_reason="hosted LiDAR tile library not read: offline fixture run (JCESITE_LIDAR_TILE_DIR is ignored)") if off is not None \
        else TileLibraryProvider(store_from_env(env))
    return [SurveyProvider(), QldLidarProvider(default_query(fx), default_export(fx)), tiles, nsw]


def aerial_providers(mode: str, fetcher: Fetcher | None, off) -> list:
    """[(state or None, ImageryProvider)]; none when disabled or when an HTTP fetcher was injected without imagery."""
    if mode == "none":
        return []
    if off is not None:
        return [(None, off.CachedImagery())]
    if fetcher is not None:
        return []
    from app.imagery.provider import NswImageryProvider, QldImageryProvider
    return [("NSW", NswImageryProvider()), ("QLD", QldImageryProvider())]


@dataclass
class SiteData:
    terrain: ChainOutcome | None = None
    aerial: Any = None                                   # AerialImage or None
    aerial_outcome: AerialOutcome | None = None
    errors: list[str] = field(default_factory=list)

    def scene_kwargs(self, off=None) -> dict[str, Any]:
        """The SceneRequest fields for the terrain provenance, the survey points and the aerial."""
        kw: dict[str, Any] = {}
        if self.terrain is not None:
            kw["terrain_provenance"] = scene_provenance(self.terrain.provenance)
            if self.terrain.result is not None:
                kw.update(survey_points=self.terrain.result.points, terrain_note=terrain_note(self.terrain.provenance))
        if self.aerial is not None:
            kw["aerial"] = self.aerial.to_scene()
        if off is not None:
            kw["data_status"] = off.provenance_note()
        return kw


def load_offline(name: str | None):
    """The offline fixture module named by ``JCESITE_OFFLINE_FIXTURE`` (or an explicit name), else None."""
    if not name:
        return None
    if name != "lot2":
        raise ValueError(f"unknown offline fixture {name!r}; only 'lot2' exists")
    import app.offline.lot2 as off
    return off


def gather_site_data(lot, *, survey: dict | None = None, accuracy_m: float | None = None, buffer_m: float = 30.0, terrain_mode: str = "auto", aerial_mode: str = "auto",
                     fetcher: Fetcher | None = None, off=None, env: dict[str, str] | None = None) -> SiteData:
    """Terrain chain and aerial for a ``LotContext``. A failure of either is recorded in ``errors`` and the scene is built without it (never a stop)."""
    import os
    e = dict(os.environ if env is None else env)
    out = SiteData()
    if terrain_mode != "none":
        try:
            state = lot.jurisdiction if lot.jurisdiction in ("NSW", "QLD") else None
            treq = TerrainRequest(boundary_wkt=lot.boundary_wkt, srid=lot.mga_srid, state=state, buffer_m=buffer_m, survey=survey, accuracy_m=accuracy_m)
            out.terrain = resolve_terrain(terrain_providers(terrain_mode, fetcher, off, e), treq)
            if off is not None:
                mark_offline_outcome(out.terrain)
        except Exception as ex:  # noqa: BLE001
            out.errors.append(f"terrain chain: {getattr(ex, 'error_code', type(ex).__name__)}: {getattr(ex, 'detail', ex)}")
    prov = aerial_providers(aerial_mode, fetcher, off)
    if prov:
        try:
            out.aerial_outcome = fetch_aerial(prov, lot.boundary_wkt, lot.mga_srid, lot.jurisdiction, margin_m=buffer_m)
            out.aerial = out.aerial_outcome.image
        except Exception as ex:  # noqa: BLE001
            out.errors.append(f"aerial: {getattr(ex, 'error_code', type(ex).__name__)}: {getattr(ex, 'detail', ex)}")
    return out
