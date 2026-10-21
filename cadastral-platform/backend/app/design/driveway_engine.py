"""Driveway long section, batters, cut and fill and requirement checks for a ``driveway`` site design object.

REUSE. The profile is the one the plan set draws on C400 and C410 (``sa5 planset.sheets_ref2.ref_profile``): existing ground is sampled every
0.5 m along the centreline and interpolated, the stations are the kerb line (chainage 0), the back of the kerb and gutter band
(``planset.crossover.gutter_band_m``), the property boundary and the driveway end, and the design line is a straight interpolation between the
stations (the verge is not designed: kerb line to boundary the design line IS the existing ground). The checks are the SA3 routine
``sa3_driveway.profile.check_profile`` (grade, change of grade, B85 scraping) run with a ``CouncilDrivewayStandard`` built ONLY from
``SiteRules`` (unit aware; a key the resolver cannot give stays None). The earthworks are ``grading_engine.earthworks`` (SA3 ``cut_fill``). Nothing is
re-implemented here, and ``driveway_export`` hands the same object to the plan set, so the two agree (tested).

CHAINAGE. Long section chainage is the plan distance along the driveway centreline from its first point, which is the crossover on the ASSUMED
kerb line (chainage 0 = kerb line). The crossover POSITION is a chainage along the assumed kerb line (``crossover_chainage_m``, from the first
point of the kerb line in the 3D model).

END LEVEL. When the end is linked to a building (``end_building_id``) the end level is that building's FFL, resolved HERE from the saved site design (or the
building sent with the request, validated against it), see ``driveway_link``. The object's own ``end_level_rl`` is never read while a link exists.

GUTTER BAND. The band station needs the verge (kerb line to property boundary). When the verge is not known the band station is UNRESOLVED: it is left
out of the long section, its change of grade check is listed NOT EVALUATED and no platform default verge is substituted.

LIMITS. A request larger than ``engine_limits`` accepts is refused (``EngineLimitError``, 422 at the API) before any sampling.

REQUIREMENTS. Every limit comes from ``site_rules`` (LGA rule, state rule, platform default where one exists, otherwise UNRESOLVED). A check
without a limit is NOT EVALUATED and names the key. The B85 scraping check is a vehicle template screening (SA3), not a council requirement,
and says so. The driveway design level is not designed beyond the stations: there is no vertical curve, crossfall or verge design.
"""
from __future__ import annotations

import math
import time
from typing import Any

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon

from app.agents.sa3_driveway import profile as pf
from app.agents.sa3_driveway.models import CheckItem, CouncilDrivewayStandard

from . import engine_limits as EL
from . import grading_engine as ge
from .driveway_link import LinkedEnd, resolve_end_building, with_end_level
from .site_design import SiteDesign, SiteObject
from .site_rules import (KEY_MAX_CHANGE, KEY_MAX_GRADE, KEY_MAX_WIDTH, KEY_MIN_SEPARATION, KEY_MIN_WIDTH, KEY_SPLAY, UNRESOLVED, Rule, SiteRules)
from .terrain_source import NO_TERRAIN, SiteTerrain

#: sample spacing of the existing ground along the centreline, as the plan set (``ref_profile``)
SAMPLE_STEP_M = 0.5
#: a station closer than this to the one before it is dropped, as the plan set
STATION_MERGE_M = 0.05
KERB_NOT_AVAILABLE = "ASSUMED KERB LINE NOT AVAILABLE IN THE 3D MODEL"
NOT_EVALUATED, PASS, FAIL = "NOT EVALUATED", "PASS", "FAIL"
ST_KERB, ST_BAND, ST_BOUNDARY, ST_END = "KERB LINE", "GUTTER BAND", "PROPERTY BOUNDARY", "DRIVEWAY END"
SCREENING = "PLATFORM SCREENING TEMPLATE (B85), NOT A COUNCIL REQUIREMENT"


