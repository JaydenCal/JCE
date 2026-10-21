"""JCESITE site works SoEE (app/pack/soee_site.py, soee_site_out.py, scripts/run_soee.py).

The module scoped fixture runs the OFFLINE Lot 2 DP227508 pipeline once (no network, about 20 seconds), builds the SoEE and writes the PDF and DOCX into a
temporary directory.  The DOCX is also rendered to PDF with LibreOffice when it is installed (the pagination test skips otherwise).
"""
import copy
import importlib.util
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.pack import soee_site as S  # noqa: E402
from app.pack import soee_site_out as O  # noqa: E402

BLD = S.BUILDING_BY_OTHERS
TODAY = date(2026, 10, 14)


def _runner():
    spec = importlib.util.spec_from_file_location("run_soee_t", BACKEND / "scripts" / "run_soee.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["run_soee_t"] = mod
    spec.loader.exec_module(mod)
    return mod


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    d = tmp_path_factory.mktemp("soee_run")
    rules = Path("/home/claude/work/out/rules/R2_dwelling_house.json")
    try:
        cache = _runner().run_pipeline(d, str(rules) if rules.exists() else None, "fixture")
    except SystemExit as ex:  # pragma: no cover
        pytest.skip(f"offline Lot 2 pipeline not available: {ex}")
    return d, cache


def _inputs(run, today=TODAY, **kw):
    d, cache = run
    cp = d / "constraints_report.json"
    return S.SoeeSiteInputs(constraints=json.loads(cp.read_text()), run=json.loads((d / "run_steps.json").read_text()), works=copy.deepcopy(cache["works"]),
                            requirements=S.load_requirement_set(), sources=S.load_sources(), today=today, **kw)


@pytest.fixture(scope="module")
def doc(run):
    return S.build_site_soee(_inputs(run))


@pytest.fixture(scope="module")
def out(run, doc, tmp_path_factory):
    d = tmp_path_factory.mktemp("soee_out")
    res = O.write_all(doc, d, png=False)
    dp = O.docx_to_pdf(Path(res["docx"]), d / "docx_check")
    return {"dir": d, "pdf": Path(res["pdf"]), "docx": Path(res["docx"]), "json": Path(res["json"]), "docx_pdf": dp}


def _docx_text(path: Path) -> str:
    from docx import Document
    d = Document(str(path))
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for r in t.rows:
            parts += [c.text for c in r.cells]
    for s in d.sections:
        parts += [p.text for p in s.header.paragraphs] + [p.text for p in s.footer.paragraphs]
    return "\n".join(parts)


def _pdf_text(path: Path) -> str:
    return "\n".join(O.page_texts(path))


def _all_text(doc, out) -> dict[str, str]:
    return {"model": doc.to_text(), "pdf": _pdf_text(out["pdf"]), "docx": _docx_text(out["docx"]), "json": out["json"].read_text()}


# ---------------------------------------------------------------------------------------------------------------- branding and scope
def test_no_jce_branding(doc, out):
    for name, t in _all_text(doc, out).items():
        assert not re.search(r"JCE(?!SITE)", t), f"JCE name in {name}"
        assert "ABN" not in t, f"ABN in {name}"
        assert not re.search(r"jce\s*infrastructure|jceinfrastructure", t, re.I), f"company name in {name}"
    assert "JCESITE" in _pdf_text(out["pdf"])
    from docx import Document
    assert not Document(str(out["docx"])).inline_shapes, "DOCX carries an image (logo)"
    import pymupdf
    with pymupdf.open(str(out["pdf"])) as pd:
        assert not any(pg.get_images() for pg in pd), "PDF carries an image (logo)"


def test_building_is_described_only_as_by_others(doc, out):
    t = _norm(_pdf_text(out["pdf"]))
    assert BLD in t
    assert "SITE WORKS ONLY" in t


def test_no_dwelling_numbers(doc):
    """No floor area, height, setback, floor level, BASIX or footprint figure is stated for the building."""
    pat = re.compile(r"\b(floor area|gross floor|gfa|building height|ridge|setback|ffl|floor level|basix|footprint|storey|bedroom)\b[^.\n]{0,80}\d", re.I)
    for s in doc.statements():
        assert not pat.search(s.text), s.text
    t = doc.to_text()
    assert "15.0 x 10.5" not in t and "ILLUSTRATIVE" not in t.upper().replace("ILLUSTRATIVE BUILDING FOOTPRINT THAT THE PLATFORM PRESETS", "")
    assert not re.search(r"\bFFL\b", t)


def test_dates_are_dd_mm_yyyy(doc, out):
    assert re.fullmatch(r"\d{2}/\d{2}/\d{4}", doc.date)
    assert doc.date == "14/10/2026"
    for name, t in _all_text(doc, out).items():
        if name == "json":
            continue
        assert not re.search(r"\b\d{4}-\d{2}-\d{2}\b", t), f"ISO date in {name}"


# ---------------------------------------------------------------------------------------------------------------- verification box (stage 8)
from app.common.statement import AI_DRAFT_STATEMENT, VERIFY_FIELDS, VERIFY_STATEMENT  # noqa: E402


def test_verification_box_on_the_pdf_cover_only_and_no_ai_statement(out):
    pages = O.page_texts(out["pdf"])
    assert len(pages) > 5
    cover = _norm(pages[0]).upper()
    assert VERIFY_STATEMENT in cover and all(f in cover for f in VERIFY_FIELDS)
    assert "STATEMENT OF ENVIRONMENTAL EFFECTS" in pages[0] and "DRAFT" in pages[0]
    for i, t in enumerate(pages, 1):
        n = _norm(t).upper()
        assert "AI GENERATED DRAFT" not in n and AI_DRAFT_STATEMENT not in n, f"PDF page {i}"
        if i > 1:
            assert "SIGNATURE" not in n, f"PDF page {i}"                           # the signature box is on the cover only (section 1.1 states the limitation in words)


def test_verification_box_in_docx_cover_only_and_no_ai_in_footer(out):
    from docx import Document
    d = Document(str(out["docx"]))
    for s in d.sections:
        assert "AI GENERATED" not in " ".join(p.text for p in s.footer.paragraphs).upper()
        assert VERIFY_STATEMENT not in " ".join(p.text for p in s.footer.paragraphs).upper()
    txt = _docx_text(out["docx"])
    assert VERIFY_STATEMENT in txt.upper() and txt.upper().count("SIGNATURE") == 1 and "AI GENERATED DRAFT" not in txt.upper()


def test_no_ai_statement_on_any_docx_page(out):
    if out["docx_pdf"] is None:
        pytest.skip("LibreOffice not installed")
    pages = O.page_texts(out["docx_pdf"])
    for i, t in enumerate(pages, 1):
        n = _norm(t).upper()
        assert "AI GENERATED DRAFT" not in n, f"DOCX page {i}"
        assert ("SIGNATURE" in n) == (i == 1), f"DOCX page {i}"


# ---------------------------------------------------------------------------------------------------------------- style
CONTRACTION = re.compile(r"\b\w+n't\b|\b\w+'(?:ll|re|ve|d|m)\b|\b(?:it|that|there|let|he|she|what|here|who)'s\b", re.I)


def test_no_em_en_dashes_or_contractions(doc, out):
    for name, t in _all_text(doc, out).items():
        assert not re.search(r"[–—‒―]", t), f"dash in {name}"
        assert not CONTRACTION.search(t), f"contraction in {name}: {CONTRACTION.search(t).group(0)}"
    for s in doc.statements():
        assert not re.search(r"[–—]", s.text)


# ---------------------------------------------------------------------------------------------------------------- structure
def test_every_415_heading_present(doc, out):
    heads = doc.headings()
    pdf = _norm(_pdf_text(out["pdf"]))
    for _k, h in S.S415:
        assert h in heads
        assert _norm(h) in pdf, h
    for n in ("a_i", "a_ii", "a_iii", "a_iiia", "a_iv", "b", "c", "d", "e"):
        assert any(k == n for k, _ in S.S415)
    assert len(S.S415) == 9
    for i, m in enumerate(S.MATTERS, 1):
        assert f"5.{i} {m}" in heads, m
    for needle in ("Context and setting", "Access and traffic", "Stormwater", "Earthworks and erosion", "Flooding", "Bushfire", "Heritage", "Biodiversity", "Services",
                   "Social and economic", "Site suitability", "Public interest"):
        assert needle in S.MATTERS
    assert [s.number for s in doc.sections] == ["1", "2", "3", "4", "5", "6", "7", "8", "9"]


def test_plan_list_matches_codes(doc, out):
    from app.agents.sa5_cad_dxf.planset import codes as PC
    t = _norm(_pdf_text(out["pdf"]))
    for n in PC.SHEET_NNN:
        dn = PC.drawing_number(n)
        assert dn in t, dn
        assert PC.SHEET_TITLES[n] in t
    assert "JCS-XXX-CIV-000" in t and "JCS-XXX-CIV-600" in t


def test_blocked_documents_are_not_reviewed(doc, out):
    blocked = [s for s in S.load_sources() if s["status"] in ("blocked", "not_ingested")]
    assert any("Local Environmental Plan" in s["title"] for s in blocked)
    t = _norm(_pdf_text(out["pdf"]))
    for s in blocked:
        assert _norm(S.T(s["title"])) in t, s["title"]
    rows = [b.table for sec in doc.sections for b in sec.blocks if b.table and b.table.header[:2] == ["Document", "Status"]]
    assert rows
    for r in rows[0].rows:
        assert r[1] == "NOT REVIEWED, UNRESOLVED"
    assert any("Environmental Planning and Assessment Act" in r[0] for r in rows[0].rows)


# ---------------------------------------------------------------------------------------------------------------- compliance is never invented
def test_pass_fail_only_from_cited_numeric_comparison(doc):
    assert {r["outcome"] for r in doc.compliance} <= {"PASS", "FAIL", "NOT TRIGGERED", "TRIGGERED", "UNRESOLVED"}
    for r in doc.compliance:
        if r["outcome"] != "UNRESOLVED":
            assert r["citation"] and r["citation"]["page"] and r["citation"]["quote"] and r["citation"]["document"], r["control"]
            assert re.search(r"\d", r["data"]), r["control"]
        else:
            assert r["status"] == "UNRESOLVED"
    keys = {r["citation"]["key"] for r in doc.compliance if r["outcome"] != "UNRESOLVED" and r["citation"]}
    rs = S.load_requirement_set()
    for k in keys:
        v = next(x for x in rs.requirements if x.key == k).value
        assert isinstance(v, (int, float)) and not isinstance(v, bool), k
    assert sum(1 for r in doc.compliance if r["outcome"] == "PASS") >= 1


def test_text_and_boolean_controls_are_unresolved(doc):
    rs = S.load_requirement_set()
    byk = {x.key: x for x in rs.requirements}
    checked = 0
    for r in doc.compliance:
        c = r["citation"]
        if c and c["key"] in byk:
            v = byk[c["key"]].value
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                assert r["status"] == "UNRESOLVED", r["control"]
                checked += 1
    assert checked >= 5
    for ctl in ("Driveway maximum grade", "Legal point of stormwater discharge", "Batter slopes for cut and fill", "Flood planning level"):
        assert next(r for r in doc.compliance if r["control"] == ctl)["status"] == "UNRESOLVED"


def test_values_come_from_the_requirement_files_not_the_code(run):
    """Changing a cited value in the requirement set changes the result: no requirement value is typed into the module."""
    inp = _inputs(run)
    base = S.build_site_soee(inp)
    row = next(r for r in base.compliance if r["control"].startswith("Width of access"))
    assert row["outcome"] == "PASS"
    inp2 = _inputs(run)
    for r in inp2.requirements.requirements:
        if r.key == "driveway.min_width_m":
            r.value = 5.0
    row2 = next(r for r in S.build_site_soee(inp2).compliance if r["control"].startswith("Width of access"))
    assert row2["status"] == "FAIL"
    assert "5 to" in row2["requirement"]


def test_missing_data_gives_unresolved_and_data_not_available(run):
    inp = _inputs(run)
    inp.works["driveway"] = {"present": False}
    inp.works["terrain"] = {"available": False}
    inp.works["earthworks"] = {"driveway_cut_m3": None, "driveway_fill_m3": None}
    inp.works["esc"] = {"shown_on_plan": False, "sheet_built": False, "elements": []}
    d = S.build_site_soee(inp)
    assert not [r for r in d.compliance if r["outcome"] != "UNRESOLVED"]
    t = d.to_text()
    assert "DATA NOT AVAILABLE" in t
    assert "No driveway" in t
    assert "ESCP DATA PENDING" in t


def test_no_requirement_value_is_invented_in_text(doc):
    """Every cited statement carries a citation with document, page and quote, and numbers in cited statements appear in that quote or in the data."""
    for s in doc.statements():
        if s.cite:
            assert s.cite["page"] and s.cite["document"], s.text
            if s.cite.get("key", "").startswith("form."):
                assert s.cite["quote"]
            else:
                assert s.cite["quote"], s.text


# ---------------------------------------------------------------------------------------------------------------- NOT CHECKED
def test_not_checked_wording(run):
    inp = _inputs(run)
    for l in inp.constraints["layers"]:
        l["status"] = "not_checked"
        l["error"] = "no endpoint"
    for f in inp.constraints["report"]["findings"]:
        f["status"] = "not_checked"
        f["headline"] = ""
        f["why_unchecked"] = "no data service is connected"
    d = S.build_site_soee(inp)
    n = len(inp.constraints["layers"])
    assert d.meta["layers_not_checked"] == n
    t = d.to_text()
    assert t.count("NOT CHECKED") >= n
    assert "not checked is not clear" in t.lower()
    sec5 = "\n".join(st.full() for st in d.statements() if st.section == "5" and st.kind == "statement")
    sec5 = re.sub(r"\b\d+ (?:is|are) NOT INTERSECTED BY THE DATA LOADED", "", sec5)       # the layer count sentence (0 are ...) is not a layer result
    assert "NOT INTERSECTED BY THE DATA LOADED" not in sec5          # every layer is NOT CHECKED, so none may read as a result from data
    cleaned = re.sub(r"not checked,? (is )?not clear", "", sec5, flags=re.I)
    assert not re.search(r"\bclear\b", cleaned, re.I)
    for sec in d.sections:
        if sec.number != "5":
            continue
        for b in sec.blocks:
            if b.table and b.table.header[0] == "Layer":
                assert all(r[1] == "NOT CHECKED" for r in b.table.rows)
    for key in ("nsw_flood", "nsw_bushfire", "nsw_heritage_item", "nsw_biodiversity"):
        stm = [s for s in d.statements() if s.source == f"data:sa9.layers[{key}]" and s.kind == "statement"]
        assert stm and all(s.tag == "NOT CHECKED" for s in stm), key


def test_not_checked_is_not_described_as_clear_in_fixture_run(doc):
    for s in doc.statements():
        if s.tag == "NOT CHECKED":
            assert not re.search(r"\b(is|are) clear\b|\bno constraint", s.text, re.I)
    t = doc.to_text()
    assert "NOT INTERSECTED BY THE DATA LOADED" in t
    assert not re.search(r"(?<!mean the )\bsite is (free|clear)\b|\bis not affected\b", t, re.I)


# ---------------------------------------------------------------------------------------------------------------- sources
def test_every_statement_has_a_source_in_the_sidecar(doc, out):
    j = json.loads(out["json"].read_text())
    assert j["document"]["text_written_by_language_model"] is False
    assert j["document"]["requirement_values_extracted_by_ai_model"] is True and j["document"]["requirement_values_verified_by_person"] is False
    assert j["document"]["method"] == S.METHOD_TEXT
    assert j["document"]["scope"] == "SITE WORKS ONLY"
    sts = j["statements"]
    assert len(sts) == len(doc.statements()) > 100
    ids = [s["id"] for s in sts]
    assert len(ids) == len(set(ids))
    for s in sts:
        assert s["source"] and s["source"].strip(), s
        assert re.match(r"^(data|doc|planset|platform|scope|knowledge|file|app)[:.]", s["source"].strip()), s["source"]
        if s["source"].startswith("doc:") and s["kind"] == "statement" and "[" in s["text"]:
            assert s["citation"] and s["citation"]["page"], s["text"]
    # statements shown in the PDF appear in the sidecar (first 40 characters of each paragraph statement)
    pdf = _norm(_pdf_text(out["pdf"]))
    shown = [s for s in sts if s["kind"] == "statement" and len(s["text"]) > 60 and not s["tag"]]
    assert shown
    missing = [s["id"] for s in shown if _norm(s["text"])[:40] not in pdf]
    assert len(missing) <= len(shown) * 0.1, missing[:5]
    assert j["compliance"] and all("status" in r for r in j["compliance"])
    assert j["open_items"]["documents_not_reviewed"]


def test_citations_resolve_to_the_knowledge_files(doc):
    rs = S.load_requirement_set()
    by = {x.key: x for x in rs.requirements}
    n = 0
    for s in doc.statements():
        c = s.cite
        if not c or c["key"].startswith("form."):
            continue
        r = by[c["key"]]
        assert r.source.page == c["page"] and r.source.document_title == c["document"]
        assert c["quote"]
        n += 1
    assert n >= 8


def test_council_form_citations_are_verified_in_the_pdf(doc):
    n = 0
    for s in doc.statements():
        if s.cite and s.cite["key"].startswith("form."):
            assert S.form_cite(s.cite["quote"], s.cite["page"]) is not None
            n += 1
    assert n >= 4
    assert S.form_cite("a phrase that is not in the form", 1) is None


# ---------------------------------------------------------------------------------------------------------------- pagination
def test_no_stranded_headings_pdf(doc, out):
    assert O.stranded_headings(out["pdf"], doc.headings()) == []


def test_no_stranded_headings_docx(doc, out):
    if out["docx_pdf"] is None:
        pytest.skip("LibreOffice not installed")
    assert O.stranded_headings(out["docx_pdf"], doc.headings()) == []


def test_stranded_heading_checker_detects_a_stranded_heading(tmp_path):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    p = tmp_path / "s.pdf"
    c = canvas.Canvas(str(p), pagesize=A4)
    c.setFont("Helvetica", 10)
    c.drawString(60, 700, "Body text on page one.")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 120, "5.4 Earthworks and erosion")        # last body line of the page is a heading
    c.showPage()
    c.setFont("Helvetica", 10)
    c.drawString(60, 700, "Body text on page two.")
    c.save()
    assert O.stranded_headings(p, ["5.4 Earthworks and erosion"]) == [{"page": 1, "line": "5.4 Earthworks and erosion"}]
    assert O.stranded_headings(p, ["Something else"]) == []


