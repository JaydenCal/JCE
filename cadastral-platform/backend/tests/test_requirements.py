import json
import re

import pytest
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

from app.agents.requirements import (LocalFolderSource, LotRequirementContext, RequirementKey, RequirementsResolver,
                                     UnresolvedRequirement)
from app.agents.requirements.models import Requirement, RequirementSet, Selectors
from app.agents.sa2_dcp_rag.ingest import sha256_file

S = getSampleStyleSheet()


def _tbl(rows):
    t = Table(rows)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]))
    return t


def _pdf(path, story, meta):
    SimpleDocTemplate(str(path)).build(story)
    path.with_suffix(".json").write_text(json.dumps(meta))


def make_docs(d):
    P = lambda t, s="Normal": Paragraph(t, S[s])  # noqa: E731
    _pdf(d / "basix.pdf", [
        P("1 Rainwater tanks", "Heading1"), P("Water saving target for new dwellings is 40%."),
        P("Minimum tank size is 2,000 L for a detached dwelling."),
        _tbl([["Requirement", "Value"], ["Roof area connected to tank", "80%"], ["Minimum demand connections", "3"]])],
        dict(title="BASIX Rule Sheet (synthetic)", kind="rwt_rule", authority="NSW DPHI", jurisdiction="NSW",
             version="2026.1", effective_date="2026-07-01", source_url="https://example.test/basix"))
    _pdf(d / "sw.pdf", [
        P("2 Build over and near asset requirements", "Heading1"),
        _tbl([["Service", "Pipe diameter (mm)", "Minimum clearance (m)", "Minimum cover (m)", "Minimum grade (%)"],
              ["Sewer", "up to 300", "1.2", "0.6", "2.0"], ["Sewer", "over 300", "2.4", "0.9", "1.0"],
              ["Water", "up to 300", "1.5", "0.75", "-"], ["Water", "over 300", "2.0", "0.9", "-"]]),
        _tbl([["Service", "Building over"], ["Sewer", "Not permitted"], ["Water", "Permitted with approval"]])],
        dict(title="Sydney Water Building Over Guide (synthetic)", kind="build_over", authority="Sydney Water",
             jurisdiction="NSW", version="v3", source_url="https://example.test/sw"))
    _pdf(d / "council.pdf", [
        P("3 Vehicle crossings", "Heading1"),
        _tbl([["Parameter", "Requirement"], ["Maximum driveway grade", "20%"], ["Maximum change of grade", "12%"],
              ["Minimum crossover width", "3.0 m"], ["Maximum crossover width", "5.5 m"]]),
        P("No crossover is permitted within 9 m of the tangent point of the kerb return.")],
        dict(title="Testville Engineering Standard (synthetic)", kind="council_engineering", authority="Testville Council",
             jurisdiction="NSW", lga="Testville", version="2025"))


@pytest.fixture(scope="module")
def docs(tmp_path_factory):
    d = tmp_path_factory.mktemp("govdocs")
    make_docs(d)
    return d


CTX = LotRequirementContext(jurisdiction="NSW", lga="Testville", zone="R2",
                            authorities={"water": "Sydney Water", "sewer": "Sydney Water"})


class FakeLlm:
    def __init__(self, bad=False):
        self.calls, self.bad = 0, bad

    def complete(self, system, user, schema):
        self.calls += 1
        cid = next(m for m in re.findall(r"chunk_id=(\S+?) ", user)
                   if "tangent point" in user.split(f"chunk_id={m} ")[1].split("[chunk_id=")[0])
        if self.bad == "quote":
            r = dict(chunk_id=cid, quote="crossovers shall be 9 m from anything", value=9)
        elif self.bad == "number":
            r = dict(chunk_id=cid, quote="within 9 m of the tangent point", value=12)
        elif self.bad == "chunk":
            r = dict(chunk_id="nope", quote="within 9 m of the tangent point", value=9)
        else:
            r = dict(chunk_id=cid, quote="within 9 m of the tangent point", value=9, confidence=0.9)
        return {"requirements": [dict(key="driveway.min_separation_m", **r)], "usage": {"model": "fake"}}


def resolve(docs, llm=None):
    rz = RequirementsResolver(CTX, LocalFolderSource(docs), llm=llm)
    return rz, rz.resolve()


def test_deterministic_extraction_with_exact_citations(docs):
    rz, rs = resolve(docs)
    assert rs.get(RequirementKey.RWT_WATER_TARGET_PCT, jurisdiction="NSW") == 40
    assert rs.get("rwt.min_tank_volume_l") == 2000 and rs.get("rwt.roof_connection_pct") == 80
    assert rs.get("rwt.demand_connections") == 3
    assert rs.get("util.clearance_m", service="sewer", dia_mm=100) == 1.2
    assert rs.get("util.clearance_m", service="sewer", dia_mm=450) == 2.4
    assert rs.get("util.clearance_m", service="water", dia_mm=300) == 1.5
    assert rs.get("sewer.min_grade_pct", dia_mm=100) == 2.0 and rs.get("water.min_cover_m", dia_mm=20) == 0.75
    assert rs.get("util.build_over_allowed", service="sewer") is False
    assert rs.get("util.build_over_allowed", service="water") is True
    assert rs.get("driveway.max_grade_pct", lga="Testville") == 20 and rs.get("driveway.max_width_m", lga="Testville") == 5.5
    assert rs.get("driveway.min_width_m", lga="Testville") == 3.0 and rs.get("driveway.max_grade_change_pct", lga="Testville") == 12
    r = rs.get_requirement("util.clearance_m", service="sewer", dia_mm=450)
    s, ch = r.source, None
    assert s.sha256 == sha256_file(docs / "sw.pdf") and s.authority == "Sydney Water" and s.version == "v3"
    assert s.page == 1 and s.source_url and r.extraction_method == "table" and r.status == "resolved"
    chunk = next(c for c in rz._chunks["sw"] if c.chunk_id == s.chunk_id)
    assert "2.4" in s.quote and s.quote in chunk.content
    t = rs.get_requirement("rwt.water_target_pct")
    assert t.extraction_method == "regex" and "40%" in t.source.quote


