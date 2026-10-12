"""Builds each node's input payload from the run request and upstream outputs.

Inputs must be deterministic functions of (request, upstream outputs, stored rows):
the idempotency key hashes them, so anything volatile (run ids, timestamps) would defeat
the cache. Export paths are therefore project-scoped, not run-scoped.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable
from uuid import UUID

from psycopg import Connection
from pydantic import BaseModel, ConfigDict, Field


class RunRequest(BaseModel):
    """What the caller asks for. ``params`` is opaque to the orchestrator and is handed to
    SA1 (lot identifier, jurisdiction, ...)."""
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    params: dict[str, Any] = Field(default_factory=dict)
    upload_id: UUID | None = None          # plans.plan_uploads row; adds SA7 to the plan
    targets: list[str] | None = None       # restrict to these nodes (+ required ancestors)
    token_budget: int | None = Field(default=None, gt=0)
    drawing_scale_denominator: int = Field(default=100, gt=0)
    export_formats: list[str] = Field(default_factory=lambda: ["dxf", "pdf"])
    project_title: str | None = None


class InputError(Exception):
    """Upstream data needed to build an input is missing or inconsistent."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


@dataclass
class BuildContext:
    run_id: UUID
    project_id: UUID
    user_id: UUID
    request: RunRequest
    conn: Connection
    export_dir: str
    upstream: dict[str, dict[str, Any]] = field(default_factory=dict)

    def need(self, node: str) -> dict[str, Any]:
        if node not in self.upstream:
            raise InputError("UPSTREAM_MISSING", f"output of {node} is required but unavailable")
        return self.upstream[node]


def _sa1(c: BuildContext) -> dict:
    return {"project_id": str(c.project_id), "params": c.request.params}


def _sa7(c: BuildContext) -> dict:
    if c.request.upload_id is None:
        raise InputError("NO_UPLOAD", "SA7 planned without an upload_id")
    row = c.conn.execute(
        "SELECT upload_id, project_id, storage_uri, file_sha256, selected_page "
        "FROM plans.plan_uploads WHERE upload_id = %s AND project_id = %s",
        (c.request.upload_id, c.project_id),
    ).fetchone()
    if row is None:
        raise InputError("UPLOAD_NOT_FOUND", str(c.request.upload_id))
    uri = row["storage_uri"]
    return {
        "upload_id": str(row["upload_id"]),
        "project_id": str(row["project_id"]),
        "storage_path": uri[len("file://"):] if uri.startswith("file://") else uri,
        "file_sha256": bytes(row["file_sha256"]).hex(),
        "selected_page": row["selected_page"],
        "lot": c.need("SA1"),
    }


def _sa2(c: BuildContext) -> dict:
    lot = c.need("SA1")
    return {
        "jurisdiction": lot.get("jurisdiction"),
        "lga_name": lot.get("lga_name"),
        "zone_code": lot.get("zone_code"),
        "lot_flags": lot.get("flags", {}),
    }


def _env(c: BuildContext) -> dict:
    return {"lot_context": c.need("SA1"), "ruleset": c.need("SA2")}


def _sa3(c: BuildContext) -> dict:
    return {
        "lot_context": c.need("SA1"),
        "envelope": c.need("ENV"),
        "footprint": c.upstream.get("SA7"),
        "params": c.request.params.get("terrain", {}),
    }


def _sa4(c: BuildContext) -> dict:
    return {
        "lot_context": c.need("SA1"),
        "footprint": c.upstream.get("SA7"),
        "earthworks": c.need("SA3"),
        "dbyd_upload_id": c.request.params.get("dbyd_upload_id"),
    }


def _sa5(c: BuildContext) -> dict:
    lot = c.need("SA1")
    earth, services = c.need("SA3"), c.need("SA4")
    acks = [r["kind"] for r in c.conn.execute(
        "SELECT DISTINCT kind::text AS kind FROM legal.project_acknowledgements "
        "WHERE project_id = %s AND user_id = %s ORDER BY 1", (c.project_id, c.user_id)).fetchall()]
    title = c.request.project_title
    if not title:
        p = c.conn.execute("SELECT name FROM core.projects WHERE project_id = %s", (c.project_id,)).fetchone()
        title = p["name"] if p else str(c.project_id)
    u = c.conn.execute("SELECT display_name FROM core.users WHERE user_id = %s", (c.user_id,)).fetchone()
    return {
        "project_id": str(c.project_id),
        "mga_srid": lot["mga_srid"],
        "drawing_scale_denominator": c.request.drawing_scale_denominator,
        "lot": lot,
        "overlay": c.upstream.get("SA7"),
        "driveway": earth.get("driveway"),
        "services": services.get("services", []),
        "rwt": services.get("rwt"),
        "council_overlays": c.upstream.get("SA2", {}).get("council_overlays", []),
        "council_name": lot.get("lga_name"),
        "export_formats": c.request.export_formats,
        "acknowledgements_present": acks,
        "project_title": title,
        "drawn_by": u["display_name"] if u else "unknown",
        "output_path": f"{c.export_dir.rstrip('/')}/{c.project_id}",
    }


def _sa6(c: BuildContext) -> dict:
    return {
        "lot_context": c.need("SA1"),
        "earthworks": c.need("SA3"),
        "services": c.need("SA4"),
        "overlay": c.upstream.get("SA7"),
    }


BUILDERS: dict[str, Callable[[BuildContext], dict]] = {
    "SA1": _sa1, "SA7": _sa7, "SA2": _sa2, "ENV": _env,
    "SA3": _sa3, "SA4": _sa4, "SA5": _sa5, "SA6": _sa6,
}


def build_input(node_id: str, ctx: BuildContext) -> dict:
    return BUILDERS[node_id](ctx)
