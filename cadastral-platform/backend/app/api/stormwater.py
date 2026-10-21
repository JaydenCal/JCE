"""Stormwater helper routes (stage 9).

* POST /projects/{id}/stormwater/analyse  body ``{"design": <site_design.v1>, "inputs": <entries> | null, "rainfall_source": "upload" | "live", "overland": {...} | null}``.
  The SERVER is authoritative: it builds the catchments, finds the design rainfall (the uploaded IFD table, or a live provider that is UNCONFIRMED until a client is configured),
  sizes the OSD by the method the requirement resolves, checks infiltration trenches and, when asked, computes overland flow. Nothing is stored. When ``inputs`` is null the
  entries saved for the project are used. Caps: the body is at most 5 MB; the design is checked by ``check_site_design``; the overland raster by ``check_overland`` (422).
* GET /projects/{id}/stormwater/data: what is stored (provenance of each upload, the saved entries).
* PUT /projects/{id}/stormwater/inputs: save the user's entries (basis USER).
* POST /projects/{id}/stormwater/ifd (BoM IFD table CSV), /arr (ARR Data Hub text export), /soil (soil table CSV with its source and date): multipart uploads of at most 2 MB; a file
  the parser cannot read is 422 with a code and a message that says why (nothing is stored then). DELETE /projects/{id}/stormwater/{ifd|arr|soil} removes an upload.

Same access and caps as the other site design routes (terms accepted, project visible, 413 while streaming over the cap, engines on the shared pool with the per project gate).
"""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError

from app.api.deps import ApiError
from app.api.site_design import (CappedUploadRoute, _engine_json, _run_engine, _terrain_or_none, limited_body, site_design_access, site_design_base, site_rules_dep)
from app.design import engine_limits as EL
from app.design.site_design import SiteDesign
from app.design.site_rules import SiteRules
from app.stormwater import rainfall as RF
from app.stormwater.analyse import analyse
from app.stormwater.inputs import OverlandOptions, StormwaterInputs
from app.stormwater.store import StoreTooLarge, StormwaterStore

router = APIRouter()
MAX_UPLOAD_BYTES = 2 * 1024 * 1024        # a sanity limit: a BoM IFD table is a few kilobytes


class UploadRoute(CappedUploadRoute):
    max_file_bytes = MAX_UPLOAD_BYTES
    what = "the file"


upload_router = APIRouter(route_class=UploadRoute)


class AnalyseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    design: SiteDesign
    inputs: StormwaterInputs | None = None
    rainfall_source: Literal["upload", "live"] = "upload"
    overland: OverlandOptions | None = None


def live_ifd_client() -> RF.IfdClient | None:
    """The client of the live design rainfall provider. None (the default) means no client is configured: the live provider then says LIVE UNCONFIRMED. Overridden in tests."""
    return None


def _store(request: Request, project_id: UUID) -> StormwaterStore:
    return StormwaterStore(site_design_base(request) / str(project_id))


def _json(content: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(content=content, status_code=status, headers={"Cache-Control": "no-store"})


def _saved_inputs(st: StormwaterStore) -> StormwaterInputs:
    d = st.load("inputs")
    if d is None:
        return StormwaterInputs()
    try:
        return StormwaterInputs.model_validate(d)
    except ValidationError:
        return StormwaterInputs()


@router.post("/projects/{project_id}/stormwater/analyse")
async def post_analyse(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), rules: SiteRules = Depends(site_rules_dep),
                       live_client: RF.IfdClient | None = Depends(live_ifd_client), raw: bytes = Depends(limited_body)) -> JSONResponse:
    try:
        body = AnalyseRequest.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False, include_input=False)) from None
    try:
        EL.check_site_design(body.design)                       # cheap caps first: nothing is read from disk for an oversized design
    except EL.EngineLimitError as e:
        raise ApiError(422, e.code, e.message) from None
    base = site_design_base(request)
    st = _store(request, project_id)

    def work() -> dict[str, Any]:
        terrain = _terrain_or_none(base, project_id)
        inputs = body.inputs if body.inputs is not None else _saved_inputs(st)
        return analyse(body.design, rules, terrain, inputs, ifd_stored=st.load("ifd"), soil_stored=st.load("soil"), arr_stored=st.load("arr"),
                       rainfall_source=body.rainfall_source, live_client=live_client, overland=body.overland)

    return _engine_json(await _run_engine(project_id, work))


@router.get("/projects/{project_id}/stormwater/data")
def get_data(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access)) -> JSONResponse:
    st = _store(request, project_id)
    return _json({**st.summary(), "inputs": st.load("inputs")})


@router.put("/projects/{project_id}/stormwater/inputs")
async def put_inputs(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), raw: bytes = Depends(limited_body)) -> JSONResponse:
    try:
        inputs = StormwaterInputs.model_validate_json(raw)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False, include_context=False, include_input=False)) from None
    _save(_store(request, project_id), "inputs", inputs.model_dump(mode="json"))
    return _json(inputs.model_dump(mode="json"))


def _save(st: StormwaterStore, name: str, value: dict[str, Any]) -> None:
    try:
        st.save(name, value)
    except StoreTooLarge as e:
        raise ApiError(422, "STORED_FILE_TOO_LARGE", str(e)) from None


async def _read_file(file: UploadFile) -> tuple[bytes, str]:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "FILE_TOO_LARGE", f"THE FILE IS LARGER THAN THE {MAX_UPLOAD_BYTES // (1024 * 1024)} MB LIMIT")
    if not data:
        raise ApiError(422, "EMPTY_FILE", "THE FILE IS EMPTY")
    return data, (file.filename or "upload")[:200]


@upload_router.post("/projects/{project_id}/stormwater/ifd", status_code=201)
async def post_ifd(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), file: UploadFile = File(...), declared_units: str | None = Form(default=None, max_length=40)) -> JSONResponse:
    data, name = await _read_file(file)
    try:
        table = RF.parse_ifd_csv(data, name, declared_units=declared_units)
    except RF.RainfallError as e:
        raise ApiError(422, e.code, e.message) from None
    _save(_store(request, project_id), "ifd", table.to_json())
    return _json(table.summary(), 201)


@upload_router.post("/projects/{project_id}/stormwater/arr", status_code=201)
async def post_arr(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), file: UploadFile = File(...)) -> JSONResponse:
    data, name = await _read_file(file)
    try:
        parsed = RF.parse_arr_datahub(data, name)
    except RF.RainfallError as e:
        raise ApiError(422, e.code, e.message) from None
    _save(_store(request, project_id), "arr", parsed)
    return _json(parsed, 201)


@upload_router.post("/projects/{project_id}/stormwater/soil", status_code=201)
async def post_soil(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), file: UploadFile = File(...), source: str = Form(..., max_length=200),
                    source_date: str | None = Form(default=None, max_length=40)) -> JSONResponse:
    data, name = await _read_file(file)
    try:
        parsed = RF.parse_soil_table(data, name, source=source, source_date=source_date)
    except RF.RainfallError as e:
        raise ApiError(422, e.code, e.message) from None
    _save(_store(request, project_id), "soil", parsed)
    return _json(parsed, 201)


@router.delete("/projects/{project_id}/stormwater/{name}")
def delete_upload(project_id: UUID, name: Literal["ifd", "arr", "soil"], request: Request, _user: UUID = Depends(site_design_access)) -> JSONResponse:
    return _json({"deleted": _store(request, project_id).delete(name)})


router.include_router(upload_router)
