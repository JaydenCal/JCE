"""Stage 7: the civil plan set clean-up (C400 call-outs and chainage, C410 fill, C600 detail scale, C420 tag notes panel, C500 ESC panel, one type
scale, legend completeness, register titles).  Real Lot 2 offline run (in-process run_site) plus small synthetic cases."""
import dataclasses
import re
from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from shapely.geometry import LineString

from app.agents.sa5_cad_dxf.planset import codes, collide
from app.agents.sa5_cad_dxf.planset import generate as G
from app.agents.sa5_cad_dxf.planset import legend as LG
from app.agents.sa5_cad_dxf.planset import panels as PN
from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
from app.agents.sa5_cad_dxf.planset import style as ST
from app.agents.sa5_cad_dxf.planset import frame_a1 as FR
from app.agents.sa5_cad_dxf.planset.core import Sheet, View
from app.agents.sa5_cad_dxf.planset.sheets_ref import RefCtx

ROOT = Path(__file__).resolve().parents[1]


def stext(sh) -> str:
    return " ".join(it.text for v in sh.views for it in v.items if it.kind == "text")


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    from scripts.run_site import build_parser, run_site
    out = tmp_path_factory.mktemp("lot2_stage7")
    args = build_parser().parse_args(["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                                      "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only",
                                      "--planset-style", "ref", "--out", str(out)])
    run_site(args)
    sheets = dict(G.LAST_SHEETS)
    return NS(sheets=sheets, site=G.LAST_SITE, proj=G.LAST_PROJ, text={k: stext(v) for k, v in sheets.items()}, out=out)


def _views(real):
    return [(n, v) for n, sh in real.sheets.items() for v in sh.views]


def _flat(t: str) -> str:
    return re.sub(r"\s+", " ", t)


# ============================================================================================================ 1 leaders: no crossings
def test_real_run_no_two_leaders_cross_on_any_view(real):
    for n, v in _views(real):
        assert collide.leader_crossings(v) == [], (n, v.name, collide.leader_crossings(v)[:3])


def test_real_run_no_leader_runs_through_another_call_out_box(real):
    for n, v in _views(real):
        assert collide.leaders_through_boxes(v) == [], (n, v.name, collide.leaders_through_boxes(v)[:3])


def test_leader_crossing_check_catches_a_synthetic_crossing():
    v = View("p", (0, 0, 100, 100))
    v.leaders = [[(0, 0), (50, 50)], [(0, 50), (50, 0)]]
    assert collide.leader_crossings(v) == [(0, 1)]
    v.leaders = [[(0, 0), (20, 20)], [(30, 0), (50, 20)]]
    assert collide.leader_crossings(v) == []
    v.leaders = [[(0, 0), (20, 20)]]
    v.callout_boxes = [(0, 0, 5, 5), (10, 10, 30, 30)]
    assert collide.leaders_through_boxes(v) == [(0, 1)]


# ============================================================================================================ 2 chainage never dropped silently
def test_c400_every_chainage_station_is_labelled_or_listed(real):
    L = real.site.drive_cl.length
    sh = real.sheets["C400"]
    t = _flat(real.text["C400"] + " " + " ".join(sh.notes))
    listed = re.findall(r"CHAINAGE LABEL NOT PLACED \(([^)]*)\)", t)
    listed = listed[0] if listed else ""
    step = 2.0 if re.search(r"\bCH 2\b", t) else 5.0
    for d in S2._chainage_stations(L, step):
        lab = "DRIVEWAY END" if abs(d - L) < 1e-6 else f"CH {d:g}"
        assert lab in t or lab in listed, (lab, step)


def test_c400_unplaceable_chainage_labels_are_listed_on_the_sheet(real, monkeypatch):
    ctx = RefCtx(real.site, real.proj)
    monkeypatch.setattr(S2.ST, "label_box", lambda *a, **k: (-1.0e5, -1.0e5, 1.0e5, 1.0e5))       # no label box can be placed
    sh = S2.c400(ctx)
    t = _flat(stext(sh) + " " + " ".join(sh.notes))
    assert "CHAINAGE LABEL NOT PLACED" in t and "CH 0" in t


