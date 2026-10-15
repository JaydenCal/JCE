"""Usage guard for the platform's AI features (stage 10): configuration, cost arithmetic, the pre-flight estimate, global spend caps and per project rate limits.

Ported from Plan Studio (``server/lib/config.js``, ``credits.js``, ``anthropic.js``) and kept to the same rules:

* Prices are USD per million tokens, which is the same number as micro-USD per token, so all arithmetic is in micro-USD and exact. A cache write costs 1.25 times an input
  token and a cache read 0.1 times (``CACHE_WRITE_MULT`` and ``CACHE_READ_MULT``).
* The estimate is characters divided by 3.5 for the prompt, the system prompt and the tools priced as a cache write (worst case), and the output priced at ``max_tokens``.
* Daily and monthly spend caps are global (all projects). When either is reached the AI does not run (``AI_PAUSED``); nothing is lost, the rules path still works.
* The cap check and the reservation are ONE step under the store lock (``UsageStore.reserve``): before each model call the worst case cost of that call is reserved, so two
  requests that arrive together cannot both pass a cap that has room for one. The reservation is settled after the call (the real cost replaces it) or released when the call
  failed. A reservation older than ``RESERVE_TTL_S`` is dropped, so a crashed worker cannot hold the cap.
* Rate limits are fixed windows, per project (``rate_per_min``, ``rate_per_day``) AND global over all projects (``global_rate_per_min``, ``global_rate_per_day``).
* A request estimated above ``confirm_usd`` needs the caller to confirm it (``CONFIRM_REQUIRED``).
* Spend is recorded for every call that returned (even one whose answer is ignored because the deadline had passed). A call that failed has no usage and adds nothing.
* Every successful call is also appended to a usage log (one JSON line: time, project, model, tokens, cost). The log never holds a prompt or an answer.

The numbers here are configuration (environment variables ``JCESITE_AI_*``), not engineering values. Nothing in this module touches a design.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from app.common.filestore import atomic_write_text, file_lock

from .assistant.llm import DEFAULT_MODEL, Usage, resolve_model

CACHE_WRITE_MULT = 1.25
CACHE_READ_MULT = 0.1
CHARS_PER_TOKEN = 3.5
PRUNE_DAYS = 62
RESERVE_TTL_S = 900                          # a reservation that was never settled (the worker died) is dropped after this long
USAGE_DIR = "_ai"
USAGE_LOG_MAX_BYTES = 5 * 1024 * 1024        # the usage log is rotated (the old file is replaced) when it passes this size


def _num(v: Any, default: float) -> float:
    if v is None or str(v).strip() == "":
        return default
    try:
        n = float(v)
    except ValueError:
        return default
    return n if math.isfinite(n) and n >= 0 else default


@dataclass(frozen=True)
class AiConfig:
    """AI settings read from the environment. Defaults follow Plan Studio's (Haiku class prices, 5 USD a day, 50 USD a month, 6 requests a minute, 150 a day)."""
    model: str = DEFAULT_MODEL
    price_in_per_mtok_usd: float = 0.1
    price_out_per_mtok_usd: float = 0.5
    max_output_tokens: int = 1500
    timeout_s: float = 30.0
    daily_cap_usd: float = 5.0
    monthly_cap_usd: float = 50.0
    rate_per_min: int = 6
    rate_per_day: int = 150
    global_rate_per_min: int = 20      # AI requests over all projects per minute
    global_rate_per_day: int = 1000    # AI requests over all projects per day
    confirm_usd: float = 0.01
    max_turns: int = 3                 # model calls per round (the tool use loop stops there, any set still undecided goes to the rules)
    api_key: str = field(default="", repr=False)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "AiConfig":
        e = os.environ if env is None else env
        g = lambda k: e.get("JCESITE_AI_" + k)           # noqa: E731
        return cls(
            model=resolve_model(None, e), price_in_per_mtok_usd=_num(g("PRICE_IN_PER_MTOK_USD"), 0.1), price_out_per_mtok_usd=_num(g("PRICE_OUT_PER_MTOK_USD"), 0.5),
            max_output_tokens=max(64, int(_num(g("MAX_OUTPUT_TOKENS"), 1500))), timeout_s=max(1.0, _num(g("TIMEOUT_S"), 30.0)),
            daily_cap_usd=_num(g("DAILY_CAP_USD"), 5.0), monthly_cap_usd=_num(g("MONTHLY_CAP_USD"), 50.0),
            rate_per_min=int(_num(g("RATE_PER_MIN"), 6)), rate_per_day=int(_num(g("RATE_PER_DAY"), 150)),
            global_rate_per_min=int(_num(g("GLOBAL_RATE_PER_MIN"), 20)), global_rate_per_day=int(_num(g("GLOBAL_RATE_PER_DAY"), 1000)),
            confirm_usd=_num(g("CONFIRM_USD"), 0.01), max_turns=max(1, min(6, int(_num(g("MAX_TURNS"), 3)))),
            api_key=(e.get("ANTHROPIC_API_KEY") or "").strip())

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)