def _val(obj: SiteObject, key: str) -> float | None:
    p = obj.params.get(key)
    return None if p is None or p.basis == "unresolved" or isinstance(p.value, bool) or not isinstance(p.value, (int, float)) else float(p.value)


def _gutter_band_m(verge: float) -> float:
    """The plan set's own band width for a KNOWN verge, so the long section and the plan agree. An unknown verge has no band (the caller marks the station UNRESOLVED)."""
    from app.agents.sa5_cad_dxf.planset import crossover as CX
    return CX.gutter_band_m(verge)


def kerb_geometry(terrain: SiteTerrain) -> dict[str, Any] | None:
    """The assumed kerb line as a direction, a length and (when the lot is known) the inward normal, all in MGA."""
    if terrain.kerb is None:
        return None
    a, b = np.array(terrain.kerb[0]), np.array(terrain.kerb[1])
    L = float(np.hypot(*(b - a)))
    if L < 1e-6:
        return None
    u = (b - a) / L
    n = np.array([-u[1], u[0]])
    if terrain.lot is not None:
        c = terrain.lot.representative_point()
        if np.dot(np.array([c.x, c.y]) - a, n) < 0:
            n = -n
    return {"a": a, "b": b, "u": u, "n": n, "length": L, "has_normal": terrain.lot is not None}


def chainage_on_kerb(kerb: dict[str, Any], x: float, y: float) -> tuple[float, float]:
    """(chainage along the kerb line from its first point, signed offset towards the lot) of an MGA point."""
    d = np.array([x, y]) - kerb["a"]
    return float(np.dot(d, kerb["u"])), float(np.dot(d, kerb["n"]))


def point_on_kerb(kerb: dict[str, Any], chainage: float) -> tuple[float, float]:
    p = kerb["a"] + kerb["u"] * chainage
    return float(p[0]), float(p[1])


def _rule_summary(r: Rule) -> dict[str, Any]:
    return {"requirement_key": r.key, "basis": r.basis, "ref": r.ref}


def _check(id_: str, title: str, key: str | None, status: str, value: float | None, limit: float | None, unit: str, basis: str, ref: str, note: str = "",
           from_m: float | None = None, to_m: float | None = None) -> dict[str, Any]:
    return {"id": id_, "title": title, "requirement_key": key, "status": status, "value": value, "limit": limit, "unit": unit, "basis": basis, "ref": ref,
            "note": note, "chainage_from_m": from_m, "chainage_to_m": to_m}


def _standard(rules: SiteRules) -> CouncilDrivewayStandard:
    """The SA3 driveway standard, built ONLY from ``SiteRules`` (the one place requirements are resolved and converted to the engine unit). A key the
    rules cannot give stays None (never the SA3 model default of 25 percent, never a raw value in another unit)."""
    def v(key: str) -> float | None:
        r = rules.get(key)
        return r.value if r.resolved else None
    return CouncilDrivewayStandard(
        council_name=rules.lga or "unresolved", source_label="Resolved requirements (cited)", max_grade_pct=v(KEY_MAX_GRADE), max_change_of_grade_pct=v(KEY_MAX_CHANGE),
        min_crossover_width_m=v(KEY_MIN_WIDTH), max_crossover_width_m=v(KEY_MAX_WIDTH), min_separation_m=v(KEY_MIN_SEPARATION), kerb_return_splay_m=v(KEY_SPLAY))


def _sample_ts(L: float) -> list[float]:
    """Chainages of the existing ground samples along a centreline of length ``L``. The length is capped here as well as at the API, so no caller can ask
    for an unbounded number of samples."""
    if not L <= EL.MAX_CENTRELINE_M:
        raise EL.EngineLimitError(EL.TOO_LARGE, f"THE DRIVEWAY CENTRELINE IS {L:,.0f} M LONG; AT MOST {EL.MAX_CENTRELINE_M:g} M IS ACCEPTED")
    return [i * SAMPLE_STEP_M for i in range(int(L / SAMPLE_STEP_M) + 1)] + [L]


