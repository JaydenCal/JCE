"""DBYD routes (stage 8): lodge and list BYDA enquiries, upload and parse the response plans, render a plan page for tracing, and the BYDA webhook.

PRIVACY. Plans, enquiries and webhook events are stored under ``<base>/<project_id>/dbyd/`` (see ``app.integrations.byda.store``) and every route first checks that the
caller can open the project. Nothing is shared across projects or users. Current use is a sandbox; the owner expects to give consent before commercial use.

ROUTES
* POST /projects/{id}/dbyd/enquiry        lodge an enquiry for the lot plus a margin (needs ``confirm`` true and ``margin_m``); at most 90 per user per 15 minutes. In SANDBOX
  mode it is refused (403 BYDA_LIVE_OFF) unless BYDA_ALLOW_LIVE=true. A PENDING record with a client reference is written BEFORE the call; when the outcome is ambiguous (a
  timeout after the request was sent, a 5xx, a 2xx without an id) the record stays and is marked LODGEMENT OUTCOME UNKNOWN, CHECK BYDA PORTAL, and no new lodgement is made
  for the project until the user resolves it.
* POST /projects/{id}/dbyd/enquiries/{client_ref}/resolve   the user records what the BYDA portal shows for an unknown lodgement (``not_lodged`` or ``lodged`` with the job number).
* GET  /projects/{id}/dbyd/enquiries      the project's enquiries; ``?refresh=true`` asks BYDA for their latest status (UNCONFIRMED endpoint, all pages up to a limit). In
  SANDBOX mode without BYDA_ALLOW_LIVE=true the stored list is returned and nothing is sent.
* POST /projects/{id}/dbyd/plans          private upload of a PDF, DWF or DXF plan (25 MB, content type and first bytes checked).
* GET  /projects/{id}/dbyd/plans          the uploaded plans.
* GET  /projects/{id}/dbyd/plans/{plan}/page   one PDF page as a PNG for the Trace service underlay (``PDF_TIME_LIMIT_S`` seconds, then 422 PDF_TIMEOUT).
* POST /projects/{id}/dbyd/plans/{plan}/parse  run the SA4 vector PDF parser and return DRAFT service_existing objects (origin dbyd, verified false). A raster plan, or a DWF
  or DXF, returns a message to trace it manually. Nothing is saved: the page applies the drafts. The render and the parse run in a worker process killed after
  ``PDF_TIME_LIMIT_S`` seconds (422 PDF_TIMEOUT).
* POST /integrations/byda/webhook/{project_id}  the BYDA webhook (shared secret, a timestamp within 5 minutes and a delivery id that was not seen before, see
  ``app.integrations.byda.webhook``).
* The plan upload stops reading as soon as the 25 MB cap is passed (``PlanUploadRoute``), as the building import does.
"""
from __future__ import annotations

import asyncio
import math
import re
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pyproj import Transformer
from shapely.geometry import Polygon

from app.api.deps import ApiError
from app.api.site_design import CappedUploadRoute, _terrain_or_none, site_design_access, site_design_base
from app.common.timeboxed import ChildError, TimedOut, run_timeboxed
from app.integrations.byda import mapping as M
from app.integrations.byda import webhook as W
from app.integrations.byda.client import BydaClient, BydaError, get_client
from app.integrations.byda import pdf_jobs
from app.integrations.byda.config import LIVE_OFF_MESSAGE, BydaConfig
from app.integrations.byda.limiter import RateLimited, RateLimiter
from app.integrations.byda.store import MAX_PLAN_BYTES, UNKNOWN_STATUS, DbydStore, StoreError, classify_plan, now_iso, safe_name

router = APIRouter()


class PlanUploadRoute(CappedUploadRoute):
    """The plan upload is cut off with 413 while it streams, once it passes the plan cap (the same mechanism as the building import)."""
    max_file_bytes = MAX_PLAN_BYTES
    what = "the plan"


plan_upload_router = APIRouter(route_class=PlanUploadRoute)

