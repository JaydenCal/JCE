"""Platform default profile (stage 2B): status, stamp, resolution order, knowledge loading, loader row building. No database."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.requirements.models import (EXTRA_KEY_HELP, PLATFORM_DEFAULT_STAMP, Requirement, RequirementSet, Selectors,  # noqa: E402
                                            Source, UnresolvedRequirement, key_help)
from app.agents.requirements.lgacode import same_lga  # noqa: E402
from app.agents.requirements.models import (STAMP_LGA_RULE_NOT_LOADED, STAMP_LGA_VALUE_NOT_FOUND,  # noqa: E402
                                            STAMP_LGA_VALUE_UNRESOLVED)
from app.report import knowledge as K  # noqa: E402
from scripts import load_requirements as LR  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]
DEFAULTS = json.loads((BACKEND / "knowledge/platform_default/requirements.json").read_text())


def default_set() -> RequirementSet:
    return RequirementSet(requirements=[Requirement.model_validate(r) for r in DEFAULTS["requirements"]])


def cited(key, value, unit=None, **sel):
    return Requirement(key=key, applies_to=Selectors(**sel), value=value, unit=unit, status="resolved", extraction_method="llm", confidence=0.8,
                       source=Source(document_title="Test DCP", authority="Test Council", page=3, section_ref="4.1", quote="q", sha256="ab"))


def test_stamp_constant():
    assert PLATFORM_DEFAULT_STAMP == "PLATFORM DEFAULT, LGA RULE NOT LOADED"


def test_profile_file_contents():
    assert DEFAULTS["stamp"] == PLATFORM_DEFAULT_STAMP
    rows = DEFAULTS["requirements"]
    assert {(r["key"], r["applies_to"]["jurisdiction"]) for r in rows} == {
        (k, s) for k in ("stormwater.osd_required", "stormwater.psd_l_s") for s in ("NSW", "QLD")}
    for r in rows:
        assert r["status"] == "platform_default" and r["extraction_method"] == "platform_default"
        assert r["source"]["document_title"] == "Owner decision D3, docs/14-3d-site-design-tools.md, 14/10/2026"
        assert r["source"]["authority"] == "JCESITE platform default profile"
        assert r["source"]["effective_date"] == "2026-10-14" and r["applies_to"]["lga"] is None
    assert {r["key"]: r["value"] for r in rows} == {"stormwater.osd_required": True, "stormwater.psd_l_s": 2.0}
    assert all(r["unit"] == "L/s" for r in rows if r["key"] == "stormwater.psd_l_s")
    text = json.dumps(rows)
    assert "Jayden" not in text and "JCE Infrastructure" not in text and "Callen" not in text


@pytest.mark.parametrize("state", ["NSW", "QLD"])
def test_default_resolves_stamped_and_usable(state):
    rs = default_set()
    psd = rs.get_requirement("stormwater.psd_l_s", jurisdiction=state, lga=f"{state.lower()}-anywhere")
    assert psd.value == 2.0 and psd.unit == "L/s" and psd.usable and psd.is_platform_default
    assert psd.stamp == STAMP_LGA_RULE_NOT_LOADED == PLATFORM_DEFAULT_STAMP and PLATFORM_DEFAULT_STAMP in psd.describe() and psd.describe().startswith("2 L/s")
    assert PLATFORM_DEFAULT_STAMP in psd.citation() and "14/10/2026" in psd.citation()
    osd = rs.get_requirement("stormwater.osd_required", jurisdiction=state)
    assert osd.value is True and osd.describe().startswith("yes") and osd.is_platform_default


def test_default_needs_a_known_matching_jurisdiction():
    rs = default_set()
    with pytest.raises(UnresolvedRequirement):                           # no jurisdiction at all: the default cannot be chosen
        rs.get_requirement("stormwater.psd_l_s")
    with pytest.raises(UnresolvedRequirement):                           # an lga alone does not give a jurisdiction
        rs.get_requirement("stormwater.psd_l_s", lga="Gunnedah")
    assert rs.get_requirement("stormwater.psd_l_s", jurisdiction="qld").value == 2.0
    assert rs.get_requirement("stormwater.psd_l_s", jurisdiction="QLD").applies_to.jurisdiction == "QLD"


def test_default_not_applied_outside_nsw_qld():
    with pytest.raises(UnresolvedRequirement):
        default_set().get_requirement("stormwater.psd_l_s", jurisdiction="CUSTOM")


def test_osd_method_and_ssr_stay_unresolved():
    rs = default_set()
    for k in ("stormwater.osd_method", "stormwater.ssr_m3"):
        with pytest.raises(UnresolvedRequirement) as ei:
            rs.get_requirement(k, jurisdiction="NSW", lga="nsw-gunnedah")
        assert k in str(ei.value) and "please supply" in ei.value.prompt
    assert "OSD" in key_help("stormwater.osd_method") and "site storage" in key_help("stormwater.ssr_m3")
    assert {"stormwater.osd_required", "stormwater.psd_l_s", "stormwater.osd_method", "stormwater.ssr_m3"} <= set(EXTRA_KEY_HELP)


def test_lga_value_wins_over_default():
    rs = default_set()
    rs.add(cited("stormwater.psd_l_s", 5.0, "L/s", jurisdiction="NSW", lga="Gunnedah"))
    r = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-gunnedah")
    assert r.value == 5.0 and not r.is_platform_default and r.stamp is None and "Test DCP" in r.citation()
    other = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-narrabri")
    assert other.value == 2.0 and other.is_platform_default             # another LGA still gets the default


def test_state_wide_wins_over_default_and_lga_over_state():
    rs = default_set()
    rs.add(cited("stormwater.psd_l_s", 7.0, "L/s", jurisdiction="NSW"))
    assert rs.get("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-x") == 7.0
    rs.add(cited("stormwater.psd_l_s", 4.0, "L/s", jurisdiction="NSW", lga="X"))
    assert rs.get("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-x") == 4.0
    assert rs.get("stormwater.psd_l_s", jurisdiction="QLD") == 2.0       # QLD untouched


def test_user_confirmed_wins_over_everything():
    rs = default_set()
    rs.add(cited("stormwater.psd_l_s", 4.0, "L/s", jurisdiction="NSW", lga="X"))
    u = Requirement(key="stormwater.psd_l_s", applies_to=Selectors(jurisdiction="NSW"), value=1.5, unit="L/s", status="user_confirmed",
                    extraction_method="user_entered", source=Source(entered_by="jayden", document_title="user entry"))
    rs.add(u)
    r = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-x")
    assert r.value == 1.5 and r.status == "user_confirmed"


def test_unresolved_lga_entry_lets_default_apply_with_its_own_stamp_and_conflict_still_raises():
    rs = default_set()
    rs.add(Requirement(key="stormwater.psd_l_s", applies_to=Selectors(jurisdiction="NSW", lga="X"), status="unresolved", prompt="not found",
                       notes="Looked in: DCP 2025"))
    r = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="X")
    assert r.is_platform_default and r.value == 2.0 and r.stamp == STAMP_LGA_VALUE_UNRESOLVED == "PLATFORM DEFAULT, LGA VALUE UNRESOLVED"
    assert r.lga_entry_prompt == "not found" and r.lga_entry_notes == "Looked in: DCP 2025"
    assert STAMP_LGA_VALUE_UNRESOLVED in r.describe() and STAMP_LGA_VALUE_UNRESOLVED in r.citation()
    assert r.to_db_row()["default_stamp"] == STAMP_LGA_VALUE_UNRESOLVED
    other = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="Y")      # the entry belongs to LGA X only
    assert other.stamp == STAMP_LGA_RULE_NOT_LOADED and other.lga_entry_prompt is None
    rs.add(Requirement(key="stormwater.psd_l_s", applies_to=Selectors(jurisdiction="NSW", lga="X"), status="conflict", prompt="two documents disagree"))
    with pytest.raises(UnresolvedRequirement, match="two documents disagree"):                          # a documented conflict is raised, never defaulted
        rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="X")
    rs2 = default_set()
    rs2.add(cited("stormwater.psd_l_s", 3.0, "L/s", jurisdiction="NSW", lga="X"))
    rs2.add(cited("stormwater.psd_l_s", 6.0, "L/s", jurisdiction="NSW", lga="X"))
    with pytest.raises(UnresolvedRequirement):                           # equal specificity, different values: still a conflict
        rs2.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="X")


def test_default_stamp_says_why_it_applies():
    rs = default_set()
    assert rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-foo").stamp == "PLATFORM DEFAULT, LGA RULE NOT LOADED"
    rs.add(cited("stormwater.osd_method", "Foo table", None, jurisdiction="NSW", lga="Foo"))        # Foo's rules are loaded, no PSD row
    r = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-foo")
    assert r.stamp == "PLATFORM DEFAULT, LGA VALUE NOT FOUND" == STAMP_LGA_VALUE_NOT_FOUND and r.value == 2.0
    assert "LGA VALUE NOT FOUND" in r.describe()
    assert rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-bar").stamp == STAMP_LGA_RULE_NOT_LOADED     # Bar has no rules
    assert rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW").stamp == STAMP_LGA_RULE_NOT_LOADED               # no LGA given
    assert rs.get_requirement("stormwater.osd_method", jurisdiction="NSW", lga="Foo").stamp is None                      # cited: no stamp


def test_lga_isolation_and_state_compare():
    rs = default_set()
    rs.add(cited("driveway.min_width_m", 3.0, "m", jurisdiction="NSW", lga="Gunnedah"))
    assert rs.get("driveway.min_width_m", jurisdiction="NSW", lga="nsw-gunnedah") == 3.0
    for sel in ({}, {"jurisdiction": "NSW"}, {"lga": "Narrabri"}, {"jurisdiction": "QLD", "lga": "qld-gunnedah"}, {"lga": "qld-gunnedah"}):
        with pytest.raises(UnresolvedRequirement):                      # an LGA row never answers for a caller without a matching LGA
            rs.get_requirement("driveway.min_width_m", **sel)
    assert same_lga("nsw-gunnedah", "Gunnedah Shire Council") and not same_lga("qld-gunnedah", "nsw-gunnedah")
    assert same_lga("Gunnedah", "qld-gunnedah") and not same_lga("Gunnedah", "qld-gunnedah", "NSW", None)
    assert not same_lga("Gunnedah", "Gunnedah", "NSW", "QLD")
    # the state-wide cited value still answers every LGA of its state, with or without an LGA in the call
    rs.add(cited("driveway.max_width_m", 5.0, "m", jurisdiction="NSW"))
    assert rs.get("driveway.max_width_m", jurisdiction="NSW", lga="nsw-anywhere") == 5.0 and rs.get("driveway.max_width_m") == 5.0


def test_platform_default_is_not_unresolved_but_is_listed_in_citations():
    rs = default_set()
    assert rs.unresolved() == [] and len(rs.citations()) == 4


def test_existing_gunnedah_values_unchanged():
    rs = K.load_requirement_set("Gunnedah")
    assert rs.get("driveway.min_width_m", lga="Gunnedah") == 3.0
    assert rs.get("driveway.min_width_m", jurisdiction="NSW", lga="nsw-gunnedah") == 3.0
    r = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-gunnedah")
    assert r.is_platform_default and r.stamp == STAMP_LGA_VALUE_NOT_FOUND   # Gunnedah rules are loaded; no Gunnedah PSD row exists yet
    assert rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-narrabri").stamp == STAMP_LGA_RULE_NOT_LOADED
    with pytest.raises(UnresolvedRequirement):                           # Gunnedah rows do not leak to a caller with no or another LGA
        rs.get("driveway.min_width_m")
    with pytest.raises(UnresolvedRequirement):
        rs.get("driveway.min_width_m", jurisdiction="QLD", lga="qld-gunnedah")
    with pytest.raises(UnresolvedRequirement):
        rs.get_requirement("stormwater.osd_method", jurisdiction="NSW", lga="nsw-gunnedah")


# ---------------------------------------------------------------- knowledge loader keying
def _write(folder: Path, rows: list[dict]):
    folder.mkdir(parents=True)
    (folder / "requirements.json").write_text(json.dumps({"requirements": rows}))


def lga_row(key, value, name="Foo"):
    return json.loads(cited(key, value, "L/s", jurisdiction="NSW", lga=name).model_dump_json())


def test_loader_prefers_lga_code_folder_and_falls_back_to_legacy_name(tmp_path):
    _write(tmp_path / "nsw-foo", [lga_row("a.b", 1.0)])
    _write(tmp_path / "bar_baz", [lga_row("a.b", 2.0, "Bar Baz")])
    assert K.lga_dir("Foo Shire Council", "NSW", tmp_path).name == "nsw-foo"
    assert K.lga_dir("nsw-foo", None, tmp_path).name == "nsw-foo"
    assert K.lga_dir("Bar Baz", None, tmp_path).name == "bar_baz"          # legacy lowercase name folder still loads
    assert K.load_requirements("Foo", tmp_path, state="NSW")[0][0]["value"] == 1.0
    assert K.load_requirements("Bar Baz", tmp_path)[0][0]["value"] == 2.0
    assert K.load_requirements("Nowhere", tmp_path) == ([], [])


def test_unresolved_json_entries_are_loaded_as_lga_entries(tmp_path):
    _write(tmp_path / "nsw-foo", [lga_row("a.b", 1.0)])
    (tmp_path / "nsw-foo" / "unresolved.json").write_text(json.dumps([
        {"key": "stormwater.psd_l_s / stormwater.osd_method", "reason": "DCP not obtained", "looked": ["DCP 2025 s4"]},
        {"key": "flood.*", "reason": "no flood data"}]))
    (tmp_path / "platform_default").mkdir()
    (tmp_path / "platform_default" / "requirements.json").write_text(json.dumps(DEFAULTS))
    rs = K.load_requirement_set("Foo", tmp_path, state="NSW")
    r = rs.get_requirement("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-foo")
    assert r.stamp == STAMP_LGA_VALUE_UNRESOLVED and r.lga_entry_prompt == "DCP not obtained" and "DCP 2025 s4" in r.lga_entry_notes
    with pytest.raises(UnresolvedRequirement, match="DCP not obtained"):
        rs.get_requirement("stormwater.osd_method", jurisdiction="NSW", lga="nsw-foo")
    with pytest.raises(UnresolvedRequirement, match="no flood data"):
        rs.get_requirement("flood.fpl", jurisdiction="NSW", lga="nsw-foo")
    assert rs.get_requirement("stormwater.osd_required", jurisdiction="NSW", lga="nsw-foo").stamp == STAMP_LGA_VALUE_NOT_FOUND


def test_underscore_slug_folder_candidates(tmp_path):
    assert "mid_western" in K.lga_dir_candidates("Mid-Western Regional")
    assert "mid_western" in K.lga_dir_candidates("Mid-Western Regional Council", "NSW")
    _write(tmp_path / "mid_western", [lga_row("a.b", 2.0, "Mid-Western Regional")])
    assert K.lga_dir("Mid-Western Regional", "NSW", tmp_path).name == "mid_western"


def test_legacy_gunnedah_folder_still_loads():
    reqs, _ = K.load_requirements("Gunnedah")
    assert len(reqs) == 113
    assert len(K.load_requirements("GUNNEDAH", state="NSW")[0]) == 113


def test_platform_default_loaded_underneath(tmp_path):
    _write(tmp_path / "nsw-foo", [lga_row("stormwater.psd_l_s", 5.0)])
    (tmp_path / "platform_default").mkdir()
    (tmp_path / "platform_default" / "requirements.json").write_text(json.dumps(DEFAULTS))
    plain, _ = K.load_requirements("Foo", tmp_path, state="NSW")
    assert [r["status"] for r in plain] == ["resolved"]                    # off by default: the council report never lists defaults
    layered, _ = K.load_requirements("Foo", tmp_path, state="NSW", include_platform_default=True)
    assert [r["status"] for r in layered] == ["platform_default"] * 4 + ["resolved"]      # defaults first (underneath)
    assert K.load_requirements(None, tmp_path, include_platform_default=True)[0] == layered[:4]
    rs = K.load_requirement_set("Foo", tmp_path, state="NSW")
    assert rs.get("stormwater.psd_l_s", jurisdiction="NSW", lga="nsw-foo") == 5.0       # LGA overrides
    assert rs.get_requirement("stormwater.osd_required", jurisdiction="NSW", lga="nsw-foo").is_platform_default


# ---------------------------------------------------------------- loader row building (no DB)
def test_build_row_platform_default():
    row = LR.build_row(DEFAULTS["requirements"][0])
    assert set(row) == set(LR.COLUMNS)
    assert row["status"] == "platform_default" and row["extraction_method"] == "platform_default"
    assert row["default_stamp"] == PLATFORM_DEFAULT_STAMP and row["default_profile"] == "JCESITE platform default profile"
    assert row["lga_code"] is None and row["value_json"] is True and row["doc_title"].startswith("Owner decision D3")


def test_build_row_lga_code_and_struct_kept():
    r = cited("setback.x_m", 6.5, "m", jurisdiction="NSW", lga="Gunnedah Shire Council")
    raw = json.loads(r.model_dump_json())
    raw["value_struct"] = {"rule": "6.5 m or average"}
    row = LR.build_row(raw)
    assert row["lga_code"] == "nsw-gunnedah" and row["default_stamp"] is None and row["default_profile"] is None
    assert row["value_json"] == {"value": 6.5, "struct": {"rule": "6.5 m or average"}}
    state_wide = LR.build_row(json.loads(cited("a.b", 1.0, "m", jurisdiction="NSW").model_dump_json()))
    assert state_wide["lga_code"] is None


def test_build_row_rejects_uncited_value_and_bad_default():
    raw = json.loads(cited("a.b", 1.0, jurisdiction="NSW", lga="X").model_dump_json())
    raw["source"]["quote"] = ""
    with pytest.raises(LR.RowError, match="citation"):
        LR.build_row(raw)
    d = dict(DEFAULTS["requirements"][0], extraction_method="llm")
    with pytest.raises(LR.RowError, match="platform_default"):
        LR.build_row(d)
    with pytest.raises(LR.RowError):
        LR.build_row(dict(DEFAULTS["requirements"][0], status="unresolved"))


def test_user_entered_row_needs_no_quote():
    r = Requirement(key="a.b", applies_to=Selectors(jurisdiction="NSW", lga="X"), value=2.0, status="user_confirmed", extraction_method="user_entered",
                    source=Source(entered_by="jayden", document_title="user entry"))
    assert LR.build_row(json.loads(r.model_dump_json()))["status"] == "user_confirmed"


def test_build_rows_skips_unresolved_with_note():
    raw_ok = json.loads(cited("a.b", 1.0, jurisdiction="NSW", lga="X").model_dump_json())
    raw_un = {"key": "c.d", "status": "unresolved", "prompt": "find it"}
    rows, notes = LR.build_rows({"requirements": [raw_ok, raw_un, raw_un]})
    assert len(rows) == 1 and notes == ["2 row(s) with status unresolved not loaded"]


def test_all_shipped_knowledge_rows_build():
    rows, _ = LR.build_rows(json.loads((BACKEND / "knowledge/gunnedah/requirements.json").read_text()))
    assert len(rows) == 113 and sum(r["lga_code"] == "nsw-gunnedah" for r in rows) == 91 and sum(r["lga_code"] is None for r in rows) == 22


def test_upsert_sql_targets():
    d = LR.upsert_sql(LR.build_row(DEFAULTS["requirements"][0]))
    assert "ON CONFLICT (requirement_key, applies_to, default_profile) WHERE status = 'platform_default'" in d
    c = LR.upsert_sql(LR.build_row(json.loads(cited("a.b", 1.0, jurisdiction="NSW", lga="X").model_dump_json())))
    assert "COALESCE(file_sha256, '')" in c and "status IN ('resolved','user_confirmed')" in c
    assert c.count("%(") == len(LR.COLUMNS)


def test_discover_and_dry_run(tmp_path, capsys, monkeypatch):
    kd = BACKEND / "knowledge"
    files = LR.discover(kd, None, True, True)
    assert files[0].parent.name == "platform_default" and kd / "gunnedah/requirements.json" in files
    assert not any(f.parent.name in LR.NOT_LGA_FOLDERS - {"platform_default"} for f in files)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert LR.main(["--all", "--dry-run"]) == 0                           # no database needed
    out = capsys.readouterr().out
    assert "stormwater.psd_l_s" in out and PLATFORM_DEFAULT_STAMP in out and "dry run, nothing written" in out
    with pytest.raises(SystemExit):                                       # a real load without a DSN refuses
        LR.load(LR.discover(kd, None, False, True), None, False, echo=lambda s: None)


def test_migration_text():
    sql = (BACKEND.parent / "db/007_platform_default.sql").read_text()
    for needle in ("'platform_default'", "ADD COLUMN IF NOT EXISTS lga_code", "default_profile", "'PLATFORM DEFAULT%'", "requirements_citation_check",
                   "ux_requirements_platform_default"):
        assert needle in sql
    code = "\n".join(l.split("--")[0] for l in sql.splitlines())                 # statements only, comments removed
    assert "UPDATE" not in code and "regexp_replace" not in code                # lga_code is set by the loader, not by SQL
    assert "ADD COLUMN lga_code" not in code and "CREATE INDEX ix_" not in code and "CREATE UNIQUE INDEX ux_" not in code
    assert code.count("CREATE INDEX IF NOT EXISTS") == 1 and code.count("CREATE UNIQUE INDEX IF NOT EXISTS") == 1
    for name in ("requirements_status_check", "requirements_extraction_method_check", "requirements_citation_check",
                 "requirements_platform_default_shape_check"):
        assert f"DROP CONSTRAINT IF EXISTS {name}" in code and f"ADD CONSTRAINT {name}" in code      # guarded drop, then add
    assert sql.count("ADD CONSTRAINT") == 4 and sql.count("DROP CONSTRAINT IF EXISTS") == 4
    assert code.index("DROP CONSTRAINT IF EXISTS") < code.index("ADD CONSTRAINT")

