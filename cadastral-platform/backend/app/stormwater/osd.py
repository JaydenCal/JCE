"""On site detention sizing (stage 9). The METHOD is selected by the requirement key ``stormwater.osd_method`` (or the user's entry); no method is built in as a default.

Two calculation engines exist, each selectable by name, each with its own inputs. A method that is not resolved, or that is not one of these names, gives NOT EVALUATED and the
panel still lists every input that did resolve.

* ``mass_balance_modified_rational``: a simple mass balance of the Modified Rational inflow hydrograph against a constant permissible site discharge (PSD) outflow, searched over
  the storm durations of the design rainfall table from the time of concentration up to the search limit.
  Inflow peak for a duration td at the design AEP:  Qp = (sum of C x A) x I(td) / 3.6e6   (Qp in m3/s, C x A in m2, I in mm/h).
  Hydrograph: Q rises in a straight line from 0 at t = 0 to Qp at t = Tc, stays at Qp to t = td, and falls in a straight line to 0 at t = td + Tc (td not less than Tc).
  Outflow: the PSD, from the moment the inflow first exceeds it (before that the whole inflow leaves, so nothing is stored).
  Storage is the area between the inflow and the PSD line while inflow exceeds the PSD:   S = (Qp - PSD) x (td - Tc x PSD / Qp)   (S in m3, times in seconds), and 0 when Qp <= PSD.
  The required storage is the largest S over the durations searched; its duration is the critical duration.
* ``user_ssr``: the site storage requirement as entered (``stormwater.ssr_m3``, or ``stormwater.ssr_m3_per_ha`` times the area the user states it applies to).

Method assumptions are printed with the result. Bypass areas (surfaces that do not reach a placed OSD) are listed and their flow is NOT deducted from the PSD.
"""
from __future__ import annotations

import math
from typing import Any

from app.design import object_geometry as G
from app.design.param_basis import Reader
from app.design.site_design import SiteObject
from app.design.site_rules import DEFAULT, UNRESOLVED, USER, SiteRules

from .catchment import val
from .inputs import DEFAULT_SEARCH_MAX_MIN, OSD_METHODS, USER_REF, StormwaterInputs
from .rainfall import IfdResult, IfdTable

G_MS2 = 9.81            # gravitational acceleration, a physical constant
TOL_M2 = 0.05
METHOD_ALIASES = {"mass_balance": "mass_balance_modified_rational", "ssr": "user_ssr", "site_storage_requirement": "user_ssr"}


def _norm(text: str) -> str:
    return "_".join(text.lower().replace("-", " ").replace("_", " ").split())


def method_of(text: str | None) -> str | None:
    if not text:
        return None
    n = _norm(text)
    n = METHOD_ALIASES.get(n, n)
    return n if n in OSD_METHODS else None


def step(id_: str, title: str, formula: str, inputs: list[dict[str, Any]], result: dict[str, Any] | None, **extra: Any) -> dict[str, Any]:
    return {"id": id_, "title": title, "formula": formula, "inputs": inputs, "result": result, **extra}


def inp(name: str, symbol: str, v: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "symbol": symbol, **v}


def unresolved(why: str, how: str, key: str | None = None, unit: str = "") -> dict[str, Any]:
    d = {**val(None, unit, UNRESOLVED, why), "how": how}
    if key:
        d["key"] = key
    return d


def from_rule(rules: SiteRules, key: str, unit: str, how: str) -> dict[str, Any]:
    r = rules.get(key)
    if r.resolved:
        return val(r.value, unit, r.basis, r.ref, r.stamp, key=key)
    return unresolved(r.ref, how, key, unit)