#: a PDF page render or parse that takes longer than this many seconds is killed and answered with 422 PDF_TIMEOUT (a sanity limit, not an engineering value)
PDF_TIME_LIMIT_S = 15.0
MAX_PAGE_PIXELS = 4000
MAX_PARSE_PAGE = 200
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SERVICE_OF_SA4 = {"water": "water", "sewer": "sewer", "stormwater": "stormwater", "electricity": "electricity", "gas": "gas", "telecom": "telecommunications", "other": "other"}
STATUS_OF = {"NOT_CONFIGURED": 503, "AUTH_FAILED": 502, "RATE_LIMITED": 429, "NOT_FOUND": 502, "UNREACHABLE": 502}


def byda_client() -> BydaClient:
    """The BYDA client (overridden in tests with a fake transport)."""
    return get_client()


_limiter: RateLimiter | None = None


def byda_limiter() -> RateLimiter:
    """The per user enquiry limiter, built from the configuration on first use (overridden in tests)."""
    global _limiter
    if _limiter is None:
        c = BydaConfig.from_env()
        _limiter = RateLimiter(c.rate_max, c.rate_window_s)
    return _limiter


def byda_config() -> BydaConfig:
    return BydaConfig.from_env()


def _store(request: Request, project_id: UUID) -> DbydStore:
    return DbydStore(site_design_base(request) / str(project_id))


def _byda_error(e: BydaError) -> ApiError:
    return ApiError(STATUS_OF.get(e.code.removeprefix("BYDA_"), 502), e.code, e.message)


def _store_error(e: StoreError) -> ApiError:
    return ApiError(e.status, e.code, e.message)


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _iso(v: str | None) -> str | None:
    if v is None:
        return None
    if not ISO.match(v):
        raise ValueError("a date must be YYYY-MM-DD")
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ValueError("not a real date") from None
    return v


class EnquiryRequest(_Body):
    confirm: bool                                                        # the user confirms that a real enquiry is lodged with BYDA
    margin_m: float = Field(ge=0, le=500, allow_inf_nan=False)           # the buffer around the lot; the user states it, there is no default
    work_description: str | None = Field(default=None, max_length=500)
    start_date: str | None = None
    end_date: str | None = None

    @field_validator("start_date", "end_date")
    @classmethod
    def _d(cls, v: str | None) -> str | None:
        return _iso(v)


def lot_polygon_lonlat(terrain: Any, margin_m: float) -> list[list[float]]:
    """The lot boundary plus ``margin_m`` as a closed WGS84 ring (longitude, latitude), from the MGA lot of the scene bundle."""
    if terrain is None or terrain.lot is None:
        raise ApiError(409, "LOT_NOT_AVAILABLE", "THE 3D MODEL HAS NO LOT BOUNDARY, SO THE ENQUIRY AREA CANNOT BE BUILT")
    if terrain.srid is None:
        raise ApiError(409, "SRID_NOT_AVAILABLE", "THE 3D MODEL DOES NOT STATE ITS COORDINATE SYSTEM, SO THE ENQUIRY AREA CANNOT BE CONVERTED TO LONGITUDE AND LATITUDE")
    area = terrain.lot.buffer(margin_m, join_style=2) if margin_m > 0 else terrain.lot
    if area.geom_type != "Polygon":
        area = max(area.geoms, key=lambda g: g.area)
    tr = Transformer.from_crs(terrain.srid, 4326, always_xy=True)
    ring = [list(tr.transform(x, y)) for x, y in area.exterior.coords]
    ring = [[round(lon, 7), round(lat, 7)] for lon, lat in ring]
    if not all(math.isfinite(v) for p in ring for v in p):
        raise ApiError(422, "BAD_LOT", "THE LOT BOUNDARY COULD NOT BE CONVERTED TO LONGITUDE AND LATITUDE")
    poly = Polygon(ring)
    if not poly.exterior.is_ccw:                                          # GeoJSON exterior rings run counter clockwise
        ring = ring[::-1]
    return ring


