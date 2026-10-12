"""PostgreSQL access helpers (psycopg 3).

* ``make_pool``       - a sync connection pool whose rows are dicts.
* ``user_connection`` - a pooled transaction with ``app.user_id`` set, which is what
                        every row-level-security policy in db/001_schema.sql reads.
* ``put_payload`` / ``get_payload`` - the content-addressed ``agents.payloads`` store.

``app.user_id`` is applied with ``set_config(..., is_local => true)``, which is
exactly ``SET LOCAL`` but can take a bind parameter (``SET LOCAL`` cannot). It lasts
until the surrounding transaction ends, so never ``conn.commit()`` mid-block and
expect the user context to survive; open a new ``user_connection`` instead.
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from typing import Any, Iterator
from uuid import UUID

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from app.common.contracts import PayloadRef, canonical_json, sha256_hex

import json

_SCHEMA_RE = re.compile(r"^(?P<name>[a-z0-9_]+)\.v(?P<ver>\d+)$")


def make_pool(
    dsn: str,
    *,
    min_size: int = 2,
    max_size: int = 16,
    timeout: float = 30.0,
    application_name: str = "cadastral-platform",
) -> ConnectionPool:
    """Open a pool. Rows come back as dicts. Connections are health-checked on checkout."""
    pool = ConnectionPool(
        conninfo=dsn,
        min_size=min_size,
        max_size=max_size,
        timeout=timeout,
        kwargs={"row_factory": dict_row, "application_name": application_name},
        check=ConnectionPool.check_connection,
        open=False,
    )
    pool.open(wait=True, timeout=timeout)
    return pool


def set_user(conn: Connection, user_id: UUID | str | None) -> None:
    """Equivalent to ``SET LOCAL app.user_id = '<uuid>'`` for the current transaction."""
    conn.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id) if user_id else "",))


@contextmanager
def user_connection(pool: ConnectionPool, user_id: UUID | str | None) -> Iterator[Connection]:
    """One transaction on a pooled connection, scoped to ``user_id`` for RLS.

    Commits on normal exit, rolls back on exception.
    """
    with pool.connection() as conn:
        set_user(conn, user_id)
        yield conn


def parse_schema_name(schema_name: str) -> tuple[str, int]:
    """'lot_context.v1' -> ('lot_context', 1)."""
    m = _SCHEMA_RE.match(schema_name)
    if not m:
        raise ValueError(f"schema name must look like 'name.v1', got {schema_name!r}")
    return m.group("name"), int(m.group("ver"))


def put_payload(conn: Connection, schema_name: str, body: Any) -> PayloadRef:
    """Store ``body`` (JSON-serialisable) content-addressed by sha256 of its canonical JSON.

    Identical bodies are stored once (``ON CONFLICT (sha256)``) and the existing row is
    returned. Dedupe is by content only, so two schema names with byte-identical bodies
    share a row and the ref carries the schema name of the first writer.
    """
    _, version = parse_schema_name(schema_name)
    raw = canonical_json(body)
    digest = bytes.fromhex(sha256_hex(raw))
    conn.execute(
        """
        INSERT INTO agents.payloads (sha256, schema_name, schema_version, body_json, byte_size)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (sha256) DO NOTHING
        """,
        (digest, schema_name, version, Jsonb(json.loads(raw)), len(raw)),
    )
    row = conn.execute(
        "SELECT payload_id, schema_name, byte_size FROM agents.payloads WHERE sha256 = %s",
        (digest,),
    ).fetchone()
    assert row is not None
    return PayloadRef(
        payload_id=row["payload_id"],
        sha256=digest.hex(),
        schema_name=row["schema_name"],
        byte_size=row["byte_size"],
    )


def get_payload(conn: Connection, payload_id: UUID) -> Any:
    """Return the JSON body of a stored payload. Raises KeyError if absent or externalised."""
    row = conn.execute(
        "SELECT body_json, storage_uri FROM agents.payloads WHERE payload_id = %s", (payload_id,)
    ).fetchone()
    if row is None:
        raise KeyError(f"payload {payload_id} not found")
    if row["body_json"] is None:
        raise KeyError(f"payload {payload_id} is stored externally at {row['storage_uri']}")
    return row["body_json"]