def mass_balance(ca_m2: float, tc_min: float, psd_l_s: float, ifd: IfdTable, aep_pct: float, search_max_min: float) -> dict[str, Any]:
    """The critical duration search. Returns the table of durations and the critical row, or ``error`` when the table has no usable duration.
    The durations searched are the rows of the table from Tc up to the search limit, and Tc itself when it is not a row of the table (a storm of duration Tc is the shortest the
    Modified Rational hydrograph allows). Its intensity is interpolated in log duration and log intensity between the two nearest rows and is labelled INTERPOLATED; when Tc is
    shorter than the first row (or longer than the last) it cannot be interpolated and is not searched (``tc_search`` says so)."""
    psd = psd_l_s / 1000.0
    durs: list[tuple[float, bool]] = [(d, False) for d in ifd.durations_min if not (d + 1e-9 < tc_min or d > search_max_min + 1e-9)]
    tc_search = "TC IS A ROW OF THE RAINFALL TABLE"
    if not any(math.isclose(d, tc_min, rel_tol=1e-9, abs_tol=1e-9) for d in ifd.durations_min):
        if tc_min > search_max_min + 1e-9:
            tc_search = "TC IS LONGER THAN THE SEARCH LIMIT, SO IT IS NOT SEARCHED"
        elif ifd.intensity(tc_min, aep_pct) is None:
            tc_search = "TC IS OUTSIDE THE DURATIONS OF THE RAINFALL TABLE, SO ITS INTENSITY CANNOT BE INTERPOLATED AND IT IS NOT SEARCHED"
        else:
            durs.append((tc_min, True))
            tc_search = "TC IS NOT A ROW OF THE RAINFALL TABLE: ITS INTENSITY IS INTERPOLATED (LOG DURATION, LOG INTENSITY) AND IT IS SEARCHED AS A DURATION"
    durs.sort(key=lambda x: x[0])
    rows: list[dict[str, Any]] = []
    for d, is_tc in durs:
        got = ifd.intensity(d, aep_pct)
        if got is None:
            continue
        inten, method = got
        qp = ca_m2 * inten / 3.6e6
        if qp <= psd:
            s = 0.0
        else:
            s = (qp - psd) * (d * 60.0 - tc_min * 60.0 * psd / qp)
        rows.append({"duration_min": d, "intensity_mm_h": round(inten, 4), "intensity_method": method, "is_tc": is_tc, "qp_l_s": round(qp * 1000.0, 4), "inflow_volume_m3": round(qp * d * 60.0, 4),
                     "storage_m3": round(s, 4)})
    if not rows:
        return {"rows": [], "critical": None, "at_range_end": False, "tc_search": tc_search, "error": "NO DURATION OF THE RAINFALL TABLE LIES BETWEEN THE TIME OF CONCENTRATION AND THE SEARCH LIMIT"}
    crit = max(range(len(rows)), key=lambda k: (rows[k]["storage_m3"], -rows[k]["duration_min"]))
    return {"rows": rows, "critical": rows[crit], "at_range_end": crit == len(rows) - 1 and rows[crit]["storage_m3"] > 0 and len(rows) > 1, "tc_search": tc_search, "error": None}


def orifice_diameter_mm(psd_l_s: float, cd: float, head_to_invert_m: float | None, head_to_centre_m: float | None) -> tuple[float, float] | None:
    """Diameter (mm) of a circular orifice that passes the PSD, and the head to its centre used. With only the head to the invert (the top water level less the invert), the
    centre sits half a diameter higher, so the diameter is found by iteration: d = SQRT(4 Q / (pi x Cd x SQRT(2 g h))) with h = H0 - d / 2. None when no diameter exists."""
    q = psd_l_s / 1000.0
    if q <= 0 or cd <= 0:
        return None
    if head_to_centre_m is not None:
        if head_to_centre_m <= 0:
            return None
        d = math.sqrt(4 * q / (math.pi * cd * math.sqrt(2 * G_MS2 * head_to_centre_m)))
        return d * 1000.0, head_to_centre_m
    if head_to_invert_m is None or head_to_invert_m <= 0:
        return None
    h, d = head_to_invert_m, 0.0
    for _ in range(100):
        d_new = math.sqrt(4 * q / (math.pi * cd * math.sqrt(2 * G_MS2 * h)))
        h_new = head_to_invert_m - d_new / 2.0
        if h_new <= 0:
            return None
        if abs(d_new - d) < 1e-9:
            d = d_new
            h = h_new
            break
        d, h = d_new, h_new
    return d * 1000.0, h