def test_docx_headings_keep_with_next(out):
    from docx import Document
    d = Document(str(out["docx"]))
    hs = [p for p in d.paragraphs if p.style.name.startswith("Heading")]
    assert len(hs) > 30
    assert all(p.paragraph_format.keep_with_next or p.style.paragraph_format.keep_with_next for p in hs)
    headed = [t for t in d.tables if "1E2024" in t.rows[0]._tr.xml]
    assert len(headed) >= 8
    for t in headed:
        assert t.rows[0]._tr.trPr is not None and "tblHeader" in t.rows[0]._tr.trPr.xml


def test_pdf_pages_are_not_mostly_blank(out):
    import pymupdf
    with pymupdf.open(str(out["pdf"])) as pd:
        for i, pg in enumerate(pd, 1):
            if i == 1:
                continue
            words = len(pg.get_text().split())
            assert words > 60, f"page {i} has only {words} words"


# ---------------------------------------------------------------------------------------------------------------- runner and regression
def test_runner_writes_outputs_and_does_not_edit_other_modules(run, tmp_path):
    d, _cache = run
    r = _runner()
    rc = r.main(["--out", str(tmp_path / "o"), "--from-run", str(d), "--date", "2026-10-14", "--no-png"])
    assert rc == 0
    for f in ("soee.pdf", "soee.docx", "soee.json"):
        assert (tmp_path / "o" / f).stat().st_size > 5000
    src = (BACKEND / "app" / "pack" / "soee_site.py").read_text() + (BACKEND / "app" / "pack" / "soee_site_out.py").read_text()
    assert "LlmClient" not in src and "anthropic" not in src.lower()          # deterministic: no model is called
    assert "Brand.from_env" not in src and "app.branding" not in src         # never reads the JCE Brand


