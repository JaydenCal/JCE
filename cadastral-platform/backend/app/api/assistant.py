"""Design assistant routes. Terms-gated like the other routers. State lives in app.state.assistant_store (in-memory by
default; see app.design.assistant.store.ModelStore for the persistence seam)."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from psycopg import Connection

from app.agents.sa8_layout import from_brief
from app.api.deps import ApiError, get_conn, require_project, require_terms
from app.design.assistant import AnthropicClient, AssistantContext, DesignAssistant, InMemoryModelStore, ModelState
from app.design.assistant.engine import snapshot

router = APIRouter()


class AssistantIn(BaseModel):
    message: str = Field(max_length=2000)
    selected_element_id: str | None = Field(default=None, max_length=64)
    history_token: int | None = None      # the undo_token the client last saw; mismatch -> 409


def _store(request: Request):
    s = getattr(request.app.state, "assistant_store", None)
    if s is None:
        s = request.app.state.assistant_store = InMemoryModelStore()
    return s


def _llm(request: Request):
    c = getattr(request.app.state, "assistant_llm", None)
    if c is None:
        c = request.app.state.assistant_llm = AnthropicClient()
    return c


def _state(request: Request, pid: UUID) -> ModelState:
    store = _store(request)
    st = store.get(str(pid))
    if st is None:
        factory = getattr(request.app.state, "assistant_model_factory", None)
        st = ModelState(factory(pid) if factory else from_brief(3, 2, "double", 1, "contemporary", name="Starter layout"))
        store.put(str(pid), st)
    return st


def _context(request: Request, conn: Connection, pid: UUID) -> AssistantContext:
    fn = getattr(request.app.state, "assistant_context", None)
    return fn(conn, pid) if fn else AssistantContext()


def _out(res) -> dict:
    return res.to_dict()


@router.get("/projects/{project_id}/design/model")
def get_model(project_id: UUID, request: Request, _: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)):
    require_project(project_id, conn)
    st = _state(request, project_id)
    llm = _llm(request)
    out = _out(snapshot(st))
    out["assistant"] = {"configured": bool(getattr(llm, "configured", True)), "model": llm.model}
    return out


@router.post("/projects/{project_id}/design/assistant")
def assistant_turn(project_id: UUID, body: AssistantIn, request: Request, _: UUID = Depends(require_terms),
                   conn: Connection = Depends(get_conn)):
    require_project(project_id, conn)
    llm = _llm(request)
    st = _state(request, project_id)
    with _store(request).lock(str(project_id)):
        if body.history_token is not None and body.history_token != len(st.turns):
            raise ApiError(409, "STALE_HISTORY", "The model changed since you last loaded it", undo_token=len(st.turns))
        if not getattr(llm, "configured", True):
            res = snapshot(st)
            res.status = "not_configured"
            res.message = "The design assistant is not configured on this server (ANTHROPIC_API_KEY is not set)."
            return _out(res)
        res = DesignAssistant(llm, st, _context(request, conn, project_id)).turn(body.message, body.selected_element_id)
        _store(request).put(str(project_id), st)
    return _out(res)


def _history_op(project_id: UUID, request: Request, conn: Connection, which: str):
    require_project(project_id, conn)
    st = _state(request, project_id)
    with _store(request).lock(str(project_id)):
        changed = getattr(st, which)()
        _store(request).put(str(project_id), st)
    res = snapshot(st)
    res.message = ("Undone." if which == "undo" else "Redone.") if changed else f"Nothing to {which}."
    return _out(res)


@router.post("/projects/{project_id}/design/undo")
def undo(project_id: UUID, request: Request, _: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)):
    return _history_op(project_id, request, conn, "undo")


@router.post("/projects/{project_id}/design/redo")
def redo(project_id: UUID, request: Request, _: UUID = Depends(require_terms), conn: Connection = Depends(get_conn)):
    return _history_op(project_id, request, conn, "redo")