def test_unresolved_listed_with_prompt_and_get_raises(docs):
    _, rs = resolve(docs)
    un = {r.key: r for r in rs.unresolved()}
    assert "driveway.min_separation_m" in un and "util.min_cover_m" not in un
    with pytest.raises(UnresolvedRequirement) as e:
        rs.get("driveway.min_separation_m")
    assert "Please enter" in e.value.prompt or "supply" in e.value.prompt
    with pytest.raises(UnresolvedRequirement):                 # no band covers a 0 mm electricity service
        rs.get("util.clearance_m", service="electricity", dia_mm=0)


def test_missing_authority_doc_is_unresolved(docs):
    ctx = CTX.model_copy(update={"authorities": {"water": "Hunter Water", "sewer": "Hunter Water"}})
    rs = RequirementsResolver(ctx, LocalFolderSource(docs)).resolve()
    with pytest.raises(UnresolvedRequirement):
        rs.get("util.clearance_m", service="sewer", dia_mm=100)


def test_llm_only_for_unresolved_and_validated(docs):
    llm = FakeLlm()
    rz, rs = resolve(docs, llm)
    assert llm.calls == 1                                      # only the single unresolved key
    r = rs.get_requirement("driveway.min_separation_m", lga="Testville")
    assert r.value == 9 and r.extraction_method == "llm" and r.confidence <= 0.8
    assert "tangent point" in r.source.quote
    n = llm.calls
    rz.resolve()
    assert llm.calls == n and rz.cache_hits > 0                # cached by (key, ctx, sha256)


@pytest.mark.parametrize("bad", ["quote", "number", "chunk"])
def test_fabricated_llm_output_rejected(docs, bad):
    _, rs = resolve(docs, FakeLlm(bad))
    with pytest.raises(UnresolvedRequirement):
        rs.get("driveway.min_separation_m", lga="Testville")


def test_conflict_flagged_with_both_citations(tmp_path):
    make_docs(tmp_path)
    _pdf(tmp_path / "sw2.pdf", [Paragraph("2 Older guide", S["Heading1"]),
         _tbl([["Service", "Pipe diameter (mm)", "Minimum clearance (m)"], ["Sewer", "up to 300", "1.0"]])],
         dict(title="Sydney Water Older Guide (synthetic)", kind="build_over", authority="Sydney Water", jurisdiction="NSW"))
    rs = RequirementsResolver(CTX, LocalFolderSource(tmp_path)).resolve()
    c = [r for r in rs.requirements if r.status == "conflict"]
    assert len(c) == 1 and {a.value for a in c[0].alternatives} == {1.2, 1.0}
    assert len({a.source.sha256 for a in c[0].alternatives}) == 2 and "disagree" in c[0].prompt
    with pytest.raises(UnresolvedRequirement) as e:
        rs.get("util.clearance_m", service="sewer", dia_mm=100)
    assert e.value.conflict is not None
    assert rs.get("util.clearance_m", service="sewer", dia_mm=500) == 2.4      # other bands unaffected
    RequirementsResolver.user_enter(rs, "util.clearance_m", 1.2, who="jayden", service="sewer", dia_min_mm=0, dia_max_mm=300)
    assert rs.get("util.clearance_m", service="sewer", dia_mm=100) == 1.2       # user choice settles the conflict


def test_user_entered(docs):
    _, rs = resolve(docs)
    r = RequirementsResolver.user_enter(rs, "driveway.min_separation_m", 8.0, who="jayden@jce", unit="m",
                                        note="per council email 2026-10-01", lga="Testville")
    assert rs.get("driveway.min_separation_m", lga="Testville") == 8.0
    assert r.extraction_method == "user_entered" and r.status == "user_confirmed"
    assert r.source.entered_by == "jayden@jce" and r.source.entered_at is not None
    row = r.to_db_row()
    assert row["status"] == "user_confirmed" and row["entered_by"] == "jayden@jce"


def test_selector_specificity():
    rs = RequirementSet()
    for lga, v in ((None, 10.0), ("Testville", 20.0)):
        rs.add(Requirement(key="driveway.max_grade_pct", applies_to=Selectors(lga=lga), value=v, status="resolved"))
    assert rs.get("driveway.max_grade_pct", lga="Testville") == 20.0 and rs.get("driveway.max_grade_pct", lga="Other") == 10.0


def test_council_document_filter_accepts_an_lga_code(docs):
    key = "driveway.max_width_m"
    for lga in ("Testville", "nsw-testville", "TESTVILLE", "Testville Shire Council"):
        rz = RequirementsResolver(LotRequirementContext(jurisdiction="NSW", lga=lga), LocalFolderSource(docs))
        assert [d.lga for d in rz.governing_docs(key)] == ["Testville"], lga
    other = RequirementsResolver(LotRequirementContext(jurisdiction="NSW", lga="nsw-elsewhere"), LocalFolderSource(docs))
    assert other.governing_docs(key) == []
    qld = RequirementsResolver(LotRequirementContext(jurisdiction="QLD", lga="qld-testville"), LocalFolderSource(docs))
    assert qld.governing_docs(key) == []                                 # the NSW document is not a QLD council's