def run(*, rules: SiteRules, rd: Reader, inputs: StormwaterInputs, osds: list[SiteObject], rwts: list[SiteObject], post_rows: list[dict[str, Any]], unclassified_m2: float | None,
        lot_area_m2: float | None, ifd: IfdResult, rainfall_source: str, objs_by_id: dict[str, SiteObject]) -> dict[str, Any]:
    missing: list[dict[str, Any]] = []

    def need(id_: str, what: str, how: str, key: str | None = None) -> None:
        missing.append({"id": id_, "area": "OSD", "what": what, "key": key, "how": how})

    # ---- required at all
    req = rules.get("stormwater.osd_required")
    req_v = val(req.value, "", req.basis, req.ref, req.stamp, key=req.key) if req.resolved else unresolved(req.ref, "Load the requirement key stormwater.osd_required for the LGA.", req.key)
    # ---- method
    m_text: str | None
    if inputs.osd_method:
        method_v = val(inputs.osd_method, "", USER, USER_REF, key="stormwater.osd_method")
        m_text = inputs.osd_method
    else:
        mr = rules.get_text("stormwater.osd_method")
        m_text = mr.value
        method_v = val(mr.value, "", mr.basis, mr.ref, mr.stamp, key=mr.key) if mr.resolved else unresolved(
            mr.ref, "Load the requirement key stormwater.osd_method for the LGA, or enter the method in the panel. The methods this tool can run are: " + ", ".join(OSD_METHODS) + ".", mr.key)
    method = method_of(m_text)
    # ---- the resolved inputs (shown whether or not the method can run)
    psd_v = _psd(rules, rd, inputs, osds)
    aep_v = (val(inputs.design_aep_pct, "%", USER, USER_REF, key="stormwater.design_aep_pct") if inputs.design_aep_pct is not None
             else from_rule(rules, "stormwater.design_aep_pct", "%", "Enter the design AEP in the panel, or load the requirement key stormwater.design_aep_pct for the LGA."))
    tc_v = (val(inputs.tc_post_min, "min", USER, USER_REF, key="stormwater.tc_post_min") if inputs.tc_post_min is not None
            else from_rule(rules, "stormwater.tc_post_min", "min", "Enter the post development time of concentration in the panel (state how you found it), or load the requirement key stormwater.tc_post_min."))
    search_v = (val(inputs.search_max_duration_min, "min", USER, USER_REF) if inputs.search_max_duration_min is not None
                else val(DEFAULT_SEARCH_MAX_MIN, "min", "SEARCH RANGE", "DEFAULT OF THIS TOOL: A COMPUTATION RANGE, NOT A REQUIREMENT. Enter a different limit in the panel."))
    # catchment draining to the OSD
    osd_ids = {o.id for o in osds}
    # a surface whose route is broken (no valid target) is never silently left out of the catchment: it blocks the sizing until it is routed
    unrouted = [r for r in post_rows if r["route"].get("to") is None]
    if osd_ids:
        contrib = [r for r in post_rows if osd_ids & set(r["route"].get("path") or [])]
        bypass = [r for r in post_rows if not (osd_ids & set(r["route"].get("path") or []))]
        c_basis = "SURFACES ROUTED TO A PLACED OSD"
    else:
        contrib = [r for r in post_rows if not any(objs_by_id.get(n) is not None and objs_by_id[n].type == "infiltration_trench" for n in (r["route"].get("path") or []))]
        bypass = [r for r in post_rows if r not in contrib]
        c_basis = "ALL POST DEVELOPMENT SURFACES (NO OSD IS PLACED, SO ROUTING TO IT IS NOT YET DEFINED)"
    bad = [r for r in contrib if r["area_m2"] is None or r["ca_m2"] is None]
    ca = round(sum(r["ca_m2"] for r in contrib if r["ca_m2"] is not None), 4)
    area = round(sum(r["area_m2"] for r in contrib if r["area_m2"] is not None), 3)
    if not contrib:
        ca_v = unresolved("NO POST DEVELOPMENT SURFACE DRAINS TO THE OSD", "Draw the surfaces (roof, driveway, paving, landscape) and link them to the OSD.", None, "m2")
    elif bad:
        ca_v = unresolved(f"{len(bad)} SURFACE(S) HAVE NO AREA OR NO RUNOFF COEFFICIENT", "Complete the catchment table: every row needs an area and a runoff coefficient.", None, "m2")
    else:
        ca_v = val(ca, "m2", "CALCULATED", f"SUM OF C x A OVER {len(contrib)} ROW(S), {area:.1f} M2 OF SURFACE")
    inputs_view = [inp("Permissible site discharge", "PSD", psd_v), inp("Design AEP", "AEP", aep_v), inp("Time of concentration, post development", "Tc", tc_v),
                   inp("Sum of C x A draining to the OSD", "sum(C x A)", ca_v), inp("Longest duration searched", "td max", search_v)]
    out: dict[str, Any] = {
        "schema": "osd_sizing.v1", "osd_required": req_v, "method": {**method_v, "recognised": method is not None, "implemented": list(OSD_METHODS), "name": method},
        "inputs": inputs_view, "catchment": {"basis": c_basis, "area_m2": area, "ca_m2": ca if not bad else None, "rows": [r["id"] for r in contrib],
                                            "bypass": [{"id": r["id"], "object_id": r["object_id"], "area_m2": r["area_m2"], "ca_m2": r["ca_m2"], "reason": r["route"].get("reason") or r["route"].get("basis")} for r in bypass],
                                            "bypass_note": "BYPASS AREAS DO NOT REACH A PLACED OSD. THEIR FLOW IS NOT DEDUCTED FROM THE PSD" if bypass and osd_ids else "",
                                            "complete": bool(unclassified_m2 is not None and unclassified_m2 <= TOL_M2),
                                            "unclassified_m2": unclassified_m2, "unrouted": [_unrouted_item(r) for r in unrouted]},
        "ifd": {"status": ifd.status, "message": ifd.message, "source": rainfall_source}, "steps": [], "required_storage_m3": None, "critical": None, "search": None,
        "notes": ["METHOD ASSUMPTIONS: THE RUNOFF COEFFICIENTS ARE USED AS SUPPLIED FOR THE DESIGN EVENT; THE OUTFLOW IS A CONSTANT PSD; A TANK IS TAKEN AS FULL (NO REUSE CREDIT)"],
        "missing": missing, "orifice": None, "provided": None, "comparison": None,
    }
    # ---- gate: required, method
    if not req_v["value"] and req_v["value"] is not None:
        out["status"] = "NOT REQUIRED"
        out["message"] = f"ON SITE DETENTION IS NOT REQUIRED ({req_v['basis']}), SO NO STORAGE IS SIZED"
        out["provided"] = _provided(rules, rd, inputs, osds, rwts, post_rows)
        return out
    if req_v["value"] is None:
        need("osd_required", "WHETHER ON SITE DETENTION IS REQUIRED IS UNRESOLVED", req_v["how"], "stormwater.osd_required")
    if method is None:
        if m_text:
            need("osd_method", f"THE METHOD {m_text!r} IS NOT ONE THIS TOOL CAN RUN", "Enter or load one of: " + ", ".join(OSD_METHODS) + ".", "stormwater.osd_method")
        else:
            need("osd_method", "THE OSD SIZING METHOD IS UNRESOLVED", method_v["how"], "stormwater.osd_method")
        out["status"] = "NOT EVALUATED"
        out["message"] = "NOT EVALUATED: THE SIZING METHOD IS NOT RESOLVED. THE INPUTS BELOW ARE THE ONES THAT DID RESOLVE"
        out["provided"] = _provided(rules, rd, inputs, osds, rwts, post_rows)
        return out
    # ---- the method
    if method == "user_ssr":
        _ssr(out, rules, inputs, lot_area_m2, area if not bad else None, need, unrouted)
    else:
        _mass_balance(out, ifd, psd_v, aep_v, tc_v, ca_v, search_v, need, bad, unrouted, contrib)
    out["provided"] = _provided(rules, rd, inputs, osds, rwts, post_rows)
    if out["required_storage_m3"] is not None:
        out["comparison"] = _compare(out["required_storage_m3"], out["provided"], osds, need)
    out["orifice"] = _orifice(rules, rd, inputs, osds, psd_v)
    out["status"] = "EVALUATED" if out["required_storage_m3"] is not None else "NOT EVALUATED"
    if out["status"] == "NOT EVALUATED":
        out["message"] = "NOT EVALUATED: " + "; ".join(m["what"] for m in missing if m["area"] == "OSD")[:600]
        if unrouted and any(m["id"].startswith("unrouted:") for m in missing):
            out["message"] = _unrouted_message(unrouted)
    return out


