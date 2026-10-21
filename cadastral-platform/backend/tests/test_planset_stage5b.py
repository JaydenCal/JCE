"""Stage 5b: the 13 fixes that followed the Opus final review, one or more tests each, on the REAL Lot 2 offline run (in-process run_site) and on
small synthetic cases (a conflicting ESC fall, an access shorter than the cited length, a lot that falls towards the street, colinear dimensions).

 1 laid-back kerb profile (gutter lip runs into the layback)      8 ESC call-outs: boxed, off the controls, no spaced dashes, no inlet pit claim
 2 ESC fall direction taken from the DEM, conflict flagged        9 section marker on the earthworks plan
 3 stabilised access at the cited length, else a red shortfall    10 project name
 4 C400 dimensions (offset vs width, no same-line dimensions)     11 hedged drainage note derived from the DEM
 5 C410 no invented verge design                                  12 provenance of the width and flare
 6 cover DCDB statement and viewport                              13 PLACEHOLDER vs TBC, council names in full
 7 C001 civil site items only
"""
import dataclasses
import math
import re
from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from shapely import wkt as swkt
from shapely.geometry import Polygon, box

from app.agents.sa5_cad_dxf.planset import collide
from app.agents.sa5_cad_dxf.planset import crossover as CX
from app.agents.sa5_cad_dxf.planset import generate as G
from app.agents.sa5_cad_dxf.planset import lga_notes as LN
from app.agents.sa5_cad_dxf.planset import refs
from app.agents.sa5_cad_dxf.planset import sections as SEC
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
from app.agents.sa5_cad_dxf.planset import terrain_notes as TN
from app.agents.sa5_cad_dxf.planset.core import Item, View
from app.agents.sa5_cad_dxf.planset.sheets_ref import RefCtx
from app.agents.sa5_cad_dxf.planset import style as ST

ROOT = Path(__file__).resolve().parents[1]


def stext(sh) -> str:
    return " ".join(it.text for v in sh.views for it in v.items if it.kind == "text")


def _run_real(out, generic: bool, extra=()):
    from scripts.run_site import build_parser, run_site
    mp = pytest.MonkeyPatch()
    if generic:                                       # a council WITHOUT typical-detail data: the generic crossover, kerb and C600 behaviour (stage 8b keeps it for such councils)
        from app.agents.sa5_cad_dxf.planset import typicals as TY
        mp.setattr(TY, "KNOW", out / "no_knowledge")
    args = build_parser().parse_args(["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                                      "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only",
                                      "--planset-style", "ref", "--out", str(out), *extra])
    try:
        run_site(args)
    finally:
        mp.undo()
    sheets = dict(G.LAST_SHEETS)
    return NS(sheets=sheets, site=G.LAST_SITE, proj=G.LAST_PROJ, text={k: stext(v) for k, v in sheets.items()}, out=out)


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    return _run_real(tmp_path_factory.mktemp("lot2_stage5b"), True)


@pytest.fixture(scope="module")
def real_ffl(tmp_path_factory):
    """A council without typical-detail data, with a user entered flood level: a finished floor level and a driveway end level exist, so the C200 section and the C410 design line are drawn."""
    return _run_real(tmp_path_factory.mktemp("lot2_stage5b_ffl"), True, ("--flood-level-ahd", "265.5"))


@pytest.fixture(scope="module")
def real_cited(tmp_path_factory):
    """The same run for Gunnedah WITH its typical-detail data (the default)."""
    return _run_real(tmp_path_factory.mktemp("lot2_stage5b_cited"), False)


def _ctx(real, **over):
    site = dataclasses.replace(real.site, **over) if over else real.site
    return site, RefCtx(site, real.proj)


# ====================================================================================================== 1 laid-back kerb profile
def test_kerb_profile_is_a_layback_with_no_barrier_upstand():
    v = View("p", (0, 0, 200, 100))
    k = SEC.kerb_gutter_profile(v, ST.Paper(v), SEC.TypicalValues(refs.Cites("x")), 10.0, 50.0, 1.0)
    prof = [it for it in v.items if it.kind == "line" and it.layer == SEC.L_LINE and len(it.pts) == 4][0].pts
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = prof
    assert y1 == y0 and x1 > x0                                  # flat gutter from the lip
    assert y2 > y1 and x2 > x1 and (x2 - x1) > 1.5 * (y2 - y1)    # the layback face rises at a flat angle (run longer than the rise), not a vertical face
    assert y3 == y2 and k["top"] == y2                           # the layover starts at the top of the layback: no kerb upstand
    for (a, b), (c, d) in zip(prof, prof[1:]):                   # no vertical segment anywhere on the profile
        assert abs(c - a) > 0.5