def driveway_profile(obj: SiteObject, terrain: SiteTerrain, rules: SiteRules, *, detail: str = "full", saved_design: SiteDesign | None = None,
                     building: SiteObject | None = None) -> dict[str, Any]:
    """The long section, checks, batters and cut and fill of a driveway object. ``detail`` 'profile' stops after the checks (fast, for dragging);
    'full' adds the earthworks. ``saved_design`` is the SAVED site design and ``building`` an optional building object sent with the request: they resolve
    ``end_building_id`` (see ``driveway_link``); with a link and neither, the end level is NOT SET. Raises ``EngineLimitError`` for an oversized request."""
    t0 = time.perf_counter()
    if obj.type != "driveway" or obj.geometry.kind != "polyline":
        raise ValueError("a driveway object with a polyline is needed")
    EL.check_driveway(obj)
    EL.check_within_terrain(obj.geometry, terrain, "THE DRIVEWAY")
    link = resolve_end_building(obj, saved_design, building)
    obj = with_end_level(obj, link)
    pts = [(float(p[0]), float(p[1])) for p in obj.geometry.pts]
    cl = LineString(pts)
    L = float(cl.length)
    notes: list[str] = ["CHAINAGE IS THE PLAN DISTANCE ALONG THE DRIVEWAY CENTRELINE FROM THE ASSUMED KERB LINE (CHAINAGE 0 IS THE KERB LINE)"]
    out: dict[str, Any] = {
        "schema": "driveway_profile.v1", "object_id": obj.id, "detail": detail,
        "terrain": {"status": terrain.status, "source": terrain.source, "provenance": terrain.provenance},
        "rules": rules.all_public(), "rules_for": rules.label(), "length_m": round(L, 3), "notes": notes,
    }
    # ---- crossover on the assumed kerb line
    kerb = kerb_geometry(terrain)
    cross: dict[str, Any] = {"available": kerb is not None, "chainage_m": None, "offset_from_kerb_m": None, "kerb_length_m": None, "frontage_offset_note": KERB_NOT_AVAILABLE}
    if kerb is not None:
        ch, off = chainage_on_kerb(kerb, *pts[0])
        cross.update(chainage_m=round(ch, 3), offset_from_kerb_m=round(abs(off), 3), kerb_length_m=round(kerb["length"], 3), frontage_offset_note="")
        if abs(off) > 0.05:
            notes.append(f"THE DRIVEWAY START IS {abs(off):.2f} M OFF THE ASSUMED KERB LINE")
        if not (-0.05 <= ch <= kerb["length"] + 0.05):
            notes.append("THE DRIVEWAY START IS BEYOND THE ENDS OF THE ASSUMED KERB LINE")
    else:
        notes.append(KERB_NOT_AVAILABLE)
    out["crossover"] = cross
    # ---- width
    wv, wp = _val(obj, "width_m"), obj.params.get("width_m")
    out["width"] = {"value": wv, "basis": wp.basis.upper() if wp is not None and wv is not None else UNRESOLVED, "ref": wp.ref if wp is not None else None}
    # ---- end level
    ev, ep = _val(obj, "end_level_rl"), obj.params.get("end_level_rl")
    bid = obj.params.get("end_building_id")
    out["end_level"] = {"value": ev, "basis": ep.basis.upper() if ep is not None and ev is not None else "NOT SET", "ref": ep.ref if ep is not None else None,
                        "building_id": bid.value if bid is not None and isinstance(bid.value, str) else None, "link_note": link.note}
    if link.note:
        notes.append(link.note)
    # ---- existing ground along the centreline
    ts = _sample_ts(L)
    pp = shapely.line_interpolate_point(cl, np.array(ts))
    xy = shapely.get_coordinates(pp)
    zx = terrain.surface.z_at(xy[:, 0], xy[:, 1])
    ok = np.isfinite(zx)
    checks: list[dict[str, Any]] = []
    out["checks"], out["failing"] = checks, []
    if ok.sum() < 3:
        out.update(status=f"{NO_TERRAIN}: FEWER THAN THREE EXISTING GROUND LEVELS ALONG THE DRIVEWAY", stations=[], samples=_samples(ts, zx, None, None, None),
                   segments=[], earthworks=None, timing_ms=_ms(t0))
        checks.append(_check("profile", "LONG SECTION", None, NOT_EVALUATED, None, None, "", UNRESOLVED, "", f"{NO_TERRAIN} ALONG THE DRIVEWAY"))
        _add_static_checks(obj, rules, out, checks, wv)
        return out
    tt, zz = np.array(ts)[ok], zx[ok]

    def exz(t):
        return float(np.interp(t, tt, zz))

    # ---- boundary station and verge
    sb, bpoint, verge = None, None, None
    if terrain.lot is not None:
        h = cl.intersection(terrain.lot.exterior)
        c = shapely.get_coordinates(h)
        if len(c):
            ds = [cl.project(Point(*q)) for q in c]
            sb = float(min(ds))
            bp = cl.interpolate(sb)
            bpoint = (float(bp.x), float(bp.y))
    else:
        notes.append("LOT BOUNDARY NOT AVAILABLE IN THE 3D MODEL: THE BOUNDARY STATION IS AT THE KERB LINE")
    if sb is None and terrain.lot is not None:
        notes.append("THE DRIVEWAY CENTRELINE DOES NOT CROSS THE LOT BOUNDARY: THE BOUNDARY STATION IS AT THE KERB LINE")
    if bpoint is not None and kerb is not None:
        verge = abs(chainage_on_kerb(kerb, *bpoint)[1])
    elif sb is not None:
        verge = sb
    gw = None if verge is None else _gutter_band_m(verge)
    out["unresolved_stations"] = []
    if gw is None:
        why = "THE VERGE (KERB LINE TO PROPERTY BOUNDARY) IS NOT KNOWN IN THE 3D MODEL, SO THE GUTTER BAND STATION IS UNRESOLVED AND LEFT OUT OF THE LONG SECTION"
        out["unresolved_stations"].append({"name": ST_BAND, "status": UNRESOLVED, "reason": why})
        notes.append("GUTTER BAND UNRESOLVED: " + why)
    out["frame"] = None if kerb is None or not kerb["has_normal"] else {"front_dir": [float(kerb["u"][0]), float(kerb["u"][1])], "inward_normal": [float(kerb["n"][0]), float(kerb["n"][1])]}
    out["geometry"] = {"boundary_chainage_m": None if sb is None else round(sb, 3), "boundary_point": bpoint, "verge_m": None if verge is None else round(verge, 3),
                       "verge_basis": "KERB TO BOUNDARY DISTANCE FROM THE ASSUMED KERB LINE (PLATFORM DEFAULT, NOT SURVEYED)",
                       "gutter_band_m": None if gw is None else round(gw, 3), "gutter_band_status": UNRESOLVED if gw is None else "RESOLVED", "start": pts[0], "end": pts[-1]}
    sbv = sb if sb is not None else 0.0
    # ---- stations: as the plan set ref_profile (kerb, gutter band, boundary, and the end when an end level is set)
    proposed = ev is not None
    st = [(0.0, exz(0.0), ST_KERB)]
    if gw is not None:
        st.append((gw, exz(gw), ST_BAND))
    st.append((sbv, exz(sbv), ST_BOUNDARY))
    if proposed:
        st.append((L, float(ev), ST_END))
    stations: list[tuple[float, float, str]] = []
    for t, z, nm in sorted(st):
        if stations and t - stations[-1][0] < STATION_MERGE_M:
            prev = stations[-1]
            if nm == ST_END and prev[2] != ST_KERB:
                stations[-1] = (t, z, nm)                      # the end level is never lost: the earlier station is the one dropped
                notes.append(f"THE {prev[2]} STATION IS WITHIN {STATION_MERGE_M:g} M OF THE DRIVEWAY END AND IS MERGED INTO IT; THE END LEVEL IS KEPT")
            elif nm == ST_END:
                notes.append(f"THE DRIVEWAY END IS WITHIN {STATION_MERGE_M:g} M OF THE KERB LINE: THE END LEVEL CANNOT BE USED AND NO DESIGN LINE IS COMPUTED")
            continue
        stations.append((t, z, nm))
    has_end = any(s_[2] == ST_END for s_ in stations)
    design = None
    if proposed and has_end and (len(stations) >= 3 or (gw is None and len(stations) >= 2)):
        s_t, s_z = [s_[0] for s_ in stations], [s_[1] for s_ in stations]
        design = lambda t: np.interp(t, s_t, s_z)               # noqa: E731
    elif proposed:
        notes.append("FEWER THAN THREE PROFILE STATIONS (THE DRIVEWAY IS TOO SHORT): NO DESIGN LINE" if has_end else "NO DESIGN LINE: THE DRIVEWAY END STATION IS NOT IN THE LONG SECTION")
    if not proposed:
        notes.append("END LEVEL NOT SET: THE DESIGN LINE, THE CHECKS AND THE EARTHWORKS ARE NOT COMPUTED. Set the end level or snap the end to a building")
    # ---- checks (SA3 check_profile with the resolved standard)
    std = _standard(rules)
    resolved_any = any(rules.get(k).resolved for k in (KEY_MAX_GRADE, KEY_MAX_CHANGE, KEY_MIN_WIDTH, KEY_MAX_WIDTH, KEY_MIN_SEPARATION))
    out["standard_label"] = std.source_label if resolved_any else None
    items: list[CheckItem] = pf.check_profile(stations, std, strict=True, max_span_m=EL.MAX_PROFILE_SPAN_M) if design is not None else []
    grades = _grades(stations)
    out["stations"] = _stations(stations, grades, design is not None, std, exz)
    out["segments"] = _segments(stations, grades, design is not None, std)
    out["samples"] = _samples(ts, zx, design, stations, grades)
    r_g, r_c = rules.get(KEY_MAX_GRADE), rules.get(KEY_MAX_CHANGE)
    if design is None:
        checks.append(_check("profile", "LONG SECTION CHECKS", None, NOT_EVALUATED, None, None, "", UNRESOLVED, "", "END LEVEL NOT SET" if not proposed else "NO DESIGN LINE"))
    for it in items:
        checks.append(_from_item(it, stations, r_g, r_c))
    if design is not None and gw is None:
        checks.append(_check(f"change_of_grade@{ST_BAND}", f"CHANGE OF GRADE AT {ST_BAND}", KEY_MAX_CHANGE, NOT_EVALUATED, None, None, "%", UNRESOLVED, r_c.ref,
                             "GUTTER BAND STATION UNRESOLVED: THE VERGE IS NOT KNOWN IN THE 3D MODEL"))
    _add_static_checks(obj, rules, out, checks, wv)
    # ---- failing chainages, for the red drawing and the hover text
    for c in checks:
        if c["status"] == FAIL and c["chainage_from_m"] is not None:
            out["failing"].append({k: c[k] for k in ("id", "title", "requirement_key", "value", "limit", "unit", "basis", "ref", "chainage_from_m", "chainage_to_m")} |
                                  {"message": f"{c['requirement_key']} {_g(c['limit'])} {c['unit']} ({c['basis']}): {_g(c['value'])} {c['unit']}"})
    out["status"] = "OK" if design is not None else "END LEVEL NOT SET"
    # ---- earthworks
    out["earthworks"] = None
    if detail == "full" and design is not None:
        out["earthworks"] = _earthworks(obj, terrain, rules, cl, design, wv, ts, zx, out, kerb, link)
    out["timing_ms"] = _ms(t0)
    return out


