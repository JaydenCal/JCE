"""BYDA folder importer (stage 8, DBYD Phase 0: the manual path of docs/12-dbyd-integration-plan.md).

Reads what a person saved from a Before You Dig Australia (BYDA) enquiry into the project's private folder and registers it, owner by owner, in the project's DBYD store:

    <project>/BYDA/byda_status.md           job number, dates, owner response table (optional)
    <project>/BYDA/plans/<combined>.pdf     the combined "BYDA Responses" PDF (page 1 is the summary with the owner table and the start page of each owner)
    <project>/BYDA/<owner>/<files>          one folder per asset owner holding that owner's plans (PDF, DXF, DWF, or images)

NOTHING IS COPIED OUT OF THE PROJECT.  Split plan files are written to ``<project>/dbyd/plans`` by ``DbydStore`` (project private, never shared across projects or users) and
the registry is ``<project>/dbyd/owners.json``.  Asset owner plans are third party content for this project only: they are never written to outputs, the repository or another
site.  The registry holds no contact details (names, phones, emails of the enquirer are on the BYDA pages and are never read into it).

THE COMBINED PDF IS SPLIT BY WHAT IT SAYS ABOUT ITSELF, NOT BY A HARD CODED TABLE.  Page 1 lists each asset owner with the page the owner's section starts on; the first page of each
section lists the owner's files with their start pages (name then page, ``Excluded`` where BYDA left a file out); both are parsed from the text.  A file spans from its page to the page
before the next file, the last file to the end of the owner's section.  Each page is measured (vector line count, image coverage, text, embedded georeferencing), so the register says
what each file is made of (vector, raster, text only) and whether it is georeferenced; nothing is assumed.

VALIDITY.  The summary page gives the date the plans expire (the enquiry validity).  Each owner's own validity period (days) is read from the owner's pages ("valid for 28 days", "within 28
days of receipt of a plan", "no more than 30 days old"); when an owner states more than one, the shortest is used and every statement is kept with its page.  The plan date is the
response date on the owner's cover page.  Where no date or no period is stated the value is None and the document says NOT STATED: nothing is defaulted.

TRACING IS NOT DONE HERE.  A person traces services over the plan (``app.integrations.byda.traces``); every traced service is a DRAFT until a person verifies it.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from app.common.filestore import atomic_write_json, file_lock
from app.integrations.byda.store import DbydStore, StoreError, classify_plan, now_iso, safe_name

#: page measurement thresholds (reader settings, not requirements): a page with at least this many vector drawing paths is a vector plan page; an image covering at least this
#: share of the page is a raster page
VECTOR_MIN_DRAWINGS = 150
RASTER_MIN_COVERAGE = 0.25
#: a vector or raster page is map-like (a plan sheet, not a manual page) when it holds at most this many characters of text, or when it carries embedded georeferencing
MAP_MAX_TEXT_CHARS = 600
#: a file is a plan (a candidate for tracing) when at least this share of its pages are map-like (a manual with one figure is not)
MAP_MIN_SHARE = 0.30
OWNERS_FILE = "owners.json"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}
_MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
_STATE_LINE = re.compile(r"^(?P<addr>.+?)\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4}$")


# ------------------------------------------------------------------------------------------------------------------------------- dates
def parse_date(text: str) -> date | None:
    """DD/MM/YYYY, D Mon YYYY, 'Thu 15 Oct 2026' or ISO.  None when the text holds no date."""
    t = (text or "").strip()
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", t)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", t)
    if m and m.group(2).lower() in _MONTHS:
        try:
            return date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1)))
        except ValueError:
            return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


# ------------------------------------------------------------------------------------------------------------------------------- summary page
@dataclass
class OwnerRow:
    name: str
    status: str
    start_page: int


@dataclass
class Summary:
    job_id: str | None = None
    responses_text: str | None = None            # for example "Received 5 of 5 responses"
    job_start: date | None = None
    job_end: date | None = None
    expires: date | None = None
    site_address: str | None = None
    owners: list[OwnerRow] = field(default_factory=list)


def _lines(text: str) -> list[str]:
    return [ln.strip() for ln in (text or "").splitlines() if ln.strip()]


def parse_summary(text: str) -> Summary:
    """Parse page 1 of a combined BYDA responses PDF: job id, response count, job dates, the date the plans expire and the owner table (name, status, start page)."""
    ls = _lines(text)
    s = Summary()
    for i, ln in enumerate(ls):
        m = re.match(r"^Job ID\s+(\d+)$", ln, re.I)
        if m:
            s.job_id = m.group(1)
        if re.match(r"^Received\s+\d+\s+of\s+\d+\s+responses?$", ln, re.I):
            s.responses_text = ln
        if ln.lower() == "job dates" and i + 1 < len(ls):
            ds = re.findall(r"\d{1,2}/\d{1,2}/\d{4}", ls[i + 1])
            if len(ds) == 2:
                s.job_start, s.job_end = parse_date(ds[0]), parse_date(ds[1])
        if ln.lower().startswith("these plans expire") and i + 1 < len(ls):
            s.expires = parse_date(ls[i + 1])
        m2 = _STATE_LINE.match(ln)
        if m2 and s.site_address is None and not ln.lower().startswith(("created for", "lodged")):
            s.site_address = ln
    # owner table: after the header "Authority", "Status", "Page"
    try:
        h = next(i for i, ln in enumerate(ls) if ln == "Page" and i >= 2 and ls[i - 1] == "Status")
    except StopIteration:
        return s
    toks = ls[h + 1:]
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.lower().startswith("created for"):
            break
        if t.lower() == "byda confirmation":                                       # the BYDA confirmation page: not an owner
            i += 2
            continue
        if i + 2 < len(toks) and toks[i + 2].isdigit() and not t.isdigit() and not toks[i + 1].isdigit():
            s.owners.append(OwnerRow(t, toks[i + 1], int(toks[i + 2])))
            i += 3
        else:
            i += 1
    return s


# ------------------------------------------------------------------------------------------------------------------------------- owner cover page
@dataclass
class FileSpan:
    name: str
    start: int | None                               # page, None when excluded
    end: int | None = None
    excluded: bool = False
    is_body: bool = False
    pages_kind: dict[str, int] = field(default_factory=dict)      # counts of vector / raster / text pages
    plan_candidate: bool = False
    georef_pages: list[int] = field(default_factory=list)
    georef: dict | None = None


@dataclass
class OwnerCover:
    referral: str | None = None
    received: date | None = None
    received_text: str | None = None
    files: list[FileSpan] = field(default_factory=list)


def parse_owner_cover(text: str) -> OwnerCover:
    """The first page of an owner's section: referral number, response date and the file table (name then page, or Excluded)."""
    ls = _lines(text)
    c = OwnerCover()
    for i, ln in enumerate(ls):
        if ln.lower() == "referral" and i + 1 < len(ls) and ls[i + 1].isdigit():
            c.referral = ls[i + 1]
        m = re.match(r"^Response received\s+(.*)$", ln, re.I)
        if m:
            c.received_text = m.group(1).strip()
            c.received = parse_date(m.group(1))
    try:
        h = next(i for i, ln in enumerate(ls) if ln.lower() == "response body")
    except StopIteration:
        return c
    toks = ls[h:]
    i = 0
    while i + 1 < len(toks):
        name, nxt = toks[i], toks[i + 1]
        if name.lower().startswith("created for"):
            break
        if nxt.isdigit():
            c.files.append(FileSpan(name, int(nxt), is_body=name.lower() == "response body"))
            i += 2
        elif nxt.lower() == "excluded":
            c.files.append(FileSpan(name, None, excluded=True))
            i += 2
        else:
            i += 1
    return c


