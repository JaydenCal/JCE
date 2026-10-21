"""Stage 8 (21/10/2026): the typical house placed on Lot 2 DP227508 to the CITED Gunnedah setbacks, contour labels on the plans, DBYD (Before You Dig) Phase 0 and the verification box.

Checked on the REAL offline Lot 2 run (in-process run_site) and on SYNTHETIC BYDA data (tests/byda_synthetic.py: invented owners, job and plans, stamped SYNTHETIC; no real plan is used
or copied).  No test reads a real BYDA file.
"""
import json
import re
from datetime import date
from pathlib import Path

import ezdxf
import pymupdf
import pytest
from shapely import wkt as swkt
from shapely.geometry import LineString

import byda_synthetic as SYN
from app.agents.sa5_cad_dxf.planset import collide
from app.agents.sa5_cad_dxf.planset import generate as G
from app.common.statement import AI_DRAFT_STATEMENT, VERIFY_STATEMENT
from app.design.building_place import cited_setbacks
from app.integrations.byda import folder_import as FI
from app.integrations.byda.traces import TraceError, TraceStore
from app.integrations.byda.view import LABEL_TEXT, build_view, load_view
from app.offline import lot2 as L2

ROOT = Path(__file__).resolve().parents[1]
HOUSE = ROOT / "tests/fixtures/planstudio_house_single.planstudio.json"
PLAN_SHEETS = ("C100", "C101", "C200", "C300", "C310", "C400", "C500")


class NS:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _render(out: Path, *extra: str) -> NS:
    from scripts.run_site import build_parser, run_site
    args = build_parser().parse_args(["--offline", "lot2", "--lotplan", "2//DP227508", "--development-type", "dwelling_house", "--levels", "nsw",
                                      "--rules-json", str(ROOT / "tests/fixtures/R2_dwelling_house_rules.json"), "--acknowledge", "--planset", "--planset-only",
                                      "--planset-style", "ref", "--out", str(out), *extra])
    run_site(args)
    doc = pymupdf.open(next(out.rglob("planset.pdf")))
    pages = {}
    for p in doc:
        t = " ".join(p.get_text().split())
        m = re.search(r"JCS-[A-Z0-9]+-CIV-(\d{3})", t)
        pages[f"C{m.group(1)}" if m else f"p{p.number}"] = t
    facts = json.loads(next(out.rglob("run_steps.json")).read_text())["facts"]
    return NS(sheets=dict(G.LAST_SHEETS), pages=pages, dxf=next(out.rglob("planset.dxf")), facts=facts, out=out)


@pytest.fixture(scope="module")
def lot2(tmp_path_factory):
    return _render(tmp_path_factory.mktemp("s8_lot2"), "--building", str(HOUSE))


@pytest.fixture(scope="module")
def no_building(tmp_path_factory):
    return _render(tmp_path_factory.mktemp("s8_nobld"))


# ====================================================================================================== building placed to the cited setbacks
def test_house_is_placed_and_every_cited_setback_is_met_with_value_and_source(lot2):
    b = lot2.facts["building"]
    assert b["placed"] and b["source"].upper().startswith("PLAN STUDIO TYPICAL HOUSE")
    cited = cited_setbacks("Gunnedah", "R2", "dwelling_house")
    want = {k: c.value for k, c in cited.items() if c is not None and c.value is not None}
    assert want, "the cited Gunnedah R2 setbacks must be readable from the knowledge file"
    rows = [r for r in b["rows"] if not r["informational"]]
    assert {r["label"] for r in rows} >= {"FRONT BOUNDARY", "REAR BOUNDARY", "SIDE BOUNDARY (LEFT)", "SIDE BOUNDARY (RIGHT)"}
    for r in rows:
        assert r["met"] is True and r["actual_m"] >= r["required_m"] - 1e-6, r
        assert "Gunnedah" in r["cite"] and "Table 2" in r["cite"], r


def test_footprint_geometry_clears_each_boundary_by_at_least_the_cited_value(lot2):
    b = lot2.facts["building"]
    fp = swkt.loads(b["footprint_wkt"])
    pts = L2.LOT
    edges = [LineString([pts[i], pts[(i + 1) % len(pts)]]) for i in range(len(pts))]
    assert swkt.loads(f"POLYGON(({','.join(f'{x} {y}' for x, y in pts + [pts[0]])}))").contains(fp)
    req = {r["label"]: r["required_m"] for r in b["rows"] if not r["informational"]}
    nearest = min(fp.distance(e) for e in edges)
    assert nearest >= min(v for v in req.values() if v) - 0.02, (nearest, req)
    front_edge = min(edges, key=lambda e: abs(e.length - 20.23))               # the 20.23 m road frontage
    assert fp.distance(front_edge) >= req["FRONT BOUNDARY"] - 0.02


