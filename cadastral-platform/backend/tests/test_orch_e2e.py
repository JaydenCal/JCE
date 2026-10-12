"""End-to-end: the whole DAG through Orchestrator with the REAL agents and mocked external data.

External inputs are synthetic: ArcGIS responses (mock fetcher), a DCP PDF, a site-plan PDF, survey
contours and a DBYD PDF. Needs TEST_DATABASE_URL (skipped otherwise), like the other orch tests.
"""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path

import ezdxf
import pytest
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle
from shapely import wkt as shw
from shapely.geometry import LineString, Polygon

import test_sa4_hydro as sa4t
import test_sa7_pdf_align as sa7t
from app.agents.sa1_cadastre import clients as C
from app.agents.sa2_dcp_rag.ingest import ingest_pdf
from app.agents.sa2_dcp_rag.models import DocMeta
from app.common.contracts import AgentCode, RunStatus
from app.common.db import user_connection
from app.orchestrator.adapters import Sa3Dispatch
from app.orchestrator.core import Orchestrator
from app.orchestrator.inputs import RunRequest
from app.orchestrator.registry import SkippedResult, default_registry
from test_orch_support import ack_all, events, fast_config, invocations, make_project, make_user, pool, dsn, world  # noqa: F401
from test_sa1_cadastre import INV, Mock, fc, zone

BASE = (325000.0, 6265000.0)                      # Hornsby, MGA zone 56
ALL_NODES = {"SA1", "SA7", "SA2", "ENV", "SA3", "SA4", "SA5", "SA6"}


# ------------------------------------------------------------------ synthetic external data
def _sa1_fetcher() -> Mock:
    lot = Polygon([(BASE[0] + x, BASE[1] + y) for x, y in sa7t.LOT_LOCAL])
    ring = [list(INV.transform(x, y)) for x, y in lot.exterior.coords]
    props = {"lotidstring": "12//DP345678", "plan_lot_area": round(lot.area, 1), "lganame": "HORNSBY",
             "suburbname": "HORNSBY"}
    lot_f = {"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [ring]}}
    road = {"type": "Feature", "properties": {"roadname": "Pacific Hwy"}, "geometry": {
        "type": "LineString", "coordinates": [list(INV.transform(BASE[0] - 30, BASE[1] - 6)),
                                              list(INV.transform(BASE[0] + 60, BASE[1] - 6))]}}
    return Mock({"NSW_Cadastre": fc(lot_f), "EPI_Primary": fc(zone(BASE[0] - 10, BASE[1] - 10, 60, 100, "R2")),
                 "roads/0": fc(road)})


def _dcp_pdf(path: Path) -> Path:
    s = getSampleStyleSheet()
    t = Table([["Zone", "Front setback", "Side setback", "Rear setback", "Site coverage"],
               ["R2", "6.0 m", "0.9 m", "6 m", "50%"], ["R3", "4.5 m", "0.9 m", "4 m", "60%"]])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]))
    SimpleDocTemplate(str(path)).build([
        Paragraph("1 Introduction", s["Heading1"]), Paragraph("This plan applies to the Hornsby area. " * 5, s["Normal"]),
        Paragraph("4.1 Setbacks", s["Heading1"]), Paragraph("4.1.2 Front setbacks", s["Heading2"]),
        Paragraph("Table 1 sets minimum setbacks by zone.", s["Normal"]), t])
    return path


def _survey() -> dict:
    """Plane sloping 5% to the south-west (contours every 0.25 m), wider than the lot + 10 m TIN buffer."""
    cs = [{"z": round(100 + 0.05 * (y - (BASE[1] - 15)), 3), "coords": [[BASE[0] - 15, y], [BASE[0] + 40, y]]}
          for y in [BASE[1] - 15 + 5 * i for i in range(0, 11)]]
    return {"srid": 7856, "contours": cs, "source": "synthetic contours", "stated_vertical_accuracy_m": 0.1}


