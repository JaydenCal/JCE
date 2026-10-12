from datetime import date

import pytest
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

from app.agents.sa2_dcp_rag import extract as ex
from app.agents.sa2_dcp_rag.agent import Sa2DcpRag
from app.agents.sa2_dcp_rag.embeddings import ExternalEmbedder, HashingEmbedder
from app.agents.sa2_dcp_rag.ingest import ingest_pdf
from app.agents.sa2_dcp_rag.models import DocMeta, Sa2Input
from app.agents.sa2_dcp_rag.retrieve import InMemoryRetriever, build_hybrid_sql

CORNER = "On corner lots the secondary frontage setback must be 3.0 m to the side street boundary."


@pytest.fixture(scope="module")
def pdf(tmp_path_factory):
    p = tmp_path_factory.mktemp("d") / "dcp.pdf"
    s = getSampleStyleSheet()
    t = Table([["Zone", "Front setback", "Side setback", "Rear setback", "Site coverage"],
               ["R2", "6.0 m", "0.9 m", "6 m", "50%"], ["R3", "4.5 m", "0.9 m", "4 m", "60%"]])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]))
    story = [Paragraph("1 Introduction", s["Heading1"]), Paragraph("This plan applies to the Testville area. " * 5, s["Normal"]),
             Paragraph("4.1 Setbacks", s["Heading1"]), Paragraph("4.1.2 Front setbacks", s["Heading2"]),
             Paragraph("Table 1 sets minimum setbacks by zone.", s["Normal"]), t,
             Paragraph("4.1.3 Corner lots", s["Heading2"]), Paragraph(CORNER, s["Normal"]),
             Paragraph("A performance outcome alternative may be considered where amenity is maintained.", s["Normal"]),
             Paragraph("Figure 3 Setback diagram", s["Normal"])]
    SimpleDocTemplate(str(p)).build(story)
    return p


@pytest.fixture(scope="module")
def chunks(pdf):
    return ingest_pdf(pdf, "d1")


def test_ingest(chunks):
    cs, meta = chunks
    assert len(meta["sha256"]) == 64 and meta["page_count"] >= 1
    tb = [c for c in cs if c.kind == "table"]
    assert tb and tb[0].content.splitlines()[0].startswith("| Zone | Front setback")
    assert "| R2 | 6.0 m |" in tb[0].content
    assert any(c.kind == "figure_caption" for c in cs)
    assert any(c.section_ref and "4.1.2" in c.section_ref for c in cs)
    assert not any("6.0 m" in c.content for c in cs if c.kind == "text")


def test_table_parser_exact(chunks):
    tb = [c for c in chunks[0] if c.kind == "table"][0]
    rules = ex.parse_setback_table(tb, "R2")
    got = {r.element: (r.value_numeric, r.unit) for r in rules}
    assert got == {"front": (6.0, "m"), "side": (0.9, "m"), "rear": (6.0, "m"), "site_cover_max": (50.0, "percent")}
    assert ex.parse_setback_table(tb, "ZZ") == []


class FakeLlm:
    def __init__(self, rules):
        self.rules, self.calls = rules, []

    def complete(self, system, user, schema):
        self.calls.append((system, user))
        return {"rules": self.rules, "usage": {"model": "fake", "input_tokens": 100, "cache_read_input_tokens": 50,
                                               "output_tokens": 10}}


def _corner_chunk(chunks):
    return [c for c in chunks[0] if "secondary frontage" in c.content][0]


def test_llm_validation(chunks):
    c = _corner_chunk(chunks)
    good = dict(chunk_id=c.chunk_id, quote="secondary frontage setback must be 3.0 m", zone_code="R2",
                element="secondary_frontage", value_numeric=3.0, unit="m", lot_condition={"corner_lot": True})
    fab = {**good, "quote": "secondary frontage must be 2.0 m", "value_numeric": 2.0}
    uncited = {**good, "chunk_id": "nope"}
    badunit = {**good, "unit": "percent"}
    rng = {**good, "value_numeric": 99.0, "quote": "must be 99.0 m"}
    llm = FakeLlm([good, fab, uncited, badunit, rng])
    rules, unres, warns, used = ex.extract_rules(chunks[0], "R2", ["front", "secondary_frontage"], llm)
    sec = [r for r in rules if r.element == "secondary_frontage"]
    assert used and len(sec) == 1 and sec[0].method == "llm" and unres == []
    assert len(warns) == 4
    # stable prefix: system identical across lots, lot data only in user
    s1, u1 = ex.build_prompt(chunks[0], "R2", {"a": 1}, ["rear"])
    s2, u2 = ex.build_prompt(chunks[0], "R3", {"a": 2}, ["rear"])
    assert s1 == s2 and "R3" not in s2 and "R3" in u2


def test_llm_skipped_when_table_resolves(chunks):
    llm = FakeLlm([])
    ex.extract_rules(chunks[0], "R2", ["front", "side", "rear"], llm)
    assert llm.calls == []


def test_retrieval(chunks):
    r = InMemoryRetriever(chunks[0], HashingEmbedder())
    top = r.search("corner lot secondary frontage setback", 2)
    assert "secondary frontage" in top[0].content
    sql, p = build_hybrid_sql([0.1] * 1536, "front setback", lga_code="X", zone_code="R2")
    assert "<=>" in sql and "ts_rank_cd" in sql and p["lga"] == "X" and p["zone"] == "R2"
    assert HashingEmbedder().embed(["a"]).shape == (1, 1536)
    with pytest.raises(RuntimeError):
        ExternalEmbedder(api_key=None).embed(["x"]) if not __import__("os").environ.get("SA2_EMBEDDING_API_KEY") else (_ for _ in ()).throw(RuntimeError())


def test_agent_e2e_and_tokens(chunks, monkeypatch):
    c = _corner_chunk(chunks)
    llm = FakeLlm([dict(chunk_id=c.chunk_id, quote="secondary frontage setback must be 3.0 m", zone_code="R2",
                        element="secondary_frontage", value_numeric=3.0, unit="m")])
    rec = []

    class Ctx:
        def ensure_budget(self): pass
        def record_tokens(self, model, **kw): rec.append((model, kw))

    monkeypatch.setattr(ex, "current_invocation", lambda: Ctx())
    doc = DocMeta(doc_id="d1", title="Testville DCP", lga="Testville", effective_date=date(2020, 1, 1), chunks=chunks[0])
    out = Sa2DcpRag([doc], llm).run(Sa2Input(lga="testville", zone_code="R2", corner_lot=True))
    rs = out.setback_ruleset
    assert out.status == "unverified" and out.used_llm
    assert {r.element for r in rs.rules} == {"front", "side", "rear", "site_cover_max", "secondary_frontage"}
    assert rs.unresolved == ["garage_front"] and rs.citations
    assert any("performance-based alternative" in w for w in rs.warnings)
    assert any("2020-01-01" in w for w in rs.warnings)
    assert rec and rec[0][1]["fresh"] == 100 and rec[0][1]["cache_read"] == 50
    nz = Sa2DcpRag([doc]).run(Sa2Input(lga="Testville", zone_code="R9"))
    assert any("zone R9 not found" in w for w in nz.setback_ruleset.warnings) and not nz.setback_ruleset.rules
    assert Sa2DcpRag([doc]).run(Sa2Input(lga="Nowhere", zone_code="R2")).setback_ruleset.rules == []