def _g(v: float | None) -> str:
    """A number for a message; never raises (a missing value reads NOT SET)."""
    return "NOT SET" if v is None else f"{v:g}"


def _ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)


def _grades(stations: list[tuple[float, float, str]]) -> list[float]:
    return [100.0 * (b[1] - a[1]) / (b[0] - a[0]) for a, b in zip(stations, stations[1:])]


def _stations(stations, grades, designed: bool, std: CouncilDrivewayStandard, exz) -> list[dict[str, Any]]:
    out = []
    for i, (t, z, nm) in enumerate(stations):
        gin = grades[i - 1] if i > 0 else None
        gout = grades[i] if i < len(grades) else None
        ch = None if gin is None or gout is None else gout - gin
        kind = None if ch is None or abs(ch) <= 0.05 else ("SUMMIT" if ch < 0 else "SAG")
        if not designed or ch is None:
            tr = ""
        elif std.max_change_of_grade_pct is None:
            tr = "UNRESOLVED" if abs(ch) > 0.05 else ""
        else:
            tr = "TRANSITION REQUIRED" if abs(ch) > std.max_change_of_grade_pct + 1e-9 else ""
        out.append({"name": nm, "chainage_m": round(t, 3), "existing_rl": round(exz(t), 3), "design_rl": round(z, 3) if designed else None,
                    "grade_in_pct": None if gin is None else round(gin, 2), "grade_out_pct": None if gout is None else round(gout, 2),
                    "change_pct": None if ch is None else round(abs(ch), 2), "kind": kind, "transition": tr})
    return out


