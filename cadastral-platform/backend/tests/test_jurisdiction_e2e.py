"""End to end: custom parcel + user-entered rules (feet) -> SA5 plan with display units; plus a metric non-AU profile."""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import ezdxf
import pymupdf
import pytest
from shapely import wkt as swkt
from shapely.geometry import box

from app.agents.sa5_cad_dxf import Sa5CadDxf
from app.agents.sa5_cad_dxf.model import CadRequestSa5
from app.common.contracts import AckKind
from app.jurisdiction.adapter import cad_request_for_profile, sa1_for_profile
from app.jurisdiction.display import DisplaySpec, current_display
from app.jurisdiction.knowledge import CustomMunicipalityKnowledge, profile_requirements
from app.jurisdiction.parcel import CustomParcelRequest, Traverse, TraverseLeg
from app.jurisdiction.profile import LocaleSettings, UnitSettings, make_profile


def legs(w, d, unit):
    return [TraverseLeg(bearing=90, distance=w, unit=unit), TraverseLeg(bearing=180, distance=d, unit=unit),
            TraverseLeg(bearing=270, distance=w, unit=unit), TraverseLeg(bearing=0, distance=d, unit=unit)]


def cad_for(profile, tmp_path, req_parcel, scale, setback_key_values, formats=("dxf", "pdf")):
    sa1 = sa1_for_profile(profile).run(req_parcel)
    lot = sa1.lot
    kb = CustomMunicipalityKnowledge(profile, tmp_path / "kb")
    for key, (v, u) in setback_key_values.items():
        kb.enter_value(key, v, unit=u, who="engineer@example.com", note="county code table 3")
    rs = profile_requirements(profile, kb)
    front = rs.get("setback.front_m", jurisdiction="CUSTOM", lga=lot.lga_name)
    side = rs.get("setback.side_m", jurisdiction="CUSTOM", lga=lot.lga_name)
    poly = swkt.loads(lot.boundary_wkt)
    minx, miny, maxx, maxy = poly.bounds
    env = box(minx + side, miny + side, maxx - side, maxy - front)          # traverse is axis aligned, front edge on the north
    lot = lot.model_copy(update={"envelope_wkt": env.wkt})
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    req = CadRequestSa5(
        project_id=uuid4(), mga_srid=lot.mga_srid, drawing_scale_denominator=scale, lot=lot,
        services=[dict(service="water", label="Water main", geometry_wkt=f"LINESTRING({minx} {miny - 4}, {maxx} {miny - 4})",
                       diameter_mm=100, depth_m=0.9144)],
        rwt=dict(tank_volume_l=5000, location_xy=(cx, cy), diameter_m=2.0, regime="local", note=""),
        council_name=profile.council_label, export_formats=list(formats), acknowledgements_present=list(AckKind),
        project_title="Test dwelling", drawn_by="tester", output_path=str(tmp_path / "plan"),
        level_spots=[(cx, cy, 12.5)])
    return cad_request_for_profile(req, profile), rs