# ------------------------------------------------------------------------------------------------------------------------------- validity statements
_VALID_PATTERNS = (
    re.compile(r"valid\s+(?:only\s+)?for\s+(\d+)\s+(day|week)s?", re.I),
    re.compile(r"within\s+(\d+)\s+(day|week)s?\s+of\s+(?:receipt|issue)", re.I),
    re.compile(r"no\s+more\s+than\s+(\d+)\s+(day|week)s?\s+old", re.I),
    re.compile(r"only\s+valid\s+for\s+(\d+)\s+(day|week)s?", re.I),
    re.compile(r"valid\s+(?:for\s+)?(\d+)\s+(day|week)s?\s+(?:after|from)", re.I),
)


def validity_statements(page_texts: dict[int, str]) -> list[dict]:
    """Every statement in the owner's pages that gives a validity period for the plans, in days, with its page.  Nothing is inferred beyond the matched number and unit."""
    out: list[dict] = []
    seen: set[tuple[int, int]] = set()
    for pg, t in sorted(page_texts.items()):
        flat = re.sub(r"\s+", " ", t or "")
        for pat in _VALID_PATTERNS:
            for m in pat.finditer(flat):
                n = int(m.group(1)) * (7 if m.group(2).lower().startswith("week") else 1)
                if (pg, n) in seen:
                    continue
                seen.add((pg, n))
                a, b = max(0, m.start() - 40), min(len(flat), m.end() + 40)
                out.append({"days": n, "page": pg, "text": flat[a:b].strip()})
    return out