@router.post("/projects/{project_id}/dbyd/enquiry")
async def post_enquiry(project_id: UUID, body: EnquiryRequest, request: Request, user: UUID = Depends(site_design_access), client: BydaClient = Depends(byda_client),
                       limiter: RateLimiter = Depends(byda_limiter)) -> JSONResponse:
    if not body.confirm:
        raise ApiError(422, "CONFIRM_REQUIRED", "CONFIRM THAT A REAL DBYD ENQUIRY IS TO BE LODGED (confirm must be true)")
    if not client.config.configured:
        raise ApiError(503, "BYDA_NOT_CONFIGURED", "BYDA CREDENTIALS ARE NOT CONFIGURED (SET BYDA_CLIENT_ID AND BYDA_CLIENT_SECRET)")
    if client.config.live_blocked:
        raise ApiError(403, "BYDA_LIVE_OFF", LIVE_OFF_MESSAGE)             # SANDBOX mode: nothing leaves the server unless BYDA_ALLOW_LIVE=true
    base = site_design_base(request)
    ring = lot_polygon_lonlat(_terrain_or_none(base, project_id), body.margin_m)
    st = _store(request, project_id)
    # the PENDING record, with its client reference, is written BEFORE the call, so a lodgement whose outcome is lost is never forgotten (and never repeated by accident)
    try:
        pending = st.begin_lodgement({"lodged_by": str(user), "margin_m": body.margin_m, "mode": client.config.mode, "work_description": body.work_description, "endpoints": "UNCONFIRMED"})
    except StoreError as e:
        raise _store_error(e) from None
    try:
        limiter.hit(str(user))
    except RateLimited as e:
        st.update_lodgement(pending["client_ref"], {"lodge_state": "failed", "status": "NOT LODGED (RATE LIMITED)", "error_code": "RATE_LIMITED"})
        raise ApiError(429, "RATE_LIMITED", f"AT MOST {limiter.max_events} ENQUIRIES PER USER IN {int(limiter.window_s // 60)} MINUTES; TRY AGAIN IN {e.retry_after_s} SECONDS",
                       retry_after_s=e.retry_after_s) from None
    ref = pending["client_ref"]
    payload = M.enquiry_payload(ring, description=body.work_description, start_date=body.start_date, end_date=body.end_date, client_reference=ref)
    try:
        rec = await asyncio.get_running_loop().run_in_executor(None, client.lodge_enquiry, payload)
    except BydaError as e:
        if e.ambiguous:                                                     # the request was sent and the outcome is not known: keep the record, block a repeat
            st.update_lodgement(ref, {"lodge_state": "unknown", "status": UNKNOWN_STATUS, "error_code": e.code})
            raise ApiError(502, "LODGEMENT_OUTCOME_UNKNOWN", f"{UNKNOWN_STATUS}. THE REQUEST WAS SENT BUT THE ANSWER WAS NOT USABLE ({e.code}). BYDA MAY HAVE CREATED THE ENQUIRY, SO "
                           "NO NEW ENQUIRY WILL BE LODGED FOR THIS PROJECT UNTIL YOU RECORD WHAT THE PORTAL SHOWS", client_ref=ref) from None
        st.update_lodgement(ref, {"lodge_state": "failed", "status": f"NOT LODGED ({e.code})", "error_code": e.code})
        raise _byda_error(e) from None
    fields = {k: v for k, v in rec.items() if v is not None}            # a field BYDA did not state must not blank the stored one
    fields.setdefault("status", "LODGED")
    stored = st.update_lodgement(ref, {**fields, "lodge_state": "lodged", "lodged_at": now_iso()})
    return JSONResponse(content=stored or {**pending, **rec}, status_code=201, headers={"Cache-Control": "no-store"})


class ResolveRequest(_Body):
    outcome: str = Field(pattern=r"^(lodged|not_lodged)$")                # what the user found on the BYDA portal
    job_number: str | None = Field(default=None, max_length=120)
    enquiry_id: str | None = Field(default=None, max_length=120)


