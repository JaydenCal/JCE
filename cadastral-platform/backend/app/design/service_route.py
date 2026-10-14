"""Sewer and water service route proposals (stage 8). Server side and deterministic: the browser asks, gets ready to apply objects plus the checks, and applies them
through its operation registry (one undo step).

SEWER. Start: a sewer exit point of a stage 5 building. End: a connection point, either a point on an existing sewer main of the model (``main_id``) or a point the
user enters (labelled NOT VERIFIED). The route is the shortest path in plan around the placed hard objects (``sewer_engine.route_around``); inspection openings are
placed ONLY where the rule keys require them (``sewer.inspection_opening_max_spacing_m`` and ``sewer.inspection_opening_max_deflection_deg``; a rule that does not
resolve places none and says so). Inverts run from the user's start invert at the grade the user chose, or at the resolved minimum grade
(``sewer.min_grade_pct`` for the diameter) when the user chose none; with neither the inverts stay unset. Cover, grade, connection depth, clearances, zone of
influence and crossings are then checked by ``object_checks`` exactly as for hand drawn objects, and every check is returned.

WATER. Start: a connection point on a water main (``main_id``) or entered by the user (NOT VERIFIED). Then the meter position the user gives, then the water exit
of the building. Size and cover are the user's entries; the checks use ``water.min_cover_m``. A tank with reuse can be linked (``rwt_id``).

NOTHING is invented: no depth, grade, size, owner or clearance has a default. A proposal is a starting point for the user to adjust, never a certified design.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any

import numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from . import engine_limits as EL
from . import object_geometry as G
from . import service_model as SM
from . import sewer_engine as ES
from .object_checks import check_design
from .site_design import SiteDesign, SiteObject
from .site_rules import SiteRules
from .terrain_source import NO_TERRAIN, SiteTerrain

PROPOSAL_LABEL = "PROPOSAL FOR THE USER TO ADJUST, NOT A CERTIFIED DESIGN"
OBSTACLE_TYPES = ("building", "retaining_wall", "rwt", "osd", "osd_basin", "pool")
NOT_VERIFIED = "NOT VERIFIED"


class RouteError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def _uid(taken: set[str], prefix: str) -> str:
    i = 1
    while f"{prefix}_{i}" in taken:
        i += 1
    taken.add(f"{prefix}_{i}")
    return f"{prefix}_{i}"


def _user(v: Any, ref: str | None = None) -> dict[str, Any]:
    p: dict[str, Any] = {"value": v, "basis": "user"}
    if ref:
        p["ref"] = ref[:200]
    return p


def _derived(v: Any, rule_key: str) -> dict[str, Any]:
    """A value the server computed from a requirement key (basis ``derived``; the reference is the key itself, which the checks verify resolves)."""
    return {"value": v, "basis": "derived", "ref": rule_key}


def _building(design: SiteDesign, building_id: str) -> SiteObject:
    b = next((o for o in design.objects if o.id == building_id and o.type == "building" and o.accepted != "rejected"), None)
    if b is None or b.building is None:
        raise RouteError("NO_SUCH_BUILDING", f"BUILDING {building_id.upper()} IS NOT IN THE DESIGN")
    return b


def _exit_point(b: SiteObject, kind: str, index: int) -> tuple[float, float]:
    pts = b.building.exits.sewer if kind == "sewer" else b.building.exits.water       # type: ignore[union-attr]
    if not pts:
        raise RouteError("NO_EXIT_POINT", f"THE BUILDING HAS NO {kind.upper()} EXIT POINT IN ITS SOURCE, SO THE ROUTE HAS NO START. PLACE THE START POINT YOURSELF")
    if not 0 <= index < len(pts):
        raise RouteError("NO_EXIT_POINT", f"THE BUILDING HAS {len(pts)} {kind.upper()} EXIT POINT(S); INDEX {index} IS NOT ONE OF THEM")
    return float(pts[index][0]), float(pts[index][1])


def _check_inputs(design: SiteDesign) -> None:
    EL.check_site_design(design)
    if sum(1 for o in design.objects if o.type in OBSTACLE_TYPES) > EL.MAX_ROUTE_OBJECTS:
        raise EL.EngineLimitError(EL.ROUTE_TOO_LARGE, f"THE DESIGN HAS MORE THAN {EL.MAX_ROUTE_OBJECTS} OBJECTS TO ROUTE AROUND")


def _connection(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None, kind: str, conn: dict[str, Any], near: tuple[float, float]) -> dict[str, Any]:
    """Resolve the connection point: ``{"p", "main", "verified", "invert_rl", "label", "notes"}``. A point on a main of the model, or a point the user entered."""
    from .param_basis import Reader
    rd = Reader(rules)
    notes: list[str] = []
    main_id = conn.get("main_id")
    p = conn.get("p")
    invert = conn.get("invert_rl")
    if invert is not None and (isinstance(invert, bool) or not isinstance(invert, (int, float)) or not math.isfinite(invert)):
        raise RouteError("BAD_CONNECTION", "THE CONNECTION INVERT MUST BE A NUMBER")
    if main_id:
        m = next((o for o in design.objects if o.id == main_id and o.type == "service_existing" and o.accepted != "rejected"), None)
        if m is None:
            raise RouteError("NO_SUCH_MAIN", f"{str(main_id).upper()} IS NOT AN EXISTING SERVICE IN THE DESIGN")
        s = SM.read_service(m, rd)
        if s.kind != kind:
            raise RouteError("WRONG_SERVICE_KIND", f"{s.name} IS NOT A {kind.upper()} SERVICE")
        if s.geom is None or s.geom.geom_type != "LineString":
            raise RouteError("NO_SUCH_MAIN", f"{s.name} HAS NO LINE TO CONNECT TO")
        if p is not None:
            q = nearest_points(s.geom, Point(p[0], p[1]))[0]
        else:
            q = nearest_points(s.geom, Point(*near))[0]
        pt = (float(q.x), float(q.y))
        label = "VERIFIED" if m.verified else NOT_VERIFIED
        if not m.verified:
            notes.append(f"THE MAIN {s.name} IS {SM.UNVERIFIED_LABEL}; THE CONNECTION IS {NOT_VERIFIED}")
        if invert is None and terrain is not None:
            iv = s.invert_depth()
            z = float(terrain.surface.z_at(np.array([pt[0]]), np.array([pt[1]]))[0])
            if iv is not None and math.isfinite(z):
                invert = z - iv
                notes.append(f"CONNECTION INVERT FROM THE MAIN: GROUND {z:.3f} MINUS DEPTH {iv:.3f} M ({(s.basis or '').replace('_', ' ').upper()})")
            elif iv is None:
                notes.append(f"CONNECTION INVERT NOT AVAILABLE: {s.depth_issue() or 'DEPTH DATA NOT AVAILABLE'}")
        return {"p": pt, "main": m, "verified": bool(m.verified), "invert_rl": invert, "label": label, "notes": notes}
    if p is None or len(p) < 2:
        raise RouteError("NO_CONNECTION", "GIVE A CONNECTION: AN EXISTING SERVICE (main_id) OR A POINT (p)")
    notes.append(f"THE CONNECTION POINT WAS ENTERED BY THE USER AND IS {NOT_VERIFIED}")
    return {"p": (float(p[0]), float(p[1])), "main": None, "verified": False, "invert_rl": invert, "label": NOT_VERIFIED, "notes": notes}


def _obstacles(design: SiteDesign, rules: SiteRules, own: str | None, start: tuple[float, float], notes: list[str]) -> list:
    from .param_basis import Reader
    rd = Reader(rules)
    rb = rules.get_for("sewer.min_clearance_to_building_m")
    out = []
    unknown = 0
    for o in design.objects:
        if o.type not in OBSTACLE_TYPES or o.accepted == "rejected" or o.status == "to_be_removed":
            continue
        g = G.footprint(o, rd)
        if g is None:
            unknown += 1
            continue
        if o.type == "building" and o.id != own and rb.resolved:
            g = g.buffer(float(rb.value), join_style=2)
        out.append(g)
    if unknown:
        notes.append(f"{unknown} OBJECT(S) HAVE NO KNOWN FOOTPRINT (A DIMENSION IS NOT SET) AND THE ROUTE DOES NOT GO AROUND THEM")
    if not rb.resolved:
        notes.append(f"THE CLEARANCE TO BUILDINGS IS UNRESOLVED ({rb.key}), SO THE ROUTE GOES AROUND BUILDINGS WITHOUT A CLEARANCE")
    return out


def _route(design: SiteDesign, rules: SiteRules, own: str | None, start, end, notes) -> list[tuple[float, float]]:
    if math.hypot(end[0] - start[0], end[1] - start[1]) > EL.MAX_ROUTE_LENGTH_M:
        raise EL.EngineLimitError(EL.ROUTE_TOO_LARGE, f"THE START AND END ARE MORE THAN {EL.MAX_ROUTE_LENGTH_M:g} M APART")
    obs = _obstacles(design, rules, own, start, notes)
    obs = [g for g in obs if not g.buffer(-1e-6).contains(Point(start)) and not g.buffer(-1e-6).contains(Point(end))]
    r = ES.route_around(start, end, obs)
    if r is None:
        raise RouteError("NO_ROUTE", "NO ROUTE FROM THE START TO THE END AVOIDS THE OBJECTS (OR THE START OR END IS INSIDE ONE). MOVE AN OBJECT OR DRAW THE ROUTE BY HAND")
    return ES.simplify_collinear(r)


def _filter(checks: list[dict[str, Any]], ids: set[str]) -> list[dict[str, Any]]:
    """The checks that belong to the new objects: the check of one of them, or a pair check whose suffix names one of them. A check id is
    ``<object id>:<code>[:<other id>]`` and an object id holds no colon, so the match is on the exact segment (``sewer_1`` never matches ``sewer_10``)."""
    def hit(e: dict[str, Any]) -> bool:
        parts = str(e["id"]).split(":")
        return e["object_id"] in ids or (len(parts) >= 3 and parts[2] in ids)
    return [e for e in checks if hit(e)]


def _run_checks(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None, new: list[dict[str, Any]], today: date | None) -> tuple[dict[str, Any], set[str]]:
    doc = design.dump()
    doc["objects"] = [*doc["objects"], *new]
    try:
        full = SiteDesign.model_validate(doc)
    except ValueError as e:
        raise RouteError("PROPOSAL_INVALID", f"THE PROPOSED OBJECTS ARE NOT VALID: {str(e)[:300]}") from None
    ids = {o["id"] for o in new}
    return check_design(full, rules, terrain, today), ids


def _summary(checks: list[dict[str, Any]]) -> dict[str, Any]:
    by: dict[str, int] = {}
    for e in checks:
        by[e["status"]] = by.get(e["status"], 0) + 1
    return {"total": len(checks), "by_status": by, "blocking": sum(1 for e in checks if e["severity"] == "blocking"), "warning": sum(1 for e in checks if e["severity"] == "warning")}


# ---------------------------------------------------------------------------------------------------------------------------------- sewer
def propose_sewer(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None, *, building_id: str, exit_index: int = 0, start_invert_rl: float,
                  diameter_mm: float, connection: dict[str, Any], grade_pct: float | None = None, today: date | None = None) -> dict[str, Any]:
    _check_inputs(design)
    for name, v in (("START INVERT", start_invert_rl), ("DIAMETER", diameter_mm)):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise RouteError("BAD_INPUT", f"{name} MUST BE A NUMBER")
    if diameter_mm <= 0:
        raise RouteError("BAD_INPUT", "DIAMETER MUST BE ABOVE ZERO")
    if grade_pct is not None and (isinstance(grade_pct, bool) or not isinstance(grade_pct, (int, float)) or not math.isfinite(grade_pct) or grade_pct < 0):
        raise RouteError("BAD_INPUT", "GRADE MUST BE A NUMBER OF ZERO OR MORE")
    b = _building(design, building_id)
    start = _exit_point(b, "sewer", exit_index)
    cn = _connection(design, rules, terrain, "sewer", connection, start)
    end = cn["p"]
    notes: list[str] = list(cn["notes"])
    route = _route(design, rules, building_id, start, end, notes)
    ln = LineString(route)
    # inspection openings only where the rules require them
    rs = rules.get_for("sewer.inspection_opening_max_spacing_m")
    rdf = rules.get_for("sewer.inspection_opening_max_deflection_deg")
    if not rs.resolved:
        notes.append(f"NO INSPECTION OPENING SPACING RULE ({rs.key} UNRESOLVED): OPENINGS FOR SPACING WERE NOT PLACED")
    if not rdf.resolved:
        notes.append(f"NO DEFLECTION RULE ({rdf.key} UNRESOLVED): OPENINGS FOR CHANGES OF DIRECTION WERE NOT PLACED")
    ch = ES.inspection_chainages(route, rdf.value if rdf.resolved else None, rs.value if rs.resolved else None)
    links = ES.split_route(route, ch)
    lens = [LineString(k).length for k in links]
    # grade and inverts
    grade, grade_ref = grade_pct, "GRADE ENTERED BY THE USER"
    rule_key: str | None = None                        # set when the grade comes from a requirement: the inverts that follow from it are DERIVED from that key
    if grade is None:
        rg = rules.get_for("sewer.min_grade_pct", dia_mm=int(round(diameter_mm)))
        if rg.resolved:
            grade, grade_ref, rule_key = float(rg.value), f"MINIMUM GRADE FROM {rg.key} ({rg.basis})", rg.key
        else:
            notes.append(f"NO GRADE WAS GIVEN AND THE MINIMUM GRADE IS UNRESOLVED ({rg.key}), SO THE INVERTS ARE NOT SET")
    inv = ES.link_inverts(lens, start_invert_rl, grade) if grade is not None else [(None, None)] * len(links)
    taken = {o.id for o in design.objects}
    new: list[dict[str, Any]] = []
    link_ids: list[str] = []
    for k, (pts, (u, d)) in enumerate(zip(links, inv)):
        oid = _uid(taken, "sewer")
        link_ids.append(oid)
        params: dict[str, Any] = {"diameter_mm": _user(diameter_mm), "building_id": _user(building_id)}
        if u is not None:
            ref = f"SEWER TOOL: START INVERT {start_invert_rl:g} AND {grade_ref}"
            if rule_key is None:
                params["upstream_invert_rl"], params["downstream_invert_rl"] = _user(round(u, 4), ref), _user(round(d, 4), ref)
            else:                                      # computed from the rule grade: DERIVED from the key; only the start invert itself is the user's own entry
                params["upstream_invert_rl"] = _user(round(u, 4), "SEWER TOOL: START INVERT ENTERED BY THE USER") if k == 0 else _derived(round(u, 4), rule_key)
                params["downstream_invert_rl"] = _derived(round(d, 4), rule_key)
        new.append({"id": oid, "type": "sewer_drain", "status": "proposed", "origin": "user", "label": f"SEWER {k + 1}", "geometry": {"kind": "polyline", "pts": [[round(x, 4), round(y, 4)] for x, y in pts]}, "params": params})
    for c_ in ch:
        x, y = ES.point_at(route, c_)
        oid = _uid(taken, "sewer_io")
        iv = None
        if grade is not None:
            iv = start_invert_rl - grade / 100.0 * c_
        params = {"node_kind": _user("inspection_opening")}
        if iv is not None:
            params["invert_rl"] = _user(round(iv, 4), "SEWER TOOL") if rule_key is None else _derived(round(iv, 4), rule_key)
        new.append({"id": oid, "type": "service_node", "status": "proposed", "origin": "user", "label": "INSPECTION OPENING", "geometry": {"kind": "point", "p": [round(x, 4), round(y, 4)]}, "params": params})
    cid = _uid(taken, "sewer_cn")
    cparams: dict[str, Any] = {"node_kind": _user("sewer_connection")}
    if cn["main"] is not None:
        cparams["main_id"] = _user(cn["main"].id)
    if cn["invert_rl"] is not None:
        cparams["invert_rl"] = _user(round(float(cn["invert_rl"]), 4), "CONNECTION INVERT")
    new.append({"id": cid, "type": "service_node", "status": "proposed", "origin": "user", "label": f"CONNECTION ({cn['label']})", "geometry": {"kind": "point", "p": [round(end[0], 4), round(end[1], 4)]}, "params": cparams})
    # profile
    profile: list[dict[str, Any]] = []
    arrive = inv[-1][1] if inv and inv[-1][1] is not None else None
    if grade is not None and terrain is not None:
        drv = [g for g in (G.footprint(o, None) for o in design.objects if o.type == "driveway" and o.status != "to_be_removed") if g is not None]
        fp = [g for g in (G.footprint(o, None) for o in design.objects if o.type == "footpath" and o.status != "to_be_removed") if g is not None]
        down = arrive if arrive is not None else start_invert_rl
        prof = ES.cover_profile(route, start_invert_rl, down, diameter_mm, lambda xs, ys: np.where(np.isfinite(z := terrain.surface.z_at(np.asarray(xs, float), np.asarray(ys, float))), z, np.nan), drv, fp)
        for i in range(len(prof.ts)):
            fin = bool(np.isfinite(prof.ground[i]))
            profile.append({"chainage_m": round(float(prof.ts[i]), 3), "x": float(prof.xs[i]), "y": float(prof.ys[i]), "ground_rl": round(float(prof.ground[i]), 3) if fin else None,
                            "invert_rl": round(float(prof.invert[i]), 3), "crown_rl": round(float(prof.crown[i]), 3), "cover_m": round(float(prof.cover[i]), 3) if fin else None, "location": prof.cls[i]})
    elif terrain is None:
        notes.append(NO_TERRAIN + ": COVER IS NOT COMPUTED")
    # arrival at the connection
    conn_out: dict[str, Any] = {"p": [end[0], end[1]], "label": cn["label"], "main_id": cn["main"].id if cn["main"] is not None else None, "invert_rl": cn["invert_rl"], "arrival_invert_rl": arrive}
    if arrive is None or cn["invert_rl"] is None:
        conn_out["status"] = "NOT EVALUATED"
        conn_out["message"] = "NOT EVALUATED: " + ("THE DRAIN INVERTS ARE NOT SET" if arrive is None else "THE CONNECTION INVERT IS NOT AVAILABLE (ENTER IT OR VERIFY THE DEPTH OF THE MAIN)")
    else:
        fall = arrive - float(cn["invert_rl"])
        conn_out["status"] = "PASS" if fall >= -1e-9 else "FAIL"
        conn_out["message"] = (f"THE DRAIN ARRIVES {fall:.3f} M ABOVE THE INVERT OF THE CONNECTION" if fall >= 0 else
                               f"THE DRAIN ARRIVES {-fall:.3f} M BELOW THE INVERT OF THE CONNECTION: IT CANNOT DISCHARGE BY GRAVITY. RAISE THE START INVERT OR REDUCE THE GRADE")
    full, ids = _run_checks(design, rules, terrain, new, today)
    checks = _filter(full["checks"], ids)
    return {"schema": "sewer_proposal.v1", "label": PROPOSAL_LABEL, "objects": new, "route": {"pts": [[x, y] for x, y in route], "length_m": round(ln.length, 3)},
            "grade_pct": grade, "grade_basis": grade_ref if grade is not None else None, "inspection_chainages_m": [round(c_, 3) for c_ in ch], "connection": conn_out,
            "profile": profile, "checks": checks, "summary": _summary(checks), "notes": notes, "terrain": full["terrain"], "rules_for": full["rules_for"]}


# ---------------------------------------------------------------------------------------------------------------------------------- water
def propose_water(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None, *, building_id: str, exit_index: int = 0, meter_p: list[float],
                  diameter_mm: float, cover_m: float, connection: dict[str, Any], rwt_id: str | None = None, today: date | None = None) -> dict[str, Any]:
    _check_inputs(design)
    for name, v in (("DIAMETER", diameter_mm), ("COVER", cover_m)):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v <= 0:
            raise RouteError("BAD_INPUT", f"{name} MUST BE A NUMBER ABOVE ZERO")
    if len(meter_p) < 2 or not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in meter_p[:2]):
        raise RouteError("BAD_INPUT", "THE METER POSITION MUST BE TWO NUMBERS")
    b = _building(design, building_id)
    exit_ = _exit_point(b, "water", exit_index)
    meter = (float(meter_p[0]), float(meter_p[1]))
    cn = _connection(design, rules, terrain, "water", connection, meter)
    notes: list[str] = list(cn["notes"])
    if rwt_id is not None:
        r_ = next((o for o in design.objects if o.id == rwt_id and o.type == "rwt" and o.accepted != "rejected"), None)
        if r_ is None:
            raise RouteError("NO_SUCH_RWT", f"{rwt_id.upper()} IS NOT A RAINWATER TANK IN THE DESIGN")
        from .param_basis import Reader
        if not any(G.flag(r_, k, Reader(rules)) for k in ("reuse_toilet", "reuse_laundry", "reuse_garden")):
            notes.append(f"THE TANK {rwt_id.upper()} HAS NO REUSE SET, SO THE LINK IS KEPT BUT NO MAINS BACKUP IS REQUIRED FOR REUSE")
    a = _route(design, rules, building_id, cn["p"], meter, notes)
    z = _route(design, rules, building_id, meter, exit_, notes)
    route = ES.simplify_collinear([*a, *z[1:]])
    taken = {o.id for o in design.objects}
    wid = _uid(taken, "water")
    params: dict[str, Any] = {"diameter_mm": _user(diameter_mm), "cover_m": _user(cover_m)}
    if cn["main"] is not None:
        params["main_id"] = _user(cn["main"].id)
    if rwt_id is not None:
        params["rwt_id"] = _user(rwt_id)
    new: list[dict[str, Any]] = [
        {"id": wid, "type": "water_service", "status": "proposed", "origin": "user", "label": "WATER SERVICE", "geometry": {"kind": "polyline", "pts": [[round(x, 4), round(y, 4)] for x, y in route]}, "params": params},
        {"id": _uid(taken, "water_cn"), "type": "service_node", "status": "proposed", "origin": "user", "label": f"WATER CONNECTION ({cn['label']})",
         "geometry": {"kind": "point", "p": [round(cn["p"][0], 4), round(cn["p"][1], 4)]}, "params": {"node_kind": _user("water_connection"), **({"main_id": _user(cn["main"].id)} if cn["main"] is not None else {})}},
        {"id": _uid(taken, "water_meter"), "type": "service_node", "status": "proposed", "origin": "user", "label": "WATER METER", "geometry": {"kind": "point", "p": [round(meter[0], 4), round(meter[1], 4)]},
         "params": {"node_kind": _user("water_meter")}},
    ]
    full, ids = _run_checks(design, rules, terrain, new, today)
    checks = _filter(full["checks"], ids)
    # the tank's own mains backup check names the tank, not the new objects; include it when the tank is linked
    if rwt_id is not None:
        checks += [e for e in full["checks"] if e["object_id"] == rwt_id and e["code"] == "RWT_MAINS_BACKUP"]
    return {"schema": "water_proposal.v1", "label": PROPOSAL_LABEL, "objects": new, "route": {"pts": [[x, y] for x, y in route], "length_m": round(LineString(route).length, 3)},
            "connection": {"p": [cn["p"][0], cn["p"][1]], "label": cn["label"], "main_id": cn["main"].id if cn["main"] is not None else None}, "checks": checks, "summary": _summary(checks),
            "notes": notes, "terrain": full["terrain"], "rules_for": full["rules_for"]}