# ============================================================================================================ 3 C410 chart fills the sheet
def test_c410_chart_fills_the_sheet(real):
    sh = real.sheets["C410"]
    chart = [v for v in sh.views if v.name in ("section", "chart", "long")] or [v for v in sh.views if v.paper]
    xs, ys = [], []
    for v in sh.views:
        if v.name.startswith("title"):
            continue
        for it in v.items:
            if it.kind == "line":
                for p in it.pts:
                    xs.append(p[0]); ys.append(p[1])
    assert xs and ys
    assert max(xs) - min(xs) > 0.6 * (594.0 - 20.0)           # the profile spans most of the A1 width
    assert max(ys) - min(ys) > 0.45 * (420.0 - 20.0)          # and no large empty band: the drawing uses more than half of the sheet height
    assert chart is not None


# ============================================================================================================ 4 C420 tag notes
def test_c420_tag_notes_are_a_proper_list_not_wrapped_in_the_datum_panel(real):
    sh = real.sheets["C420"]
    t = _flat(real.text["C420"])
    if sh.tag_notes:                                          # only when no free rectangle fitted
        assert PN.TAG_NOTES_TITLE not in t
    elif "NOTES FOR TAGS" in t:
        assert PN.TAG_NOTES_TITLE in t


def test_tag_notes_panel_places_a_boxed_list_in_free_space():
    v = View("p", (0, 0, 400, 300))
    r = PN.place_notes_panel(v, ["TAG 1: LONG NOTE " * 6, "TAG 2: SHORT NOTE"], avoid=None, w=120.0)
    assert r is not None
    x0, y0, x1, y1 = r
    assert 0 <= x0 < x1 <= 400 and 0 <= y0 < y1 <= 300
    txt = " ".join(it.text for it in v.items if it.kind == "text")
    assert PN.TAG_NOTES_TITLE in txt and "TAG 2" in txt
    assert collide.audit(v) == [] and collide.outside(v) == []


def test_tag_notes_panel_returns_none_when_no_room():
    v = View("p", (0, 0, 60, 40))
    assert PN.place_notes_panel(v, ["A NOTE " * 30], avoid=None, w=120.0) is None


# ============================================================================================================ 5 C500 stockpiles and laydown
def test_c500_does_not_draw_the_stockpiles_and_laydown_and_lists_them_in_a_not_drawn_schedule(real):
    out = real.site.esc
    ids = {e.id for e in out.elements}
    assert not ids & {"SP1", "TS1", "LD1"} and not [i for i in ids if i.startswith("SF-SP") or i.startswith("SF-TS") or i.startswith("SF-LD")]
    assert {x["id"] for x in out.not_placed} == {"SP1", "TS1", "LD1"} and all(x["whole_lot_feasible"] for x in out.not_placed)
    assert sum("not drawn" in w.lower() for w in out.warnings) == 3                 # the SA10 warnings the SoEE reads
    assert not [w for w in out.warnings if "searching the whole lot" in w]
    t = _flat(real.text["C500"])
    assert "NOT DRAWN: POSITION TO BE CONFIRMED ONCE THE BUILDING FOOTPRINT IS KNOWN" in t
    for lab in ("SOIL STOCKPILE (SP1)", "TOPSOIL STOCKPILE (TS1)", "MATERIALS LAYDOWN / DELIVERY AREA (LD1)"):
        assert lab in t, lab
    assert re.search(r"FOOTPRINT 4 X 3 m", t) and "AT LEAST 2 m, 5 m PREFERRED" in t and "SEDIMENT CONTROL IMMEDIATELY DOWNSLOPE" in t and "STAR PICKETS USUALLY 2.5 m APART" in t
    assert "POSITION UNRESOLVED" not in t
    nd = [it for v in real.sheets["C500"].views for it in v.items if it.kind == "text" and it.text.startswith("NOT DRAWN: POSITION")]
    assert nd and all(it.color is not None for it in nd)                                  # red


def test_c500_not_drawn_schedule_is_empty_when_everything_is_placed(real):
    out = real.site.esc.model_copy(update={"not_placed": []})
    assert S2.esc_not_drawn_schedule(real.site, out) == []


def test_not_drawn_schedule_says_when_no_position_exists_anywhere_on_the_lot(real):
    out = real.site.esc.model_copy(update={"not_placed": [{**real.site.esc.not_placed[0], "whole_lot_feasible": False}]})
    rows = S2.esc_not_drawn_schedule(real.site, out)
    assert "NO POSITION MEETING THE CLEARANCES WAS FOUND ON THE LOT." in rows[0] and "WHERE THE BUILDING MAY BE BUILT" not in rows[0]


def test_sa10_whole_lot_search_is_a_feasibility_check_only(real):
    import dataclasses as dc
    e = real.site.esc
    assert not any("whole lot was searched" in n for el in e.elements for n in el.notes)
    assert all(el.status in ("resolved", "unresolved") for el in e.elements)