def _segments(stations, grades, designed: bool, std: CouncilDrivewayStandard) -> list[dict[str, Any]]:
    out = []
    for (a, b), g in zip(zip(stations, stations[1:]), grades):
        fail = designed and std.max_grade_pct is not None and abs(g) > std.max_grade_pct + 1e-9
        out.append({"from_m": round(a[0], 3), "to_m": round(b[0], 3), "grade_pct": round(g, 2) if designed else None, "failing": bool(fail)})
    return out


def _samples(ts, zx, design, stations, grades) -> dict[str, Any]:
    ex = [None if not np.isfinite(z) else round(float(z), 3) for z in zx]
    if design is None or not stations:
        return {"chainage": [round(t, 3) for t in ts], "existing": ex, "design": None, "grade_pct": None, "transition": None}
    ta = np.array(ts)
    dz = design(ta)
    st_t = np.array([s[0] for s in stations])
    seg = np.clip(np.searchsorted(st_t, ta, side="right") - 1, 0, len(grades) - 1)
    return {"chainage": [round(t, 3) for t in ts], "existing": ex, "design": [round(float(z), 3) for z in dz],
            "grade_pct": [round(grades[i], 2) for i in seg], "transition": _transition_flags(ta, stations, grades)}


def _transition_flags(ta: np.ndarray, stations, grades) -> list[str]:
    """A flag on the sample nearest to each interior station where the grade changes: SUMMIT or SAG. Whether the change needs a transition (it
    exceeds the resolved limit) is on the station record and in the change of grade check; no transition length is invented here."""
    flags = [""] * len(ta)
    for i in range(1, len(stations) - 1):
        ch = grades[i] - grades[i - 1]
        if abs(ch) > 0.05:
            flags[int(np.argmin(np.abs(ta - stations[i][0])))] = "SUMMIT" if ch < 0 else "SAG"
    return flags


