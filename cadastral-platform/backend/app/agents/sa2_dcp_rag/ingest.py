from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pdfplumber

from app.agents.sa2_dcp_rag.models import Chunk

HEAD = re.compile(r"^(\d+(?:\.\d+){0,4})\.?\s+([A-Z][^\n]{2,100})$")
FIG = re.compile(r"^(Figure|Fig\.|Diagram)\s*\d+", re.I)
MIN_T, MAX_T, OVERLAP_T = 300, 600, 50


def tok(s: str) -> int:
    return max(1, int(len(s.split()) * 1.3))


def sha256_file(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _cell(c: object) -> str:
    return re.sub(r"\s+", " ", str(c or "")).replace("|", "/").strip()


def table_to_md(rows: list[list]) -> list[str]:
    rows = [[_cell(c) for c in r] for r in rows if any(_cell(c) for c in r)]
    return ["| " + " | ".join(r) + " |" for r in rows]


def _table_chunks(lines: list[str]) -> list[str]:
    """Split markdown table lines into <=MAX_T pieces, repeating header (row + separator) on each."""
    if not lines:
        return []
    ncol = lines[0].count("|") - 1
    header = [lines[0], "|" + " --- |" * max(ncol, 1)]
    out, cur = [], list(header)
    for ln in lines[1:]:
        if len(cur) > 2 and tok("\n".join(cur + [ln])) > MAX_T:
            out.append("\n".join(cur))
            cur = list(header)
        cur.append(ln)
    out.append("\n".join(cur))
    return out


def ingest_pdf(path: str | Path, doc_id: str = "doc") -> tuple[list[Chunk], dict]:
    """PDF -> chunks. Returns (chunks, meta{sha256, page_count})."""
    chunks: list[Chunk] = []
    section: str | None = None
    buf: list[str] = []  # text lines of current section
    buf_pages: list[int] = []

    def add(kind, content, p0, p1, sec):
        chunks.append(Chunk(chunk_id=f"{doc_id}-c{len(chunks):04d}", doc_id=doc_id, page_from=p0, page_to=p1,
                            section_ref=sec, kind=kind, content=content, token_count=tok(content)))

    def flush(final_sec: str | None):
        nonlocal buf, buf_pages
        if not buf:
            return
        words_cur: list[str] = []
        pg: list[int] = []
        for ln, p in zip(buf, buf_pages):
            words_cur.append(ln)
            pg.append(p)
            if tok(" ".join(words_cur)) >= MIN_T and ln.rstrip().endswith((".", ":")):
                add("text", "\n".join(words_cur), min(pg), max(pg), final_sec)
                tail = " ".join(" ".join(words_cur).split()[-int(OVERLAP_T / 1.3):])
                words_cur, pg = [tail], [p]
            elif tok(" ".join(words_cur)) >= MAX_T:
                add("text", "\n".join(words_cur), min(pg), max(pg), final_sec)
                tail = " ".join(" ".join(words_cur).split()[-int(OVERLAP_T / 1.3):])
                words_cur, pg = [tail], [p]
        if len(words_cur) > 1 or (words_cur and not (chunks and chunks[-1].content.endswith(words_cur[0]))):
            add("text", "\n".join(words_cur), min(pg), max(pg), final_sec)
        buf, buf_pages = [], []

    with pdfplumber.open(str(path)) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            tables = page.find_tables()
            boxes = [t.bbox for t in tables]
            pg = page.filter(lambda o: not any(
                b[0] - 1 <= o.get("x0", 0) and o.get("x1", 0) <= b[2] + 1 and b[1] - 1 <= o.get("top", -9) and
                o.get("bottom", 1e9) <= b[3] + 1 for b in boxes)) if boxes else page
            lines = [l.strip() for l in (pg.extract_text() or "").splitlines() if l.strip()]
            # tables are emitted after the page's text so they carry the page's last heading
            for ln in lines:
                m = HEAD.match(ln)
                if m and not ln.endswith("."):
                    flush(section)
                    section = ln
                elif FIG.match(ln):
                    add("figure_caption", ln, pno, pno, section)
                else:
                    buf.append(ln)
                    buf_pages.append(pno)
            flush(section)
            for t in tables:
                for piece in _table_chunks(table_to_md(t.extract())):
                    add("table", piece, pno, pno, section)
        meta = {"sha256": sha256_file(path), "page_count": len(pdf.pages)}
    return chunks, meta
