"""FastAPI gateway. Every endpoint except the two legal ones requires accepted Terms."""
from __future__ import annotations

import ipaddress
import logging
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from psycopg import Connection, errors as pgerr
from pydantic import BaseModel, Field

from app.api.deps import (ApiError, current_user_id, get_conn, optional_user_id, require_project,
                          require_terms)
from app.api.design import router as design_router
from app.api.settings import Settings
from app.api.uploads import safe_filename, store_pdf
from app.common.contracts import AckKind
from app.common.db import make_pool, user_connection
from app.orchestrator.core import (GateBlocked, InvalidRunState, Orchestrator, OrchestratorConfig,
                                   RunNotFound)
from app.common.contracts import DevelopmentType
from app.orchestrator.inputs import RunRequest

log = logging.getLogger(__name__)


class AcceptBody(BaseModel):
    terms_version_id: UUID
    body_sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    scrolled_to_end: bool


class AckBody(BaseModel):
    kinds: list[AckKind] = Field(min_length=1)
    subject_table: str | None = None
    subject_id: UUID | None = None
    subject_sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")


def _run_background(orch: Orchestrator, run_id: UUID, user_id: UUID) -> None:
    try:
        orch.execute_run(run_id, user_id)
    except Exception:  # noqa: BLE001
        log.exception("background execution of run %s failed", run_id)


