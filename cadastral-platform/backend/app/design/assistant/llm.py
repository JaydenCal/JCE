"""LLM abstraction for the design assistant and for AI first design (stage 10). Callers never import the SDK directly; tests use FakeLlm or an injected transport.

MODEL. The default is ``claude-haiku-5-5`` (usage is kept low). The environment variable ``JCESITE_AI_MODEL`` changes it for every AI feature of the
platform; ``ASSISTANT_MODEL`` is still read as the older name for the assistant only. An explicit ``model`` argument wins over both.

COST CONTROL (stage 10). The system prompt and the tool definitions carry a prompt cache marker (a cache hit is priced at a tenth of an input token), the output is bounded by
``max_tokens`` and every successful call is logged with its model and token counts (never its content) on the logger ``jcesite.ai``. Spend caps and rate limits are applied
by ``app.design.ai_guard`` before a call is made.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

DEFAULT_MODEL = "claude-haiku-5-5"
MODEL_ENV = "JCESITE_AI_MODEL"
LEGACY_MODEL_ENV = "ASSISTANT_MODEL"
log = logging.getLogger("jcesite.ai")


def resolve_model(explicit: str | None = None, env: Any = None) -> str:
    """The model id: an explicit argument, else ``JCESITE_AI_MODEL``, else the older ``ASSISTANT_MODEL``, else the Haiku default. ``env`` is a mapping (default: the process environment)."""
    e = os.environ if env is None else env
    for v in (explicit, e.get(MODEL_ENV), e.get(LEGACY_MODEL_ENV)):
        if v and v.strip():
            return v.strip()
    return DEFAULT_MODEL


class LlmError(Exception):
    def __init__(self, kind: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.kind, self.message, self.retryable = kind, message, retryable


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def add(self, o: "Usage") -> None:
        self.input_tokens += o.input_tokens
        self.output_tokens += o.output_tokens
        self.cache_read_tokens += o.cache_read_tokens
        self.cache_write_tokens += o.cache_write_tokens


@dataclass
class LlmResponse:
    content: list[dict]            # raw content blocks (text / tool_use / thinking) exactly as returned; echoed back unchanged
    stop_reason: str = "end_turn"
    usage: Usage = field(default_factory=Usage)


class LlmClient(Protocol):
    model: str

    def create(self, *, system: list[dict], tools: list[dict], messages: list[dict], max_tokens: int, timeout: float | None = None) -> LlmResponse: ...


def text_block(t: str) -> dict:
    return {"type": "text", "text": t}


def tool_use(name: str, input: dict, id: str | None = None) -> dict:
    return {"type": "tool_use", "id": id or f"toolu_{name}", "name": name, "input": input}


class FakeLlm:
    """Scripted client. ``script`` is a list of responses (each a list of content blocks or an LlmResponse) consumed in order,
    or a callable ``(request_dict) -> blocks``. Every request is recorded in ``calls`` for assertions."""
    model = "fake-model"

    def __init__(self, script: list | Callable[[dict], Any]):
        self.script, self.calls = script, []
        self._i = 0

    def create(self, *, system, tools, messages, max_tokens, timeout=None) -> LlmResponse:
        req = {"system": system, "tools": tools, "messages": [dict(m) for m in messages], "max_tokens": max_tokens, "timeout": timeout}
        self.calls.append(req)
        out = self.script(req) if callable(self.script) else self.script[min(self._i, len(self.script) - 1)]
        self._i += 1
        if isinstance(out, LlmResponse):
            return out
        blocks = [text_block(b) if isinstance(b, str) else b for b in out]
        n = 0
        for b in blocks:
            if b["type"] == "tool_use":
                n += 1
                b["id"] = f"toolu_{self._i}_{n}"
        has_tool = any(b["type"] == "tool_use" for b in blocks)
        return LlmResponse(blocks, "tool_use" if has_tool else "end_turn", Usage(input_tokens=100, output_tokens=20, cache_read_tokens=50))


def with_cache_markers(system: list[dict], tools: list[dict]) -> tuple[list[dict], list[dict]]:
    """Copies of ``system`` and ``tools`` with a cache marker on the last system block and the last tool (render order: tools, system, messages). A marker that is
    already there is kept, so a caller that places its own markers is not changed."""
    def mark(blocks: list[dict]) -> list[dict]:
        if not blocks or any("cache_control" in b for b in blocks):
            return [dict(b) for b in blocks]
        out = [dict(b) for b in blocks]
        out[-1]["cache_control"] = {"type": "ephemeral"}
        return out
    return mark(system), mark(tools)


Transport = Callable[[dict], dict]


class AnthropicClient:
    """Claude via the official SDK (lazy import). Key from ANTHROPIC_API_KEY. Env: JCESITE_AI_MODEL (ASSISTANT_MODEL is the older name), ASSISTANT_EFFORT
    (low|medium|high, default low), ASSISTANT_FALLBACKS (default on: server-side refusal fallbacks).

    The SDK does NOT retry (``max_retries`` 0 by default): a retry is a second paid request, so the caller retries under its own deadline and spend guard. ``create`` takes an
    optional ``timeout`` (seconds) for that one request. Any failure that is not an SDK error (an import problem, a bad response) is raised as an ``LlmError`` of kind ``client``.

    ``reasoning`` False sends neither adaptive thinking nor an effort setting (AI first design: a choice among prepared candidates needs no extended reasoning, and the
    output is bounded by ``max_tokens``). ``transport`` replaces the SDK with a function ``request body -> response dict`` (tests; no network). ``purpose`` is written to the
    usage log line."""

    def __init__(self, api_key: str | None = None, model: str | None = None, effort: str | None = None, timeout: float = 60.0, *, reasoning: bool = True,
                 fallbacks: bool | None = None, transport: Transport | None = None, purpose: str = "assistant", max_retries: int = 0):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY") or ""
        self.model = resolve_model(model)
        self.effort = effort or os.environ.get("ASSISTANT_EFFORT") or "low"
        self.reasoning = reasoning
        self.fallbacks = (os.environ.get("ASSISTANT_FALLBACKS", "1") not in ("0", "false", "no")) if fallbacks is None else fallbacks
        self.timeout = timeout
        self.transport = transport
        self.purpose = purpose
        self.max_retries = max_retries
        self._client: Any = None

    @property
    def configured(self) -> bool:
        return bool(self.api_key) or self.transport is not None

    def _sdk(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self.api_key, timeout=self.timeout, max_retries=self.max_retries)
        return self._client

    def request_body(self, *, system, tools, messages, max_tokens) -> dict[str, Any]:
        """The Messages API request: cache markers on the system prompt and the tools, a bounded output, and no extended reasoning unless ``reasoning``."""
        system, tools = with_cache_markers(system, tools)
        kw: dict[str, Any] = dict(model=self.model, max_tokens=max_tokens, system=system, tools=tools, messages=messages)
        if self.reasoning:
            kw.update(thinking={"type": "adaptive"}, output_config={"effort": self.effort})
        return kw

    def create(self, *, system, tools, messages, max_tokens, timeout: float | None = None) -> LlmResponse:
        if not self.configured:
            raise LlmError("not_configured", "ANTHROPIC_API_KEY is not set")
        kw = self.request_body(system=system, tools=tools, messages=messages, max_tokens=max_tokens)
        if self.transport is not None:
            try:
                data = self.transport(kw)
            except LlmError:
                raise
            except TimeoutError as e:
                raise LlmError("timeout", "The AI service took too long to answer.", True) from e
            except Exception as e:  # noqa: BLE001  (a transport failure is reported, never swallowed into a result)
                raise LlmError("network", "Could not reach the AI service.", True) from e
            return self._parse(data)
        try:
            import anthropic
        except Exception as e:  # noqa: BLE001
            raise LlmError("client", "The AI client library is not available.") from e
        if timeout is not None:
            kw["timeout"] = timeout
        try:
            c = self._sdk()
            if self.reasoning and self.fallbacks:
                msg = c.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kw)
            else:
                msg = c.messages.create(**kw)
        except anthropic.APITimeoutError as e:                  # a subclass of APIConnectionError: test it first
            raise LlmError("timeout", "The AI service took too long to answer.", True) from e
        except anthropic.RateLimitError as e:
            raise LlmError("rate_limited", "The AI service is busy; try again shortly.", True) from e
        except anthropic.APIConnectionError as e:
            raise LlmError("network", "Could not reach the AI service.", True) from e
        except anthropic.AuthenticationError as e:
            raise LlmError("auth", "The AI service rejected the API key.") from e
        except anthropic.APIStatusError as e:
            raise LlmError("api_error", f"AI service error ({getattr(e, 'status_code', '?')}).", getattr(e, "status_code", 0) >= 500) from e
        except LlmError:
            raise
        except Exception as e:  # noqa: BLE001  (anything else the client raises is a model failure, not an error of the caller)
            raise LlmError("client", f"The AI client failed ({type(e).__name__}).") from e
        return self._parse(msg.model_dump(exclude_none=True))

    def _parse(self, data: dict) -> LlmResponse:
        blocks = [dict(b) for b in (data.get("content") or []) if isinstance(b, dict)]
        u = data.get("usage") or {}
        usage = Usage(input_tokens=int(u.get("input_tokens") or 0), output_tokens=int(u.get("output_tokens") or 0),
                      cache_read_tokens=int(u.get("cache_read_input_tokens") or 0), cache_write_tokens=int(u.get("cache_creation_input_tokens") or 0))
        log_usage(self.model, usage, self.purpose)
        return LlmResponse(blocks, str(data.get("stop_reason") or "end_turn"), usage)


def log_usage(model: str, usage: Usage, purpose: str) -> None:
    """One line per successful call: the model and the token counts. Never the prompt or the answer."""
    log.info(json.dumps({"event": "ai_call", "purpose": purpose, "model": model, "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens,
                         "cache_read_tokens": usage.cache_read_tokens, "cache_write_tokens": usage.cache_write_tokens}, separators=(",", ":")))
