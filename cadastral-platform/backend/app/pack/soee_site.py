"""JCESITE Statement of Environmental Effects (SoEE), SITE WORKS ONLY: deterministic, sourced, drafting aid.

JCESITE is a platform product and is NOT affiliated with JCE Infrastructure: nothing here reads the JCE Brand.

Scope (owner decision): the civil and site works shown on the JCESITE plan set (crossover and layover, driveway, earthworks, stormwater, erosion and
sediment control, indicative services connections, site constraints).  The building is designed by others with a separate tool and is described only as
BUILDING_BY_OTHERS: no dwelling floor area, height, setback, floor level or BASIX content is ever stated or assumed.

Rules this module follows (see also app/pack/STATUS.md):
  * Every statement carries a ``source`` (a data field, a plan set sheet or a cited document with page) and is written to the JSON sidecar.
  * No requirement value is typed here: every value, quote and page comes from the requirements knowledge files (knowledge/gunnedah, knowledge/esc) at
    run time.  A control with no citable value is UNRESOLVED.  PASS or FAIL is given only by a numeric comparison of a cited value with a data value.
  * NOT CHECKED is never written as clear.  Blocked source documents are listed NOT REVIEWED, UNRESOLVED.  Assumed values are labelled
    ASSUMED / PLATFORM DEFAULT.
  * Formal register, no contractions, no em or en dashes (``app.report.fmt.clean`` at the single choke point), dates as DD/MM/YYYY.
  * Deterministic text assembly: no language model writes the statement text.  The requirement values it cites were extracted by an AI model upstream (quotes and pages validated, not person verified).  (``app.pack.soee`` keeps the guarded LLM client for the general SoEE; it is not needed here.)

Inputs are plain data (``SoeeSiteInputs``) so the builder can be tested without a pipeline run.  ``extract_site_works`` reads the plan set input and
result of a run into a JSON safe dict.  Writers (DOCX, PDF, JSON) are in ``soee_site_out.py``.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from app.agents.requirements.models import Requirement, RequirementSet, UnresolvedRequirement
from app.agents.sa5_cad_dxf.planset import codes as PC
from app.pack.compliance import GUNNEDAH, load_requirements
from app.report import explain, fmt
from app.report.sections import UNRESOLVED_TOPICS

BACKEND = Path(__file__).resolve().parents[2]
KNOW = BACKEND / "knowledge"

AI_STATEMENT = PC.AI_STATEMENT
BRAND = PC.PLATFORM_BRAND
BUILDING_BY_OTHERS = "BUILDING DESIGN BY OTHERS, TO BE COMPLETED BY THE APPLICANT"
DOC_TITLE = "STATEMENT OF ENVIRONMENTAL EFFECTS"

# Tags (shown in bold before a statement).  A statement with no tag is a plain fact from data or a cited document.
T_NC, T_UNRES, T_NOTREV = "NOT CHECKED", "UNRESOLVED", "NOT REVIEWED, UNRESOLVED"
T_DNA, T_ASSUMED, T_NA = "DATA NOT AVAILABLE", "ASSUMED / PLATFORM DEFAULT", "NOT ASSESSED"
T_ASSUMED1 = "ASSUMED"                              # an assumption that is not a platform default value (for example that the lot is vacant)
T_IND = "INDICATIVE, 5 m DEM"                       # a level or a value derived from the sourced 5 m digital elevation model (not an assumption)
T_BLD, T_FIX = "BUILDING DESIGN BY OTHERS", "OFFLINE FIXTURE"
OPEN_TAGS = (T_NC, T_UNRES, T_NOTREV, T_DNA, T_NA)

# One statement of method, used on the cover page notes, in document control and in the limitations (they must not disagree).
METHOD_TEXT = ("The text of this statement is assembled by software from the project data and from cited documents, using fixed wording. No language model writes the text. "
               "Each statement is traced to a data field or to a cited document and page (soee.json). The requirement values used here (limits, dimensions and thresholds) were extracted by an AI model "
               "from the cited documents. The quotes and page numbers were validated by software against the documents. The values have not been verified by a person.")

# EP&A Act section 4.15(1) headings (the Act text itself was NOT obtained in this run).
S415 = [
    ("a_i", "Section 4.15(1)(a)(i): environmental planning instruments"),
    ("a_ii", "Section 4.15(1)(a)(ii): proposed instruments"),
    ("a_iii", "Section 4.15(1)(a)(iii): development control plans"),
    ("a_iiia", "Section 4.15(1)(a)(iiia): planning agreements"),
    ("a_iv", "Section 4.15(1)(a)(iv): the regulations"),
    ("b", "Section 4.15(1)(b): likely impacts of the development"),
    ("c", "Section 4.15(1)(c): suitability of the site"),
    ("d", "Section 4.15(1)(d): submissions"),
    ("e", "Section 4.15(1)(e): public interest"),
]
# The twelve matters assessed in section 5 (headings; the number is added by the builder).
MATTERS = ["Context and setting", "Access and traffic", "Stormwater", "Earthworks and erosion", "Flooding", "Bushfire", "Heritage", "Biodiversity",
           "Services", "Social and economic", "Site suitability", "Public interest"]

ACRONYMS = {"dbyd": "BYDA", "dcdb": "DCDB", "escp": "ESCP", "dem": "DEM", "ahd": "AHD", "lga": "LGA", "sa3": "SA3", "sa4": "SA4", "sa10": "SA10", "bca": "BCA",
            "s88b": "s88B", "b85": "B85", "ffl": "FFL", "rl": "RL", "gda2020": "GDA2020", "mga": "MGA", "bysa": "BYDA", "byda": "BYDA"}


# ---------------------------------------------------------------------------------------------------------------------- text helpers
DEV_WORDS = [                                   # internal or tooling wording -> plain wording for a reader (applied at the single text choke point)
    (r"\b(?:in|for) this run\b", "for this draft"), (r"\bThe run holds\b", "The project data hold"), (r"\bthe run holds\b", "the project data hold"), (r"\bthe run data\b", "the project data"), (r"\brun data\b", "project data"),
    (r"\bSA10 layout\b", "erosion and sediment control layout"), (r"\bthe SA10 result\b", "the layout result"), (r"\bSA3 driveway result\b", "platform driveway calculation"),
    (r"\bSA3 driveway\b", "platform driveway"), (r"\bSA10\b", "platform layout"), (r"\bSA3\b", "platform"),
]


def T(s: Any) -> str:
    """Single text choke point: no em or en dashes, m2 and m3 written plainly, internal tool names and run wording replaced by plain wording."""
    t = fmt.clean(s).replace("²", "2").replace("³", "3").replace("’", "'").replace("‘", "'")
    for rx, to in DEV_WORDS:
        t = re.sub(rx, to, t)
    return t


def sentence_case(s: str) -> str:
    """UPPERCASE drawing note text -> readable sentence (acronyms restored).  Mixed case text keeps its case, with a capital first letter and a full stop."""
    s = T(s).strip()
    if not s:
        return s
    if s == s.upper():
        low = s.lower()
        low = re.sub(r"[a-z0-9]+", lambda m: ACRONYMS.get(m.group(0), m.group(0)), low)
        s = low[:1].upper() + low[1:]
    else:
        s = re.sub(r"\bDcdb\b", "DCDB", s)
        s = re.sub(r"\.\s+not checked, not clear\.?$", ". Not checked is not clear.", s)
        s = s[:1].upper() + s[1:]
    return s if s.endswith((".", "?", "!")) else s + "."


def dmy(d: date | str | None) -> str:
    return fmt.hdate(d, "date not stated")


def num(v: float | None, dp: int = 1) -> str:
    return "n/a" if v is None else f"{v:,.{dp}f}"


def _expand_initialism(text: str, r: Requirement) -> str:
    """A cited value may carry the council's own initialism (for example the initials of the council name).  It is written out in full from the source title."""
    m = re.match(r"(.+? Council)\b", (r.source.document_title if r.source else "") or "")
    if not m:
        return text
    ini = "".join(w[0] for w in m.group(1).split() if w[:1].isupper())
    return re.sub(r"\b" + re.escape(ini) + r"\b", m.group(1), text) if len(ini) >= 3 else text


def reqval(r: Requirement) -> str:
    v = r.value
    if isinstance(v, bool):
        return "required" if v else "not required"
    if isinstance(v, float):
        t = f"{v:g}"
        u = {"percent": "%", "count": "", "ratio (1 in N)": " (1 in N)", None: ""}.get(r.unit, f" {r.unit}")
        return t + u
    return _expand_initialism(T(v), r)


def cite_dict(r: Requirement | None) -> dict | None:
    if r is None or r.source is None:
        return None
    s = r.source
    return {"key": r.key, "document": T(s.document_title), "authority": T(s.authority), "version": T(s.version or ""), "page": s.page,
            "section": T(s.section_ref or ""), "quote": fmt.shorten_quote(s.quote, 400), "sha256": s.sha256 or None, "confidence": r.confidence}


def vtxt(v: str | None) -> str:
    v = T(v or "")
    if not v:
        return ", version not recorded"
    return f", {v}" if ("(" in v or v.lower().startswith(("version", "last updated"))) else f", version {v}"


def cite_ref(r: Requirement) -> str:
    s = r.source
    return f"{T(s.document_title)}, {T(s.section_ref or 'section not recorded')}, page {s.page}"

def _confirm_label(key: str, el: dict) -> str:
    """Readable text for a requirement key still to be confirmed.  The group of the key (for example "stockpile") is replaced by the element's own type when the two differ,
    because SA10 applies one cited rule to several element types (a laydown area uses the stockpile setback key) and the table must not call a laydown area a stockpile."""
    tail = key.split(".", 1)[-1]
    group, _, rest = tail.partition(".")
    kind = str(el.get("kind") or "").strip().lower()
    if rest and kind and kind not in (group, "topsoil") and group in ("stockpile", "topsoil") and kind != "fence":
        tail = f"{kind}.{rest}"
    return sentence_case(re.sub(r"_m$", "", tail).replace(".", ": ").replace("_", " ")).rstrip(".")


def _esc_whole_lot_text(esc: dict) -> str:
    """Sentence for items SA10 drew at an unresolved position (whole lot search), from its warning and element status; '' when there are none."""
    wl = [x.lower() for x in esc.get("whole_lot") or []]
    if not wl:
        return ""
    return (f"Drawn on C500 at an unresolved position: {_join_and(wl)}. No position outside the building envelope meets the cited clearances, so the whole lot was searched "
            "and these items may sit where the building will be (see the basis panel on C500). To be confirmed once the building footprint is known.")


def read_esc_output(esc_dir: Path | None) -> dict:
    """Summary of the SA10 erosion and sediment control output files written next to the plan set (escp_*.geojson and escp_*_report.md).
    Only the control list, quantities, platform status, the items still to be confirmed and the stated flow direction are read.  Nothing is invented."""
    out: dict[str, Any] = {"elements": [], "flow_text": None, "flow_bearing_deg": None, "flow_assumed": None, "flow_pct": None, "files": [], "warnings": [], "not_drawn": [], "whole_lot": [],
                           "access_length_m": None, "access_width_m": None}
    if esc_dir is None or not Path(esc_dir).exists():
        return out
    gj = sorted(Path(esc_dir).glob("escp_*.geojson"))
    md = sorted(Path(esc_dir).glob("escp_*_report.md"))
    confirm: dict[str, list[str]] = {}
    if md:
        text = md[0].read_text()
        out["files"].append(md[0].name)
        m = re.search(r"^- Flow: (.+)$", text, re.M)
        if m:
            ft = re.sub(r"\*\*", "", m.group(1))
            out["flow_text"] = ft
            out["flow_assumed"] = "assumed" in ft.lower()
            mb = re.search(r"bearing (\d+(?:\.\d+)?) deg", ft)
            out["flow_bearing_deg"] = float(mb.group(1)) if mb else None
            mp = re.search(r"fall (\d+(?:\.\d+)?)\s*%", ft)
            out["flow_pct"] = float(mp.group(1)) if mp else None
        wm = re.search(r"^## Warnings\s*\n(.*?)(?:^## |\Z)", text, re.M | re.S)
        if wm:
            out["warnings"] = [x[2:].strip() for x in wm.group(1).splitlines() if x.startswith("- ")]
            out["not_drawn"] = [x for x in out["warnings"] if "not drawn" in x.lower()]
            wl: list[str] = []                      # items SA10 drew by searching the whole lot (position unresolved), named by its own warning
            for x in out["warnings"]:
                mw = re.search(r":\s*(.+?)\s+placed by searching the whole lot", x)
                if mw:
                    wl += [n.strip() for n in mw.group(1).split(", ") if n.strip()]
            out["whole_lot"] = wl
        for row in re.findall(r"^\| (\S+) \| .*? \| .*? \| (?:resolved|unresolved) \| .*? \| (.*?) \|$", text, re.M):
            confirm[row[0]] = [x.strip() for x in row[1].split(",") if x.strip() and x.strip() != "-"]
    if gj:
        out["files"].append(gj[0].name)
        for f in json.loads(gj[0].read_text()).get("features", []):
            pr = f.get("properties", {})
            out["elements"].append({"id": pr.get("id"), "label": pr.get("label"), "kind": pr.get("kind"), "quantity": _f(pr.get("quantity")), "unit": pr.get("quantity_unit"),
                                    "status": pr.get("status"), "confirm": confirm.get(pr.get("id"), pr.get("unresolved_keys") or [])})
            if pr.get("kind") == "access" and out["access_length_m"] is None:      # drawn length and width: the sides of the smallest rectangle round the access polygon
                try:
                    from shapely.geometry import shape
                    c = list(shape(f["geometry"]).minimum_rotated_rectangle.exterior.coords)
                    sides = sorted(math.dist(c[i], c[i + 1]) for i in range(2))
                    out["access_width_m"], out["access_length_m"] = round(sides[0], 2), round(sides[1], 2)
                except Exception:  # noqa: BLE001
                    pass
    if out["whole_lot"]:                         # claim "drawn" only for items that are elements of the output with an unresolved status
        lab = [(str(e.get("label") or "").lower(), str(e.get("status") or "").lower()) for e in out["elements"]]
        out["whole_lot"] = [n for n in out["whole_lot"] if any(n.lower() in l and st == "unresolved" for l, st in lab)]
    return out


# ---------------------------------------------------------------------------------------------------------------------- inputs
@dataclass
class SoeeSiteInputs:
    constraints: dict | None                    # SA9 constraints_report.json (layers, meta, report.findings)
    run: dict                                   # run_steps.json ({"facts": {...}, "steps": [...]})
    works: dict                                 # extract_site_works(...)
    requirements: RequirementSet                # Gunnedah knowledge plus the ESC knowledge
    sources: list[dict]                         # knowledge manifest rows (obtained and blocked), plus pathway blocked list
    today: date = field(default_factory=date.today)
    job: str = ""
    revision: str = "A"
    maps: list[dict] | None = None              # planning map records (site report JSON "planning_maps"); None reads them from constraints["report"]
    maps_dir: Path | None = None                # folder that holds the map PNGs written by the site report (a map without a PNG is not listed)
    synthetic_demo: bool = False                # SYNTHETIC DEMO DATA: stamped on the cover and in every footer


def load_requirement_set() -> RequirementSet:
    g = load_requirements()
    e = load_requirements(KNOW / "esc" / "requirements.json")
    return RequirementSet(requirements=list(g.requirements) + list(e.requirements))


def _src_key(title: str) -> str:
    t = (title or "").lower()
    t = re.sub(r"\s*\((?:land use|schedule|bal/apz)[^)]*\)\s*$", "", t)
    t = re.sub(r"\s+incl\..*$", "", t)
    t = t.replace("state environmental planning policy", "sepp")
    return re.sub(r"\W+", "", t)[:60]


def _clean_title(title: str) -> str:
    """A source title as shown to a reader: no clause or schedule numbers (the Regulation was not obtained, so none can be cited), no alternative titles."""
    t = T(title)
    t = re.sub(r"\s*\((?:Schedule|Sch|cl)\b[^)]*\)", "", t)
    t = re.sub(r"\s*/\s*(?:EP&A|Environmental Planning).*$", "", t)
    return t.strip()


def _clean_reason(title: str, reason: str) -> str:
    """Why a source was not read, in plain words.  Tooling detail (how a download failed, how a file was handled) is not shown to a reader."""
    r = T(reason or "")
    low = r.lower()
    if not r:
        return "The document could not be obtained in this run."
    if "scanned image" in low or "no text layer" in low:
        return "The stored copy is a scanned image without a text layer, so it could not be read in this run."
    if re.search(r"cloudflare|bot challenge|403|curl|chromium|mirror", low):
        return "The document could not be obtained in this run."
    if "no obtainable" in low or "no official" in low or "not located" in low or "located" in low:
        extra = " The council statement of environmental effects form is used as a topic guide only." if "soee" in low or "statement" in T(title).lower() else ""
        return "A source for this document could not be obtained in this run." + extra
    r = re.sub(r"\b(?:ingested?|ingest|OCR)\b", "read", r, flags=re.I)
    return r


