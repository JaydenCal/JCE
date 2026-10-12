"""Requirements Resolver: governing documents -> cited requirement values (table/regex first, LLM only if unresolved)."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.agents.sa2_dcp_rag.embeddings import Embedder, HashingEmbedder
from app.agents.sa2_dcp_rag.extract import LlmClient, _rows, norm, record_usage
from app.agents.sa2_dcp_rag.ingest import ingest_pdf
from app.agents.sa2_dcp_rag.models import Chunk
from app.agents.sa2_dcp_rag.retrieve import InMemoryRetriever

from .models import KEY_HELP, key_help, Requirement, RequirementKey, RequirementSet, Selectors, Source
from .sources import DocRef, DocumentSource

REGISTRY_PATH = Path(__file__).with_name("registry.json")
NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
UNIT_RE = re.compile(r"^\s*(\d[\d,]*(?:\.\d+)?)\s*(mm|m|%|kl|l|litres?|ltrs?)?\s*$", re.I)
ALIASES = {"m": ["m", "metre", "meter"], "%": ["%", "percent"], "L": ["litre", "(l)", " l)"], "count": [""]}
SERVICES = ("sewer", "water", "stormwater", "electric", "gas", "telecom")
TRUE_W, FALSE_W = ("permitted", "allowed", "yes", "approved"), ("not permitted", "prohibited", "not allowed", "no", "refused")


class LotRequirementContext(BaseModel):
    jurisdiction: str
    lga: str
    zone: str | None = None
    authorities: dict[str, str] = Field(default_factory=dict)   # water/sewer/electricity/gas -> authority name

    def canon(self) -> str:
        return json.dumps(self.model_dump(), sort_keys=True).casefold()


def load_registry(path: str | Path | None = None) -> dict[str, dict]:
    p = Path(path or REGISTRY_PATH)
    txt = p.read_text()
    if p.suffix in (".yaml", ".yml"):
        import yaml
        return yaml.safe_load(txt)
    return json.loads(txt)


def parse_band(text: str) -> tuple[int | None, int | None]:
    t = text.lower().replace("≤", "<=").replace("≥", ">=").replace("–", "-").replace("mm", "").replace(",", "")
    if re.search(r"\ball\b|\bany\b|^\s*-?\s*$", t):
        return None, None
    n = [int(float(x)) for x in re.findall(r"\d+(?:\.\d+)?", t)]
    if not n:
        return None, None
    if len(n) >= 2 and re.search(r"-|to", t):
        return n[0], n[1]
    if re.search(r"<=|up to|under|less than|<|max|upto|not exceeding", t):
        return 0, n[0] - (1 if "<" in t and "<=" not in t else 0)
    if re.search(r">=|\+|and over|and above", t):
        return n[0], None
    if re.search(r">|over|above|greater|exceed", t):
        return n[0] + 1, None
    return n[0], n[0]


def norm_service(cell: str) -> str:
    c = cell.lower()
    for s in SERVICES:
        if s in c:
            return "electricity" if s == "electric" else s
    return c.strip()


def to_number(text: str, unit: str, hint: str = "") -> float | None:
    m = UNIT_RE.match(text)
    if not m:
        return None
    v, u = float(m.group(1).replace(",", "")), (m.group(2) or "").lower()
    if not u:
        if unit != "count" and not any(a in hint.lower() for a in ALIASES.get(unit, [unit.lower()]) if a):
            return None
        return v
    if unit == "m":
        return v / 1000 if u == "mm" else v if u == "m" else None
    if unit == "%":
        return v if u == "%" else None
    if unit == "L":
        return v * 1000 if u == "kl" else v if u in ("l", "litre", "litres", "ltr", "ltrs") else None
    return None


def to_bool(text: str) -> bool | None:
    t = text.lower()
    if any(w in t for w in FALSE_W if w != "no") or re.fullmatch(r"\W*no\W*", t):
        return False
    if any(w in t for w in TRUE_W):
        return True
    return None


class RequirementsResolver:
    def __init__(self, ctx: LotRequirementContext, source: DocumentSource, *, llm: LlmClient | None = None,
                 embedder: Embedder | None = None, registry: dict | str | Path | None = None, top_k: int = 8) -> None:
        self.ctx, self.source, self.llm, self.top_k = ctx, source, llm, top_k
        self.emb = embedder or HashingEmbedder()
        self.reg = registry if isinstance(registry, dict) else load_registry(registry)
        self._chunks: dict[str, list[Chunk]] = {}
        self._ret: dict[str, InMemoryRetriever] = {}
        self._meta: dict[str, dict] = {}
        self._cache: dict[tuple, list[Requirement]] = {}
        self.cache_hits = 0
        self.llm_calls = 0

    # ---- documents ----
    def governing_docs(self, key: str) -> list[DocRef]:
        reg, c, out = self.reg[key], self.ctx, []
        auths = {a.casefold() for a in c.authorities.values()}
        for d in self.source.list_documents():
            if d.kind not in reg.get("doc_kinds", []):
                continue
            if d.jurisdiction and d.jurisdiction.casefold() != c.jurisdiction.casefold():
                continue
            role = reg.get("authority_role")
            if role == "council" and not ({(d.lga or "").casefold(), d.authority.casefold()} & {c.lga.casefold()}):
                continue
            if role == "utility" and d.authority.casefold() not in auths:
                continue
            if role in ("water", "sewer", "electricity", "gas") and d.authority.casefold() != c.authorities.get(role, "\0").casefold():
                continue
            out.append(d)
        return out

    def _load(self, d: DocRef) -> str:
        if d.doc_id not in self._ret_by_doc():
            path = self.source.fetch(d)
            chunks, meta = ingest_pdf(path, d.doc_id)
            sha = meta["sha256"]
            self._meta[d.doc_id] = {"sha": sha, "pages": meta["page_count"]}
            self._chunks[d.doc_id] = chunks
            self._ret[d.doc_id] = InMemoryRetriever(chunks, self.emb)
        return self._meta[d.doc_id]["sha"]

    def _ret_by_doc(self) -> dict:
        return self._ret

    # ---- extraction ----
    def _stamp(self, key: str, d: DocRef) -> Selectors:
        reg, s = self.reg[key], Selectors()
        for f in reg.get("stamp", []):
            setattr(s, f, getattr(self.ctx, f))
        if reg.get("stamp_authority"):
            s.authority = d.authority
        if reg.get("service"):
            s.service = reg["service"]
        return s

    def _make(self, key: str, d: DocRef, ch: Chunk, sel: Selectors, value: Any, quote: str, method: str,
              conf: float) -> Requirement | None:
        reg = self.reg[key]
        if not quote.strip() or norm(quote) not in norm(ch.content):      # SA2 rule: quote must be in the cited chunk
            return None
        if reg["kind"] == "number":
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                return None
            lo, hi = reg["range"]
            if not lo <= value <= hi:
                return None
            nums = [float(n.replace(",", "")) for n in NUM.findall(quote)]      # numeric must appear in the quote
            if not any(abs(n - value) < 1e-9 or abs(n / 1000 - value) < 1e-9 or abs(n * 1000 - value) < 1e-9 for n in nums):
                return None
        elif not isinstance(value, bool) or to_bool(quote) is not value:
            return None
        sha = self._meta[d.doc_id]["sha"]
        return Requirement(key=key, applies_to=sel, value=value, unit=reg.get("unit"), extraction_method=method,
                           confidence=conf, status="resolved",
                           source=Source(document_title=d.title, authority=d.authority, version=d.version,
                                         effective_date=d.effective_date, page=ch.page_from, section_ref=ch.section_ref,
                                         quote=quote, source_url=d.source_url, sha256=sha, chunk_id=ch.chunk_id))

    def _parse_value(self, reg: dict, cell: str, hint: str) -> Any:
        return to_bool(cell) if reg["kind"] == "bool" else to_number(cell, reg["unit"], hint)

    def _table(self, key: str, d: DocRef, ch: Chunk) -> list[Requirement]:
        reg, rows = self.reg[key], _rows(ch.content)
        if len(rows) < 2:
            return []
        hdr, out = rows[0], []
        vh = re.compile(reg["value_header"]) if reg.get("value_header") else None
        vc = next((i for i, h in enumerate(hdr) if vh and vh.search(h)), None)
        sc = next((i for i, h in enumerate(hdr) if i != vc and re.search(r"(?i)service|asset|utility|main\b|pipe type", h)), None)
        dc = next((i for i, h in enumerate(hdr) if i not in (vc, sc) and re.search(r"(?i)diameter|\bdn\b|size", h)), None)
        for r in rows[1:]:
            if len(r) != len(hdr):
                continue
            q = "| " + " | ".join(r) + " |"
            sel = self._stamp(key, d)
            if vc is not None and (sc is not None or dc is not None):          # banded table
                if sc is not None:
                    svc = norm_service(r[sc])
                    if reg.get("service") and svc != reg["service"]:
                        continue
                    sel.service = svc
                if dc is not None:
                    sel.dia_min_mm, sel.dia_max_mm = parse_band(r[dc])
                v = self._parse_value(reg, r[vc], hdr[vc])
                if v is not None and (rq := self._make(key, d, ch, sel, v, q, "table", 0.95)):
                    out.append(rq)
            elif reg.get("row_label") and re.search(reg["row_label"], r[0]):  # label | value table
                for i in range(1, len(r)):
                    v = self._parse_value(reg, r[i], hdr[i] + " " + r[0])
                    if v is not None:
                        if rq := self._make(key, d, ch, sel, v, q, "table", 0.9):
                            out.append(rq)
                        break
        return out

    def _regex(self, key: str, d: DocRef, ch: Chunk) -> list[Requirement]:
        out = []
        for pat in self.reg[key].get("patterns", []):
            for m in re.finditer(pat, ch.content):
                reg, raw = self.reg[key], m.group("value")
                u = (m.groupdict().get("unit") or "")
                v = to_number(raw.replace(",", "") + (u if u else ""), reg["unit"], reg["unit"]) if reg["kind"] == "number" else to_bool(raw)
                if v is not None and (rq := self._make(key, d, ch, self._stamp(key, d), v, m.group(0), "regex", 0.85)):
                    out.append(rq)
        return out

    def _candidates(self, key: str, d: DocRef) -> list[Chunk]:
        seen, out = set(), []
        for q in self.reg[key].get("queries", []):
            for c in self._ret[d.doc_id].search(q, k=self.top_k, zone_code=self.ctx.zone):
                if c.chunk_id not in seen:
                    seen.add(c.chunk_id), out.append(c)
        return out

    def _deterministic(self, key: str, d: DocRef, sha: str) -> list[Requirement]:
        ck = (key, self.ctx.canon(), sha, "det")
        if ck in self._cache:
            self.cache_hits += 1
            return self._cache[ck]
        res = []
        for ch in self._candidates(key, d):
            res += self._table(key, d, ch) if ch.kind == "table" else []
            res += self._regex(key, d, ch)
        self._cache[ck] = res
        return res

    def _llm(self, key: str, d: DocRef, sha: str) -> list[Requirement]:
        ck = (key, self.ctx.canon(), sha, "llm")
        if ck in self._cache:
            self.cache_hits += 1
            return self._cache[ck]
        reg, chunks, res = self.reg[key], self._candidates(key, d), []
        if chunks:
            system = ("You extract a single regulatory requirement from authority documents. Output ONLY JSON "
                      '{"requirements":[{"chunk_id","quote","value","service","dia_min_mm","dia_max_mm","confidence"}]}. '
                      "Never guess; omit if not explicitly stated. 'quote' must be an exact verbatim substring of the cited "
                      f"chunk containing the value. Value unit: {reg.get('unit', 'boolean')}.")
            ctx = "\n\n".join(f"[chunk_id={c.chunk_id} pages={c.page_from}-{c.page_to}]\n{c.content}" for c in chunks)
            user = (f"Requirement: {key} - {key_help(key)}\nLot: {self.ctx.model_dump_json()}\n\n"
                    f"CHUNKS:\n{ctx}")
            self.llm_calls += 1
            resp = self.llm.complete(system, user, {"type": "object"})
            record_usage(resp.get("usage") or {})
            by = {c.chunk_id: c for c in chunks}
            for raw in resp.get("requirements", []):
                ch = by.get(raw.get("chunk_id"))
                if ch is None or raw.get("key", key) != key:
                    continue
                sel = self._stamp(key, d)
                if raw.get("service"):
                    sel.service = norm_service(str(raw["service"]))
                if reg.get("service") and sel.service != reg["service"]:
                    continue
                sel.dia_min_mm, sel.dia_max_mm = raw.get("dia_min_mm"), raw.get("dia_max_mm")
                try:
                    conf = min(float(raw.get("confidence", 0.6)), 0.8)
                except (TypeError, ValueError):
                    conf = 0.6
                if rq := self._make(key, d, ch, sel, raw.get("value"), str(raw.get("quote", "")), "llm", conf):
                    res.append(rq)
        self._cache[ck] = res
        return res

    # ---- public ----
    def resolve(self, keys: list[str] | None = None) -> RequirementSet:
        rs = RequirementSet()
        for key in [k.value if isinstance(k, RequirementKey) else k for k in (keys or self.reg)]:
            docs = self.governing_docs(key)
            found: list[Requirement] = []
            for d in docs:
                sha = self._load(d)
                found += self._deterministic(key, d, sha)
            if not found and self.llm is not None:                       # LLM only for unresolved keys
                for d in docs:
                    found += self._llm(key, d, self._meta[d.doc_id]["sha"])
            if not found:
                titles = ", ".join(d.title for d in docs) or "no governing document supplied"
                rs.add(Requirement(key=key, applies_to=self._stamp(key, docs[0]) if docs else Selectors(),
                                   status="unresolved",
                                   prompt=f"Could not find {key_help(key)} in: {titles}. "
                                          f"Please enter the value and cite the document, or supply the governing document."))
                continue
            groups: dict[str, list[Requirement]] = {}
            for r in found:
                groups.setdefault(r.applies_to.canon(), []).append(r)
            for g in groups.values():
                distinct = {}
                for r in g:
                    distinct.setdefault(str(r.value), r)
                if len(distinct) == 1:
                    rs.add(max(g, key=lambda r: r.confidence))
                else:
                    alts = list(distinct.values())
                    rs.add(Requirement(key=key, applies_to=alts[0].applies_to, status="conflict", alternatives=alts,
                                       prompt="Documents disagree: " + " vs ".join(f"{a.value} [{a.citation()}]" for a in alts)
                                              + ". Confirm which applies."))
        return rs

    @staticmethod
    def user_enter(rs: RequirementSet, key: str | RequirementKey, value: Any, *, who: str, unit: str | None = None,
                   note: str = "", **selectors: Any) -> Requirement:
        k = key.value if isinstance(key, RequirementKey) else key
        r = Requirement(key=k, applies_to=Selectors(**selectors), value=value, unit=unit, status="user_confirmed",
                        extraction_method="user_entered", confidence=1.0, verified_by=who,
                        source=Source(entered_by=who, entered_at=datetime.now(timezone.utc), quote=note,
                                      document_title="user entry"))
        rs.add(r)
        return r

    @staticmethod
    def confirm(rs: RequirementSet, req: Requirement, who: str) -> None:
        req.status, req.verified_by = "user_confirmed", who
