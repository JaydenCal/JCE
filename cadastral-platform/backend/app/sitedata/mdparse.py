"""Tolerant readers for the collector's markdown status files.

The files are DATA: values are pulled out with regular expressions on known keys and on the owner table.  Free text is never interpreted as an
instruction, never executed, and an unrecognised line is ignored (nothing in this module raises on odd input).
"""
from __future__ import annotations

import datetime as dt
import re

from app.sitedata.models import BydaData, LidarStatus, Owner, ddmmyyyy

_DATE = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b")
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def clean_lines(text: str) -> list[str]:
    """Lines with BOM, carriage returns, bold/italic marks and backticks removed (the structure stays)."""
    t = (text or "").lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[*`]{1,3}", "", t)                        # underscores are kept: file names contain them
    return t.split("\n")


def parse_date(s: str | None) -> dt.date | None:
    """First date in ``s`` (DD/MM/YYYY, DD-MM-YYYY or YYYY-MM-DD); None when absent or impossible."""
    if not s:
        return None
    m = _DATE.search(s)
    try:
        if m:
            return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        m = _ISO.search(s)
        if m:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return None


def dates_in(s: str) -> list[dt.date]:
    out = []
    for m in _DATE.finditer(s or ""):
        try:
            out.append(dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))))
        except ValueError:
            continue
    return out


def key_values(lines: list[str]) -> dict[str, str]:
    """"- Key: value" and "Key: value" lines as {lower-case key: value} (first occurrence wins)."""
    kv: dict[str, str] = {}
    for ln in lines:
        m = re.match(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)?([A-Za-z][A-Za-z0-9 /()'-]{1,48}?)\s*:\s*(.+?)\s*$", ln)
        if m and m.group(1).lower() not in kv:
            kv[m.group(1).strip().lower()] = m.group(2).strip()
    return kv


def _num(m) -> str | None:
    return m.group(1) if m else None


def parse_lidar_status(text: str) -> LidarStatus:
    lines = clean_lines(text)
    kv = key_values(lines)
    body = "\n".join(lines)
    st = LidarStatus()
    st.dataset = kv.get("dataset", "")
    st.status_text = kv.get("status", "")
    d = parse_date(st.status_text)
    st.received = ddmmyyyy(d)
    elv = next((v for k, v in kv.items() if "elvis" in k), "")
    st.order_ref = elv
    st.elvis = bool(re.search(r"\bELVIS\b", body, re.I))
    st.crs = next((kv[k] for k in kv if k.startswith("coordinate") or k in ("crs", "datum", "projection")), "")
    mh = re.search(r"heights?\s+(.+?)\s*$", st.crs, re.I)
    st.vertical_datum = mh.group(1).strip() if mh else ""
    if mh:
        st.crs = re.sub(r"\s*[;,]\s*heights?\s+.+$", "", st.crs, flags=re.I).strip()
    acc = next((kv[k] for k in kv if "accuracy" in k), "")
    st.accuracy_text = acc
    mv = re.search(r"vertical[^0-9]{0,24}?(?:\+/-|\+-|±|plus or minus)?\s*([0-9]*\.?[0-9]+)\s*m\b", acc, re.I)
    mh2 = re.search(r"horizontal[^0-9]{0,24}?(?:\+/-|\+-|±|plus or minus)?\s*([0-9]*\.?[0-9]+)\s*m\b", acc, re.I)
    st.vertical_accuracy_text = _num(mv)
    st.horizontal_accuracy_text = _num(mh2)
    ds = st.dataset
    m = re.search(r"\(\s*(\d{4})\s+capture\s*\)", ds + " " + body, re.I) or re.search(r"\bcapture[d]?\s*[:\-]?\s*(\d{4})\b", body, re.I)
    if m:
        st.capture_year = m.group(1)
    m2 = re.search(r"[A-Za-z]+((?:19|20)\d{2})(\d{2})-LID", ds)
    if m2:
        st.capture_year = st.capture_year or m2.group(1)
        st.capture_month = m2.group(2)
    mr = re.search(r"(\d+(?:\.\d+)?)\s*m\s*DEM", ds, re.I) or re.search(r"_(\d+(?:\.\d+)?)m\.tif", ds, re.I)
    st.resolution_text = _num(mr)

    def f(rx):
        mm = re.search(rx, body, re.I)
        return float(mm.group(1)) if mm else None
    stats = {"min_rl": f(r"minimum\s+RL\s+([0-9]+(?:\.[0-9]+)?)"), "max_rl": f(r"maximum\s+RL\s+([0-9]+(?:\.[0-9]+)?)"),
             "mean_rl": f(r"mean\s+RL\s+([0-9]+(?:\.[0-9]+)?)"), "median_slope_pct": f(r"median\s+slope\s+([0-9]+(?:\.[0-9]+)?)\s*percent"),
             "fit_grade_pct": f(r"plane\s+grade\s+([0-9]+(?:\.[0-9]+)?)\s*percent"), "fit_bearing_deg": f(r"to\s+bearing\s+([0-9]+(?:\.[0-9]+)?)")}
    st.stats = {k: v for k, v in stats.items() if v is not None}
    return st


_NEG = re.compile(r"no response|not (yet )?(received|responded)|await|pending|outstanding|overdue|not responded|unanswered|\bwaiting\b", re.I)
_POS = re.compile(r"respon(se|ded)|received|no assets?|plans? (attached|supplied)|replied|clear of", re.I)


def owner_responded(status: str) -> bool:
    """A response counts only on a positive statement.  Anything unrecognised is NOT a response (not checked never means clear)."""
    s = status or ""
    if _NEG.search(s):
        return False
    return bool(_POS.search(s))


def parse_byda_status(text: str) -> BydaData:
    lines = clean_lines(text)
    body = "\n".join(lines)
    b = BydaData(status_file=None)
    m = re.search(r"\bjob\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d{5,})", body, re.I)
    b.job_no = m.group(1) if m else None
    m = re.search(r"\benquiry\s*(?:no\.?|number|#|id|ref)?\s*[:#]?\s*(\d{5,})", body, re.I)
    b.enquiry_no = m.group(1) if m else None
    m = re.search(r"lodged\s+(.{0,40})", body, re.I)
    if m:
        b.lodged_text = m.group(1).split("\n")[0].strip(" ,;")
        b.lodged = ddmmyyyy(parse_date(b.lodged_text))
    m = re.search(r"job\s+dates?\s*:?\s*(.{0,60})", body, re.I)
    if m:
        ds = dates_in(m.group(1).split("\n")[0])
        if len(ds) >= 1:
            b.job_from = ds[0]
        if len(ds) >= 2:
            b.job_to = ds[1]
    m = re.search(r"valid(?:ity)?\s*(?:until|to|till|through|:)\s*(.{0,30})", body, re.I)
    if m:
        b.valid_until = parse_date(m.group(1).split("\n")[0])
    b.project_only = bool(re.search(r"for\s+this\s+project\s+only", body, re.I))
    # owner table: the header row names the columns; either order is accepted
    rows: list[list[str]] = []
    for ln in lines:
        if ln.strip().startswith("|"):
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if cells and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                continue
            rows.append(cells)
    if rows:
        head = [c.lower() for c in rows[0]]
        oi = next((i for i, c in enumerate(head) if "owner" in c or "asset" in c or "organisation" in c or "organization" in c), 0)
        si = next((i for i, c in enumerate(head) if "status" in c or "response" in c), 1 if len(head) > 1 else 0)
        has_head = any(("owner" in c or "status" in c or "asset" in c or "response" in c) for c in head)
        for r in rows[1:] if has_head else rows:
            if len(r) <= max(oi, si) or not r[oi]:
                continue
            b.owners.append(Owner(r[oi], r[si], owner_responded(r[si])))
    # other prose lines are kept as notes (shown verbatim in the provenance table, never acted on)
    b.notes = [ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith(("|", "#", "-")) and len(ln.strip()) < 300]
    return b
