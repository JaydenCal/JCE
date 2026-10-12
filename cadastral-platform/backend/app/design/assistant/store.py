"""Per-project design state: the SA8 model with undo/redo by assistant turn, plus a short chat memory.

``ModelStore`` is the persistence seam. ``InMemoryModelStore`` is the default; a Postgres implementation (design.layouts +
a JSON column) only needs to implement get/put with ``ModelState.to_dict()/from_dict()``.
"""
from __future__ import annotations

import threading
from typing import Any, Protocol

from app.agents.sa8_layout import BuildingModel, History

CHAT_KEEP = 12   # messages (6 exchanges) of text-only memory sent back to the model


class ModelState:
    def __init__(self, initial: BuildingModel):
        self.initial = initial
        self.history = History(initial)
        self.turns: list[int] = []        # ops applied per turn, oldest first
        self.redo_turns: list[int] = []
        self.chat: list[dict] = []        # [{role, content:str}] text only
        self.version = 0

    @property
    def model(self) -> BuildingModel:
        return self.history.model

    @property
    def can_undo(self) -> bool:
        return bool(self.turns)

    @property
    def can_redo(self) -> bool:
        return bool(self.redo_turns)

    def commit_turn(self, n_ops: int, user: str, assistant: str) -> None:
        if n_ops:
            self.turns.append(n_ops)
            self.redo_turns.clear()
            self.version += 1
        self.chat += [{"role": "user", "content": user[:1000]}, {"role": "assistant", "content": assistant[:1000]}]
        self.chat = self.chat[-CHAT_KEEP:]

    def undo(self) -> bool:
        if not self.turns:
            return False
        n = self.turns.pop()
        for _ in range(n):
            self.history.undo()
        self.redo_turns.append(n)
        self.version += 1
        return True

    def redo(self) -> bool:
        if not self.redo_turns:
            return False
        n = self.redo_turns.pop()
        for _ in range(n):
            self.history.redo()
        self.turns.append(n)
        self.version += 1
        return True

    def to_dict(self) -> dict[str, Any]:
        return {"initial": self.initial.model_dump(mode="json"), "log": list(self.history.log), "turns": list(self.turns),
                "redo_turns": list(self.redo_turns), "chat": list(self.chat), "version": self.version,
                "redo_log": list(self.history._undone)}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ModelState":
        st = cls(BuildingModel.model_validate(d["initial"]))
        for op in d.get("log", []):
            rep = st.history.do(op)
            if not rep.ok:
                raise ValueError(f"stored op no longer applies: {rep.errors}")
        redo = list(d.get("redo_log", []))
        st.turns, st.redo_turns = list(d.get("turns", [])), list(d.get("redo_turns", []))
        st.chat, st.version = list(d.get("chat", [])), int(d.get("version", 0))
        if redo:   # replay redo ops then undo them so History holds them in its future stack
            for op in redo:
                st.history.do(op)
            for _ in redo:
                st.history.undo()
        return st


class ModelStore(Protocol):
    def get(self, project_id: str) -> ModelState | None: ...
    def put(self, project_id: str, state: ModelState) -> None: ...
    def lock(self, project_id: str): ...


class InMemoryModelStore:
    def __init__(self):
        self._d: dict[str, ModelState] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._g = threading.Lock()

    def get(self, project_id: str) -> ModelState | None:
        return self._d.get(project_id)

    def put(self, project_id: str, state: ModelState) -> None:
        self._d[project_id] = state

    def lock(self, project_id: str):
        with self._g:
            return self._locks.setdefault(project_id, threading.Lock())