def test_unmet_garage_rule_and_unresolved_ffl_are_stated_not_hidden(lot2):
    b = lot2.facts["building"]
    g = b["garage_rule"]
    assert g["met"] is False and g["required_m"] == 1.0 and g["actual_m"] < 0                  # the template garage projects forward of the dwelling: reported, layout not changed
    assert b["ffl_m"] is None and "FFL TBC" in b["ffl_note"] and "flood" in b["ffl_note"].lower()
    c101 = lot2.pages["C101"]
    assert "GARAGE BEHIND FRONT" in c101 and "NOT MET" in c101.upper()
    assert "FINISHED FLOOR LEVEL TBC" in lot2.pages["C000"]


def test_setback_dimensions_and_sources_are_shown_on_the_site_plan(lot2):
    t = lot2.pages["C101"]
    b = lot2.facts["building"]
    for r in b["rows"]:
        if not r["informational"] and r["label"] in ("FRONT BOUNDARY", "SIDE BOUNDARY (LEFT)", "SIDE BOUNDARY (RIGHT)"):
            assert f"{r['actual_m']:.2f} m" in t, r["label"]
    assert "BUILDING SETBACKS (CITED)" in t and "SETBACK SOURCES" in t and "TABLE 2" in t and "P.37" in t
    assert "6.5 m" in t and "0.9 m" in t


def test_building_outline_is_on_every_building_sheet_and_c100_is_existing_only(lot2):
    def n_bld(sheet):                                                                   # layer A-BLDG-PROP is JCS-SITE-BLDG-* once the sheets are coded
        return sum(1 for v in lot2.sheets[sheet].views for it in v.items if "BLDG" in it.layer)
    for sh in ("C101", "C200", "C300", "C310", "C400", "C500"):
        assert n_bld(sh) > 0, sh
    assert n_bld("C100") == 0
    assert "TYPICAL HOUSE" in lot2.pages["C101"]


def test_without_a_building_no_dwelling_is_invented(no_building):
    assert "building" not in no_building.facts or not no_building.facts["building"].get("placed")
    assert "NO BUILDING FOOTPRINT" in no_building.pages["C000"]


def test_sa10_places_nothing_inside_the_footprint(lot2):
    esc = list(lot2.out.rglob("escp_*_report.md")) + list(lot2.out.rglob("escp_*.geojson"))
    assert esc, "SA10 output expected"
    fp = swkt.loads(lot2.facts["building"]["footprint_wkt"])
    gj = json.loads(next(lot2.out.rglob("escp_*.geojson")).read_text())
    from shapely.geometry import shape
    for f in gj["features"]:
        pr = f.get("properties", {})
        if str(pr.get("kind", pr.get("type", ""))).lower() in ("stockpile", "laydown", "laydown_area", "material_laydown"):
            assert not shape(f["geometry"]).intersects(fp), pr


# ====================================================================================================== contour labels
def test_contour_labels_are_on_every_plan_sheet_and_do_not_collide(lot2):
    d = ezdxf.readfile(lot2.dxf)
    for sh in PLAN_SHEETS:
        labs = [e for e in d.layouts.get(sh) if e.dxftype() == "TEXT" and "CONT" in e.dxf.layer and re.fullmatch(r"\d{3}\.\d+", e.dxf.text)]
        assert labs, sh
    for n, sh in lot2.sheets.items():
        for v in sh.views:
            assert collide.audit(v) == [], (n, v.name, collide.audit(v)[:4])
            assert collide.outside(v) == [], (n, v.name)


def test_contour_label_text_is_rl_to_two_decimals_and_the_sheet_says_what_they_are(lot2):
    t = lot2.pages["C101"]
    assert re.search(r"\b26[3-6]\.\d\d\b", t)
    assert "CONTOUR" in t and "DEM" in t


# ====================================================================================================== verification box (front of each document only)
def test_plan_set_cover_carries_the_verification_box_and_nothing_else_carries_the_ai_statement(lot2):
    cover = lot2.pages["C000"]
    assert VERIFY_STATEMENT in cover and "SIGNATURE" in cover and "DATE" in cover and "NAME" in cover
    ai = "AI GENERATED DRAFT"
    for k, t in lot2.pages.items():
        assert ai not in t.upper() and AI_DRAFT_STATEMENT.upper() not in t.upper(), k
        if k != "C000":
            assert VERIFY_STATEMENT not in t, k                                                     # the box is on the front sheet only


