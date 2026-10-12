"""Application pack assembler: ZIP with numbered index, submission checklist keyed to pathway and council, cover sheet, sha256 manifest, UI JSON.

Checklist items come from knowledge/pathway/checklists.json (the council's own checklists, each with a citation).  An item is
'present' only when a supplied file is mapped to its evidence kind; otherwise 'missing' (or 'not_applicable').  Presence of a file is not a
statement that it is adequate.  The pack is a drafting/lodgement aid and not an approval.
"""
from __future__ import annotations

import hashlib
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.agents.requirements.models import Source

from .compliance import ComplianceTable
from app.agents.sa11_pathway.models import PathwayResult, Status

CHECKLISTS = Path(__file__).resolve().parents[2] / "knowledge" / "pathway" / "checklists.json"
DISCLAIMER = ("This application pack was assembled as a drafting and lodgement aid. Nothing in it is a planning, complying development or building approval. "
              "Documents must be reviewed and adopted by suitably qualified persons, and the council or a certifier determines the application.")


class M(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class PackDoc(M):
    """A file supplied to the pack. `kind` is the evidence kind it satisfies (site_plan, floor_plan, elevations, section_plans, soee, escp, basix, ...)."""
    kind: str
    title: str
    path: str
    note: str = ""


class PackProject(M):
    project_name: str
    lotplan: str | None = None
    address: str | None = None
    council: str = "Gunnedah Shire Council"
    pathway: Literal["da", "cdc", "exempt"] = "da"
    dev_type: str = "dwelling_house"
    storeys: float | None = None
    flood_affected: bool | None = None
    bushfire_prone: bool | None = None
    docs: list[PackDoc] = Field(default_factory=list)
    compliance: ComplianceTable | None = None
    pathway_result: PathwayResult | None = None
    prepared_for: str | None = None


class ChecklistRow(M):
    id: str
    label: str
    requirement: str
    status: Literal["present", "missing", "not_applicable"]
    evidence: list[str] = Field(default_factory=list)
    files: list[str] = Field(default_factory=list)
    note: str = ""
    citation: Source | None = None


class PackResult(M):
    zip_path: str
    ui_json_path: str
    files: list[dict]
    checklist: list[ChecklistRow]
    guidance: list[dict]
    counts: dict[str, int]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def load_checklists(path: str | Path | None = None) -> dict:
    return json.loads(Path(path or CHECKLISTS).read_text())


def build_checklist(project: PackProject, data: dict | None = None) -> list[ChecklistRow]:
    data = data or load_checklists()
    have = {d.kind: d for d in project.docs}
    rows: list[ChecklistRow] = []
    for it in data["checklists"]:
        if it["pathway"] != project.pathway or project.dev_type not in it["dev_types"]:
            continue
        req, st, note = it["requirement"], None, it.get("note", "")
        ap, na = it.get("applies", {}), it.get("na_if", {})
        st_ = project.storeys
        if na.get("always") or (na.get("storeys_lt") is not None and st_ is not None and st_ < na["storeys_lt"]):
            st = "not_applicable"
        if "storeys_ge" in ap and st_ is None and st is None:
            req, note = "may_be_required", (note + " Storeys not supplied.").strip()
        if "flood" in ap and project.flood_affected is not True:
            st = "not_applicable"; note = (note + " SA9 flood layer: not affected / not checked.").strip()
        if "bushfire" in ap and project.bushfire_prone is not True:
            st = "not_applicable"; note = (note + " SA9 bushfire layer: not mapped / not checked.").strip()
        files = [have[k].path for k in it["evidence"] if k in have]
        if st is None:
            st = "present" if files else "missing"
        c = it.get("citation")
        rows.append(ChecklistRow(id=it["id"], label=it["label"], requirement=req, status=st, evidence=it["evidence"], files=[Path(f).name for f in files],
                                 note=note, citation=Source(**c) if c else None))
    return rows


# ---------------------------------------------------------------------------------------------------------------------
def _pdf(path: Path, title: str, blocks: list[tuple[str, Any]], *, landscape: bool = False) -> None:
    from xml.sax.saxutils import escape
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape as ls
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ss = getSampleStyleSheet(); small = ss["BodyText"].clone("sm", fontSize=7.5, leading=9)
    size = ls(A4) if landscape else A4
    doc = SimpleDocTemplate(str(path), pagesize=size, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm, title=title)
    E: list = [Paragraph(escape(title), ss["Title"])]
    for kind, val in blocks:
        if kind == "h":
            E.append(Paragraph(escape(val), ss["Heading2"]))
        elif kind == "p":
            E.append(Paragraph(escape(val), ss["BodyText"]))
        elif kind == "s":
            E.append(Paragraph(escape(val), small))
        elif kind == "t":
            widths, rows = val
            data = [[Paragraph(escape(str(c)), small) for c in r] for r in rows]
            t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
            t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            E += [t, Spacer(1, 6)]
    doc.build(E, onFirstPage=lambda c, d: c.setFont("Helvetica", 7) or c.drawString(15 * mm, 8 * mm, "Drafting aid, not an approval"),
              onLaterPages=lambda c, d: c.setFont("Helvetica", 7) or c.drawString(15 * mm, 8 * mm, "Drafting aid, not an approval"))


def compliance_pdf(table: ComplianceTable, path: Path) -> None:
    rows = [["Control", "Requirement (document, page, quote)", "Proposed", "Status", "Variation / prompt"]]
    for r in table.rows:
        req = r.requirement_text + (f"  [{r.citation.document_title}, p.{r.citation.page}: \"{r.citation.quote[:140]}\"]" if r.citation else "")
        rows.append([r.control, req, "" if r.proposed_value is None else str(r.proposed_value), r.status.value.replace("_", " "), r.variation_note or r.prompt or ""])
    n = table.counts()
    _pdf(path, f"Compliance table ({table.pathway.upper()}): {table.dev_type}, zone {table.zone}", [
        ("p", f"PASS {n['PASS']}, FAIL {n['FAIL']}, UNRESOLVED {n['UNRESOLVED']}, NOT APPLICABLE {n['NOT_APPLICABLE']}. PASS and FAIL come only from a numeric comparison of a cited requirement with a supplied proposed value."),
        ("t", ([42, 95, 28, 22, 85], rows))] + [("s", x) for x in table.notes], landscape=True)


def assemble_pack(project: PackProject, out_dir: str | Path, *, zip_name: str = "application_pack.zip", checklists: dict | None = None) -> PackResult:
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    data = checklists or load_checklists()
    stage = out / "_stage"
    if stage.exists():
        for p in stage.rglob("*"):
            if p.is_file(): p.unlink()
    stage.mkdir(exist_ok=True)
    entries: list[dict] = []     # {number, name, title, kind, src}

    def add(num: str, title: str, kind: str, src: Path, arcname: str | None = None) -> None:
        name = f"{num}_{arcname or src.name}"
        entries.append(dict(number=num, name=name, title=title, kind=kind, src=src))

    # numbered documents (12 onwards), cover/index/guidance are generated afterwards
    order = ["site_plan", "plan_dxf", "floor_plan", "elevations", "section_plans", "specifications", "landscape_plan", "shadow_diagram", "escp", "constraints_report", "constraints_json"]
    docs = sorted(project.docs, key=lambda d: (order.index(d.kind) if d.kind in order else 50, d.kind, d.title))
    n = 10
    if project.compliance is not None:
        cp = stage / "compliance_table.pdf"; compliance_pdf(project.compliance, cp)
        jp = stage / "compliance_table.json"; jp.write_text(project.compliance.model_dump_json(indent=1))
        add(f"{n:02d}", "Compliance table (PDF)", "compliance", cp); n += 1
        add(f"{n:02d}", "Compliance table (JSON)", "compliance", jp); n += 1
    for d in docs:
        p = Path(d.path)
        if not p.exists():
            raise FileNotFoundError(d.path)
        add(f"{n:02d}", d.title, d.kind, p, p.name); n += 1
    guidance = []
    for g in data["lodgement_guidance"]:
        guidance.append(dict(text=g["text"], note=g.get("note", ""), citation=g.get("citation")))
    checklist = build_checklist(project, data)
    cnt = {k: sum(r.status == k for r in checklist) for k in ("present", "missing", "not_applicable")}

    # lodgement guidance (cited)
    gp = stage / "lodgement_guidance.pdf"
    gb: list = [("p", f"Lodgement guidance for {project.council} ({project.pathway.upper()}). Sources are the council and NSW Planning Portal pages cited under each item; confirm current requirements with the council.")]
    for g in guidance:
        c = g["citation"]
        gb.append(("p", "- " + g["text"]))
        if c:
            gb.append(("s", f"   Source: {c['document_title']} ({c['authority']}), p.{c['page']}: \"{c['quote']}\" {c.get('source_url') or ''}"))
    _pdf(gp, "NSW Planning Portal lodgement guidance", gb)
    add("02", "Lodgement guidance (NSW Planning Portal and council)", "guidance", gp)

    # checklist + index placeholders (index lists all numbered files incl. itself by name)
    ip = stage / "index_and_checklist.pdf"
    add("01", "Index and submission checklist", "index", ip)
    cs = stage / "cover_sheet.pdf"
    add("00", "Cover sheet", "cover", cs)
    entries.sort(key=lambda e: e["number"])

    idx_rows = [["No.", "File", "Document"]] + [[e["number"], e["name"], e["title"]] for e in entries] + [["--", "manifest.json", "File list with sha256 of every file above"], ["--", "pack.json", "Pack data for the UI"]]
    ck_rows = [["Item", "Status", "Requirement", "Files", "Source (council checklist)"]]
    for r in checklist:
        ck_rows.append([r.label, r.status.replace("_", " "), r.requirement.replace("_", " "), ", ".join(r.files), (f"{r.citation.document_title}, p.{r.citation.page}: \"{r.citation.quote[:90]}\"" if r.citation else "") + (f" {r.note}" if r.note else "")])
    _pdf(ip, "Index and submission checklist", [("h", "Index"), ("t", ([14, 70, 96], idx_rows)),
          ("h", f"Submission checklist: {project.pathway.upper()}, {project.council}"), ("p", f"Present {cnt['present']}, missing {cnt['missing']}, not applicable {cnt['not_applicable']}. 'Present' means a file was supplied for the item; it does not mean the document is adequate."),
          ("t", ([50, 18, 22, 35, 55], ck_rows))])
    pr = project.pathway_result
    cover = [("h", "Application pack"), ("p", f"Project: {project.project_name}"), ("p", f"Lot/plan: {project.lotplan or 'TO BE COMPLETED'}"), ("p", f"Address: {project.address or 'TO BE COMPLETED'}"),
             ("p", f"Council: {project.council}"), ("p", f"Pathway: {project.pathway.upper()} ({project.dev_type})"), ("p", f"Prepared: {datetime.now(timezone.utc).date().isoformat()}")]
    if pr:
        cover += [("h", "Pathway check (decision support)")] + [("p", f"{c.title}: {c.pill.value}. {c.headline}") for c in pr.cards] + [("p", pr.recommendation)]
    cover += [("h", "Checklist status"), ("p", f"Present {cnt['present']}, missing {cnt['missing']}, not applicable {cnt['not_applicable']}."), ("h", "Disclaimer"), ("p", DISCLAIMER)]
    _pdf(cs, "Cover sheet", cover)

    zp = out / zip_name
    manifest = []
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for e in entries:
            z.write(e["src"], e["name"])
            manifest.append(dict(number=e["number"], file=e["name"], title=e["title"], kind=e["kind"], sha256=sha256(e["src"]), bytes=e["src"].stat().st_size))
        mj = dict(schema=1, generated=datetime.now(timezone.utc).isoformat(timespec="seconds"), project=project.project_name, pathway=project.pathway, council=project.council,
                  files=manifest, note="sha256 of each file as stored in this ZIP; manifest.json and pack.json are not self-hashed.")
        z.writestr("manifest.json", json.dumps(mj, indent=1))
        ui = dict(project=project.project_name, lotplan=project.lotplan, address=project.address, council=project.council, pathway=project.pathway, dev_type=project.dev_type,
                  index=[dict(number=m["number"], file=m["file"], title=m["title"]) for m in manifest], checklist=[r.model_dump(mode="json") for r in checklist], checklist_counts=cnt,
                  lodgement_guidance=guidance, compliance_counts=project.compliance.counts() if project.compliance else None,
                  pathway_check=pr.ui_model() if pr else None, disclaimer=DISCLAIMER)
        z.writestr("pack.json", json.dumps(ui, indent=1, default=str))
    uj = out / "pack.json"; uj.write_text(json.dumps(ui, indent=1, default=str))
    (out / "manifest.json").write_text(json.dumps(mj, indent=1))
    for p in stage.rglob("*"):
        if p.is_file(): p.unlink()
    stage.rmdir()
    return PackResult(zip_path=str(zp), ui_json_path=str(uj), files=manifest, checklist=checklist, guidance=guidance, counts=cnt)
