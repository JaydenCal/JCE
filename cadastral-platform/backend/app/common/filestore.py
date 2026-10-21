"""Atomic JSON file writes and a per file lock that holds across threads AND across processes.

* ``file_lock(path)`` takes an exclusive ``fcntl.flock`` on a sidecar ``<path>.lock`` file (so two worker processes serialise a read, compare and write) and a
  per path thread lock (so threads of one process serialise too). Nothing else is locked. The lock file is left in place (it holds no data).
* ``atomic_write_text(path, text)`` writes a UNIQUE temporary file in the same folder, flushes it to disk and renames it over the target, so a reader sees the old
  file or the new file, never a half written one, and two writers never share a temporary name.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, Iterator

_THREAD_LOCKS: dict[str, threading.Lock] = {}
_REGISTRY = threading.Lock()


def _thread_lock(key: str) -> threading.Lock:
    with _REGISTRY:
        return _THREAD_LOCKS.setdefault(key, threading.Lock())


@contextlib.contextmanager
def file_lock(path: Path | str) -> Iterator[None]:
    """Exclusive lock for ``path`` (the data file itself is not opened). Blocks until it is free."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with _thread_lock(str(p.resolve())):
        fd = os.open(str(p) + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


@contextlib.contextmanager
def file_locks(*paths: Path | str) -> Iterator[None]:
    """Several file locks, always taken in sorted order so two callers cannot deadlock each other."""
    with contextlib.ExitStack() as stack:
        for p in sorted({str(Path(x)) for x in paths}):
            stack.enter_context(file_lock(p))
        yield


def atomic_write_bytes(path: Path | str, data: bytes) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=p.name + ".", suffix=".tmp", dir=str(p.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def atomic_write_text(path: Path | str, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path | str, value: Any, **kw: Any) -> None:
    atomic_write_text(path, json.dumps(value, **kw))
