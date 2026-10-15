"""At most one scene rebuild of a project runs at a time (``POST /projects/{id}/scene/rebuild``).

A rebuild calls the terrain and aerial services and rewrites ``scene_bundle.json``; two at once would race on the file and double the calls. The lease is a small file in the project folder
(``scene_rebuild.lease``, the start time in seconds) taken under the file lock of the project, so it holds across threads and worker processes. It is released when the rebuild ends, whether
it succeeded or not, and it expires after ``TTL_S`` so a crashed process cannot block the project for good.
"""
from __future__ import annotations

import contextlib
import time
from pathlib import Path

from app.common.filestore import atomic_write_text, file_lock

LEASE_FILE = "scene_rebuild.lease"
TTL_S = 20 * 60


def claim(folder: Path, now: float | None = None, ttl_s: float = TTL_S) -> bool:
    """True when this caller now holds the lease; False when a rebuild of the project is already active."""
    t = time.time() if now is None else now
    path = folder / LEASE_FILE
    with file_lock(path):
        try:
            started = float(path.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            started = None
        if started is not None and 0 <= t - started < ttl_s:
            return False
        atomic_write_text(path, repr(t))
        return True


def release(folder: Path) -> None:
    with file_lock(folder / LEASE_FILE):
        with contextlib.suppress(OSError):
            (folder / LEASE_FILE).unlink()