def test_existing_general_soee_is_unchanged():
    from app.pack import soee
    assert hasattr(soee, "build_soee") and hasattr(soee, "TBC")


# ================================================================================================================ independent review fixes (15/10/2026)
def _tables(doc, header0=None, header1=None):
    out = []
    for sec in doc.sections:
        for b in sec.blocks:
            if b.table and (header0 is None or b.table.header[0] == header0) and (header1 is None or b.table.header[1] == header1):
                out.append((sec.number, b.table))
    return out


def _section_text(doc, number: str) -> str:
    return "\n".join(st.full() for st in doc.statements() if st.section == number and st.kind == "statement")


def _stmts(doc, pattern, section=None):
    rx = re.compile(pattern, re.I)
    return [s for s in doc.statements() if s.kind == "statement" and rx.search(s.text) and (section is None or s.section == section)]


# ---- 1 method statement is one statement, used everywhere
def test_method_statement_is_consistent(doc, out):
    m = _norm(S.METHOD_TEXT)
    assert "assembled by software" in S.METHOD_TEXT and "validated by software against the documents" in S.METHOD_TEXT
    assert not re.search(r"language model|\bAI\b|artificial intelligence|extracted by", S.METHOD_TEXT, re.I)        # stage 8c: no statement about how the text was produced
    pdf = _norm(_pdf_text(out["pdf"]))
    assert pdf.count(m) >= 2                         # document control and section 1.1 (the limitations copy can be split by the page footer, so it is checked in the model and the DOCX)
    for sec in ("1", "8"):
        assert any(x.text.startswith(S.METHOD_TEXT) for x in doc.statements() if x.section == sec and x.kind == "statement"), sec
    assert _norm(_docx_text(out["docx"])).count(m) >= 3
    j = json.loads(out["json"].read_text())
    assert j["document"]["method"] == S.METHOD_TEXT
    for name, t in _all_text(doc, out).items():
        low = _norm(t).lower()
        assert "no language model was used" not in low and "no llm is used" not in low, name
        assert "read by a model" not in low and "were read by an ai" not in low, name
        assert "requirement values" in low and "assembled by software" in low, name
        assert "ai model" not in low and "language model" not in low and "ai assisted" not in low and "ai-assisted draft" not in low, name       # stage 8c: no AI statement in the text
    assert "AI GENERATED DRAFT" not in _pdf_text(out["pdf"]).upper()      # stage 8: the cover carries the verification block instead of the AI statement
    assert not any("carries that label" in s.text for s in doc.statements())