def _unrouted_item(r: dict[str, Any]) -> dict[str, Any]:
    """One surface with no valid route: what it is, why, and how to fix it."""
    rt = r["route"]
    if rt.get("tank"):
        how = f"Link the overflow route of tank {rt['tank']} to an OSD or an infiltration trench of the design (one overflow route per tank), or link the tank to a discharge point."
    else:
        how = f"Link {r['object_id']} to its destination (drains to: an OSD, an infiltration trench or a discharge point of the design), and place a discharge point if none exists."
    return {"id": r["id"], "object_id": r["object_id"], "surface": r["surface_label"], "area_m2": r["area_m2"], "split": r["split"], "reason": rt.get("reason") or rt.get("basis") or "NO ROUTE", "how": how}


def _unrouted_message(unrouted: list[dict[str, Any]], limit: int = 12) -> str:
    items = [_unrouted_item(r) for r in unrouted]
    shown = "; ".join(f"{i['id']} ({i['surface']}, {'AREA NOT KNOWN' if i['area_m2'] is None else format(i['area_m2'], '.1f') + ' M2'}): {i['reason']}" for i in items[:limit])
    more = f"; AND {len(items) - limit} MORE" if len(items) > limit else ""
    return f"NOT EVALUATED: {len(items)} SURFACE(S) HAVE NO VALID ROUTE, SO THE CATCHMENT OF THE OSD IS NOT KNOWN: {shown}{more}. EACH MUST BE LINKED TO A DESTINATION"


def _psd(rules: SiteRules, rd: Reader, inputs: StormwaterInputs, osds: list[SiteObject]) -> dict[str, Any]:
    key = "stormwater.psd_l_s"
    if inputs.psd_l_s is not None:
        return val(inputs.psd_l_s, "L/s", USER, USER_REF, key=key)
    own = [(o, rd.read(o, "psd_l_s")) for o in osds if o.params.get("psd_l_s") is not None]
    own = [(o, r) for o, r in own if r.ok and isinstance(r.value, (int, float)) and r.value > 0]
    if len(osds) == 1 and own:
        return val(float(own[0][1].value), "L/s", own[0][1].basis, own[0][1].ref or f"ENTERED ON {own[0][0].id}", own[0][1].stamp, key=key)
    return from_rule(rules, key, "L/s", "Load the requirement key stormwater.psd_l_s for the LGA, or enter the PSD in the panel.")


