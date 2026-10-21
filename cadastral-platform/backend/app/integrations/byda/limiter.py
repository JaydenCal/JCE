"""A sliding window rate limiter per key (the user id): at most ``max_events`` in ``window_s`` seconds. In process memory: with several worker processes the limit applies
per process, so the deployment must either run one worker for this route or put the limit in front (documented in docs/19)."""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable


class RateLimited(Exception):
    def __init__(self, retry_after_s: int) -> None:
        super().__init__("RATE LIMITED")
        self.retry_after_s = retry_after_s


class RateLimiter:
    def __init__(self, max_events: int, window_s: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.max_events, self.window_s, self.clock = max_events, window_s, clock
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> None:
        """Record one event for ``key`` or raise ``RateLimited``. A refused event is not recorded."""
        now = self.clock()
        with self._lock:
            q = self._events.setdefault(key, deque())
            while q and now - q[0] >= self.window_s:
                q.popleft()
            if len(q) >= self.max_events:
                raise RateLimited(max(1, int(self.window_s - (now - q[0])) + 1))
            q.append(now)
            if len(self._events) > 10_000:                      # forget keys with no recent events
                for k in [k for k, v in self._events.items() if not v or now - v[-1] >= self.window_s]:
                    del self._events[k]

    def remaining(self, key: str) -> int:
        now = self.clock()
        with self._lock:
            q = self._events.get(key, deque())
            return max(0, self.max_events - sum(1 for t in q if now - t < self.window_s))