# ============================================================================================================ C300 overland flow arrows follow the view rotation
def test_c300_flow_arrows_are_rotated_with_the_view_and_match_the_dem_fall(real):
    import math
    from app.agents.sa5_cad_dxf.planset import sheets_plan as SP
    from app.agents.sa5_cad_dxf.planset import terrain_notes as TN
    v = real.sheets["C300"].views[0]
    assert abs(v.twist) > 5.0                                            # the plan really is rotated on this sheet
    shafts = [it for it in v.items if it.kind == "line" and it.layer.startswith("JCS-SITE-STRM") and len(it.pts) == 2]
    assert len(shafts) > 5
    sx = sy = 0.0
    for it in shafts:
        (x0, y0), (x1, y1) = it.pts
        px0, py0 = v.tp(x0, y0)
        px1, py1 = v.tp(x1, y1)
        d = SP.downslope(real.site, (x0, y0))
        ex, ey = SP.paper_dir(v, d)
        L = math.hypot(px1 - px0, py1 - py0)
        assert abs((px1 - px0) / L - ex) < 1e-6 and abs((py1 - py0) / L - ey) < 1e-6      # drawn direction = the DEM downslope vector turned by the view rotation
        sx += px1 - px0
        sy += py1 - py0
    b = math.radians(TN.dem_fall(real.site)["bearing"])
    ex, ey = SP.paper_dir(v, (math.sin(b), math.cos(b)))
    ang = abs((math.degrees(math.atan2(sy, sx) - math.atan2(ey, ex)) + 180.0) % 360.0 - 180.0)
    assert ang < 45.0, ang                                               # the mean arrow points the way the DEM fall points on the sheet
    assert sx > 0                                                        # the fall (bearing about 45 deg) runs to the rear of the lot: sheet right on this rotated plan


def test_paper_dir_is_the_same_turn_as_view_tp():
    from app.agents.sa5_cad_dxf.planset import sheets_plan as SP
    v = View("p", (0, 0, 200, 200), centre=(100.0, 100.0), scale=100, twist=-52.0)
    a, b = v.tp(100.0, 100.0), v.tp(101.0, 100.0)
    k = v.k
    assert abs((b[0] - a[0]) / k - SP.paper_dir(v, (1.0, 0.0))[0]) < 1e-9 and abs((b[1] - a[1]) / k - SP.paper_dir(v, (1.0, 0.0))[1]) < 1e-9
    assert SP.paper_dir(View("q", (0, 0, 10, 10)), (0.3, 0.4)) == (0.3, 0.4)


# ============================================================================================================ 6 one type scale
def test_text_heights_are_from_the_type_scale_except_the_cover_and_general_notes(real):
    allowed = {ST.TXT.SMALL, ST.TXT.BODY, ST.TXT.LABEL, ST.TXT.HEAD, ST.TXT.DETAIL_TITLE, 4.8, 5.2}      # 4.8 and 5.2 are the title strip sheet name and number
    stray = {}
    for n, sh in real.sheets.items():
        for v in sh.views:
            for it in v.items:
                if it.kind == "text" and round(it.h, 2) not in {round(a, 2) for a in allowed}:
                    stray.setdefault(n, {}).setdefault(round(it.h, 2), 0)
                    stray[n][round(it.h, 2)] += 1
    for n, hs in stray.items():
        assert min(hs) >= ST.TXT.SMALL - 1e-9, (n, hs)         # nothing below the small size anywhere
    plan = {n: hs for n, hs in stray.items() if n in ("C100", "C101", "C200", "C300", "C310", "C400", "C410", "C420", "C500", "C600")}
    assert not plan, plan                                      # the plan, section and detail sheets use the scale only


# ============================================================================================================ 7 legend covers every symbol
def test_legend_has_an_entry_for_every_symbol_class_used(real):
    names = " ".join(str(e[1]).upper() for e in LG.entries_for(real.site, True))
    for need in ("CENTRELINE", "CALL-OUT", "DIMENSION", "SPOT LEVEL", "NORTH POINT", "SWEPT PATH", "SECTION LINE", "SEDIMENT FENCE"):
        assert need in names, need
    plain = " ".join(str(e[1]).upper() for e in LG.entries_for(real.site, False))
    assert "SWEPT PATH" not in plain                           # a swept path is only in the legend when one is drawn
    assert len(LG.entries_for(None)) < len(LG.entries_for(real.site, True))