def test_dxf_has_no_ai_statement_and_one_verification_box(lot2):
    d = ezdxf.readfile(lot2.dxf)
    texts = []
    for lay in d.layouts:
        for e in lay:
            if e.dxftype() in ("TEXT", "MTEXT"):
                texts.append((lay.name, e.dxf.text if e.dxftype() == "TEXT" else e.text))
    assert not [x for x in texts if "AI GENERATED DRAFT" in x[1].upper()]
    assert {n for n, t in texts if VERIFY_STATEMENT in t} == {"C000"}


# ====================================================================================================== DBYD importer (SYNTHETIC)
@pytest.fixture()
def synth_project(tmp_path):
    (tmp_path / "BYDA" / "plans").mkdir(parents=True)
    spans = SYN.combined_pdf(tmp_path / "BYDA" / "plans" / "SYNTHETIC combined.pdf")
    return tmp_path, spans


def test_page_table_is_parsed_from_page_one_not_hard_coded(synth_project):
    root, spans = synth_project
    doc = pymupdf.open(root / "BYDA" / "plans" / "SYNTHETIC combined.pdf")
    s = FI.parse_summary(doc[0].get_text())
    assert s.job_id == SYN.JOB and [(r.name.split(" (")[0], r.start_page) for r in s.owners] == [(k, v[0]) for k, v in spans.items()]
    assert FI.iso(s.expires) == "2026-11-12"


def test_import_splits_per_owner_and_registers_job_dates_and_validity(synth_project):
    root, spans = synth_project
    res = FI.import_folder(root, today=date(2026, 10, 21))
    reg = res.registry
    assert reg["job_number"] == SYN.JOB and reg["synthetic"] is True and reg["enquiry_valid_until"] == "2026-11-12"
    by = {o["owner"]: o for o in reg["owners"]}
    assert set(by) == set(spans)
    for k, (a, z) in spans.items():
        assert by[k]["section_pages"] == [a, z], k
        assert by[k]["plan_date"] == "2026-10-15" and by[k]["response_received"] == "2026-10-15"
    assert by["SYNTHETIC Power Co"]["plans_received"] and by["SYNTHETIC Power Co"]["valid_days"] == 28
    assert by["SYNTHETIC Power Co"]["valid_until"] == "2026-11-12"
    assert by["SYNTHETIC Water Authority"]["valid_until"] == "2026-11-14" and by["SYNTHETIC Water Authority"]["effective_valid_until"] == "2026-11-12"
    assert not by["SYNTHETIC Telecom"]["plans_received"] and any(f.get("excluded") for f in by["SYNTHETIC Telecom"]["files"])
    assert by["SYNTHETIC Gas Co"]["response_status"] == "Pending"
    assert [f["content"] for f in by["SYNTHETIC Power Co"]["files"] if f.get("plan_candidate")] == ["vector"]
    assert all(not f.get("plan_candidate") for f in by["SYNTHETIC Gas Co"]["files"])
    stored = list((root / "dbyd" / "plans").glob("*.pdf"))
    assert len(stored) == 4 and res.created_plans == 4                                                  # plans are stored in the project only


def test_import_is_idempotent_and_dry_run_writes_nothing(synth_project):
    root, _ = synth_project
    dry = FI.import_folder(root, write=False)
    assert dry.registry["owners"] and not (root / "dbyd").exists()
    FI.import_folder(root)
    again = FI.import_folder(root)
    assert again.created_plans == 0 and again.skipped_plans == 4
    assert len(list((root / "dbyd" / "plans").glob("*.pdf"))) == 4


def test_owner_folder_layout_is_imported_too(tmp_path):
    SYN.owner_folder(tmp_path)
    reg = FI.import_folder(tmp_path).registry
    by = {o["owner"]: o for o in reg["owners"]}
    assert reg["job_number"] == SYN.JOB and reg["synthetic"] and by["SYNTHETIC Power Co"]["plans_received"] and by["SYNTHETIC Power Co"]["valid_days"] == 28
    assert not by["SYNTHETIC Telecom"]["plans_received"]


def test_import_never_creates_traced_or_verified_services(synth_project):
    root, _ = synth_project
    FI.import_folder(root)
    assert TraceStore(root).features() == [] and TraceStore(root).verified_for_drawing() == []
    v = load_view(root, today=date(2026, 10, 21))
    assert v.n_verified == 0 and v.n_draft == 0 and v.verified == []
    assert "NOT CONFIRMED" in v.not_confirmed_text().upper()


