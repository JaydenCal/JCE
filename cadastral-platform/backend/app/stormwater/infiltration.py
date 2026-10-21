"""Infiltration helper (stage 9): the infiltration rate and the storage and emptying time of an infiltration trench.

THE RATE comes only from one of three places, in this order:
1. the user's entry in the panel (``inputs.infiltration``): a SITE TEST (rate, date and method all stated), an INDICATIVE rate typed from a stated source, or a row of the soil
   table the user uploaded (soil unit selected by the user);
2. the rate entered on the trench object (``infiltration_rate_mm_h`` with its basis ``site_test`` or ``indicative``; a site test needs ``test_date``);
3. nothing: the check is NOT EVALUATED and says what to supply.
An INDICATIVE rate (a soil table or a rate typed from a desktop source) is always labelled INDICATIVE, SITE TESTING REQUIRED.

THE TRENCH. Storage V = L x W x D x n (n void ratio). Emptying time t = V / (q x A), A = L x W the base area, q the rate (m/h). Method assumptions, stated on the result: the
rate acts on the base only (no side wall infiltration), the rate is used as supplied (no factor of safety, none is assumed), and the trench starts full. The emptying time is
compared with ``infiltration.max_emptying_time_h`` only when that key resolves; without it the time is reported and the comparison is NOT EVALUATED.
"""
from __future__ import annotations

from typing import Any

from app.design import object_geometry as G
from app.design.param_basis import Reader
from app.design.site_design import SiteObject
from app.design.site_rules import UNRESOLVED, USER, SiteRules

from .catchment import val
from .inputs import USER_REF, StormwaterInputs

INDICATIVE_LABEL = "INDICATIVE, SITE TESTING REQUIRED"
MAX_TIME_KEY = "infiltration.max_emptying_time_h"


def _dmy(iso: str) -> str:
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"


def global_rate(inputs: StormwaterInputs, soil: dict[str, Any] | None) -> dict[str, Any] | None:
    """The rate from the user's panel entry, or None when no entry exists. Returns ``{value..., label, kind, missing}`` where value None means the entry is incomplete."""
    e = inputs.infiltration
    if e is None:
        return None
    if e.source == "site_test":
        miss = [n for n, v in (("THE TEST RATE", e.rate_mm_h), ("THE TEST DATE", e.test_date), ("THE TEST METHOD", e.test_method)) if v is None]
        if miss:
            return {"rate": {**val(None, "mm/h", UNRESOLVED, "A SITE TEST NEEDS " + ", ".join(miss)), "how": "Enter the measured rate, the date of the test and the method used."}, "kind": "site_test", "label": ""}
        return {"rate": val(e.rate_mm_h, "mm/h", USER, f"SITE TEST DATED {_dmy(e.test_date)}, METHOD: {e.test_method.upper()}"), "kind": "site_test", "label": ""}
    if e.source == "indicative":
        if e.rate_mm_h is None or not (e.source_note or "").strip():
            return {"rate": {**val(None, "mm/h", UNRESOLVED, "AN INDICATIVE RATE NEEDS THE RATE AND ITS SOURCE"), "how": "Enter the rate and name the source it was taken from."}, "kind": "indicative", "label": INDICATIVE_LABEL}
        return {"rate": val(e.rate_mm_h, "mm/h", USER, f"INDICATIVE, FROM {e.source_note.upper()}. {INDICATIVE_LABEL}"), "kind": "indicative", "label": INDICATIVE_LABEL}
    # soil table row
    if not soil or not soil.get("rows"):
        return {"rate": {**val(None, "mm/h", UNRESOLVED, "NO SOIL TABLE HAS BEEN UPLOADED"), "how": "Upload the soil table (soil_unit and rate_mm_h columns) in the Infiltration section, or enter a site test."}, "kind": "soil_table", "label": INDICATIVE_LABEL}
    if not e.soil_unit:
        return {"rate": {**val(None, "mm/h", UNRESOLVED, "THE SOIL UNIT THAT APPLIES IS NOT SELECTED"), "how": "Select the soil unit of the site from the uploaded table."}, "kind": "soil_table", "label": INDICATIVE_LABEL}
    row = next((r for r in soil["rows"] if r["soil_unit"] == e.soil_unit), None)
    if row is None:
        return {"rate": {**val(None, "mm/h", UNRESOLVED, f"THE SOIL UNIT {e.soil_unit.upper()} IS NOT IN THE UPLOADED TABLE"), "how": "Select a soil unit that is in the table."}, "kind": "soil_table", "label": INDICATIVE_LABEL}
    p = soil.get("provenance", {})
    return {"rate": val(row["rate_mm_h"], "mm/h", "DATA SOURCE", f"SOIL UNIT {row['soil_unit'].upper()} OF {str(p.get('source', '')).upper()}; DATA DATED {p.get('source_date') or 'NOT STATED'}; FILE {p.get('file_name')}. {INDICATIVE_LABEL}"),
            "kind": "soil_table", "label": INDICATIVE_LABEL}


