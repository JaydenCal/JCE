"""Worker functions for tests that need a separate process (importable by a spawned interpreter)."""
from __future__ import annotations

import json
import time
from pathlib import Path


def increment(path: str, n: int) -> None:
    """Read, add one and write a counter n times under the per file lock (several processes run this at once)."""
    from app.common.filestore import atomic_write_json, file_lock
    p = Path(path)
    for _ in range(n):
        with file_lock(p):
            v = json.loads(p.read_text()) if p.exists() else 0
            atomic_write_json(p, v + 1)


def sleep_job(seconds: float) -> str:
    time.sleep(seconds)
    return "done"


def quick_job(x: int) -> int:
    return x * 2


def failing_job() -> None:
    from app.agents.base import AgentError
    raise AgentError("SOME_CODE", "went wrong")
