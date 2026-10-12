from __future__ import annotations

from app.agents.sa2_dcp_rag.embeddings import Embedder, HashingEmbedder
from app.agents.sa2_dcp_rag.extract import LlmClient, extract_rules
from app.agents.sa2_dcp_rag.models import Citation, DocMeta, Sa2Input, Sa2Output, SetbackRuleset
from app.agents.sa2_dcp_rag.retrieve import InMemoryRetriever
from app.common.contracts import AgentCode

QUERY = "front side rear secondary frontage garage setback site coverage {zone} {dwelling} corner lot"


class Sa2DcpRag:
    code = AgentCode.SA2_DCP_RAG
    version = "0.1.0"
    input_schema = "sa2.dcp_rag.input.v1"
    output_schema = "sa2.setback_ruleset.v1"
    input_model = Sa2Input

    def __init__(self, documents: list[DocMeta], llm: LlmClient | None = None, embedder: Embedder | None = None,
                 top_k: int = 12) -> None:
        self.docs, self.llm, self.emb, self.top_k = documents, llm, embedder or HashingEmbedder(), top_k

    def run(self, payload: Sa2Input) -> Sa2Output:
        warns: list[str] = []
        docs = [d for d in self.docs if d.lga.lower() == payload.lga.lower()]
        if not docs:
            return Sa2Output(setback_ruleset=SetbackRuleset(
                unresolved=self._required(payload), warnings=[f"no DCP document ingested for LGA {payload.lga}"]))
        chunks = [c for d in docs for c in d.chunks]
        titles = {d.doc_id: d for d in docs}
        for d in docs:
            warns.append(f"document '{d.title}' effective date {d.effective_date or 'unknown'}")
        if not any(payload.zone_code.upper() in c.content.upper().split() or f" {payload.zone_code.upper()} " in
                   f" {c.content.upper()} " for c in chunks):
            warns.append(f"zone {payload.zone_code} not found in documents")
        top = InMemoryRetriever(chunks, self.emb).search(QUERY.format(zone=payload.zone_code, dwelling=payload.dwelling_type.replace("_", " ")), self.top_k,
                                                          payload.zone_code)
        cand = {c.chunk_id: c for c in top}
        for c in chunks:  # setback tables are critical: always offer them
            if c.kind == "table":
                cand.setdefault(c.chunk_id, c)
        lot = payload.model_dump(exclude={"lga", "zone_code", "dwelling_type"}, exclude_none=True)
        rules, unresolved, w, used = extract_rules(list(cand.values()), payload.zone_code, self._required(payload),
                                                   self.llm, lot, payload.dwelling_type)
        warns += w
        if any("performance" in c.content.lower() and ("alternative" in c.content.lower() or "outcome" in
               c.content.lower()) for c in cand.values()):
            warns.append("performance-based alternative exists")
        if unresolved and payload.dwelling_type != "dwelling_house":
            warns.append(f"UNRESOLVED for dwelling_type '{payload.dwelling_type}': dwelling-house rules are NOT substituted")
        cites, seen = [], set()
        for r in rules:
            if r.source_chunk_id not in seen:
                seen.add(r.source_chunk_id)
                c = cand[r.source_chunk_id]
                cites.append(Citation(chunk_id=c.chunk_id, page_from=c.page_from, page_to=c.page_to,
                                      section_ref=c.section_ref, doc_title=titles[c.doc_id].title))
        if unresolved:
            warns.append("unresolved elements: " + ", ".join(unresolved))
        return Sa2Output(setback_ruleset=SetbackRuleset(rules=rules, citations=cites, unresolved=unresolved,
                                                        warnings=warns), used_llm=used)

    @staticmethod
    def _required(p: Sa2Input) -> list[str]:
        return ["front", "side", "rear"] + (["secondary_frontage"] if p.corner_lot else []) + ["garage_front",
                                                                                              "site_cover_max"] + (
            ["height_max"] if p.dwelling_type != "dwelling_house" else [])
