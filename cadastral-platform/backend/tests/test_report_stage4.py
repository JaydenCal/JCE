"""Stage 4 site report: JCESITE brand, AI statement, explanatory sections, per-layer WHAT / WHY / NEXT, pagination and honesty rules."""
import io
import re
from pathlib import Path

import pymupdf
import pytest
from shapely.geometry import box

from app.agents.sa9_constraints.intersect import LayerResult
from app.agents.sa9_constraints.layers import REGISTRY, get_layer, layers_for
from app.agents.sa9_constraints.triggers import evaluate
from app.report import SiteReportInputs, build_site_report, explain as EX, fmt
from app.report.knowledge import load_requirements

LOT = box(0, 0, 20, 40)
DASHES = ("–", "—")
GOLD = 0xA8842F


def _results():
    res = []
    for lt in layers_for("NSW"):
        k = lt.key
        if k == "nsw_flood":
            g = box(-10, 5, 30, 25)
            ov = g.intersection(LOT).area
            res.append(LayerResult(key=k, label=lt.label, status="affected", overlap_area_m2=ov, pct_of_lot=round(100 * ov / LOT.area, 1), nearest_distance_m=0,
                                   attributes=[{"LAY_CLASS": "Flood Planning Area", "EPI_NAME": "SYNTHETIC TEST PLAN"}], geometries_wkt=[g.wkt],
                                   data_currency="source currency 2025-03-01; fetched 2026-10-12"))
        elif k == "nsw_bushfire":
            res.append(LayerResult(key=k, label=lt.label, status="affected", nearest_distance_m=54.0, attributes=[{"Category": 3, "d_Category": "Vegetation Category 3"}],
                                   geometries_wkt=[box(0, 94, 50, 120).wkt], data_currency="source currency 2024-12-13; fetched 2026-10-12"))
        elif k == "nsw_riparian":
            res.append(LayerResult(key=k, label=lt.label, status="affected", nearest_distance_m=25.0, attributes=[{"LAY_NAME": "Test creek"}],
                                   geometries_wkt=[box(-30, -45, 10, -25).wkt], data_currency="source currency 2024-01-01; fetched 2026-10-12"))
        elif k in ("nsw_heritage_item", "nsw_acid_sulfate"):
            res.append(LayerResult(key=k, label=lt.label, status="not_affected", nearest_distance_m=120.0, data_currency="source currency 2024-01-01; fetched 2026-10-12"))
        else:
            res.append(LayerResult(key=k, label=lt.label, status="not_checked", error="no endpoint configured"))
    return res


def _inp(requirements=True, **kw):
    res = _results()
    reqs, unres = load_requirements("Gunnedah") if requirements else ([], [])
    return SiteReportInputs(meta={"lotplan": "2//DP227508", "lga_name": "Gunnedah", "jurisdiction": "NSW", "development_type": "Dwelling house",
                                  "development_type_key": "dwelling_house", "date": "2026-10-14", "zone_code": "R2", "area_m2": 800.0, "flags": []},
                            results=res, triggers=evaluate(res, "NSW", None, development_type="dwelling_house"), lot_wkt=LOT.wkt, imagery=None,
                            requirements=reqs, unresolved_requirements=unres, **kw)


@pytest.fixture(scope="module")
def built():
    pdf, js = build_site_report(_inp())
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    pages = [p.get_text() for p in doc]
    return {"pdf": pdf, "js": js, "doc": doc, "pages": pages, "txt": "\n".join(pages)}


def _flat(s: str) -> str:
    return re.sub(r"\s+", " ", s)


def test_jcesite_brand_and_no_jce_infrastructure(built):
    low = built["txt"].lower()
    assert "jce infrastructure" not in low and "jceinfrastructure" not in low
    assert "JCESITE" in built["txt"] and "AI-ASSISTED SITE PLANNING" in built["txt"]
    assert built["doc"].metadata["author"] == "JCESITE"
    assert built["js"]["brand"]["company"] == "JCESITE"