def test_c420_and_c600_carry_the_layback_profile_and_the_council_standard_governs(real):
    for code in ("C420", "C600"):
        t = real.text[code]
        assert "LAYBACK KERB AND GUTTER" in t and "GUTTER LIP RUNS INTO THE LAYBACK" in t
        assert "BARRIER" not in t and "UPSTAND" not in t
        assert "TYPICAL" in t
    t = real.text["C420"]
    assert "COUNCIL STANDARD DRAWING GOVERNS (NOT SELECTED)" in t and "LAYBACK HEIGHT TBC" in t


# ====================================================================================================== 2 ESC fall direction from the DEM
def test_esc_fall_comes_from_the_dem_and_the_basis_panel_says_so(real):
    out, dem = real.site.esc, TN.dem_fall(real.site)
    assert dem is not None and not out.flow.assumed
    diff = abs((out.flow.bearing_deg - dem["bearing"] + 180.0) % 360.0 - 180.0)
    assert diff < 10.0, (out.flow.bearing_deg, dem["bearing"])
    t = real.text["C500"]
    assert "NO LEVELS SUPPLIED" not in t and "NO LEVELS" not in t.replace("NO LEVELS PASSED", "")
    assert "INDICATIVE, 5 m DEM" in t and "BEARING" in t and "PERCENT" in t
    assert "DOWNSLOPE" in t                                      # agreement: the downslope labels stay
    assert S2.esc_flow_conflict(real.site, out) is None


def test_esc_conflict_with_the_dem_is_flagged_red_and_downslope_labels_are_removed(real):
    out = real.site.esc
    bad = out.model_copy(update={"flow": out.flow.model_copy(update={"bearing_deg": (TN.dem_fall(real.site)["bearing"] + 170.0) % 360.0, "assumed": True})})
    c = S2.esc_flow_conflict(real.site, bad)
    assert c is not None and c["diff"] > 150.0 and c["assumed"] is True
    site, ctx = _ctx(real, esc=bad)
    sh = S2.c500(ctx)
    t = stext(sh)
    assert "DOES NOT MATCH THE DEM FALL" in t and "DOWNSLOPE LABELS REMOVED" in t
    assert "NO LEVELS PASSED TO SA10" in t
    # DOWNSLOPE may only appear in the flag itself (and the cited NOT DRAWN schedule), never in a call-out
    callouts = " ".join(it.text for v in sh.views for it in v.items if it.kind == "text" and it.layer.startswith("JCS-ANNO-CALL"))
    assert "DOWNSLOPE" not in callouts and t.count("DOWNSLOPE") >= 1
    flag = [it for v in sh.views for it in v.items if it.kind == "text" and "DOES NOT MATCH THE DEM FALL" in it.text]
    assert flag and all(it.color is not None for it in flag)    # red


def test_sa10_receives_the_dem_points_and_no_illustrative_footprint():
    src = (ROOT / "scripts/run_site.py").read_text()
    assert "terrain_points=tpts" in src and "show_dwelling" in src


# ====================================================================================================== 3 access length
def test_access_is_drawn_at_the_cited_length(real):
    out, c = real.site.esc, real.site.cites.get("esc.access.min_length_m")
    assert c is not None and abs(out.quantities["access_length_m"] - float(c.value)) < 0.06
    acc = [swkt.loads(e.geometry_wkt) for e in out.elements if e.kind == "access"][0]
    rr = acc.minimum_rotated_rectangle
    xs = list(rr.exterior.coords)
    side = sorted([math.dist(xs[i], xs[i + 1]) for i in range(2)])
    assert abs(side[1] - float(c.value)) < 0.3
    assert S2.esc_access_shortfall(real.site, out) is None
    assert "SHORTER THAN THE CITED" not in real.text["C500"]
    assert f"LENGTH {float(c.value):.1f} m" in real.text["C500"]