def _from_item(it: CheckItem, stations, r_g: Rule, r_c: Rule) -> dict[str, Any]:
    """One check record from an SA3 check item. A FAIL always carries the limit it failed (a FAIL with no limit is a NOT EVALUATED that says so)."""
    c = _from_item_raw(it, stations, r_g, r_c)
    if c["status"] == FAIL and (c["limit"] is None or c["value"] is None):
        c.update(status=NOT_EVALUATED, chainage_from_m=None, chainage_to_m=None, note=f"NO LIMIT TO COMPARE WITH ({c['requirement_key'] or c['id']} IS UNRESOLVED)")
    return c


def _from_item_raw(it: CheckItem, stations, r_g: Rule, r_c: Rule) -> dict[str, Any]:
    status = NOT_EVALUATED if it.passed is None else PASS if it.passed else FAIL
    if it.name == "max_grade":
        gs = _grades(stations)
        lim = it.limit
        worst = [(abs(g), a, b) for g, (a, b) in zip(gs, zip(stations, stations[1:])) if lim is not None and abs(g) > lim + 1e-9]
        a0 = min((w[1][0] for w in worst), default=None)
        b0 = max((w[2][0] for w in worst), default=None)
        return _check("max_grade", "STEEPEST GRADE", KEY_MAX_GRADE, status, it.value, it.limit, "%", r_g.basis, r_g.ref,
                      it.note if status == NOT_EVALUATED else "", None if status != FAIL else a0, None if status != FAIL else b0)
    if it.name.startswith("change_of_grade@"):
        nm = it.name.split("@", 1)[1]
        t = next((s[0] for s in stations if s[2] == nm), None)
        return _check(f"change_of_grade@{nm}", f"CHANGE OF GRADE AT {nm}", KEY_MAX_CHANGE, status, it.value, it.limit if r_c.resolved else None, "%", r_c.basis, r_c.ref,
                      it.note if status == NOT_EVALUATED else "", t if status == FAIL else None, t if status == FAIL else None)
    if it.name == "b85_scraping_clearance":
        return _check("b85_scraping_clearance", "B85 UNDERBODY CLEARANCE, FORWARD AND REVERSE", None, status, it.value, it.limit, it.unit, SCREENING,
                      "SA3 TEMPLATE; NEGATIVE MEANS THE UNDERBODY WOULD SCRAPE. NOT A COUNCIL CHECK AND NOT CERTIFICATION")
    return _check(it.name, it.name.replace("_", " ").upper(), None, status, it.value, it.limit, it.unit, SCREENING, it.note)