def load_sources() -> list[dict]:
    """Source documents: knowledge/manifest.json (Gunnedah and NSW) + knowledge/esc/sources.json + the pathway sources (the council SoEE form) and the
    pathway blocked list (EP&A Regulation etc.).  Rows: {id, title, version, status, reason, authority, sha256, retrieved_at}.  Status is obtained,
    blocked, not_ingested (stored but not read, for example a scanned image) or not_used (stored, not used for any requirement).  The Act itself is in
    no manifest (the builder adds it)."""
    rows: list[dict] = []
    seen: set[str] = set()

    def add(i, title, version, status, reason, authority="", sha="", retrieved=""):
        title = _clean_title(title)
        key = _src_key(title)
        if key in seen:
            return
        seen.add(key)
        reason = _clean_reason(title, reason) if status != "obtained" else (reason or "")
        rows.append({"id": i, "title": title, "version": version or "", "status": status, "reason": reason, "authority": authority or "", "sha256": sha or "", "retrieved_at": retrieved or ""})

    for x in json.loads((KNOW / "manifest.json").read_text())["sources"]:
        st = "obtained" if x.get("status") == "obtained" else "blocked"
        why = x.get("blocked_reason") or x.get("notes", "") if st != "obtained" else ""
        if st == "obtained" and x.get("ingest") is False:
            st = "not_used" if re.search(r"not used|taken from", x.get("notes", ""), re.I) else "not_ingested"
            why = x.get("notes", "")
        add(x["id"], x["title"], x.get("version"), st, why, x.get("authority", ""), x.get("sha256", ""), x.get("retrieved_at", ""))
    p = KNOW / "esc" / "sources.json"
    if p.exists():
        for x in json.loads(p.read_text())["sources"]:
            add(x["id"], x["title"], x.get("version"), "obtained" if x.get("status") == "obtained" else "blocked", x.get("reason", ""), x.get("authority", ""), x.get("sha256", ""), x.get("retrieved_at", ""))
    p = KNOW / "pathway" / "sources.json"
    if p.exists():
        pj = json.loads(p.read_text())
        for x in pj.get("sources", []):
            if x["id"] == FORM_ID:
                add(x["id"], x["title"], x.get("version"), "obtained", "", x.get("authority", ""), x.get("sha256", ""), x.get("retrieved_at", ""))
        for bl in pj.get("blocked", []):
            add(bl["id"], bl["title"], "", "blocked", bl.get("reason", ""), "")
    return rows


FORM_ID = "g_soee_form"
PATHWAY = KNOW / "pathway"