def test_access_shorter_than_the_cited_length_gets_a_red_flag_with_the_cited_value(real):
    out = real.site.esc
    short = out.model_copy(update={"quantities": {**out.quantities, "access_length_m": 6.0}})
    sf = S2.esc_access_shortfall(real.site, short)
    assert sf is not None and sf[0] == 6.0 and sf[1] == float(real.site.cites.get("esc.access.min_length_m").value)
    site, ctx = _ctx(real, esc=short)
    sh = S2.c500(ctx)
    t = stext(sh)
    assert "SHORTER THAN THE CITED 15 m" in t or "SHORTER THAN THE CITED 15 M" in t.upper()
    assert "STABILISED ACCESS DRAWN 6.0 m LONG" in t
    red = [it for v in sh.views for it in v.items if it.kind == "text" and "SHORTER THAN THE CITED" in it.text]
    assert red and all(it.color is not None for it in red)


# ====================================================================================================== 4 C400 dimensions
def test_c400_offset_dimension_names_the_driveway_centreline_and_width_is_on_its_own_line(real):
    t = real.text["C400"]
    assert "BOUNDARY CORNER TO DRIVEWAY CENTRELINE" in t
    assert "3.0 m" in t
    v = real.sheets["C400"].views[0]
    assert collide.dim_line_overlaps(v) == []
    assert collide.dim_text_on_lines(v) == []


def test_line_on_line_dimension_check_catches_two_dimensions_on_one_line():
    v = View("p", (0, 0, 200, 100))
    v.items.append(Item("line", "C-ANNO-DIMS", [(10, 10), (60, 10)], False, 0.2))
    v.items.append(Item("line", "C-ANNO-DIMS", [(30, 10.4), (90, 10.4)], False, 0.2))
    assert len(collide.dim_line_overlaps(v)) == 1
    w = View("q", (0, 0, 200, 100))
    w.items.append(Item("line", "C-ANNO-DIMS", [(10, 10), (60, 10)], False, 0.2))
    w.items.append(Item("line", "C-ANNO-DIMS", [(60, 10), (90, 10)], False, 0.2))          # a chain touching end to end is fine
    assert collide.dim_line_overlaps(w) == []


def test_no_dimension_line_overlaps_on_any_sheet(real):
    bad = [(n, v.name) for n, sh in real.sheets.items() for v in sh.views if collide.dim_line_overlaps(v) or collide.dim_text_on_lines(v)]
    assert bad == []


# ====================================================================================================== 5 C410 no invented verge design
def test_c410_states_no_verge_design_and_the_design_line_is_the_existing_surface(real_ffl):
    real = real_ffl
    assert S2.NO_VERGE_DESIGN in real.text["C410"].replace("  ", " ") or "NO VERGE DESIGN: DESIGN LINE SHOWN AS EXISTING SURFACE" in real.text["C410"]
    p = S2.ref_profile(real.site)
    for t, z, nm in p["st"]:
        assert "HIGH POINT" not in nm.upper()
        if t <= p["sb"] + 1e-6:                                  # kerb line, back of band, boundary: design level = existing level
            assert abs(p["design"](t) - p["exz"](t)) < 1e-6, (t, nm)


def test_c420_section_follows_the_c410_verge_direction_and_is_diagrammatic(real):
    f = S2.verge_fall(real.site)
    t = real.text["C420"]
    assert "DIAGRAMMATIC" in t and "NO VERGE DESIGN" in t
    assert {-1: "FALLS TOWARDS THE LOT", 1: "RISES TO THE BOUNDARY", None: "LAYOVER GRADE TBC"}[f] in t


# ====================================================================================================== 6 cover DCDB statement and viewport
def test_cover_carries_the_dcdb_statement_inside_the_site_plan_panel(real):
    sh = real.sheets["C000"]
    items = [it for v in sh.views for it in v.items if it.kind == "text" and it.text.startswith("DCDB")]
    assert items and "NOT CHECKED, NOT CLEAR" in items[0].text
    assert items[0].color is not None                           # red
    x, y = items[0].pts[0]
    assert 30.0 <= x <= 420.0 and 100.0 <= y <= 200.0           # inside the framed site plan panel (x 30..420 paper mm), at its foot