def test_trace_is_draft_and_only_a_named_person_can_verify(synth_project):
    root, _ = synth_project
    FI.import_folder(root)
    ts = TraceStore(root)
    f = ts.add_draft(owner="SYNTHETIC Power Co", service="electricity", kind="polyline", pts=[[0, 0], [10, 0]], traced_by="A Person", srid=7856)
    assert f["status"] == "draft" and ts.verified_for_drawing() == []
    for bad in ("", "auto", "System", "claude", "importer", "AI"):
        with pytest.raises(TraceError):
            ts.verify(f["id"], bad)
    assert ts.get(f["id"])["status"] == "draft"
    with pytest.raises(TraceError):
        ts.add_draft(owner="x", service="electricity", kind="point", pts=[[0, 0]], traced_by="bot")
    r = ts.verify(f["id"], "A Person")
    assert r["status"] == "verified" and r["verified_by"] == "A Person" and ts.verified_for_drawing()[0]["id"] == f["id"]
    with pytest.raises(TraceError):
        ts.verify(f["id"], "A Person")                                                                 # only a draft can be verified
    g = ts.add_draft(owner="SYNTHETIC Power Co", service="water", kind="point", pts=[[1, 1]], traced_by="A Person")
    ts.reject(g["id"], "A Person", "not on the plan")
    assert ts.get(g["id"])["status"] == "rejected" and len(ts.verified_for_drawing()) == 1
    with pytest.raises(TraceError):
        ts.reject(g["id"], "A Person", "again")
    with pytest.raises(TraceError):
        ts.reject(f["id"], "A Person", "")


def test_view_counts_validity_and_expiry_warnings(synth_project):
    root, _ = synth_project
    FI.import_folder(root)
    ts = TraceStore(root)
    a = ts.add_draft(owner="SYNTHETIC Power Co", service="electricity", kind="polyline", pts=[[0, 0], [10, 0]], traced_by="A Person", srid=7856)
    ts.add_draft(owner="SYNTHETIC Water Authority", service="water", kind="polyline", pts=[[0, 1], [10, 1]], traced_by="A Person", srid=7856)
    ts.verify(a["id"], "A Person")
    v = load_view(root, today=date(2026, 10, 21))
    assert (v.n_owners, v.n_received, v.n_plans, v.n_draft, v.n_verified) == (4, 3, 2, 1, 1)
    assert v.expiry_warning() is None and v.enquiry_days_left() == 22
    rows = {r[0]: r for r in v.status_rows(upper=False)}
    assert rows["SYNTHETIC Power Co"][3:5] == ("0", "1") and rows["SYNTHETIC Water Authority"][3:5] == ("1", "0")
    assert rows["SYNTHETIC Telecom"][2].startswith("Not received") and "excluded" in rows["SYNTHETIC Telecom"][2]
    near = load_view(root, today=date(2026, 11, 8))
    assert "EXPIRE ON 12/11/2026" in near.expiry_warning()
    gone = load_view(root, today=date(2026, 11, 20))
    assert "EXPIRED ON 12/11/2026" in gone.expiry_warning() and "NEW ENQUIRY" in gone.expiry_warning()
    assert any("expired" in r[5] for r in gone.status_rows(upper=False))
    assert "SYNTHETIC" in " ".join(v.summary_lines())
    assert build_view(None, []) is None


def test_label_of_a_drawn_service_has_owner_plan_date_and_the_location_statement(synth_project):
    root, _ = synth_project
    FI.import_folder(root)
    ts = TraceStore(root)
    a = ts.add_draft(owner="SYNTHETIC Power Co", service="electricity", kind="polyline", pts=[[0, 0], [10, 0]], traced_by="A Person", srid=7856)
    ts.verify(a["id"], "A Person")
    v = load_view(root)
    lab = v.drawn_label(v.verified[0])
    assert lab[0].startswith("SYNTHETIC POWER CO ELECTRICITY") and "15/10/2026" in lab[1] and lab[2] == LABEL_TEXT == "LOCATION INDICATIVE, CONFIRM BY POTHOLING"


# ====================================================================================================== DBYD on the sheets (SYNTHETIC project, Lot 2 coordinates)
FRONT_OFFSET = ((238440.0, 6569532.7), (238458.8, 6569517.8))              # a line 3 m outside the Lot 2 road frontage (SYNTHETIC)


