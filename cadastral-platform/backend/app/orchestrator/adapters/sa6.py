"""SA6 adapter: the real scene generator as a node of the orchestrator DAG (replaces the stub).

The node input holds the validated outputs of the upstream nodes: SA1 (lot), ENV (envelope and driveway) and, when they exist, SA4 (services, tank), SA3 (earthworks, unused for the
scene: the scene takes its levels from the terrain chain, which already carries a user survey with priority) and SA7 (plan overlay). The adapter resolves the TERRAIN CHAIN and the AERIAL
image itself (``site_data.gather_site_data``), so a scene built through the orchestrator or the scene API carries the terrain provenance and the aerial exactly as ``scripts/run_site.py`` does.

The scene bundle is written to ``<output_path>/scene_bundle.json`` (project scoped, the file GET /projects/{id}/scene-bundle serves) and the node returns a SMALL result (path, hash,
part count, terrain status), not the bundle, so the run ledger stays small. The scene is a SITE scene: no building is invented. A building is imported and placed in the 3D tool.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any, Callable
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import AgentError
from app.agents.sa3_driveway.models import Sa3DrivewayResult
from app.agents.sa3_terrain.models import Sa3TerrainResult
from app.agents.sa4_hydro.models import Sa4Result
from app.agents.sa1_cadastre.models import Sa1Result
from app.agents.sa6_site3d.agent import Sa6Site3d
from app.agents.sa6_site3d.models import SceneRequest
from app.agents.sa6_site3d.scene import build_scene, dumps
from app.agents.sa6_site3d.site_data import Fetcher, gather_site_data, load_offline, offline_fixture_name
from app.common.contracts import DevelopmentType, PlanOverlay
from app.common.filestore import atomic_write_text

from .nodes import ADAPTER_SUFFIX, NodeModel, lot_with_envelope
from .params import SiteParams

SCENE_FILE = "scene_bundle.json"


class Sa6Node(NodeModel):
    project_id: UUID
    project_title: str
    sa1: Sa1Result
    env: Sa3DrivewayResult
    sa3: Sa3TerrainResult | None = None
    sa4: Sa4Result | None = None
    overlay: PlanOverlay | None = None
    params: SiteParams
    development_type: DevelopmentType = DevelopmentType.dwelling_house
    output_path: str
    terrain_mode: str | None = Field(default=None, pattern="^(auto|nsw|none)$")      # None: JCESITE_TERRAIN from the environment, else auto
    aerial_mode: str | None = Field(default=None, pattern="^(auto|none)$")          # None: JCESITE_AERIAL from the environment, else auto
    terrain_buffer_m: float = Field(default=30.0, gt=0, le=500)


class Sa6Result(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene_bundle_path: str
    sha256: str
    bytes: int
    parts: int
    terrain_status: str
    terrain_source: str
    aerial: bool
    notes: list[str] = []
    status: str = "unverified"


class Sa6Adapter(Sa6Site3d):
    version = Sa6Site3d.version + ADAPTER_SUFFIX
    input_model = Sa6Node

    def __init__(self, *, env: dict[str, str] | None = None, fetcher: Fetcher | None = None, offline: str | None = None) -> None:
        self.env = dict(os.environ if env is None else env)
        self.fetcher = fetcher
        self.offline = load_offline(offline if offline is not None else offline_fixture_name(self.env))      # the environment variable counts only when JCESITE_ENV=test

    def run(self, payload: Sa6Node) -> Sa6Result:  # type: ignore[override]
        try:
            lot = lot_with_envelope(payload.sa1, payload.env)
            t = payload.params.terrain
            survey = t.survey.model_dump(mode="json") if t.survey is not None else None
            data = gather_site_data(lot, survey=survey, buffer_m=payload.terrain_buffer_m, terrain_mode=payload.terrain_mode or self.env.get("JCESITE_TERRAIN") or "auto",
                                    aerial_mode=payload.aerial_mode or self.env.get("JCESITE_AERIAL") or "auto",
                                    fetcher=self.fetcher, off=self.offline, env=self.env)
            dev = payload.development_type
            sa4 = payload.sa4
            req = SceneRequest(project_title=payload.project_title, subtitle=f"{dev.label} (unverified)", lot=lot, driveway=payload.env.driveway,
                               services=sa4.to_cad_services() if sa4 is not None else [], rwt=sa4.to_cad_rwt() if sa4 is not None else None, overlay=payload.overlay,
                               development_type=dev, **data.scene_kwargs(self.offline))
            bundle = build_scene(req)
            text = dumps(bundle)
        except AgentError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AgentError("SCENE_BUILD_FAILED", f"{type(exc).__name__}: {exc}") from exc
        out = Path(payload.output_path)
        out.mkdir(parents=True, exist_ok=True)
        path = out / SCENE_FILE
        atomic_write_text(path, text)
        prov = data.terrain.provenance if data.terrain is not None else None
        return Sa6Result(scene_bundle_path=str(path), sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(), bytes=len(text.encode("utf-8")), parts=len(bundle.parts),
                         terrain_status=(prov.status if prov is not None else "TERRAIN CHAIN NOT RUN"), terrain_source=(prov.source_name if prov is not None else ""),
                         aerial=data.aerial is not None, notes=data.errors)
