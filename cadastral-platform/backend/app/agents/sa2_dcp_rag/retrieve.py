from __future__ import annotations

import math
import re
from collections import Counter

import numpy as np

from app.agents.sa2_dcp_rag.embeddings import Embedder
from app.agents.sa2_dcp_rag.models import Chunk

KEYWORDS = ["front", "side", "rear", "secondary frontage", "secondary street", "garage", "site coverage",
            "setback", "corner", "boundary", "building line", "landscap"]
UNIT_RE = re.compile(r"\b\d+(\.\d+)?\s?(m|mm|%)(\b|$)")
ZONE_RE = re.compile(r"\b(R[1-5]|RU\d|E[1-4]|MU1|B[1-8]|LDR|MDR|HDR|LMR|NUZ|IN\d|SP\d)\b")


def rule_boost(content: str, zone_code: str | None = None) -> float:
    c = content.lower()
    b = 0.1 * sum(k in c for k in KEYWORDS)
    b += 0.2 if UNIT_RE.search(content) else 0
    if zone_code and re.search(rf"\b{re.escape(zone_code)}\b", content, re.I):
        b += 0.4
    elif ZONE_RE.search(content):
        b += 0.05
    return b


def rrf(rankings: list[list[str]], k: int = 60) -> dict[str, float]:
    s: dict[str, float] = {}
    for r in rankings:
        for i, cid in enumerate(r):
            s[cid] = s.get(cid, 0.0) + 1.0 / (k + i + 1)
    return s


def _toks(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower())


class InMemoryRetriever:
    def __init__(self, chunks: list[Chunk], embedder: Embedder) -> None:
        self.chunks = chunks
        self.emb = embedder
        self.mat = embedder.embed([c.content for c in chunks]) if chunks else np.zeros((0, 1))
        self.tf = [Counter(_toks(c.content)) for c in chunks]
        n = max(len(chunks), 1)
        df = Counter(t for tf in self.tf for t in tf)
        self.idf = {t: math.log(1 + n / d) for t, d in df.items()}

    def search(self, query: str, k: int = 10, zone_code: str | None = None, boost_weight: float = 0.02) -> list[Chunk]:
        if not self.chunks:
            return []
        q = self.emb.embed([query])[0]
        vec = self.mat @ q
        qt = _toks(query)
        lex = np.array([sum(self.idf.get(t, 0) * tf[t] / (1 + tf[t]) for t in qt) for tf in self.tf])
        ids = [c.chunk_id for c in self.chunks]
        vr = [ids[i] for i in np.argsort(-vec)]
        lr = [ids[i] for i in np.argsort(-lex) if lex[i] > 0]
        fused = rrf([vr, lr])
        for c in self.chunks:
            fused[c.chunk_id] = fused.get(c.chunk_id, 0) + boost_weight * rule_boost(c.content, zone_code)
        by = {c.chunk_id: c for c in self.chunks}
        return [by[i] for i in sorted(fused, key=fused.get, reverse=True)[:k]]


def build_hybrid_sql(embedding: list[float], query_text: str, *, document_ids: list[str] | None = None,
                     lga_code: str | None = None, zone_code: str | None = None, k: int = 20,
                     pool: int = 50) -> tuple[str, dict]:
    """pgvector cosine + tsvector rank fused with RRF (k=60). Returns (sql, params) for psycopg named params."""
    where, p = ["TRUE"], {"emb": "[" + ",".join(f"{x:.6f}" for x in embedding) + "]", "q": query_text,
                          "pool": pool, "k": k}
    if document_ids:
        where.append("c.dcp_document_id = ANY(%(docs)s::uuid[])")
        p["docs"] = document_ids
    if lga_code:
        where.append("d.lga_code = %(lga)s")
        p["lga"] = lga_code
    if zone_code:
        where.append("c.content ~* ('\\m' || %(zone)s || '\\M')")
        p["zone"] = zone_code
    w = " AND ".join(where)
    base = ("FROM planning.dcp_chunks c JOIN planning.dcp_documents d USING (dcp_document_id) "
            f"WHERE {w} AND d.superseded_date IS NULL")
    sql = f"""WITH vec AS (
  SELECT c.chunk_id, row_number() OVER (ORDER BY c.embedding <=> %(emb)s::vector) AS r {base}
  ORDER BY c.embedding <=> %(emb)s::vector LIMIT %(pool)s),
fts AS (
  SELECT c.chunk_id, row_number() OVER (ORDER BY ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', %(q)s)) DESC) AS r
  {base} AND c.content_tsv @@ websearch_to_tsquery('english', %(q)s)
  ORDER BY ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', %(q)s)) DESC LIMIT %(pool)s),
fused AS (
  SELECT chunk_id, sum(1.0 / (60 + r)) AS score FROM (SELECT * FROM vec UNION ALL SELECT * FROM fts) u GROUP BY chunk_id)
SELECT c.chunk_id::text, c.dcp_document_id::text, c.page_from, c.page_to, c.section_ref, c.chunk_kind, c.content,
       c.token_count, f.score
FROM fused f JOIN planning.dcp_chunks c USING (chunk_id) ORDER BY f.score DESC LIMIT %(k)s"""
    return sql, p


def pg_search(conn, embedder: Embedder, query: str, zone_code: str | None = None, **filters) -> list[Chunk]:
    sql, p = build_hybrid_sql(embedder.embed([query])[0].tolist(), query, zone_code=zone_code, **filters)
    with conn.cursor() as cur:
        cur.execute(sql, p)
        rows = cur.fetchall()
    out = [Chunk(chunk_id=r[0], doc_id=r[1], page_from=r[2], page_to=r[3], section_ref=r[4], kind=r[5],
                 content=r[6], token_count=r[7]) for r in rows]
    out.sort(key=lambda c: -rule_boost(c.content, zone_code) * 0.0)  # stable; fusion order preserved
    return out
