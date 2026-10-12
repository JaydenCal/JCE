"""Sub-agent contract. Agents are stateless: one validated input in, one output out."""
from __future__ import annotations

from typing import Generic, Protocol, TypeVar

from pydantic import BaseModel

from app.common.contracts import AgentCode

In = TypeVar("In", bound=BaseModel)
Out = TypeVar("Out", bound=BaseModel)


class SubAgent(Protocol, Generic[In, Out]):
    code: AgentCode
    version: str
    input_schema: str
    output_schema: str
    input_model: type[In]

    def run(self, payload: In) -> Out: ...


class AgentError(Exception):
    """Raised by agents with a stable error_code recorded in agents.invocations."""

    def __init__(self, error_code: str, detail: str) -> None:
        super().__init__(f"{error_code}: {detail}")
        self.error_code = error_code
        self.detail = detail
