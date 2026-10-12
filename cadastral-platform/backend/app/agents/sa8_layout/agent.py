"""Sub-Agent 8: Layout and Model Builder.

NOTE: contracts.AgentCode has no SA8 member (contracts.py is not edited by this agent). ``AGENT_CODE_NAME`` is the string
to register once the enum gains ``SA8_LAYOUT``.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from . import generate
from .mesh import to_building_in, to_parts
from .model import BuildingModel
from .ops import ChangeReport, apply, parse_op

AGENT_CODE_NAME = "SA8_LAYOUT"
AGENT_VERSION = "0.1.0"


class LayoutRequest(BaseModel):
    schema_name: str = "layout_request.v1"
    model: BuildingModel | None = None
    brief: dict[str, Any] | None = None         # kwargs for generate.from_brief
    footprint_wkt: str | None = None            # SA7 PlanOverlay.footprint_wkt (MGA)
    ops: list[dict[str, Any]] = []


class LayoutResult(BaseModel):
    schema_name: str = "layout_result.v1"
    model: BuildingModel
    reports: list[ChangeReport] = []
    parts: list[dict] = []
    scene_buildings: list[dict] = []            # SA6 BuildingIn dicts (absolute MGA)


class Sa8Layout:
    code_name = AGENT_CODE_NAME
    version = AGENT_VERSION
    input_schema = "layout_request.v1"
    output_schema = "layout_result.v1"
    input_model = LayoutRequest
    status = "unverified"

    def run(self, payload: LayoutRequest) -> LayoutResult:
        if payload.model is not None:
            m = payload.model
        elif payload.footprint_wkt:
            m = generate.from_footprint(payload.footprint_wkt, **(payload.brief or {}))
        elif payload.brief is not None:
            m = generate.from_brief(**payload.brief)
        else:
            raise ValueError("provide model, brief or footprint_wkt")
        reports = []
        for op in payload.ops:
            m, rep = apply(m, parse_op(op))
            reports.append(rep)
        try:
            sb = [b.model_dump() for b in to_building_in(m)]
        except Exception:  # noqa: BLE001
            sb = []
        return LayoutResult(model=m, reports=reports, parts=to_parts(m), scene_buildings=sb)
