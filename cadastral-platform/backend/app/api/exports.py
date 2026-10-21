"""GET /projects/{project_id}/exports/{kind}: the exports of the site model (stage 11).

kinds: ``glb`` (the whole site: terrain, optional aerial, every site design object, buildings with their stored GLB), ``dxf`` (the site design in plan on the JCS layers; ``?version=R2010`` (default, UTF-8 text), ``R2000``
or ``R12``), ``objects.csv`` and ``objects.json`` (objects with parameters and bases), ``checks.csv`` and ``checks.json`` (the rule based checks, run on the saved design) and
``stormwater.csv`` and ``stormwater.json`` (the stormwater summary of the saved design with the saved entries and uploads). The exports are built from the SAVED scene bundle and the SAVED site
design of the project (the browser saves before it asks), and carry the status labels of the viewer: the terrain status, UNVERIFIED services and pending AI proposals.

PUT /projects/{project_id}/exports/building-glb/{object_id} stores the Plan Studio GLB of a building (at most 15 MB, a version 2 GLB) so the GLB export can include it. The GLB is checked
before it is stored (``glb.validate_gltf``: integer indices in range, buffer views and accessors inside the BIN chunk, element counts and numbers of nodes and meshes capped) and refused
with 422 INVALID_GLB when it fails; the file is removed again when the building leaves the saved design. A stored model that still cannot be merged is skipped in the export with the note
BUILDING MODEL SKIPPED, INVALID. Nothing is invented: a project without a scene bundle still exports its design, with TERRAIN DATA NOT AVAILABLE.

LIMITS: the GLB, DXF and schedule builds run on the engine pool under the per project gate (``_run_engine``), with a time cap (``EXPORT_TIME_CAP_S``, 504 EXPORT_TIMEOUT) and a running byte
total of the GLB (``MAX_GLB_BYTES``, 120 MB): a build that would pass it stops BEFORE adding the bytes that pass it, with 413 EXPORT_TOO_LARGE.
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from app.api.deps import ApiError
from app.api.site_design import (_read, _run_engine, _terrain_or_none, limited_body, site_design_access, site_design_base, site_rules_dep, SITE_DESIGN_FILE)
from app.common.filestore import atomic_write_bytes, file_lock
from app.design import engine_limits as EL
from app.design.object_checks import check_design
from app.design.site_rules import SiteRules
from app.exports import dxf as XD
from app.exports import glb as XG
from app.exports import schedules as XS
from app.exports import building_store as BG
from app.exports.common import KINDS, ExportContext, ExportTimeout, load_context
from app.stormwater.analyse import analyse
from app.stormwater.inputs import StormwaterInputs
from app.stormwater.store import StormwaterStore

router = APIRouter()
BUILDING_GLB_DIR = BG.BUILDING_GLB_DIR
MAX_BUILDING_GLB_BYTES = BG.MAX_BUILDING_GLB_BYTES
EXPORT_TIME_CAP_S = 60.0                       # a build stops at this deadline (checked per object and per part); the wait for it is capped a little later
_OBJ_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
ENGINE_KINDS = ("checks.csv", "checks.json", "stormwater.csv", "stormwater.json")


def _context(request: Request, project_id: UUID) -> tuple[ExportContext, Path]:
    folder = site_design_base(request) / str(project_id)
    design = _read(folder / SITE_DESIGN_FILE, project_id)
    return load_context(folder, str(project_id), design), folder


def _building_glbs(folder: Path, ctx: ExportContext) -> dict[str, bytes]:
    """The stored GLB of each building of the saved design. The bytes read so far are counted: reading stops (``GlbTooLarge``, 413) before they pass the GLB limit."""
    out: dict[str, bytes] = {}
    total = 0
    for o in ctx.design.objects:
        if o.type == "building":
            f = BG.glb_path(folder, o.id)
            try:
                if f.is_file() and f.stat().st_size <= MAX_BUILDING_GLB_BYTES:
                    if total + f.stat().st_size > XG.MAX_GLB_BYTES:
                        raise XG.GlbTooLarge("THE STORED BUILDING MODELS ARE LARGER THAN THE EXPORT LIMIT")
                    out[o.id] = f.read_bytes()
                    total += len(out[o.id])
            except OSError:
                pass
    return out


def _response(project_id: UUID, kind: str, data: bytes, ctx: ExportContext) -> Response:
    media, ext = KINDS[kind]
    stem = kind.split(".")[0]
    ascii_status = ctx.terrain_status.encode("ascii", "replace").decode("ascii")
    return Response(content=data, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="site_{str(project_id)[:8]}_{stem}.{ext}"', "Cache-Control": "no-store", "X-Terrain-Status": ascii_status,
        "X-Export-Kind": kind, "Access-Control-Expose-Headers": "Content-Disposition, X-Terrain-Status, X-Export-Kind"})


async def _plain(project_id: UUID, kind: str, request: Request, version: str, aerial: bool) -> Response:
    if kind == "dxf" and version not in XD.VERSIONS:
        raise ApiError(422, "BAD_DXF_VERSION", f"version must be one of: {', '.join(XD.VERSIONS)}")
    if kind not in ("glb", "dxf", "objects.csv", "objects.json"):
        raise ApiError(404, "UNKNOWN_EXPORT_KIND", f"unknown export kind; use one of: {', '.join(KINDS)}")
    base = site_design_base(request)

    def work() -> tuple[bytes, ExportContext]:
        deadline = time.monotonic() + EXPORT_TIME_CAP_S
        folder = base / str(project_id)
        ctx = load_context(folder, str(project_id), _read(folder / SITE_DESIGN_FILE, project_id))
        try:
            if kind == "glb":
                terrain = _terrain_or_none(base, project_id)
                data = XG.build_glb(ctx, terrain, include_aerial=aerial, building_glbs=_building_glbs(folder, ctx), deadline=deadline, max_bytes=XG.MAX_GLB_BYTES)
            elif kind == "dxf":
                data = XD.build_dxf(ctx, version, deadline)
            elif kind == "objects.csv":
                data = XS.objects_csv(ctx)
            else:
                data = XS.to_json_bytes(XS.objects_json(ctx))
        except XG.GlbTooLarge as e:
            raise ApiError(413, "EXPORT_TOO_LARGE", str(e)) from None
        except ExportTimeout as e:
            raise ApiError(504, "EXPORT_TIMEOUT", str(e)) from None
        return data, ctx

    data, ctx = await _run_engine(project_id, work, timeout_s=EXPORT_TIME_CAP_S + 15)
    return _response(project_id, kind, data, ctx)


async def _engine(project_id: UUID, kind: str, request: Request, rules: SiteRules) -> Response:
    ctx, folder = _context(request, project_id)
    base = site_design_base(request)
    try:
        EL.check_site_design(ctx.design)
    except EL.EngineLimitError as e:
        raise ApiError(422, e.code, e.message) from None
    st = StormwaterStore(folder)

    def work() -> dict[str, Any] | None:
        terrain = _terrain_or_none(base, project_id)
        try:
            if kind.startswith("checks"):
                return check_design(ctx.design, rules, terrain)
            d = st.load("inputs")
            try:
                inputs = StormwaterInputs.model_validate(d) if d else StormwaterInputs()
            except ValueError:
                inputs = StormwaterInputs()
            return analyse(ctx.design, rules, terrain, inputs, ifd_stored=st.load("ifd"), soil_stored=st.load("soil"), arr_stored=st.load("arr"), rainfall_source="upload")
        except EL.EngineLimitError:
            raise
        except Exception:  # noqa: BLE001  (the export says the result is not available; it never invents one)
            return None

    result = await _run_engine(project_id, work)
    if kind == "checks.json":
        data = XS.to_json_bytes(XS.checks_json(ctx, result))
    elif kind == "checks.csv":
        data = XS.checks_csv(ctx, result)
    elif kind == "stormwater.json":
        data = XS.to_json_bytes(XS.stormwater_json(ctx, result))
    else:
        data = XS.stormwater_csv(ctx, result)
    return _response(project_id, kind, data, ctx)


def _engine_route(kind: str):
    async def handler(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), rules: SiteRules = Depends(site_rules_dep)) -> Response:
        return await _engine(project_id, kind, request, rules)
    handler.__name__ = "export_" + kind.replace(".", "_")
    return handler


for _k in ENGINE_KINDS:                    # literal paths, registered before the generic one, so the rules (and the database behind them) are only needed for these four
    router.add_api_route(f"/projects/{{project_id}}/exports/{_k}", _engine_route(_k), methods=["GET"])


@router.get("/projects/{project_id}/exports/{kind}")
async def get_export(project_id: UUID, kind: str, request: Request, _user: UUID = Depends(site_design_access), version: str = Query(default=XD.DEFAULT_VERSION, max_length=8),
                     aerial: bool = Query(default=False)) -> Response:
    if kind not in KINDS:
        raise ApiError(404, "UNKNOWN_EXPORT_KIND", f"unknown export kind; use one of: {', '.join(KINDS)}")
    return await _plain(project_id, kind, request, version, aerial)


@router.put("/projects/{project_id}/exports/building-glb/{object_id}")
async def put_building_glb(project_id: UUID, object_id: str, request: Request, _user: UUID = Depends(site_design_access)) -> Response:
    """Store the GLB of a building of the saved design so the GLB export includes it. The body is the raw GLB (version 2)."""
    if not _OBJ_ID.match(object_id):
        raise ApiError(422, "BAD_OBJECT_ID", "the object id is not valid")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BUILDING_GLB_BYTES:
        raise ApiError(413, "FILE_TOO_LARGE", f"the GLB is larger than the {MAX_BUILDING_GLB_BYTES // (1024 * 1024)} MB limit")
    chunks, size = [], 0
    async for c in request.stream():
        size += len(c)
        if size > MAX_BUILDING_GLB_BYTES:
            raise ApiError(413, "FILE_TOO_LARGE", f"the GLB is larger than the {MAX_BUILDING_GLB_BYTES // (1024 * 1024)} MB limit")
        chunks.append(c)
    data = b"".join(chunks)
    base = site_design_base(request)

    def check() -> None:
        try:
            j, binc = XG.parse_glb(data)
        except (XG.GlbMergeError, ValueError):
            raise ApiError(422, "NOT_A_GLB", "the body is not a version 2 GLB file") from None
        try:
            XG.validate_gltf(j, binc)
        except XG.GlbMergeError as e:
            raise ApiError(422, "INVALID_GLB", f"the GLB cannot be used: {e}") from None

    await _run_engine(project_id, check)                      # parsing and checking up to 15 MB of JSON is work for the pool, not for the event loop
    folder = base / str(project_id)
    design = _read(folder / SITE_DESIGN_FILE, project_id)
    if not any(o.id == object_id and o.type == "building" for o in design.objects):
        raise ApiError(404, "BUILDING_NOT_IN_DESIGN", "there is no saved building with this id; save the design first")
    path = BG.glb_path(folder, object_id)
    with file_lock(path):
        atomic_write_bytes(path, data)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