# ---- cost arithmetic -----------------------------------------------------------------------------------------------------------------
def cost_micros(usage: Usage | Mapping[str, Any], cfg: AiConfig) -> float:
    """Cost of one request in micro-USD from the usage fields (input, output, cache write, cache read)."""
    if isinstance(usage, Usage):
        i, o, w, r = usage.input_tokens, usage.output_tokens, usage.cache_write_tokens, usage.cache_read_tokens
    else:
        i, o = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
        w, r = usage.get("cache_creation_input_tokens", 0), usage.get("cache_read_input_tokens", 0)
    pin, pout = cfg.price_in_per_mtok_usd, cfg.price_out_per_mtok_usd
    return int(i or 0) * pin + int(o or 0) * pout + int(w or 0) * CACHE_WRITE_MULT * pin + int(r or 0) * CACHE_READ_MULT * pin


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / CHARS_PER_TOKEN)


def estimate_request(cfg: AiConfig, *, prompt_tokens: int, system_tokens: int, calls: int = 1) -> dict[str, Any]:
    """Worst case cost of ``calls`` model calls: the prompt as input, the system prompt and tools as a cache write, the output at ``max_output_tokens``."""
    micros = calls * (prompt_tokens * cfg.price_in_per_mtok_usd + system_tokens * CACHE_WRITE_MULT * cfg.price_in_per_mtok_usd + cfg.max_output_tokens * cfg.price_out_per_mtok_usd)
    return {"calls": calls, "input_tokens": calls * (prompt_tokens + system_tokens), "output_tokens": calls * cfg.max_output_tokens, "cost_usd": round(micros / 1e6, 6),
            "cost_micros": micros, "requires_confirm": micros / 1e6 > cfg.confirm_usd + 1e-12, "confirm_usd": cfg.confirm_usd}


def estimate_call_micros(cfg: AiConfig, system: list[dict], tools: list[dict], messages: list[dict], max_tokens: int) -> float:
    """Worst case cost of ONE call, from the real request: the messages as input, the system prompt and the tools as a cache write, the output at ``max_tokens``."""
    msg_tokens = estimate_tokens(json.dumps(messages, default=str))
    sys_tokens = estimate_tokens(json.dumps(system, default=str) + json.dumps(tools, default=str))
    return msg_tokens * cfg.price_in_per_mtok_usd + sys_tokens * CACHE_WRITE_MULT * cfg.price_in_per_mtok_usd + max_tokens * cfg.price_out_per_mtok_usd


def period_keys(now_ms: float) -> tuple[str, str]:
    iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ms / 1000.0))
    return "d:" + iso[:10], "m:" + iso[:7]


