"""Cited council / ESC requirements for the plan set (read from knowledge/<council>/requirements.json; nothing is defaulted)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

KNOW = Path(__file__).resolve().parents[4] / "knowledge"


@dataclass
class Cite:
    key: str
    value: object
    unit: str | None
    doc: str
    page: int | None
    section: str
    quote: str

    @property
    def ref(self) -> str:
        return f"{self.doc}, {self.section}, p.{self.page}" if self.page else f"{self.doc}, {self.section}"

    @property
    def vtext(self) -> str:
        v = self.value
        if isinstance(v, float) and v == int(v):
            v = int(v)
        return f"{v} {self.unit}".strip() if self.unit and self.unit not in ("count",) else str(v)


def _short(title: str, version: str) -> str:
    t = (title.replace("Gunnedah Shire Council", "GSC").replace("Engineering Design Minimum Standards for Subdivisions and Developments",
                                                                 "Engineering Design Minimum Standards")
         .replace("Guidelines for erosion and sediment control on building sites", "ESC Guidelines for building sites")
         .replace("Managing Urban Stormwater: Soils and Construction", "Blue Book Vol.1"))
    v = (version or "").split("(")[0].strip()
    return f"{t} ({v})" if v else t


class Cites:
    def __init__(self, council: str | None):
        self.by_key: dict[str, Cite] = {}
        self.council_file: str | None = None
        folders = []
        c = (council or "").lower()
        for d in KNOW.iterdir() if KNOW.exists() else []:
            if d.is_dir() and (d / "requirements.json").exists() and (d.name == "esc" or (c and d.name in c)):
                folders.append(d)
        for d in folders:
            try:
                reqs = json.loads((d / "requirements.json").read_text())["requirements"]
            except Exception:  # noqa: BLE001
                continue
            if d.name != "esc":
                self.council_file = str(d / "requirements.json")
            for r in reqs:
                if r.get("status", "resolved") != "resolved" or r["key"] in self.by_key:
                    continue
                s = r["source"]
                self.by_key[r["key"]] = Cite(r["key"], r["value"], r.get("unit"), _short(s["document_title"], s.get("version", "")),
                                             s.get("page"), s.get("section_ref", ""), s.get("quote", ""))

    def get(self, key: str) -> Cite | None:
        return self.by_key.get(key)

    def line(self, key: str, label: str = "") -> str | None:
        c = self.get(key)
        return f"{label or key}: {c.vtext} [{c.ref}]" if c else None
