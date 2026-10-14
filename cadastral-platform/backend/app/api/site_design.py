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
* Buildings: every building in a PUT must be a stored import (``building.import_id``) and match it, see ``app.design.import_store``;
  otherwise 422 with the code BUILDING_NOT_FROM_IMPORT or BUILDING_IMPORT_MISMATCH. Only placement, use, floor level and height may differ.
* The import route stores each payload it returns under ``<project dir>/imports/<import_id>.json`` (at most 200 per project; the oldest
  imports that no saved building uses are removed first) and caps the upload while it streams (413 before the body is spooled).
* Nothing is generated or invented here. The document is validated with the Pydantic model before it is written.

Stage 6 adds two engine routes. Both are pure computations on the request body and the project's cached terrain (nothing is stored):

* POST /projects/{id}/site-design/driveway-profile  body ``{"driveway": <site object>, "detail": "profile" | "full", "building": <site object> | null}``.
  A driveway whose end is linked to a building (``end_building_id``) takes its end level from that building's FFL, resolved HERE from the saved site
  design (or from ``building``, accepted only when the saved design holds that building); the object's own ``end_level_rl`` is ignored then. Returns the long
  section (chainage, existing level, design level, grade, transition flags), the checks against the resolved requirements (each with its
  requirement key and basis or UNRESOLVED), the failing chainages, and with ``detail`` "full" the batters, cut and fill polygons and volumes.
* POST /projects/{id}/site-design/grading  body ``{"grading_area": <site object>}``. Returns the design surface patch, the batters and the
  INDICATIVE cut and fill volumes with the terrain status.

LIMITS: a request over the caps of ``app.design.engine_limits`` (geometry outside the terrain bounds plus 20 m, a driveway over 300 m or 200 vertices, a
grading area over 20000 m2 or 500 vertices, a cut and fill grid over the cell cap) is refused with 422 before any work is done.

CONCURRENCY: the two routes are heavy (numpy, shapely, scipy), so they run on a small dedicated thread pool (``ENGINE_THREADS`` threads in all, so a burst
cannot starve the rest of the API) and at most ``ENGINE_PER_PROJECT`` requests of one project compute at the same time; the others wait their turn.

TERRAIN: the EXISTING ground of the project's scene bundle (``scene_bundle.json``, parts of class existing and context; see
``app.design.terrain_source``), parsed once per bundle file and cached. 404 NO_BUNDLE when the project has no bundle, 409
TERRAIN_NOT_AVAILABLE when the bundle has no existing ground. REQUIREMENTS: the LGA and jurisdiction of the project's primary lot, through
``app.design.site_rules`` (the dependency ``site_rules_dep``, overridable in tests).
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from psycopg import Connection
from pydantic import ValidationError

from app.api.deps import ApiError, get_conn, require_project, require_terms
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