def _mass_balance(out, ifd: IfdResult, psd_v, aep_v, tc_v, ca_v, search_v, need, bad, unrouted, contrib) -> None:
    ok = True
    if psd_v["value"] is None:
        need("psd", "THE PERMISSIBLE SITE DISCHARGE IS UNRESOLVED", psd_v["how"], "stormwater.psd_l_s"); ok = False
    if aep_v["value"] is None:
        need("aep", "THE DESIGN AEP IS UNRESOLVED", aep_v["how"], "stormwater.design_aep_pct"); ok = False
    if tc_v["value"] is None:
        need("tc_post", "THE POST DEVELOPMENT TIME OF CONCENTRATION IS UNRESOLVED", tc_v["how"], "stormwater.tc_post_min"); ok = False
    if ca_v["value"] is None:
        need("ca", "THE SUM OF C x A DRAINING TO THE OSD IS NOT KNOWN: " + ca_v["ref"], ca_v["how"]); ok = False
    for r in unrouted:
        i = _unrouted_item(r)
        need(f"unrouted:{r['id']}", f"SURFACE {i['id']} ({i['surface']}) HAS NO VALID ROUTE: {i['reason']}", i["how"]); ok = False
    if ifd.table is None:
        need("ifd", "DESIGN RAINFALL IS NOT AVAILABLE: " + (ifd.message or ifd.status), "Upload the IFD table CSV exported from the BoM IFD page (Rainfall section of this panel).")
        ok = False
    elif aep_v["value"] is not None and ifd.table.aep_index(aep_v["value"]) is None:
        need("aep_column", f"THE RAINFALL TABLE HAS NO COLUMN FOR AEP {aep_v['value']:g} PERCENT (ITS COLUMNS ARE " + ", ".join(f"{a:g}" for a in ifd.table.aeps_pct) + ")", "Choose a design AEP that is a column of the table, or upload a table that has it.")
        ok = False
    if not ok:
        return
    t = ifd.table
    assert t is not None
    res = mass_balance(ca_v["value"], tc_v["value"], psd_v["value"], t, aep_v["value"], search_v["value"])
    if res["error"]:
        need("durations", res["error"], "Enter a longer search limit, or check the time of concentration.")
        return
    c = res["critical"]
    out["search"] = res
    out["critical"] = c
    out["required_storage_m3"] = c["storage_m3"]
    pi = lambda n, s, v: inp(n, s, v)  # noqa: E731
    out["steps"] = [
        step("inflow", "Peak inflow for each duration searched", "Qp = sum(C x A) x I / 3.6e6   (Qp m3/s, C x A m2, I mm/h)",
             [pi("Sum of C x A", "sum(C x A)", ca_v), pi("Design AEP", "AEP", aep_v), pi("Rainfall table", "IFD", val(t.provenance.get("file_name") or t.provenance.get("source"), "", "DATA SOURCE", _ifd_ref(t)))],
             {"value": c["qp_l_s"], "unit": "L/s", "text": f"Qp at the critical duration {c['duration_min']:g} min: {ca_v['value']:.4f} x {c['intensity_mm_h']:.3f} / 3.6e6 = {c['qp_l_s'] / 1000:.6f} m3/s"}),
        step("storage", "Storage for each duration (mass balance against the PSD)", "S = (Qp - PSD) x (td - Tc x PSD / Qp)   (S m3, times in seconds, 0 when Qp <= PSD)",
             [pi("Permissible site discharge", "PSD", psd_v), pi("Time of concentration", "Tc", tc_v), pi("Longest duration searched", "td max", search_v)],
             {"value": c["storage_m3"], "unit": "m3", "text": _storage_text(c, tc_v["value"], psd_v["value"])}, table=res["rows"]),
        step("critical", "Critical duration and required storage", "Required storage = largest S over the durations searched",
             [], {"value": c["storage_m3"], "unit": "m3", "text": f"Critical duration {c['duration_min']:g} min, required storage {c['storage_m3']:.3f} m3"}),
    ]
    if res["at_range_end"]:
        out["notes"].append("THE CRITICAL DURATION IS THE LONGEST DURATION SEARCHED. EXTEND THE SEARCH LIMIT TO CONFIRM THE PEAK STORAGE")
    if any(r["intensity_method"] == "INTERPOLATED" for r in res["rows"]):
        out["notes"].append(f"THE STORM DURATION EQUAL TO THE TIME OF CONCENTRATION ({tc_v['value']:g} MIN) IS NOT A ROW OF THE RAINFALL TABLE, SO ITS INTENSITY WAS INTERPOLATED "
                            "(LOG DURATION AND LOG INTENSITY) BETWEEN THE TWO NEAREST ROWS AND IS LABELLED INTERPOLATED")
    elif not res["tc_search"].startswith("TC IS A ROW"):
        out["notes"].append(res["tc_search"])