@pytest.fixture(scope="module")
def dbyd_runs(tmp_path_factory):
    root = tmp_path_factory.mktemp("s8_dbyd_proj")
    (root / "BYDA" / "plans").mkdir(parents=True)
    SYN.combined_pdf(root / "BYDA" / "plans" / "SYNTHETIC combined.pdf")
    FI.import_folder(root)
    ts = TraceStore(root)
    elec = ts.add_draft(owner="SYNTHETIC Power Co", service="electricity", kind="polyline", pts=[list(p) for p in FRONT_OFFSET], traced_by="Test Person", srid=7856, page=5)
    ts.add_draft(owner="SYNTHETIC Telecom", service="telecom", kind="polyline", pts=[[238436, 6569535], [238455, 6569520]], traced_by="Test Person", srid=7856)
    draft = _render(tmp_path_factory.mktemp("s8_dbyd_draft"), "--building", str(HOUSE), "--dbyd-project", str(root))
    ts.verify(elec["id"], "Test Person")
    ver = _render(tmp_path_factory.mktemp("s8_dbyd_ver"), "--building", str(HOUSE), "--dbyd-project", str(root))
    return NS(root=root, draft=draft, ver=ver, elec=elec)


def _n_service_lines(run, sheet) -> int:
    """Service linework on a sheet: C-UTIL-* items (JCS-SITE-UTIL-* once coded) in its views."""
    return sum(1 for v in run.sheets[sheet].views for it in v.items if it.kind == "line" and ("UTIL" in it.layer))


def test_draft_services_are_never_drawn(dbyd_runs):
    r = dbyd_runs.draft
    for sh in ("C100", "C310"):
        assert "(EXISTING)" not in r.pages[sh] and "ELECTRICITY" not in r.pages[sh].replace("EXISTING SERVICES", "")
    assert "NONE VERIFIED" in r.pages["C100"] or "NONE VERIFIED" in r.pages["C310"]
    for sh in ("C100", "C310"):
        assert _n_service_lines(r, sh) == 0, sh                                                          # no service linework from a draft trace


def test_status_table_and_counts_are_on_c310_and_c100_even_when_nothing_is_drawn(dbyd_runs):
    t = dbyd_runs.draft.pages["C310"]
    assert "EXISTING SERVICES STATUS (BYDA)" in t and "SYNTHETIC POWER CO" in t and "SYNTHETIC TELECOM" in t and "SYNTHETIC DEMO DATA" in t
    assert "BYDA JOB 99000001" in t and "12/11/2026" in t and "NOT RECEIVED" in t
    assert "EXISTING SERVICES (BYDA)" in dbyd_runs.draft.pages["C100"]


def test_verified_service_is_drawn_with_owner_plan_date_and_location_statement(dbyd_runs):
    r = dbyd_runs.ver
    for sh in ("C100", "C310"):
        t = r.pages[sh]
        assert "SYNTHETIC POWER CO ELECTRICITY (EXISTING)" in t and "PLAN DATE 15/10/2026" in t and LABEL_TEXT in t, sh
    for sh in ("C100", "C310"):
        assert _n_service_lines(r, sh) >= 1, sh                                                          # the verified electricity line (UTIL layer; the telecom draft is not drawn)
        assert _n_service_lines(dbyd_runs.draft, sh) == 0
    assert "SYNTHETIC TELECOM TELECOM (EXISTING)" not in r.pages["C310"]                                  # the unverified telecom draft is still not drawn
    assert "1 VERIFIED" in r.pages["C310"]


def test_sheets_with_dbyd_still_have_no_text_collisions(dbyd_runs):
    for n, sh in dbyd_runs.ver.sheets.items():
        for v in sh.views:
            assert collide.audit(v) == [], (n, v.name, collide.audit(v)[:4])
            assert collide.outside(v) == [], (n, v.name)


def test_cover_services_row_reports_the_byda_state(dbyd_runs):
    c = dbyd_runs.ver.pages["C000"]
    assert "BYDA JOB 99000001" in c and "SYNTHETIC DEMO DATA" in c
    assert "NONE SUPPLIED" not in c


def test_without_a_byda_registry_the_sheets_say_services_are_not_confirmed(lot2):
    assert "NONE SUPPLIED: LOCATE BY BEFORE YOU DIG AUSTRALIA (BYDA)" in lot2.pages["C000"]
    assert re.search(r"EXISTING SERVICES?[^.]{0,80}(NONE SUPPLIED|NOT CONFIRMED)", lot2.pages["C310"], re.I) or "NONE SUPPLIED" in lot2.pages["C310"].upper()