def test_cover_viewport_uses_the_plan_sheet_orientation_and_cadastre(real):
    lv = [v for v in real.sheets["C000"].views if v.name == "locality"][0]
    pv = real.sheets["C101"].views[0]
    assert lv.twist == pv.twist == real.site.view_twist
    assert lv.window_poly().covers(real.site.lot)


# ====================================================================================================== 7 C001 civil site items only
def test_general_notes_have_no_building_content(real):
    t = real.text["C001"].upper()
    for w in ("BASIX", "CARPORT", "GARAGE", "HOT WATER", "RAINWATER TANK", "SECONDARY DWELLING", "HOUSING SEPP", "10/50", "VEGETATION CLEARING", "TANK CONNECTIONS"):
        assert w not in t, w
    for w in ("STABILISED SITE ACCESS", "SEDIMENT FENCE", "VEHICLE CROSSING", "STORMWATER"):
        assert w in t, w


def test_building_documents_are_filtered_from_the_cited_documents_list():
    for title in ("NSW Planning Portal: BASIX (increases to BASIX standards)", "NSW Fact Sheet: Carports and garages", "NSW Fact Sheet: Hot water systems and rainwater tanks",
                  "NSW Planning: Secondary dwellings (Housing SEPP) FAQ page", "NSW Planning: Bushfires (10/50 vegetation clearing)"):
        assert LN.BUILDING_DOC_RE.search(title), title
    for title in ("Managing Urban Stormwater: Soils and Construction, Volume 1 (the Blue Book)", "Guidelines for erosion and sediment control on building sites",
                  "Gunnedah Shire Council Development Control Plan 2025"):
        assert not LN.BUILDING_DOC_RE.search(title), title


# ====================================================================================================== 8 C500 call-outs
def test_esc_labels_are_boxed_callouts_off_the_control_boxes(real):
    sh = real.sheets["C500"]
    v = sh.views[0]
    out = real.site.esc
    assert len(v.callout_boxes) >= len(out.elements)
    ctl = [v.to_paper_geom(swkt.loads(e.geometry_wkt)) for e in out.elements]
    for bx in v.callout_boxes:
        b = box(*bx)
        for g, e in zip(ctl, out.elements):
            assert not (b.intersects(g) and g.geom_type in ("Polygon", "MultiPolygon") and b.intersection(g).area > 0.01), (bx, e.id)
    t = real.text["C500"]
    assert not re.search(r"\s-\s", t), re.findall(r".{20}\s-\s.{20}", t)
    assert not [n for n in v.fallback_notes if "SEDIMENT" in n or "ACCESS" in n]


def test_esc_inlet_is_a_gutter_sediment_trap_without_a_pit_claim(real):
    t = real.text["C500"]
    assert "GUTTER SEDIMENT TRAP (INDICATIVE)" in t and "NO STREET PIT LOCATION IN DATA" in t
    assert "KERB INLET" not in t
    el = [e for e in real.site.esc.elements if e.kind == "inlet"][0]
    assert S2._esc_lines(el, real.site.esc, None, True)[0] == "GUTTER SEDIMENT TRAP (INDICATIVE)"
    assert S2._esc_lines(el, real.site.esc, None, False) == ["KERB INLET SEDIMENT TRAP"]


def test_esc_text_helper_removes_spaced_dashes_and_slashes():
    assert " - " not in S2._up("Sediment fence - downslope limit") and S2._up("Sediment fence - downslope limit") == "SEDIMENT FENCE: DOWNSLOPE LIMIT"
    assert S2._up("Clean-water diversion (catch drain / bund)") == "CLEAN-WATER DIVERSION (CATCH DRAIN OR BUND)"
    assert S2._up("Soil 15 m2 and 3.0 M") == "SOIL 15 m2 AND 3.0 m"