def _ifd_ref(t: IfdTable) -> str:
    p = t.provenance
    return f"{p.get('source')}; ISSUED {p.get('issued') or 'NOT STATED'}; LOCATION {p.get('location_label') or 'NOT STATED'}; SHA256 {str(p.get('sha256'))[:12]}"


def _storage_text(c: dict[str, Any], tc: float, psd_l_s: float) -> str:
    qp, psd = c["qp_l_s"] / 1000.0, psd_l_s / 1000.0
    if qp <= psd:
        return f"At {c['duration_min']:g} min Qp {qp:.6f} m3/s does not exceed the PSD {psd:.6f} m3/s, so S = 0"
    return (f"At {c['duration_min']:g} min: S = ({qp:.6f} - {psd:.6f}) x ({c['duration_min'] * 60:g} - {tc * 60:g} x {psd:.6f} / {qp:.6f}) = {c['storage_m3']:.3f} m3")


def _ssr(out, rules: SiteRules, inputs: StormwaterInputs, lot_area_m2: float | None, osd_area_m2: float | None, need, unrouted) -> None:
    abs_v = (val(inputs.ssr_m3, "m3", USER, USER_REF, key="stormwater.ssr_m3") if inputs.ssr_m3 is not None
             else from_rule(rules, "stormwater.ssr_m3", "m3", "Enter the site storage requirement in the panel, or load the requirement key stormwater.ssr_m3."))
    per_v = (val(inputs.ssr_m3_per_ha, "m3/ha", USER, USER_REF, key="stormwater.ssr_m3_per_ha") if inputs.ssr_m3_per_ha is not None
             else from_rule(rules, "stormwater.ssr_m3_per_ha", "m3/ha", "Enter the storage per hectare in the panel, or load the requirement key stormwater.ssr_m3_per_ha."))
    out["inputs"] += [inp("Site storage requirement", "SSR", abs_v), inp("Site storage requirement per hectare", "SSR/ha", per_v)]
    if abs_v["value"] is not None:
        r = float(abs_v["value"])
        out["required_storage_m3"] = round(r, 4)
        out["steps"] = [step("ssr", "Site storage requirement", "Required storage = SSR (as entered or as the rule states)", [inp("Site storage requirement", "SSR", abs_v)],
                             {"value": r, "unit": "m3", "text": f"Required storage = {r:g} m3"})]
        return
    if per_v["value"] is None:
        need("ssr", "THE SITE STORAGE REQUIREMENT IS UNRESOLVED", "Enter the SSR (m3) or the SSR per hectare in the panel, or load stormwater.ssr_m3 or stormwater.ssr_m3_per_ha.", "stormwater.ssr_m3")
        return
    basis = inputs.ssr_area_basis
    if basis is None:
        need("ssr_area_basis", "THE AREA THE PER HECTARE STORAGE APPLIES TO IS NOT STATED", "In the panel choose whether it applies to the lot area or to the area draining to the OSD.")
        return
    if basis != "lot" and unrouted:
        for r in unrouted:
            i = _unrouted_item(r)
            need(f"unrouted:{r['id']}", f"SURFACE {i['id']} ({i['surface']}) HAS NO VALID ROUTE: {i['reason']}", i["how"])
        return
    area = lot_area_m2 if basis == "lot" else osd_area_m2
    if area is None or area <= 0:
        need("ssr_area", "THE AREA FOR THE PER HECTARE STORAGE IS NOT KNOWN" + (" (NO LOT BOUNDARY)" if basis == "lot" else " (THE CATCHMENT IS INCOMPLETE)"), "Provide the lot boundary, or complete the catchment table.")
        return
    r = per_v["value"] * area / 10000.0
    out["required_storage_m3"] = round(r, 4)
    ab = val(round(area, 3), "m2", "MODEL", "LOT AREA FROM THE LOT BOUNDARY" if basis == "lot" else "AREA DRAINING TO THE OSD (CATCHMENT TABLE)")
    out["steps"] = [step("ssr_ha", "Site storage requirement from the per hectare value", "Required storage = (SSR per ha) x area / 10000",
                         [inp("Site storage requirement per hectare", "SSR/ha", per_v), inp("Area", "A", ab)],
                         {"value": round(r, 4), "unit": "m3", "text": f"Required storage = {per_v['value']:g} x {area:.1f} / 10000 = {r:.3f} m3"})]


