"""Build knowledge/gunnedah/requirements.json from candidates.json.

    python -I knowledge/gunnedah/build_requirements.py [--locate]

Pipeline: (1) ingest every manifest source with ingest=true using the SA2 pipeline (PDF -> ingest_pdf; HTML text ->
paragraph chunks), (2) run SA2's deterministic table parser first and report what it yields, (3) validate each
hand-read candidate in candidates.json with the same rules as the Requirements Resolver / SA2 validator
(quote must appear in the cited chunk after SA2 `norm`; for numeric values the number must appear in the quote;
cited page must lie in the chunk's page range), (4) keep only validated candidates as `Requirement`s and list the
rest as unresolved.  `--locate` fills in `page` for candidates that lack one (a lookup of where the quote sits).
No value is ever generated here: every value comes from candidates.json and must survive the checks.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
sys.path.insert(0, str(BACKEND))

from app.agents.requirements.models import Requirement, RequirementSet, Selectors, Source  # noqa: E402
from app.agents.requirements.resolver import NUM  # noqa: E402
from app.agents.sa2_dcp_rag.extract import norm, parse_setback_table  # noqa: E402
from app.agents.sa2_dcp_rag.ingest import ingest_pdf, tok  # noqa: E402
from app.agents.sa2_dcp_rag.models import Chunk  # noqa: E402

MAN = json.loads((BACKEND / "knowledge" / "manifest.json").read_text())
RAW = BACKEND / "knowledge" / "raw"
SRC = {s["id"]: s for s in MAN["sources"]}
MAX_T = 600


def chunk_text(text: str, doc_id: str) -> list[Chunk]:
    """HTML-derived text has no pages: one logical page (1); paragraphs are packed to <= MAX_T tokens."""
    chunks, cur = [], []
    def flush():
        if cur:
            body = "\n".join(cur)
            chunks.append(Chunk(chunk_id=f"{doc_id}-c{len(chunks):04d}", doc_id=doc_id, page_from=1, page_to=1,
                                kind="text", content=body, token_count=tok(body)))
            cur.clear()
    for ln in (l.strip() for l in text.splitlines()):
        if not ln:
            continue
        if cur and tok("\n".join(cur + [ln])) > MAX_T:
            flush()
        cur.append(ln)
    flush()
    return chunks


def ingest_all() -> dict[str, tuple[list[Chunk], dict]]:
    out = {}
    for s in MAN["sources"]:
        if s["status"] != "obtained" or not s.get("ingest"):
            continue
        p = RAW / s["filename"]
        if s["format"] == "pdf":
            out[s["id"]] = ingest_pdf(p, s["id"])
        else:
            t = (RAW / s["text_file"]).read_text()
            out[s["id"]] = (chunk_text(t, s["id"]), {"sha256": s["sha256"], "page_count": 1})
    return out


def table_parser_report(docs) -> list[dict]:
    """SA2's deterministic parser first. Reported (not used blindly): see README for why none are kept."""
    rep = []
    for zone in ("R2", "RU1"):
        for dtype in ("dwelling_house", "secondary_dwelling", "outbuilding"):
            for ch in docs["gunnedah_dcp_2025"][0]:
                if ch.kind == "table":
                    for r in parse_setback_table(ch, zone, dtype):
                        rep.append({"zone": zone, "dwelling_type_requested": dtype, "element": r.element,
                                    "value": r.value_numeric, "unit": r.unit, "chunk": r.source_chunk_id,
                                    "page": r.source_page, "quote": r.quote})
    return rep


def nums(q: str) -> list[float]:
    return [float(n.replace(",", "")) for n in NUM.findall(q)]


def number_in_quote(value: float, quote: str) -> bool:
    return any(abs(n - value) < 1e-9 or abs(n / 1000 - value) < 1e-9 or abs(n * 1000 - value) < 1e-9
               for n in nums(quote))


def find_chunks(chunks: list[Chunk], quote: str) -> list[Chunk]:
    q = norm(quote)
    return [c for c in chunks if q and q in norm(c.content)]


