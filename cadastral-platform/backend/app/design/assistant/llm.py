"""LLM abstraction for the design assistant. The assistant never imports the SDK directly; tests use FakeLlm."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

DEFAULT_MODEL = "claude-opus-5-5"


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

    def create(self, *, system: list[dict], tools: list[dict], messages: list[dict], max_tokens: int) -> LlmResponse: ...


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

    def create(self, *, system, tools, messages, max_tokens) -> LlmResponse:
        req = {"system": system, "tools": tools, "messages": [dict(m) for m in messages], "max_tokens": max_tokens}
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


class AnthropicClient:
    """Claude via the official SDK (lazy import). Key from ANTHROPIC_API_KEY. Env: ASSISTANT_MODEL, ASSISTANT_EFFORT
    (low|medium|high, default low), ASSISTANT_FALLBACKS (default on: server-side refusal fallbacks)."""

    def __init__(self, api_key: str | None = None, model: str | None = None, effort: str | None = None, timeout: float = 60.0):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY") or ""
        self.model = model or os.environ.get("ASSISTANT_MODEL") or DEFAULT_MODEL
        self.effort = effort or os.environ.get("ASSISTANT_EFFORT") or "low"
        self.fallbacks = os.environ.get("ASSISTANT_FALLBACKS", "1") not in ("0", "false", "no")
        self.timeout = timeout
        self._client: Any = None

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _sdk(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self.api_key, timeout=self.timeout, max_retries=2)
        return self._client

    def create(self, *, system, tools, messages, max_tokens) -> LlmResponse:
        if not self.configured:
            raise LlmError("not_configured", "ANTHROPIC_API_KEY is not set")
        import anthropic
        kw: dict[str, Any] = dict(model=self.model, max_tokens=max_tokens, system=system, tools=tools, messages=messages,
                                  thinking={"type": "adaptive"}, output_config={"effort": self.effort})
        try:
            c = self._sdk()
            if self.fallbacks:
                msg = c.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kw)
            else:
                msg = c.messages.create(**kw)
        except anthropic.RateLimitError as e:
            raise LlmError("rate_limited", "The AI service is busy; try again shortly.", True) from e
        except anthropic.APIConnectionError as e:
            raise LlmError("network", "Could not reach the AI service.", True) from e
        except anthropic.AuthenticationError as e:
            raise LlmError("auth", "The AI service rejected the API key.") from e
        except anthropic.APIStatusError as e:
            raise LlmError("api_error", f"AI service error ({getattr(e, 'status_code', '?')}).", getattr(e, "status_code", 0) >= 500) from e
        blocks = [b.model_dump(exclude_none=True) for b in msg.content]
        u = msg.usage
        usage = Usage(input_tokens=getattr(u, "input_tokens", 0) or 0, output_tokens=getattr(u, "output_tokens", 0) or 0,
                      cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
                      cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0)
        return LlmResponse(blocks, msg.stop_reason or "end_turn", usage)