def _provided(rules: SiteRules, rd: Reader, inputs: StormwaterInputs, osds: list[SiteObject], rwts: list[SiteObject], post_rows: list[dict[str, Any]]) -> dict[str, Any]:
    vols, unset = [], []
    for o in osds:
        r = rd.read(o, "storage_volume_m3")
        if r.ok and isinstance(r.value, (int, float)) and r.value > 0:
            vols.append({"object_id": o.id, "m3": float(r.value), "basis": r.basis})
        else:
            unset.append(o.id)
    if inputs.rainwater_tank_excluded is not None:
        ex = val(inputs.rainwater_tank_excluded, "", USER, USER_REF, key="stormwater.rainwater_tank_excluded_from_detention_volume")
    else:
        rr = rules.get("stormwater.rainwater_tank_excluded_from_detention_volume")
        ex = val(rr.value, "", rr.basis, rr.ref, rr.stamp, key=rr.key) if rr.resolved and isinstance(rr.value, bool) else unresolved(
            rr.ref, "Enter in the panel whether the tank detention is excluded, or load the requirement key stormwater.rainwater_tank_excluded_from_detention_volume.", rr.key)
    # a tank's detention serves the OSD only when the overflow of the tank reaches an OSD of the design (its route path contains one)
    osd_ids = {o.id for o in osds}
    reaches = {r["route"]["tank"] for r in post_rows if r["route"].get("tank") and osd_ids & set(r["route"].get("path") or [])}
    tanks, tanks_apart = [], []
    for t in rwts:
        r = rd.read(t, "detention_volume_l")
        if r.ok and isinstance(r.value, (int, float)) and r.value > 0:
            item = {"object_id": t.id, "m3": float(r.value) / 1000.0, "basis": r.basis, "reaches_osd": t.id in reaches}
            (tanks if t.id in reaches else tanks_apart).append(item)
    osd_total = round(sum(v["m3"] for v in vols), 4)
    tank_total = round(sum(v["m3"] for v in tanks), 4)
    counted = ex["value"] is False
    if counted:
        rule_note = "TANK DETENTION IS COUNTED (THE EXCLUSION RULE RESOLVES TO FALSE)"
    elif ex["value"] is True:
        rule_note = "TANK DETENTION IS EXCLUDED (THE RULE RESOLVES TO TRUE)"
    else:
        rule_note = "TANK DETENTION IS NOT COUNTED BECAUSE stormwater.rainwater_tank_excluded_from_detention_volume IS UNRESOLVED" if tank_total > 0 else ""
    apart_note = ("TANK DETENTION OF " + ", ".join(t["object_id"] for t in tanks_apart) + " IS NOT COUNTED: THE OVERFLOW OF THE TANK DOES NOT REACH AN OSD OF THE DESIGN") if tanks_apart else ""
    return {"osd": vols, "osd_total_m3": osd_total, "osd_unset": unset, "tanks": tanks, "tanks_not_reaching_osd": tanks_apart, "tank_detention_m3": tank_total, "tank_exclusion": ex, "tank_counted": counted,
            "total_m3": round(osd_total + (tank_total if counted else 0.0), 4),
            "tank_note": "; ".join(x for x in (rule_note, apart_note) if x)}


def _compare(required: float, prov: dict[str, Any], osds: list[SiteObject], need) -> dict[str, Any]:
    if prov["osd_unset"]:
        need("osd_volume", "THE STORAGE VOLUME OF " + ", ".join(prov["osd_unset"]) + " IS NOT SET", "Enter the storage volume on the OSD object.")
    if not osds and prov["total_m3"] <= 0:
        return {"status": "NO STORAGE PLACED", "required_m3": required, "provided_m3": 0.0, "difference_m3": round(-required, 4), "message": "NO OSD IS PLACED, SO NO STORAGE IS PROVIDED"}
    if prov["osd_unset"]:
        return {"status": "NOT EVALUATED", "required_m3": required, "provided_m3": prov["total_m3"], "difference_m3": None, "message": "THE STORAGE VOLUME OF AN OSD IS NOT SET"}
    diff = round(prov["total_m3"] - required, 4)
    ok = diff >= -1e-9
    return {"status": "PROVIDED STORAGE IS ENOUGH" if ok else "PROVIDED STORAGE IS SHORT", "required_m3": required, "provided_m3": prov["total_m3"], "difference_m3": diff,
            "message": f"PROVIDED {prov['total_m3']:.3f} M3 AGAINST REQUIRED {required:.3f} M3 ({'+' if diff >= 0 else '-'}{abs(diff):.3f} M3)"}