@router.post("/projects/{project_id}/dbyd/enquiries/{client_ref}/resolve")
def resolve_enquiry(project_id: UUID, client_ref: str, body: ResolveRequest, request: Request, user: UUID = Depends(site_design_access)) -> JSONResponse:
    """The user records what the BYDA portal shows for a lodgement whose outcome is unknown. Nothing is sent to BYDA. Until this is done no new lodgement is made."""
    try:
        rec = _store(request, project_id).resolve_lodgement(client_ref, body.outcome, body.job_number, body.enquiry_id, str(user))
    except StoreError as e:
        raise _store_error(e) from None
    return JSONResponse(content=rec, headers={"Cache-Control": "no-store"})


@router.get("/projects/{project_id}/dbyd/enquiries")
async def get_enquiries(project_id: UUID, request: Request, refresh: bool = False, _user: UUID = Depends(site_design_access), client: BydaClient = Depends(byda_client)) -> JSONResponse:
    st = _store(request, project_id)
    rows = st.enquiries()
    note = None
    live = not client.config.live_blocked
    if refresh and not live:
        note = LIVE_OFF_MESSAGE                                              # SANDBOX mode: read only what is stored
    elif refresh:
        try:
            remote, truncated = await asyncio.get_running_loop().run_in_executor(None, client.list_enquiries_paged)
            rows = st.merge_enquiries(remote)
            if truncated:
                note = f"ONLY THE FIRST {M.MAX_LIST_PAGES} PAGES OF BYDA'S LIST WERE READ; THE LIST MAY BE INCOMPLETE"
        except BydaError as e:
            note = e.message
    blocking = next((r for r in rows if r.get("lodge_state") in ("pending", "unknown")), None)
    return JSONResponse(content={"enquiries": rows, "mode": client.config.mode, "live_calls": live, "refresh_error": note,
                                 "unresolved_lodgement": blocking.get("client_ref") if blocking else None,
                                 "files_note": "RESPONSE FILES MAY ARRIVE BY EMAIL; UPLOAD THEM WITH THE PLAN UPLOAD IF THEY ARE NOT AVAILABLE FROM THE API"}, headers={"Cache-Control": "no-store"})


@plan_upload_router.post("/projects/{project_id}/dbyd/plans", status_code=201)
async def post_plan(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access), file: UploadFile = File(...), job_number: str | None = Form(default=None, max_length=120),
                    asset_owner: str | None = Form(default=None, max_length=120), plan_date: str | None = Form(default=None), plan_reference: str | None = Form(default=None, max_length=120)) -> JSONResponse:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_PLAN_BYTES + 64 * 1024:
        raise ApiError(413, "FILE_TOO_LARGE", f"THE PLAN IS LARGER THAN THE {MAX_PLAN_BYTES // (1024 * 1024)} MB LIMIT")
    try:
        pd = _iso(plan_date)
    except ValueError as e:
        raise ApiError(422, "BAD_PLAN_DATE", str(e).upper()) from None
    name = safe_name(file.filename, "plan")
    data = file.file.read(MAX_PLAN_BYTES + 1)
    if len(data) > MAX_PLAN_BYTES:
        raise ApiError(413, "FILE_TOO_LARGE", f"THE PLAN IS LARGER THAN THE {MAX_PLAN_BYTES // (1024 * 1024)} MB LIMIT")
    if not data:
        raise ApiError(422, "EMPTY_FILE", "THE FILE IS EMPTY")
    try:
        kind = classify_plan(name, file.content_type, data[:64])
        rec = _store(request, project_id).add_plan(name, kind, data, {"job_number": job_number, "asset_owner": asset_owner, "plan_date": pd, "plan_reference": plan_reference})
    except StoreError as e:
        raise _store_error(e) from None
    return JSONResponse(content=rec, status_code=201, headers={"Cache-Control": "no-store"})


@router.get("/projects/{project_id}/dbyd/plans")
def list_plans(project_id: UUID, request: Request, _user: UUID = Depends(site_design_access)) -> JSONResponse:
    return JSONResponse(content={"plans": _store(request, project_id).plans()}, headers={"Cache-Control": "no-store"})