def validate(c: dict, docs) -> tuple[Chunk | None, str]:
    if c["doc"] not in docs:
        return None, f"document {c['doc']} not ingested"
    chunks = docs[c["doc"]][0]
    quote = c.get("quote", "")
    hits = find_chunks(chunks, quote)
    if not hits:
        return None, "quote not found in any chunk of the cited document"
    page = c.get("page")
    if page is None:
        return None, "no page given"
    hits = [h for h in hits if h.page_from <= page <= h.page_to]
    if not hits:
        return None, f"quote not on cited page {page}"
    v = c["value"]
    if isinstance(v, bool) or isinstance(v, str):
        pass                                    # categorical: the verbatim quote is the evidence
    elif not number_in_quote(float(v), quote):
        return None, f"value {v} not present in quote"
    for q2 in c.get("also_quotes", []):
        if not find_chunks(chunks, q2):
            return None, f"also_quote not found: {q2[:60]}"
    return hits[0], ""


def locate(c: dict, docs) -> int | None:
    chunks = docs[c["doc"]][0]
    hits = find_chunks(chunks, c["quote"])
    return hits[0].page_from if hits else None


def to_requirement(c: dict, ch: Chunk) -> Requirement:
    s = SRC[c["doc"]]
    sel = Selectors(jurisdiction=s.get("jurisdiction"), authority=s["authority"], lga=c.get("lga", s.get("lga")),
                    zone=c.get("zone"), service=c.get("service"))
    struct = dict(c.get("value_struct") or {})
    if c.get("also_quotes"):
        struct["also_quotes"] = c["also_quotes"]
    if c.get("notes"):
        struct["notes"] = c["notes"]
    v = c["value"]
    return Requirement(
        key=c["key"], applies_to=sel, value=v, value_struct=struct or None, unit=c.get("unit"),
        source=Source(document_title=s["title"], authority=s["authority"], version=s.get("version"),
                      effective_date=date.fromisoformat(s["effective_date"]) if s.get("effective_date") else None,
                      page=c["page"], section_ref=c["section_ref"], quote=c["quote"], source_url=s["url"],
                      retrieved_at=datetime.fromisoformat(s["retrieved_at"]), sha256=s["sha256"], chunk_id=ch.chunk_id),
        extraction_method="llm", confidence=min(float(c.get("confidence", 0.85)), 0.85), status="resolved",
        prompt=c.get("confirm"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--locate", action="store_true", help="fill missing `page` values in candidates.json")
    a = ap.parse_args()
    docs = ingest_all()
    cpath = HERE / "candidates.json"
    cands = json.loads(cpath.read_text())["candidates"]
    if a.locate:
        for c in cands:
            if c.get("page") is None:
                c["page"] = locate(c, docs)
        cpath.write_text(json.dumps({"candidates": cands}, indent=1, ensure_ascii=False) + "\n")
    rs, rejected = RequirementSet(), []
    for c in cands:
        ch, why = validate(c, docs)
        if ch is None:
            rejected.append({"id": c["id"], "key": c["key"], "reason": why})
        else:
            rs.add(to_requirement(c, ch))
    (HERE / "requirements.json").write_text(json.dumps(
        {"region": MAN["region"], "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
         "requirements": [r.model_dump(mode="json") for r in rs.requirements]}, indent=1, ensure_ascii=False) + "\n")
    tp = table_parser_report(docs)
    unresolved = json.loads((HERE / "unresolved.json").read_text()) if (HERE / "unresolved.json").exists() else []
    (HERE / "validation_report.json").write_text(json.dumps(
        {"candidates": len(cands), "validated": len(rs.requirements), "rejected": rejected,
         "table_parser_rules": tp, "chunks": {k: len(v[0]) for k, v in docs.items()},
         "unresolved_items": len(unresolved)}, indent=1, ensure_ascii=False) + "\n")
    print(f"candidates={len(cands)} validated={len(rs.requirements)} rejected={len(rejected)} "
          f"table_parser_rules={len(tp)} unresolved={len(unresolved)}")
    for r in rejected:
        print("REJECTED", r["id"], r["reason"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