from app.design import building_import as bi
from app.common.filestore import atomic_write_text, file_lock
from app.design import import_store as istore
from app.design import service_model as SM
from app.design import engine_limits as EL
from app.design.driveway_engine import driveway_profile
from app.design.driveway_link import link_id
from app.design.grading_engine import grading
from app.design.object_checks import check_design
from app.design.rwt_size import size_tank
from app.design.service_route import RouteError, propose_sewer, propose_water
from app.design.site_design import SiteDesign, SiteObject, empty_design
from app.design.site_rules import SiteRules, project_rules
from app.design.terrain_source import TerrainUnavailable, load_terrain

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
    try:
        istore.check_design(body, folder)
    except istore.ImportMismatch as e:
        raise ApiError(422, e.code, e.message) from None
    with _LOCK, file_lock(path):          # one writer at a time in this process AND across worker processes (the read, the compare and the write are one step)
        current = _read(path, project_id)
        if body.version != current.version:
            return JSONResponse(status_code=409, headers={"Cache-Control": "no-store"}, content={
                "code": "VERSION_CONFLICT", "current_version": current.version,
                "message": "The site design was saved from somewhere else since it was loaded. Reload it before saving again."})
        try:
            body, _cleared = SM.enforce_verification(body, current)       # a verified service whose position or facts changed is no longer verified; verified_by is locked
        except SM.VerifiedByLocked as e:
            raise ApiError(422, "VERIFIED_BY_LOCKED", f"verified_by of {e.object_id} cannot be edited while the service is verified; remove the verification first") from None
        saved = body.model_copy(update={"version": current.version + 1, "project_id": str(project_id),
                                        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        atomic_write_text(path, json.dumps(saved.dump(), separators=(",", ":")))
        istore.prune(folder, istore.used_import_ids(saved))
    return _json(saved)


class _TooLarge(HTTPException):
    pass


class CappedUploadRoute(APIRoute):
    """Refuses an upload over the cap WHILE IT STREAMS: the declared length is checked first, and a chunked body (no length) is cut off with 413
    as soon as the bytes received pass the cap, before the multipart parser has spooled the rest to disk."""

    #: the file cap in bytes and what the message calls it; a subclass sets its own (the DBYD plan upload uses 25 MB)
    max_file_bytes: int = MAX_IMPORT_BYTES
    what: str = "the import"

    def get_route_handler(self):
        original = super().get_route_handler()
        max_file, what = self.max_file_bytes, self.what

        async def handler(request: Request) -> Response:
            cap = max_file + 64 * 1024                              # the file cap plus the multipart framing and the small form fields
            too_big = JSONResponse(status_code=413, content={"code": "FILE_TOO_LARGE", "message": f"{what} is larger than the {max_file // (1024 * 1024)} MB limit"},
                                   headers={"Cache-Control": "no-store"})
            declared = request.headers.get("content-length")
            if declared is not None and declared.isdigit() and int(declared) > cap:
                return too_big
            seen = 0
            inner = request.receive

            async def receive():
                nonlocal seen
                msg = await inner()
                if msg["type"] == "http.request":
                    seen += len(msg.get("body", b""))
                    if seen > cap:
                        raise _TooLarge(status_code=413, detail="too large")
                return msg

            try:
                return await original(Request(request.scope, receive))
            except _TooLarge:
                return too_big

        return handler


import_router = APIRouter(route_class=CappedUploadRoute)

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


@import_router.post("/projects/{project_id}/site-design/import-building")
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
    folder = site_design_base(request) / str(project_id)
    body = payload.dump()
    iid = istore.save_import(folder, body)               # a building is later accepted only if it matches this stored payload (PUT)
    body["import_id"] = iid
    try:
        keep = istore.used_import_ids(_read(folder / SITE_DESIGN_FILE, project_id)) | {iid}
    except HTTPException:
        keep = {iid}
    istore.prune(folder, keep)
    return JSONResponse(content=body, headers={"Cache-Control": "no-store"})


router.include_router(import_router)


# ---- stage 6: driveway profile and grading engines ----------------------------------------------------------------------------------
SCENE_BUNDLE_FILE = "scene_bundle.json"


def site_rules_dep(project_id: UUID, conn: Connection = Depends(get_conn)) -> SiteRules:
    """The requirements of the project's LGA (from its primary lot). Overridable in tests."""
    return project_rules(conn, project_id)


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DrivewayProfileRequest(_Body):
    driveway: SiteObject
    detail: Literal["profile", "full"] = "full"
    building: SiteObject | None = None        # the linked building as the browser has it now (current FFL and footprint); checked against the saved design


class GradingRequest(_Body):
    grading_area: SiteObject


def _terrain_at(base: Path, project_id: UUID):
    try:
        return load_terrain(base / str(project_id) / SCENE_BUNDLE_FILE)
    except TerrainUnavailable as e:
        raise ApiError(404 if e.code == "NO_BUNDLE" else 409, "NO_BUNDLE" if e.code == "NO_BUNDLE" else "TERRAIN_NOT_AVAILABLE", e.message) from None


def _engine_json(content: dict) -> JSONResponse:
    return JSONResponse(content=content, headers={"Cache-Control": "no-store"})


ENGINE_THREADS = 4
ENGINE_PER_PROJECT = 2
_POOL = ThreadPoolExecutor(max_workers=ENGINE_THREADS, thread_name_prefix="site-engine")
_GATES: dict[str, list] = {}         # project id -> [semaphore, users]; an entry exists only while the project has requests in flight or waiting


@asynccontextmanager
async def _project_gate(project_id: UUID):
    """At most ``ENGINE_PER_PROJECT`` engine requests of one project compute at once; the rest wait here (on the event loop, not on a pool thread)."""
    key = str(project_id)
    g = _GATES.get(key)
    if g is None:
        g = _GATES[key] = [asyncio.Semaphore(ENGINE_PER_PROJECT), 0]
    g[1] += 1
    try:
        async with g[0]:
            yield
    finally:
        g[1] -= 1
        if g[1] == 0 and _GATES.get(key) is g:
            del _GATES[key]


async def _run_engine(project_id: UUID, work):
    """Run ``work()`` on the engine pool under the project gate. A request over an engine cap is 422."""
    def guarded():
        try:
            return work()
        except EL.EngineLimitError as e:
            raise ApiError(422, e.code, e.message) from None
    async with _project_gate(project_id):
        return await asyncio.get_running_loop().run_in_executor(_POOL, guarded)


def _limit_422(check, obj) -> None:
    try:
        check(obj)
    except EL.EngineLimitError as e:
        raise ApiError(422, e.code, e.message) from None


@router.post("/projects/{project_id}/site-design/driveway-profile")
async def post_driveway_profile(project_id: UUID, body: DrivewayProfileRequest, request: Request, _user: UUID = Depends(site_design_access),
                                rules: SiteRules = Depends(site_rules_dep)) -> JSONResponse:
    if body.driveway.type != "driveway" or body.driveway.geometry.kind != "polyline":
        raise ApiError(422, "NOT_A_DRIVEWAY", "the object is not a driveway with a centreline")
    _limit_422(EL.check_driveway, body.driveway)                      # cheap checks first: nothing is read from disk for an oversized request
    base = site_design_base(request)

    def work():
        saved = _read(base / str(project_id) / SITE_DESIGN_FILE, project_id) if link_id(body.driveway) else None       # only a linked end needs the saved design
        return driveway_profile(body.driveway, _terrain_at(base, project_id), rules, detail=body.detail, saved_design=saved, building=body.building)
    return _engine_json(await _run_engine(project_id, work))


@router.post("/projects/{project_id}/site-design/grading")
async def post_grading(project_id: UUID, body: GradingRequest, request: Request, _user: UUID = Depends(site_design_access),
                       rules: SiteRules = Depends(site_rules_dep)) -> JSONResponse:
    if body.grading_area.type != "grading_area" or body.grading_area.geometry.kind != "polygon":
        raise ApiError(422, "NOT_A_GRADING_AREA", "the object is not a grading area with an outline")
    _limit_422(EL.check_grading, body.grading_area)
    base = site_design_base(request)
    return _engine_json(await _run_engine(project_id, lambda: grading(body.grading_area, _terrain_at(base, project_id), rules)))


# ---- stage 7: rule based checks of the whole design, and the optional rainwater tank sizing -------------------------------------------
def _terrain_or_none(base: Path, project_id: UUID):
    """The project's terrain, or None when it has none (the checks that need ground levels or the lot are then NOT EVALUATED)."""
    try:
        return load_terrain(base / str(project_id) / SCENE_BUNDLE_FILE)
    except TerrainUnavailable:
        return None


@router.post("/projects/{project_id}/site-design/check")
async def post_site_check(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), rules: SiteRules = Depends(site_rules_dep),
                          raw: bytes = Depends(limited_body)) -> JSONResponse:
    """Evaluate every rule based check for the design in the body (the browser's current document). The server is authoritative; the document is not saved."""
    try:
        doc = SiteDesign.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False, include_input=False)) from None
    _limit_422(EL.check_site_design, doc)                              # cheap caps first: nothing is read from disk for an oversized design
    base = site_design_base(request)
    return _engine_json(await _run_engine(project_id, lambda: check_design(doc, rules, _terrain_or_none(base, project_id))))      # an EngineLimitError is 422 in _run_engine