# ------------------------------------------------------------------------------------------------------------------------------- page measurement
def measure_page(page) -> dict[str, Any]:
    """Vector path count, raster coverage and text length of one PDF page (pymupdf)."""
    rect = page.rect
    area = max(rect.width * rect.height, 1.0)
    try:
        nd = len(page.get_drawings())
    except Exception:  # noqa: BLE001
        nd = 0
    cov = 0.0
    try:
        for info in page.get_image_info():
            b = info.get("bbox")
            if b:
                cov = max(cov, ((b[2] - b[0]) * (b[3] - b[1])) / area)
    except Exception:  # noqa: BLE001
        pass
    kind = "vector" if nd >= VECTOR_MIN_DRAWINGS else ("raster" if cov >= RASTER_MIN_COVERAGE else "text")
    return {"drawings": nd, "image_coverage": round(cov, 3), "text_chars": len(page.get_text() or ""), "kind": kind, "size_pt": [round(rect.width, 1), round(rect.height, 1)]}


def georef_of_pages(path: Path, pages: list[int]) -> dict[int, dict]:
    """Embedded georeferencing (a /VP viewport with a /Measure of subtype /GEO: GPTS latitude and longitude pairs, LPTS page positions) for the given 1-based pages.  Only what is
    embedded is read: no position is derived from a map image."""
    out: dict[int, dict] = {}
    try:
        from pypdf import PdfReader
        rd = PdfReader(str(path))
    except Exception:  # noqa: BLE001
        return out
    for pg in pages:
        try:
            page = rd.pages[pg - 1]
            vps = page.get("/VP")
            vps = vps.get_object() if vps is not None else None
            for vp in (vps or []):
                vp = vp.get_object()
                meas = vp.get("/Measure")
                meas = meas.get_object() if meas is not None else None
                if meas is None or str(meas.get("/Subtype")) != "/GEO":
                    continue
                gpts = [round(float(x), 6) for x in meas.get("/GPTS", [])]
                lpts = [round(float(x), 6) for x in meas.get("/LPTS", [])]
                gcs = meas.get("/GCS")
                gcs = gcs.get_object() if gcs is not None else None
                wkt = str(gcs.get("/WKT", ""))[:160] if gcs is not None else ""
                bbox = [round(float(x), 2) for x in vp.get("/BBox", [])]
                if gpts:
                    out[pg] = {"gpts_lat_lon": gpts, "lpts": lpts, "bbox": bbox, "gcs_wkt_head": wkt}
                    break
        except Exception:  # noqa: BLE001
            continue
    return out