def _add_static_checks(obj: SiteObject, rules: SiteRules, out: dict[str, Any], checks: list[dict[str, Any]], width: float | None) -> None:
    """Width against the minimum and maximum width requirements; the crossover separation (needs lot road adjacency: not in the 3D model)."""
    for key, kind in ((KEY_MIN_WIDTH, "min"), (KEY_MAX_WIDTH, "max")):
        r = rules.get(key)
        cid, title = f"width_{kind}", f"DRIVEWAY WIDTH, {'MINIMUM' if kind == 'min' else 'MAXIMUM'}"
        if width is None:
            checks.append(_check(cid, title, key, NOT_EVALUATED, None, r.value, "m", r.basis, r.ref, "WIDTH NOT SET"))
        elif not r.resolved:
            checks.append(_check(cid, title, key, NOT_EVALUATED, width, None, "m", UNRESOLVED, r.ref, "REQUIREMENT UNRESOLVED"))
        else:
            ok = width >= r.value - 1e-9 if kind == "min" else width <= r.value + 1e-9
            checks.append(_check(cid, title, key, PASS if ok else FAIL, width, r.value, "m", r.basis, r.ref))
    r = rules.get(KEY_MIN_SEPARATION)
    checks.append(_check("crossover_separation", "CROSSOVER SEPARATION FROM A CORNER OR INTERSECTION", KEY_MIN_SEPARATION, NOT_EVALUATED, None, r.value, "m", r.basis, r.ref,
                         "NEEDS WHICH BOUNDARIES ADJOIN A ROAD, WHICH THE 3D MODEL DOES NOT CARRY"))


