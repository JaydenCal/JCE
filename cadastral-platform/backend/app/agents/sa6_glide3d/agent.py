"""Sub-Agent 6: GlideInside 3D Sync. scene_request.v1 -> scene_bundle.v1 (deterministic, no model calls)."""
from __future__ import annotations

from app.agents.base import AgentError
from app.common.contracts import AgentCode

from .models import SceneBundle, SceneRequest
from .scene import build_scene

AGENT_VERSION = "0.1.0"


class Sa6Glide3d:
    code = AgentCode.SA6_GLIDE3D
    version = AGENT_VERSION
    input_schema = "scene_request.v1"
    output_schema = "scene_bundle.v1"
    input_model = SceneRequest
    status = "unverified"

    def run(self, payload: SceneRequest) -> SceneBundle:
        try:
            return build_scene(payload)
        except AgentError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AgentError("SCENE_BUILD_FAILED", f"{type(exc).__name__}: {exc}") from exc