# ---- 2 every count is derived from the rendered list
def test_plural_helper():
    assert S._plural(1, "control is", "controls are") == "1 control is"
    assert S._plural(0, "control is", "controls are") == "0 controls are"
    assert S._plural(9, "document was", "documents were") == "9 documents were"


def test_not_reviewed_count_equals_rendered_rows(doc, out):
    (sn, tb), = _tables(doc, "Document", "Status")
    n = len(tb.rows)
    assert n == doc.meta["documents_not_reviewed"] == len(doc.open_items["documents_not_reviewed"])
    assert re.search(rf"\b{n} documents were not reviewed", " ".join(s.text for s in _stmts(doc, "were not reviewed|was not reviewed", "4")))
    concl = _section_text(doc, "7")
    assert f"{n} source documents were NOT REVIEWED (table 4.1)" in concl
    assert f"{n} source documents could not be obtained" in _section_text(doc, "8")
    pdf = _norm(_pdf_text(out["pdf"]))
    assert f"{n} documents were not reviewed" in pdf and f"{n} source documents were NOT REVIEWED (table 4.1)" in pdf
    # no other count of documents appears anywhere in the statement text
    for s in doc.statements():
        for m in re.finditer(r"\b(\d+) (?:source )?documents (?:were|could not)", s.text):
            assert int(m.group(1)) == n, s.text


def test_layer_counts_equal_rendered_rows(doc):
    (sn, tb), = _tables(doc, "Layer")
    rows = tb.rows
    lc = doc.meta["layer_counts"]
    assert lc["layers"] == len(rows) == doc.meta["layers"]
    assert lc["not_checked"] == sum(1 for r in rows if r[1] == "NOT CHECKED") == doc.meta["layers_not_checked"]
    assert lc["affected"] == sum(1 for r in rows if r[1] == "MAPPED OR INTERSECTS")
    assert lc["buffer"] == sum(1 for r in rows if r[1] == "WITHIN BUFFER")
    assert lc["not_intersected"] == sum(1 for r in rows if r[1] == "NOT INTERSECTED BY THE DATA LOADED")
    assert sum(lc[k] for k in ("affected", "buffer", "not_intersected", "not_checked")) == len(rows)
    t = _section_text(doc, "5")
    assert f"{len(rows)} mapped layers were screened" in t
    assert f"{lc['not_checked']} of {len(rows)} screening layers" in _section_text(doc, "7")
    assert re.search(rf"{lc['not_checked']} (?:is|are) NOT CHECKED\. Not checked is not clear", t)


def test_layer_counts_follow_changed_data(run):
    inp = _inputs(run)
    for l in inp.constraints["layers"][:5]:
        l["status"] = "not_checked"
        l["error"] = "no endpoint"
    for f in inp.constraints["report"]["findings"][:5]:
        f["status"] = "not_checked"
    d = S.build_site_soee(inp)
    (sn, tb), = _tables(d, "Layer")
    assert d.meta["layers_not_checked"] == sum(1 for r in tb.rows if r[1] == "NOT CHECKED") >= 5
    assert f"{d.meta['layers_not_checked']} of {len(tb.rows)} screening layers" in _section_text(d, "7")


def test_data_gap_counts_equal_rendered_rows(doc, out):
    (sn, tb), = _tables(doc, "Item", "Data gap")
    n = len(tb.rows)
    assert n == doc.meta["data_gaps"] >= 8
    assert f"{n} data gaps are recorded on the plan set" in _section_text(doc, "3")
    assert [r[0] for r in tb.rows] == [str(i) for i in range(1, n + 1)]
    gap_sheets = {int(r[0]): [x.strip() for x in r[2].split(",")] for r in tb.rows}
    (_s, t12), = _tables(doc, "Sheet")
    for r in t12.rows:
        sheet, note = r[0], r[3]
        want = sorted(i for i, sh in gap_sheets.items() if sheet in sh)
        if want:
            m = re.match(r"(\d+) data gaps? \(section 3\.9, items? ([\d, ]+)\)", note)
            assert m, (sheet, note)
            assert int(m.group(1)) == len(want) == len(re.findall(r"\d+", m.group(2)))
            assert [int(x) for x in re.findall(r"\d+", m.group(2))] == want
        else:
            assert note in ("No data gaps recorded", "Not built in this run"), (sheet, note)
    assert "DATA NOT AVAILABLE panels" not in _pdf_text(out["pdf"])


def test_compliance_counts_equal_rendered_rows(doc, out):
    (sn, tb), = _tables(doc, "Control")
    assert len(tb.rows) == len(doc.compliance)
    tally = {k: sum(1 for r in tb.rows if r[3].split(" (")[0] == k) for k in ("PASS", "FAIL", "NOT TRIGGERED", "TRIGGERED", "UNRESOLVED")}
    assert tally == doc.meta["counts"] and sum(tally.values()) == len(tb.rows)
    t = _section_text(doc, "6")
    assert f"of {len(tb.rows)} controls (the table rows)" in t
    assert f"{tally['UNRESOLVED']} controls are unresolved, of {len(tb.rows)} controls in all" in _section_text(doc, "7")
    qual = sum(1 for r in tb.rows if r[3].startswith("PASS ("))
    assert f"{qual} of the PASS results rest on" in t
    assert doc.meta["counts"] == {k: v for k, v in tally.items()}


def test_esc_item_count_equals_rendered_rows(doc):
    (sn, tb), = _tables(doc, "Item", "Control")
    assert f"layout of {len(tb.rows)} items is shown on drawing C500" in _section_text(doc, "5")


def test_wording_follows_the_count(run):
    inp = _inputs(run)
    inp.works["esc"]["not_drawn"] = []
    d = S.build_site_soee(inp)
    t = _section_text(d, "7")
    assert re.search(r"\b1 threshold control is not triggered\b", t)


# ---- 3 gaps are reported for every sheet that carries them
def test_sheets_with_markers_are_not_reported_as_clean(doc, run):
    d, cache = run
    mk = cache["works"]["sheet_markers"]
    assert mk and mk["C410"] and mk["C420"] and mk["C600"], "the plan set PDF scan must find the gap markers"
    (_s, t12), = _tables(doc, "Sheet")
    by = {r[0]: r[3] for r in t12.rows}
    for sh in ("C410", "C420", "C600"):
        assert by[sh].startswith(("1 data gap", "2 data gaps", "3 data gaps", "4 data gaps", "5 data gaps")), (sh, by[sh])
        assert "Built, no data gaps recorded" not in by[sh]
    (_s, tg), = _tables(doc, "Item", "Data gap")
    gaps = " ".join(r[1] for r in tg.rows)
    for needle in ("Values shown as TBC", "PLATFORM DEFAULT values are shown", "NO VERGE DESIGN"):
        assert needle in gaps, needle
    assert "NOT SELECTED" not in gaps                  # Gunnedah: the crossing is drawn to the council standard drawing SD-107 Rev A (stage 8b, 8c)
    row410 = next(r for r in tg.rows if "NO VERGE DESIGN" in r[1])
    assert "C410" in row410[2]


def test_synthetic_marker_makes_a_sheet_report_a_gap(run):
    inp = _inputs(run)
    inp.works["sheet_markers"] = {n: [] for n in inp.works["sheet_markers"]}
    for sh_ in inp.works.get("sheets", []):                                       # stage 8c: C410 carries a DATA NOT AVAILABLE panel of its own (no driveway end level), which is a gap too
        if sh_.get("number") == "C410":
            sh_["data_missing"] = []
    inp.works["sheet_markers"]["C410"] = ["tbc"]
    d = S.build_site_soee(inp)
    (_s, t12), = _tables(d, "Sheet")
    assert next(r for r in t12.rows if r[0] == "C410")[3].startswith("1 data gap (section 3.9, item")
    inp.works["sheet_markers"]["C410"] = []
    d2 = S.build_site_soee(inp)
    (_s, t12b), = _tables(d2, "Sheet")
    assert next(r for r in t12b.rows if r[0] == "C410")[3] == "No data gaps recorded"