def _plan(request: Request, project_id: UUID, plan_id: str) -> tuple[dict[str, Any], Path]:
    hit = _store(request, project_id).plan(plan_id)
    if hit is None:
        raise ApiError(404, "PLAN_NOT_FOUND", "NO SUCH PLAN IN THIS PROJECT")
    return hit


@router.get("/projects/{project_id}/dbyd/plans/{plan_id}/page")
async def get_plan_page(project_id: UUID, plan_id: str, request: Request, page: int = 1, width_px: int = 1600, _user: UUID = Depends(site_design_access)) -> Response:
    """One page of a PDF plan as a PNG (for the Trace service underlay). The page size in points is returned in headers. The render runs in a worker process that is killed
    after ``PDF_TIME_LIMIT_S`` seconds (422 PDF_TIMEOUT)."""
    rec, path = _plan(request, project_id, plan_id)
    if rec["kind"] != "pdf":
        raise ApiError(415, "NOT_A_PDF", "ONLY A PDF PLAN CAN BE SHOWN AS AN UNDERLAY; EXPORT A PAGE IMAGE FROM A DWF OR DXF AND LOAD THAT")
    if not 1 <= width_px <= MAX_PAGE_PIXELS:
        raise ApiError(422, "BAD_SIZE", f"width_px MUST BE 1 TO {MAX_PAGE_PIXELS}")
    try:
        out = await asyncio.get_running_loop().run_in_executor(None, lambda: run_timeboxed(pdf_jobs.render_page, str(path), page, width_px, MAX_PAGE_PIXELS, timeout_s=PDF_TIME_LIMIT_S))
    except TimedOut:
        raise ApiError(422, "PDF_TIMEOUT", f"THE PDF PAGE TOOK MORE THAN {PDF_TIME_LIMIT_S:g} SECONDS TO RENDER AND WAS STOPPED. USE A SIMPLER PDF OR TRACE FROM AN IMAGE") from None
    except ChildError:                                                    # a damaged PDF: a plain message, no internals
        raise ApiError(422, "PDF_UNREADABLE", "THE PDF COULD NOT BE READ") from None
    if out.get("error") == "BAD_PAGE":
        raise ApiError(422, "BAD_PAGE", f"THE PLAN HAS {out['pages']} PAGE(S)")
    headers = {"X-Page-Width-Pt": f"{out['width_pt']:.2f}", "X-Page-Height-Pt": f"{out['height_pt']:.2f}", "X-Page-Count": str(out["pages"]), "Cache-Control": "private, no-store"}
    return Response(content=out["png"], media_type="image/png", headers=headers)


class ParseRequest(_Body):
    page: int = Field(default=1, ge=1, le=MAX_PARSE_PAGE)
    scale_denominator: float | None = Field(default=None, gt=0, le=1_000_000, allow_inf_nan=False)
    #: pairs of ((paper x, paper y) in PDF points, (easting, northing) in MGA metres); at least 2 when given
    control_points: list[tuple[tuple[float, float], tuple[float, float]]] | None = Field(default=None, max_length=20)
    boundary_rgb: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{6}$")
    tolerance_m: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    job_number: str | None = Field(default=None, max_length=120)
    asset_owner: str | None = Field(default=None, max_length=120)
    plan_reference: str | None = Field(default=None, max_length=120)
    plan_date: str | None = None
    plan_expiry_date: str | None = None

    @field_validator("plan_date", "plan_expiry_date")
    @classmethod
    def _d(cls, v: str | None) -> str | None:
        return _iso(v)


RASTER_MESSAGE = "THIS PLAN IS A SCAN OR IMAGE WITHOUT VECTOR LINES. TRACE THE SERVICES MANUALLY WITH THE TRACE SERVICE TOOL"


