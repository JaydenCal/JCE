"""GET and PUT /projects/{project_id}/site-design: the ``site_design.v1`` document of a project.

Location convention (same as the scene bundle): ``<base>/<project_id>/site_design.json`` where ``<base>`` is the
``SCENE_BUNDLE_DIR`` environment variable when set, otherwise the API ``export_dir``.

* GET returns the stored document. A project that has no design yet returns 200 with an EMPTY document at version 0
  (a new project is a normal state, not an error; an unknown or inaccessible project is still 404 from the access check).
* PUT takes the whole document. Optimistic concurrency: the body's ``version`` must equal the stored version (0 when nothing is
  stored yet). A stale version returns 409 with ``current_version``; the client reloads and merges. A successful PUT stores
  version + 1, stamps ``updated_at`` and the project id, and returns the stored document.
* Limits (sanity limits, not engineering values): the PUT body is at most ``MAX_BODY_BYTES`` (5 MB; 413 above it, checked on the
  declared length and again while streaming) and a document holds at most ``MAX_POSITIONS`` positions in total (200000, 422 above it).
* Nothing is generated or invented here. The document is validated with the Pydantic model before it is written.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from psycopg import Connection
from pydantic import ValidationError

from app.api.deps import ApiError, get_conn, require_project, require_terms
from app.design import building_import as bi
from app.design.site_design import SiteDesign, empty_design

router = APIRouter()

SITE_DESIGN_FILE = "site_design.json"
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_IMPORT_BYTES = 15 * 1024 * 1024      # a building import file (Plan Studio design, PDF or DXF)
_LOCK = threading.Lock()          # one writer at a time inside this process (read, compare and write are one step)


def site_design_base(request: Request) -> Path:
    env = os.environ.get("SCENE_BUNDLE_DIR")
    return Path(env) if env else Path(request.app.state.settings.export_dir)


def site_design_access(project_id: UUID, user_id: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)) -> UUID:
    """Terms accepted and the project is visible to the caller (RLS). Overridable in tests."""
    require_project(project_id, conn)
    return user_id


async def limited_body(request: Request) -> bytes:
    """The raw PUT body, refused with 413 as soon as it is known to be over ``MAX_BODY_BYTES`` (declared length or streamed bytes)."""
    too_big = HTTPException(status_code=413, detail=f"site design is larger than the {MAX_BODY_BYTES // (1024 * 1024)} MB limit")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise too_big
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise too_big
        chunks.append(chunk)
    return b"".join(chunks)


def _read(path: Path, project_id: UUID) -> SiteDesign:
    if not path.is_file():
        return empty_design(str(project_id))
    try:
        return SiteDesign.model_validate_json(path.read_text(encoding="utf-8"))
    except (ValidationError, ValueError, OSError):
        raise HTTPException(status_code=500, detail="site design on disk could not be read or failed validation") from None


def _json(doc: SiteDesign, status: int = 200) -> JSONResponse:
    return JSONResponse(content=doc.dump(), status_code=status, headers={"Cache-Control": "no-store"})


@router.get("/projects/{project_id}/site-design")
def get_site_design(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access)) -> JSONResponse:
    path = site_design_base(request) / str(project_id) / SITE_DESIGN_FILE          # UUID-typed id: no path traversal
    return _json(_read(path, project_id))


@router.put("/projects/{project_id}/site-design")
def put_site_design(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), raw: bytes = Depends(limited_body)) -> JSONResponse:
    try:
        body = SiteDesign.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False, include_input=False)) from None
    folder = site_design_base(request) / str(project_id)
    path = folder / SITE_DESIGN_FILE
    with _LOCK:
        current = _read(path, project_id)
        if body.version != current.version:
            return JSONResponse(status_code=409, headers={"Cache-Control": "no-store"}, content={
                "code": "VERSION_CONFLICT", "current_version": current.version,
                "message": "The site design was saved from somewhere else since it was loaded. Reload it before saving again."})
        saved = body.model_copy(update={"version": current.version + 1, "project_id": str(project_id),
                                        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        folder.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(saved.dump(), separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, path)
    return _json(saved)


IMPORT_SOURCES = ("auto", "plan_studio", "pdf", "dxf", "footprint_entry")
_EXT_SOURCE = {".json": "plan_studio", ".pdf": "pdf", ".dxf": "dxf"}


def _sniff(name: str, head: bytes) -> str:
    """The importer for a file: by extension, confirmed by content (a PDF starts with %PDF, a design file is a JSON object)."""
    lower = name.lower()
    ext = ".json" if lower.endswith(".json") else os.path.splitext(lower)[1]
    source = _EXT_SOURCE.get(ext)
    if source is None:
        raise ApiError(415, "UNSUPPORTED_FILE_TYPE", "Import a .planstudio.json design, a .pdf plan or a .dxf plan.")
    if source == "pdf" and not head.startswith(b"%PDF"):
        raise ApiError(422, "NOT_A_PDF", "That file is not a PDF.")
    if source == "plan_studio" and not head.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"{"):
        raise ApiError(422, "NOT_A_PLAN_STUDIO_FILE", "That file is not a Plan Studio design file.")
    return source


@router.post("/projects/{project_id}/site-design/import-building")
def import_building(
    project_id: UUID,
    request: Request,
    _user: UUID = Depends(site_design_access),
    source: str = Form(default="auto"),
    building_use: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    width_m: float | None = Form(default=None),
    depth_m: float | None = Form(default=None),
    ring: str | None = Form(default=None),            # footprint_entry: a drawn polygon as JSON [[x, y], ...] in metres
    lot_wkt: str | None = Form(default=None),         # pdf: the lot boundary (MGA metres) the plan is aligned to
    srid: int | None = Form(default=None),
    scale_denominator: float | None = Form(default=None),
) -> JSONResponse:
    """Parse a building source into a ``building_import.v1`` payload in local plan coordinates. Nothing is saved: the page places the
    building with the ``place_building`` operation. A bad file is 422, an unsupported type 415, an oversized one 413."""
    if source not in IMPORT_SOURCES:
        raise ApiError(422, "BAD_SOURCE", f"source must be one of: {', '.join(IMPORT_SOURCES)}")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_IMPORT_BYTES + 64 * 1024:
        raise ApiError(413, "FILE_TOO_LARGE", f"the import is larger than the {MAX_IMPORT_BYTES // (1024 * 1024)} MB limit")
    try:
        data = b""
        name = "upload"
        if file is not None and file.filename:
            name = bi.safe_name(file.filename, "upload")
            data = file.file.read(MAX_IMPORT_BYTES + 1)
            if len(data) > MAX_IMPORT_BYTES:
                raise ApiError(413, "FILE_TOO_LARGE", f"the file is larger than the {MAX_IMPORT_BYTES // (1024 * 1024)} MB limit")
            if not data:
                raise ApiError(422, "EMPTY_FILE", "The file is empty.")
        if source == "auto":
            if not data:
                source = "footprint_entry"
            else:
                source = _sniff(name, data[:16])
        elif source != "footprint_entry":
            if not data:
                raise ApiError(422, "FILE_REQUIRED", "A file is needed for this import.")
            if _sniff(name, data[:16]) != source:
                raise ApiError(422, "FILE_TYPE_MISMATCH", f"That file is not a {source.replace('_', ' ')} file.")
        if source == "plan_studio":
            payload = bi.import_planstudio(data, name, building_use)
        elif source == "dxf":
            payload = bi.import_dxf(data, name, building_use)
        elif source == "pdf":
            if not lot_wkt or srid is None:
                raise ApiError(422, "LOT_REQUIRED", "A PDF import needs lot_wkt (the lot boundary in MGA metres) and srid.")
            payload = bi.import_pdf(data, lot_wkt=lot_wkt, srid=srid, source_file=name, use=building_use, scale_denominator=scale_denominator)
        else:
            if ring:
                try:
                    pts = json.loads(ring)
                    poly = [(float(p[0]), float(p[1])) for p in pts]
                except (ValueError, TypeError, IndexError):
                    raise ApiError(422, "BAD_FOOTPRINT", "ring must be a JSON list of [x, y] pairs in metres") from None
                if len(poly) < 3 or len(poly) > bi.MAX_VERTICES:
                    raise ApiError(422, "BAD_FOOTPRINT", f"a footprint needs 3 to {bi.MAX_VERTICES} vertices")
                payload = bi.footprint_from_ring(poly, building_use)
            elif width_m is not None and depth_m is not None:
                payload = bi.import_footprint_entry(width_m, depth_m, building_use)
            else:
                raise ApiError(422, "BAD_FOOTPRINT", "Give width_m and depth_m, or a drawn ring.")
    except bi.ImportFailure as e:
        raise ApiError(e.status, e.code, e.message) from None
    return JSONResponse(content=payload.dump(), headers={"Cache-Control": "no-store"})