def _dbyd(tmp: Path, monkeypatch) -> dict:
    """DBYD PDF positioned over the lot: water main crossing the frontage, sewer through the lot."""
    monkeypatch.setattr(sa4t, "E0", BASE[0] - 10)
    monkeypatch.setattr(sa4t, "N0", BASE[1] - 5 - 300 * sa4t.S)
    pdf = tmp / "dbyd.pdf"
    sa4t.make_pdf(pdf)
    cps = [[list(p), list(sa4t.mga(*p))] for p in ((100, 100), (500, 100), (100, 700))]
    return {"pdf_path": str(pdf), "control_points": cps, "scale_denominator": sa4t.DEN,
            "outlet_xy": [BASE[0] + 10, BASE[1] + 12],
            "rwt": {"roof_area_m2": 150.0, "rainfall": {"station_id": "066062", "monthly_mm": list(sa4t.RAIN.monthly_mm)},
                    "demand": {"occupants": 4, "garden_area_m2": 0}, "downpipe_xy": [BASE[0] + 4, BASE[1] + 12]}}


# ------------------------------------------------------------------ harness
def _registry(tmp: Path, **kw):
    dcp = _dcp_pdf(tmp / "dcp.pdf")
    chunks, _ = ingest_pdf(dcp, "dcp1")
    docs = [DocMeta(doc_id="dcp1", title="Hornsby DCP (synthetic)", lga="Hornsby", effective_date=date(2024, 1, 1), chunks=chunks)]
    client = C.ArcGISClient(fetcher=_sa1_fetcher(), sleep=lambda s: None)
    env = {"SA1_ROADS_URL_NSW": "http://roads/0", **kw.pop("env", {})}
    return default_registry(env=env, sa1_client=client, sa2_documents=docs, **kw)


def _upload(pool, uid, project, plan) -> str:
    with user_connection(pool, uid) as conn:
        return conn.execute(
            "INSERT INTO plans.plan_uploads (project_id, uploaded_by, original_filename, storage_uri, file_sha256, "
            "byte_size, page_count, content_class, upload_rights_acknowledged) VALUES (%s,%s,'plan.pdf',%s,%s,%s,1,'vector',true) RETURNING upload_id",
            (project, uid, "file://" + str(plan.path), bytes.fromhex(plan.sha), len(plan.data))).fetchone()["upload_id"]


def _run(pool, world, tmp_path, monkeypatch, *, acks=True, with_plan=True, **reg_kw):
    uid, project = world
    if acks:
        ack_all(pool, uid, project)
    monkeypatch.setattr(sa7t, "BASE", BASE)
    plan = sa7t.make_plan(tmp_path)
    params = {"jurisdiction": "NSW", "lotplan": "12//DP345678",
              "terrain": {"survey": _survey(), "pad_level_m": 100.8},
              "dbyd": _dbyd(tmp_path, monkeypatch)}
    req = RunRequest(project_id=project, params=params, upload_id=_upload(pool, uid, project, plan) if with_plan else None)
    orch = Orchestrator(pool, _registry(tmp_path, **reg_kw), fast_config(export_dir=str(tmp_path / "exports")))
    run = orch.create_run(uid, req)
    return orch, run, orch.execute_run(run.run_id, uid), uid




# ------------------------------------------------------------------ tests
def test_registry_wiring():
    reg = default_registry(env={})
    assert isinstance(reg.get(AgentCode.SA3_GEOM_TIN), Sa3Dispatch)
    assert not any(reg.is_stub(c) for c in (AgentCode.SA1_CADASTRE, AgentCode.SA2_DCP_RAG, AgentCode.SA3_GEOM_TIN,
                                            AgentCode.SA4_HYDRO, AgentCode.SA5_CAD_DXF, AgentCode.SA7_PDF_ALIGN))
    assert reg.is_stub(AgentCode.SA6_GLIDE3D)
    with pytest.raises(ValueError):
        default_registry(env={"ORCH_STUB_POLICY": "maybe"})


