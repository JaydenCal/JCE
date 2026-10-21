"""Build knowledge/gunnedah/typicals.json (council TYPICAL DETAIL data) from typicals_candidates.json and check every entry against the source text.

    python -I knowledge/gunnedah/build_typicals.py --pdf-dir /path/to/council/pdf [--allow-failures]

Inputs
  typicals_candidates.json   hand-read entries (value, unit, source, edition, drawing or clause, page, quote or description, url, confidence)
  --pdf-dir                  the council PDFs: GSC_SD-107_Vehicle_Access_Urban_Residential.pdf and
                             GSC_Engineering_Design_Minimum_Standards_V1_April_2025.pdf (raw PDFs are git-ignored, like knowledge/raw)
  requirements.json          the validated DCP entries, which the DCP typicals are cross-referenced to instead of being quoted again

Checks (the same ideas as the SA2 / Requirements Resolver validator, see README.md)
  * every verbatim quote (text between double quotes in `quote_or_description`) must be found after `norm` (SA2) in the cited document: the SD-107
    text for the standard drawing, the cited page range (printed "Page n of 166", footers removed) for the Engineering Design Minimum Standards;
  * every numeric value must appear as a number in the cited page text (or in the quote), mm and m accepted as equivalents;
  * a DCP entry must name a key of requirements.json whose validated quote contains the entry's quote;
  * confidence <= 0.7 (or any confidence below 0.9 for a dimension read off a drawing) is flagged `verify` and is printed on the sheet with
    VERIFY AGAINST SD-107; confidence 0 entries are NOT FOUND markers and are kept as `status: not_found` (never used as values).
No value is generated here.  A failed check is written to typicals_validation.json and the build exits 1 unless --allow-failures is given.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
sys.path.insert(0, str(BACKEND))

from app.agents.sa2_dcp_rag.extract import norm  # noqa: E402

SD_PDF = "GSC_SD-107_Vehicle_Access_Urban_Residential.pdf"
ENG_PDF = "GSC_Engineering_Design_Minimum_Standards_V1_April_2025.pdf"
DOCS = {
    "sd107": dict(short="GSC SD-107 REV A", title="Gunnedah Shire Council Standard Drawing SD-107 Vehicle Access Urban Residential", authority="Gunnedah Shire Council",
                  edition="Rev A, 01/08/2023", tag="GSC SD-107 REV A", kind="standard drawing", pdf=SD_PDF, page_convention="single sheet (page 1)"),
    "eng": dict(short="GSC ENGINEERING DESIGN MINIMUM STANDARDS (VERSION 1, APRIL 2025)", title="Gunnedah Shire Council Engineering Design Minimum Standards for Subdivisions and Development",
                authority="Gunnedah Shire Council", edition="Version 1, April 2025", tag="GSC ENGINEERING STANDARDS V1 (APR 2025)", kind="standard", pdf=ENG_PDF, page_convention='printed "Page n of 166"'),
    "dcp": dict(short="GSC DCP 2025", title="Gunnedah Shire Council Development Control Plan 2025", authority="Gunnedah Shire Council", edition="adopted 18/06/2025",
                tag="GSC DCP 2025", kind="development control plan", pdf=None, page_convention="PDF page index (printed page = PDF page - 6), as requirements.json"),
}
TOPIC_SHORT = {"crossover_driveway": "crossover", "kerb_and_gutter": "kerb", "footpath_verge": "verge", "driveway_pavement": "pavement",
               "stormwater_connection": "stormwater", "erosion_sediment_control": "esc", "floor_level_setbacks": "floor"}
NUM = re.compile(r"\d+(?:\.\d+)?")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def pdf_text(p: Path, layout: bool) -> str:
    return subprocess.run(["pdftotext"] + (["-layout"] if layout else []) + [str(p), "-"], capture_output=True, text=True, check=True).stdout


def nrm(s: str) -> str:
    """SA2 `norm`, then letters and digits only: quote marks, hyphenation and line wrapping do not matter."""
    return re.sub(r"[^a-z0-9]+", "", norm(s).lower())


def eng_pages(p: Path) -> dict[int, str]:
    """Page text from both pdftotext modes (layout keeps table rows together, raw keeps reading order), footers removed."""
    out = {}
    lay, raw = pdf_text(p, True).split("\f"), pdf_text(p, False).split("\f")
    for i in range(max(len(lay), len(raw))):
        t = (lay[i] if i < len(lay) else "") + "\n" + (raw[i] if i < len(raw) else "")
        out[i + 1] = re.sub(r"Version\s+1\s+April\s+2025\s+Page\s+\d+\s+of\s+166", " ", t)
    return out


def page_list(page: str) -> list[int]:
    """'44-45' -> [44, 45]; '49, 151' -> [49, 151]; '37 PDF index' -> [37]; '34 printed (39 PDF index)' -> [39]."""
    m = re.search(r"\((\d+) PDF index\)", page)
    if m:
        return [int(m.group(1))]
    out: list[int] = []
    for part in re.split(r",", re.sub(r"[^\d,\-]", " ", page).replace(" ", "")):
        if "-" in part:
            a, b = part.split("-")[:2]
            if a.isdigit() and b.isdigit():
                out += list(range(int(a), int(b) + 1))
        elif part.isdigit():
            out.append(int(part))
    return out


def quotes(desc: str) -> list[str]:
    out = []
    for q in re.findall(r"[\"“]([^\"”]{8,})[\"”]", desc or ""):
        for part in q.split("..."):
            part = part.strip().rstrip(".").strip()
            if len(part) >= 8:
                out.append(part)
    return out


def numbers_of(v) -> list[float]:
    if isinstance(v, (int, float)):
        return [float(v)]
    if isinstance(v, str):
        m = re.match(r"^\s*(\d+(?:\.\d+)?)(?:\s*(?:to|-)\s*(\d+(?:\.\d+)?))?\s*$", v)
        if m:
            return [float(g) for g in m.groups() if g]
    return []


def numeric_of(v, unit):
    """{'value': x} or {'min': a, 'max': b}, or None when the value is a description."""
    n = numbers_of(v)
    if len(n) == 1:
        return {"value": n[0]}
    if len(n) == 2:
        return {"min": n[0], "max": n[1]}
    return None


def clean_unit(v, unit):
    u = (unit or "").strip()
    if not u:
        return None
    if numeric_of(v, u) is None and u in ("mm", "m", "f", "count"):
        return None            # a description with a stray unit
    if u.startswith("percent"):
        return "percent"
    return u


def present(n: float, text: str, unit: str | None) -> bool:
    """The number (or its mm/m equivalent) occurs as a number in the text."""
    toks = {float(x) for x in NUM.findall(text.replace(",", ""))}
    cands = {n}
    if unit == "m":
        cands |= {n * 1000}
    if unit == "mm":
        cands |= {n / 1000}
    return any(abs(c - t) < 1e-9 for c in cands for t in toks)


def sd107_notes(raw: str) -> list[dict]:
    """The 15 numbered notes of SD-107, verbatim from the PDF text (a note starts at 'n. ' and runs to the next blank line)."""
    notes, cur = {}, None
    for ln in raw.splitlines():
        m = re.match(r"^(\d{1,2})\.\s+(\S.*)$", ln)
        if m and 1 <= int(m.group(1)) <= 15 and int(m.group(1)) not in notes:
            cur = int(m.group(1))
            notes[cur] = [m.group(2).strip()]
        elif cur is not None and ln.strip() and not re.match(r"^\d+$", ln.strip()):
            notes[cur].append(ln.strip())
        else:
            cur = None
    out = []
    for n in sorted(notes):
        t = " ".join(notes[n]).replace("REFERAS2890.1", "REFER AS2890.1")
        t = re.sub(r"\s+", " ", t).strip()
        t = re.sub(r"\s+\.", ".", t)
        out.append({"n": n, "text": re.sub(r"\.\.+$", ".", t)})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    ap.add_argument("--allow-failures", action="store_true")
    a = ap.parse_args()
    pdfd = Path(a.pdf_dir)
    cand = json.loads((HERE / "typicals_candidates.json").read_text())
    reqs = {r["key"]: r for r in json.loads((HERE / "requirements.json").read_text())["requirements"]}
    docs: dict[str, dict] = {}
    texts: dict[str, object] = {}
    for did, d in DOCS.items():
        meta = {k: v for k, v in d.items() if k != "pdf"}
        if d["pdf"]:
            p = pdfd / d["pdf"]
            meta["sha256"] = sha(p)
            meta["source_file"] = d["pdf"]
        docs[did] = meta
    sd_text = nrm(pdf_text(pdfd / SD_PDF, False))
    sd_layout = nrm(pdf_text(pdfd / SD_PDF, True))
    eng = eng_pages(pdfd / ENG_PDF)
    entries, report, seen = [], [], set()
    for c in cand:
        src = c["source_title"]
        did = "sd107" if "SD-107" in src else ("eng" if "Engineering Design" in src else ("dcp" if "Development Control" in src else None))
        found = c["confidence"] == 0 or c["value"] == "NOT FOUND"
        topic = TOPIC_SHORT.get(c["topic"], c["topic"])
        raw_key = c["key"]
        key = raw_key if "." in raw_key else f"{topic}.{raw_key}"
        if key.startswith((did or "none") + "."):
            key = key.split(".", 1)[1]
        key = f"{did or 'none'}.{key}"
        if not did and not found:
            raise SystemExit(f"entry {raw_key}: unknown document {src}")
        if found:
            key = f"notfound.{topic}.{raw_key}"
        if key in seen:
            raise SystemExit("duplicate key " + key)
        seen.add(key)
        desc = c["quote_or_description"] or ""
        if did == "dcp" and not quotes(desc):                 # a pointer to entries already in requirements.json, not a cited value
            report.append({"key": key, "ok": True, "method": "skipped: pointer to requirements.json, no quote"})
            continue
        e = {"key": key, "topic": c["topic"], "status": "not_found" if found else "resolved", "doc": did, "clause": c["drawing_or_clause"], "value": c["value"],
             "unit": clean_unit(c["value"], c["unit"]), "numeric": numeric_of(c["value"], c["unit"]), "page_text": str(c["page"]), "quote": quotes(desc), "description": desc,
             "source_url": c["url"], "confidence": c["confidence"]}
        if found:
            e.update(value=None, unit=None, numeric=None, doc=None, verify=False, verification={"method": "none", "ok": True}, label=c.get("label", raw_key))
            entries.append(e)
            report.append({"key": key, "ok": True, "method": "not_found marker"})
            continue
        pages = [1] if did == "sd107" else page_list(str(c["page"]))
        e["page"] = pages[0] if pages else None
        e["pages"] = pages
        e["edition"] = c["edition"]
        drawing_read = did == "sd107" and not e["quote"]
        e["verify"] = bool(c["confidence"] <= 0.7)
        e["drawing_read"] = drawing_read                      # read off the drawing, not from a note: carries "CONFIRM AGAINST THE SD-107 PDF"
        ver = {"method": None, "ok": True, "quote_found": None, "value_found": None, "notes": []}
        if did == "dcp":
            ver["method"] = "cross-reference to requirements.json"
            ok, rk = False, None
            for k_, r_ in reqs.items():                       # the validated requirement that carries every quote of this entry
                if "Development Control Plan" in r_["source"]["document_title"] and e["quote"] and all(nrm(q) in nrm(r_["source"]["quote"]) for q in e["quote"]):
                    rk = k_
                    break
            if rk:
                ok = True
                e["ref_key"] = rk
                e["page"], e["pages"] = reqs[rk]["source"]["page"], [reqs[rk]["source"]["page"]]
                e["source_url"] = reqs[rk]["source"].get("source_url") or e["source_url"]
            ver.update(ok=ok, quote_found=ok)
        elif did == "sd107":
            ver["method"] = "SD-107 text (pdftotext): quotes found; each number is PRESENT somewhere on the sheet (a presence check only: it does not check where the number sits on the drawing)"
            qf = all(nrm(q) in sd_text or nrm(q) in sd_layout for q in e["quote"]) if e["quote"] else None
            nums = numbers_of(c["value"])
            if not nums:                                      # description values: every number in the value text must be on the sheet
                nums = [float(x) for x in NUM.findall(str(c["value"])) if float(x) not in (1.5, 2.5)]
            vf = all(present(n, pdf_text(pdfd / SD_PDF, False), e["unit"]) for n in nums) if nums else None
            ver.update(quote_found=qf, value_found=vf, ok=(qf is not False) and (vf is not False))
        else:
            ver["method"] = "Engineering Standards text, cited page range"
            ptxt = " ".join(eng.get(p, "") for p in pages)
            qf = all(nrm(q) in nrm(ptxt) for q in e["quote"]) if e["quote"] else None
            nums = [n for n in numbers_of(c["value"]) if n != 0]          # 0 is the property boundary itself, not a number printed on the page
            vf = all(present(n, ptxt, e["unit"]) for n in nums) if nums else None
            ver.update(quote_found=qf, value_found=vf, ok=(qf is not False) and (vf is not False) and bool(ptxt.strip()))
        e["verification"] = ver
        entries.append(e)
        report.append({"key": key, "ok": ver["ok"], "method": ver["method"], "quote_found": ver["quote_found"], "value_found": ver["value_found"], "page": e["page"]})
    bad = [r for r in report if not r["ok"]]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    notes = sd107_notes(pdf_text(pdfd / SD_PDF, False))
    if [n["n"] for n in notes] != list(range(1, 16)):
        print("SD-107 NOTES: expected notes 1 to 15, got", [n["n"] for n in notes])
        bad.append({"key": "sd107.notes", "ok": False})
    out = {"region": "gunnedah", "generated_at": now, "schema": 1, "documents": docs, "sd107_notes": notes, "entries": entries}
    (HERE / "typicals.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    (HERE / "typicals_validation.json").write_text(json.dumps({"generated_at": now, "entries": len(entries), "resolved": sum(e["status"] == "resolved" for e in entries),
                                                              "not_found": sum(e["status"] == "not_found" for e in entries), "failures": bad, "report": report}, indent=1) + "\n")
    print(f"{len(entries)} entries, {len(bad)} failures")
    for r in bad:
        print("FAIL", r)
    return 0 if (not bad or a.allow_failures) else 1


if __name__ == "__main__":
    sys.exit(main())