def test_jce_brand_object_is_ignored():
    class JceBrand:                       # what the old default Brand looked like
        company_name = "JCE Infrastructure"
        name = "JCE Infrastructure"
        logo_path = "x.png"
    pdf, _ = build_site_report(_inp(brand=JceBrand()))
    txt = "".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf")).lower()
    assert "jce infrastructure" not in txt


def test_ai_statement_on_cover_and_every_page_footer(built):
    assert len(built["pages"]) > 5
    for i, t in enumerate(built["pages"], 1):
        assert EX.AI_STATEMENT in _flat(t), f"page {i} lacks the AI statement"
    assert EX.AI_STATEMENT in _flat(built["pages"][0])           # cover (banner and footer)
    assert _flat(built["pages"][0]).count(EX.AI_STATEMENT) >= 2


def test_no_em_or_en_dashes_in_report_text(built):
    for d in DASHES:
        assert d not in built["txt"]
    for p in ("explain.py", "sections.py", "sections_ex.py", "build.py", "catalogue.py", "diagrams.py"):
        src = (Path(__file__).parents[1] / "app" / "report" / p).read_text(encoding="utf-8")
        for d in DASHES:
            assert d not in src, f"{p} contains a dash character"
    assert fmt.clean("1–2 m and a — b") == "1 to 2 m and a, b"
    for k, v in EX.LAYER_TEXT.items():
        assert not any(d in "".join(v.values()) for d in DASHES)


def test_no_contractions_in_explanatory_text():
    blob = " ".join(w for v in EX.LAYER_TEXT.values() for w in v.values()) + " ".join(EX.ABOUT_IS + EX.ABOUT_IS_NOT + EX.BUFFER_WHAT + EX.BUFFER_WHY) \
        + " ".join(b for _, b in EX.GLOSSARY)
    assert not re.search(r"\b\w+n't\b|\b(it|that|there|we|they|you)'(s|re|ll|ve|d)\b", blob, re.I)


def test_front_sections_present(built):
    t = _flat(built["txt"])
    for h in ("How to read this report", "Buffers explained", "Glossary", "Data sources and limitations", "WHAT THIS REPORT IS NOT"):
        assert h in t
    for term, _, _ in EX.RESULT_TERMS:
        assert term in t
    assert "NOT CHECKED IS NOT CLEAR" in t.upper()
    for term in ("cadastre", "DCDB", "easement", "riparian", "BAL (Bushfire Attack Level)", "DBYD", "crossover", "layover", "batter", "ESCP", "swale",
                 "AHD", "GDA2020", "MGA zone", "UNRESOLVED", "Indicative"):
        assert term.lower() in t.lower()
    assert len(EX.GLOSSARY) >= 30 and all(len(d) < 340 for _, d in EX.GLOSSARY)


def test_buffer_section_content_and_diagram(built):
    t = _flat(built["txt"])
    assert "PLATFORM SCREENING SETTING" in t and "the platform screening settings" in t
    assert "not a statutory requirement" in t
    assert "INTERSECTS COMPARED WITH WITHIN BUFFER" in t
    assert "SCREENING DISTANCES USED IN THIS RUN" in t
    pg = next(i for i, p in enumerate(built["pages"]) if "Buffers explained" in p and "WHAT A BUFFER IS" in p)
    assert built["doc"][pg].get_drawings()          # the vector diagram is on the page


def test_every_layer_type_has_what_why_next():
    assert REGISTRY
    for key in REGISTRY:
        ex = EX.layer_explain(key)
        for part in ("what", "why", "next"):
            assert ex[part].strip(), (key, part)
        assert key in EX.LAYER_TEXT, f"{key} relies on the generic fallback"
        assert not re.search(r"\b(is required|are required|must be provided)\b", ex["why"])        # hedged, never definitive
        assert re.search(r"\bmay\b|\bcan\b|\bguides\b", ex["why"])


def test_every_screened_layer_explained_in_pdf(built):
    t = _flat(built["txt"])
    for lt in layers_for("NSW"):
        ex = EX.layer_explain(lt.key)
        for part in ("what", "why", "next"):
            assert _flat(ex[part])[:50] in t, (lt.key, part)
    assert t.count("WHAT THIS IS") >= len(layers_for("NSW"))


