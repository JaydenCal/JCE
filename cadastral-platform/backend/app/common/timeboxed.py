"""Run a function in a SEPARATE PROCESS with a time limit, so a runaway job (a PDF that takes minutes to render or parse) is killed, not merely abandoned.

``run_timeboxed(fn, *args, timeout_s=...)`` starts a fresh (spawned) interpreter, runs ``fn(*args)`` there and returns its result, or raises ``TimedOut`` after
``timeout_s`` seconds and kills the process. ``fn`` and its arguments and result must be picklable (a module level function; plain data). An exception in the child comes
back as ``ChildError`` carrying the exception class name, an optional ``error_code`` attribute and the message (the exception object itself is not sent across).
A spawned interpreter costs a fraction of a second, which is why this is used for PDF work only.
"""
from __future__ import annotations

import multiprocessing as mp
import time
from typing import Any, Callable


class TimedOut(Exception):
    pass


class ChildError(Exception):
    def __init__(self, kind: str, error_code: str | None, message: str) -> None:
        super().__init__(message)
        self.kind, self.error_code, self.message = kind, error_code, message


def _entry(conn: Any, fn: Callable[..., Any], args: tuple) -> None:
    try:
        conn.send(("ok", fn(*args)))
    except BaseException as e:                                   # noqa: BLE001  (everything is reported to the parent; nothing is raised in the child)
        try:
            conn.send(("err", type(e).__name__, getattr(e, "error_code", None), str(getattr(e, "detail", None) or e)[:500]))
        except Exception:                                        # noqa: BLE001
            pass
    finally:
        conn.close()


def run_timeboxed(fn: Callable[..., Any], *args: Any, timeout_s: float) -> Any:
    ctx = mp.get_context("spawn")
    recv, send = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_entry, args=(send, fn, args), daemon=True)
    proc.start()
    send.close()
    deadline = time.monotonic() + timeout_s
    try:
        if not recv.poll(max(0.0, deadline - time.monotonic())):
            raise TimedOut()
        try:
            msg = recv.recv()
        except EOFError:
            raise ChildError("ChildDied", None, "THE WORKER PROCESS ENDED WITHOUT A RESULT") from None
    finally:
        recv.close()
        if proc.is_alive():
            proc.kill()
        proc.join(5)
    if msg[0] == "ok":
        return msg[1]
    raise ChildError(msg[1], msg[2], msg[3])