class RwtSizeRequest(_Body):
    rwt: SiteObject
    building: SiteObject | None = None
    rainfall_monthly_mm: list[float] | None = None
    rainfall_station: str | None = None
    candidate_sizes_l: list[int] | None = None
    garden_monthly_factor: list[float] | None = None


@router.post("/projects/{project_id}/site-design/rwt-size")
async def post_rwt_size(project_id: UUID, body: RwtSizeRequest, _user: UUID = Depends(site_design_access), rules: SiteRules = Depends(site_rules_dep)) -> JSONResponse:
    if body.rwt.type != "rwt":
        raise ApiError(422, "NOT_A_RWT", "the object is not a rainwater tank")
    if body.building is not None and body.building.type != "building":
        raise ApiError(422, "NOT_A_BUILDING", "the linked object is not a building")
    if body.candidate_sizes_l is not None and len(body.candidate_sizes_l) > 20:
        raise ApiError(422, "ENGINE_INPUT_TOO_LARGE", "AT MOST 20 CANDIDATE SIZES ARE ACCEPTED")
    return _engine_json(await _run_engine(project_id, lambda: size_tank(body.rwt, body.building, rules, body.rainfall_monthly_mm, body.rainfall_station,
                                                                        body.candidate_sizes_l, body.garden_monthly_factor)))


