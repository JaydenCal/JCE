"""Build knowledge/esc/requirements.json from candidates.json (ESC controls: Blue Book vol 1, Building Sites 2024, Gunnedah).

    python -I knowledge/esc/fetch_esc_docs.py        # download PDFs, sha256, sources.json
    python -I knowledge/esc/build_requirements.py    # ingest (SA2 ingest_pdf, chunk cache in raw/esc), validate, write

Every candidate is an exact quote read by a model/human from the document. It is KEPT only if (SA2 `norm`) the quote is found in
a chunk of the cited document, the page is located in that PDF page, and for numeric values the number (or mm/m equivalent) appears
in the quote. Nothing is invented: unresolved items are listed in unresolved.json.
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
sys.path.insert(0, str(BACKEND))

import pdfplumber  # noqa: E402

from app.agents.requirements.models import Requirement, RequirementSet, Selectors, Source  # noqa: E402
from app.agents.requirements.resolver import NUM  # noqa: E402
from app.agents.sa2_dcp_rag.extract import norm  # noqa: E402
from app.agents.sa2_dcp_rag.ingest import ingest_pdf  # noqa: E402
from app.agents.sa2_dcp_rag.models import Chunk  # noqa: E402

RAW = BACKEND / "knowledge" / "raw"
SRC = {s["id"]: s for s in json.loads((HERE / "sources.json").read_text())["sources"]}
SRC.update({s["id"]: s for s in json.loads((BACKEND / "knowledge" / "manifest.json").read_text())["sources"]
            if s["id"] == "gunnedah_eng_standards_2025"})


def load_chunks(doc: str) -> list[Chunk]:
    if doc.startswith("gunnedah"):
        data = json.loads((RAW / "chunks" / f"{doc}.json").read_text())
        data = data if isinstance(data, list) else data.get("chunks", data)
        return [Chunk.model_validate(c) for c in data]
    cache = RAW / "esc" / f"chunks_{doc}.json"
    if not cache.exists():
        ch, _ = ingest_pdf(RAW / "esc" / SRC[doc]["filename"], doc)
        cache.write_text(json.dumps([c.model_dump(mode="json") for c in ch]))
        return ch
    return [Chunk.model_validate(c) for c in json.loads(cache.read_text())]


def nums(q: str) -> list[float]:
    return [float(n.replace(",", "")) for n in NUM.findall(q)]


def number_in_quote(v: float, q: str) -> bool:
    return any(abs(n - v) < 1e-9 or abs(n / 1000 - v) < 1e-9 or abs(n * 1000 - v) < 1e-9 for n in nums(q))


_pdfs: dict[str, pdfplumber.PDF] = {}


def page_of(doc: str, ch: Chunk, quote: str) -> int | None:
    """Exact PDF page: search the chunk's pages one by one (a quote may not span a page break)."""
    if ch.page_from == ch.page_to:
        return ch.page_from
    s = SRC[doc]
    path = (RAW / "esc" / s["filename"]) if not doc.startswith("gunnedah") else (RAW / s["filename"])
    pdf = _pdfs.setdefault(doc, pdfplumber.open(path))
    for p in range(ch.page_from, ch.page_to + 1):
        if norm(quote) in norm(pdf.pages[p - 1].extract_text() or ""):
            return p
    return None


def main() -> int:
    cands = json.loads((HERE / "candidates.json").read_text())["candidates"]
    chunks: dict[str, list[Chunk]] = {}
    rs, rejected = RequirementSet(), []
    for c in cands:
        doc = c["doc"]
        s = SRC[doc]
        chunks.setdefault(doc, load_chunks(doc))
        q = norm(c["quote"])
        hits = [k for k in chunks[doc] if q in norm(k.content)]
        if not hits:
            rejected.append({"id": c["id"], "key": c["key"], "reason": "quote not found in any chunk"})
            continue
        v = c["value"]
        if not isinstance(v, (bool, str)) and not number_in_quote(float(v), c["quote"]):
            rejected.append({"id": c["id"], "key": c["key"], "reason": f"value {v} not in quote"})
            continue
        ch, page = hits[0], None
        for h in hits:
            page = page_of(doc, h, c["quote"])
            if page:
                ch = h
                break
        if page is None:
            rejected.append({"id": c["id"], "key": c["key"], "reason": "quote spans a page break; page not resolvable"})
            continue
        sel = Selectors(jurisdiction=s.get("jurisdiction", "NSW"), authority=s["authority"], lga=s.get("lga"), zone=c.get("zone"))
        eff = s.get("effective_date")
        rs.add(Requirement(
            key=c["key"], applies_to=sel, value=v, value_struct=c.get("value_struct"), unit=c.get("unit"),
            source=Source(document_title=s["title"], authority=s["authority"], version=s.get("version"),
                          effective_date=date.fromisoformat(eff) if eff else None, page=page, section_ref=c["section_ref"],
                          quote=c["quote"], source_url=s["url"], retrieved_at=datetime.fromisoformat(s["retrieved_at"]),
                          sha256=s["sha256"], chunk_id=ch.chunk_id),
            extraction_method="llm", confidence=min(float(c.get("confidence", 0.85)), 0.85), status="resolved",
            prompt=c.get("confirm")))
    unresolved = json.loads((HERE / "unresolved.json").read_text())
    (HERE / "requirements.json").write_text(json.dumps(
        {"region": "NSW (ESC: Blue Book vol 1, Building Sites 2024, Gunnedah Eng. Standards 7.4.1)",
         "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
         "requirements": [r.model_dump(mode="json") for r in rs.requirements]}, indent=1, ensure_ascii=False) + "\n")
    (HERE / "validation_report.json").write_text(json.dumps(
        {"candidates": len(cands), "validated": len(rs.requirements), "rejected": rejected, "unresolved_items": len(unresolved),
         "chunks": {k: len(v) for k, v in chunks.items()}}, indent=1) + "\n")
    print(f"candidates={len(cands)} validated={len(rs.requirements)} rejected={len(rejected)} unresolved={len(unresolved)}")
    for r in rejected:
        print("REJECTED", r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