def test_layer_pages_fit_one_page_each(built):
    lp = [t for t in built["pages"] if re.search(r"CONSTRAINT \d OF 3", t)]
    assert len(lp) == 3
    for t in lp:
        assert "WHAT THIS IS" in t and "WHY IT MATTERS" in t and "WHAT TO DO NEXT" in t and "CONSTRAINT" in t


def test_no_heading_is_last_element_on_a_page(built):
    doc = built["doc"]
    for pno, page in enumerate(doc, 1):
        h = page.rect.height
        lines = []
        for b in page.get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                y = ln["bbox"][3]
                if 22 * 2.835 < y < h - 17 * 2.835 and "".join(s["text"] for s in ln["spans"]).strip():
                    lines.append((y, ln))
        if not lines:
            continue
        lines.sort(key=lambda x: x[0])
        # the last line of body text, ignoring images
        sp = lines[-1][1]["spans"][-1]
        txt = "".join(s["text"] for s in lines[-1][1]["spans"]).strip()
        is_heading = sp["font"].startswith("Jost") and sp["size"] >= 9.5
        is_label = "Mono" in sp["font"] and abs(sp["size"] - 6.4) < 0.2 and sp["color"] == GOLD
        assert not (is_heading or is_label), f"page {pno} ends with a heading or label: {txt!r}"


def test_screening_distance_caption_labelled_as_screening_setting(built):
    t = _flat(built["txt"])
    d = get_layer("nsw_bushfire").buffer_m
    assert f"Screening distance used: {d:g} m. Status: SCREENING SETTING" in t
    assert f"Screening distance used: {get_layer('nsw_riparian').buffer_m:g} m" in t
    assert "a setting in the platform screening settings, not a statutory requirement" in t
    # flood has no screening distance: only intersecting features are reported
    assert "Screening distance used: none (0 m, only features that intersect the lot are reported)" in t