@pytest.fixture(scope="module")
def us(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("us")
    profile = make_profile("Test County TX", horizontal_epsg=32614, system="imperial_us", country="US", region="TX",
                           municipality="Test County", vertical_datum="NAVD88", standards=["AASHTO (user-cited)", "County Code Ch. 9"],
                           paper_size="ANSI_B", locale=LocaleSettings(date_format="%m/%d/%Y"))
    parcel = CustomParcelRequest(format="traverse", lot_label="Lot 7 Block 3", front_edges=[0],
                                 traverse=Traverse(start=(620000.0, 3350000.0), legs=legs(100, 150, "ft")))
    req, rs = cad_for(profile, tmp, parcel, 240, {"setback.front_m": (25, "ft"), "setback.side_m": (7.5, "ft")})
    agent = Sa5CadDxf()
    res = agent.run(req)
    return profile, req, res, agent, rs


def test_us_rules_entered_in_feet_are_stored_canonical(us):
    profile, req, res, agent, rs = us
    r = rs.get_requirement("setback.front_m", jurisdiction="CUSTOM", lga="Test County")
    assert r.value == pytest.approx(7.62) and (r.entered_value, r.entered_unit) == (25.0, "ft") and r.unit == "m"
    assert r.value_in("ft") == pytest.approx(25.0)


def test_us_dxf_is_in_feet_with_labels_in_feet(us):
    profile, req, res, agent, rs = us
    doc = ezdxf.readfile(res.dxf_path)
    assert doc.header["$INSUNITS"] == 2                          # international feet
    msp = doc.modelspace()
    lot = next(e for e in msp if e.dxftype() == "LWPOLYLINE" and e.dxf.layer == "C-PROP-BDY")
    xs = [p[0] for p in lot.get_points()]
    ys = [p[1] for p in lot.get_points()]
    assert (max(xs) - min(xs)) == pytest.approx(100.0, abs=1e-6) or (max(ys) - min(ys)) == pytest.approx(100.0, abs=1e-6)
    dims = [e.dxf.text for e in msp if e.dxftype() == "DIMENSION"]
    assert any(t.startswith("Frontage") and t.endswith(" ft") for t in dims), dims
    assert any("100.00 ft" in t for t in dims)
    assert any(t == "Front 25.00 ft" for t in dims), dims
    assert any(t == "Side 7.50 ft" for t in dims), dims
    texts = [e.dxf.text for e in msp if e.dxftype() == "TEXT"]
    assert any(t.startswith("AREA 15,000") is False and t.startswith("AREA 15000.0 ft²") for t in texts), texts
    assert any(t.endswith(" ft") and t.split()[-2] == "100.00" for t in texts), texts      # boundary distance labels
    assert any(t == "41.01" for t in texts), texts                                          # 12.5 m level spot shown in ft
    assert any(t.endswith("deep") and "3.00 ft" in t for t in texts), texts                # 0.9144 m service depth
    # dimension text height scaled with the drawing (feet): readable on paper at 1"=20'
    assert doc.header["$LTSCALE"] > 0
    assert not doc.audit().errors
    assert "ANSI B Plan" in [l.name for l in doc.layouts]


def test_us_pdf_labels_scale_and_paper(us):
    profile, req, res, agent, rs = us
    pdf = pymupdf.open(res.pdf_path)
    page = pdf[0]
    assert (round(page.rect.width / 72 * 25.4, 1), round(page.rect.height / 72 * 25.4, 1)) == (431.8, 279.4)       # ANSI B landscape
    text = page.get_text()
    assert "1\"=20'" in text                                    # engineering scale in the title block and scale bar
    assert "ANSI B" in text
    assert "15000.0 ft²" in text.replace("\n", " ") and "ft" in text
    assert "EPSG:32614" in text and "NAVD88" in text
    assert "AASHTO (user-cited)" in text
    assert "Dimensions in feet" in text.replace("\n", " ")
    assert "m²" not in text and "sq m" not in text


def test_display_is_scoped_and_default_unchanged(us):
    assert current_display().length_unit == "m" and current_display().custom is False


def test_metric_utm_profile_with_decimal_comma(tmp_path):
    profile = make_profile("Teststadt", horizontal_epsg=32633, system="metric", country="DE", municipality="Teststadt",
                           languages=["de"], vertical_datum="DHHN2016", standards=["DIN 1986-100 (user-cited)"],
                           locale=LocaleSettings(decimal_separator=",", thousands_separator=".", date_format="%d.%m.%Y"))
    parcel = CustomParcelRequest(format="traverse", lot_label="Flurstück 12/3", front_edges=[0],
                                 traverse=Traverse(start=(500000.0, 5400000.0), legs=legs(20, 30, "m")))
    req, rs = cad_for(profile, tmp_path, parcel, 200, {"setback.front_m": (5, "m"), "setback.side_m": (300, "cm")})
    res = Sa5CadDxf().run(req)
    doc = ezdxf.readfile(res.dxf_path)
    assert doc.header["$INSUNITS"] == 6
    msp = doc.modelspace()
    dims = [e.dxf.text for e in msp if e.dxftype() == "DIMENSION"]
    assert any(t == "Frontage 20,00 m" for t in dims), dims
    assert "Front 5,00 m" in dims and "Side 3,00 m" in dims
    text = pymupdf.open(res.pdf_path)[0].get_text()
    assert "1:200 @ A3" in text and "EPSG:32633" in text and "DHHN2016" in text and "DIN 1986-100" in text
    assert "600,0 sq m" in text.replace("\n", " ")
    assert "Dimensions in metres" in text.replace("\n", " ")


def test_arch_d_paper_and_inch_scale_bar(tmp_path):
    profile = make_profile("Big", horizontal_epsg=32614, system="imperial_us", paper_size="ARCH_D")
    parcel = CustomParcelRequest(format="traverse", traverse=Traverse(start=(620000.0, 3350000.0), legs=legs(100, 150, "ft")))
    req, _ = cad_for(profile, tmp_path, parcel, 120, {"setback.front_m": (25, "ft"), "setback.side_m": (5, "ft")}, formats=("pdf",))
    res = Sa5CadDxf().run(req)
    page = pymupdf.open(res.pdf_path)[0]
    assert round(page.rect.width / 72 * 25.4, 1) == 914.4 and round(page.rect.height / 72 * 25.4, 1) == 609.6
    assert "1\"=10'" in page.get_text()


def test_display_spec_formats():
    d = DisplaySpec.from_profile(make_profile("x", horizontal_epsg=32614, system="imperial_us",
                                              units=UnitSettings(system="imperial_us", area="acre", slope="ratio")))
    assert d.length(3.048) == "10.00 ft" and d.area(4046.8564224) == "1.000 ac" and d.slope(8.3333333) == "1:12.0"
    assert d.scale_label(240) == "1\"=20'" and d.scale_label(250) == "1:250" and d.dxf_units == "ft"
    assert DisplaySpec().length(12.345) == "12.35 m" and DisplaySpec().area_title(612.0) == "612.0 sq m"


def test_run_site_with_custom_profile_offline(tmp_path):
    """run_site --profile/--parcel: no NSW/QLD service is contacted, rules typed in feet, plan labels in feet."""
    import json
    from scripts import run_site
    profile = make_profile("Test County TX", horizontal_epsg=32614, system="imperial_us", municipality="Test County")
    parcel = CustomParcelRequest(format="traverse", front_edges=[0], lot_label="Lot 7",
                                 traverse=Traverse(start=(620000.0, 3350000.0), legs=legs(100, 150, "ft")))
    (tmp_path / "p.json").write_text(profile.model_dump_json())
    (tmp_path / "parcel.json").write_text(parcel.model_dump_json())
    (tmp_path / "rules.json").write_text(json.dumps([{"element": "front", "value_numeric": 25, "unit": "ft"},
                                                     {"element": "side", "value_numeric": 7.5, "unit": "ft"},
                                                     {"element": "rear", "value_numeric": 20, "unit": "ft"}]))
    out = tmp_path / "out"
    rc = run_site.main(["--profile", str(tmp_path / "p.json"), "--parcel", str(tmp_path / "parcel.json"), "--rules-json",
                        str(tmp_path / "rules.json"), "--zone-code", "R1", "--acknowledge", "--scale", "240", "--out", str(out)])
    assert rc == 0
    text = pymupdf.open(out / "plan.pdf")[0].get_text().replace("\n", " ")
    assert "Front 25.00 ft" in text and "1\"=20'" in text
    assert ezdxf.readfile(out / "plan.dxf").header["$INSUNITS"] == 2
