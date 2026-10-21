"""Council TYPICAL DETAIL data for the plan set: read from knowledge/<council>/typicals.json (see knowledge/gunnedah/build_typicals.py), never typed here.

Every dimension, note and clause printed on a typical detail comes from ``Typicals.get(key)`` and carries its citation (``Typical.ref``): the document,
the drawing or clause and the page.  An entry flagged ``verify`` (confidence 0.7 or lower) prints with VERIFY AGAINST <drawing>.  A key that is absent or
NOT FOUND returns None, and the caller says so on the sheet instead of drawing a value.  Another council has no typicals file: ``Typicals.present`` is
False and the caller keeps its PLATFORM DEFAULT behaviour.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

KNOW = Path(__file__).resolve().parents[4] / "knowledge"
SD = "sd107."
ENG = "eng."


@dataclass
class Typical:
    key: str
    value: object
    unit: str | None
    numeric: dict | None
    doc_id: str
    doc: dict
    clause: str
    page: int | None
    quote: list
    description: str
    confidence: float
    verify: bool
    status: str
    source_url: str | None = None
    ref_key: str | None = None
    label: str = ""
    extra: dict = field(default_factory=dict)

    # ---- numbers -------------------------------------------------------------------------------------------------------
    def _to_mm(self, x: float) -> float:
        return x * 1000.0 if self.unit == "m" else x

    @property
    def mm(self) -> float | None:
        """Single numeric value in millimetres (None for a range, a description or a non-length unit)."""
        n = self.numeric or {}
        if "value" in n and self.unit in ("mm", "m"):
            return self._to_mm(n["value"])
        return None

    @property
    def m(self) -> float | None:
        v = self.mm
        return None if v is None else v / 1000.0

    @property
    def rng(self) -> tuple[float, float] | None:
        """(min, max) in the entry's own unit (percent, mm, m ...)."""
        n = self.numeric or {}
        return (n["min"], n["max"]) if "min" in n else None

    @property
    def range_mm(self) -> tuple[float, float] | None:
        n = self.numeric or {}
        if "min" in n and self.unit in ("mm", "m"):
            return self._to_mm(n["min"]), self._to_mm(n["max"])
        return None

    @property
    def number(self) -> float | None:
        n = self.numeric or {}
        return n.get("value")

    # ---- text ----------------------------------------------------------------------------------------------------------
    @property
    def short(self) -> str:
        return self.doc.get("short", "")

    @property
    def ref(self) -> str:
        """'GSC SD-107 REV A, SD-107 Note 9, p.1' (document short title, drawing or clause, page when the document has pages)."""
        cl = re.sub(r"\s+", " ", (self.clause or "").strip())
        if self.doc_id == "sd107":
            return f"{self.short}, {cl}" if cl else self.short
        return f"{self.short}, {cl}, p.{self.page}" if self.page else f"{self.short}, {cl}"

    @property
    def ref_short(self) -> str:
        """Short citation for crowded details: 'GSC ENGINEERING STANDARDS V1 (APR 2025) 2.8.2, p.43'."""
        tag = self.doc.get("tag") or self.short
        cl = re.split(r"[,;]", re.sub(r"\s+", " ", (self.clause or "").strip()))[0].strip()
        cl = cl if len(cl) <= 30 else cl[:30].rsplit(" ", 1)[0]
        if self.doc_id == "sd107":
            return f"{tag}, {cl}"
        return f"{tag} {cl}, p.{self.page}" if self.page else f"{tag} {cl}"

    @property
    def vtext(self) -> str:
        v = self.value
        if isinstance(v, float) and v == int(v):
            v = int(v)
        u = f" {self.unit}" if self.unit and self.unit not in ("count",) else ""
        return f"{v}{u}"

    @property
    def tag(self) -> str:
        return ("VERIFY AGAINST " + ("SD-107" if self.doc_id == "sd107" else self.short)) if self.verify else ""


class Typicals:
    def __init__(self, council: str | None = None, path: Path | None = None):
        self.by_key: dict[str, Typical] = {}
        self.missing: dict[str, Typical] = {}           # NOT FOUND markers (kept so a sheet can say "not published")
        self.docs: dict[str, dict] = {}
        self.notes: dict[int, str] = {}                 # SD-107 notes 1 to 15, verbatim from the drawing text
        self.path: str | None = None
        c = (council or "").lower()
        files = [path] if path is not None else [d / "typicals.json" for d in (sorted(KNOW.iterdir()) if KNOW.exists() else [])
                                                 if d.is_dir() and c and d.name in c and (d / "typicals.json").exists()]
        for f in files:
            try:
                data = json.loads(Path(f).read_text())
            except Exception:  # noqa: BLE001
                continue
            self.path = str(f)
            self.docs = data.get("documents", {})
            self.notes = {int(n["n"]): n["text"] for n in data.get("sd107_notes", [])}
            for e in data.get("entries", []):
                t = Typical(e["key"], e.get("value"), e.get("unit"), e.get("numeric"), e.get("doc") or "", self.docs.get(e.get("doc") or "", {}), e.get("clause", ""),
                            e.get("page"), e.get("quote", []), e.get("description", ""), float(e.get("confidence", 0.0)), bool(e.get("verify")), e.get("status", "resolved"),
                            e.get("source_url"), e.get("ref_key"), e.get("label", ""))
                (self.by_key if t.status == "resolved" else self.missing)[t.key] = t

    @property
    def present(self) -> bool:
        return bool(self.by_key)

    def get(self, key: str) -> Typical | None:
        return self.by_key.get(key)

    def mm(self, key: str) -> float | None:
        t = self.get(key)
        return None if t is None else t.mm

    def m(self, key: str) -> float | None:
        t = self.get(key)
        return None if t is None else t.m

    def doc_short(self, doc_id: str) -> str:
        return self.docs.get(doc_id, {}).get("short", "")

    def doc_titles(self) -> list[str]:
        """Titles with edition of the documents the typicals cite (for the sheet source lists)."""
        used = {t.doc_id for t in self.by_key.values()}
        return [f"{d['short']} ({d['edition']})" for k, d in self.docs.items() if k in used and k != "dcp"]

    def not_published(self, *needles: str) -> list[Typical]:
        return [t for k, t in self.missing.items() if all(n in k for n in needles)]

    def verify_keys(self) -> list[str]:
        return [k for k, t in self.by_key.items() if t.verify]

    # ---- formatted values ------------------------------------------------------------------------------------------------
    def dim(self, key: str, fmt: str = "{:g}") -> str:
        """Printed dimension for a drawing label: '3000 MIN' style callers build their own; this gives the number text or '' when absent."""
        t = self.get(key)
        if t is None:
            return ""
        v = t.mm if t.mm is not None else t.number
        return "" if v is None else fmt.format(v)

    def cited_tag(self, key: str) -> str:
        t = self.get(key)
        return "" if t is None else t.tag