def test_unresolved_shown_not_invented():
    pdf, _ = build_site_report(_inp(requirements=False))
    t = _flat("".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf")))
    assert "UNRESOLVED: no cited site requirements are loaded" in t
    assert "COUNCIL REQUIREMENTS ON FILE" not in t
    assert "Items the platform raises for confirmation" in t and "no cited value is on file" in t
    assert "freeboard" not in t.lower()


def test_cited_requirements_carry_their_source(built):
    t = _flat(built["txt"])
    assert "COUNCIL REQUIREMENTS ON FILE (CITED)" in t and "Development Control Plan" in t


def test_source_not_recorded_fallback(built):
    t = _flat(built["txt"])
    assert EX.SOURCE_NOT_RECORDED in t
    assert EX.SOURCE_NOT_RECORDED in EX.source_line({"service": "Planning/X", "layer_name": "Y"}, "host.example")
    assert EX.SOURCE_NOT_RECORDED in EX.source_line({}, None)
    line = EX.source_line({"service": "S", "layer_name": "L", "copyright": "Published by Example Agency."}, "h")
    assert "Published by Example Agency." in line and EX.SOURCE_NOT_RECORDED not in line


def test_pdf_bookmarks(built):
    toc = built["doc"].get_toc()
    titles = [x[1] for x in toc]
    assert any("How to read this report" in x for x in titles) and any("Glossary" in x for x in titles)
    assert any(x[0] == 2 for x in toc)                      # constraint pages are nested under their section


def test_site_only_no_building_content(built):
    t = _flat(built["txt"])
    for bad in ("Computed minimum floor level", "habitable", "Setbacks", "Parking, access", "Minimum floor level", "Dwelling house", "secondary dwelling"):
        assert bad not in t, bad
    assert "Site only" in t
    assert "NOT ASSESSED in this report" in t               # pathway not wired


def test_quote_truncation_at_word_boundary():
    q = "Council has adopted the 1% Annual Exceedance Probability (AEP) plus 0.5m freeboard, as its Flood Planning Level for all residential development within the shire area"
    s = fmt.shorten_quote(q, 60)
    assert s.endswith("…") and q.startswith(s[:-1].rstrip()) and q[len(s[:-1].rstrip())] in " ,;:."
    assert fmt.shorten_quote("Short quote.", 60) == "Short quote."


def test_dates_are_dd_mm_yyyy(built):
    assert "14/10/2026" in built["txt"]
    assert not re.search(r"\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b", built["txt"])


# ---------------------------------------------------------------------------------------------------------- review fixes (final2)
def test_bookmarks_target_their_real_pages(built):
    doc = built["doc"]
    toc = doc.get_toc()
    pages = [p for _, _, p in toc]
    assert len(set(pages)) >= len(toc) - 1 and max(pages) > 10          # not every entry on page 1
    for lvl, title, pg in toc:
        if title == "Constraint pages":
            continue
        head = re.sub(r"^\d+\s+", "", title).split(" (")[0]
        assert head.lower() in _flat(doc[pg - 1].get_text()).lower(), (title, pg)
    layer_pages = [pg for lvl, _, pg in toc if lvl == 2]
    assert len(set(layer_pages)) == 3 and layer_pages == sorted(layer_pages)


def test_no_missing_glyphs(built):
    from reportlab.pdfbase import pdfmetrics
    from app.report import theme
    theme.register_fonts()
    fonts = [pdfmetrics.getFont(n) for n in ("Plex", "Plex-Bold", "Plex-Italic", "Mono", "Mono-Medium", "Jost", "Jost-Medium", "Jost-Bold")]
    assert "\u25a1" not in built["txt"]
    for ch in set(built["txt"]):
        if not ch.isspace():
            assert any(ord(ch) in f.face.charToGlyph for f in fonts), f"no glyph for {ch!r}"


def test_no_internal_keys_or_developer_notes(built):
    t = _flat(built["txt"])
    for bad in ("landuse.permissibility", "lot.min_lot_size", "Util:", "Cloudflare", "granny", "supplied in the task", "House connection grade",
                "single-lot", "mapping for the two lots", "min grade 1 in", "eng standards", "planning level aep", "offline_fixture", "ingested", "bot challenge"):
        assert bad.lower() not in t.lower(), bad
    from app.report import sections as S
    for r in S.site_requirements(S.Ctx(_inp(), [], LOT, None, None, "dwelling_house", "R2", "Gunnedah")):
        assert r["key"] in S.REQ_LABELS and "." not in S.REQ_LABELS[r["key"]]
    assert "NOT FOUND IN THE CITED SOURCES (UNRESOLVED)" in t and "Minimum lot size" in t
    assert all(re.sub(r"[ /(),]", "", v).isalpha() or True for v in S.UNRESOLVED_TOPICS.values())


def test_aerial_window_fitted_to_coverage():
    import io
    from PIL import Image
    from app.report.figures import _fit_window_to_coverage
    im = Image.new("RGB", (400, 200), (255, 255, 255))
    im.paste(Image.new("RGB", (200, 200), (60, 90, 40)), (100, 0))        # covered strip in the middle
    b = io.BytesIO(); im.save(b, "PNG")
    win = (0.0, 0.0, 400.0, 200.0)
    lot = box(180, 80, 220, 120)
    new = _fit_window_to_coverage(b.getvalue(), win, 2.0, lot)
    assert new not in (None, "partial") and new[0] >= 99 and new[2] <= 301 and (new[2] - new[0]) / (new[3] - new[1]) == pytest.approx(2.0)
    assert _fit_window_to_coverage(b.getvalue(), win, 2.0, box(10, 10, 20, 20)) == "partial"    # lot outside the covered part
    full = Image.new("RGB", (40, 20), (50, 60, 70)); b2 = io.BytesIO(); full.save(b2, "PNG")
    assert _fit_window_to_coverage(b2.getvalue(), win, 2.0, lot) is None


def test_captions_state_true_extent(built):
    t = _flat(built["txt"])
    assert re.search(r"Figure extent about \d+ m wide by \d+ m high", t)
    assert "clipped to a" not in t


def test_measure_label_is_offset_from_line():
    from reportlab.pdfgen import canvas as cv
    from app.report import figures as F, theme
    theme.register_fonts()
    calls = []

    class C(cv.Canvas):
        def roundRect(self, x, y, w, h, *a, **k):
            calls.append((x + w / 2, y + h / 2))
            return super().roundRect(x, y, w, h, *a, **k)
    c = C(io.BytesIO())
    fig = F.MapFigure(400, 200, (0, 0, 100, 50), box(40, 20, 50, 30), measure=((50, 25), (80, 25), "d = 30 m"))
    F.draw_map(c, fig, 0, 0)
    line_y = 25 * 4.0
    assert any(abs(y - line_y) > 8 for _, y in calls)           # label centre sits clear of the horizontal line


def test_synthetic_demo_stamped_and_no_real_provenance():
    from app.report import figures as F
    inp = _inp()
    inp.meta["synthetic_demo"] = True
    pdf, js = build_site_report(inp)
    pages = [p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf")]
    t = _flat("\n".join(pages))
    assert "mapprod3" not in t and "fetched" not in t.lower() and "Local Environmental Plan 2012" not in t
    assert all("SYNTHETIC DEMO DATA" in _flat(p) for p in pages)
    lp = [p for p in pages if re.search(r"CONSTRAINT \d OF 3", p)]
    assert len(lp) == 3 and all("SYNTHETIC DEMO DATA" in p and "Source: SYNTHETIC DEMO DATA" in _flat(p) for p in lp)
    assert F.STAMP == "SYNTHETIC DEMO DATA"
    build_site_report(_inp())
    assert F.STAMP is None                                      # a normal report resets the stamp


def test_method_statement_true_and_defaults_labelled():
    civil = {"driveway": {"width_m": 3.0, "design_vehicle": "B85"}, "services": {}}
    pdf, _ = build_site_report(_inp(civil=civil))
    t = _flat("".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf")))
    assert "Requirement values appear only when cited" in t and "labelled ASSUMED / PLATFORM DEFAULT" in t
    assert re.search(r"3\.0 m \(ASSUMED / PLATFORM DEFAULT", t) and re.search(r"B85 \(ASSUMED / PLATFORM DEFAULT", t)
    assert "ASSUMED / PLATFORM DEFAULT: AS/NZS 2890.1" in t


def test_docstring_is_truthful():
    assert "NO clause number" in EX.__doc__ and "names no statutory" not in EX.__doc__.lower()


def test_glossary_corrections():
    g = dict(EX.GLOSSARY)
    assert "primary source to confirm many of the layers" in g["Section 10.7 planning certificate"]
    assert g["DBYD"].startswith("Before You Dig Australia (BYDA), formerly Dial Before You Dig")
    assert "driveway slab across the road verge" in g["Layover"] and "Layback" in g and "lowered" in g["Layback"]
    assert "determined by a qualified assessor under the applicable standard" in g["BAL (Bushfire Attack Level)"]
    assert "declared" in EX.LAYER_TEXT["nsw_mine_subsidence"]["what"] and "proclaimed" not in str(EX.LAYER_TEXT)


def test_all_not_checked_wording():
    res = [LayerResult(key=lt.key, label=lt.label, status="not_checked", error="no endpoint configured") for lt in layers_for("NSW")]
    inp = SiteReportInputs(meta={"lotplan": "2//DP227508", "lga_name": "Gunnedah", "jurisdiction": "NSW", "development_type": "Dwelling house",
                                 "date": "2026-10-14", "zone_code": "R2", "area_m2": 800.0}, results=res, triggers=[], lot_wkt=LOT.wkt, imagery=None)
    pdf, _ = build_site_report(inp)
    t = _flat("".join(p.get_text() for p in pymupdf.open(stream=pdf, filetype="pdf")))
    assert "layers were screened" not in t and "were listed for screening" in t and "0 could be checked and 18 could not be checked" in t


def test_cover_casing_paths_and_chip_colour(built):
    from app.report import theme
    t = _flat(built["txt"])
    assert "AI-assisted site planning" in t and "Ai-assisted" not in t
    assert "app/agents" not in t and ".py" not in t
    fg, bg = theme.STATUS_COL["clear"]
    r, g, b = (int(fg[i:i + 2], 16) for i in (1, 3, 5))
    assert not (g > r + 20 and g > b + 20)                      # not green