# ====================================================================================================== 9 section marker
def test_section_marker_is_on_the_plan_at_the_section_chainage(real_ffl):
    real = real_ffl
    sh = real.sheets["C200"]
    plan, sec = sh.views[0], [v for v in sh.views if v.name == "section"][0]
    ew = S2.driveway_earthworks(real.site)
    tm, (qx, qy), _u, _n, _half = S2.section_station(real.site, ew)
    assert f"AT CHAINAGE {tm:.1f} M" in stext(sh).upper()
    letters = [it for it in plan.items if it.kind == "text" and it.text == S2.SECTION_ID and "ANNO-NOTE" in it.layer]
    assert len(letters) == 2
    dash = [it for it in plan.items if it.kind == "line" and "ANNO-NOTE" in it.layer and it.dash == "DASHED"]
    assert dash
    a, b = plan.tp(*dash[0].pts[0]), plan.tp(*dash[0].pts[-1])           # annotation items hold model coordinates of paper positions on a model view
    mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    cx, cy = plan.tp(qx, qy)
    assert math.dist(mid, (cx, cy)) < 3.0                       # the section line crosses the centreline at the stated chainage
    assert f"SECTION {S2.SECTION_ID}-{S2.SECTION_ID}" in stext(sh)


# ====================================================================================================== 10 project name
def test_project_name_is_never_the_raw_run_label(real):
    assert G.project_name("Test run: 2//DP227508", "2//DP227508") == "LOT 2 DP227508 SITE WORKS"
    assert G.project_name("", "2//DP227508") == "LOT 2 DP227508 SITE WORKS"
    assert G.project_name("Smith residence driveway", "2//DP227508") == "Smith residence driveway"
    assert G.project_name("Test run: x", "2//DP227508", "12 Smith Street, Gunnedah") == "12 Smith Street, Gunnedah SITE WORKS"
    assert real.proj.title.upper() == "LOT 2 DP227508 SITE WORKS"
    assert "2//DP227508" not in real.text["C000"] and "TEST RUN" not in real.text["C000"].upper()
    from scripts.run_site import _default_title
    assert _default_title(NS(address=None, lotplan="2//DP227508")) == "Lot 2 DP227508 site works"
    assert _default_title(NS(address="1 High St, Town", lotplan=None)) == "1 High St, Town site works"


# ====================================================================================================== 11 hedged drainage note from the DEM
NOTE_PARTS = ("LOT FALLS AWAY FROM THE STREET (INDICATIVE, 5 m DEM)", "LEGAL POINT OF DISCHARGE UNRESOLVED", "INTER-ALLOTMENT DRAINAGE EASEMENT OR OTHER SOLUTION MAY BE REQUIRED", "CONFIRM WITH")


def _stub_site(slope_y: float):
    lot = box(0, 0, 20, 40)
    seg = NS(is_front=True, start_xy=(0.0, 0.0), end_xy=(20.0, 0.0), adjoins="road", distance_m=20.0)
    spots = [(float(x), float(y), 100.0 + slope_y * y) for x in range(-10, 31, 5) for y in range(-10, 51, 5)]
    return NS(lot=lot, spots=spots, tin=None, tin_source="5 m DEM sampled over the plan window", cites=NS(council_name="Gunnedah Shire Council"),
              inp=NS(council_name="Gunnedah", lot=NS(lga_name="GUNNEDAH", segments=[seg])))


def test_drainage_note_is_derived_from_the_dem_fall():
    away = TN.drainage_discharge_note(_stub_site(-0.03))             # ground falls with increasing y: away from the street along y = 0
    assert away is not None and all(p in away for p in NOTE_PARTS)
    assert TN.drainage_discharge_note(_stub_site(+0.03)) is None      # falls towards the street: no such note
    flat = TN.drainage_discharge_note(_stub_site(0.0))
    assert flat is None
    f = TN.dem_fall(_stub_site(-0.03))
    assert abs(f["pct"] - 3.0) < 0.05 and abs(f["bearing"]) < 1.0 or abs(f["bearing"] - 360.0) < 1.0


def test_drainage_note_is_on_c300_and_in_the_c001_stormwater_group(real):
    assert TN.fall_vs_street(real.site) > 0.25
    for code in ("C300", "C001"):
        t = real.text[code].upper()
        for p in NOTE_PARTS:
            assert p.upper() in t, (code, p)
    c300 = [it for v in real.sheets["C300"].views for it in v.items if it.kind == "text" and it.text.startswith("LOT FALLS AWAY")]
    assert c300