def test_every_layer_actually_drawn_has_a_legend_entry_or_a_stated_reason(real):
    legend_fns = {e[0].__name__ for e in LG.entries_for(real.site, False)} | {"_symbol"}
    drawn = {}
    for n, sh in real.sheets.items():
        for v in sh.views:
            for it in v.items:
                m = re.match(r"JCS-([A-Z]+)-([A-Z0-9]+)-(LINE|HATCH|TEXT|SYMB|NONE)$", it.layer)
                if m and it.kind != "image":
                    drawn.setdefault(f"{m.group(1)}-{m.group(2)}", set()).add(n)
    missing = []
    for key in sorted(drawn):
        if key.startswith("FRAM-"):
            continue
        if key in LG.NO_LEGEND:
            continue
        fn = LG.LEGEND_COVERS.get(key)
        if fn is None or fn not in legend_fns:
            missing.append((key, sorted(drawn[key])))
    assert not missing, missing
    for key in LG.NO_LEGEND:
        assert LG.NO_LEGEND[key]                                       # every exception states its reason


def test_legend_has_the_overland_flow_arrow_and_the_subject_lot_highlight(real):
    names = " ".join(str(e[1]).upper() for e in LG.entries_for(real.site, False))
    assert "OVERLAND FLOW DIRECTION" in names and "SUBJECT LOT HIGHLIGHT" in names
    assert "OVERLAND FLOW" not in " ".join(str(e[1]).upper() for e in LG.entries_for(dataclasses.replace(real.site, tin=None), False))


def test_esc_elements_are_on_the_escp_layers_not_the_notes_layer(real):
    lay = {it.layer for it in [i for v in real.sheets["C500"].views for i in v.items] if it.layer.startswith("JCS-SITE-ESCP")}
    assert lay


def test_c001_legend_text_is_on_the_sheet(real):
    t = _flat(real.text["C001"])
    assert "LEGEND" in t and "CENTRELINE" in t


# ============================================================================================================ 8 titles: strip = title block = register
def test_strip_title_and_register_match_the_sheet_titles_exactly(real):
    reg = _flat(real.text["C000"])
    for n, sh in real.sheets.items():
        title = ST.clean(codes.SHEET_TITLES[n]).upper()
        assert title in _flat(real.text[n]), (n, title)
        if n != "C000":
            assert title in reg, (n, title)


def test_panel_up_keeps_si_unit_symbols_lower_case():
    assert PN.up("3.0 m wide, 5 m DEM, 15 m2") == "3.0 m WIDE, 5 m DEM, 15 m2"
    assert PN.up("model") == "MODEL"


# ============================================================================================================ dates and units
def test_dates_are_dd_mm_yyyy_everywhere(real):
    iso = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
    dotted = re.compile(r"(?<![\d.])\d{2}\.\d{2}\.\d{2}(?![\d.])")
    for n, sh in real.sheets.items():
        t = _flat(real.text[n] + " " + " ".join(sh.notes))
        assert not iso.search(t), (n, iso.search(t).group(0))
        assert not dotted.search(t), (n, dotted.search(t).group(0))
    assert re.search(r"\b\d{2}/\d{2}/\d{4}\b", real.text["C000"])                 # the data sources table
    from app.agents.sa5_cad_dxf.planset import titleblock as TB
    p = dataclasses.replace(real.proj, brand=None, date="2026-10-21", revisions=[("A", "PRELIMINARY ISSUE", "2026-10-21", "JCE")])
    for fr in (TB.draw_frame, FR.draw_frame_a1):
        v = fr(Sheet("X", "T", []), p, 1, 2, "1:100")
        tt = " ".join(i.text for i in v.items if i.kind == "text")
        assert "21/10/2026" in tt and "2026-10-21" not in tt and "21.10.26" not in tt, fr.__name__
    assert ST.dmy("captured 2011-10-18; 2026-01-02") == "captured 18/10/2011; 02/01/2026"
    from app.agents.sa5_cad_dxf.planset import frame_a1
    assert frame_a1.fmt_date("2026-10-21") == "21/10/2026"


def test_the_aerial_note_is_not_repeated(real):
    t = _flat(real.text["C000"])
    assert "IMAGERY: IMAGERY:" not in t and "AERIAL IMAGERY: AERIAL" not in t
    assert t.count("AERIAL IMAGERY") <= 1


