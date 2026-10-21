"""Cited council / ESC requirements for the plan set (read from knowledge/<council>/requirements.json; nothing is defaulted)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from app.agents.sa5_cad_dxf.planset.typicals import Typicals

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
        sec = (self.section or "").replace(" - ", ", ")                          # a spaced hyphen in a source heading is written as a comma
        return f"{self.doc}, {sec}, p.{self.page}" if self.page else f"{self.doc}, {sec}"

    @property
    def vtext(self) -> str:
        v = self.value
        if isinstance(v, float) and v == int(v):
            v = int(v)
        return f"{v} {self.unit}".strip() if self.unit and self.unit not in ("count",) else str(v)


def _short(title: str, version: str) -> str:
    # the council name is kept in full whatever the council (no initialism that would need a legend, no council hard-coded here)
    t = (title.replace("Engineering Design Minimum Standards for Subdivisions and Developments", "Engineering Design Minimum Standards")
         .replace("Guidelines for erosion and sediment control on building sites", "ESC Guidelines for building sites")
         .replace("Managing Urban Stormwater: Soils and Construction", "Blue Book Vol.1"))
    v = (version or "").split("(")[0].strip()
    return f"{t} ({v})" if v else t


class Cites:
    def __init__(self, council: str | None):
        self.by_key: dict[str, Cite] = {}
        self.council_file: str | None = None
        self.council_name: str | None = None          # taken from the council source document title (e.g. 'Gunnedah Shire Council'), never typed in
        self.docs: list[str] = []                     # short titles of every source document cited, council documents first
        self.typ = Typicals(council)                  # council typical-detail data (knowledge/<council>/typicals.json); empty for a council without one
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
                for r0 in reqs:
                    m = re.match(r"(.+? Council)\b", r0.get("source", {}).get("document_title", ""))
                    if m:
                        self.council_name = m.group(1)
                        break
            for r in reqs:
                if r.get("status", "resolved") != "resolved" or r["key"] in self.by_key:
                    continue
                s = r["source"]
                own = re.match(r"(.+? Council)\b", s.get("document_title", ""))
                if d.name == "esc" and own and own.group(1).lower().split()[0] not in c:
                    continue                      # a requirement sourced from ANOTHER council's document is never cited for this lot's council
                self.docs.append(_short(s["document_title"], s.get("version", "")))
                self.by_key[r["key"]] = Cite(r["key"], r["value"], r.get("unit"), _short(s["document_title"], s.get("version", "")),
                                             s.get("page"), s.get("section_ref", ""), s.get("quote", ""))

    def doc_list(self) -> list[str]:
        sd = self.typ.docs.get("sd107") if self.typ.present else None
        extra = [f"{sd['title']} ({sd['edition']})"] if sd else []           # the standard drawing the typical details are taken from
        return list(dict.fromkeys(self.docs + extra))

    def get(self, key: str) -> Cite | None:
        return self.by_key.get(key)

    def line(self, key: str, label: str = "") -> str | None:
        c = self.get(key)
        return f"{label or key}: {c.vtext} [{c.ref}]" if c else None