def test_full_chain_real_agents(pool, world, tmp_path, monkeypatch):
    orch, run, out, uid = _run(pool, world, tmp_path, monkeypatch)
    st = {n: (r.status, r.error_code) for n, r in out.nodes.items()}
    assert set(out.nodes) == ALL_NODES, st
    assert out.status is RunStatus.succeeded, st
    assert all(r.status == "succeeded" for r in out.nodes.values()), st

    o = {n: r.output for n, r in out.nodes.items()}
    lot = o["SA1"]["lot"]
    assert lot["zone_code"] == "R2" and lot["lga_name"] == "HORNSBY" and lot["road_names"] == ["Pacific Hwy"]
    assert o["SA7"]["outcome"] in ("accepted_unverified", "needs_user_confirmation")
    rules = {r["element"]: r["value_numeric"] for r in o["SA2"]["setback_ruleset"]["rules"]}
    assert rules["front"] == 6.0 and rules["side"] == 0.9 and rules["site_cover_max"] == 50.0
    assert o["SA2"]["used_llm"] is False
    env = o["ENV"]["envelope"]
    assert env["setbacks_m"]["front"] == 6.0 and 0 < env["area_m2"] < lot["area_m2_calculated"]
    assert o["ENV"]["driveway"]["crossover_wkt"]
    assert o["SA3"]["cut_fill"]["pad_level_m"] == 100.8 and o["SA3"]["tin"]["triangle_count"] > 0
    assert len(o["SA4"]["assets"]) == 2 and o["SA4"]["rwt"] is not None
    assert {c["kind"] for c in o["SA4"]["connections"]} == {"sewer", "water"}
    assert SkippedResult.model_validate(o["SA6"]).error_code == "NOT_IMPLEMENTED"

    cad = o["SA5"]
    dxf, pdf = Path(cad["dxf_path"]), Path(cad["pdf_path"])
    assert dxf.is_file() and pdf.is_file() and str(dxf).startswith(str(tmp_path / "exports"))
    assert hashlib.sha256(dxf.read_bytes()).hexdigest() == cad["dxf_sha256"]
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == cad["pdf_sha256"]
    assert pdf.read_bytes().startswith(b"%PDF") and not ezdxf.readfile(dxf).audit().errors
    assert cad["annotation_count"] > 0

    inv = invocations(pool, uid, run.run_id)
    assert len(inv) == 8 and all(i["status"] == "succeeded" for i in inv)
    ev = [e["event"] for e in events(pool, uid, run.run_id)]
    assert ev.count("handoff") == 8 and "gate_blocked" not in ev

    # resume = pure idempotency-cache hits, same outputs
    again = orch.execute_run(run.run_id, uid)
    assert again.status is RunStatus.succeeded and all(r.cache_hit for r in again.nodes.values())


def test_export_gate_blocks_sa5_and_writes_nothing(pool, world, tmp_path, monkeypatch):
    _, _, out, uid = _run(pool, world, tmp_path, monkeypatch, acks=False)
    assert out.status is RunStatus.blocked_by_gate
    assert out.nodes["SA5"].status == "blocked_by_gate"
    assert all(out.nodes[n].status == "succeeded" for n in ("SA1", "SA7", "SA2", "ENV", "SA3", "SA4"))
    assert not list((tmp_path / "exports").glob("**/*.dxf")) and not list((tmp_path / "exports").glob("**/*.pdf"))


def test_stub_policy_fail_makes_sa6_fatal_but_exports_still_produced(pool, world, tmp_path, monkeypatch):
    _, _, out, _ = _run(pool, world, tmp_path, monkeypatch, stub_policy="fail")
    assert out.status is RunStatus.failed
    assert out.nodes["SA6"].error_code == "NOT_IMPLEMENTED" and out.nodes["SA5"].status == "succeeded"


def test_no_plan_upload_uses_envelope_as_pad(pool, world, tmp_path, monkeypatch):
    _, _, out, _ = _run(pool, world, tmp_path, monkeypatch, with_plan=False)
    assert "SA7" not in out.nodes and out.status is RunStatus.succeeded, {n: r.error_code for n, r in out.nodes.items()}
    pad = shw.loads(out.nodes["ENV"].output["envelope"]["envelope_wkt"])
    assert out.nodes["SA3"].output["cut_fill"] is not None and pad.area > 0