def trench_rate(o: SiteObject, rd: Reader, glob: dict[str, Any] | None) -> dict[str, Any]:
    """The rate for one trench: the panel entry wins (it is the current site knowledge); else the rate entered on the trench."""
    if glob is not None:
        return {**glob["rate"], "kind": glob["kind"], "label": glob["label"]}
    rate, basis = G.pos(o, "infiltration_rate_mm_h", rd), G.text(o, "infiltration_basis", rd)
    if rate is None:
        return {**val(None, "mm/h", UNRESOLVED, f"NO INFILTRATION RATE ON {o.id.upper()} AND NONE ENTERED IN THE PANEL"), "how": "Enter a site test rate (with date and method) in the Infiltration section, or upload a soil table for an indicative rate.", "kind": None, "label": ""}
    if basis is None:
        return {**val(None, "mm/h", UNRESOLVED, f"THE BASIS OF THE RATE ON {o.id.upper()} IS NOT SET"), "how": "Set the basis of the rate on the trench: site test or indicative.", "kind": None, "label": ""}
    if basis == "indicative":
        return {**val(rate, "mm/h", USER, f"INDICATIVE RATE ENTERED ON {o.id.upper()}. {INDICATIVE_LABEL}"), "kind": "indicative", "label": INDICATIVE_LABEL}
    d, m = G.text(o, "test_date", rd), G.text(o, "test_method", rd)
    if d is None:
        return {**val(None, "mm/h", UNRESOLVED, f"THE DATE OF THE SITE TEST ON {o.id.upper()} IS NOT SET"), "how": "Enter the date of the site test on the trench.", "kind": "site_test", "label": ""}
    if m is None:
        return {**val(None, "mm/h", UNRESOLVED, f"THE METHOD OF THE SITE TEST ON {o.id.upper()} IS NOT STATED"), "how": "Enter the test method on the trench (test_method), or enter the site test in the panel.", "kind": "site_test", "label": ""}
    return {**val(rate, "mm/h", USER, f"SITE TEST DATED {_dmy(d)}, METHOD: {m.upper()}, ENTERED ON {o.id.upper()}"), "kind": "site_test", "label": ""}


def emptying_time_h(volume_m3: float, base_area_m2: float, rate_mm_h: float) -> float | None:
    if volume_m3 <= 0 or base_area_m2 <= 0 or rate_mm_h <= 0:
        return None
    return volume_m3 / (rate_mm_h / 1000.0 * base_area_m2)