def test_plan_pdf_scan_finds_markers_and_features(run):
    d, cache = run
    w = cache["works"]
    assert "section_aa" not in w["sheet_features"]["C200"]                      # stage 8c: no driveway end level is assumed, so no cut and fill section is drawn
    assert "no_verge_design" in w["sheet_markers"]["C410"]
    assert w["planset_project"].upper() == "LOT 2 DP227508 SITE WORKS"
    assert S.scan_plan_pdf(d / "planset.pdf", ["C100"]) is None                 # a page count that does not match the sheets built claims nothing


# ---- 4 flood
def test_flood_is_not_worded_as_outside_the_flood_planning_area(doc, out):
    for name, t in _all_text(doc, out).items():
        assert not re.search(r"not within the mapped flood", t, re.I), name
        assert not re.search(r"outside the (mapped )?flood", t, re.I), name
    t = _section_text(doc, "5")
    flood = [s for s in doc.statements() if s.source.startswith("data:sa9.layers[nsw_flood]") and s.section == "5"]
    assert flood
    ft = flood[0].text
    assert "not intersected by the flood data loaded" in ft and "(offline fixture)" in ft
    assert "not confirmed" in ft.lower() and "section 10.7 planning certificate" in ft and "council" in ft
    assert flood[0].tag == "NOT INTERSECTED BY THE DATA LOADED"


def test_flood_wording_without_fixture_and_when_mapped(run):
    inp = _inputs(run)
    inp.constraints["meta"]["flags"] = []
    d = S.build_site_soee(inp)
    ft = next(s.text for s in d.statements() if s.source.startswith("data:sa9.layers[nsw_flood]") and s.section == "5")
    assert "offline fixture" not in ft and "not confirmed" in ft
    inp2 = _inputs(run)
    for l in inp2.constraints["layers"]:
        if l["key"] == "nsw_flood":
            l["status"] = "affected"
    for f in inp2.constraints["report"]["findings"]:
        if f["key"] == "nsw_flood":
            f["status"] = "affected"
            f["headline"] = "The lot intersects mapped flood planning area."
    d2 = S.build_site_soee(inp2)
    t = [s for s in d2.statements() if s.source.startswith("data:sa9.layers[nsw_flood]") and s.section == "5"][0]
    assert "not intersected by the flood data loaded" not in t.text and t.tag != "NOT INTERSECTED BY THE DATA LOADED"


# ---- 5 no internal or tooling language
DEV_PATTERNS = [r"cloudflare", r"bot challenge", r"\b403\b", r"\bcurl\b", r"chromium", r"headless", r"owner brief", r"knowledge file", r"inland code", r"\bSA\d+\b", r"run data",
                r"\b(?:in|for|this) run\b", r"\bthe run\b", r"\bpipeline\b", r"\bsidecar\b", r"geojson", r"escp_", r"\bplanset\b", r"\bJSON\b", r"\bLLM\b", r"\bhelper\b", r"hard.?coded", r"\bTODO\b",
                r"\bfixture loader\b", r"\bingest", r"\bOCR\b", r"\bmirror\b", r"python", r"stack ?trace", r"\bAPI\b"]


def test_no_internal_or_tooling_language(doc, out):
    for name, t in _all_text(doc, out).items():
        if name == "json":                      # the sidecar carries source identifiers by design: check its statement texts only
            j = json.loads(t)
            t = "\n".join(s["text"] for s in j["statements"]) + "\n" + j["document"]["method"]
        for p in DEV_PATTERNS:
            m = re.search(p, t, re.I if not p.startswith(r"\b") or p.lower() == p else 0)
            assert not m, f"developer wording {m.group(0)!r} in {name}"


def test_source_reasons_are_plain():
    r = S._clean_reason("Gunnedah Local Environmental Plan 2012", "Cloudflare bot challenge (HTTP 403) for curl and headless Chromium")
    assert r == "The document could not be obtained in this run."
    for s in S.load_sources():
        assert not re.search(r"cloudflare|bot challenge|403|curl|chromium|owner brief|knowledge file|ingest", s["reason"], re.I), s
    assert S.T("not in the run data, in this run, SA3 driveway result and SA10 layout") == "not in the project data, for this draft, platform driveway calculation and erosion and sediment control layout"


# ---- 6 compliance status wording
def _row(doc, start):
    return next(r for r in doc.compliance if r["control"].startswith(start))


def test_width_status_is_qualified_when_a_platform_default(doc, run):
    r = _row(doc, "Width of access")
    assert r["status"] == "PASS (PLATFORM DEFAULT, TO BE CONFIRMED)" and r["outcome"] == "PASS"
    inp = _inputs(run)
    for x in inp.works["driveway"]["layover"]:
        if x["key"] == "drive":
            x["src"] = "COUNCIL STANDARD DRAWING, SELECTED"
    assert _row(S.build_site_soee(inp), "Width of access")["status"] == "PASS"
    inp2 = _inputs(run)
    inp2.works["driveway"]["width_m"] = 5.2
    assert _row(S.build_site_soee(inp2), "Width of access")["status"] == "FAIL"


def test_slope_status_is_indicative(doc, run):
    r = _row(doc, "Slope above which")
    assert r["status"] == "NOT TRIGGERED (INDICATIVE, 5 m DEM)" and r["outcome"] == "NOT TRIGGERED"
    assert "15" in r["requirement"] and "4.9%" in r["data"]
    inp = _inputs(run)
    inp.works["terrain"]["max_gradient_pct"] = 22.0
    assert _row(S.build_site_soee(inp), "Slope above which")["status"] == "TRIGGERED (INDICATIVE, 5 m DEM)"


def test_common_boundary_basis_never_mentions_the_rear_boundary(doc, out, run):
    r = _row(doc, "Crossing to common property boundary")
    assert r["outcome"] == "PASS" and "side boundary" in r["basis"]
    for name, t in _all_text(doc, out).items():
        assert not re.search(r"rear boundar", t, re.I), name
    inp = _inputs(run)
    inp.works["driveway"]["crossover_to_common_boundary_m"] = None
    inp.works["driveway"]["common_boundary_basis"] = None
    assert _row(S.build_site_soee(inp), "Crossing to common property boundary")["status"] == "UNRESOLVED"
    inp2 = _inputs(run)
    inp2.works["driveway"]["crossover_to_common_boundary_m"] = 0.2
    assert _row(S.build_site_soee(inp2), "Crossing to common property boundary")["status"] == "FAIL"


def test_extraction_uses_side_boundaries_only():
    src = (BACKEND / "app" / "pack" / "soee_site.py").read_text()
    assert "for sg in (sides or others)" not in src


