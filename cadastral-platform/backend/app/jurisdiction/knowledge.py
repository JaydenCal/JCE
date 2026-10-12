"""CustomMunicipalityKnowledge: document-driven requirements for ANY municipality.

Flow: upload engineering standards / ordinances (PDF, any language) tagged with the profile -> ingest
(sa2_dcp_rag) -> resolve the standard requirement keys (requirements resolver) -> report resolved vs
unresolved with citations -> user enters the rest (user_entered, with unit selection).

Rules kept from the platform:
* a value exists only with a verbatim ORIGINAL-language quote found in the cited chunk, or a user entry;
* an English gloss is stored beside the quote but is flagged machine-translated and never validated;
* units in a document are converted by dimensional analysis; ambiguous units stay UNRESOLVED (never guessed);
* nothing here is verified legal content: see docs/08-custom-jurisdictions.md.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.agents.requirements.models import (EXTRA_KEY_HELP, Requirement, RequirementSet, Selectors, Source)
from app.agents.requirements.resolver import (LotRequirementContext, RequirementsResolver, load_registry)
from app.agents.requirements.sources import DocRef
from app.agents.sa2_dcp_rag.extract import norm, record_usage
from app.agents.sa2_dcp_rag.models import Chunk

from .profile import JurisdictionProfile
from .units import AmbiguousUnit, UnitError, UnitMismatch, convert, dimension_of, parse_unit

CUSTOM_JURISDICTION = "CUSTOM"
CUSTOM_KIND = "custom_standard"

# Extra keys for the standard set a custom municipality needs. Units are CANONICAL (the unit consumers read).
CUSTOM_KEYS: dict[str, dict] = {
    "setback.front_m": {"kind": "number", "unit": "m", "range": [0, 60], "help": "minimum front setback (m)",
                        "queries": ["minimum front yard setback", "front building line"]},
    "setback.side_m": {"kind": "number", "unit": "m", "range": [0, 30], "help": "minimum side setback (m)",
                       "queries": ["minimum side yard setback", "side building line"]},
    "setback.rear_m": {"kind": "number", "unit": "m", "range": [0, 60], "help": "minimum rear setback (m)",
                       "queries": ["minimum rear yard setback", "rear building line"]},
    "stormwater.min_cover_m": {"kind": "number", "unit": "m", "range": [0.1, 5], "help": "minimum cover over stormwater pipes (m)",
                               "queries": ["minimum cover stormwater pipe", "storm drain cover depth"]},
    "stormwater.min_pipe_diameter_mm": {"kind": "number", "unit": "mm", "range": [50, 2000], "help": "minimum stormwater pipe diameter (mm)",
                                        "queries": ["minimum storm drain pipe diameter"]},
    "esc.sediment_control_required": {"kind": "bool", "help": "erosion and sediment control measures required during construction",
                                      "queries": ["erosion and sediment control required during construction"]},
    "esc.min_waterway_buffer_m": {"kind": "number", "unit": "m", "range": [0, 200], "help": "minimum buffer from disturbance to a waterway (m)",
                                  "queries": ["buffer from waterway erosion sediment control"]},
}
for _k, _v in CUSTOM_KEYS.items():
    EXTRA_KEY_HELP[_k] = _v["help"]

# user-extensible multilingual search terms: language -> key -> [phrases]
QueryTerms = dict[str, dict[str, list[str]]]


class Translator(Protocol):
    def translate(self, text: str, src_lang: str) -> str: ...


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CustomDoc(M):
    doc_id: str
    title: str
    path: str
    sha256: str
    language: str = "en"
    kind: str = CUSTOM_KIND
    authority: str = ""
    version: str | None = None
    source_url: str | None = None
    profile_id: str
    municipality: str


class ReportRow(M):
    key: str
    status: str
    value: Any = None
    unit: str | None = None
    citation: str = ""
    quote_original: str = ""
    quote_en: str | None = None
    quote_en_machine_translated: bool = False
    prompt: str | None = None


class KnowledgeReport(M):
    resolved: list[ReportRow] = Field(default_factory=list)
    unresolved: list[ReportRow] = Field(default_factory=list)
    conflicts: list[ReportRow] = Field(default_factory=list)

    def summary(self) -> str:
        return f"{len(self.resolved)} resolved, {len(self.unresolved)} unresolved, {len(self.conflicts)} conflicting"


# ---------------------------------------------------------------------------- locale-aware numbers

def numbers_in(text: str, decimal: str = ".") -> list[float]:
    """Numbers in `text`; with decimal=',' a '3,5' is 3.5 and '1.234,5' is 1234.5 (never 35)."""
    out = []
    for tok in re.findall(r"\d[\d., ' ]*\d|\d", text):
        t = tok.replace(" ", "").replace(" ", "").replace("'", "")
        if decimal == ",":
            t = t.replace(".", "").replace(",", ".")
        else:
            t = t.replace(",", "")
        try:
            out.append(float(t))
        except ValueError:
            continue
    return out


# ---------------------------------------------------------------------------- resolver subclass


class _Source:
    def __init__(self, kb: "CustomMunicipalityKnowledge") -> None:
        self.kb = kb

    def list_documents(self) -> list[DocRef]:
        return [DocRef(doc_id=d.doc_id, title=d.title, kind=d.kind, authority=d.authority, jurisdiction=CUSTOM_JURISDICTION,
                       lga=self.kb.profile.council_label, path=d.path, source_url=d.source_url, version=d.version)
                for d in self.kb.docs.values()]

    def fetch(self, ref: DocRef) -> Path:
        return Path(ref.path)  # type: ignore[arg-type]


class _CustomResolver(RequirementsResolver):
    def __init__(self, kb: "CustomMunicipalityKnowledge", **kw) -> None:
        self.kb = kb
        reg = {k: dict(v) for k, v in load_registry().items()}
        for k, v in CUSTOM_KEYS.items():
            reg[k] = {kk: vv for kk, vv in v.items() if kk != "help"}
        for v in reg.values():                                   # every key accepts custom documents, stamped with the profile
            v["doc_kinds"] = sorted(set(v.get("doc_kinds", [])) | {CUSTOM_KIND})
            v["authority_role"] = None
            v.setdefault("stamp", [])
            if "jurisdiction" not in v["stamp"]:
                v["stamp"] = list(v["stamp"]) + ["jurisdiction"]
            v["stamp"] = list(dict.fromkeys(list(v["stamp"]) + ["lga"]))
        super().__init__(LotRequirementContext(jurisdiction=CUSTOM_JURISDICTION, lga=kb.profile.council_label),
                         _Source(kb), registry=reg, **kw)

    # deterministic table/regex rules assume metric English documents with registry units: only then
    def _deterministic(self, key, d, sha):
        doc = self.kb.docs[d.doc_id]
        if doc.language.lower().startswith("en") and self.kb.profile.units.system == "metric" and key not in CUSTOM_KEYS:
            return super()._deterministic(key, d, sha)
        return []

    def _candidates(self, key, d):
        doc = self.kb.docs[d.doc_id]
        lang = doc.language.lower()
        if lang.startswith("en"):
            return super()._candidates(key, d)
        terms = self.kb.query_terms.get(lang, {}).get(key)
        if terms:
            seen, out = set(), []
            for q in terms:
                for c in self._ret[d.doc_id].search(q, k=self.top_k):
                    if c.chunk_id not in seen:
                        seen.add(c.chunk_id)
                        out.append(c)
            return out
        # no terms in this language: offer the numeric chunks in document order and let the model look
        nums = [c for c in self._chunks[d.doc_id] if re.search(r"\d", c.content)]
        return nums[: self.top_k * 3]

    def _llm(self, key, d, sha):
        doc = self.kb.docs[d.doc_id]
        ck = (key, self.ctx.canon(), sha, "llm")
        if ck in self._cache:
            self.cache_hits += 1
            return self._cache[ck]
        reg, chunks, res = self.reg[key], self._candidates(key, d), []
        if chunks:
            system = (
                "You extract ONE regulatory requirement from municipal engineering documents. Output ONLY JSON "
                '{"requirements":[{"chunk_id","quote","quote_en","value","unit","service","dia_min_mm","dia_max_mm","confidence"}]}. '
                f"The documents are in language '{doc.language}'. 'quote' MUST be an exact verbatim substring of the cited chunk in "
                "the ORIGINAL language, containing the value; never translate or paraphrase it. 'quote_en' is your English translation "
                "of that quote (it is shown to the reader as a machine translation only). 'value' is the number AS WRITTEN in the quote "
                "and 'unit' is the unit as written there (m, mm, ft, in, %, 1:n, L, gal ...). Do not convert and do not guess a "
                "unit that is not stated. Omit anything not explicitly stated. "
                f"Decimal separator in this document: '{self.kb.profile.locale.decimal_separator}'.")
            ctxt = "\n\n".join(f"[chunk_id={c.chunk_id} pages={c.page_from}-{c.page_to}]\n{c.content}" for c in chunks)
            user = (f"Requirement: {key} - {EXTRA_KEY_HELP.get(key) or key} (canonical unit {reg.get('unit', 'boolean')})\n"
                    f"Municipality: {self.kb.profile.council_label}\n\nCHUNKS:\n{ctxt}")
            self.llm_calls += 1
            resp = self.llm.complete(system, user, {"type": "object"})
            record_usage(resp.get("usage") or {})
            by = {c.chunk_id: c for c in chunks}
            for raw in resp.get("requirements", []):
                ch = by.get(raw.get("chunk_id"))
                if ch is None:
                    continue
                rq = self._make_custom(key, d, doc, ch, raw)
                if rq is not None:
                    res.append(rq)
        self._cache[ck] = res
        return res

    def _make_custom(self, key: str, d: DocRef, doc: CustomDoc, ch: Chunk, raw: dict) -> Requirement | None:
        reg, quote = self.reg[key], str(raw.get("quote", ""))
        if not quote.strip() or norm(quote) not in norm(ch.content):       # the ORIGINAL quote must be in the chunk
            return None
        sel = self._stamp(key, d)
        try:
            conf = min(float(raw.get("confidence", 0.6)), 0.8)
        except (TypeError, ValueError):
            conf = 0.6
        canon_unit = reg.get("unit")
        if reg["kind"] == "number":
            v, u = raw.get("value"), raw.get("unit")
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                return None
            if not any(abs(n - v) < 1e-9 for n in numbers_in(quote, self.kb.profile.locale.decimal_separator)):
                return None                                                # the number must be written in the quote
            if canon_unit == "count":
                cv = float(v)
            else:
                if not u:
                    return None                                            # no unit stated: never assumed
                try:
                    cv = convert(float(v), str(u), canon_unit, self.kb.profile.unit_context())
                except (AmbiguousUnit, UnitMismatch, UnitError):
                    return None                                            # stays unresolved with a prompt
            lo, hi = reg["range"]
            if not lo <= cv <= hi:
                return None
            value: Any = cv
            ent_v, ent_u = float(v), str(u) if u else None
        else:
            from app.agents.requirements.resolver import to_bool
            b = raw.get("value")
            if not isinstance(b, bool):
                return None
            value, ent_v, ent_u = b, None, None
        if raw.get("service"):
            from app.agents.requirements.resolver import norm_service
            sel.service = norm_service(str(raw["service"]))
        sel.dia_min_mm, sel.dia_max_mm = raw.get("dia_min_mm"), raw.get("dia_max_mm")
        en = raw.get("quote_en")
        if not en and self.kb.translator is not None and not doc.language.lower().startswith("en"):
            en = self.kb.translator.translate(quote, doc.language)
        is_en = doc.language.lower().startswith("en")
        return Requirement(
            key=key, applies_to=sel, value=value, unit=canon_unit, extraction_method="llm", confidence=conf, status="resolved",
            entered_value=ent_v, entered_unit=ent_u,
            source=Source(document_title=d.title, authority=d.authority, version=d.version, page=ch.page_from,
                          section_ref=ch.section_ref, quote=quote, source_url=d.source_url, sha256=doc.sha256, chunk_id=ch.chunk_id,
                          language=doc.language, quote_en=(quote if is_en else en) or None,
                          quote_en_machine_translated=bool(en) and not is_en))


# ---------------------------------------------------------------------------- knowledge base


class CustomMunicipalityKnowledge:
    def __init__(self, profile: JurisdictionProfile, workdir: str | Path, *, llm=None, translator: Translator | None = None,
                 embedder=None, query_terms: QueryTerms | None = None) -> None:
        self.profile, self.workdir = profile, Path(workdir)
        self.llm, self.translator, self.embedder = llm, translator, embedder
        self.query_terms: QueryTerms = query_terms or {}
        self.docs: dict[str, CustomDoc] = {}
        self.manual = RequirementSet()
        self.resolved = RequirementSet()
        (self.workdir / "docs").mkdir(parents=True, exist_ok=True)

    # ---- documents
    def add_document(self, path: str | Path, *, title: str | None = None, language: str = "en", authority: str = "",
                     version: str | None = None, source_url: str | None = None, kind: str = CUSTOM_KIND) -> CustomDoc:
        src = Path(path)
        if src.suffix.lower() != ".pdf":
            raise ValueError("only PDF documents can be ingested")
        data = src.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        doc_id = f"{self.profile.profile_id.hex[:8]}-{sha[:10]}"
        dest = self.workdir / "docs" / f"{doc_id}.pdf"
        if not dest.exists():
            shutil.copyfile(src, dest)
        d = CustomDoc(doc_id=doc_id, title=title or src.stem, path=str(dest), sha256=sha, language=language, kind=kind,
                      authority=authority or self.profile.council_label, version=version, source_url=source_url,
                      profile_id=str(self.profile.profile_id), municipality=self.profile.council_label)
        self.docs[doc_id] = d
        return d

    # ---- resolving
    def resolver(self) -> _CustomResolver:
        kw = {"embedder": self.embedder} if self.embedder is not None else {}
        return _CustomResolver(self, llm=self.llm, **kw)

    def standard_keys(self) -> list[str]:
        return list(load_registry().keys()) + list(CUSTOM_KEYS)

    def resolve(self, keys: list[str] | None = None) -> KnowledgeReport:
        self.resolved = self.resolver().resolve(keys or self.standard_keys())
        return self.report()

    # ---- manual entry
    def enter_value(self, key: str, value: Any, *, who: str, unit: str | None = None, note: str = "", **selectors: Any) -> Requirement:
        """User-entered value with an explicit unit; stored in the canonical unit AND as typed (entered_value/unit)."""
        reg = self.resolver().reg.get(key)
        if reg is None:
            raise KeyError(f"unknown requirement key {key!r}")
        sel = {"jurisdiction": CUSTOM_JURISDICTION, "lga": self.profile.council_label, **selectors}
        if reg["kind"] == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"{key} is yes/no")
            cv, canon, ent_v, ent_u = value, None, None, None
        else:
            canon = reg["unit"]
            if canon == "count":
                cv, ent_v, ent_u = float(value), float(value), unit
            else:
                if not unit:
                    raise AmbiguousUnit("", [canon], f"choose the unit for {key} (canonical {canon}); units are not assumed")
                cv = convert(float(value), unit, canon, self.profile.unit_context())     # raises UnitMismatch if wrong dimension
                ent_v, ent_u = float(value), unit
            lo, hi = reg["range"]
            if not lo <= cv <= hi:
                raise ValueError(f"{key}: {value} {unit} = {cv:g} {canon} is outside the plausible range {lo}..{hi} {canon}")
        r = RequirementsResolver.user_enter(self.manual, key, cv, who=who, unit=canon, note=note, **sel)
        r.entered_value, r.entered_unit = ent_v, ent_u
        return r

    # ---- views
    def requirement_set(self) -> RequirementSet:
        """Resolved + user-entered (+ unresolved prompts).  Accepted by SA3 / SA4 / SA10 as `requirements`."""
        rs = RequirementSet(requirements=list(self.manual.requirements) + list(self.resolved.requirements))
        return rs

    def report(self) -> KnowledgeReport:
        rep = KnowledgeReport()
        rs = self.requirement_set()
        seen_ok = {r.key for r in rs.requirements if r.usable}
        for r in rs.requirements:
            s = r.source
            row = ReportRow(key=r.key, status=r.status, value=r.value, unit=r.unit, citation=r.citation(),
                            quote_original=(s.quote if s else ""), quote_en=(s.quote_en if s else None),
                            quote_en_machine_translated=(s.quote_en_machine_translated if s else False), prompt=r.prompt)
            if r.usable:
                rep.resolved.append(row)
            elif r.status == "conflict":
                rep.conflicts.append(row)
            elif r.key not in seen_ok:
                rep.unresolved.append(row)
        return rep

    # ---- citation validation (ORIGINAL quote only)
    def verify_citations(self) -> list[str]:
        from app.agents.sa2_dcp_rag.ingest import ingest_pdf
        problems, cache = [], {}
        for r in self.requirement_set().citations():
            s = r.source
            if r.extraction_method == "user_entered" or s is None:
                continue
            doc = next((d for d in self.docs.values() if d.sha256 == s.sha256), None)
            if doc is None:
                problems.append(f"{r.key}: cited document sha {s.sha256[:10]} not in the knowledge base")
                continue
            if doc.doc_id not in cache:
                cache[doc.doc_id] = ingest_pdf(doc.path, doc.doc_id)[0]
            ch = next((c for c in cache[doc.doc_id] if c.chunk_id == s.chunk_id), None)
            if ch is None or norm(s.quote) not in norm(ch.content):
                problems.append(f"{r.key}: original-language quote not found in {doc.title}")
        return problems

    # ---- persistence
    def save(self) -> Path:
        p = self.workdir / "knowledge.json"
        p.write_text(json.dumps({
            "profile": self.profile.model_dump(mode="json"),
            "docs": [d.model_dump() for d in self.docs.values()],
            "manual": self.manual.model_dump(mode="json"), "resolved": self.resolved.model_dump(mode="json"),
            "query_terms": self.query_terms}, indent=1))
        return p

    @classmethod
    def load(cls, workdir: str | Path, **kw) -> "CustomMunicipalityKnowledge":
        raw = json.loads((Path(workdir) / "knowledge.json").read_text())
        kb = cls(JurisdictionProfile.model_validate(raw["profile"]), workdir, query_terms=raw.get("query_terms"), **kw)
        kb.docs = {d["doc_id"]: CustomDoc(**d) for d in raw["docs"]}
        kb.manual = RequirementSet.model_validate(raw["manual"])
        kb.resolved = RequirementSet.model_validate(raw["resolved"])
        return kb


def profile_requirements(profile: JurisdictionProfile, kb: CustomMunicipalityKnowledge | None = None,
                         base_dir: str | Path | None = None) -> RequirementSet:
    """RequirementSet for this profile (resolved from its documents + user entries).

    Pass the live `kb`, or `base_dir` holding a saved knowledge.json for the profile.  With neither, the set is
    EMPTY: every get() raises UnresolvedRequirement asking the user to supply the value (nothing is defaulted)."""
    if kb is not None:
        return kb.requirement_set()
    if base_dir is not None and (Path(base_dir) / "knowledge.json").exists():
        return CustomMunicipalityKnowledge.load(base_dir).requirement_set()
    return RequirementSet()
