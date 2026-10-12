"""Agent registry: AgentCode -> SubAgent instance.

* SA1, SA2, SA3, SA4, SA6 are not implemented yet: they get ``StubAgent`` which raises
  ``AgentError('NOT_IMPLEMENTED')`` so DAG ordering and failure paths are exercisable.
* SA7 and SA5 are loaded lazily from their import paths. If the import (or construction)
  fails, the registry records why and installs an ``UnavailableAgent`` that raises
  ``AgentError('AGENT_UNAVAILABLE')``, so a broken optional dependency cannot take the
  orchestrator down.
"""
from __future__ import annotations

import importlib
import logging
import threading
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict

from app.agents.base import AgentError, SubAgent
from app.common.contracts import AgentCode

log = logging.getLogger(__name__)

REAL_AGENT_PATHS: dict[AgentCode, str] = {
    AgentCode.SA7_PDF_ALIGN: "app.agents.sa7_pdf_align.agent:Sa7PdfAligner",
    AgentCode.SA5_CAD_DXF: "app.agents.sa5_cad_dxf.agent:Sa5CadDxf",
}

_STUB_SCHEMAS: dict[AgentCode, tuple[str, str]] = {
    AgentCode.SA1_CADASTRE: ("run_request.v1", "lot_context.v1"),
    AgentCode.SA2_DCP_RAG: ("dcp_query.v1", "setback_ruleset.v1"),
    AgentCode.SA3_GEOM_TIN: ("terrain_request.v1", "earthworks_result.v1"),
    AgentCode.SA4_HYDRO: ("services_request.v1", "services_result.v1"),
    AgentCode.SA6_GLIDE3D: ("scene_request.v1", "scene_bundle.v1"),
    AgentCode.SA7_PDF_ALIGN: ("plan_upload.v1", "plan_overlay.v1"),
    AgentCode.SA5_CAD_DXF: ("cad_request.v1", "cad_result.v1"),
}


class AnyPayload(BaseModel):
    """Permissive input model for stubs."""
    model_config = ConfigDict(extra="allow")


class StubAgent:
    """Placeholder for an agent that does not exist yet. Always fails permanently."""

    version = "0.0.0-stub"
    model_id = None
    input_model = AnyPayload
    error_code = "NOT_IMPLEMENTED"

    def __init__(self, code: AgentCode, reason: str | None = None) -> None:
        self.code = code
        self.input_schema, self.output_schema = _STUB_SCHEMAS.get(code, ("unknown.v1", "unknown.v1"))
        self._reason = reason

    def run(self, payload: Any) -> Any:
        raise AgentError(self.error_code, self._reason or f"{self.code.value} is not implemented yet")


class UnavailableAgent(StubAgent):
    """Stand-in for a real agent whose module failed to import or construct."""

    version = "0.0.0-unavailable"
    error_code = "AGENT_UNAVAILABLE"


def _load_dotted(path: str) -> Callable[[], SubAgent]:
    module_name, _, attr = path.partition(":")
    if not attr:
        raise ImportError(f"bad agent path {path!r}; expected 'module:Class'")
    return getattr(importlib.import_module(module_name), attr)


class AgentRegistry:
    def __init__(self) -> None:
        self._factories: dict[AgentCode, Callable[[], SubAgent]] = {}
        self._instances: dict[AgentCode, SubAgent] = {}
        self._lock = threading.Lock()
        self.load_errors: dict[AgentCode, str] = {}

    def register(self, code: AgentCode, factory: Callable[[], SubAgent]) -> None:
        """Register (or replace) a factory. Tests use this to inject fake agents."""
        with self._lock:
            self._factories[code] = factory
            self._instances.pop(code, None)
            self.load_errors.pop(code, None)

    def register_import_path(self, code: AgentCode, path: str) -> None:
        def factory() -> SubAgent:
            return _load_dotted(path)()
        self.register(code, factory)

    def get(self, code: AgentCode) -> SubAgent:
        with self._lock:
            inst = self._instances.get(code)
            if inst is not None:
                return inst
            factory = self._factories.get(code)
            if factory is None:
                inst = StubAgent(code)
            else:
                try:
                    inst = factory()
                except Exception as exc:  # ImportError, constructor failure, missing native deps
                    msg = f"{type(exc).__name__}: {exc}"
                    log.warning("agent %s unavailable: %s", code.value, msg)
                    self.load_errors[code] = msg
                    inst = UnavailableAgent(code, f"agent {code.value} failed to load: {msg}")
            self._instances[code] = inst
            return inst

    def is_stub(self, code: AgentCode) -> bool:
        return isinstance(self.get(code), StubAgent)


def default_registry() -> AgentRegistry:
    """Real SA7/SA5 by import path (lazy); stubs for everything not implemented yet."""
    reg = AgentRegistry()
    for code, path in REAL_AGENT_PATHS.items():
        reg.register_import_path(code, path)
    return reg