# ---- 7 stabilised access length and the ESC items
def test_stabilised_access_length_row(doc, run):
    r = _row(doc, "Stabilised site access length")
    assert r["outcome"] == "PASS" and r["status"] == "PASS (INDICATIVE LAYOUT, TO BE CONFIRMED)"
    assert r["key"] == "access_length" and abs(r["value"] - 15.0) < 0.06
    rs = S.load_requirement_set()
    lim = next(x for x in rs.requirements if x.key == "esc.access.min_length_m")
    assert r["limit"] == lim.value == 15 and r["citation"]["page"] == lim.source.page and "6.3.9" in r["citation"]["section"]
    assert "15 m" in r["requirement"] and "15.0 m drawn on C500" in r["data"]
    inp = _inputs(run)
    for x in inp.requirements.requirements:
        if x.key == "esc.access.min_length_m":
            x.value = 20.0
    d2 = S.build_site_soee(inp)
    r2 = _row(d2, "Stabilised site access length")
    assert r2["outcome"] == "FAIL" and "at least 20 m" in r2["requirement"]
    (_s, tg), = _tables(d2, "Item", "Data gap")
    assert any("Stabilised site access drawn 15.0 m long" in r_[1] for r_ in tg.rows)
    inp3 = _inputs(run)
    inp3.works["esc"]["access_length_m"] = None
    assert _row(S.build_site_soee(inp3), "Stabilised site access length")["status"] == "UNRESOLVED"


def test_esc_items_without_a_position_outside_the_building_envelope_are_reported_not_drawn(doc, run):
    """The whole-lot search in SA10 is a feasibility check only: the soil stockpile, topsoil stockpile and laydown are NOT drawn on C500 and the SoEE says so."""
    d, cache = run
    esc = cache["works"]["esc"]
    nd = [x.split(":")[0].strip().lower() for x in esc["not_drawn"]]
    assert len(nd) == 3 and any("stockpile" in x for x in nd) and any("laydown" in x for x in nd)
    assert esc["whole_lot"] == []
    labels = [str(e["label"]).lower() for e in esc["elements"]]
    assert not any("stockpile" in x or "laydown" in x for x in labels)          # no element is drawn for them
    for sec in ("3", "5"):
        t = _section_text(doc, sec)
        assert "Not drawn on C500" in t, sec
        assert "Drawn on C500 at an unresolved position" not in t, sec
        for x in nd:
            assert x in t, (sec, x)
    (_s, tg), = _tables(doc, "Item", "Data gap")
    row = next(r for r in tg.rows if "Not drawn on the erosion and sediment control layout" in r[1])
    assert "C500" in row[2]
    assert not any("Drawn on C500 at an unresolved position" in r[1] for r in tg.rows)


def test_esc_items_sa10_still_drops_keep_the_not_drawn_wording(run):
    inp = _inputs(run)
    inp.works["esc"]["not_drawn"] = ["Portable toilet: no position satisfies the cited clearances inside the lot; not drawn."]
    inp.works["esc"]["whole_lot"] = []
    dd = S.build_site_soee(inp)
    for sec in ("3", "5"):
        t = _section_text(dd, sec)
        assert "Not drawn on C500: portable toilet" in t, sec
        assert "Drawn on C500 at an unresolved position" not in t, sec
    (_s, tg), = _tables(dd, "Item", "Data gap")
    assert any("Not drawn on the erosion and sediment control layout: portable toilet" in r[1] for r in tg.rows)