# ---- the store: spend per period, rate windows and the usage log, in files under the project base folder ---------------------------------
class UsageStore:
    """Spend and rate counters in ``<base>/_ai/state.json`` (one file lock, atomic writes: safe across threads and worker processes) and the usage log ``usage.jsonl``."""

    def __init__(self, base: Path | str) -> None:
        self.dir = Path(base) / USAGE_DIR
        self.state_path = self.dir / "state.json"
        self.log_path = self.dir / "usage.jsonl"

    def _read(self) -> dict[str, Any]:
        try:
            d = json.loads(self.state_path.read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, d: dict[str, Any]) -> None:
        atomic_write_text(self.state_path, json.dumps(d, separators=(",", ":")))

    def get_spend(self, period: str) -> float:
        return float(self._read().get("spend", {}).get(period, 0.0))

    def add_spend(self, periods: tuple[str, ...], micros: float, now_ms: float) -> None:
        with file_lock(self.state_path):
            d = self._read()
            sp = d.setdefault("spend", {})
            for p in periods:
                sp[p] = float(sp.get(p, 0.0)) + float(micros)
            cutoff = "d:" + time.strftime("%Y-%m-%d", time.gmtime(now_ms / 1000.0 - PRUNE_DAYS * 86400))
            for k in [k for k in sp if k.startswith("d:") and k < cutoff]:
                del sp[k]
            self._write(d)

    def held(self) -> float:
        """Micro-USD held by reservations that are not settled and not expired."""
        now = time.time() * 1000
        return sum(float(r.get("micros", 0.0)) for r in self._read().get("reserved", {}).values() if isinstance(r, dict) and now - float(r.get("t", 0)) < RESERVE_TTL_S * 1000)

    def reserve(self, cfg: "AiConfig", est_micros: float, now_ms: float) -> "str | Refusal":
        """Check the daily and monthly caps and reserve ``est_micros`` as ONE step under the store lock. Returns the reservation token, or the Refusal (nothing is reserved)."""
        day, month = period_keys(now_ms)
        with file_lock(self.state_path):
            d = self._read()
            sp = d.get("spend", {})
            res = d.setdefault("reserved", {})
            for k in [k for k, r in res.items() if not isinstance(r, dict) or now_ms - float(r.get("t", 0)) >= RESERVE_TTL_S * 1000]:
                del res[k]
            held = sum(float(r.get("micros", 0.0)) for r in res.values())
            for period, cap in ((day, cfg.daily_cap_usd), (month, cfg.monthly_cap_usd)):
                spent = float(sp.get(period, 0.0))
                if spent >= cap * 1e6 - 1e-9:
                    return Refusal("AI_PAUSED", "The AI is paused for now because the spending cap has been reached. The design can still be produced by the rules without the AI.", 503,
                                   {"period": period, "cap_usd": cap, "spent_usd": round(spent / 1e6, 6)})
                if spent + held + est_micros > cap * 1e6:
                    return Refusal("AI_CAP_WOULD_BE_EXCEEDED", "This request could take the AI past its spending cap, so it was not run. The design can still be produced by the rules without the AI.", 503,
                                   {"period": period, "cap_usd": cap, "spent_usd": round(spent / 1e6, 6), "reserved_usd": round(held / 1e6, 6), "estimated_usd": round(est_micros / 1e6, 6)})
            token = uuid.uuid4().hex
            res[token] = {"micros": float(est_micros), "t": now_ms}
            self._write(d)
            return token

    def settle(self, token: str, actual_micros: float | None, now_ms: float) -> None:
        """Drop the reservation and, when the call returned (``actual_micros`` not None), add its real cost to the day and the month, in the same locked step."""
        day, month = period_keys(now_ms)
        with file_lock(self.state_path):
            d = self._read()
            d.setdefault("reserved", {}).pop(token, None)
            if actual_micros is not None:
                sp = d.setdefault("spend", {})
                for p in (day, month):
                    sp[p] = float(sp.get(p, 0.0)) + float(actual_micros)
            self._write(d)

    def hit_rate(self, key: str, window_s: int, now_ms: float) -> int:
        """Fixed window counter: the count in the current window, including this hit."""
        start = int(now_ms // (window_s * 1000)) * window_s * 1000
        with file_lock(self.state_path):
            d = self._read()
            rates = d.setdefault("rates", {})
            row = rates.get(key)
            count = row["count"] + 1 if isinstance(row, dict) and row.get("start") == start else 1
            rates[key] = {"start": start, "count": count}
            for k in [k for k, v in rates.items() if isinstance(v, dict) and v.get("start", 0) < now_ms - 2 * 86400 * 1000]:
                del rates[k]
            self._write(d)
        return count

    def log_call(self, record: dict[str, Any]) -> None:
        """Append one usage line (no content). The file is replaced by a fresh one when it passes ``USAGE_LOG_MAX_BYTES``."""
        with file_lock(self.log_path):
            self.dir.mkdir(parents=True, exist_ok=True)
            try:
                if self.log_path.stat().st_size > USAGE_LOG_MAX_BYTES:
                    self.log_path.replace(self.log_path.with_suffix(".1.jsonl"))
            except OSError:
                pass
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, separators=(",", ":")) + "\n")


# ---- the checks the API makes before a model call --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Refusal:
    """Why the AI may not run now. ``status`` is the HTTP status the API answers with."""
    code: str
    message: str
    status: int
    extra: dict[str, Any] = field(default_factory=dict)


def global_pause(store: UsageStore, cfg: AiConfig, now_ms: float, estimate_micros: float = 0.0) -> Refusal | None:
    """None when AI may run, otherwise the cap that has been reached (or that this request would pass)."""
    day, month = period_keys(now_ms)
    d, m = store.get_spend(day), store.get_spend(month)
    held = store.held()
    for period, spent, cap in ((day, d, cfg.daily_cap_usd), (month, m, cfg.monthly_cap_usd)):
        if spent >= cap * 1e6 - 1e-9:
            return Refusal("AI_PAUSED", "The AI is paused for now because the spending cap has been reached. Nothing was charged. The design can still be produced by the rules without the AI.",
                           503, {"period": period, "cap_usd": cap, "spent_usd": round(spent / 1e6, 6)})
        if estimate_micros and spent + held + estimate_micros > cap * 1e6:
            return Refusal("AI_CAP_WOULD_BE_EXCEEDED", "This request could take the AI past its spending cap, so it was not run. Nothing was charged. The design can still be produced by the rules without the AI.",
                           503, {"period": period, "cap_usd": cap, "spent_usd": round(spent / 1e6, 6), "estimated_usd": round(estimate_micros / 1e6, 6)})
    return None