def form_cite(phrase: str, page: int) -> dict | None:
    """Citation into the Gunnedah Shire Council SoEE form (knowledge/pathway/raw/g_soee_form.pdf), only when the phrase is found on that PDF page.
    The phrases used are topic headings or questions of the form (not requirement values)."""
    try:
        import pymupdf
        meta = next(x for x in json.loads((PATHWAY / "sources.json").read_text())["sources"] if x["id"] == FORM_ID)
        with pymupdf.open(str(PATHWAY / "raw" / meta["file"])) as pd:
            txt = re.sub(r"\s+", " ", pd[page - 1].get_text())
        if re.sub(r"\s+", " ", phrase).lower() not in txt.lower():
            return None
        return {"key": f"form.{page}", "document": T(meta["title"]), "authority": T(meta["authority"]), "version": T(meta["version"]), "page": page, "section": "council form",
                "quote": fmt.shorten_quote(phrase, 300), "sha256": meta["sha256"], "confidence": None}
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------------------------------------------------- extraction from a run
def _f(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


PLAN_MARKERS = {                                     # text printed on a plan sheet that records a gap or a non-design value -> key
    "council_standard_not_selected": r"NOT SELECTED",
    "tbc": r"\bTBC\b",
    "platform_default": r"PLATFORM DEFAULT",
    "placeholder": r"PLACEHOLDER",
    "no_verge_design": r"NO VERGE DESIGN",
}
PLAN_FEATURES = {"section_aa": r"SECTION A-A"}         # text printed on a sheet that records something drawn (not a gap)
TEXT_SHEETS = ("C000", "C001")                       # the cover and the general notes list the gaps; they are not drawings with gaps of their own


def scan_plan_pdf(pdf: Path | None, built_numbers: list[str], markers: dict | None = None) -> dict | None:
    """Per sheet, which gap markers (PLAN_MARKERS) are printed on the built plan set PDF.  Pages follow the sheet order, so the page count must equal the number of
    sheets built, otherwise nothing is claimed (None)."""
    if pdf is None or not Path(pdf).exists():
        return None
    try:
        import pymupdf
        with pymupdf.open(str(pdf)) as pd:
            if len(pd) != len(built_numbers):
                return None
            out: dict[str, list[str]] = {}
            for n, pg in zip(built_numbers, pd):
                if n in TEXT_SHEETS:
                    continue
                txt = re.sub(r"\s+", " ", pg.get_text()).upper()
                out[n] = [k for k, rx in (markers or PLAN_MARKERS).items() if re.search(rx, txt)]
            return out
    except Exception:  # noqa: BLE001
        return None


def extract_site_works(inp, planset_result: dict | None, *, probe_imagery: bool = True, esc_dir: Path | None = None, plan_pdf: Path | None = None, site=None, project_name: str | None = None) -> dict:
    """Plan set input (``PlansetInput``) and result of ``build_planset`` -> JSON safe dict of site works data.  Every step is guarded: a failure is
    recorded in ``notes`` and the field stays empty (the SoEE then says DATA NOT AVAILABLE).  The building footprint, pad and floor level that the
    platform computes internally for a preset building are NEVER read: only the driveway, crossover, levels and sheet data."""
    import numpy as np
    from shapely import wkt as swkt
    from shapely.geometry import LineString, Point

    w: dict[str, Any] = {"notes": []}
    lot = inp.lot

    def note(msg: str) -> None:
        w["notes"].append(msg)

    # ---- lot, boundaries, adjoining lots
    poly = swkt.loads(lot.boundary_wkt)
    if poly.geom_type != "Polygon":
        poly = max(poly.geoms, key=lambda p: p.area)
    segs = []
    for sg in lot.segments:
        ls = LineString([sg.start_xy, sg.end_xy])
        adj, shared = None, 0.0
        for n in lot.neighbours:
            try:
                ln = swkt.loads(n.wkt).intersection(ls).length
            except Exception:  # noqa: BLE001
                continue
            if ln > max(shared, 0.5):
                adj, shared = n.label, ln
        segs.append({"seq": sg.seq, "bearing_dms": sg.bearing_dms, "bearing_deg": _f(sg.bearing_deg), "length_m": _f(sg.distance_m), "adjoins": sg.adjoins,
                     "is_front": bool(sg.is_front), "neighbour": adj, "shared_m": _f(shared) if adj else None})
    w["lot"] = {"lotplan": lot.lotplan, "lga_name": lot.lga_name, "jurisdiction": lot.jurisdiction, "area_m2_calculated": _f(lot.area_m2_calculated),
                "area_m2_registered": _f(lot.area_m2_registered), "zone_code": lot.zone_code, "road_names": list(lot.road_names), "mga_srid": lot.mga_srid,
                "segments": segs, "neighbours": [{"label": n.label, "is_road": bool(n.is_road)} for n in lot.neighbours]}

    # ---- site built by the plan set code (levels only are used from it)
    if site is None:                                  # the Site that the plan set was drawn from (generate.LAST_SITE) is preferred, so the SoEE reads the same levels
        try:
            from app.agents.sa5_cad_dxf.planset.data import build_site
            site = build_site(inp)
        except Exception as ex:  # noqa: BLE001
            note(f"plan set site data not rebuilt ({type(ex).__name__}: {ex})")

    # ---- terrain (existing ground, 5 m DEM or survey)
    ter: dict[str, Any] = {"available": False}
    if site is not None and site.tin is not None:
        try:
            tin = site.tin
            xs = np.arange(site.lot.bounds[0], site.lot.bounds[2], 1.0)
            ys = np.arange(site.lot.bounds[1], site.lot.bounds[3], 1.0)
            pts = [(x, y) for x in xs for y in ys if site.lot.contains(Point(x, y))]
            P = np.array(pts)
            z = np.array([float(tin.z_at(x, y)) for x, y in pts])
            m = np.isfinite(z)
            A = np.c_[np.ones(m.sum()), P[m, 0] - P[m, 0].mean(), P[m, 1] - P[m, 1].mean()]
            c = np.linalg.lstsq(A, z[m], rcond=None)[0]
            gx, gy = float(c[1]), float(c[2])
            mx = 0.0
            V, Tr = tin.vertices, tin.triangles.astype(int)
            from shapely.geometry import Polygon
            for t in Tr:
                a, b, cc = V[t]
                Mx = np.array([[b[0] - a[0], b[1] - a[1]], [cc[0] - a[0], cc[1] - a[1]]])
                try:
                    g = np.linalg.solve(Mx, np.array([b[2] - a[2], cc[2] - a[2]]))
                except np.linalg.LinAlgError:
                    continue
                if Polygon(V[t][:, :2]).intersects(site.lot):
                    mx = max(mx, 100.0 * float(np.hypot(*g)))
            ter = {"available": True, "source": site.tin_source, "samples": int(m.sum()), "lot_min_m": _f(z[m].min()), "lot_max_m": _f(z[m].max()),
                   "avg_fall_pct": 100.0 * math.hypot(gx, gy), "fall_bearing_deg": (math.degrees(math.atan2(-gx, -gy)) + 360.0) % 360.0, "max_gradient_pct": mx}
            try:   # angle between the fall and the direction from the lot to the road (0 = straight towards the street, 180 = straight away from it)
                fr = [sg for sg in lot.segments if sg.is_front]
                if fr:
                    a_, b_ = np.array(fr[0].start_xy, float), np.array(fr[0].end_xy, float)
                    u_ = (b_ - a_) / np.linalg.norm(b_ - a_)
                    n_ = np.array([-u_[1], u_[0]])
                    if float(np.dot(n_, (a_ + b_) / 2 - np.array(poly.centroid.coords[0]))) < 0:
                        n_ = -n_
                    br = math.radians(ter["fall_bearing_deg"])
                    dot = float(np.dot(n_, np.array([math.sin(br), math.cos(br)])))
                    ter["fall_vs_street_deg"] = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
            except Exception as ex:  # noqa: BLE001
                note(f"fall relative to the street not computed ({type(ex).__name__})")
        except Exception as ex:  # noqa: BLE001
            note(f"terrain statistics not computed ({type(ex).__name__}: {ex})")
        try:   # the fall and discharge note exactly as the plan sheets C300 and C500 state them (planset/terrain_notes.py)
            if not ter.get("available"):
                raise ValueError("no terrain statistics")
            from app.agents.sa5_cad_dxf.planset import terrain_notes as TN
            f_ = TN.dem_fall(site)
            if f_ is not None:
                ter["avg_fall_pct"], ter["fall_bearing_deg"], ter["fall_levels"] = float(f_["pct"]), float(f_["bearing"]), int(f_["n"])
                ter["fall_basis"] = "planset.terrain_notes.dem_fall"
            c_ = TN.fall_vs_street(site)
            ter["fall_away_c"] = _f(c_)
            ter["plan_discharge_note"] = TN.drainage_discharge_note(site)
        except Exception as ex:  # noqa: BLE001
            note(f"plan set terrain notes not read ({type(ex).__name__}: {ex})")
    w["terrain"] = ter

    # ---- driveway, crossover, layover, profile checks
    drv = inp.driveway
    d: dict[str, Any] = {"present": drv is not None}
    if drv is not None and site is not None:
        d.update(width_m=_f(drv.width_m), design_vehicle=drv.design_vehicle, council_standard_label=drv.council_standard_label, max_grade_pct=_f(drv.max_grade_pct),
                 kerb_user_supplied=drv.kerb_to_boundary_user_supplied, length_m=_f(site.drive_cl.length) if site.drive_cl is not None else None,
                 crossings=1 if site.crossover is not None else 0)
        d["sa3_checks"] = [{"name": c.name, "passed": c.passed, "value": _f(c.value), "limit": _f(c.limit), "unit": c.unit, "note": c.note} for c in inp.driveway_checks]
        try:   # distance from the crossover to the common (side) boundaries, boundary lines extended 40 m beyond each end
            fronts = [sg for sg in lot.segments if sg.adjoins == "road" or sg.is_front]

            def _touches(sg) -> bool:
                return any(math.dist(e1, e2) < 0.5 for f_ in fronts for e1 in (sg.start_xy, sg.end_xy) for e2 in (f_.start_xy, f_.end_xy))
            others = [sg for sg in lot.segments if sg not in fronts]
            sides = [sg for sg in others if _touches(sg)]            # the side boundaries are the ones that meet the frontage
            ds = []
            for sg in sides:                                          # only the side boundaries: a rear boundary is not a common boundary of the crossing, so with no side found nothing is computed
                a, b = np.array(sg.start_xy, float), np.array(sg.end_xy, float)
                u = (b - a) / np.linalg.norm(b - a)
                ds.append(site.crossover.distance(LineString([tuple(a - 40 * u), tuple(b + 40 * u)])))
            d["crossover_to_common_boundary_m"] = _f(min(ds)) if ds else None
            d["common_boundary_basis"] = "side" if sides else None
        except Exception as ex:  # noqa: BLE001
            note(f"crossover to common boundary distance not computed ({type(ex).__name__})")
        try:
            from app.agents.sa5_cad_dxf.planset import crossover as CX
            from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
            front, _drv, _std, xg = S2.make_xg(site)
            d["layover"] = [{"key": r["key"], "label": r["label"].title(), "m": _f(r["m"]), "src": r["src"], "placeholder": bool(r["placeholder"])} for r in CX.layover_values(xg, front)]
            d["frontage"] = CX.frontage_text(front) if front is not None else None
            d["swept_path_drawn"] = bool(S2.swept_ok(site, xg))
            p = S2.ref_profile(site)
            if p is not None:
                st = {nm: (t, zz) for t, zz, nm in p["st"]}
                k = next((v for n, v in st.items() if "KERB LINE" in n.upper()), None)
                b = next((v for n, v in st.items() if "PROPERTY BOUNDARY" in n.upper()), None)
                if k and b and b[0] - k[0] > 0.5:
                    d["kerb_to_boundary_grade_pct"] = 100.0 * (b[1] - k[1]) / (b[0] - k[0])
                d["profile_proposed"] = bool(p["proposed"])
                d["profile_checks"] = [{"name": c.name, "value": _f(c.value), "limit": _f(c.limit), "unit": c.unit, "passed": c.passed} for c in p["checks"]]
            ew = S2.driveway_earthworks(site)
            w["earthworks"] = {"driveway_cut_m3": _f(ew["cut"]), "driveway_fill_m3": _f(ew["fill"])} if ew else {"driveway_cut_m3": None, "driveway_fill_m3": None}
        except Exception as ex:  # noqa: BLE001
            note(f"driveway detail not read from the plan set helpers ({type(ex).__name__}: {ex})")
    w["driveway"] = d
    w.setdefault("earthworks", {"driveway_cut_m3": None, "driveway_fill_m3": None})
    w["earthworks"]["building_pad_included"] = False

    # ---- services and rainwater tank (as supplied to the plan set)
    w["services"] = {"count": len(inp.services), "items": [{"service": s.service, "label": s.label, "proposed": bool(s.is_proposed)} for s in inp.services],
                     "rwt_supplied": inp.rwt is not None}

    # ---- sheets
    res = planset_result or {}
    built = {n: (t, [str(x) for x in miss]) for n, t, miss in res.get("sheets", [])}
    sheets = []
    for n in PC.SHEET_NNN:
        t, miss = built.get(n, (PC.SHEET_TITLES[n], None))
        sheets.append({"number": n, "title": PC.SHEET_TITLES[n], "drawing_number": PC.drawing_number(n, getattr(inp, "job", "") or ""), "built": n in built,
                       "data_missing": miss or []})
    w["sheets"] = sheets
    c500 = built.get("C500")
    w["esc"] = {"shown_on_plan": bool(c500 is not None and not any("ESCP DATA PENDING" in x.upper() for x in c500[1])), "sheet_built": c500 is not None}
    w["esc"].update(read_esc_output(esc_dir))
    w["sheet_markers"] = scan_plan_pdf(plan_pdf, [x["number"] for x in sheets if x["built"]])
    w["sheet_features"] = scan_plan_pdf(plan_pdf, [x["number"] for x in sheets if x["built"]], PLAN_FEATURES)
    w["planset_project"] = project_name
    w["planset_notes"] = [str(x) for x in res.get("notes", [])]
    w["planset_missing"] = {str(k): str(v) for k, v in (res.get("missing") or {}).items()}

    # ---- aerial imagery metadata (capture date), as used under the plan set
    w["aerial"] = None
    if probe_imagery and getattr(inp, "imagery", None) is not None:
        try:
            b = poly.bounds
            r = inp.imagery.fetch((b[0] - 20, b[1] - 20, b[2] + 20, b[3] + 20), lot.mga_srid, (64, 64))
            w["aerial"] = {"capture_date": str(r.meta.capture_date) if r.meta.capture_date else None, "source": str(r.meta.source)}
        except Exception as ex:  # noqa: BLE001
            note(f"imagery metadata not read ({type(ex).__name__})")
    return w


# ---------------------------------------------------------------------------------------------------------------------- document model
@dataclass
class Stmt:
    id: str
    text: str
    source: str
    tag: str = ""
    cite: dict | None = None
    section: str = ""
    kind: str = "statement"             # statement | row (a table row)

    def full(self) -> str:
        return f"{self.tag}. {self.text}" if self.tag else self.text


@dataclass
class Table:
    header: list[str]
    rows: list[list[str]]
    widths: list[float]                  # relative column widths
    sources: list[str]                   # one source per row
    status_col: int | None = None
    ids: list[str] = field(default_factory=list)
    caption: str = ""


@dataclass
class Block:
    kind: str                            # h2 | p | bullets | table | figure | keep (a note that must stay with the next block)
    text: str = ""
    stmts: list[Stmt] = field(default_factory=list)
    table: Table | None = None
    fig: dict | None = None              # kind "figure": {"no", "key", "title", "png"}; the caption is stmts[0]


@dataclass
class Section:
    number: str
    title: str
    blocks: list[Block] = field(default_factory=list)


@dataclass
class SiteSoee:
    title: str
    number: str
    site: str
    locality: str
    council: str
    date: str
    revision: str
    status: str
    sections: list[Section]
    meta: dict
    compliance: list[dict]
    open_items: dict
    mode: str = "deterministic"
    ai_statement: str = AI_STATEMENT

    def statements(self) -> list[Stmt]:
        out = []
        for s in self.sections:
            for b in s.blocks:
                out += b.stmts
                if b.table:
                    out += [Stmt(i, " | ".join(r), src, section=s.number, kind="row") for i, r, src in zip(b.table.ids, b.table.rows, b.table.sources)]
        return out

    def to_text(self) -> str:
        out = [self.title, self.site, self.council, self.date, f"Revision {self.revision}", self.status, self.ai_statement, ""]
        for s in self.sections:
            out.append(f"{s.number} {s.title}")
            for b in s.blocks:
                if b.kind == "h2":
                    out.append(b.text)
                elif b.table:
                    out.append(" | ".join(b.table.header))
                    out += [" | ".join(r) for r in b.table.rows]
                else:
                    out += [st.full() for st in b.stmts] or [b.text]
            out.append("")
        return "\n".join(out)

    def headings(self) -> list[str]:
        return [f"{s.number} {s.title}" for s in self.sections] + [b.text for s in self.sections for b in s.blocks if b.kind == "h2"]


class _Build:
    def __init__(self) -> None:
        self.sections: list[Section] = []
        self.n = 0
        self.cur: Section | None = None
        self.docs_read: Table | None = None

    def sec(self, number: str, title: str) -> None:
        self.cur = Section(number, title)
        self.sections.append(self.cur)

    def _stmt(self, text: str, source: str, tag: str = "", cite: dict | None = None) -> Stmt:
        self.n += 1
        assert source, f"statement without a source: {text[:60]}"
        if tag == T_BLD and BUILDING_BY_OTHERS in text:
            tag = ""                    # the sentence already says it; avoid repeating the label
        if tag:                         # the tag is printed before the text: do not repeat it as the closing words of the text
            text = re.sub(r"[:;,.]?\s*(?:\(" + re.escape(tag) + r"\)|" + re.escape(tag) + r")\.?\s*$", ".", text)
        return Stmt(f"s{self.n:03d}", T(text), source, tag, cite, self.cur.number if self.cur else "")

    def h2(self, text: str) -> None:
        self.cur.blocks.append(Block("h2", T(text)))

    def p(self, text: str, source: str, tag: str = "", cite: dict | None = None) -> Stmt:
        s = self._stmt(text, source, tag, cite)
        self.cur.blocks.append(Block("p", stmts=[s]))
        return s

    def bullets(self, items: list[tuple]) -> None:
        """items: (text, source[, tag[, cite]])"""
        ss = [self._stmt(*it) for it in items]
        if ss:
            self.cur.blocks.append(Block("bullets", stmts=ss))

    def figure(self, info: dict, caption: str) -> None:
        s = self._stmt(caption, f"map:planning_maps[{info['key']}]")
        self.cur.blocks.append(Block("figure", stmts=[s], fig={"no": info["no"], "key": info["key"], "title": info["title"], "png": str(info["png"])}))

    def table(self, header: list[str], rows: list[tuple[list[str], str]], widths: list[float], status_col: int | None = None, caption: str = "") -> None:
        ids = []
        for _ in rows:
            self.n += 1
            ids.append(f"s{self.n:03d}")
        for r, src in rows:
            assert src, "table row without a source"
        self.cur.blocks.append(Block("table", table=Table([T(h) for h in header], [[T(c) for c in r] for r, _ in rows], widths, [s for _, s in rows], status_col, ids, T(caption))))


# ---------------------------------------------------------------------------------------------------------------------- data access helpers
class _Data:
    """Read-only view of the inputs with the lookups the sections need."""

    def __init__(self, inp: SoeeSiteInputs) -> None:
        self.inp = inp
        c = inp.constraints or {}
        self.meta = c.get("meta", {})
        self.layers = {l["key"]: l for l in c.get("layers", [])}
        self.findings = {f["key"]: f for f in (c.get("report") or {}).get("findings", [])}
        self.w = inp.works
        self.lot = self.w.get("lot", {})
        self.facts = (inp.run or {}).get("facts", {})
        self.req = inp.requirements
        self.sel = {"zone": self.lot.get("zone_code") or self.meta.get("zone_code"), "lga": (self.lot.get("lga_name") or self.meta.get("lga_name") or "").title() or None}
        self.sel = {k: v for k, v in self.sel.items() if v}
        self.fixture = "offline_fixture" in (self.meta.get("flags") or []) or "offline_fixture" in (self.lot.get("flags") or [])
        self.figs = _figures(inp)

    def fig(self, key: str) -> dict | None:
        return self.figs.get(key)

    def ref(self, key: str) -> str:
        """'refer Figure n, Title, Appendix A' for a planning map that exists in this document, else ''."""
        f = self.figs.get(key)
        if not f:
            return ""
        tail = " (MAP NOT AVAILABLE: LAYER NOT CHECKED)" if f["rec"].get("state") == "not_checked" else ""
        return f"refer Figure {f['no']}, {f['title']}, Appendix A{tail}"

    def r(self, key: str) -> Requirement | None:
        try:
            return self.req.get_requirement(key, **self.sel)
        except UnresolvedRequirement:
            return None

    @property
    def lot_label(self) -> str:
        lp = self.lot.get("lotplan") or self.meta.get("lotplan") or ""
        m = re.match(r"^(\w+)//(?:DP|SP)?\s*(\w+)$", lp) or re.match(r"^(\w+)/(?:DP|SP)?\s*(\w+)$", lp)
        if self.meta.get("lot_label"):
            return self.meta["lot_label"]
        return f"Lot {m.group(1)} DP {m.group(2)}" if m else (lp or "LOT NOT IDENTIFIED")

    @property
    def locality(self) -> str:
        return (self.lot.get("lga_name") or self.meta.get("lga_name") or "").title()

    @property
    def council(self) -> str:
        for r in self.req.requirements:
            m = re.match(r"(.+? Council)\b", (r.source.document_title if r.source else "") or "")
            if m and self.locality.lower() in m.group(1).lower():
                return m.group(1)
        return f"{self.locality} Council (name not confirmed)" if self.locality else "COUNCIL NOT IDENTIFIED"


def _figures(inp: SoeeSiteInputs) -> dict[str, dict]:
    """Planning maps that can be shown: a record with a PNG on disk.  Figures are numbered 1..n in record order (the SoEE has its own numbering)."""
    recs = inp.maps
    if recs is None:
        recs = ((inp.constraints or {}).get("report") or {}).get("planning_maps") or []
    out: dict[str, dict] = {}
    if not inp.maps_dir:
        return out
    n = 0
    for r in recs:
        name = Path(r.get("png") or "").name
        png = Path(inp.maps_dir) / name if name else None
        if png is None or not png.exists():
            continue
        n += 1
        out[r["key"]] = {"no": n, "key": r["key"], "title": T(r.get("title") or r["key"]), "rec": r, "png": png}
    return out


def _with_ref(d: _Data, key: str, text: str) -> str:
    """Append the figure reference to a statement that relies on a mapped control or constraint (nothing is added when no map exists)."""
    r = d.ref(key)
    if not r:
        return text
    t = text.rstrip()
    return t + ("" if t.endswith(".") else ".") + " " + r[0].upper() + r[1:] + "."


def _layer_line(d: _Data, key: str) -> tuple[str, str, str]:
    """(tag, text, source) for one screening layer: the finding from data, or NOT CHECKED (not checked is not clear)."""
    l, f = d.layers.get(key), d.findings.get(key)
    src = f"data:sa9.layers[{key}]"
    label = (f or {}).get("label") or (l or {}).get("label") or key
    if l is None or l.get("status") == "not_checked":
        why = T(((f or {}).get("why_unchecked") or (l or {}).get("error") or "the layer was not queried in this run").rstrip("."))
        return (T_NC, f"The {label.lower()} layer was not queried in this run. Reason recorded: {why[:1].lower() + why[1:] if why else 'not recorded'}. Not checked is not clear: the lot may be affected, and the layer must be checked directly with the authority.", src)
    head = T((f or {}).get("headline") or "")
    cur = T((f or {}).get("currency") or "")
    tag = ""
    nip = "NOT INTERSECTED BY THE DATA LOADED"
    if head.startswith(nip):
        tag, head = nip, head[len(nip):].lstrip(": ").strip()
        head = head[:1].upper() + head[1:]
    elif (f or {}).get("status") == "nearby":
        tag = "WITHIN BUFFER"
    elif l.get("status") == "affected":
        tag = "MAPPED OR INTERSECTS"
    if not head:
        head = {"affected": "A mapped feature overlaps the lot.", "not_affected": "This describes the data only."}.get(l.get("status"), "Result not recorded.")
    if tag == nip and d.fixture:
        head = head.rstrip(".") + ". This result is from offline fixture data and is not confirmed."
    return (tag, f"{label}: {head}" + (f" ({cur})" if cur else ""), src)


def _cited(d: _Data, key: str, sentence: str, tag: str = "") -> tuple | None:
    r = d.r(key)
    if r is None:
        return None
    return (f"{sentence} [{cite_ref(r)}]", f"doc:{T(r.source.document_title)} page {r.source.page} ({key})", tag, cite_dict(r))


def _form(text: str, phrase: str, page: int, tag: str = "") -> tuple:
    """A statement that cites a topic heading or question of the Gunnedah Shire Council SoEE form (page verified in the PDF at run time)."""
    c = form_cite(phrase, page)
    if c is None:
        return (text + " (the form reference could not be verified in this run)", f"doc:council SoEE form page {page} (not verified)", tag or T_UNRES)
    return (f"{text} [{c['document'].split(' (')[0]}, {c['version']}, page {page}]", f"doc:{c['document']} page {page}", tag, c)


def _unres(d: _Data, text: str, source: str) -> tuple:
    return (text, source, T_UNRES)


# ---------------------------------------------------------------------------------------------------------------------- lists that are counted
# Every count printed in the document is taken from the same list that is rendered (rows of a table or items of a list), so the two cannot differ.
def layer_rows(d: _Data) -> list[dict]:
    """The rows of the screening layer table (section 5.11): label, result, currency, source, plus the finding line used in the text."""
    rows = []
    for key, l in d.layers.items():
        tag, text, src = _layer_line(d, key)
        status = {"affected": "MAPPED OR INTERSECTS", "not_affected": "NOT INTERSECTED BY THE DATA LOADED", "not_checked": "NOT CHECKED"}.get(l["status"], T(l["status"]).upper())
        if d.findings.get(key, {}).get("status") == "nearby":
            status = "WITHIN BUFFER"
        cur = T((d.findings.get(key) or {}).get("currency") or "Currency unknown (layer not queried)")
        rows.append({"key": key, "label": T((d.findings.get(key) or {}).get("label") or l["label"]), "status": status, "currency": cur, "source": src, "tag": tag, "text": text})
    return rows


ACT_ROW_ID = "epa_act_1979"


def not_reviewed(inp: SoeeSiteInputs) -> list[dict]:
    """The documents that were not reviewed: the source rows that could not be obtained or read, plus the Act (it is in no manifest).  Table 4.1 renders this list."""
    rows = [s for s in inp.sources if s["status"] in ("blocked", "not_ingested")]
    rows.append({"id": ACT_ROW_ID, "title": "Environmental Planning and Assessment Act 1979", "version": "", "status": "blocked",
                 "reason": "The Act was not obtained in this run. The section 4.15 headings used in this statement must be checked against the current Act.", "authority": "", "sha256": "", "retrieved_at": ""})
    return rows


GAP_TEXT = {
    "council_standard_not_selected": "Council standard drawing NOT SELECTED. The council standard drawing governs the crossing, kerb, layover and pavement details.",
    "tbc": "Values shown as TBC, because no council value is selected or cited for them.",
    "platform_default": "PLATFORM DEFAULT values are shown. They are not surveyed, not designed and not selected from a council standard.",
    "placeholder": "PLACEHOLDER dimensions are shown. They are drafting conventions and not design values.",
    "no_verge_design": "NO VERGE DESIGN is stated: the design line across the verge is shown as the existing surface from the kerb line to the property boundary, and the layover grade is diagrammatic.",
}


def _count(n: int) -> str:
    """'1 is', '2 are' (a count followed by the verb)."""
    return f"{n} {'is' if n == 1 else 'are'}"


def _plural(n: int, one: str, many: str) -> str:
    """'1 control is', '2 controls are': the count with the matching singular or plural words."""
    return f"{n} {one if n == 1 else many}"


def _join_and(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def build_gaps(d: _Data, comp: list[dict]) -> list[dict]:
    """The data gaps of the plan set, one list for the whole document: the DATA NOT AVAILABLE panels of each sheet, the gap markers printed on each sheet
    (council standard not selected, TBC, platform default, placeholder), items not drawn and a stabilised access shorter than the cited length.
    Section 3.9 renders this list and section 1.2 refers to its item numbers."""
    w = d.w
    reg: dict[str, dict] = {}

    def add(key: str, text: str, sheet: str, source: str) -> None:
        g = reg.setdefault(key, {"text": text, "sheets": [], "source": source})
        if sheet not in g["sheets"]:
            g["sheets"].append(sheet)

    sheets = w.get("sheets", [])
    for sh in sheets:
        if sh.get("built"):
            for m in sh.get("data_missing", []):
                t = sentence_case(m)
                add("panel:" + t.lower(), t, sh["number"], "planset:sheets.data_missing")
    mk = w.get("sheet_markers") or {}
    for sh in sheets:
        for k in mk.get(sh["number"], []):
            add("marker:" + k, GAP_TEXT[k], sh["number"], "planset:sheets (text printed on the sheet)")
    drv, esc = w.get("driveway", {}), w.get("esc", {})
    if drv.get("present") and drv.get("swept_path_drawn") is False:
        add("swept", "Vehicle swept path not drawn, because it does not form one clean path inside the lot, verge and road. To be confirmed at detailed design.", "C400", "data:planset.driveway.swept_path_drawn")
    nd = [x.split(":")[0].strip().lower() for x in esc.get("not_drawn") or []]
    if nd:
        add("esc:not_drawn", f"Not drawn on the erosion and sediment control layout: {_join_and(nd)}. No position meets the cited clearances inside the lot. To be confirmed by the designer or certifier.", "C500", "file:escp_*_report.md")
    wlt = _esc_whole_lot_text(esc)
    if wlt:
        add("esc:whole_lot", wlt, "C500", "file:escp_*_report.md; file:escp_*.geojson")
    for r in comp:
        if r.get("key") == "access_length" and r["status"].startswith("FAIL"):
            add("esc:access_short", f"Stabilised site access drawn {r['value']:.1f} m long, shorter than the cited minimum of {r['limit']:g} m. To be resolved by the ESCP preparer.", "C500", "file:escp_*.geojson")
    return [{"no": i + 1, **g} for i, g in enumerate(reg.values())]


# ---------------------------------------------------------------------------------------------------------------------- the build
def build_site_soee(inp: SoeeSiteInputs) -> SiteSoee:
    d = _Data(inp)
    b = _Build()
    w = d.w
    drv, ter, ew = w.get("driveway", {}), w.get("terrain", {}), w.get("earthworks", {})
    site_label = f"{d.lot_label}, {d.locality} NSW"
    doc_no = f"JCS-{(inp.job or 'XXX').upper()}-SOEE-001"
    comp = _compliance(d)
    cnt = {s: sum(1 for r in comp if r["status"].split(" (")[0] == s) for s in ("PASS", "FAIL", "NOT TRIGGERED", "TRIGGERED", "UNRESOLVED")}
    lrows = layer_rows(d)
    lc = {"layers": len(lrows), "not_checked": sum(1 for r in lrows if r["status"] == "NOT CHECKED"), "affected": sum(1 for r in lrows if r["status"] == "MAPPED OR INTERSECTS"),
          "buffer": sum(1 for r in lrows if r["status"] == "WITHIN BUFFER"), "not_intersected": sum(1 for r in lrows if r["status"] == "NOT INTERSECTED BY THE DATA LOADED")}
    blocked = not_reviewed(inp)
    gaps = build_gaps(d, comp)

    _s1(b, d, doc_no, gaps)
    _s2(b, d)
    _s3(b, d, drv, ter, ew, gaps)
    _s4(b, d, blocked, inp)
    _s5(b, d, drv, ter, ew, lrows, lc, cnt)
    _s6(b, d, comp, cnt)
    open_items = _s7(b, d, cnt, lc, blocked)
    _s8(b, d, blocked)
    gl_text = "\n".join(s.full() for s in [st for sec in b.sections for bl in sec.blocks for st in bl.stmts]) + "\n" + "\n".join(
        " ".join(" ".join(r) for r in bl.table.rows) for sec in b.sections for bl in sec.blocks if bl.table)
    _fill_docs_read(b, d, comp)
    _s9(b, gl_text)
    _appendix_maps(b, d)
    meta = {"lot": d.lot_label, "lga": d.locality, "doc_number": doc_no, "offline_fixture": d.fixture, "counts": cnt, "layers": lc["layers"], "layers_not_checked": lc["not_checked"],
            "layer_counts": lc, "documents_not_reviewed": len(blocked), "data_gaps": len(gaps), "run_started": d.facts.get("started"), "method": METHOD_TEXT,
            "map_figures": len(d.figs), "synthetic_demo": bool(inp.synthetic_demo),
            "planning_maps": [{"figure": f["no"], "key": f["key"], "title": f["title"], "state": f["rec"].get("state"), "result": f["rec"].get("result"), "png": Path(f["png"]).name,
                               "synthetic": bool(f["rec"].get("synthetic"))} for f in d.figs.values()]}
    return SiteSoee(DOC_TITLE, doc_no, site_label, d.locality, d.council, dmy(inp.today), inp.revision, "DRAFT", b.sections, meta, comp, open_items)


# ---- 1 Introduction
def _s1(b: _Build, d: _Data, doc_no: str, gaps: list[dict]) -> None:
    b.sec("1", "Introduction")
    b.h2("1.1 Purpose")
    b.p(f"This draft Statement of Environmental Effects (SoEE) describes the civil and site works shown on the JCESITE plan set for {d.lot_label}, {d.locality} NSW, in the area of {d.council}.", "data:sa1.lot")
    b.p("It sets out the works shown, the planning framework and the matters for consideration under section 4.15 of the Environmental Planning and Assessment Act 1979 (EP&A Act), so far as the data held by the platform allow.", "platform:method")
    b.p(f"The scope is site works only. {BUILDING_BY_OTHERS}. No dwelling floor area, height, setback, floor level or BASIX content is stated or assumed in this document.", "scope:site_works_only", T_BLD)
    b.p("Each statement is traced to a data field or a cited document. Where the data do not support a statement, this document says so (DATA NOT AVAILABLE, NOT CHECKED, NOT REVIEWED or UNRESOLVED). Nothing has been assumed in place of missing data, except values labelled ASSUMED or ASSUMED / PLATFORM DEFAULT. Values labelled INDICATIVE, 5 m DEM come from the sourced elevation model and are not a survey.", "platform:method")
    b.p(METHOD_TEXT, "platform:method")
    b.p("This is an AI generated draft. It carries that label because the requirement values it uses were extracted by an AI model and the platform that prepared it is AI assisted. It has not been checked or certified. It is not a planning assessment, an approval or advice, and it does not state that the proposal complies or will be approved.", "platform:method")
    b.h2("1.2 Plans this statement accompanies")
    pj = d.w.get("planset_project")
    b.p("This statement accompanies the JCESITE civil plan set listed below" + (f" (project name on the title blocks: {pj})" if pj else "") + ". The drawing number uses the placeholder XXX until a job number is set. The last column gives the number of data gaps listed against the sheet in section 3.9, with the item numbers.", "planset:codes", cite=None)
    rows = []
    for s_ in d.w.get("sheets", []):
        nos = [g["no"] for g in gaps if s_["number"] in g["sheets"]]
        if not s_["built"]:
            note = "Not built in this run"
        elif nos:
            note = f"{len(nos)} data gap" + ("s" if len(nos) != 1 else "") + " (section 3.9, item" + ("s " if len(nos) != 1 else " ") + ", ".join(str(n) for n in nos) + ")"
        else:
            note = "No data gaps recorded"
        rows.append(([s_["number"], s_["drawing_number"], s_["title"], note], f"planset:sheets[{s_['number']}]"))
    b.table(["Sheet", "Drawing number", "Title", "Data gaps in this run"], rows, [0.6, 1.3, 1.5, 1.9])
    b.h2("1.3 How to read the results")
    b.p("The same result terms are used here as in the JCESITE site report, which this statement should be read with.", "platform:report_terms")
    terms = [([t, w_], "platform:app.report.explain.RESULT_TERMS") for t, _k, w_ in explain.RESULT_TERMS]
    terms += [(["ASSUMED", "An assumption that is not a platform default, for example that the lot is vacant. It has not been confirmed."], "platform:method"),
              (["INDICATIVE, 5 m DEM", "A level, fall or quantity derived from the sourced 5 m digital elevation model. It is not an assumption. It is too coarse for design and is not a survey."], "platform:method"),
              (["NOT REVIEWED, UNRESOLVED", "A source document that could not be obtained in this run. Its content has not been read. Nothing has been assumed in its place."], "platform:method"),
              (["DATA NOT AVAILABLE", "The run holds no data for the item. It is not estimated or defaulted. The applicant or a qualified person must supply it."], "platform:method"),
              (["NOT ASSESSED", "A matter that this draft does not assess because no data bears on it. It is left to the applicant."], "platform:method")]
    b.table(["Term", "Meaning"], terms, [1.5, 3.5])
    b.h2("1.4 What this document is not")
    b.bullets([("Not certified, not checked by a qualified person and not for approval, sale, finance or construction decisions.", "platform:app.report.explain.ABOUT_IS_NOT"),
               ("Not a survey. Lot boundaries come from the cadastre and are indicative.", "platform:app.report.explain.ABOUT_IS_NOT"),
               ("Not legal advice or planning advice, and not a section 10.7 planning certificate or council property report.", "platform:app.report.explain.ABOUT_IS_NOT"),
               ("Not a complete list of constraints. Only the layers listed in section 5.11 were screened.", "platform:method"),
               (f"Site works only. {BUILDING_BY_OTHERS}.", "scope:site_works_only", T_BLD)])


# ---- 2 Site description
def _compass(deg: float) -> str:
    names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return names[int(((deg % 360) + 22.5) // 45) % 8]


def _s2(b: _Build, d: _Data) -> None:
    lot, ter = d.lot, d.w.get("terrain", {})
    b.sec("2", "Site description")
    b.h2("2.1 The lot")
    b.bullets([
        (f"Lot: {d.lot_label}, in the area of {d.council}.", "data:sa1.lot.lotplan"),
        ("Street address: not recorded in the run data.", "data:sa1.lot", T_DNA),
        (f"Area: {num(lot.get('area_m2_calculated'), 0)} m2, calculated from the cadastre (not a survey).", "data:sa1.lot.area_m2_calculated") if lot.get("area_m2_calculated") else ("Area: not recorded.", "data:sa1.lot", T_DNA),
        ("Registered (title) area: not recorded in the run data.", "data:sa1.lot.area_m2_registered", T_DNA) if lot.get("area_m2_registered") is None else (f"Registered area: {num(lot['area_m2_registered'], 0)} m2.", "data:sa1.lot.area_m2_registered"),
        (_with_ref(d, "zoning", f"Zone: {lot['zone_code']}, as returned by the cadastre and zoning service. The zone name and objectives are not in the run data (the Local Environmental Plan was not obtained)."), "data:sa1.lot.zone_code") if lot.get("zone_code") else ("Zone: not returned by the zoning service.", "data:sa1.lot.zone_code", T_DNA),
    ])
    rows = []
    for s in lot.get("segments", []):
        adj = "Road frontage" + (f" ({', '.join(lot['road_names'])})" if lot.get("road_names") else "") if s["is_front"] else (s["neighbour"] or ("Adjoining land not identified in the data" if s["adjoins"] != "road" else "Road"))
        rows.append(([str(s["seq"] + 1), s["bearing_dms"], num(s["length_m"], 2), adj], f"data:sa1.lot.segments[{s['seq']}]"))
    if rows:
        b.table(["Boundary", "Bearing", "Length (m)", "Adjoins"], rows, [0.8, 1.2, 1.0, 3.0], caption="Boundary bearings and lengths are from the cadastre and are indicative.")
    b.h2("2.2 Existing conditions")
    if ter.get("available"):
        b.p(f"Existing ground levels over the lot range from RL {num(ter['lot_min_m'], 2)} m to RL {num(ter['lot_max_m'], 2)} m AHD. A best fit plane to the DEM levels near the lot falls at an average of {num(ter['avg_fall_pct'], 1)}% towards the {_compass(ter['fall_bearing_deg'])} (bearing {ter['fall_bearing_deg']:.0f} degrees). The steepest gradient between adjacent DEM grid points is {num(ter['max_gradient_pct'], 1)}%.", "data:planset.terrain")
        prov = d.facts.get("levels_provenance") or {}
        b.p(f"These levels come from the NSW 5 m digital elevation model (DEM; {prov.get('points', 'n/a')} points; source {T(prov.get('source', 'not recorded'))}). Copyright note from the service: {T(prov.get('copyright', 'not recorded'))}. A 5 m grid is too coarse for detailed cut and fill on a lot of this size. Levels are INDICATIVE and a detail survey is required.", "data:run.levels_provenance", T_IND)
        warn = " ".join(d.facts.get("levels_warnings") or [])
        m = re.search(r"(\d+(?:\.\d+)?) m placeholder", warn)
        b.p("The vertical accuracy of the DEM is not stated by the data service." + (f" A placeholder accuracy of {m.group(1)} m was used in the platform earthworks calculations only, so that uncertainty is not understated. It is not a stated figure." if m else ""), "data:run.levels_warnings", T_UNRES)
    else:
        b.p("Existing ground levels: no survey or DEM levels were available in this run. Contours, earthworks and long sections could not be drawn.", "data:planset.terrain", T_DNA)
    b.p("Existing buildings, trees, fences and easements are not in the run data. They must be confirmed by a title search, the registered easements and a site inspection.", "planset:sheets[C100].data_missing", T_DNA)
    b.p("Existing underground services are not in the run data. A Before You Dig Australia (BYDA) enquiry is needed. Asset owners hold the data and answer each enquiry.", "planset:sheets[C100].data_missing", T_DNA)
    b.p("The lot is assumed to be vacant. This has not been confirmed by a records check or a site inspection.", "scope:site_works_only", T_ASSUMED1)
    a = d.w.get("aerial")
    if a and a.get("capture_date"):
        b.p(f"The aerial imagery used on the plan set was captured on {dmy(a['capture_date'])} (imagery metadata). The lot may have changed since that date.", "data:planset.aerial")
    else:
        b.p("The capture date of the aerial imagery used on the plan set is not recorded in the run data.", "data:planset.aerial", T_DNA)
    b.h2("2.3 Adjoining lots and road frontage")
    rows = []
    for s in lot.get("segments", []):
        if s["neighbour"]:
            rows.append(([s["neighbour"], f"Boundary {s['seq'] + 1}, bearing {s['bearing_dms']}", num(s["shared_m"], 2)], f"data:sa1.lot.neighbours; planset:segments[{s['seq']}]"))
    if rows:
        b.table(["Adjoining lot", "Common boundary", "Shared length (m)"], rows, [1.8, 2.6, 1.4])
        b.p("The use of adjoining land and the existing streetscape are not in the run data.", "data:sa1.lot.neighbours", T_DNA)
    else:
        b.p("Adjoining lots are not recorded in the run data.", "data:sa1.lot.neighbours", T_DNA)
    front = next((s for s in lot.get("segments", []) if s["is_front"]), None)
    items = []
    if front:
        items.append((f"Road frontage: {', '.join(lot.get('road_names') or ['road name not recorded'])}, along boundary {front['seq'] + 1}, {num(front['length_m'], 2)} m long (bearing {front['bearing_dms']}, from the cadastre).", f"data:sa1.lot.segments[{front['seq']}]"))
    else:
        items.append(("Road frontage: no front boundary was identified in the lot data.", "data:sa1.lot.segments", T_DNA))
    items.append(("Road reserve width, pavement width and kerb position are not surveyed. The plan set shows an ASSUMED kerb line. Road pavement extent is not shown (no survey or road reserve data).", "planset:sheets[C101].data_missing", T_ASSUMED))
    items.append(("Whether the lot is a corner allotment is not confirmed. The offline data hold only the adjoining lots, so the cadastre does not reach the edges of the plan viewports (not checked, not clear).", "planset:sheets[C100].data_missing", T_NC) if d.fixture else
                 ("Whether the lot is a corner allotment is not confirmed by a records check.", "data:sa1.lot.segments", T_UNRES))
    b.bullets(items)


# ---- 3 Proposed works
def width_basis(drv: dict) -> tuple[str, bool]:
    """(basis, is_platform_default) for the driveway width, read from the plan set layover list (the 'drive' row), so the statement and the plans agree.
    A width with no recorded basis is treated as a platform default."""
    r = next((x for x in drv.get("layover", []) if x.get("key") == "drive"), None)
    src = (r or {}).get("src") or ""
    return (sentence_case(src).rstrip(".") if src else "Platform default"), (not src) or "DEFAULT" in src.upper()


def crossing_standard(drv: dict) -> str | None:
    """The council crossing standard drawing selected on the plan set, or None when none is selected.  AS/NZS 2890.1 is an off-street parking standard and is
    never reported as the crossing standard."""
    lab = (drv.get("council_standard_label") or "").strip()
    return None if (not lab or re.search(r"default|not selected|2890", lab, re.I)) else T(lab)


def fall_phrase(ter: dict) -> str:
    return f"{num(ter['avg_fall_pct'], 1)}% towards the {_compass(ter['fall_bearing_deg'])} (bearing {ter['fall_bearing_deg']:.0f} degrees)"


def fall_side(ter: dict) -> str | None:
    """'away from', 'towards' or 'across' the street, from the DEM fall and the front boundary.  Uses the same component (fall_vs_street, threshold 0.25) as the plan
    note on C300, so the statement and the drawing agree.  None when the fall or the front boundary is not known."""
    if not ter.get("available"):
        return None
    c = ter.get("fall_away_c")
    if c is None and ter.get("fall_vs_street_deg") is not None:
        c = -math.cos(math.radians(ter["fall_vs_street_deg"]))
    if c is None:
        return None
    return "away from" if c >= 0.25 else "towards" if c <= -0.25 else "across"


def discharge_item(ter: dict) -> tuple | None:
    """Site discharge item: where the lot falls relative to the street (same rule as the C300 plan note).  The legal point of discharge is always unresolved."""
    side = fall_side(ter)
    if side is None:
        return None
    src = "data:planset.terrain.fall_away_c; data:planset.terrain.fall_bearing_deg; planset:terrain_notes"
    if side == "away from":
        return (f"The lot falls away from the street: {fall_phrase(ter)}, indicative from the 5 m DEM. Stormwater from the lot may not drain to the street by gravity. The legal point of discharge is unresolved. An inter-allotment drainage easement over adjoining land, or another solution, may be required. Confirm with the council.", src, T_UNRES)
    if side == "towards":
        return (f"The lot falls towards the street: {fall_phrase(ter)}, indicative from the 5 m DEM. The legal point of discharge is unresolved. Confirm with the council whether discharge to the street drainage is permitted.", src, T_UNRES)
    return (f"The lot falls across the street frontage: {fall_phrase(ter)}, indicative from the 5 m DEM. The legal point of discharge is unresolved. An inter-allotment drainage easement over adjoining land, or another solution, may be required. Confirm with the council.", src, T_UNRES)


def _s3(b: _Build, d: _Data, drv: dict, ter: dict, ew: dict, gaps: list[dict]) -> None:
    w = d.w
    b.sec("3", "Proposed works")
    b.h2("3.1 Scope of the works")
    b.p("The works are the civil and site works shown on the JCESITE plan set. They are limited to the items below. All values are drawn from the plan set data for this run, are INDICATIVE and are not a design.", "planset:sheets")
    b.bullets([("Vehicle crossover and layover (drawings C101, C400 and C420).", "planset:codes"), ("Driveway, long section and swept path (C400 and C410).", "planset:codes"),
               ("Earthworks, cut and fill and batters (C200 and C600).", "planset:codes"), ("Stormwater (C300).", "planset:codes"),
               ("Erosion and sediment control (C500).", "planset:codes"), ("Water and sewer connections, indicative (C310).", "planset:codes"),
               ("Site constraints (C100, C101 and the JCESITE site report).", "planset:codes")])
    b.p(f"The dwelling is not part of the works described here. {BUILDING_BY_OTHERS}.", "scope:site_works_only", T_BLD)

    b.h2("3.2 Vehicle crossover and layover")
    if drv.get("present"):
        rows = []
        for r in drv.get("layover", []):
            basis = sentence_case(r["src"]).rstrip(".") + (". PLACEHOLDER, not a design value" if r["placeholder"] else "")
            rows.append(([sentence_case(r["label"].lower()).rstrip("."), f"{r['m']:.2f}", basis], f"planset:C420.layover_values[{r['key']}]"))
        b.table(["Dimension", "Value (m)", "Basis"], rows, [2.4, 1.0, 3.0], caption="Dimensions are drawn on C420. A PLATFORM DEFAULT is a value set by the platform. It is not derived from a council requirement and must be confirmed. A drafting convention is a drawing default, not a council dimension.")
        items = [("The crossover is drawn from the SA3 driveway result. The kerb and gutter line is drawn ASSUMED unless surveyed.", "planset:C101", T_ASSUMED)]
        std = crossing_standard(drv)
        if std:
            items.append((f"Council crossing standard drawing: {std}.", "data:planset.driveway.council_standard_label"))
        else:
            items.append(("Council crossing standard drawing: NOT SELECTED. The council standard drawing governs the vehicle crossing and layover. AS/NZS 2890.1 is the Australian Standard for off-street parking and is not a council crossing standard.", "data:planset.driveway.council_standard_label", T_UNRES))
        if d.r("access.crossing_standard"):
            items.append(_cited(d, "access.crossing_standard", "The council requires access from the public road to the property boundary to comply with its standard access drawings and the dimensions of AS 2890", T_UNRES))
        items.append(("Crossover pavement type and thickness are not selected: per council standard drawing, to be confirmed.", "planset:sheets[C420]", T_UNRES))
        b.bullets(items)
    else:
        b.p("No driveway or crossover result was available in this run.", "planset:sheets[C400]", T_DNA)

    b.h2("3.3 Driveway")
    if drv.get("present"):
        wb, wdef = width_basis(drv)
        items = [(f"Driveway width {num(drv['width_m'], 1)} m. Basis recorded on the plan set: {wb[:1].lower() + wb[1:]}. The design vehicle {T(drv.get('design_vehicle') or 'not recorded')} is a platform value. Neither is a council selection.", "data:planset.driveway; planset:C420.layover_values[drive]", T_ASSUMED if wdef else "")]
        if drv.get("length_m"):
            items.append((f"Centreline length from the kerb or road edge to the driveway end: {num(drv['length_m'], 1)} m.", "data:planset.driveway.length_m"))
        items.append(("Driveway material is not selected (to be confirmed).", "planset:sheets[C400]", T_UNRES))
        if drv.get("kerb_to_boundary_grade_pct") is not None:
            g = drv["kerb_to_boundary_grade_pct"]
            items.append((f"The existing ground grade from the assumed kerb line to the property boundary is {abs(g):.1f}%, " + ("falling towards the lot" if g < 0 else "rising towards the lot") + ". Road runoff exclusion is to be checked by a qualified person.", "data:planset.driveway.kerb_to_boundary_grade_pct", T_IND))
        if drv.get("profile_proposed") and drv.get("profile_checks"):
            for c in drv["profile_checks"]:
                nm_ = c["name"]
                if nm_ == "max_grade":
                    nm = "Steepest grade along the driveway profile"
                elif nm_ == "b85_scraping_clearance":
                    nm = "Underbody scraping clearance of the B85 vehicle over the profile"
                elif nm_.startswith("change_of_grade@"):
                    nm = "Change of grade at " + sentence_case(nm_.split("@", 1)[1]).rstrip(".").lower()
                else:
                    nm = nm_.replace("_", " ").capitalize()
                if c["value"] is None:
                    items.append((f"{nm}: not evaluated.", "data:planset.driveway.profile_checks", T_UNRES))
                else:
                    u = {"%": "%", "percent": "%", "m": " m", "mm": " mm"}.get(c["unit"], f" {c['unit']}" if c["unit"] else "")
                    items.append((f"{nm}: {c['value']:g}{u}. Platform screening result: " + ("passed." if c["passed"] else "not passed."), "data:planset.driveway.profile_checks", T_IND))
            items.append(("The profile results above come from a platform screening of the existing 5 m DEM against a platform driveway profile. They are not a check against a council requirement.", "data:planset.driveway.profile_checks", T_IND))
        else:
            items.append(("Driveway profile checks were not evaluated (no driveway end level or no existing levels).", "data:planset.driveway.profile_checks", T_DNA))
        items.append(("Swept path: the platform vehicle swept path is " + ("drawn on C400." if drv.get("swept_path_drawn") else "NOT drawn on C400, because it does not form one clean path inside the lot, verge and road. SWEPT PATH TO BE CONFIRMED."), "data:planset.driveway.swept_path_drawn", "" if drv.get("swept_path_drawn") else T_UNRES))
        mg = d.r("driveway.max_grade_pct")
        items.append(("No council maximum driveway grade was found in the obtained documents. The screening values above are not a check against one.", "knowledge:unresolved driveway.max_grade_pct", T_UNRES) if mg is None else _cited(d, "driveway.max_grade_pct", "Council maximum driveway grade"))
        b.bullets(items)
    else:
        b.p("No driveway design was available in this run.", "planset:sheets[C400]", T_DNA)

    b.h2("3.4 Earthworks")
    items = []
    if ter.get("available") and ew.get("driveway_cut_m3") is not None:
        items.append((f"Driveway earthworks, existing 5 m DEM against the platform driveway profile: cut {ew['driveway_cut_m3']:,.1f} m3, fill {ew['driveway_fill_m3']:,.1f} m3. INDICATIVE only. The level at the driveway end is a PLATFORM DEFAULT, not a design level.", "data:planset.earthworks", T_IND))
    elif ter.get("available"):
        items.append(("Driveway cut and fill could not be computed (no driveway design or driveway end level).", "data:planset.earthworks", T_DNA))
    else:
        items.append(("Earthworks quantities need existing levels, which were not available in this run.", "data:planset.terrain", T_DNA))
    if "section_aa" in ((d.w.get("sheet_features") or {}).get("C200") or []):
        items.append(("Drawing C200 shows a typical driveway cut and fill section (SECTION A-A) across the driveway. It is derived from the 5 m DEM against the platform driveway profile and is not a design.", "planset:sheets[C200] (text printed on the sheet)", T_IND))
    items.append((f"Building pad cut, fill, batters and volumes depend on the building design. {BUILDING_BY_OTHERS}.", "planset:sheets[C200].data_missing", T_BLD))
    items.append(("Batter slopes are not drawn as values. The typical details on C600 show batters as TBC because no council or cited batter slope was found.", "planset:sheets[C600]", T_UNRES))
    ts = d.r("esc.topsoil.strip_depth_min_mm")
    tx = d.r("esc.topsoil.strip_depth_max_mm")
    if ts and tx:
        items.append((f"Cited guidance on topsoil: usually stripped to a depth of {ts.value:g} to {tx.value:g} {ts.unit} [{cite_ref(ts)}].", f"doc:{T(ts.source.document_title)} page {ts.source.page} ({ts.key})", "", cite_dict(ts)))
    b.bullets(items)

    b.h2("3.5 Stormwater")
    items = [
        ("Drawing C300 shows overland flow arrows. They show the downslope direction of the 5 m DEM only. Flow paths and catchments are not modelled.", "planset:sheets[C300]", T_IND) if ter.get("available") else
        ("Overland flow arrows could not be drawn (no levels).", "planset:sheets[C300]", T_DNA)]
    dis = discharge_item(ter)
    items.append(dis or ("The legal point of stormwater discharge is not in the run data. It must be confirmed with the council.", "planset:sheets[C001]", T_UNRES))
    items += [
        (f"Roof catchment, downpipes, pits and the discharge route depend on the building design. {BUILDING_BY_OTHERS}.", "planset:sheets[C300].data_missing", T_BLD),
        ("Existing council stormwater assets are not in the run data. They must be confirmed from council records and the BYDA response.", "planset:sheets[C300].data_missing", T_DNA),
        ("No rainwater tank was supplied. Any BASIX or council tank requirement is to be confirmed.", "data:planset.services.rwt_supplied", T_DNA) if not w.get("services", {}).get("rwt_supplied") else
        ("A rainwater tank was supplied to the plan set.", "data:planset.services.rwt_supplied"),
        ("All drainage is to be designed by a hydraulic designer. Nothing in the plan set is a drainage design.", "planset:sheets[C300]"),
    ]
    b.bullets(items)

    b.h2("3.6 Erosion and sediment control")
    esc = w.get("esc", {})
    els = esc.get("elements") or []
    if esc.get("shown_on_plan") and els:
        b.p("Erosion and sediment control (ESC) elements are shown on drawing C500 and are listed below. The layout is INDICATIVE: item sizes and offsets are layout defaults. It is to be reviewed and certified by a suitably qualified person, and it is not an erosion and sediment control plan (ESCP).", "planset:sheets[C500]; file:escp_*.geojson", T_ASSUMED)
        rows = []
        for e_ in els:
            q = f"{e_['quantity']:g} {e_['unit']}" if e_.get("quantity") is not None else "not stated"
            conf = "; ".join(_confirm_label(k, e_) for k in (e_.get("confirm") or [])) or "none recorded"
            rows.append(([e_["id"], T(e_["label"]).replace(" - ", ", "), q, "UNRESOLVED" if e_.get("status") == "unresolved" else "CITED VALUES FOUND", conf], f"data:sa10.esc[{e_['id']}]"))
        b.table(["Item", "Control", "Quantity", "Status", "Still to be confirmed"], rows, [0.7, 2.0, 0.9, 1.3, 2.4], status_col=3,
                caption="Status is the SA10 result: UNRESOLVED means that at least one value for the control was not found in the cited guidance. CITED VALUES FOUND does not mean the control is adequate.")
        items = []
        fb, eb = ter.get("fall_bearing_deg"), esc.get("flow_bearing_deg")
        if esc.get("flow_text"):
            if esc.get("flow_assumed"):
                flow_txt = re.sub(r"\s+-\s+ASSUMED$", "", T(esc["flow_text"]))
                items.append((f"The ESC layout used this flow direction: {flow_txt}.", "file:escp_*_report.md", T_ASSUMED))
            elif eb is not None:
                pct = f"{esc['flow_pct']:g}% " if esc.get("flow_pct") is not None else ""
                items.append((f"The ESC layout used a fall of {pct}towards bearing {eb:.0f} degrees (MGA grid), from a plane fit to the 5 m DEM levels passed to the layout.", "file:escp_*_report.md", T_IND))
            else:
                items.append((f"The ESC layout used this flow direction: {re.sub('survey points', 'levels', T(esc['flow_text']))}.", "file:escp_*_report.md"))
        if ter.get("available") and fb is not None and eb is not None:
            diff = abs((fb - eb + 180) % 360 - 180)
            if esc.get("flow_assumed") and diff > 90:
                items.append((f"The ESC layout assumed a flow direction of {eb:.0f} degrees because no levels were available to the layout. The 5 m DEM falls towards {fb:.0f} degrees ({_compass(fb)}), which differs by {diff:.0f} degrees. The positions of downslope controls on C500 must be reviewed against the surveyed fall.", "file:escp_*_report.md; data:planset.terrain.fall_bearing_deg", T_UNRES))
            elif diff > 20:
                items.append((f"The ESC fall bearing of {eb:.0f} degrees differs from the lot fall stated in section 2.2 ({fb:.0f} degrees) by {diff:.0f} degrees. The positions of downslope controls on C500 must be confirmed against the surveyed fall.", "file:escp_*_report.md; data:planset.terrain.fall_bearing_deg", T_UNRES))
            else:
                items.append((f"The lot fall stated in section 2.2 is {fall_phrase(ter)}. It is a fit to a different set of the same DEM levels, and the two bearings differ by {_plural(round(diff), 'degree', 'degrees')}. Both are indicative. The positions of the downslope controls are to be confirmed against a detail survey.", "file:escp_*_report.md; data:planset.terrain.fall_bearing_deg", T_IND))
        for wn in esc.get("warnings") or []:
            if "not drawn" not in wn.lower() and "building footprint" in wn.lower():
                items.append(("No building footprint was supplied to the ESC layout, so the building envelope is used as the works area. A layout for the real footprint will be smaller, and the limit of works, access and activity area positions are indicative only.", "file:escp_*_report.md", T_ASSUMED))
        nd = [x.split(":")[0].strip().lower() for x in esc.get("not_drawn") or []]
        if nd:
            items.append((f"Not drawn on C500: {_join_and(nd)}. No position meets the cited clearances inside the lot. To be confirmed by the designer or certifier.", "file:escp_*_report.md", T_UNRES))
        if _esc_whole_lot_text(esc):
            items.append((_esc_whole_lot_text(esc), "file:escp_*_report.md; file:escp_*.geojson", T_UNRES))
        b.bullets(items)
    elif esc.get("shown_on_plan"):
        b.p("Drawing C500 was built without an ESC data gap marker, but no control list was read for this statement. No control is claimed.", "planset:sheets[C500]", T_UNRES)
    else:
        b.p("The erosion and sediment control layout is not shown on drawing C500 in this run (ESCP DATA PENDING). No control is claimed in this statement. The erosion and sediment control plan (ESCP) is to be prepared by a suitably qualified person.", "planset:sheets[C500].data_missing", T_DNA)

    b.h2("3.7 Services connections (indicative)")
    sv = w.get("services", {})
    b.bullets([
        ("No existing water main, sewer main or junction was supplied. Existing service locations must be confirmed from council records and the BYDA response before any excavation.", "planset:sheets[C310].data_missing", T_DNA) if not sv.get("count") else
        (f"{sv['count']} service line(s) were supplied to the plan set.", "data:planset.services"),
        (f"The proposed water service and sewer house connection depend on the building design. {BUILDING_BY_OTHERS}.", "planset:sheets[C310].data_missing", T_BLD),
        ("Electricity, gas and telecommunications connections are not in the run data.", "data:planset.services", T_DNA),
        ("Connections shown on the plan set are indicative and are not a servicing strategy.", "planset:sheets[C310]"),
    ])

    b.h2("3.8 Site constraints shown on the plan set")
    b.p("The plan set shows the cadastral boundaries, adjoining lots, an assumed kerb line, existing contours from the 5 m DEM and the items above. Mapped planning and hazard layers are screened in section 5 and in the JCESITE site report.", "planset:sheets[C100]")
    b.h2("3.9 Data gaps recorded on the plan set")
    if gaps:
        b.p(f"{_plural(len(gaps), 'data gap is', 'data gaps are')} recorded on the plan set. Each is listed once, with the sheets that carry it. Section 1.2 refers to the item numbers.", "planset:sheets")
        b.table(["Item", "Data gap", "Sheets"], [([str(g["no"]), g["text"], ", ".join(g["sheets"])], g["source"]) for g in gaps], [0.5, 4.3, 1.2])
    else:
        b.p("The plan set records no data gaps in this run.", "planset:sheets")


# ---- 4 Planning framework
def _src_title(sources: list[dict], sid: str) -> str:
    return next((s["title"] for s in sources if s["id"] == sid), sid)


def _s4(b: _Build, d: _Data, blocked: list[dict], inp: SoeeSiteInputs) -> None:
    b.sec("4", "Planning framework")
    b.p("The headings below follow section 4.15(1) of the EP&A Act. The text of the Act was not obtained in this run. Check the headings against the current Act.", "knowledge:sources", T_NOTREV)
    sc = d.layers.get("nsw_sepp_area")
    lot_size = d.findings.get("nsw_lot_size_map")
    fsr = d.findings.get("nsw_fsr_map")
    height = d.findings.get("nsw_height_map")
    lep = None
    for l in d.layers.values():
        for a in l.get("attributes", []):
            if "Local Environmental Plan" in str(a.get("EPI_NAME", "")):
                lep = a["EPI_NAME"]
                break
        if lep:
            break
    heads = dict(S415)
    # (a)(i)
    b.h2(heads["a_i"])
    items = [(f"Local environmental plan named by the mapping data: {T(lep)}. The LEP text (land use table, zone objectives and development standards) was not obtained: NOT REVIEWED, UNRESOLVED.", "data:sa9.layers.attributes.EPI_NAME; knowledge:manifest[gunnedah_lep_2012]", T_NOTREV) if lep else
             ("The local environmental plan was not identified by the mapping data and its text was not obtained.", "knowledge:manifest[gunnedah_lep_2012]", T_NOTREV)]
    items.append(("Permissibility of the site works in the zone, and the zone objectives, cannot be stated. UNRESOLVED.", "knowledge:unresolved landuse.permissibility", T_UNRES))
    items += _zoning_items(d)
    if sc and sc.get("status") == "affected":
        names = sorted({str(a.get("EPI_NAME")) for a in sc["attributes"] if a.get("EPI_NAME")})
        items.append((_with_ref(d, "nsw_sepp_area", f"The SEPP mapped areas layer reports a land application area over the lot for: {', '.join(T(n) for n in names)}. The content of that policy was not obtained: NOT REVIEWED, UNRESOLVED."), "data:sa9.layers[nsw_sepp_area]", T_NOTREV))
    elif sc and sc.get("status") == "not_checked":
        items.append((_with_ref(d, "nsw_sepp_area", "The SEPP mapped areas layer was not queried. Applicable State environmental planning policies are not identified."), "data:sa9.layers[nsw_sepp_area]", T_NC))
    for s in blocked:
        if "SEPP" in s["title"] or "State Environmental Planning" in s["title"]:
            items.append((f"{T(s['title'])}: not obtained, so its relevance to the site works is not determined.", f"knowledge:manifest[{s['id']}]", T_NOTREV))
    for lk, lf in (("minimum lot size map", lot_size), ("floor space ratio map", fsr), ("height of buildings map", height)):
        if lf:
            tag_, text_, src_ = _layer_line(d, {"minimum lot size map": "nsw_lot_size_map", "floor space ratio map": "nsw_fsr_map", "height of buildings map": "nsw_height_map"}[lk])
            lkey = {"minimum lot size map": "nsw_lot_size_map", "floor space ratio map": "nsw_fsr_map", "height of buildings map": "nsw_height_map"}[lk]
            tl_ = _with_ref(d, lkey, text_).rstrip()
            tl_ += "" if tl_.endswith(".") else "."
            mc_ = next((bn for bn in ((d.fig(lkey) or {}).get("rec", {}).get("banners") or []) if bn.startswith("MORE THAN ONE MAPPED CLASS")), "")
            if mc_:
                tl_ += " " + mc_.rstrip(".") + "."
            items.append((tl_ + " This map bears on the building design and on subdivision, not on the site works, and is not assessed here. " + BUILDING_BY_OTHERS + ".", src_, tag_))
    b.bullets(items)
    b.h2(heads["a_ii"])
    b.p("Proposed environmental planning instruments that are or have been the subject of public consultation are not covered by any data source held by the platform. Confirm with the council.", "platform:no_data_source", T_NC)
    b.h2(heads["a_iii"])
    used = {}
    for r in d.req.requirements:
        if r.source and "Development Control Plan" in r.source.document_title and r.key in ("driveway.min_width_m",):
            pass
    dcp = d.r("access.crossing_standard")
    items = []
    if dcp:
        items.append((f"{T(dcp.source.document_title)}{vtxt(dcp.source.version)}, was read for this statement. Sections used in this statement are cited where they are applied (for example {T(dcp.source.section_ref)}, page {dcp.source.page}).", f"doc:{T(dcp.source.document_title)} page {dcp.source.page}", "", cite_dict(dcp)))
    eng = d.r("driveway.min_width_m")
    if eng:
        items.append((f"{T(eng.source.document_title)}{vtxt(eng.source.version)}, was read for crossing and services requirements (for example {T(eng.source.section_ref)}, page {eng.source.page}).", f"doc:{T(eng.source.document_title)} page {eng.source.page}", "", cite_dict(eng)))
    esc = d.r("esc.escp.prepared_by_suitably_qualified_person")
    if esc:
        items.append((f"{T(esc.source.document_title)}, {T(esc.source.authority)}{vtxt(esc.source.version)}, was read for erosion and sediment control guidance.", f"doc:{T(esc.source.document_title)} page {esc.source.page}", "", cite_dict(esc)))
    items.append(("Council DCP controls for the building (setbacks, parking, site coverage and similar) are outside the site works scope. " + BUILDING_BY_OTHERS + ".", "scope:site_works_only", T_BLD))
    b.bullets(items)
    b.h2(heads["a_iiia"])
    b.p("Planning agreements (section 7.4 of the EP&A Act) are not covered by any data source held by the platform. Confirm with the council.", "platform:no_data_source", T_NC)
    b.h2(heads["a_iv"])
    reg = next((s for s in blocked if "Regulation" in s["title"]), None)
    b.p("The Environmental Planning and Assessment Regulation 2021 was not obtained, so it has not been reviewed. The content requirements for a statement of environmental effects have therefore not been checked against it. Check the content of this statement against the current Regulation.", f"knowledge:manifest[{reg['id'] if reg else 'epa_reg_2021'}]", T_NOTREV)
    b.bullets([_form("The council statement of environmental effects form was obtained and read for the topics that Gunnedah Shire Council expects to be covered. The form is for single dwelling houses, residential ancillary and outbuilding developments only, and says that all other developments need a detailed, site specific statement. It is used here as a topic guide only, and this statement does not complete it.",
                     "All other developments require a detailed, site specific Statement of Environmental Effects", 1),
               ("Section 5 assesses twelve matters. It uses the council form topics where they correspond to site works (access and traffic, water and drainage, heritage, soil, habitat, flood prone land, bushfire prone land).", "scope:site_works_only; doc:council SoEE form")])
    b.h2(heads["b"])
    b.p("The likely impacts of the site works, including environmental, social and economic effects, are assessed in sections 5.1 to 5.10.", "platform:structure")
    b.h2(heads["c"])
    b.p("The suitability of the site is addressed in section 5.11. This draft does not conclude that the site is suitable.", "platform:structure")
    b.h2(heads["d"])
    b.p("No submissions are recorded in the run data. Submissions arise after lodgement and notification of an application, so this matter is not assessed in a draft prepared before lodgement.", "platform:no_data_source", T_NA)
    b.h2(heads["e"])
    b.p("The public interest is addressed in section 5.12. This draft does not conclude on it.", "platform:structure")
    b.h2("4.1 Documents not reviewed")
    rows = [([T(s["title"]), "NOT REVIEWED, UNRESOLVED", sentence_case(s["reason"]) if s["reason"] else "Not obtained in this run."],
             "knowledge:not_in_manifest" if s["id"] == ACT_ROW_ID else f"knowledge:manifest[{s['id']}]") for s in blocked]
    b.p(f"{_plural(len(rows), 'document was', 'documents were')} not reviewed. Their content has not been read and nothing has been assumed in its place.", "knowledge:manifest", T_NOTREV)
    b.table(["Document", "Status", "Reason"], rows, [2.4, 1.3, 2.3])
    b.h2("4.2 Documents read")
    b.p("The documents below are the obtained documents that this statement cites.", "platform:method")
    tb = Table(["Document", "Version", "Retrieved"], [], [3.2, 1.8, 1.0], [], None, [], "")
    b.cur.blocks.append(Block("table", table=tb))
    b.docs_read = tb


def _fill_docs_read(b: _Build, d: _Data, comp: list[dict]) -> None:
    """Fill table 4.2 once every statement exists: the obtained source documents that at least one statement or compliance row cites."""
    used = set()
    for sec in b.sections:
        for bl in sec.blocks:
            for st in bl.stmts:
                if st.cite:
                    used.add(_src_key(st.cite["document"]))
    for r in comp:
        if r["citation"]:
            used.add(_src_key(r["citation"]["document"]))
    tb = b.docs_read
    for srow in d.inp.sources:
        if srow["status"] == "obtained" and _src_key(srow["title"]) in used:
            b.n += 1
            tb.ids.append(f"s{b.n:03d}")
            tb.sources.append(f"knowledge:manifest[{srow['id']}]")
            tb.rows.append([T(srow["title"]), T(srow["version"] or "not recorded"), dmy(srow["retrieved_at"]) if srow["retrieved_at"] else "not recorded"])


# ---- 5 Assessment
def _s5(b: _Build, d: _Data, drv: dict, ter: dict, ew: dict, lrows: list[dict], lc: dict, cnt: dict) -> None:
    w = d.w
    b.sec("5", "Assessment of section 4.15 matters")
    b.p("Each matter below gives the finding from the data and the open items. A layer that was not queried is NOT CHECKED, and not checked is not clear.", "platform:method")
    if d.fixture:
        b.p("The constraint layer results in this draft were rebuilt from a saved live run (approximate geometry) and are not queried live. They must be refreshed before any use.", "data:sa9.meta.flags", T_FIX)
    nm = MATTERS
    # 5.1
    b.h2(f"5.1 {nm[0]}")
    lot = d.lot
    b.bullets([
        (_with_ref(d, "zoning", f"The site is {d.lot_label}, about {num(lot.get('area_m2_calculated'), 0)} m2, zone {lot.get('zone_code') or 'not returned'}, with a road frontage to {', '.join(lot.get('road_names') or ['a road not named in the data'])}."), "data:sa1.lot"),
        (f"The lot adjoins {len([n for n in lot.get('neighbours', []) if not n['is_road']])} lots in the data. The use of adjoining land and the existing streetscape are not in the run data.", "data:sa1.lot.neighbours", T_DNA),
        (f"Overshadowing, privacy, bulk and scale relate to the building. {BUILDING_BY_OTHERS}.", "scope:site_works_only", T_BLD),
        ("The site works are at ground level (driveway, crossover, earthworks and drainage). Visual effects of the works on the streetscape are not assessed in this draft.", "platform:method", T_NA),
    ])
    # 5.2
    b.h2(f"5.2 {nm[1]}")
    items = []
    if drv.get("present"):
        wb, wdef = width_basis(drv)
        items.append((f"One vehicle crossover and one driveway are shown (C400, C420), with a driveway width of {num(drv['width_m'], 1)} m and a {T(drv.get('design_vehicle') or '')} design vehicle (platform values).", "data:planset.driveway", T_ASSUMED if wdef else ""))
        wmin, wmax = d.r("driveway.min_width_m"), d.r("driveway.max_width_m")
        if wmin and wmax:
            ok = wmin.value - 1e-9 <= drv["width_m"] <= wmax.value + 1e-9
            items.append((f"The cited width of access is {wmin.value:g} to {wmax.value:g} m. The driveway width of {num(drv['width_m'], 1)} m is " + ("within that range" if ok else "outside that range") + " (numeric comparison, section 6)." + (" The width is a PLATFORM DEFAULT, so this must be confirmed against the council standard drawing." if wdef else ""), f"doc:{T(wmin.source.document_title)} page {wmin.source.page} ({wmin.key}); data:planset.driveway.width_m", "", cite_dict(wmin)))
    else:
        items.append(("No driveway or crossover result was available in this run.", "planset:sheets[C400]", T_DNA))
    items.append(("Traffic generation, sight distance and the condition of the receiving road are not in the run data.", "platform:no_data_source", T_NA))
    items.append(_form("The council form asks about vehicle access to a public road, traffic generation, the road the site is accessed from and the formation of the existing access. The run data hold none of these answers.", "ACCESS AND TRAFFIC", 2, T_DNA))
    items.append((f"Parking and garage location relate to the building. {BUILDING_BY_OTHERS}.", "scope:site_works_only", T_BLD))
    b.bullets(items)
    # 5.3
    b.h2(f"5.3 {nm[2]}")
    items = []
    sw = d.r("stormwater.designed_per_eng_standards")
    if sw:
        items.append(_cited(d, "stormwater.designed_per_eng_standards", "The council requires all stormwater systems to be designed and constructed in accordance with its Engineering Design Minimum Standards", T_UNRES))
    if ter.get("available"):
        items.append(("Overland flow arrows on C300 follow the fall of the 5 m DEM." if discharge_item(ter) else f"The lot falls at an average of {num(ter['avg_fall_pct'], 1)}% towards the {_compass(ter['fall_bearing_deg'])} (5 m DEM, INDICATIVE). Overland flow arrows on C300 follow that fall.", "data:planset.terrain", T_IND))
    else:
        items.append(("The direction of fall is not available because no levels were available in this run.", "data:planset.terrain", T_DNA))
    dis = discharge_item(ter)
    if dis:
        items.append(dis)
    items += [("No stormwater design, discharge route, legal point of discharge or detention volume is provided. TO BE COMPLETED BY THE APPLICANT with a hydraulic designer.", "planset:sheets[C300].data_missing", T_UNRES),
              ("The effect of the works on stormwater runoff to adjoining lots and the road is not assessed.", "platform:method", T_NA)]
    items.append(_riparian(d))
    items.append(_form("The council form asks how stormwater is disposed of, whether the design increases runoff or affects flooding on other land, and whether measures minimise runoff. These are not answered by the run data.", "Will the proposed design increase stormwater runoff or adversely affect flooding on other land?", 3, T_DNA))
    b.bullets([i for i in items if i])
    # 5.4
    b.h2(f"5.4 {nm[3]}")
    items = []
    if ter.get("available") and ew.get("driveway_cut_m3") is not None:
        items.append((f"Driveway earthworks quantities are: cut {ew['driveway_cut_m3']:,.1f} m3 and fill {ew['driveway_fill_m3']:,.1f} m3 (INDICATIVE, 5 m DEM against a platform driveway profile).", "data:planset.earthworks", T_IND))
    items.append((f"Building pad earthworks are not included. {BUILDING_BY_OTHERS}.", "planset:sheets[C200].data_missing", T_BLD))
    th = d.r("site.slope_geotech_threshold_pct")
    if th and ter.get("available"):
        ok = ter["max_gradient_pct"] <= th.value + 1e-9
        items.append((f"The cited slope above which a detailed geotechnical investigation is required is {th.value:g}%. The steepest gradient between adjacent DEM grid points over the lot is {ter['max_gradient_pct']:.1f}%, " + ("which does not exceed it" if ok else "which exceeds it") + ". A 5 m DEM may not show local steeper ground, so this is INDICATIVE. [" + cite_ref(th) + "]", f"doc:{T(th.source.document_title)} page {th.source.page} ({th.key}); data:planset.terrain.max_gradient_pct", T_IND, cite_dict(th)))
    items.append(_layer_item(d, "nsw_acid_sulfate"))
    items.append(("Soil type, salinity, dispersion and geotechnical conditions are not in the run data. A geotechnical investigation has not been provided.", "platform:no_data_source", T_DNA))
    items.append(("Construction noise, dust and working hours are not addressed in the run data.", "platform:no_data_source", T_NA))
    es = d.r("esc.escp.prepared_by_suitably_qualified_person")
    lot_a = d.lot.get("area_m2_calculated")
    amin, amax = d.r("esc.escp.min_site_area_m2"), d.r("esc.escp.max_site_area_m2")
    if amin and amax and lot_a:
        inside = amin.value <= lot_a <= amax.value
        items.append((f"The cited building sites guideline covers sites of {amin.value:g} to {amax.value:g} m2. The lot area of {lot_a:,.0f} m2 is " + ("within" if inside else "outside") + f" that range. [{cite_ref(amin)}]", f"doc:{T(amin.source.document_title)} page {amin.source.page} ({amin.key}); data:sa1.lot.area_m2_calculated", "", cite_dict(amin)))
    if w.get("esc", {}).get("shown_on_plan"):
        nd_ = [x.split(":")[0].strip().lower() for x in w["esc"].get("not_drawn") or []]
        items.append((f"An indicative erosion and sediment control layout of {len(w['esc'].get('elements') or [])} items is shown on drawing C500 (section 3.6). It is not an ESCP. It is to be reviewed and certified by a suitably qualified person." + (f" Not drawn on C500: {_join_and(nd_)}, because no position meets the cited clearances inside the lot (ESC FLAGS panel). Where they are placed is open." if nd_ else "") + (" " + _esc_whole_lot_text(w["esc"]) if _esc_whole_lot_text(w["esc"]) else "") + " The fall direction and the positions of the downslope controls are to be confirmed against a detail survey.", "planset:sheets[C500]; file:escp_*.geojson", T_UNRES))
    else:
        items.append(("The erosion and sediment control layout is not shown on drawing C500 in this run (ESCP DATA PENDING). The ESCP is not provided.", "planset:sheets[C500].data_missing", T_DNA))
    if es:
        items.append(_cited(d, "esc.escp.prepared_by_suitably_qualified_person", "Cited guidance requires the erosion and sediment control plan to be prepared by a suitably qualified person", T_UNRES))
    b.bullets([i for i in items if i])
    # 5.5
    b.h2(f"5.5 {nm[4]}")
    items = [_flood_item(d)]
    fb, ap = d.r("flood.freeboard_m"), d.r("flood.planning_level_aep_pct")
    if fb and ap:
        items.append((f"The council has adopted the {ap.value:g}% annual exceedance probability (AEP) flood plus {fb.value:g} m freeboard as its flood planning level. [{cite_ref(fb)}]", f"doc:{T(fb.source.document_title)} page {fb.source.page} ({fb.key}, {ap.key})", "", cite_dict(fb)))
    items.append(("The lot specific flood planning level and flood extent are not in the run data. A flood certificate or flood information must be requested from the council. UNRESOLVED.", "knowledge:unresolved flood.lot_specific_fpl", T_UNRES))
    items.append(("The Gunnedah and Carroll Floodplain Management Plan is a scanned image without a text layer, so it could not be read: NOT REVIEWED, UNRESOLVED.", "knowledge:manifest[gunnedah_carroll_fmp_1999]", T_NOTREV))
    items.append((f"Floor levels relate to the building. {BUILDING_BY_OTHERS}.", "scope:site_works_only", T_BLD))
    b.bullets(items)
    # 5.6
    b.h2(f"5.6 {nm[5]}")
    items = [_layer_item(d, "nsw_bushfire"),
             ("Bushfire attack level, asset protection zone, access and water supply requirements are not stated: Planning for Bush Fire Protection was not obtained. They apply principally to the building. " + BUILDING_BY_OTHERS + ".", "knowledge:manifest[nsw_pbp_2019]", T_NOTREV)]
    b.bullets(items)
    # 5.7
    b.h2(f"5.7 {nm[6]}")
    b.bullets([_layer_item(d, "nsw_heritage_item"), _layer_item(d, "nsw_heritage_conservation"),
               ("Aboriginal cultural heritage and archaeological potential are not in the run data. NOT ASSESSED.", "platform:no_data_source", T_NA)])
    # 5.8
    b.h2(f"5.8 {nm[7]}")
    items = [_layer_item(d, "nsw_biodiversity"), _layer_item(d, "nsw_riparian"), _layer_item(d, "nsw_coastal"),
             _form("The council form asks whether vegetation will be removed, how much, and whether koala habitat is affected (by reference to State Environmental Planning Policy (Biodiversity and Conservation) 2021, which was not obtained). The run data do not answer these questions.", "Will the proposal involve the removal of vegetation?", 4, T_NOTREV),
             ("Existing trees and vegetation on the lot are not in the run data (confirm by site inspection). Any clearing for the works is not assessed.", "planset:sheets[C100].data_missing", T_DNA)]
    b.bullets(items)
    # 5.9
    b.h2(f"5.9 {nm[8]}")
    items = [("No existing service data were supplied (water, sewer, stormwater, electricity, gas, telecommunications). Availability and location of connections are UNRESOLVED.", "planset:sheets[C310].data_missing", T_DNA)]
    for key, sent in (("utilities.servicing_strategy_required", "A servicing strategy is required with all development applications (water, sewer and stormwater)"),
                      ("water.potable_connection_required_if_available", "Connection to the potable water supply is required if it is available"),
                      ("util.build_over_sewer_policy", "Work near a council sewer main must follow the council Building over Sewer Policy (the policy document was not obtained)")):
        it = _cited(d, key, sent, T_UNRES)
        if it:
            items.append(it)
    items.append(("A servicing strategy has not been prepared. TO BE COMPLETED BY THE APPLICANT.", "planset:sheets[C310].data_missing", T_UNRES))
    items.append(_form("The council form also asks where electricity will be accessed from, where water will be sourced from and how effluent will be disposed of. The run data hold none of these answers.", "Where will electricity be accessed from?", 2, T_DNA))
    b.bullets(items)
    # 5.10
    b.h2(f"5.10 {nm[9]}")
    b.p("No project data address social or economic effects of the site works. This matter is left to the applicant.", "platform:no_data_source", T_NA)
    # 5.11
    b.h2(f"5.11 {nm[10]}")
    b.p(f"{lc['layers']} mapped layers were screened for this lot, as listed in the table below. Of these, {_count(lc['affected'])} MAPPED OR INTERSECTS (an intersect, a mapped control or a land application), {_count(lc['buffer'])} WITHIN BUFFER (inside the screening distance), {_count(lc['not_intersected'])} NOT INTERSECTED BY THE DATA LOADED and {_count(lc['not_checked'])} NOT CHECKED. Not checked is not clear.", "data:sa9.layers")
    b.p("This draft does not conclude that the site is suitable. Section 7 lists the open items.", "platform:method")
    b.bullets([_form(_with_ref(d, "nsw_contamination", "Present and previous land uses and the potential for land contamination are not in the run data (the lot is assumed to be vacant, which is not a records check). The council form asks these questions and refers to State Environmental Planning Policy (Resilience and Hazards) 2021, which was not obtained: NOT REVIEWED, UNRESOLVED."), "Is the present use a potentially contaminated activity?", 2, T_NA)])
    if d.figs:
        nf = len(d.figs)
        b.p(f"A map extract for the land zoning and for each screened layer is in Appendix A (Figures 1 to {nf}). The last column of the table below gives the figure for each layer. A figure that reads MAP NOT AVAILABLE means the layer was not checked, and not checked is not clear.", "map:planning_maps")
        b.table(["Layer", "Result", "Data currency", "Map"], [([r["label"], r["status"], r["currency"], _fig_cell(d, r["key"])], r["source"]) for r in lrows], [2.3, 1.9, 1.9, 1.3], status_col=1)
    else:
        b.table(["Layer", "Result", "Data currency"], [([r["label"], r["status"], r["currency"]], r["source"]) for r in lrows], [2.6, 2.2, 2.2], status_col=1)
    # 5.12
    b.h2(f"5.12 {nm[11]}")
    b.p("No project data address the public interest. This matter is left to the applicant and the consent authority.", "platform:no_data_source", T_NA)


def _flood_item(d: _Data) -> tuple:
    """Flood layer line.  A result of NOT INTERSECTED is only a statement about the data loaded, and is never worded as the lot being outside the flood planning area."""
    l = d.layers.get("nsw_flood")
    if l is not None and l.get("status") == "not_affected":
        offline = " (offline fixture)" if d.fixture else ""
        council = d.locality or "The council area"
        return (_with_ref(d, "nsw_flood", f"The lot is not intersected by the flood data loaded{offline}. This is not confirmed. {council} has flood affected land, so the lot must be checked with a section 10.7 planning certificate and with the council."),
                "data:sa9.layers[nsw_flood]; knowledge:manifest[gunnedah_carroll_fmp_1999]", "NOT INTERSECTED BY THE DATA LOADED")
    return _layer_item(d, "nsw_flood")


def _fig_cell(d: _Data, key: str) -> str:
    f = d.fig(key)
    if not f:
        return "No map in this run"
    return f"Figure {f['no']}" + (" (panel, layer not checked)" if f["rec"].get("state") == "not_checked" else "")


def _zoning_items(d: _Data) -> list[tuple]:
    """Land zoning statements for section 4.15(1)(a)(i): the finding of the zoning map extract, with its figure reference.  Nothing is added when there is no zoning map."""
    zi = d.fig("zoning")
    if not zi:
        return []
    rec = zi["rec"]
    src = "data:sa1.zone_polygons; map:planning_maps[zoning]"
    items = [(_with_ref(d, "zoning", f"Land zoning of the lot: {rec.get('summary') or 'not recorded'}"), src, T_UNRES if rec.get("state") != "map" else "")]
    for bn in rec.get("banners") or []:
        if bn.startswith("MULTI-ZONE") or bn.startswith("MORE THAN ONE ZONE"):
            items.append((bn.rstrip(".") + "." + ("" if "confirm" in bn.lower() else " Confirm the zones with the council before relying on the zone shown."), src, T_UNRES))
    return items


def _layer_item(d: _Data, key: str) -> tuple:
    tag, text, src = _layer_line(d, key)
    return (_with_ref(d, key, text), src, tag)


def _riparian(d: _Data) -> tuple | None:
    l = d.layers.get("nsw_riparian")
    if l is None:
        return None
    tag, text, src = _layer_line(d, "nsw_riparian")
    return (_with_ref(d, "nsw_riparian", text), src, tag)


# ---- 6 Compliance table
def _compliance(d: _Data) -> list[dict]:
    """Rows: control, requirement text (from cited values), citation, data value, basis, status.  PASS or FAIL only from a numeric comparison of a
    cited value with a data value; everything else is UNRESOLVED."""
    w = d.w
    drv, ter = w.get("driveway", {}), w.get("terrain", {})
    rows: list[dict] = []

    def add(control, req_text, r, data_text, basis, status, source, key="", value=None, limit=None):
        rows.append({"control": T(control), "requirement": T(req_text), "citation": cite_dict(r) if isinstance(r, Requirement) else None, "cite_ref": cite_ref(r) if isinstance(r, Requirement) else "",
                     "quote": fmt.shorten_quote(r.source.quote, 150) if isinstance(r, Requirement) and r.source else "", "data": T(data_text), "basis": T(basis), "status": status, "source": source,
                     "outcome": status.split(" (")[0], "key": key, "value": value, "limit": limit})

    def nofound(key_label):
        return f"No citable control for {key_label} was found in the obtained documents."

    def textctl(control, key, data_text, basis):
        r = d.r(key)
        if r is None:
            add(control, nofound(control.lower()), None, data_text, basis, "UNRESOLVED", f"knowledge:unresolved {key}")
        else:
            add(control, f"{reqval(r)}" if not isinstance(r.value, bool) else "Required (policy statement, no numeric limit)", r, data_text, basis + " No numeric comparison is possible.", "UNRESOLVED", f"doc:{T(r.source.document_title)} page {r.source.page} ({key})")

    # width of access
    wmin, wmax = d.r("driveway.min_width_m"), d.r("driveway.max_width_m")
    if wmin and wmax and drv.get("present") and drv.get("width_m") is not None:
        wd = drv["width_m"]
        st = "PASS" if wmin.value - 1e-9 <= wd <= wmax.value + 1e-9 else "FAIL"
        wb, wdef = width_basis(drv)
        if st == "PASS" and wdef:
            st = "PASS (PLATFORM DEFAULT, TO BE CONFIRMED)"
        add("Width of access (excluding layback splays)", f"{wmin.value:g} to {wmax.value:g} m", wmin, f"{wd:.1f} m", f"Driveway width on the plan set. Basis recorded: {wb[:1].lower() + wb[1:]}. Confirm against the council standard drawing.", st, f"doc:{T(wmin.source.document_title)} page {wmin.source.page} ({wmin.key}, {wmax.key}); data:planset.driveway.width_m; planset:C420.layover_values[drive]")
    else:
        add("Width of access (excluding layback splays)", nofound("width of access") if not (wmin and wmax) else f"{wmin.value:g} to {wmax.value:g} m", wmin, "no driveway width in the data", "No driveway result.", "UNRESOLVED", "data:planset.driveway")
    # crossings per frontage
    cmax = d.r("driveway.max_crossings_per_frontage")
    if cmax and drv.get("present") and drv.get("crossings") is not None:
        n = drv["crossings"]
        st = "PASS" if n <= cmax.value + 1e-9 else "FAIL"
        extra = f" Note on the cited sources: {T(cmax.prompt)}" if cmax.prompt else ""
        add("Crossings per street frontage (maximum)", f"at most {cmax.value:g}", cmax, f"{n} crossover" + ("s" if n != 1 else ""), "Count of crossovers on the plan set." + extra, st, f"doc:{T(cmax.source.document_title)} page {cmax.source.page} ({cmax.key}); data:planset.driveway.crossings")
    else:
        add("Crossings per street frontage (maximum)", nofound("crossings"), cmax, "no driveway in the data", "", "UNRESOLVED", "data:planset.driveway")
    textctl("Multiple access points and laybacks", "access.multiple_access_points", "one crossover and one layback are shown", "The control is a policy statement (generally only where a lot has two road frontages).")
    # common boundary
    cb = d.r("driveway.min_separation_from_common_boundary_m")
    dist = drv.get("crossover_to_common_boundary_m")
    if cb and dist is not None:
        st = "PASS" if dist >= cb.value - 1e-9 else "FAIL"
        add("Crossing to common property boundary (minimum)", f"at least {cb.value:g} m", cb, f"{dist:.1f} m", "Computed from the crossover polygon to the side boundary lines of the lot, extended across the verge (cadastre, indicative).", st, f"doc:{T(cb.source.document_title)} page {cb.source.page} ({cb.key}); data:planset.driveway.crossover_to_common_boundary_m")
    else:
        add("Crossing to common property boundary (minimum)", nofound("crossing to common boundary") if not cb else f"at least {cb.value:g} m", cb, "not computed", "No crossover or boundary data.", "UNRESOLVED", "data:planset.driveway")
    cc = d.r("driveway.min_separation_m")
    add("Crossing to corner allotment boundary (minimum)", f"at least {cc.value:g} m" if cc else nofound("corner separation"), cc, "not determined", "The lot data show one road frontage, but corner allotment status is not confirmed by a records check.", "UNRESOLVED", f"doc:{T(cc.source.document_title)} page {cc.source.page} ({cc.key})" if cc else "knowledge:unresolved driveway.min_separation_m")
    ck = d.r("driveway.min_crossing_kerb_separation_m")
    add("Kerb separation between crossings (minimum)", f"at least {ck.value:g} m" if ck else nofound("kerb separation"), ck, "not determined", "Neighbouring crossings are not in the run data.", "UNRESOLVED", f"doc:{T(ck.source.document_title)} page {ck.source.page} ({ck.key})" if ck else "knowledge:unresolved driveway.min_crossing_kerb_separation_m")
    textctl("Access to comply with council standard drawings and AS 2890", "access.crossing_standard", "no council standard drawing selected", "Council crossing standard drawing: NOT SELECTED. AS/NZS 2890.1 is the Australian Standard for off-street parking and is not a council crossing standard.")
    textctl("Internal driveway surface", "access.internal_surface", "material not selected", "Allowed materials are listed by the control.")
    mg = d.r("driveway.max_grade_pct")
    steep = next((c for c in drv.get("profile_checks", []) if c["name"] == "max_grade" and c["value"] is not None), None)
    add("Driveway maximum grade", f"at most {mg.value:g} {mg.unit}" if mg else nofound("driveway maximum grade"), mg,
        f"steepest profile grade {steep['value']:g}% (platform screening only)" if steep else "not evaluated", "Not compared: no cited council limit." if not mg else "", "UNRESOLVED", f"doc:{T(mg.source.document_title)} page {mg.source.page}" if mg else "knowledge:unresolved driveway.max_grade_pct")
    # slope
    th = d.r("site.slope_geotech_threshold_pct")
    if th and ter.get("available"):
        v = ter["max_gradient_pct"]
        st = "NOT TRIGGERED (INDICATIVE, 5 m DEM)" if v <= th.value + 1e-9 else "TRIGGERED (INDICATIVE, 5 m DEM)"
        add("Slope above which a detailed geotechnical investigation is required", f"slopes greater than {th.value:g}%", th, f"steepest DEM gradient {v:.1f}% (average fall {ter['avg_fall_pct']:.1f}%)", "5 m DEM, INDICATIVE: too coarse to rule out local steeper ground. NOT TRIGGERED means that the steepest gradient in the DEM does not exceed the threshold. It does not rule out steeper local ground.", st, f"doc:{T(th.source.document_title)} page {th.source.page} ({th.key}); data:planset.terrain.max_gradient_pct")
    else:
        add("Slope above which a detailed geotechnical investigation is required", nofound("slope"), th, "no levels", "", "UNRESOLVED", "data:planset.terrain")
    textctl("Stormwater designed to the Engineering Design Minimum Standards", "stormwater.designed_per_eng_standards", "no stormwater design provided", "TO BE COMPLETED BY THE APPLICANT.")
    side = fall_side(ter)
    add("Legal point of stormwater discharge", nofound("legal point of discharge"), None, "not in the run data" + (f"; the lot falls {side} the street (INDICATIVE, 5 m DEM)" if side else ""),
        "Confirm with the council." + (" An inter-allotment drainage easement or another solution may be required." if side in ("away from", "across") else ""), "UNRESOLVED", "planset:sheets[C001]; data:planset.terrain.fall_away_c")
    fb, ap = d.r("flood.freeboard_m"), d.r("flood.planning_level_aep_pct")
    add("Flood planning level", f"{ap.value:g}% AEP flood plus {fb.value:g} m freeboard" if (fb and ap) else nofound("flood planning level"), fb, "lot specific level not in the run data", "A flood certificate or flood information is needed from the council.", "UNRESOLVED", f"doc:{T(fb.source.document_title)} page {fb.source.page} ({fb.key})" if fb else "knowledge:unresolved flood.lot_specific_fpl")
    textctl("Servicing strategy with the application", "utilities.servicing_strategy_required", "no servicing strategy provided", "TO BE COMPLETED BY THE APPLICANT.")
    textctl("Connection to potable water where available", "water.potable_connection_required_if_available", "availability of a connection is not in the run data", "Council network maps are needed.")
    wc, wf = d.r("water.min_cover_m"), d.r("water.min_cover_m.footway_reserve")
    add("Water service cover (minimum)", f"{wc.value * 1000:g} mm under carriageways and {wf.value * 1000:g} mm in footway reserves" if (wc and wf) else nofound("water service cover"), wc, "no water service depth in the data", "Depths are never inferred. Confirm by potholing.", "UNRESOLVED", f"doc:{T(wc.source.document_title)} page {wc.source.page} ({wc.key})" if wc else "knowledge:unresolved water.min_cover_m")
    sc_, sg_ = d.r("sewer.house_connection_min_cover_m"), d.r("sewer.house_connection_min_grade_1_in")
    add("Sewer property connection cover and grade (minimum)", f"{sc_.value * 1000:g} mm of cover at a grade of 1 in {sg_.value:g}" if (sc_ and sg_) else nofound("sewer connection"), sc_, "no sewer connection in the data", "Connection depends on the building design (by others).", "UNRESOLVED", f"doc:{T(sc_.source.document_title)} page {sc_.source.page} ({sc_.key})" if sc_ else "knowledge:unresolved sewer.house_connection_min_cover_m")
    textctl("Building over or near a council sewer main", "util.build_over_sewer_policy", "no sewer main location in the data", "The policy document was not obtained.")
    esc_ = w.get("esc", {})
    ar = d.r("esc.access.min_length_m")
    alen = esc_.get("access_length_m")
    if ar and alen is not None and esc_.get("shown_on_plan"):
        ok = alen + 0.05 >= ar.value                          # the same 0.05 m tolerance as the plan set uses for this check
        add("Stabilised site access length (minimum)", f"at least {ar.value:g} m", ar, f"{alen:.1f} m drawn on C500",
            "Length of the stabilised access in the SA10 layout, INDICATIVE (0.05 m tolerance)." + ("" if ok else " The drawn access is shorter than the cited minimum, and the lot may not allow the cited length in this layout.") + " To be resolved by the ESCP preparer.",
            "PASS (INDICATIVE LAYOUT, TO BE CONFIRMED)" if ok else "FAIL", f"doc:{T(ar.source.document_title)} page {ar.source.page} ({ar.key}); file:escp_*.geojson", key="access_length", value=alen, limit=ar.value)
    else:
        add("Stabilised site access length (minimum)", f"at least {ar.value:g} m" if ar else nofound("stabilised access length"), ar, "no stabilised access length in the data", "The ESC layout is not shown on C500 or has no access element.", "UNRESOLVED", f"doc:{T(ar.source.document_title)} page {ar.source.page} ({ar.key})" if ar else "knowledge:unresolved esc.access.min_length_m", key="access_length")
    textctl("Erosion and sediment control plan prepared by a suitably qualified person", "esc.escp.prepared_by_suitably_qualified_person", "ESCP not provided (C500 shows ESCP DATA PENDING)" if not w.get("esc", {}).get("shown_on_plan") else "ESCP layout shown on C500, not yet certified", "TO BE COMPLETED BY THE APPLICANT.")
    add("Batter slopes for cut and fill", nofound("batter slopes"), None, "not shown as values (C600 shows TBC)", "Geotechnical advice is required.", "UNRESOLVED", "planset:sheets[C600]")
    return rows


def _s6(b: _Build, d: _Data, comp: list[dict], cnt: dict) -> None:
    b.sec("6", "Compliance table")
    b.p("The table compares the site works with the cited requirements of Gunnedah Shire Council and the cited erosion and sediment control guidance, for the controls that bear on site works.", "platform:method")
    b.p("PASS, FAIL, NOT TRIGGERED or TRIGGERED appears only where a cited number is compared with a number from the data. Every other row is UNRESOLVED. A result in brackets, such as PLATFORM DEFAULT, TO BE CONFIRMED, shows that the data value is not a survey or a design value, and the result must be confirmed. A PASS does not state that the development complies.", "platform:method")
    qual = sum(1 for r in comp if r["status"].startswith("PASS ("))
    parts = [f"{cnt['PASS']} PASS", f"{cnt['FAIL']} FAIL"] + ([f"{cnt['NOT TRIGGERED']} NOT TRIGGERED"] if cnt["NOT TRIGGERED"] else []) + ([f"{cnt['TRIGGERED']} TRIGGERED"] if cnt["TRIGGERED"] else []) + [f"{cnt['UNRESOLVED']} UNRESOLVED"]
    b.p(f"Result: {', '.join(parts[:-1])} and {parts[-1]} of {len(comp)} controls (the table rows). {qual} of the PASS results rest on a platform default or an indicative layout value and must be confirmed.", "platform:compliance.counts")
    rows = []
    for r in comp:
        req = r["requirement"] + (f" [{r['cite_ref']}" + (f": \"{r['quote']}\"" if r["quote"] else "") + "]" if r["cite_ref"] else "")
        rows.append(([r["control"], req, r["data"] + (f". {r['basis']}" if r["basis"] else ""), r["status"]], r["source"]))
    b.table(["Control", "Requirement and source", "Data and basis", "Status"], rows, [1.4, 2.5, 2.2, 1.25], status_col=3)
    b.p("Controls for the building (setbacks, height, floor space, parking, site coverage, landscaping, floor level and BASIX) are not in this table. " + BUILDING_BY_OTHERS + ".", "scope:site_works_only", T_BLD)


# ---- 7 Conclusion
def _s7(b: _Build, d: _Data, cnt: dict, lc: dict, blocked: list[dict]) -> dict:
    n_nc, n_layers = lc["not_checked"], lc["layers"]
    b.sec("7", "Conclusion")
    b.p("This draft describes the civil and site works shown on the JCESITE plan set and sets out, from the data held by the platform, the matters for consideration under section 4.15 of the EP&A Act.", "platform:method")
    b.p(f"On the data held, {_plural(cnt['PASS'], 'control passes', 'controls pass')} a numeric comparison and {cnt['FAIL']} fail{'s' if cnt['FAIL'] == 1 else ''}. {_plural(cnt['NOT TRIGGERED'], 'threshold control is', 'threshold controls are')} not triggered and {cnt['TRIGGERED']} {'is' if cnt['TRIGGERED'] == 1 else 'are'} triggered. {_plural(cnt['UNRESOLVED'], 'control is', 'controls are')} unresolved, of {sum(cnt.values())} controls in all. {n_nc} of {n_layers} screening layers {'is' if n_nc == 1 else 'are'} NOT CHECKED. {_plural(len(blocked), 'source document was', 'source documents were')} NOT REVIEWED (table 4.1).", "platform:compliance.counts; data:sa9.layers")
    b.p("The data do not establish that the proposed works comply with the controls or that the site is suitable. Whether the works are acceptable is a matter for the consent authority after assessment by qualified persons.", "platform:method")
    b.p(f"The building is outside this statement. {BUILDING_BY_OTHERS}.", "scope:site_works_only", T_BLD)
    b.h2("7.1 Open items for the applicant and qualified persons")
    items = [("Obtain a section 10.7 planning certificate and confirm the zone, permissibility, mapped controls and the layers reported above.", "platform:method")]
    if n_nc:
        items.append((f"Check directly with the authority the {n_nc} screening layers marked NOT CHECKED (section 5.11).", "data:sa9.layers", T_NC))
    items += [("Commission a detail survey (levels, boundaries, kerb, trees, easements and services), and replace the 5 m DEM levels.", "data:run.levels_provenance"),
              ("Lodge a Before You Dig Australia enquiry and confirm service locations by potholing before any excavation.", "planset:sheets[C310].data_missing"),
              ("Obtain a flood certificate or flood information and the council legal point of stormwater discharge" + (" (an inter-allotment drainage easement or another solution may be required, because the lot falls " + ("away from the street" if fall_side(d.w.get("terrain", {})) == "away from" else "across the street frontage") + ")" if fall_side(d.w.get("terrain", {})) in ("away from", "across") else "") + ", and have a hydraulic designer prepare the stormwater design.", "knowledge:unresolved flood.lot_specific_fpl; data:planset.terrain.fall_away_c"),
              ("Select the council standard crossing drawing and driveway materials, and confirm the driveway grade control with the council.", "knowledge:unresolved driveway.max_grade_pct"),
              ("Have an erosion and sediment control plan prepared by a suitably qualified person, and obtain geotechnical advice for the earthworks and batters.", "planset:sheets[C500].data_missing"),
              ("Obtain and review the documents listed in section 4.1 as NOT REVIEWED, and update this statement.", "knowledge:manifest"),
              ("Complete the social and economic and public interest matters and the building related matters. " + BUILDING_BY_OTHERS + ".", "scope:site_works_only", T_BLD),
              ("Have a qualified person check and verify every statement in this document before any use.", "platform:method")]
    b.bullets(items)
    return {"layers_not_checked": n_nc, "documents_not_reviewed": [s["id"] for s in blocked], "controls_unresolved": [r["control"] for r in _compliance(d) if r["status"] == "UNRESOLVED"]}


# ---- 8 Limitations
def _s8(b: _Build, d: _Data, blocked: list[dict]) -> None:
    b.sec("8", "Limitations")
    b.bullets([
        ("This document was produced by software using public map data, the plan set data and requirement values extracted from the documents listed in section 4.2. No person has checked or certified it.", "app.report.explain.SIGN_OFF"),
        ("A qualified person must check and verify every result, source and figure before any use. Matters that need professional sign off include boundaries (registered surveyor), flood and drainage (qualified engineer), bushfire (qualified assessor), soils and ground (qualified geotechnical engineer) and approvals (council or an accredited certifier).", "app.report.explain.SIGN_OFF"),
        ("Where a requirement is shown as UNRESOLVED, or a layer as NOT CHECKED, the matter remains open and must be confirmed with the authority.", "app.report.explain.SIGN_OFF"),
        ("Levels come from a 5 m DEM. They are indicative, are not a survey and are too coarse for detailed earthworks. Boundaries come from the cadastre and are not a survey.", "data:run.levels_provenance", T_IND),
        (METHOD_TEXT + " Some values were extracted at a confidence below 1 (recorded in the accompanying data file, soee.json).", "knowledge:requirements.json"),
        (f"{_plural(len(blocked), 'source document', 'source documents')} could not be obtained or could not be read, and {'was' if len(blocked) == 1 else 'were'} NOT REVIEWED (section 4.1). The LEP, the Regulation and the relevant SEPPs have not been read.", "knowledge:manifest", T_NOTREV),
        ("The values drawn on the plan set that are marked PLATFORM DEFAULT, PLACEHOLDER or ASSUMED (driveway width, design vehicle, kerb position, layover widths and flare, driveway end level) are not a design and are not a council selection.", "planset:sheets", T_ASSUMED),
        (f"The building is designed by others with a separate tool. {BUILDING_BY_OTHERS}.", "scope:site_works_only", T_BLD),
    ] + ([("The constraint layer results were rebuilt from a saved live run and are not queried live. Geometry is approximate.", "data:sa9.meta.flags", T_FIX)] if d.fixture else []))


# ---- 9 Glossary
EXTRA_TERMS = [
    ("SoEE", "Statement of Environmental Effects. A document that describes a proposed development and its likely effects on the environment, submitted with a development application."),
    ("EP&A Act", "Environmental Planning and Assessment Act 1979 (NSW). Section 4.15 lists the matters a consent authority considers in determining a development application."),
    ("SEPP", "State environmental planning policy. A State planning instrument that applies across New South Wales or to a class of land or development."),
    ("DA", "Development application. An application to a consent authority for development consent."),
    ("FPL", "Flood planning level. The level that a council adopts for flood related development controls. See the flood matter in section 5.5."),
    ("NOT REVIEWED", "A source document that could not be obtained in this run. Its content has not been read."),
    ("DATA NOT AVAILABLE", "The run holds no data for the item. It has not been estimated or defaulted."),
    ("NOT ASSESSED", "A matter that this draft does not assess because no data bears on it."),
    ("Offline fixture", "Saved data used in place of a live data service. It is test data and is not current."),
    ("Platform driveway calculation", "The platform calculation that supplies the driveway and crossover on the plan set. Its default values are labelled PLATFORM DEFAULT."),
    ("ESC", "Erosion and sediment control. The ESC layout on drawing C500 is an indicative layout and not an erosion and sediment control plan (ESCP)."),
    ("TBC", "To be confirmed. Shown on the plan set where no council value is selected or cited. It is a drafting convention and not a design value."),
    ("PLACEHOLDER", "A dimension drawn only so that the detail can be shown. It is a drafting convention and not a design value or a council dimension."),
    ("BYDA", "Before You Dig Australia. A referral service for finding out about underground assets before excavating."),
]


def _appendix_maps(b: _Build, d: _Data) -> None:
    """Appendix A: the planning map extracts made for the JCESITE site report, in the order of the layer table (section 5.11), numbered 1..n."""
    if not d.figs:
        return
    b.sec("Appendix A", "Planning maps")
    b.p(f"This appendix holds {len(d.figs)} map extracts: the land zoning of the lot and one map for each screened layer. They are the same extracts as the planning maps in the JCESITE site report, which numbers its figures differently. The statements in sections 2, 4 and 5 refer to these figures.", "map:planning_maps")
    b.p("Each extract shows the subject lot (bold outline), the adjoining lot lines, the mapped categories clipped to the area loaded, a legend, a north point, a scale bar and a source line. A hatched area is outside the area the data covers. Mapped boundaries are indicative and are not a survey. Where the licence of a dataset is not recorded in the endpoint metadata, the source line says so and the attribution must be confirmed. A figure that reads MAP NOT AVAILABLE is a layer that was not checked: not checked is not clear.", "map:planning_maps")
    lot = d.lot_label
    for f in d.figs.values():
        rec = f["rec"]
        # the result chip is repeated in the caption only for a drawn map: the other states open their summary with the result in capitals
        res_ = (rec.get("result") or "") if rec.get("state") == "map" else ""
        cap = f"Figure {f['no']}. {f['title']} for {lot}. {res_}".rstrip(". ") + ". " + (rec.get("summary") or "").strip()
        if rec.get("extent") and rec.get("state") != "not_checked":
            cap = cap.rstrip(".") + f". Figure extent {rec['extent']}."
        if rec.get("synthetic"):
            cap = cap.rstrip(".") + ". SYNTHETIC DEMO DATA."
        b.figure(f, cap)


def _s9(b: _Build, body_text: str) -> None:
    b.sec("9", "Glossary")
    terms = list(explain.GLOSSARY) + EXTRA_TERMS
    low = body_text.lower()
    seen, rows = {re.sub(r"\s*\(.*\)$", "", t).lower() for t, _k, _w in explain.RESULT_TERMS} | {"not reviewed, unresolved", "data not available", "not assessed", "assumed / platform default"}, []
    seen |= {"not reviewed", "dbyd"}                  # defined in section 1.3 or duplicated by another entry (BYDA)
    for t, defn in terms:
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        stem = re.sub(r"\s*\(.*\)$", "", t).lower()
        if stem in low or any(w for w in re.findall(r"[a-z0-9&]+", stem) if len(w) > 3 and w in low and len(stem.split()) == 1):
            dd = re.sub(r"\s*See Buffers explained\.", "", defn).replace("In this report", "In the JCESITE site report").replace("in this report", "in the JCESITE site report")
            rows.append(([T(t), T(dd)], "platform:app.report.explain.GLOSSARY" if (t, defn) in explain.GLOSSARY else "platform:method"))
    rows.sort(key=lambda r: r[0][0].lower())
    b.table(["Term", "Definition"], rows, [1.5, 4.5])