def test_esc_whole_lot_items_are_read_from_the_sa10_warning_and_status(tmp_path):
    md = ("# ESC\n\n- Flow: **bearing 45 deg, fall 2.0 %**\n\n## Warnings\n\n- No building footprint was supplied and no position outside the building envelope meets the cited clearances: "
          "soil stockpile, laydown area placed by searching the whole lot (they may sit where the building will be). Re-check.\n- Bin: no position satisfies the cited clearances inside the lot; not drawn.\n\n## Notes\n")
    (tmp_path / "escp_x_report.md").write_text(md)
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"id": i, "label": lab, "kind": k, "status": st}}
             for i, lab, k, st in (("SP1", "Soil stockpile", "stockpile", "unresolved"), ("LD1", "Laydown area", "laydown", "resolved"))]
    (tmp_path / "escp_x.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    esc = S.read_esc_output(tmp_path)
    assert [x.lower() for x in esc["whole_lot"]] == ["soil stockpile"]          # laydown is not an unresolved element, so it is not claimed
    assert len(esc["not_drawn"]) == 1 and "not drawn" in esc["not_drawn"][0].lower()
    assert S._esc_whole_lot_text({"whole_lot": []}) == ""


def test_esc_fall_direction_comes_from_the_levels_and_the_old_assumption_is_gone(doc, out, run):
    d, cache = run
    esc = cache["works"]["esc"]
    assert esc["flow_assumed"] is False and esc["flow_bearing_deg"] is not None and abs(esc["flow_pct"] - 2.7) < 0.1
    for name, t in _all_text(doc, out).items():
        assert not re.search(r"flow (direction )?(assumed )?towards the road|assumed flow|no levels were available to", t, re.I), name
        assert "positioned using the platform illustrative building footprint" not in t
    t3 = _section_text(doc, "3")
    assert re.search(r"fall of 2\.7% towards bearing 46 degrees", t3)
    ter = cache["works"]["terrain"]
    assert abs(((ter["fall_bearing_deg"] - esc["flow_bearing_deg"] + 180) % 360) - 180) < 20
    assert "north-east" in t3 and "north-east" in _section_text(doc, "2")
    assert _stmts(doc, "No building footprint was supplied to the ESC layout", "3")


def test_assumed_esc_flow_is_still_disclosed_when_levels_are_missing(run):
    inp = _inputs(run)
    inp.works["esc"].update(flow_assumed=True, flow_text="assumed flow towards the road (no survey points) - ASSUMED", flow_bearing_deg=300.0)
    t = _section_text(S.build_site_soee(inp), "3")
    assert "ASSUMED" in " ".join(s.tag for s in S.build_site_soee(inp).statements() if s.section == "3")
    assert "must be reviewed against the surveyed fall" in t


# ---- 8 labels
def test_dem_levels_are_indicative_not_assumed(doc):
    for s in doc.statements():
        if s.kind == "statement" and re.search(r"\bDEM\b", s.text) and re.search(r"level|fall|gradient|grade|cut|fill", s.text, re.I):
            assert s.tag != "ASSUMED / PLATFORM DEFAULT" and s.tag != "ASSUMED", s.text
    lv = _stmts(doc, r"^These levels come from the NSW 5 m digital elevation model", "2")[0]
    # Offline runs label the source as the offline fixture (3D stage 3 review fix); live runs name the service.
    assert lv.tag == "INDICATIVE, 5 m DEM" and ("NSW_5M_Elevation" in lv.text or "OFFLINE FIXTURE" in lv.text)
    assert S.T_IND == "INDICATIVE, 5 m DEM"


def test_crossing_standard_wording(doc, out, run):
    for name, t in _all_text(doc, out).items():
        assert not re.search(r"Crossing standard: default", t, re.I), name
        assert "NOT SELECTED" not in t, name                                    # Gunnedah: the crossing is drawn to SD-107 Rev A (stage 8b, 8c)
    t = _norm(_section_text(doc, "3"))
    assert "Council crossing standard drawing: GSC SD-107 Rev A" in t and "RD003" in t and "RD0010" in t and "RD011" in t
    inp0 = _inputs(run)
    inp0.works["driveway"].pop("crossing_cited", None)                           # a council with no typical details on file keeps the NOT SELECTED wording
    t0 = _norm(_section_text(S.build_site_soee(inp0), "3"))
    assert "Council crossing standard drawing: NOT SELECTED" in t0
    assert "AS/NZS 2890.1 is the Australian Standard for off-street parking and is not a council crossing standard" in t0
    assert S.crossing_standard({"council_standard_label": "default (AS/NZS 2890.1)"}) is None
    assert S.crossing_standard({"council_standard_label": "NOT SELECTED"}) is None
    assert S.crossing_standard({"council_standard_label": "Gunnedah Standard Drawing 123"}) == "Gunnedah Standard Drawing 123"
    inp = _inputs(run)
    inp.works["driveway"]["council_standard_label"] = "Gunnedah Standard Drawing 123"
    inp.works["driveway"].pop("crossing_cited", None)
    assert "Council crossing standard drawing: Gunnedah Standard Drawing 123." in _section_text(S.build_site_soee(inp), "3")


def test_layover_basis_matches_the_plan_set(doc, run):
    """Stage 8b: Gunnedah has the council standard drawing data, so the kerb width, splay and layback run are CITED (GSC SD-107 REV A); the width, driveway width and boundary to
    kerb stay platform defaults (the width held within the cited range).  A council without typicals keeps every value a platform default / drafting convention (stage 5b tests)."""
    d, cache = run
    lay = {x["key"]: x for x in cache["works"]["driveway"]["layover"]}
    defaults = ("w_bdy", "w_kerb", "flare", "drive", "d_kerb")
    assert set(defaults) | {"wing", "band"} <= set(lay)
    cited = [k for k in lay if "SD-107" in lay[k]["src"].upper()]
    if cited:
        assert {"w_kerb", "wing", "flare", "band"} <= set(cited), cited
        for k in ("w_bdy", "drive"):
            assert "PLATFORM DEFAULT" in lay[k]["src"].upper() and lay[k]["placeholder"] is False, k
        assert "PLATFORM DEFAULT" in lay["d_kerb"]["src"].upper()
        for k in cited:
            assert lay[k]["placeholder"] is False, k
    else:
        for k in defaults:
            assert "PLATFORM DEFAULT" in lay[k]["src"].upper() and lay[k]["placeholder"] is False, k
        for k in lay:
            if k not in defaults:
                assert lay[k]["placeholder"] is True and "DRAFTING CONVENTION" in lay[k]["src"].upper(), k
    (_s, tb), = [x for x in _tables(doc, "Dimension")]
    for r in tb.rows:
        assert not (r[2].startswith("Platform default") and "PLACEHOLDER" in r[2]), r
    by = {r[0].lower(): r for r in tb.rows}
    for lab in ("layover width at boundary", "driveway width"):
        assert by[lab][2].startswith("Platform default") or "SD-107" in by[lab][2].upper(), (lab, by[lab])
    if not cited:
        for lab in ("layover width at kerb", "wing flare (each side)"):
            assert by[lab][2].startswith("Platform default"), (lab, by[lab])
        for lab in ("wing length", "kerb and gutter band width"):
            assert "PLACEHOLDER" in by[lab][2] and by[lab][2].startswith("Drafting convention"), lab
    t3 = _stmts(doc, r"^Driveway width 3\.0 m", "3")[0]
    assert t3.tag == "ASSUMED / PLATFORM DEFAULT"


def test_assumed_labels_are_accurate(doc):
    """ASSUMED is used only for things the platform assumed (the lot is vacant, the kerb line, layouts) and never for a sourced or cited value."""
    for s in doc.statements():
        if s.kind != "statement" or s.tag not in ("ASSUMED", "ASSUMED / PLATFORM DEFAULT"):
            continue
        assert not s.cite, s.text
        assert not re.search(r"\bDEM\b.*(levels come|steepest|falls)", s.text), s.text
    lot = _stmts(doc, r"^The lot is assumed to be vacant")[0]
    assert lot.tag == "ASSUMED"


# ---- 9 regulation and headings
def test_regulation_and_heading_wording(doc, out):
    for name, t in _all_text(doc, out).items():
        assert not re.search(r"\bcl 24\b|clause 24|Schedule 3\b", t), name
        assert "owner brief" not in t.lower(), name
        assert not re.search(r"Resilience and Hazard(?!s)", t), name
        assert "named in the owner" not in t.lower(), name
    t = _norm(_pdf_text(out["pdf"]))
    assert "Resilience and Hazards) 2021" in t
    assert "Regulation 2021 was not obtained, so it has not been reviewed" in t
    for _k, h in S.S415:
        assert "owner" not in h.lower() and "brief" not in h.lower()
    assert S.T("cl 24 Schedule 3") == "cl 24 Schedule 3"          # the text choke point does not invent or hide clauses: the source titles are cleaned instead
    assert S._clean_title("Environmental Planning and Assessment Regulation 2021 (Schedule 1, cl 24)") == "Environmental Planning and Assessment Regulation 2021"
    for s in S.load_sources():
        assert not re.search(r"\bcl\b|Schedule \d", s["title"]), s["title"]


# ---- 10 stormwater: the lot falls away from the street
def test_stormwater_discharge_matches_the_plan_note(doc, run):
    d, cache = run
    import pymupdf
    with pymupdf.open(str(d / "planset.pdf")) as pd:
        c300 = _norm(" ".join(pg.get_text() for pg in pd if "STORMWATER" in pg.get_text() and "DRAINAGE DISCHARGE" in pg.get_text())).upper()
    ter = cache["works"]["terrain"]
    assert ter["plan_discharge_note"] and _norm(ter["plan_discharge_note"]).upper() in c300 and ter["fall_away_c"] > 0.25
    for sec in ("3", "5"):
        t = _section_text(doc, sec)
        assert "The lot falls away from the street" in t, sec
        assert "indicative from the 5 m DEM" in t and "The legal point of discharge is unresolved" in t, sec
        assert "inter-allotment drainage easement over adjoining land, or another solution, may be required" in t and "Confirm with the council" in t, sec
    row = _row(doc, "Legal point of stormwater discharge")
    assert row["outcome"] == "UNRESOLVED" and "falls away from the street" in row["data"] and "inter-allotment drainage easement" in row["basis"]
    assert "inter-allotment drainage easement" in _section_text(doc, "7")
    assert "north-east" in _section_text(doc, "3")


def test_discharge_item_follows_the_fall_direction():
    base = {"available": True, "avg_fall_pct": 2.7, "fall_bearing_deg": 46.0}
    away = S.discharge_item({**base, "fall_away_c": 0.97})
    assert "falls away from the street" in away[0] and "inter-allotment" in away[0] and away[2] == "UNRESOLVED"
    toward = S.discharge_item({**base, "fall_away_c": -0.9})
    assert "falls towards the street" in toward[0] and "inter-allotment" not in toward[0]
    across = S.discharge_item({**base, "fall_away_c": 0.1})
    assert "across the street frontage" in across[0] and "inter-allotment" in across[0]
    assert S.discharge_item({"available": False}) is None and S.discharge_item({**base}) is None
    assert S.fall_side({**base, "fall_vs_street_deg": 168.0}) == "away from"       # fallback from the angle when the plan set component is missing


def test_no_discharge_claim_when_levels_are_missing(run):
    inp = _inputs(run)
    inp.works["terrain"] = {"available": False}
    d = S.build_site_soee(inp)
    assert "falls away from the street" not in d.to_text()
    assert "legal point of stormwater discharge is not in the project data" in d.to_text()


# ---- 11 layout
def test_no_orphan_bullets_pdf_and_docx(out):
    assert O.orphan_bullets(out["pdf"]) == []
    if out["docx_pdf"] is not None:
        assert O.orphan_bullets(out["docx_pdf"]) == []


def test_orphan_bullet_checker_detects_a_lone_bullet(tmp_path):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    p = tmp_path / "o.pdf"
    c = canvas.Canvas(str(p), pagesize=A4)
    c.setFont("Helvetica", 10)
    for y in (200, 170, 140):                        # a list: two bullets then one more alone on the next page (footer zone ends at 27 mm = 77 pt)
        c.drawString(60, y, "• bullet item on page one")
    c.showPage()
    c.setFont("Helvetica", 10)
    c.drawString(60, 760, "• lone bullet at the head of page two")
    c.drawString(60, 700, "Body text that follows the list.")
    c.save()
    # one bullet at the head of page two, with bullets at the foot of page one
    import pymupdf
    with pymupdf.open(str(p)) as pd:
        assert pd.page_count == 2
    res = O.orphan_bullets(p, footer_mm=0.0, header_mm=0.0)
    assert res and res[0]["page"] == 2 and res[0]["bullets_at_head"] == 1


def test_contents_fits_on_one_page_and_lists_do_not_split_headings(doc, out):
    pages = O.page_texts(out["pdf"])
    assert "Contents" in pages[2] and "9 Glossary" in pages[2]
    assert "Contents" not in pages[3]


def test_every_page_has_content_and_no_heading_is_last(doc, out):
    assert O.stranded_headings(out["pdf"], doc.headings()) == []
    assert O.orphan_bullets(out["pdf"]) == []


# ---- runner picks up the plan set changes
def test_runner_reads_the_final_plan_set_run(run):
    d, cache = run
    w = cache["works"]
    assert w["planset_project"].upper() == "LOT 2 DP227508 SITE WORKS"
    esc = w["esc"]
    assert esc["flow_assumed"] is False and esc["access_length_m"] == pytest.approx(15.0, abs=0.06)
    assert len(esc["not_drawn"]) == 3 and esc["whole_lot"] == []          # SA10 whole-lot search is a feasibility check only: the three items are not drawn
    assert w["terrain"]["fall_basis"] == "planset.terrain_notes.dem_fall"
    assert 1.5 < w["terrain"]["avg_fall_pct"] < 4.0 and 30 < w["terrain"]["fall_bearing_deg"] < 70
    assert w["driveway"]["swept_path_drawn"] is False
    src = (BACKEND / "scripts" / "run_soee.py").read_text()
    assert "G.LAST_SITE" in src and "extract_site_works" in src
    sites = [x for x in w["sheets"] if x["built"]]
    assert len(sites) == 12


# ---------------------------------------------------------------------------------------------------------- planning map appendix (stage 7)
@pytest.fixture(scope="module")
def map_doc(run):
    d, _ = run
    return S.build_site_soee(_inputs(run, maps_dir=d / "planning_maps"))


@pytest.fixture(scope="module")
def map_out(map_doc, tmp_path_factory):
    d = tmp_path_factory.mktemp("soee_maps")
    res = O.write_all(map_doc, d, png=False)
    return {"pdf": Path(res["pdf"]), "docx": Path(res["docx"]), "dir": d, "docx_pdf": O.docx_to_pdf(Path(res["docx"]), d / "docx_check")}


def test_soee_without_map_dir_adds_no_appendix_or_references(doc):
    assert "Appendix A" not in [s.number for s in doc.sections]
    assert "refer Figure" not in " ".join(s.text for s in doc.statements()).lower()


def test_soee_appendix_has_one_figure_per_map_and_a_panel_for_not_checked(map_doc):
    sec = next(s for s in map_doc.sections if s.number == "Appendix A")
    figs = [b for b in sec.blocks if b.kind == "figure"]
    assert len(figs) == map_doc.meta["map_figures"] >= 18
    assert [b.fig["no"] for b in figs] == list(range(1, len(figs) + 1))
    nc = [b for b in figs if b.fig["key"] in ("nsw_contamination", "nsw_transport_corridor")]
    assert len(nc) == 2 and all("MAP NOT AVAILABLE" in b.stmts[0].text or "Not checked" in b.stmts[0].text for b in nc)
    assert any(m["state"] == "attribute_only" for m in map_doc.meta["planning_maps"] if m["key"] == "zoning")


def test_soee_statements_reference_their_figure_and_references_resolve(map_doc):
    txt = " ".join(s.text for s in map_doc.statements())
    refs = re.findall(r"[Rr]efer Figure (\d+), ([A-Z][A-Za-z ]+? Map), Appendix A", txt)
    assert len(refs) >= 10
    figs = {m["figure"]: m["title"] for m in map_doc.meta["planning_maps"]}
    for n, title in refs:
        assert figs[int(n)] == title
    for key in ("Flood Planning Map", "Bush Fire Prone Land Map", "Heritage Item Map", "Acid Sulfate Soils Map", "Land Zoning Map", "Contaminated Land Map"):
        assert key in " ".join(t for _, t in refs), key


def test_soee_zone_statement_says_attribute_only_and_multizone_possible(map_doc):
    t = " ".join(s.text for s in map_doc.statements())
    assert "No zone boundary is drawn" in t and "MULTI-ZONE POSSIBLE" in t
    assert t.count("Confirm the zones with the council") == 1 or "Confirm the zones with the council. Confirm" not in t


def test_soee_layer_table_has_a_map_column(map_doc):
    sec = next(s for s in map_doc.sections if s.number == "5")
    tb = [b.table for b in sec.blocks if b.table and b.table.header[:1] == ["Layer"] and "Map" in b.table.header]
    assert tb and all(r[-1].startswith("Figure") for r in tb[0].rows)


def test_soee_map_appendix_pdf_and_docx_layout(map_doc, map_out):
    assert O.stranded_headings(map_out["pdf"], map_doc.headings()) == [] and O.orphan_bullets(map_out["pdf"]) == []
    import pymupdf
    pdf = pymupdf.open(str(map_out["pdf"]))
    app = [i for i, p in enumerate(pdf) if "This appendix holds" in p.get_text()]
    assert app and all(len(pdf[i].get_images()) >= 1 for i in range(app[0] + 1, app[0] + 3))
    assert "–" not in pdf[app[0]].get_text() and "—" not in pdf[app[0]].get_text()
    if map_out["docx_pdf"]:
        dpdf = pymupdf.open(str(map_out["docx_pdf"]))
        assert any(len(p.get_images()) >= 2 for p in dpdf)                       # two figures per row inside the page


def test_soee_synthetic_demo_stamp(run, tmp_path):
    d, _ = run
    inp = _inputs(run, maps_dir=d / "planning_maps", synthetic_demo=True)
    dd = S.build_site_soee(inp)
    res = O.write_all(dd, tmp_path, png=False)
    import pymupdf
    pdf = pymupdf.open(res["pdf"])
    assert all("SYNTHETIC DEMO DATA" in p.get_text() for p in pdf)
    assert json.loads(Path(res["json"]).read_text())["document"]["synthetic_demo"] is True


def test_soee_esc_table_labels_a_laydown_item_by_its_own_type():
    assert S._confirm_label("esc.stockpile.setback_from_lot_boundary_m", {"kind": "laydown"}) == "Laydown: setback from lot boundary"
    assert S._confirm_label("esc.stockpile.setback_from_lot_boundary_m", {"kind": "stockpile"}) == "Stockpile: setback from lot boundary"
    assert S._confirm_label("esc.stockpile.setback_from_lot_boundary_m", {"kind": "topsoil"}) == "Stockpile: setback from lot boundary"
    assert S._confirm_label("esc.sediment_fence.offset_from_stockpile_m", {"kind": "fence"}) == "Sediment fence: offset from stockpile"


def test_soee_map_captions_do_not_double_the_result(map_doc):
    for b in next(s for s in map_doc.sections if s.number == "Appendix A").blocks:
        if b.kind == "figure":
            t = b.stmts[0].text
            assert not re.search(r"(?i)\b(not mapped|not intersected)\. NOT INTERSECTED", t), t
            assert not re.search(r"(?i)not checked\. MAP NOT AVAILABLE", t), t


def test_soee_and_report_state_the_same_bush_fire_distance(map_doc):
    t = " ".join(s.text for s in map_doc.statements())
    assert "54 m from the nearest mapped bush fire prone land" in t and "Next nearest: Vegetation Category 3, 84 m" in t
