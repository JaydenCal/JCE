"""Per-invocation context visible to agent code running under the orchestrator.

An LLM-backed agent (SA2, SA7) reports usage without knowing about the database:

    from app.orchestrator.context import current_invocation
    ctx = current_invocation()
    if ctx: ctx.ensure_budget()              # before calling the model
    ...
    if ctx: ctx.record_tokens("claude-...", fresh=1200, cache_read=3000, output=400)

``record_tokens`` writes agents.token_ledger (the DB trigger rolls it up into
agents.runs.tokens_used) and raises ``AgentError('TOKEN_BUDGET_EXHAUSTED')`` once the run
budget is reached, which the orchestrator turns into run status ``waiting_user``.
"""
from __future__ import annotations

import contextvars
from dataclasses import dataclass
from typing import Callable
from uuid import UUID

from app.agents.base import AgentError
from app.common.contracts import AgentCode

BUDGET_EXHAUSTED = "TOKEN_BUDGET_EXHAUSTED"


@dataclass(frozen=True)
class TokenState:
    tokens_used: int
    token_budget: int

    @property
    def exhausted(self) -> bool:
        return self.tokens_used >= self.token_budget

    @property
    def remaining(self) -> int:
        return max(self.token_budget - self.tokens_used, 0)


@dataclass(frozen=True)
class InvocationContext:
    run_id: UUID
    invocation_id: UUID
    agent: AgentCode
    _record: Callable[..., TokenState]
    _state: Callable[[], TokenState]

    def token_state(self) -> TokenState:
        return self._state()

    def ensure_budget(self) -> TokenState:
        st = self._state()
        if st.exhausted:
            raise AgentError(BUDGET_EXHAUSTED, f"{st.tokens_used}/{st.token_budget} tokens used")
        return st

    def record_tokens(
        self,
        model_id: str,
        *,
        fresh: int = 0,
        cache_write: int = 0,
        cache_read: int = 0,
        output: int = 0,
        cost_aud_micros: int = 0,
        enforce: bool = True,
    ) -> TokenState:
        st = self._record(
            model_id,
            fresh=fresh,
            cache_write=cache_write,
            cache_read=cache_read,
            output=output,
            cost_aud_micros=cost_aud_micros,
        )
        if enforce and st.exhausted:
            raise AgentError(BUDGET_EXHAUSTED, f"{st.tokens_used}/{st.token_budget} tokens used")
        return st


_current: contextvars.ContextVar[InvocationContext | None] = contextvars.ContextVar(
    "orchestrator_invocation", default=None
)


def current_invocation() -> InvocationContext | None:
    """The invocation this thread is executing for, or None outside the orchestrator."""
    return _current.get()


def set_current(ctx: InvocationContext | None) -> contextvars.Token:
    return _current.set(ctx)