def create_app(settings: Settings | None = None, pool=None, orchestrator: Orchestrator | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        own_pool = None
        if getattr(app.state, "pool", None) is None:
            if not settings.database_url:
                raise RuntimeError("DATABASE_URL is not set")
            own_pool = make_pool(settings.database_url, max_size=settings.pool_max_size)
            app.state.pool = own_pool
        if getattr(app.state, "orchestrator", None) is None:
            app.state.orchestrator = Orchestrator(app.state.pool, config=OrchestratorConfig(
                export_dir=settings.export_dir, default_token_budget=settings.default_token_budget))
        yield
        if own_pool is not None:
            own_pool.close()

    app = FastAPI(title="Cadastral Platform API", lifespan=lifespan)
    app.state.settings = settings
    app.state.pool = pool
    if orchestrator is not None:
        app.state.orchestrator = orchestrator
        app.state.pool = app.state.pool or orchestrator.pool

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return JSONResponse(status_code=e.status, content={"code": e.code, "message": e.message, **e.extra})

    @app.exception_handler(GateBlocked)
    async def _gate(_: Request, e: GateBlocked):
        return JSONResponse(status_code=403, content={"code": e.code, "message": e.detail, "missing": e.missing})

    @app.exception_handler(RunNotFound)
    async def _nf(_: Request, e: RunNotFound):
        return JSONResponse(status_code=404, content={"code": "RUN_NOT_FOUND", "message": str(e)})

    @app.exception_handler(InvalidRunState)
    async def _state(_: Request, e: InvalidRunState):
        return JSONResponse(status_code=409, content={"code": "INVALID_RUN_STATE", "message": str(e)})

    def orch(request: Request) -> Orchestrator:
        return request.app.state.orchestrator

    # ------------------------------------------------------------------ legal

    @app.get("/legal/terms/current")
    def terms_current(request: Request, user_id: UUID | None = Depends(optional_user_id)):
        with user_connection(request.app.state.pool, user_id) as conn:
            t = conn.execute(
                "SELECT terms_version_id, version_label, effective_from, body_markdown, "
                "encode(body_sha256,'hex') AS body_sha256 FROM legal.terms_versions WHERE is_current").fetchone()
            if t is None:
                raise ApiError(404, "NO_CURRENT_TERMS", "no current Terms published")
            accepted = None
            if user_id is not None:
                accepted = conn.execute("SELECT legal.has_accepted_current_terms(%s) AS ok",
                                        (user_id,)).fetchone()["ok"]
        return jsonable_encoder({**t, "accepted": accepted})

    @app.post("/legal/accept", status_code=201)
    def legal_accept(body: AcceptBody, request: Request, user_id: UUID = Depends(current_user_id),
                     conn: Connection = Depends(get_conn)):
        if not body.scrolled_to_end:
            raise ApiError(422, "SCROLL_REQUIRED", "the Terms must be scrolled to the end before accepting")
        t = conn.execute("SELECT terms_version_id, encode(body_sha256,'hex') AS d FROM legal.terms_versions "
                         "WHERE is_current").fetchone()
        if t is None or t["terms_version_id"] != body.terms_version_id:
            raise ApiError(409, "TERMS_VERSION_STALE", "these are not the current Terms; reload")
        if t["d"] != body.body_sha256.lower():
            raise ApiError(400, "DIGEST_MISMATCH", "digest does not match the published Terms text")
        ip = None
        if request.client:
            try:
                ip = str(ipaddress.ip_address(request.client.host))
            except ValueError:
                ip = None
        try:
            row = conn.execute(
                "INSERT INTO legal.terms_acceptances (user_id, terms_version_id, ip_address, user_agent, "
                "scrolled_to_end, body_sha256_seen) VALUES (%s,%s,%s::inet,%s,true,%s) "
                "ON CONFLICT (user_id, terms_version_id) DO NOTHING RETURNING acceptance_id",
                (user_id, body.terms_version_id, ip, request.headers.get("user-agent"),
                 bytes.fromhex(body.body_sha256))).fetchone()
        except pgerr.ForeignKeyViolation:
            raise ApiError(401, "UNKNOWN_USER", "user does not exist") from None
        return {"accepted": True, "already_accepted": row is None,
                "acceptance_id": str(row["acceptance_id"]) if row else None}

    # ------------------------------------------------------------------- runs

    @app.post("/runs", status_code=202)
    def post_run(body: RunRequest, background: BackgroundTasks, request: Request,
                 user_id: UUID = Depends(require_terms)):
        o = orch(request)
        run = o.create_run(user_id, body)
        background.add_task(_run_background, o, run.run_id, user_id)
        return {"run_id": str(run.run_id), "status": run.status}

    @app.get("/runs/{run_id}")
    def get_run(run_id: UUID, request: Request, user_id: UUID = Depends(require_terms)):
        return jsonable_encoder(orch(request).get_run(run_id, user_id))

    @app.post("/runs/{run_id}/cancel")
    def cancel_run(run_id: UUID, request: Request, user_id: UUID = Depends(require_terms)):
        return {"run_id": str(run_id), "cancelled": orch(request).cancel_run(run_id, user_id)}

    # ------------------------------------------------------------------ plans

    @app.post("/projects/{project_id}/plans", status_code=201)
    def upload_plan(project_id: UUID, request: Request, background: BackgroundTasks,
                    file: UploadFile = File(...), upload_rights_warranty: bool = Form(...),
                    selected_page: int | None = Form(default=None),
                    development_type: DevelopmentType = Form(default=DevelopmentType.dwelling_house),
                    user_id: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)):
        require_project(project_id, conn)
        if not upload_rights_warranty:
            raise ApiError(422, "UPLOAD_RIGHTS_REQUIRED", "you must warrant you hold the rights to upload this plan")
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > settings.max_upload_bytes + 64 * 1024:
            raise ApiError(413, "FILE_TOO_LARGE", f"limit is {settings.max_upload_bytes} bytes")
        pdf = store_pdf(file.file, file.content_type, settings.upload_dir, settings.max_upload_bytes)
        if selected_page is not None and not 1 <= selected_page <= pdf.page_count:
            raise ApiError(422, "BAD_PAGE", f"selected_page must be 1..{pdf.page_count}")
        terms_id = conn.execute("SELECT terms_version_id FROM legal.terms_versions WHERE is_current").fetchone()[
            "terms_version_id"]
        row = conn.execute(
            "INSERT INTO plans.plan_uploads (project_id, uploaded_by, original_filename, storage_uri, "
            "file_sha256, byte_size, page_count, selected_page, pdf_producer, pdf_creator, content_class, "
            "page_width_pt, page_height_pt, rotation_deg, upload_rights_acknowledged) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true) RETURNING upload_id",
            (project_id, user_id, safe_filename(file.filename), f"file://{pdf.path}",
             bytes.fromhex(pdf.sha256), pdf.byte_size, pdf.page_count, selected_page, pdf.producer, pdf.creator,
             pdf.content_class, pdf.page_width_pt, pdf.page_height_pt, pdf.rotation_deg)).fetchone()
        upload_id = row["upload_id"]
        conn.execute(
            "INSERT INTO legal.project_acknowledgements (project_id, user_id, kind, terms_version_id, "
            "subject_table, subject_id, subject_sha256) VALUES (%s,%s,'upload_rights_warranty',%s,"
            "'plans.plan_uploads',%s,%s) ON CONFLICT DO NOTHING",
            (project_id, user_id, terms_id, upload_id, bytes.fromhex(pdf.sha256)))
        conn.commit()    # make the upload visible to the run before it starts
        o = orch(request)
        run = o.create_run(user_id, RunRequest(project_id=project_id, upload_id=upload_id,
                                               targets=["SA7"], params={}, development_type=development_type))
        background.add_task(_run_background, o, run.run_id, user_id)
        return {"upload_id": str(upload_id), "sha256": pdf.sha256, "page_count": pdf.page_count,
                "run_id": str(run.run_id), "status": "uploaded"}

    # -------------------------------------------------------- acknowledgements

    @app.post("/projects/{project_id}/acknowledgements", status_code=201)
    def post_acks(project_id: UUID, body: AckBody, request: Request, user_id: UUID = Depends(require_terms),
                  conn: Connection = Depends(get_conn)):
        require_project(project_id, conn)
        terms_id = conn.execute("SELECT terms_version_id FROM legal.terms_versions WHERE is_current").fetchone()[
            "terms_version_id"]
        ip = None
        if request.client:
            try:
                ip = str(ipaddress.ip_address(request.client.host))
            except ValueError:
                pass
        recorded = 0
        for kind in dict.fromkeys(body.kinds):
            r = conn.execute(
                "INSERT INTO legal.project_acknowledgements (project_id, user_id, kind, terms_version_id, "
                "subject_table, subject_id, subject_sha256, ip_address) "
                "VALUES (%s,%s,%s::legal.acknowledgement_kind,%s,%s,%s,%s,%s::inet) ON CONFLICT DO NOTHING "
                "RETURNING acknowledgement_id",
                (project_id, user_id, kind.value, terms_id, body.subject_table, body.subject_id,
                 bytes.fromhex(body.subject_sha256) if body.subject_sha256 else None, ip)).fetchone()
            recorded += r is not None
        missing = conn.execute("SELECT legal.export_gate_missing(%s,%s)::text[] AS m",
                               (project_id, user_id)).fetchone()["m"]
        return {"recorded": recorded, "export_gate_missing": list(missing)}

    app.include_router(design_router)
    from app.api.assistant import router as assistant_router
    app.include_router(assistant_router)
    from app.api.enquiries import router as enquiries_router
    app.include_router(enquiries_router)
    from app.api.scene import router as scene_router
    app.include_router(scene_router)
    from app.api.site_design import router as site_design_router
    app.include_router(site_design_router)
    return app