def draft_objects(assets: list[Any], plan: dict[str, Any], req: ParseRequest) -> list[dict[str, Any]]:
    """Draft service_existing objects from parsed SA4 assets: origin dbyd, verified false, status existing. Only what the plan or the request states is set: no owner,
    tolerance or expiry is invented, and the depth reference (top or invert) is left NOT SET because a plan depth does not say which it is.

    BASIS. What the parser read off the plan (the service kind from the line colour, the diameter, the material, the depth and its depth basis) carries the basis
    ``plan_indicated``: it is a plan's statement, not a measurement and not the user's entry. What the user typed with the upload or the parse request (owner, job number,
    plan reference, dates, tolerance) is the user's own entry and carries ``user``."""
    from shapely import wkt as shp_wkt
    out: list[dict[str, Any]] = []
    ref = "DBYD PLAN PARSE, UNVERIFIED DRAFT"

    def u(v: Any, r: str = ref) -> dict[str, Any]:
        return {"value": v, "basis": "user", "ref": r}

    def pi(v: Any) -> dict[str, Any]:
        return {"value": v, "basis": "plan_indicated", "ref": f"{ref}: {plan['name']}"[:200]}
    for n, a in enumerate(assets, 1):
        g = shp_wkt.loads(a.geometry_wkt)
        params: dict[str, Any] = {"service_kind": pi(SERVICE_OF_SA4.get(a.service, "other")), "source_file": pi(plan["name"])}
        for k, v in (("asset_owner", req.asset_owner or plan.get("asset_owner")), ("dbyd_job_number", req.job_number or plan.get("job_number")),
                     ("plan_reference", req.plan_reference or plan.get("plan_reference")), ("plan_date", req.plan_date or plan.get("plan_date")), ("plan_expiry_date", req.plan_expiry_date)):
            if v:
                params[k] = u(v, "ENTERED WITH THE PLAN")
        if a.diameter_mm is not None:
            params["diameter_mm"] = pi(float(a.diameter_mm))
        if a.material:
            params["material"] = pi(a.material)
        if a.depth_m is not None:
            params["depth_m"] = pi(float(a.depth_m))
            params["depth_basis"] = pi("plan_indicated")
        if req.tolerance_m is not None:
            params["position_tolerance_m"] = u(req.tolerance_m, "ENTERED BY THE USER")
        out.append({"id": f"dbyd_{plan['plan_id'][:8]}_{n}", "type": "service_existing", "status": "existing", "origin": "dbyd", "verified": False, "label": f"{a.service.upper()} (DBYD DRAFT)",
                    "geometry": {"kind": "polyline", "pts": [[round(x, 4), round(y, 4)] for x, y in g.coords]}, "params": params})
    return out