# ------------------------------------------------------------------------------------------------------------------------------- the import
@dataclass
class ImportResult:
    registry: dict
    created_plans: int = 0
    skipped_plans: int = 0
    messages: list[str] = field(default_factory=list)


def _split_pdf_bytes(src, first: int, last: int) -> bytes:
    import pymupdf
    out = pymupdf.open()
    out.insert_pdf(src, from_page=first - 1, to_page=last - 1)
    data = out.tobytes(garbage=3, deflate=True)
    out.close()
    return data


def _owner_name(row_name: str) -> tuple[str, str | None]:
    """'APA Group Gas Networks (70540)' -> ('APA Group Gas Networks', '70540')."""
    m = re.match(r"^(.*?)\s*\((\w+)\)\s*$", row_name)
    return (m.group(1).strip(), m.group(2)) if m else (row_name.strip(), None)


def parse_status_md(text: str) -> dict[str, Any]:
    """byda_status.md: job number, enquiry id, lodged date, job dates, validity and the owner response table.  Only what the file states."""
    out: dict[str, Any] = {"owners": {}}
    m = re.search(r"BYDA Job\s+(\d+)(?:\s*\(enquiry\s+(\d+)\))?", text)
    if m:
        out["job_number"], out["enquiry_id"] = m.group(1), m.group(2)
    m = re.search(r"lodged\s+(\d{1,2}/\d{1,2}/\d{4})", text)
    if m:
        out["lodged"] = iso(parse_date(m.group(1)))
    m = re.search(r"Job dates\s+(\d{1,2}/\d{1,2}/\d{4})\s+to\s+(\d{1,2}/\d{1,2}/\d{4})", text)
    if m:
        out["job_start"], out["job_end"] = iso(parse_date(m.group(1))), iso(parse_date(m.group(2)))
    m = re.search(r"valid until\s+(\d{1,2}/\d{1,2}/\d{4})", text)
    if m:
        out["enquiry_valid_until"] = iso(parse_date(m.group(1)))
    for row in re.findall(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$", text, re.M):
        if row[0].lower() in ("owner", "---") or set(row[0]) <= set("-"):
            continue
        out["owners"][row[0]] = row[1]
    if "SYNTHETIC" in text.upper():
        out["synthetic"] = True
    return out


def _analyse_pdf_section(doc, path: Path, owner: dict, first: int, last: int, cover: OwnerCover | None) -> None:
    """Fill ``owner['files']``, validity statements and page counts from the PDF pages first..last (1-based)."""
    texts: dict[int, str] = {}
    metrics: dict[int, dict] = {}
    for pg in range(first, last + 1):
        p = doc[pg - 1]
        texts[pg] = p.get_text() or ""
        metrics[pg] = measure_page(p)
    owner["validity_statements"] = validity_statements(texts)
    files = cover.files if cover else []
    spans = [f for f in files if not f.excluded and f.start is not None]
    spans.sort(key=lambda f: f.start)
    for i, f in enumerate(spans):
        f.end = (spans[i + 1].start - 1) if i + 1 < len(spans) else last
    geo = georef_of_pages(path, list(range(first, last + 1)))
    for pg, m in metrics.items():
        m["georef"] = pg in geo
        m["map_like"] = pg in geo or (m["kind"] in ("vector", "raster") and m["text_chars"] <= MAP_MAX_TEXT_CHARS)
    out_files = []
    for f in files:
        if f.excluded:
            out_files.append({"name": f.name, "pages": None, "excluded": True, "note": "EXCLUDED BY BYDA FROM THE COMBINED PDF: THE FILE IS NOT IN THIS DOWNLOAD, OBTAIN IT SEPARATELY"})
            continue
        pgs = list(range(f.start, f.end + 1))
        kinds: dict[str, int] = {}
        for pg in pgs:
            kinds[metrics[pg]["kind"]] = kinds.get(metrics[pg]["kind"], 0) + 1
        mp = [pg for pg in pgs if metrics[pg]["map_like"]]
        nv = sum(1 for pg in mp if metrics[pg]["kind"] == "vector" or (metrics[pg]["georef"] and metrics[pg]["kind"] != "raster"))
        nr = sum(1 for pg in mp if metrics[pg]["kind"] == "raster")
        content = "text" if not mp else ("mixed" if (nv and nr) else ("vector" if nv else "raster"))
        rec = {"name": f.name, "pages": [f.start, f.end], "excluded": False, "is_body": f.is_body, "content": content, "page_kinds": kinds, "map_pages": mp,
               "map_page_kinds": {"vector": nv, "raster": nr}, "plan_candidate": bool(mp) and len(mp) >= MAP_MIN_SHARE * len(pgs) and not f.is_body, "max_drawings": max((metrics[pg]["drawings"] for pg in pgs), default=0)}
        g = {pg: geo[pg] for pg in mp if pg in geo}
        if g:
            rec["georef_pages"] = sorted(g)
            first_g = g[min(g)]
            rec["georef"] = {"kind": "embedded GeoPDF viewport (/VP /Measure /GEO)", "pages": len(g), "gpts_lat_lon_first_page": first_g["gpts_lat_lon"], "gcs_wkt_head": first_g["gcs_wkt_head"],
                             "note": "geographic coordinates (latitude, longitude) embedded in the PDF; NOT used to place any service until a person traces and verifies it"}
        out_files.append(rec)
    owner["files"] = out_files
    owner["page_counts"] = {k: sum(1 for m in metrics.values() if m["kind"] == k) for k in ("vector", "raster", "text")}


def import_folder(project_dir: str | Path, *, byda_dir: str | Path | None = None, today: date | None = None, write: bool = True) -> ImportResult:
    """Import ``<project>/BYDA`` into ``<project>/dbyd``: split the combined PDF per owner (parsed page table), register each owner with job number, plan date and validity, and store
    each owner's plan file in the project's private store.  Idempotent: a plan file already stored (same owner and sha256) is not stored again.  Nothing is verified or traced here."""
    import pymupdf
    project = Path(project_dir)
    byda = Path(byda_dir) if byda_dir else project / "BYDA"
    today = today or date.today()
    res = ImportResult(registry={})
    if not byda.is_dir():
        res.messages.append(f"NO BYDA FOLDER AT {byda}")
        return res
    store = DbydStore(project)
    status_md: dict[str, Any] = {}
    sp = byda / "byda_status.md"
    if sp.is_file():
        status_md = parse_status_md(sp.read_text(encoding="utf-8", errors="replace"))
    reg: dict[str, Any] = {"schema": 1, "imported_at": now_iso(), "job_number": status_md.get("job_number"), "enquiry_id": status_md.get("enquiry_id"), "lodged": status_md.get("lodged"),
                           "job_start": status_md.get("job_start"), "job_end": status_md.get("job_end"), "enquiry_valid_until": status_md.get("enquiry_valid_until"),
                           "synthetic": bool(status_md.get("synthetic")), "responses_text": None, "site_address": None, "owners": [], "sources": [], "messages": []}
    owners: dict[str, dict] = {}

    def owner_rec(name: str) -> dict:
        nm, code = _owner_name(name)
        key = nm.lower()
        if key not in owners:
            owners[key] = {"owner": nm, "owner_code": code, "response_status": None, "referral": None, "response_received": None, "response_received_text": None, "plan_date": None,
                           "valid_days": None, "valid_until": None, "validity_statements": [], "section_pages": None, "files": [], "plan_ids": [], "page_counts": {}, "source": None}
        return owners[key]

    for k, v in (status_md.get("owners") or {}).items():
        o = owner_rec(k)
        o["response_status"] = v

    # ---- combined PDFs (BYDA/plans/*.pdf and BYDA/*.pdf): split by the page table on page 1
    cands = sorted([*byda.glob("*.pdf"), *(byda / "plans").glob("*.pdf")]) if (byda / "plans").is_dir() else sorted(byda.glob("*.pdf"))
    for pdf in cands:
        data = pdf.read_bytes()
        try:
            classify_plan(pdf.name, None, data[:64])
            doc = pymupdf.open(stream=data, filetype="pdf")
        except (StoreError, Exception) as ex:  # noqa: BLE001
            res.messages.append(f"{pdf.name}: NOT READ ({ex})")
            continue
        p1 = doc[0].get_text() or ""
        summ = parse_summary(p1)
        if "SYNTHETIC TEST DATA" in p1.upper():                                    # a synthetic file marks itself; the registry then carries the stamp into every document
            reg["synthetic"] = True
        sha = hashlib.sha256(data).hexdigest()
        if not summ.owners:
            res.messages.append(f"{pdf.name}: page 1 holds no owner table, so the file is not split; register it under an owner folder")
            continue
        reg["sources"].append({"file": pdf.name, "sha256": sha, "pages": len(doc), "kind": "combined BYDA responses PDF", "split_by": "owner table on page 1 (parsed)"})
        reg["job_number"] = reg["job_number"] or summ.job_id
        reg["responses_text"] = summ.responses_text
        reg["site_address"] = summ.site_address
        if summ.expires and not reg.get("enquiry_valid_until"):
            reg["enquiry_valid_until"] = iso(summ.expires)
        elif summ.expires and reg["enquiry_valid_until"] != iso(summ.expires):
            res.messages.append(f"ENQUIRY VALIDITY DIFFERS: byda_status.md {reg['enquiry_valid_until']}, PDF page 1 {iso(summ.expires)}; the PDF date is used")
            reg["enquiry_valid_until"] = iso(summ.expires)
        if summ.job_start and not reg.get("job_start"):
            reg["job_start"], reg["job_end"] = iso(summ.job_start), iso(summ.job_end)
        starts = sorted(r.start_page for r in summ.owners)
        for r in summ.owners:
            o = owner_rec(r.name)
            o["response_status"] = r.status
            nxt = [s for s in starts if s > r.start_page]
            last = (nxt[0] - 1) if nxt else len(doc)
            o["section_pages"] = [r.start_page, last]
            o["source"] = {"file": pdf.name, "sha256": sha}
            cover = parse_owner_cover(doc[r.start_page - 1].get_text() or "")
            o["referral"], o["response_received"], o["response_received_text"] = cover.referral, iso(cover.received), cover.received_text
            _analyse_pdf_section(doc, pdf, o, r.start_page, last, cover)
            if write:
                try:
                    sect = _split_pdf_bytes(doc, r.start_page, last)
                    nm = safe_name(f"{o['owner']} responses pages {r.start_page}-{last}.pdf")
                    same = [p for p in store.plans() if p.get("asset_owner") == o["owner"] and (p.get("sha256") == hashlib.sha256(sect).hexdigest()
                                                                                              or (p.get("combined_sha256") == sha and p.get("section_pages") == o["section_pages"]))]   # a split PDF is not byte-stable: the same source section is the same plan
                    if same:
                        o["plan_ids"].append(same[0]["plan_id"])
                        res.skipped_plans += 1
                    else:
                        meta = {"job_number": reg["job_number"], "asset_owner": o["owner"], "plan_date": o["response_received"], "plan_reference": o["referral"],
                                "section_pages": o["section_pages"], "from_combined": pdf.name, "combined_sha256": sha, "synthetic": reg["synthetic"]}
                        rec = store.add_plan(nm, "pdf", sect, meta)
                        o["plan_ids"].append(rec["plan_id"])
                        res.created_plans += 1
                except StoreError as ex:
                    res.messages.append(f"{o['owner']}: plan not stored ({ex.message})")

    # ---- owner folders: BYDA/<owner>/<files>
    for d in sorted(p for p in byda.iterdir() if p.is_dir() and p.name not in ("plans", "_work") and not p.name.startswith(".")):
        o = owner_rec(d.name)
        o["source"] = o["source"] or {"folder": d.name}
        for f in sorted(d.iterdir()):
            if not f.is_file():
                continue
            ext = f.suffix.lower()
            raw = f.read_bytes()
            frec: dict[str, Any] = {"name": f.name, "excluded": False, "is_body": False, "sha256": hashlib.sha256(raw).hexdigest()}
            if ext in IMAGE_EXT:
                frec.update(pages=[1, 1], content="raster", plan_candidate=True, map_pages=[1], map_page_kinds={"vector": 0, "raster": 1}, page_kinds={"raster": 1}, note="image: registered by reference, not stored in the plan store")
                o["files"].append(frec)
                continue
            try:
                kind = classify_plan(f.name, None, raw[:64])
            except StoreError as ex:
                res.messages.append(f"{d.name}/{f.name}: NOT REGISTERED ({ex.message})")
                continue
            if kind == "pdf":
                doc = pymupdf.open(stream=raw, filetype="pdf")
                tmp_cover = OwnerCover(files=[FileSpan(f.name, 1)])
                sub = {"files": [], "validity_statements": [], "page_counts": {}}
                _analyse_pdf_section(doc, f, sub, 1, len(doc), tmp_cover)
                frec.update(sub["files"][0])
                o["validity_statements"] = sorted(o["validity_statements"] + sub["validity_statements"], key=lambda x: (x["page"], x["days"]))
                for k, n in sub["page_counts"].items():
                    o["page_counts"][k] = o["page_counts"].get(k, 0) + n
            else:
                frec.update(pages=None, content=kind, plan_candidate=True, page_kinds={}, note=f"{kind.upper()} file: not read automatically; trace it manually")
            o["files"].append(frec)
            if write:
                try:
                    same = [p for p in store.plans() if p.get("sha256") == frec["sha256"] and p.get("asset_owner") == o["owner"]]
                    if same:
                        o["plan_ids"].append(same[0]["plan_id"])
                        res.skipped_plans += 1
                    else:
                        rec = store.add_plan(safe_name(f.name), kind, raw, {"job_number": reg["job_number"], "asset_owner": o["owner"], "plan_date": o["plan_date"], "plan_reference": None,
                                                                         "synthetic": reg["synthetic"]})
                        o["plan_ids"].append(rec["plan_id"])
                        res.created_plans += 1
                except StoreError as ex:
                    res.messages.append(f"{o['owner']}: {f.name} not stored ({ex.message})")

    # ---- plan date and validity per owner
    ev = parse_date(reg.get("enquiry_valid_until") or "")
    for o in owners.values():
        pd = parse_date(o.get("response_received") or "") or parse_date(o.get("plan_date") or "")
        o["plan_date"] = iso(pd)
        sts = o.get("validity_statements") or []
        o["valid_days"] = min((s["days"] for s in sts), default=None)
        o["valid_until"] = iso(pd + timedelta(days=o["valid_days"])) if (pd and o["valid_days"] is not None) else None
        o["plans_received"] = any(f.get("plan_candidate") for f in o["files"])
        o["effective_valid_until"] = iso(min(d for d in (parse_date(o["valid_until"] or ""), ev) if d)) if (o["valid_until"] or ev) else None
    reg["owners"] = list(owners.values())
    reg["messages"] = res.messages
    res.registry = reg
    if write:
        store.dir.mkdir(parents=True, exist_ok=True)
        with file_lock(store.dir / OWNERS_FILE):
            atomic_write_json(store.dir / OWNERS_FILE, reg)
    return res


def load_registry(project_dir: str | Path) -> dict | None:
    p = Path(project_dir) / "dbyd" / OWNERS_FILE
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