# ====================================================================================================== 12 provenance
def test_width_and_flare_are_platform_defaults_in_every_place_they_are_printed(real):
    vals = {r["key"]: r for r in CX.layover_values(S2.make_xg(real.site, 0.0)[3])}
    for k in ("w_bdy", "w_kerb", "flare", "drive"):
        assert vals[k]["src"].startswith("PLATFORM DEFAULT") and vals[k]["placeholder"] is False, k
    assert vals["wing"]["placeholder"] is True and vals["band"]["placeholder"] is True
    t = real.text["C420"]
    for lab in ("LAYOVER WIDTH AT KERB 4.0 m (PLATFORM DEFAULT", "FLARE 0.5 m (PLATFORM DEFAULT", "DRIVEWAY WIDTH 3.0 m (PLATFORM DEFAULT"):
        assert lab in t, lab
    assert real.text["C400"].count("WIDTH 3.0 m (PLATFORM DEFAULT") >= 1


def test_a_selected_council_standard_changes_the_provenance_text():
    xg = S2.make_xg  # noqa: F841  (helper present)
    g = CX.CrossoverGeom() if hasattr(CX, "CrossoverGeom") else None
    assert g is not None
    g.present, g.width_m, g.flare_m, g.drive_width_m, g.kerb_offset_m, g.band_w_m, g.wing_len_m = True, 3.0, 0.5, 3.0, 4.0, 0.5, 1.0
    g.std_label = None
    assert CX.layover_values(g)[0]["src"] == "PLATFORM DEFAULT, TO BE VERIFIED"
    g.std_label = "Some Shire Council Standard Drawing R-1"
    assert "SELECTED STANDARD" in CX.layover_values(g)[0]["src"]


# ====================================================================================================== 13 PLACEHOLDER vs TBC, council names in full
def test_drafting_conventions_read_placeholder_and_tbc_is_for_council_values(real):
    t = real.text["C420"]
    assert "WING LENGTH 1.0 m (PLACEHOLDER)" in t and "KERB AND GUTTER BAND 0.5 m (PLACEHOLDER)" in t
    assert "WING LENGTH 1.0 m (TBC" not in t and "BAND 0.5 m (TBC" not in t
    assert "TBC (COUNCIL STANDARD DRAWING GOVERNS, NOT SELECTED)" in t


def test_council_name_is_kept_in_full_and_not_hard_coded():
    t = refs._short("Gunnedah Shire Council Engineering Design Minimum Standards for Subdivisions and Developments", "Version 1, April 2025")
    assert t.startswith("Gunnedah Shire Council Engineering Design Minimum Standards") and "GSC" not in t
    t2 = refs._short("Tamworth Regional Council Engineering Standards", "2024")
    assert t2.startswith("Tamworth Regional Council")
    assert "GSC" not in (Path(refs.__file__).read_text())


def test_requirements_sourced_from_another_councils_document_are_not_cited():
    c = refs.Cites("Nowhereville")
    assert all("Gunnedah" not in (v.doc or "") for v in c.by_key.values())
    g = refs.Cites("Gunnedah")
    assert any("Gunnedah" in (v.doc or "") for v in g.by_key.values())


def test_no_spaced_hyphen_dash_or_initialism_anywhere_in_the_rendered_text(real):
    for code, t in real.text.items():
        assert not re.search(r"\s-\s", t), (code, re.findall(r".{25}\s-\s.{15}", t)[:2])
        assert "—" not in t and "–" not in t, code
        assert "GSC" not in t, code


def test_cited_run_has_no_spaced_hyphen_or_dash_and_gsc_only_as_a_drawing_or_document_tag(real_cited):
    """Stage 8b: the council standard drawing is labelled GSC SD-107 REV A (owner's brief); the initialism appears only in the short document and drawing tags of the typicals data."""
    ok = re.compile(r"GSC (SD-107 REV A|ENGINEERING STANDARDS V1 \(APR 2025\)|ENGINEERING DESIGN MINIMUM STANDARDS|DCP 2025|RD0?\d+|SW0?\d+|G00\d|WATER \d+)", re.I)
    for code, t in real_cited.text.items():
        assert not re.search(r"\s-\s", t), (code, re.findall(r".{25}\s-\s.{15}", t)[:2])
        assert "—" not in t and "–" not in t, code
        rest = ok.sub("", t)
        assert "GSC" not in rest.upper(), (code, re.findall(r".{20}GSC.{20}", rest.upper())[:2])