# ---- stage 8: sewer and water route proposals --------------------------------------------------------------------------------------------
class SewerProposeRequest(_Body):
    design: SiteDesign
    building_id: str = Field(min_length=1, max_length=64)
    exit_index: int = Field(default=0, ge=0, le=63)
    start_invert_rl: float = Field(allow_inf_nan=False, ge=-1000, le=10000)
    diameter_mm: float = Field(gt=0, le=2000, allow_inf_nan=False)
    grade_pct: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    connection: "ConnectionIn"


class ConnectionIn(_Body):
    main_id: str | None = Field(default=None, max_length=64)
    p: list[float] | None = Field(default=None, min_length=2, max_length=2)
    invert_rl: float | None = Field(default=None, ge=-1000, le=10000, allow_inf_nan=False)


class WaterProposeRequest(_Body):
    design: SiteDesign
    building_id: str = Field(min_length=1, max_length=64)
    exit_index: int = Field(default=0, ge=0, le=63)
    meter_p: list[float] = Field(min_length=2, max_length=2)
    diameter_mm: float = Field(gt=0, le=1000, allow_inf_nan=False)
    cover_m: float = Field(gt=0, le=20, allow_inf_nan=False)
    rwt_id: str | None = Field(default=None, max_length=64)
    connection: ConnectionIn


SewerProposeRequest.model_rebuild()


def _route_422(fn):
    def run():
        try:
            return fn()
        except RouteError as e:
            raise ApiError(422, e.code, e.message) from None
    return run


@router.post("/projects/{project_id}/site-design/sewer-route")
async def post_sewer_route(project_id: UUID, body: SewerProposeRequest, request: Request, _user: UUID = Depends(site_design_access),
                           rules: SiteRules = Depends(site_rules_dep)) -> JSONResponse:
    """Propose a sewer drain from a building sewer exit to a connection (an existing sewer in the design, or a user entered point labelled NOT VERIFIED). Returns the
    objects to apply, the cover profile and every check. Nothing is saved: the page applies the objects through its operations (one undo step)."""
    _limit_422(EL.check_site_design, body.design)
    base = site_design_base(request)
    conn = body.connection.model_dump(exclude_none=True)

    def work():
        return propose_sewer(body.design, rules, _terrain_or_none(base, project_id), building_id=body.building_id, exit_index=body.exit_index, start_invert_rl=body.start_invert_rl,
                             diameter_mm=body.diameter_mm, connection=conn, grade_pct=body.grade_pct)
    return _engine_json(await _run_engine(project_id, _route_422(work)))


@router.post("/projects/{project_id}/site-design/water-route")
async def post_water_route(project_id: UUID, body: WaterProposeRequest, request: Request, _user: UUID = Depends(site_design_access),
                           rules: SiteRules = Depends(site_rules_dep)) -> JSONResponse:
    """Propose a water service from a main connection through the meter position to the building water exit, with size and cover as given and every check."""
    _limit_422(EL.check_site_design, body.design)
    base = site_design_base(request)
    conn = body.connection.model_dump(exclude_none=True)

    def work():
        return propose_water(body.design, rules, _terrain_or_none(base, project_id), building_id=body.building_id, exit_index=body.exit_index, meter_p=body.meter_p,
                             diameter_mm=body.diameter_mm, cover_m=body.cover_m, connection=conn, rwt_id=body.rwt_id)
    return _engine_json(await _run_engine(project_id, _route_422(work)))
