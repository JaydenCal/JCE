"""Request dependencies: error type, user context, DB transaction, Terms gate."""
from __future__ import annotations

from typing import Iterator
from uuid import UUID

from fastapi import Depends, Header, Request
from psycopg import Connection

from app.common.db import user_connection


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str = "", **extra) -> None:
        self.status, self.code, self.message, self.extra = status, code, message, extra


def current_user_id(x_user_id: str | None = Header(default=None)) -> UUID:
    """DEV STUB, TO BE REPLACED BY REAL AUTHENTICATION.

    Trusts the caller-supplied ``X-User-Id`` header, i.e. anyone can act as anyone.
    It must never be exposed outside local development. The replacement must verify a
    session/JWT and return the authenticated user's id; everything downstream (RLS via
    ``app.user_id``, Terms gate, acknowledgements) keys off this one dependency.
    """
    if not x_user_id:
        raise ApiError(401, "UNAUTHENTICATED", "X-User-Id header required (dev stub)")
    try:
        return UUID(x_user_id)
    except ValueError:
        raise ApiError(401, "UNAUTHENTICATED", "X-User-Id must be a UUID") from None


def optional_user_id(x_user_id: str | None = Header(default=None)) -> UUID | None:
    try:
        return UUID(x_user_id) if x_user_id else None
    except ValueError:
        return None


def get_conn(request: Request, user_id: UUID = Depends(current_user_id)) -> Iterator[Connection]:
    """A transaction with ``SET LOCAL app.user_id`` applied; commits when the request ends."""
    with user_connection(request.app.state.pool, user_id) as conn:
        yield conn


def require_terms(user_id: UUID = Depends(current_user_id), conn: Connection = Depends(get_conn)) -> UUID:
    ok = conn.execute("SELECT legal.has_accepted_current_terms(%s) AS ok", (user_id,)).fetchone()["ok"]
    if not ok:
        raise ApiError(403, "TERMS_NOT_ACCEPTED", "You must accept the current Terms of Use")
    return user_id


def require_project(project_id: UUID, conn: Connection) -> None:
    ok = conn.execute("SELECT core.can_access_project(%s) AS ok", (project_id,)).fetchone()["ok"]
    if not ok:
        raise ApiError(404, "PROJECT_NOT_FOUND", "project not found")
