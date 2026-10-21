"""GET /projects/{project_id}/scene-bundle: serves the latest SA6 scene bundle written for a project.

Location convention (same as the orchestrator's ``output_path``): ``<base>/<project_id>/scene_bundle.json`` where ``<base>`` is
the ``SCENE_BUNDLE_DIR`` environment variable when set, otherwise the API ``export_dir``. Nothing is generated here and nothing is
invented: a project without a bundle returns 404 "DATA NOT AVAILABLE". The bundle is re-serialised through ``SceneBundle`` (validated).
"""
from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from psycopg import Connection
from pydantic import ValidationError

from app.agents.sa6_site3d import SceneBundle, dumps
from app.api.deps import get_conn, require_project, require_terms
from app.common.bundle_dir import scene_base_dir

router = APIRouter()

SCENE_BUNDLE_FILE = "scene_bundle.json"
NO_BUNDLE_DETAIL = "DATA NOT AVAILABLE: no scene bundle for this project"


def scene_bundle_base(request: Request) -> Path:
    return scene_base_dir(request.app.state.settings.export_dir)


def scene_access(project_id: UUID, user_id: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)) -> UUID:
    """Terms accepted and the project is visible to the caller (RLS). Overridable in tests."""
    require_project(project_id, conn)
    return user_id


@router.get("/projects/{project_id}/scene-bundle")
def get_scene_bundle(project_id: UUID, request: Request, _user: UUID = Depends(scene_access)) -> Response:
    path = scene_bundle_base(request) / str(project_id) / SCENE_BUNDLE_FILE      # UUID-typed id: no path traversal
    if not path.is_file():
        raise HTTPException(status_code=404, detail=NO_BUNDLE_DETAIL)
    try:
        bundle = SceneBundle.model_validate_json(path.read_text(encoding="utf-8"))
    except (ValidationError, ValueError, OSError):
        raise HTTPException(status_code=500, detail="scene bundle on disk could not be read or failed validation") from None
    return Response(content=dumps(bundle), media_type="application/json", headers={"Cache-Control": "no-store"})