def run(*, rules: SiteRules, rd: Reader, inputs: StormwaterInputs, trenches: list[SiteObject], soil: dict[str, Any] | None) -> dict[str, Any]:
    glob = global_rate(inputs, soil)
    mx = rules.get(MAX_TIME_KEY)
    limit = val(mx.value, "h", mx.basis, mx.ref, mx.stamp, key=MAX_TIME_KEY) if mx.resolved and isinstance(mx.value, (int, float)) else {
        **val(None, "h", UNRESOLVED, mx.ref, key=MAX_TIME_KEY), "how": "Load the requirement key infiltration.max_emptying_time_h for the LGA."}
    missing: list[dict[str, Any]] = []
    out: dict[str, Any] = {"schema": "infiltration.v1", "label": "", "rate": None, "limit": limit, "trenches": [], "missing": missing,
                           "notes": ["THE RATE ACTS ON THE BASE ONLY (NO SIDE WALL INFILTRATION), IS USED AS SUPPLIED (NO FACTOR OF SAFETY IS ASSUMED) AND THE TRENCH STARTS FULL"]}
    if glob is not None:
        out["rate"] = {**glob["rate"], "kind": glob["kind"]}
        out["label"] = glob["label"]
        if glob["rate"]["value"] is None:
            missing.append({"id": "infil_rate", "area": "INFILTRATION", "what": glob["rate"]["ref"], "key": None, "how": glob["rate"]["how"]})
    if not trenches:
        out["status"] = "NO TRENCH"
        out["message"] = "NO INFILTRATION TRENCH IS PLACED, SO THERE IS NO STORAGE OR EMPTYING TIME TO CHECK"
        return out
    done = 0
    for o in trenches:
        ln = G.line_of(o)
        L, W, D = (ln.length if ln is not None else None), G.pos(o, "width_m", rd), G.pos(o, "depth_m", rd)
        n = G.num(o, "void_ratio", rd)
        q = trench_rate(o, rd, glob)
        row: dict[str, Any] = {"object_id": o.id, "label": (o.label or o.id).upper(), "rate": q, "steps": [], "volume_m3": None, "emptying_time_h": None, "does_not_empty": False, "status": "NOT EVALUATED", "missing": [],
                               "check": {"status": "NOT EVALUATED", "message": ""}}
        for nm, v in (("LENGTH", L), ("WIDTH", W), ("DEPTH", D)):
            if v is None:
                row["missing"].append({"id": f"{o.id}:{nm.lower()}", "area": "INFILTRATION", "what": f"TRENCH {o.id}: {nm} NOT SET", "key": None, "how": f"Enter the {nm.lower()} of {o.id}."})
        if n is None or not 0 < n <= 1:
            row["missing"].append({"id": f"{o.id}:void", "area": "INFILTRATION", "what": f"TRENCH {o.id}: VOID RATIO " + ("NOT SET" if n is None else "MUST BE ABOVE 0 AND AT MOST 1"), "key": None, "how": f"Enter the void ratio of {o.id}."})
        if not row["missing"]:
            v = L * W * D * n
            a = L * W
            row["volume_m3"] = round(v, 4)
            row["steps"].append({"id": "volume", "title": "Trench storage", "formula": "V = L x W x D x n",
                                 "inputs": [{"name": "Length", "symbol": "L", **val(round(L, 3), "m", "MODEL", "CENTRELINE LENGTH OF THE TRENCH")},
                                            {"name": "Width", "symbol": "W", **val(W, "m", USER, f"ENTERED ON {o.id.upper()}")},
                                            {"name": "Depth", "symbol": "D", **val(D, "m", USER, f"ENTERED ON {o.id.upper()}")},
                                            {"name": "Void ratio", "symbol": "n", **val(n, "", USER, f"ENTERED ON {o.id.upper()}")}],
                                 "result": {"value": round(v, 4), "unit": "m3", "text": f"V = {L:.3f} x {W:g} x {D:g} x {n:g} = {v:.3f} m3"}})
            if q["value"] is None:
                row["missing"].append({"id": f"{o.id}:rate", "area": "INFILTRATION", "what": f"TRENCH {o.id}: {q['ref']}", "key": None, "how": q["how"]})
            else:
                t = emptying_time_h(v, a, q["value"])
                row["emptying_time_h"] = None if t is None else round(t, 4)
                q_in = {k: q[k] for k in ("value", "unit", "basis", "ref")}
                row["steps"].append({"id": "emptying", "title": "Emptying time", "formula": "t = V / (q x A), A = L x W, q in m/h",
                                     "inputs": [{"name": "Storage volume", "symbol": "V", **val(round(v, 4), "m3", "CALCULATED", "STEP ABOVE")},
                                                {"name": "Base area", "symbol": "A", **val(round(a, 3), "m2", "CALCULATED", "L x W")},
                                                {"name": "Infiltration rate", "symbol": "q", **q_in}],
                                     "result": {"value": row["emptying_time_h"], "unit": "h",
                                                "text": (f"t = {v:.3f} / ({q['value'] / 1000:.6f} x {a:.3f}) = {t:.2f} h" if t is not None
                                                         else f"t = {v:.3f} / ({q['value'] / 1000:.6f} x {a:.3f}): THE RATE IS NOT ABOVE ZERO, SO THE TRENCH DOES NOT EMPTY")}})
                row["status"] = "EVALUATED"
                row["does_not_empty"] = t is None
                done += 1
                if t is None:
                    row["check"] = {"status": "FAIL", "message": f"DOES NOT EMPTY: THE INFILTRATION RATE ({q['value']:g} MM/H) IS NOT ABOVE ZERO, SO WATER STORED IN THE TRENCH CANNOT INFILTRATE"}
                elif limit["value"] is None:
                    row["check"] = {"status": "NOT EVALUATED", "message": "THE LIMIT ON THE EMPTYING TIME (infiltration.max_emptying_time_h) IS UNRESOLVED, SO THE TIME IS REPORTED WITHOUT A COMPARISON"}
                    missing.append({"id": "max_empty", "area": "INFILTRATION", "what": "THE LIMIT ON THE EMPTYING TIME IS UNRESOLVED", "key": MAX_TIME_KEY, "how": limit["how"]})
                else:
                    ok = t <= limit["value"] + 1e-9
                    row["check"] = {"status": "PASS" if ok else "FAIL", "message": f"EMPTYING TIME {t:.2f} H {'DOES NOT EXCEED' if ok else 'EXCEEDS'} THE LIMIT {limit['value']:g} H ({limit['basis']})"}
        missing.extend(row["missing"])
        row["rate_label"] = q.get("label") or ""
        out["trenches"].append(row)
    out["status"] = "EVALUATED" if done == len(trenches) else "NOT EVALUATED" if done == 0 else "PARTLY EVALUATED"
    if out["status"] != "EVALUATED":
        out["message"] = "NOT EVALUATED FOR " + ", ".join(t["object_id"] for t in out["trenches"] if t["status"] != "EVALUATED") + ": SEE THE LIST OF MISSING INPUTS"
    if glob is not None and glob["label"]:
        out["notes"].append(INDICATIVE_LABEL)
    return out