@router.post("/projects/{project_id}/dbyd/plans/{plan_id}/parse")
async def parse_plan(project_id: UUID, plan_id: str, body: ParseRequest, request: Request, _user: UUID = Depends(site_design_access)) -> JSONResponse:
    rec, path = _plan(request, project_id, plan_id)
    if rec["kind"] != "pdf":
        return JSONResponse(content={"objects": [], "code": "DBYD_FORMAT_UNSUPPORTED", "message": f"A {rec['kind'].upper()} PLAN IS NOT READ AUTOMATICALLY. TRACE THE SERVICES MANUALLY WITH THE TRACE SERVICE TOOL",
                                     "plan": rec})
    if body.control_points is not None and len(body.control_points) < 2:
        raise ApiError(422, "BAD_CONTROL_POINTS", "GIVE AT LEAST TWO CONTROL POINTS")
    base = site_design_base(request)
    terrain = _terrain_or_none(base, project_id)
    lot_ring = [list(p) for p in terrain.lot.exterior.coords] if terrain is not None and terrain.lot is not None else None
    cps = [[list(a), list(b)] for a, b in (body.control_points or [])]

    def work():
        return run_timeboxed(pdf_jobs.parse_plan, str(path), body.page, cps, body.scale_denominator, lot_ring, body.boundary_rgb.lower() if body.boundary_rgb else None,
                             body.tolerance_m if body.tolerance_m is not None else 1.0, timeout_s=PDF_TIME_LIMIT_S)
    try:
        res = await asyncio.get_running_loop().run_in_executor(None, work)
    except TimedOut:
        raise ApiError(422, "PDF_TIMEOUT", f"THE PDF TOOK MORE THAN {PDF_TIME_LIMIT_S:g} SECONDS TO READ AND WAS STOPPED. TRACE THE SERVICES MANUALLY WITH THE TRACE SERVICE TOOL") from None
    except ChildError as e:
        if e.error_code == "DBYD_RASTER_UNSUPPORTED":
            return JSONResponse(content={"objects": [], "code": e.error_code, "message": RASTER_MESSAGE, "plan": rec})
        if e.error_code == "DBYD_NO_ASSETS":
            return JSONResponse(content={"objects": [], "code": e.error_code, "message": "NO SERVICE LINES IN THE EXPECTED COLOURS WERE FOUND. TRACE THE SERVICES MANUALLY WITH THE TRACE SERVICE TOOL", "plan": rec})
        if e.error_code:
            raise ApiError(422, e.error_code, e.message.upper()[:300]) from None
        raise ApiError(422, "PDF_UNREADABLE", "THE PDF COULD NOT BE READ") from None
    assets = [SimpleNamespace(**a) for a in res["assets"]]
    geo = SimpleNamespace(**res["geo"])
    objs = draft_objects(assets, rec, body)
    return JSONResponse(content={"objects": objs, "plan": rec, "georeference": {"outcome": geo.outcome, "rmse_m": geo.rmse_m, "max_residual_m": geo.max_residual_m,
                                                                             "control_points": geo.n_points, "messages": [m.upper() for m in geo.messages]},
                                 "label": "DRAFT SERVICES FROM THE PLAN: UNVERIFIED, INDICATIVE ONLY. SET THE DEPTH REFERENCE, OWNER, TOLERANCE AND PLAN EXPIRY, THEN VERIFY EACH SERVICE",
                                 "tolerance_note": "THE POSITIONAL TOLERANCE IS SET ONLY IF YOU GAVE IT" if body.tolerance_m is None else None},
                        headers={"Cache-Control": "no-store"})


@router.post("/integrations/byda/webhook/{project_id}")
async def byda_webhook(project_id: UUID, request: Request, cfg: BydaConfig = Depends(byda_config)) -> JSONResponse:
    """BYDA calls this when an enquiry changes. Protected by the shared secret in X-JCE-Webhook-Secret (the signature scheme is UNCONFIRMED), a timestamp within 5 minutes
    (X-JCE-Webhook-Timestamp) and a delivery id that has not been seen before (X-JCE-Webhook-Delivery-Id; a repeat is 409). Only a project that has already lodged an
    enquiry accepts events; nothing else is created."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > W.MAX_BODY_BYTES:
        raise ApiError(413, "BODY_TOO_LARGE", "THE WEBHOOK BODY IS TOO LARGE")
    body = await request.body()
    if len(body) > W.MAX_BODY_BYTES:
        raise ApiError(413, "BODY_TOO_LARGE", "THE WEBHOOK BODY IS TOO LARGE")
    try:
        delivery_id = W.verify(cfg, request.headers.get(W.SECRET_HEADER), body, request.headers.get(cfg.webhook_hmac_header) if cfg.webhook_hmac_header else None,
                               request.headers.get(W.TIMESTAMP_HEADER), request.headers.get(W.DELIVERY_HEADER))
    except W.WebhookAuthError as e:
        raise ApiError(e.status, e.code, e.message) from None
    st = _store(request, project_id)
    if not st.exists() or not st.enquiries():
        raise ApiError(404, "PROJECT_NOT_FOUND", "NO DBYD ENQUIRY FOR THIS PROJECT")
    if not st.claim_delivery(delivery_id):
        raise ApiError(409, "WEBHOOK_REPLAY", "THIS DELIVERY ID WAS ALREADY RECEIVED")
    ev = W.read_event(body)
    st.add_event(ev)
    return JSONResponse(content={"received": True}, status_code=202)


router.include_router(plan_upload_router)