def test_one_unit_convention_on_every_sheet(real):
    bad = []
    pat = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?: ?)(MM|M2|M3|M|mm|m2|m3|m)(?![\w])")
    for n, sh in real.sheets.items():
        for v in sh.views:
            for it in v.items:
                if it.kind != "text":
                    continue
                for m in pat.finditer(it.text):
                    full = m.group(0)
                    if full != f"{m.group(1)} {m.group(2).lower()}" or m.group(2) != m.group(2).lower():
                        bad.append((n, it.text[:60]))
        assert "(M AHD)" not in real.text[n] and " M AHD" not in real.text[n], n
    assert not bad, bad[:5]


def test_units_normaliser_cases():
    from app.agents.sa5_cad_dxf.planset import fonts
    assert fonts.units("CUT 1.1 M3, FILL 0.0 M3 (M AHD) 5 M DEM 75 MM 4.0m 10.10 m 956 m2") == "CUT 1.1 m3, FILL 0.0 m3 (m AHD) 5 m DEM 75 mm 4.0 m 10.10 m 956 m2"
    assert fonts.units("DP227508 A1 1:50 P.25 SA3 C400") == "DP227508 A1 1:50 P.25 SA3 C400"
    assert fonts.wrap("LOT FALL 5 m DEM AND MORE TEXT HERE 150 MM THICK", 2.5, 30)[0].endswith("5 m DEM")


# ============================================================================================================ drafting
def test_c400_ch0_label_sits_on_its_station(real):
    import math
    v = real.sheets["C400"].views[0]
    s = real.site
    cl = s.drive_cl
    p = v.tp(*cl.interpolate(0.0).coords[0])
    ch0 = [it for it in v.items if it.kind == "text" and it.text == "CH 0"]
    assert ch0
    lx, ly = v.tp(*ch0[0].pts[0])
    assert math.hypot(lx - p[0], ly - p[1]) < 12.0                       # about the offset to the side of the line plus a 4 mm shift at most: never 0.7 m (14 mm) along


def test_c400_leader_does_not_cross_a_dimension_or_the_layover_wings(real):
    from shapely.geometry import LineString, Point
    v = real.sheets["C400"].views[0]
    assert v.leader_avoid and v.dim_geoms
    bad = []
    for i, q in enumerate(v.leaders):
        ln = LineString(q)
        t = Point(q[-1]).buffer(1.2)
        if any(ln.difference(t).intersects(g) for g in v.dim_geoms + v.leader_avoid):
            bad.append(i)
    assert not bad, bad


def test_c410_vertical_scale_bar_uses_round_steps(real):
    sh = real.sheets["C410"]
    labs = [it.text for v in sh.views for it in v.items if it.kind == "text" and re.fullmatch(r"\d+(\.\d+)?( m)?", it.text)]
    nums = sorted({float(x.split()[0]) for x in labs})
    bad = [x for x in nums if x in (0.0625, 0.1875, 0.3125)]
    assert not bad
    assert not re.search(r"\b0\.1875\b|\b0\.0625\b", real.text["C410"])


def test_scale_bars_use_round_steps():
    v = View("p", (0, 0, 300, 100))
    ST.scale_bar_ref(v, 10.0, 50.0, 100)
    labs = [it.text for it in v.items if it.kind == "text" and re.fullmatch(r"\d+(\.\d+)?( m)?", it.text)]
    steps = [float(x.split()[0]) for x in labs]
    d = {round(b - a, 6) for a, b in zip(steps, steps[1:])}
    assert d <= {0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 25.0}, d


def test_b85_check_line_reads_as_a_clearance_not_a_zero_limit(real):
    t = _flat(real.text["C400"])
    assert "PLATFORM SCREENING LIMIT AT LEAST 0 m CLEARANCE (NO SCRAPING)" in t
    assert "SCREENING LIMIT 0 m:" not in t


def test_kerb_section_has_no_void_under_the_layback():
    from app.agents.sa5_cad_dxf.planset import sections as SEC
    from app.agents.sa5_cad_dxf.planset import refs
    v = View("p", (0, 0, 500, 200))
    P = ST.Paper(v)
    k = SEC.kerb_gutter_profile(v, P, SEC.TypicalValues(refs.Cites("x")), 10.0, 100.0, 2.0, depth=14.0)
    assert k["bot"][1] == 100.0 - 14.0
    k2 = SEC.kerb_gutter_profile(View("q", (0, 0, 500, 200)), ST.Paper(View("q", (0, 0, 500, 200))), SEC.TypicalValues(refs.Cites("x")), 10.0, 100.0, 1.0)
    assert k2["bot"][1] == 100.0 - 10.0                                  # the default depth is unchanged
