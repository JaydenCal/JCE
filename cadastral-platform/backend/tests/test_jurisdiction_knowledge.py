"""CustomMunicipalityKnowledge: foreign-language documents, original-quote validation, units, manual entry."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.agents.requirements.models import UnresolvedRequirement
from app.jurisdiction.knowledge import CustomMunicipalityKnowledge, numbers_in, profile_requirements
from app.jurisdiction.profile import LocaleSettings, make_profile
from app.jurisdiction.units import AmbiguousUnit, UnitMismatch

ES_LINES = [
    "Artículo 12. Accesos vehiculares.",
    "La pendiente máxima de la rampa de acceso vehicular será de 12 % en tramos rectos.",
    "El ancho mínimo del acceso vehicular será de 3,5 m para vivienda unifamiliar.",
    "La cobertura mínima sobre tuberías de agua potable será de 90 cm bajo calzada.",
    "El retiro frontal mínimo será de 5 metros según la zonificación vigente.",
]
EN_FT_LINES = [
    "Section 4.2 Driveways.",
    "The maximum driveway grade shall be 14 percent for single family lots.",
    "The minimum driveway width shall be 10 ft at the property line.",
    "The minimum front setback shall be 25 ft for residential lots in this district.",
    "Rainwater tanks of at least 500 gal shall be provided for roof areas over 2000 sq ft.",
]


def make_pdf(path: Path, lines: list[str]) -> Path:
    c = canvas.Canvas(str(path), pagesize=A4)
    y = 780
    for ln in lines:
        c.setFont("Helvetica", 11)
        c.drawString(50, y, ln)
        y -= 18
    c.showPage()
    c.save()
    return path


class FakeLlm:
    """Deterministic stand-in: finds the first rule sentence per key in the supplied chunks."""

    def __init__(self, rules: dict[str, tuple[str, float, str | None, str]]) -> None:
        self.rules, self.calls = rules, 0

    def complete(self, system: str, user: str, schema: dict) -> dict:
        self.calls += 1
        key = re.search(r"Requirement: (\S+)", user).group(1)
        assert "ORIGINAL language" in system and "machine translation" in system
        if key not in self.rules:
            return {"requirements": []}
        needle, value, unit, en = self.rules[key]
        for m in re.finditer(r"\[chunk_id=(\S+) pages", user):
            body = user[m.end():]
            body = body.split("[chunk_id=")[0]
            for ln in body.splitlines():
                if needle in ln:
                    return {"requirements": [{"chunk_id": m.group(1), "quote": ln.strip(), "quote_en": en, "value": value,
                                              "unit": unit, "confidence": 0.7}]}
        return {"requirements": []}


@pytest.fixture
def es_profile():
    return make_profile("Municipio de Prueba", horizontal_epsg=32630, system="metric", country="ES", municipality="Prueba",
                        languages=["es"], locale=LocaleSettings(decimal_separator=",", thousands_separator="."))


def test_numbers_are_locale_aware():
    assert numbers_in("ancho 3,5 m", ",") == [3.5]
    assert numbers_in("ancho 3,5 m", ".") == [35.0]
    assert numbers_in("1.234,5 m", ",") == [1234.5]


def test_spanish_document_original_quote_and_machine_gloss(tmp_path, es_profile):
    pdf = make_pdf(tmp_path / "ordenanza.pdf", ES_LINES)
    llm = FakeLlm({
        "driveway.max_grade_pct": ("pendiente máxima", 12, "%", "The maximum slope of the vehicle access ramp shall be 12 %."),
        "driveway.min_width_m": ("ancho mínimo", 3.5, "m", "The minimum width of the vehicle access shall be 3.5 m."),
        "water.min_cover_m": ("cobertura mínima", 90, "cm", "Minimum cover over drinking-water pipes shall be 90 cm."),
        "setback.front_m": ("retiro frontal", 5, "m", "The minimum front setback shall be 5 metres."),
    })
    kb = CustomMunicipalityKnowledge(es_profile, tmp_path / "kb", llm=llm)
    doc = kb.add_document(pdf, title="Ordenanza de Urbanismo", language="es", authority="Ayuntamiento de Prueba")
    assert doc.language == "es" and doc.profile_id == str(es_profile.profile_id)
    rep = kb.resolve()
    done = {r.key: r for r in rep.resolved}
    assert set(done) >= {"driveway.max_grade_pct", "driveway.min_width_m", "water.min_cover_m", "setback.front_m"}
    w = done["driveway.min_width_m"]
    assert w.value == pytest.approx(3.5) and w.unit == "m"
    assert "3,5 m" in w.quote_original and w.quote_original.startswith("El ancho")          # original language kept
    assert w.quote_en_machine_translated and w.quote_en.startswith("The minimum width")
    assert done["water.min_cover_m"].value == pytest.approx(0.9)                                 # 90 cm -> 0.9 m by dimensional analysis
    unresolved = {r.key for r in rep.unresolved}
    assert "sewer.min_grade_pct" in unresolved and "stormwater.min_cover_m" in unresolved
    assert all(r.prompt for r in rep.unresolved)
    assert kb.verify_citations() == []
    # citation validator checks the ORIGINAL quote, not the gloss
    req = next(r for r in kb.requirement_set().requirements if r.key == "driveway.min_width_m")
    req.source.quote = "El ancho mínimo era de 4 m"
    assert any("original-language quote not found" in p for p in kb.verify_citations())


def test_hallucinated_or_unitless_values_stay_unresolved(tmp_path, es_profile):
    pdf = make_pdf(tmp_path / "o.pdf", ES_LINES)

    class Bad:
        def complete(self, system, user, schema):
            key = re.search(r"Requirement: (\S+)", user).group(1)
            cid = re.search(r"chunk_id=(\S+) pages", user).group(1)
            if key == "driveway.min_width_m":       # quote not in chunk (English gloss instead of the original text)
                return {"requirements": [{"chunk_id": cid, "quote": "The minimum width shall be 3.5 m", "value": 3.5, "unit": "m"}]}
            if key == "driveway.max_grade_pct":     # number not in the quote
                return {"requirements": [{"chunk_id": cid, "quote": "La pendiente máxima de la rampa de acceso vehicular será de 12 % en tramos rectos.", "value": 15, "unit": "%"}]}
            if key == "water.min_cover_m":          # no unit stated -> never assumed
                return {"requirements": [{"chunk_id": cid, "quote": "La cobertura mínima sobre tuberías de agua potable será de 90 cm bajo calzada.", "value": 90, "unit": None}]}
            if key == "rwt.min_tank_volume_l":      # ambiguous 'gal' with no profile gallon -> unresolved
                return {"requirements": [{"chunk_id": cid, "quote": "La pendiente máxima de la rampa de acceso vehicular será de 12 % en tramos rectos.", "value": 12, "unit": "gal"}]}
            return {"requirements": []}

    kb = CustomMunicipalityKnowledge(es_profile, tmp_path / "kb", llm=Bad())
    kb.add_document(pdf, language="es")
    rep = kb.resolve(["driveway.min_width_m", "driveway.max_grade_pct", "water.min_cover_m", "rwt.min_tank_volume_l"])
    assert rep.resolved == [] and len(rep.unresolved) == 4


def test_no_llm_means_everything_unresolved_with_prompts(tmp_path, es_profile):
    kb = CustomMunicipalityKnowledge(es_profile, tmp_path / "kb")
    kb.add_document(make_pdf(tmp_path / "o.pdf", ES_LINES), language="es")
    rep = kb.resolve()
    assert not rep.resolved and len(rep.unresolved) == len(kb.standard_keys())


def test_imperial_profile_units_in_document_and_manual_entry(tmp_path):
    p = make_profile("Test County", horizontal_epsg=32614, system="imperial_us", country="US", municipality="Test County",
                     standards=["local standard"])
    llm = FakeLlm({
        "driveway.min_width_m": ("minimum driveway width", 10, "ft", "n/a"),
        "driveway.max_grade_pct": ("maximum driveway grade", 14, "%", "n/a"),
        "setback.front_m": ("minimum front setback", 25, "ft", "n/a"),
        "rwt.min_tank_volume_l": ("Rainwater tanks", 500, "gal", "n/a"),
    })
    kb = CustomMunicipalityKnowledge(p, tmp_path / "kb", llm=llm)
    kb.add_document(make_pdf(tmp_path / "ord.pdf", EN_FT_LINES), title="County Code", language="en")
    rep = kb.resolve()
    d = {r.key: r for r in rep.resolved}
    assert d["driveway.min_width_m"].value == pytest.approx(3.048) and d["driveway.min_width_m"].unit == "m"
    assert d["setback.front_m"].value == pytest.approx(7.62)
    assert d["rwt.min_tank_volume_l"].value == pytest.approx(500 * 3.785411784)          # profile says US gallons
    assert d["driveway.min_width_m"].quote_en_machine_translated is False                 # English source: no machine translation flag
    reqs = profile_requirements(p, kb)
    r = reqs.get_requirement("driveway.min_width_m", jurisdiction="CUSTOM", lga="Test County")
    assert r.value_in("ft") == pytest.approx(10.0)
    with pytest.raises(UnitMismatch):
        r.value_in("m2")
    # user enters values with unit selection; unresolved ones become usable
    with pytest.raises(UnresolvedRequirement):
        reqs.get("sewer.min_grade_pct", lga="Test County")
    e = kb.enter_value("util.min_cover_m", 3, unit="ft", who="eng@example.com", note="Std detail 7", service="sewer")
    assert e.value == pytest.approx(0.9144) and (e.entered_value, e.entered_unit) == (3.0, "ft") and e.status == "user_confirmed"
    e2 = kb.enter_value("sewer.min_grade_pct", 100, unit="1:n", who="eng")           # 1 in 100 = 1 %
    assert e2.value == pytest.approx(1.0)
    with pytest.raises(AmbiguousUnit):
        kb.enter_value("driveway.max_width_m", 20, who="eng")                      # unit must be chosen
    with pytest.raises(UnitMismatch):
        kb.enter_value("driveway.max_width_m", 20, unit="ft2", who="eng")
    with pytest.raises(ValueError, match="plausible range"):
        kb.enter_value("driveway.max_width_m", 2000, unit="ft", who="eng")
    got = profile_requirements(p, kb).get_requirement("util.min_cover_m", service="sewer", lga="Test County")
    assert got.value_in("ft") == pytest.approx(3.0)
    # save / load round trip keeps citations and entries
    kb.save()
    rs = profile_requirements(p, base_dir=tmp_path / "kb")
    assert rs.get("driveway.min_width_m", lga="Test County") == pytest.approx(3.048)
    assert profile_requirements(p).requirements == []


def test_deterministic_extraction_for_metric_english(tmp_path):
    p = make_profile("Metric EN", horizontal_epsg=32633, system="metric", municipality="Testville")
    pdf = make_pdf(tmp_path / "d.pdf", ["Driveways", "Minimum rainwater tank size 5000 L for all new dwellings in this area."])
    kb = CustomMunicipalityKnowledge(p, tmp_path / "kb")
    kb.add_document(pdf, language="en")
    rep = kb.resolve(["rwt.min_tank_volume_l"])
    assert [r.key for r in rep.resolved] == ["rwt.min_tank_volume_l"] and rep.resolved[0].value == 5000