def _orifice(rules: SiteRules, rd: Reader, inputs: StormwaterInputs, osds: list[SiteObject], psd_v: dict[str, Any]) -> dict[str, Any]:
    """Orifice diameter from the PSD and head, ONLY with a resolved discharge coefficient (the user's entry, the OSD's own, or the requirement key)."""
    key = "stormwater.orifice_discharge_coefficient"
    cd_v: dict[str, Any]
    if inputs.discharge_coefficient is not None:
        cd_v = val(inputs.discharge_coefficient, "", USER, USER_REF, key=key)
    else:
        own = None
        if len(osds) == 1:
            r = rd.read(osds[0], "discharge_coefficient")
            if r.ok and isinstance(r.value, (int, float)) and 0 < r.value <= 1:
                own = val(float(r.value), "", r.basis, r.ref, r.stamp, key=key)
        cd_v = own or from_rule(rules, key, "", "Enter the discharge coefficient Cd in the panel (or on the OSD), or load the requirement key stormwater.orifice_discharge_coefficient.")
        if cd_v["value"] is not None and not 0 < cd_v["value"] <= 1:
            cd_v = unresolved("THE COEFFICIENT IS NOT BETWEEN 0 AND 1", "Correct the coefficient.", key)
    head_c: float | None = None
    head_i: float | None = None
    head_v: dict[str, Any]
    # the head from the levels on the OSD (top water level less orifice invert) is computed when both are entered; an entered head ALWAYS wins and the computed one is shown for reference
    model_head: dict[str, Any] | None = None
    if len(osds) == 1 and rd.num(osds[0], "top_water_level_rl") is not None and rd.num(osds[0], "orifice_invert_rl") is not None:
        twl, inv = rd.num(osds[0], "top_water_level_rl"), rd.num(osds[0], "orifice_invert_rl")
        model_head = val(round(twl - inv, 4), "m", "MODEL", f"TOP WATER LEVEL {twl:.3f} RL LESS ORIFICE INVERT {inv:.3f} RL, ENTERED ON {osds[0].id} (HEAD TO THE INVERT)")
    ref_view: dict[str, Any] | None = None
    if inputs.orifice_head_m is not None:
        head_c = inputs.orifice_head_m
        head_v = val(head_c, "m", USER, USER_REF + " (HEAD TO THE ORIFICE CENTRE)")
        if model_head is not None:
            ref_view = inp("Head from the levels on the OSD (reference, not used)", "h ref", {**model_head, "ref": model_head["ref"] + ". NOT USED: THE HEAD ENTERED IN THE PANEL TAKES PRECEDENCE"})
    elif model_head is not None:
        head_i = model_head["value"]
        head_v = model_head
    else:
        head_v = unresolved("NO HEAD: THE OSD HAS NO TOP WATER LEVEL AND ORIFICE INVERT, AND NO HEAD IS ENTERED", "Enter the top water level and orifice invert on the OSD, or enter the head to the orifice centre in the panel.", None, "m")
    base = {"inputs": [inp("Permissible site discharge", "Q", psd_v), inp("Discharge coefficient", "Cd", cd_v), inp("Head", "h", head_v)] + ([ref_view] if ref_view else []), "formula": "Q = Cd x A x SQRT(2 x g x h), A = pi x d^2 / 4, so d = SQRT(4 x Q / (pi x Cd x SQRT(2 x g x h)))"}
    miss = []
    if cd_v["value"] is None:
        miss.append({"id": "cd", "area": "ORIFICE", "what": "THE DISCHARGE COEFFICIENT IS UNRESOLVED, SO NO ORIFICE SIZE IS GIVEN", "key": key, "how": cd_v["how"]})
    if head_v["value"] is None:
        miss.append({"id": "head", "area": "ORIFICE", "what": head_v["ref"], "key": None, "how": head_v["how"]})
    if psd_v["value"] is None:
        miss.append({"id": "psd_orifice", "area": "ORIFICE", "what": "THE PSD IS UNRESOLVED", "key": "stormwater.psd_l_s", "how": psd_v["how"]})
    if miss:
        return {**base, "status": "NOT EVALUATED", "diameter_mm": None, "missing": miss}
    got = orifice_diameter_mm(psd_v["value"], cd_v["value"], head_i, head_c)
    if got is None:
        return {**base, "status": "NOT EVALUATED", "diameter_mm": None, "missing": [{"id": "head", "area": "ORIFICE", "what": "THE HEAD IS NOT ABOVE THE ORIFICE", "key": None, "how": "Check the top water level and the orifice invert."}]}
    d, h = got
    text = f"d = SQRT(4 x {psd_v['value'] / 1000:.6f} / (pi x {cd_v['value']:g} x SQRT(2 x {G_MS2} x {h:.4f}))) = {d / 1000:.5f} m = {d:.1f} mm" + (" (head to the orifice centre, found by iteration)" if head_i is not None else "")
    return {**base, "status": "EVALUATED", "diameter_mm": round(d, 2), "head_used_m": round(h, 4), "text": text, "missing": []}
