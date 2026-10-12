"""Pack assembler: ZIP index, checklist, manifest sha256, UI JSON; sample packs from real test-run outputs."""
import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from app.pack.assemble import PackDoc, PackProject, assemble_pack, build_checklist, load_checklists
from app.pack.samples import ROOT, build_sample_pack


def _needs(run):
    if not (ROOT / run / "constraints_report.json").exists():
        pytest.skip("test-run outputs not present")


def test_checklists_have_council_citations():
    data = load_checklists()
    assert data["council"] == "Gunnedah Shire Council" and not data["failed_validation"]
    for it in data["checklists"]:
        assert it["citation"] and it["citation"]["quote"] and it["citation"]["sha256"], it["id"]
    for g in data["lodgement_guidance"]:
        assert g["citation"] and g["citation"]["quote"], g["text"]
    assert any("NSW Planning Portal" in g["text"] for g in data["lodgement_guidance"])


def test_checklist_keyed_to_pathway_and_evidence():
    p = PackProject(project_name="t", pathway="da", dev_type="dwelling_house", storeys=1, docs=[PackDoc(kind="site_plan", title="Site", path="x.pdf"), PackDoc(kind="escp", title="ESCP", path="e.pdf")])
    rows = {r.id: r for r in build_checklist(p)}
    assert rows["da.site_plan"].status == "present" and rows["da.floor_plan"].status == "missing"
    assert rows["da.escp"].status == "present" and rows["da.escp"].requirement == "may_be_required"
    assert rows["da.shadow"].status == "not_applicable"                        # single storey
    assert rows["da.eis"].status == "not_applicable" and rows["da.flood"].status == "not_applicable"
    p2 = p.model_copy(update={"storeys": 2, "flood_affected": True, "dev_type": "shed"})
    r2 = {r.id: r for r in build_checklist(p2)}
    assert r2["da.shadow"].status == "missing" and r2["da.flood"].status == "missing" and "da.basix" not in r2      # BASIX only for dwellings
    cdc = {r.id: r for r in build_checklist(p.model_copy(update={"pathway": "cdc"}))}
    assert "cdc.specs" in cdc and "da.soee" not in cdc and cdc["cdc.site_plan"].status == "present"
    ex = build_checklist(p.model_copy(update={"pathway": "exempt"}))
    assert [r.status for r in ex] == ["not_applicable"]


def test_assemble_zip_index_manifest_and_ui_json(tmp_path):
    f1 = tmp_path / "site.pdf"; f1.write_bytes(b"%PDF-1.4 site")
    f2 = tmp_path / "extra.txt"; f2.write_text("owner consent")
    proj = PackProject(project_name="Synthetic", lotplan="1//DP1", pathway="da", dev_type="dwelling_house",
                       docs=[PackDoc(kind="site_plan", title="Site plan", path=str(f1)), PackDoc(kind="owner_consent", title="Owner consent", path=str(f2))])
    res = assemble_pack(proj, tmp_path / "out")
    z = zipfile.ZipFile(res.zip_path)
    names = z.namelist()
    assert names[:3] == ["00_cover_sheet.pdf", "01_index_and_checklist.pdf", "02_lodgement_guidance.pdf"]
    assert "manifest.json" in names and "pack.json" in names
    man = json.loads(z.read("manifest.json"))
    for m in man["files"]:
        assert hashlib.sha256(z.read(m["file"])).hexdigest() == m["sha256"]
    assert {m["number"] for m in man["files"]} >= {"00", "01", "02", "10", "11"}
    ui = json.loads(z.read("pack.json"))
    st = {r["id"]: r["status"] for r in ui["checklist"]}
    assert st["da.site_plan"] == "present" and st["da.owner_consent"] == "present" and st["da.soee"] == "missing"
    assert ui["lodgement_guidance"] and ui["checklist_counts"]["missing"] >= 5
    import fitz
    idx = "".join(p.get_text() for p in fitz.open(stream=z.read("01_index_and_checklist.pdf"), filetype="pdf"))
    assert "10_site.pdf" in idx and "Submission checklist" in idx and "Landowner" in idx
    guid = "".join(p.get_text() for p in fitz.open(stream=z.read("02_lodgement_guidance.pdf"), filetype="pdf"))
    assert "NSW Planning Portal" in guid and "Source:" in guid


def test_missing_user_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        assemble_pack(PackProject(project_name="x", docs=[PackDoc(kind="site_plan", title="s", path=str(tmp_path / "nope.pdf"))]), tmp_path / "o")


@pytest.mark.parametrize("run", ["lot2_dwelling", "quia_granny"])
def test_sample_pack_from_real_outputs(run, tmp_path):
    _needs(run)
    res = build_sample_pack(run, tmp_path / f"pack_{run}")
    z = zipfile.ZipFile(res.zip_path)
    names = z.namelist()
    assert any(n.endswith("SoEE_draft.docx") for n in names) and any(n.endswith("plan.pdf") for n in names) and any("compliance_table.pdf" in n for n in names)
    ui = json.loads(z.read("pack.json"))
    assert ui["pathway_check"]["recommendation"].startswith("May apply: verify with council or a certifier")
    assert ui["checklist_counts"]["present"] >= 2 and ui["compliance_counts"]["UNRESOLVED"] > 0
    import fitz
    soee = "".join(p.get_text() for p in fitz.open(stream=z.read([n for n in names if n.endswith("SoEE_draft.pdf")][0]), filetype="pdf"))
    assert "TO BE COMPLETED" in soee