def test_council_initialism_inside_a_cited_value_is_written_in_full():
    from app.agents.sa5_cad_dxf.planset import phrases as PH
    assert PH._expand_council_initials("GSC Engineering Design Minimum Standards", "Gunnedah Shire Council") == "Gunnedah Shire Council Engineering Design Minimum Standards"
    assert PH._expand_council_initials("Tamworth Standards", None) == "Tamworth Standards"
    assert refs.Cite("k", 1, "m", "Doc", 3, "4.7 Service connections - locations (water)", "").ref == "Doc, 4.7 Service connections, locations (water), p.3"


# ====================================================================================================== stage 8c: review fixes on the drawn sheets (Gunnedah with its typical details)
def _all_text(real) -> str:
    return " ".join(real.text.values())


def test_8c_crossing_notes_cite_sd107_and_keep_only_the_real_gaps(real_cited):
    t = _all_text(real_cited)
    assert "VEHICLE CROSSING TO GSC SD-107 REV A" in real_cited.text["C001"]
    for stale in ("NOT SELECTED", "COUNCIL STANDARD DRAWING GOVERNS", "Gsc sd-107", "GSC DCP 2025 (DCP 2025"):
        assert stale not in t, stale
    c1 = real_cited.text["C001"]
    for gap in ("RD003", "RD0010", "RD011"):
        assert gap in c1, gap
    assert "DRIVEWAY MAXIMUM GRADE UNRESOLVED" in c1


def test_8c_design_vehicle_is_b99_everywhere_it_is_named(real_cited):
    assert "B99" in real_cited.text["C400"] and "B85" not in real_cited.text["C400"]
    assert "B99" in real_cited.text["C001"] and "B85" not in real_cited.text["C001"]


def test_8c_c410_draws_the_typical_line_and_no_defaulted_end_level(real_cited):
    t = real_cited.text["C410"]
    assert "TYPICAL LEVEL (SD-107)" in t and "COUNCIL TYPICAL LINE (SD-107), INDICATIVE" in t
    assert "BACK OF LAYBACK (E.J.)" in t and "PROPERTY BOUNDARY" in t
    assert "PROPOSED DRIVEWAY LEVELS NOT AVAILABLE" in t and "DESIGN LEVEL (PLATFORM PROFILE)" not in t
    assert "COUNCIL REQUIREMENT: DRIVEWAY MAXIMUM GRADE UNRESOLVED" in t or "COUNCIL MAXIMUM DRIVEWAY GRADE" in t


def test_8c_c420_splay_depth_is_named_to_the_back_of_kerb_and_the_boundary_joint_is_called_out(real_cited):
    t = real_cited.text["C420"]
    assert "SPLAY DEPTH 0.3 m (BACK OF LAYBACK TO BACK OF KERB" in t
    assert t.count("E.J. AT THE") >= 2 and "PROPERTY BOUNDARY" in t


def test_8c_c500_stabilised_access_cites_both_minimum_lengths(real_cited):
    t = real_cited.text["C500"]
    assert re.search(r"15 m \(BLUE BOOK", t) and re.search(r"3 m \(BUILDING SITES|3 m \(ESC GUIDELINES FOR BUILDING SITES", t)
    assert "P.19" in t and "P.163" in t


def test_8c_c600_pavement_bullet_is_a_sentence_and_citations_are_not_clipped(real_cited):
    t = real_cited.text["C600"]
    assert "DRIVEWAYS (ALL INTERNAL VEHICLE ACCESS AND MANOEUVRING AREAS) ARE TO BE CONCRETE, BITUMEN, INTERLOCKING PAVERS OR ASPHALT" in t
    assert "2.8.7 VEHICULAR CROSSINGS AND," not in t and "SD-107 SECTION (NOMINAL KERB" not in t
    assert "[GSC ENGINEERING STANDARDS V1 (APR 2025) 4.7.7.4, P.119]" in t or "4.7.7.4, P.119" in t
    assert "ADOPTED 18/06/2025" in real_cited.text["C600"] or "ADOPTED 18/06/2025" in _all_text(real_cited)