def rate_limit(store: UsageStore, cfg: AiConfig, project_id: str, now_ms: float) -> Refusal | None:
    """Count one AI request against the per project and the global (all projects) per minute and per day limits. None when allowed."""
    per_min = store.hit_rate(f"ai:min:{project_id}", 60, now_ms)
    if per_min > cfg.rate_per_min:
        return Refusal("RATE_LIMITED", "AI requests are coming too quickly for this project. Wait a moment and try again, or produce the design by the rules.", 429,
                       {"retry_after": 60 - int(now_ms // 1000) % 60, "window": "minute"})
    per_day = store.hit_rate(f"ai:day:{project_id}", 86400, now_ms)
    if per_day > cfg.rate_per_day:
        return Refusal("RATE_LIMITED", "The daily limit of AI requests for this project has been reached. The design can still be produced by the rules.", 429,
                       {"retry_after": 86400 - int(now_ms // 1000) % 86400, "window": "day"})
    g_min = store.hit_rate("ai:min:ALL", 60, now_ms)
    if g_min > cfg.global_rate_per_min:
        return Refusal("RATE_LIMITED", "AI requests are coming too quickly across the platform. Wait a moment and try again, or produce the design by the rules.", 429,
                       {"retry_after": 60 - int(now_ms // 1000) % 60, "window": "minute", "scope": "global"})
    g_day = store.hit_rate("ai:day:ALL", 86400, now_ms)
    if g_day > cfg.global_rate_per_day:
        return Refusal("RATE_LIMITED", "The daily limit of AI requests across the platform has been reached. The design can still be produced by the rules.", 429,
                       {"retry_after": 86400 - int(now_ms // 1000) % 86400, "window": "day", "scope": "global"})
    return None


def record_success(store: UsageStore, cfg: AiConfig, project_id: str, model: str, usage: Usage, now_ms: float, purpose: str = "first_design") -> float:
    """Record the spend of ONE call that returned, and log it (model and token counts only). Returns the cost in micro-USD. Never called for a call that failed."""
    cost = cost_micros(usage, cfg)
    day, month = period_keys(now_ms)
    store.add_spend((day, month), cost, now_ms)
    store.log_call({"t": int(now_ms // 1000), "project": project_id, "purpose": purpose, "model": model, "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens,
                    "cache_write_tokens": usage.cache_write_tokens, "cache_read_tokens": usage.cache_read_tokens, "cost_usd_micros": round(cost)})
    return cost


# ---- the gate in front of every model call ---------------------------------------------------------------------------------------------
class SpendRefused(Exception):
    def __init__(self, refusal: Refusal) -> None:
        super().__init__(refusal.message)
        self.refusal = refusal


class CallGate:
    """Reserve the worst case cost of a call before it is made and settle it after. ``acquire`` raises ``SpendRefused`` when the reservation would pass a cap; ``settle`` takes the
    usage of a call that returned (cost recorded and logged) or None for a call that failed (reservation released, nothing recorded). ``calls`` and ``micros`` count what was recorded."""

    def __init__(self, store: UsageStore, cfg: AiConfig, project_id: str, model: str, purpose: str = "first_design") -> None:
        self.store, self.cfg, self.project_id, self.model, self.purpose = store, cfg, project_id, model, purpose
        self.calls = 0
        self.micros = 0.0
        self._lock = threading.Lock()

    def acquire(self, system: list[dict], tools: list[dict], messages: list[dict], max_tokens: int) -> str:
        out = self.store.reserve(self.cfg, estimate_call_micros(self.cfg, system, tools, messages, max_tokens), time.time() * 1000)
        if isinstance(out, Refusal):
            raise SpendRefused(out)
        return out

    def settle(self, token: str, usage: Usage | None) -> float:
        now = time.time() * 1000
        if usage is None:
            self.store.settle(token, None, now)
            return 0.0
        cost = cost_micros(usage, self.cfg)
        self.store.settle(token, cost, now)
        self.store.log_call({"t": int(now // 1000), "project": self.project_id, "purpose": self.purpose, "model": self.model, "input_tokens": usage.input_tokens,
                             "output_tokens": usage.output_tokens, "cache_write_tokens": usage.cache_write_tokens, "cache_read_tokens": usage.cache_read_tokens, "cost_usd_micros": round(cost)})
        with self._lock:
            self.calls += 1
            self.micros += cost
        return cost
