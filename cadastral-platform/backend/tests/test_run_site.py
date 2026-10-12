"""scripts/run_site.py dry run with MOCKED HTTP only (synthetic fixture lot from test_sa1_cadastre; not a real site)."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import run_site as RS  # noqa: E402
from test_sa1_cadastre import NSW_LOT, ROAD, Mock, fc, zone  # noqa: E402


def routes():
    geo = json.dumps({"candidates": [{"location": {"x": NSW_LOT["geometry"]["coordinates"][0][0][0],
                                                   "y": NSW_LOT["geometry"]["coordinates"][0][0][1]}}]}).encode()
    return {"GeocodeServer": geo, "NSW_Cadastre": fc(NSW_LOT), "EPI_Primary": fc(zone(324990, 6264990, 60, 80, "R2")), "roads/0": fc(ROAD)}


ENV = {"SA1_ROADS_URL_NSW": "http://roads/0", "SA2_DCP_DOCS": ""}


def args(tmp, **kw):
    a = RS.build_parser().parse_args(["--out", str(tmp)])
    for k, v in kw.items():
        setattr(a, k, v)
    return a


def test_dry_run_shed_reports_unresolved_and_writes_files(tmp_path):
    lines = []
    rep = RS.run_site(args(tmp_path, address="1 Test St Hornsby", development_type="shed", acknowledge=True),
                      env=ENV, fetcher=Mock(routes()), echo=lines.append)
    st = {s.name: s for s in rep.steps}
    assert st["SA1 result"].status == RS.OK and "R2" in st["SA1 result"].detail
    assert st["SA2 DCP rules"].status == RS.UNRESOLVED and "no DCP document" in st["SA2 DCP rules"].detail
    assert st["ENV result"].status == RS.UNRESOLVED and "front" in rep.facts["env_unresolved"]
    assert st["SA3 terrain"].status == RS.SKIPPED
    assert st["SA5 result"].status == RS.OK and st["SA6 scene bundle"].status == RS.UNRESOLVED
    assert st["SA9 constraints report"].status == RS.UNRESOLVED and "NOT CHECKED" in st["SA9 constraints report"].detail
    assert "pathway.shed" in rep.facts["sa9_unresolved_rules"]
    for f in ("plan.dxf", "plan.pdf", "constraints_report.pdf", "constraints_report.json", "scene_bundle.json", "run_summary.md"):
        assert (tmp_path / f).exists(), f
    summary = (tmp_path / "run_summary.md").read_text()
    assert "shed" in summary and "Unresolved" in summary and "unverified" in summary
    assert any("[01]" in l for l in lines)


def test_export_gate_blocked_without_acknowledge(tmp_path):
    rep = RS.run_site(args(tmp_path, address="1 Test St Hornsby"), env=ENV, fetcher=Mock(routes()), echo=lambda s: None)
    sa5 = next(s for s in rep.steps if s.name.startswith("SA5"))
    assert sa5.status == RS.BLOCKED and "EXPORT_GATE_BLOCKED" in sa5.detail and not (tmp_path / "plan.dxf").exists()


def test_sa1_failure_skips_dependents(tmp_path):
    def down(url, params):
        raise ConnectionError("blocked")
    rep = RS.run_site(args(tmp_path, lotplan="12//DP345678"), env=ENV, fetcher=down, echo=lambda s: None)
    assert [s.status for s in rep.steps[:2]] == [RS.OK, RS.FAILED] and all(s.status == RS.SKIPPED for s in rep.steps[2:])
    assert (tmp_path / "run_summary.md").exists()


def test_random_lot_vacancy_never_claimed_without_buildings_layer(tmp_path):
    rep = RS.run_site(args(tmp_path, random_vacant=True, centre="151.1,-33.7", seed=1, lga="HORNSBY"), env=ENV,
                      fetcher=Mock(routes()), echo=lambda s: None)
    assert rep.facts["vacancy"] == "UNVERIFIED" and "cannot be determined from the cadastre" in rep.steps[0].detail
    assert "UNVERIFIED" in (tmp_path / "run_summary.md").read_text()


def test_random_lot_with_buildings_layer(tmp_path):
    r = routes() | {"bld/0": fc()}
    rep = RS.run_site(args(tmp_path, random_vacant=True, centre="151.1,-33.7", seed=1, lga="HORNSBY", buildings_url="http://bld/0"),
                      env=ENV, fetcher=Mock(r), echo=lambda s: None)
    assert rep.facts["vacancy"] == "no_building_footprint"
    r = routes() | {"bld/0": fc(NSW_LOT)}
    rep = RS.run_site(args(tmp_path, random_vacant=True, centre="151.1,-33.7", lga="HORNSBY", buildings_url="http://bld/0"),
                      env=ENV, fetcher=Mock(r), echo=lambda s: None)
    assert rep.steps[0].status == RS.FAILED and "NO_VACANT_LOT" in rep.steps[0].detail


def test_check_network_reports_each_host():
    def f(url, params):
        if "six.nsw" in url:
            return b"{}", None
        if "mapprod3" in url:
            raise urllib.error.HTTPError(url, 403, "no", {}, None)       # host answered
        raise ConnectionError("sandbox")
    lines = []
    res = RS.check_network({}, f, "http://bld.example/0", echo=lines.append)
    assert res["maps.six.nsw.gov.au"][0] and res["mapprod3.environment.nsw.gov.au"] == (True, "HTTP 403")
    assert res["bld.example"][0] is False and any("UNREACHABLE" in l for l in lines)