def _keep_side(kerb: dict[str, Any] | None, cl: LineString) -> tuple[Polygon, str]:
    """The side of the driveway start that earthworks may occupy: the lot side of the assumed kerb line, else (no usable kerb line or lot side) the side
    of the first centreline point that the centreline runs towards (chainage 0 plane, perpendicular to the first segment). Nothing is drawn past it."""
    R = 5000.0                                                  # far larger than any accepted request (the centreline is capped at 300 m)
    if kerb is not None and kerb["has_normal"]:
        a, u, n = kerb["a"], kerb["u"], kerb["n"]
        label = "THE ASSUMED KERB LINE (CHAINAGE 0)"
    else:
        (x0, y0), (x1, y1) = cl.coords[0][:2], cl.coords[1][:2]
        d = np.array([x1 - x0, y1 - y0], float)
        n = d / (np.hypot(*d) or 1.0)
        a, u = np.array([x0, y0]), np.array([-n[1], n[0]])
        label = "CHAINAGE 0 (NO ASSUMED KERB LINE IN THE 3D MODEL)"
    return Polygon([tuple(a - u * R), tuple(a + u * R), tuple(a + u * R + n * R), tuple(a - u * R + n * R)]), label


def _earthworks(obj, terrain, rules, cl: LineString, design, width, ts, zx, out, kerb, link: LinkedEnd) -> dict[str, Any] | None:
    cut, fill = ge.batter_value(obj, "cut", rules), ge.batter_value(obj, "fill", rules)
    out["checks"] += [ge.batter_checks(cut), ge.batter_checks(fill)]
    if width is None:
        out["notes"].append("WIDTH NOT SET: NO PLATFORM, SO NO BATTERS OR CUT AND FILL")
        return None
    platform = cl.buffer(width / 2, cap_style="flat", join_style="mitre")
    if platform.is_empty or not platform.is_valid:
        out["notes"].append("THE DRIVEWAY OUTLINE IS NOT A VALID AREA: NO BATTERS OR CUT AND FILL")
        return None
    keep, kept_at = _keep_side(kerb, cl)
    exclude, clip_notes = None, [f"BATTERS AND EARTHWORKS ARE CLIPPED AT {kept_at}: NOTHING IS DRAWN OR COMPUTED ON THE ROAD SIDE OF IT"]
    if link.building is not None and link.building.geometry.kind == "polygon":
        ring = Polygon([(p[0], p[1]) for p in link.building.geometry.ring])
        if ring.is_valid and not ring.is_empty:
            exclude = ring
            clip_notes.append(f"BATTERS AND EARTHWORKS ARE CLIPPED AT THE FOOTPRINT OF THE LINKED BUILDING {link.building_id}: NOTHING IS DRAWN OR COMPUTED INSIDE IT")
        else:
            clip_notes.append(f"THE FOOTPRINT OF THE LINKED BUILDING {link.building_id} IS NOT A VALID AREA, SO IT IS NOT USED TO CLIP THE EARTHWORKS")
    if exclude is not None:
        platform = platform.difference(exclude)
        if platform.geom_type == "MultiPolygon":
            platform = max(platform.geoms, key=lambda g: g.area)
        if platform.is_empty or platform.geom_type != "Polygon":
            out["notes"].append("THE DRIVEWAY LIES INSIDE THE LINKED BUILDING FOOTPRINT: NO BATTERS OR CUT AND FILL")
            return None

    def level_at(x, y):
        d = shapely.line_locate_point(cl, shapely.points(np.asarray(x, float).ravel(), np.asarray(y, float).ravel()))
        return np.asarray(design(d)).reshape(np.shape(x))

    dz = np.abs(np.asarray(design(np.array(ts))) - zx)
    depth = float(np.nanmax(dz)) if np.isfinite(dz).any() else None
    ew = ge.earthworks(terrain, platform, level_at, cut, fill, depth_hint_m=None if depth is None else max(depth, 0.5), keep=keep, exclude=exclude)
    ew["crossfall_note"] = "THE PLATFORM HAS NO CROSSFALL: IT IS LEVEL ACROSS THE DRIVEWAY AT THE DESIGN LEVEL ON THE CENTRELINE"
    ew["notes"] += clip_notes + [ew["crossfall_note"]]
    return ew
