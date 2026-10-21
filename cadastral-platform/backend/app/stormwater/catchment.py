"""Catchments of the site design (stage 9): areas by surface kind, runoff behaviour, routing and the pre and post development comparison.

WHAT IS COUNTED. Every object that is a surface: a building roof, a driveway, a footpath, a pool, a landscape area (a garden, turf, paving and so on) and a grading area.
An area is computed from the drawn geometry (plan area; a line object is its centreline times its entered width). An object whose dimension is NOT SET has no area and
is listed as such. The post development set is every object that is existing or proposed; the pre development set is every object that is existing or to be removed
(the surfaces the user marked as existing). With no existing surface object the pre development set is NOT SET: nothing is assumed about the ground before development.
A lot area that no drawn surface covers is reported as UNCLASSIFIED and is never given a runoff behaviour.

RUNOFF BEHAVIOUR. A runoff coefficient (for the design event, as supplied) per surface comes from the user's entry in the panel, else from the requirement key of the surface
(``stormwater.runoff_coefficient.<surface>`` or ``landscape.runoff_coefficient.<kind>``), else it is UNRESOLVED. There is no default. Frequency factors are not applied: the
coefficient is used as supplied.

ROUTING (post development). A roof drains to the tank that is linked to its building (``rwt.roof_building_id``) by the tank's connected roof area; the rest of the roof, and
every other surface, drains to the object named by its ``drains_to_id`` (an OSD, an infiltration trench or a discharge point). The overflow of a tank goes to the OSD or trench
of an overflow route that starts at the tank (``rwt_id``), else to its ``drains_to_id``. The outlet of an OSD or trench goes to its ``drains_to_id``. An object with no link goes
to the legal point of discharge (the user placed ``discharge_point``); the route says DEFAULT when that was the rule used. Method assumption, stated on the result: a tank is taken
as full at the start of the design storm, so the connected roof is passed to the overflow target (no reuse credit).
"""
from __future__ import annotations

import math
from typing import Any

import shapely
from shapely.affinity import translate
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from app.design import object_geometry as G
from app.design import object_keys as OK
from app.design.param_basis import Reader
from app.design.site_design import SiteDesign, SiteObject
from app.design.site_rules import UNRESOLVED, USER, SiteRules

from .inputs import USER_REF, StormwaterInputs

SURFACE_TYPES = ("building", "driveway", "footpath", "pool", "landscape_area", "grading_area")
SURFACE_LABEL = {"roof": "ROOF", "pool": "POOL", "concrete": "CONCRETE", "asphalt": "ASPHALT", "pavers": "PAVERS", "gravel": "GRAVEL (DRIVEWAY OR FOOTPATH)",
                 "permeable_pavers": "PERMEABLE PAVERS", "landscape_turf": "TURF", "landscape_garden_bed": "GARDEN BED", "landscape_mulch": "MULCH",
                 "landscape_gravel": "GRAVEL (LANDSCAPE)", "landscape_permeable_paving": "PERMEABLE PAVING", "landscape_impervious_paving": "IMPERVIOUS PAVING",
                 "unclassified": "UNCLASSIFIED (NO SURFACE OBJECT)", "not_set": "SURFACE NOT SET"}
OVERLAP_TOL_M2 = 0.05           # an overlap smaller than this is geometry noise
MAX_OVERLAP_PAIRS = 12          # pairs listed on the result


def val(value: Any, unit: str = "", basis: str = "MODEL", ref: str = "", stamp: str | None = None, key: str | None = None) -> dict[str, Any]:
    d = {"value": value, "unit": unit, "basis": basis, "ref": ref}
    if stamp:
        d["stamp"] = stamp
    if key:
        d["key"] = key
    return d


def _local(g: BaseGeometry, x0: float, y0: float) -> BaseGeometry:
    """Geometry moved to a local origin before an area is taken (MGA magnitudes are millions of metres, and the shoelace sum loses digits there)."""
    return translate(g, -x0, -y0)


def area_of(g: BaseGeometry) -> float:
    if g.is_empty:
        return 0.0
    b = g.bounds
    return float(_local(g, b[0], b[1]).area)


def runoff_for(surface: str, rules: SiteRules, inputs: StormwaterInputs) -> dict[str, Any]:
    """The runoff coefficient of a surface: the user's entry, else the requirement key, else UNRESOLVED (with how to supply it)."""
    key = OK.landscape_key(surface[len("landscape_"):]) if surface.startswith("landscape_") else OK.runoff_key(surface)
    if surface in inputs.runoff_coefficients:
        return val(inputs.runoff_coefficients[surface], "", USER, USER_REF, key=key)
    r = rules.get(key)
    if r.resolved and isinstance(r.value, (int, float)) and 0.0 <= float(r.value) <= 1.0:
        return val(float(r.value), "", r.basis, r.ref, r.stamp, key=key)
    why = r.ref if not r.resolved else f"THE VALUE {r.value} IS NOT BETWEEN 0 AND 1"
    return {**val(None, "", UNRESOLVED, why, key=key), "how": f"Enter the runoff coefficient of {SURFACE_LABEL.get(surface, surface).lower()} in the panel, or load the requirement key {key} for the LGA."}


def _surface(o: SiteObject, rd: Reader) -> tuple[str, str]:
    """(surface id, why it is not set). ``not_set`` when the object says nothing about its surface."""
    if o.type == "building":
        return "roof", ""
    if o.type == "pool":
        return "pool", ""
    kind = G.text(o, "surface_kind", rd)
    if kind is None:
        return "not_set", "SURFACE KIND NOT SET"
    if o.type in ("landscape_area", "grading_area"):
        return f"landscape_{kind}", ""
    return kind, ""


def _area(o: SiteObject, rd: Reader) -> tuple[float | None, str, str, BaseGeometry | None]:
    """(plan area m2, basis text, note, polygon used for the overlap test)."""
    if o.type == "building":
        poly = G.ring_polygon(o)
        roof = G.pos(o, "roof_plan_area_m2", rd)
        if roof is not None:
            return roof, (G.text(o, "roof_area_basis", rd) or "ROOF AREA ENTERED, BASIS NOT STATED").upper(), "", poly
        if o.building is not None and o.building.roof_outline:
            polys = [Polygon([(p[0], p[1]) for p in r]) for r in o.building.roof_outline]
            polys = [p if p.is_valid else p.buffer(0) for p in polys]
            u = shapely.union_all(polys)
            return area_of(u), "ROOF OUTLINE OF THE IMPORT (PLAN AREA)", "", poly
        if poly is not None:
            return area_of(poly), "FOOTPRINT AREA; THE ROOF AREA IS NOT SET", "THE ROOF PLAN AREA IS NOT SET, SO THE FOOTPRINT IS USED (EAVES NOT INCLUDED)", poly
        return None, "NOT SET", "THE BUILDING HAS NO USABLE OUTLINE", None
    fp = G.footprint(o, rd) if o.type != "pool" else G.ring_polygon(o)
    if o.type in ("driveway",) and fp is None:
        return None, "NOT SET", "WIDTH NOT SET", None
    if o.type == "footpath" and fp is None:
        return None, "NOT SET", "WIDTH NOT SET" if o.geometry.kind == "polyline" else "OUTLINE NOT USABLE", None
    if fp is None:
        return None, "NOT SET", "OUTLINE NOT USABLE", None
    basis = "CENTRELINE LENGTH x ENTERED WIDTH" if o.geometry.kind == "polyline" else "PLAN AREA OF THE DRAWN OUTLINE"
    return area_of(fp), basis, "", fp


def _phases(o: SiteObject) -> list[str]:
    if o.status == "existing":
        return ["pre", "post"]
    if o.status == "proposed":
        return ["post"]
    return ["pre"]                                  # to be removed


class Catchments:
    def __init__(self, design: SiteDesign, rules: SiteRules, lot: Polygon | None, inputs: StormwaterInputs) -> None:
        self.rules, self.lot, self.inputs = rules, lot, inputs
        self.refusals: dict[str, dict[str, str]] = {}
        self.rd = Reader(rules, self.refusals)
        self.objs = [o for o in design.objects if o.accepted != "rejected"]
        self.by_id = {o.id: o for o in self.objs}
        self.missing: list[dict[str, Any]] = []
        self.notes: list[str] = []

    def need(self, id_: str, area: str, what: str, how: str, key: str | None = None) -> None:
        if not any(m["id"] == id_ for m in self.missing):
            self.missing.append({"id": id_, "area": area, "what": what, "key": key, "how": how})

    # ---- rows
    def rows(self) -> tuple[list[dict[str, Any]], dict[str, BaseGeometry]]:
        rows: list[dict[str, Any]] = []
        polys: dict[str, BaseGeometry] = {}
        rd = self.rd
        for o in self.objs:
            if o.type not in SURFACE_TYPES:
                continue
            sid, why_s = _surface(o, rd)
            area, abasis, anote, poly = _area(o, rd)
            if poly is not None:
                polys[o.id] = poly
            base = {"object_id": o.id, "object_type": o.type, "label": (o.label or o.id).upper(), "status": o.status, "phases": _phases(o),
                    "surface": sid, "surface_label": SURFACE_LABEL.get(sid, sid.upper()), "area_basis": abasis, "area_note": anote or why_s,
                    "drains_to_id": G.text(o, "drains_to_id", rd)}
            if o.type == "grading_area" and sid != "not_set":
                base["area_note"] = (anote + "; " if anote else "") + "SURFACE AFTER GRADING AS ENTERED ON THE GRADING AREA"
            if area is None:
                self.need(f"area:{o.id}", "CATCHMENT", f"{o.type.replace('_', ' ').upper()} {o.id}: AREA NOT KNOWN ({anote})", f"Enter the missing dimension on {o.id}.")
            if sid == "not_set":
                self.need(f"surface:{o.id}", "CATCHMENT", f"{o.type.replace('_', ' ').upper()} {o.id}: {why_s}", f"Choose the surface of {o.id} in its properties.")
            rows.append({**base, "id": o.id, "area_m2": None if area is None else round(area, 3), "split": None})
        return rows, polys

    def attach_runoff(self, rows: list[dict[str, Any]]) -> None:
        for r in rows:
            if r["surface"] in ("not_set", "unclassified"):
                r["runoff"] = {**val(None, "", UNRESOLVED, r["area_note"] or "SURFACE NOT SET"), "how": "Choose the surface of the object so its runoff behaviour can be found."}
            else:
                r["runoff"] = runoff_for(r["surface"], self.rules, self.inputs)
                if r["runoff"]["value"] is None and "post" in r["phases"]:
                    k = r["runoff"]["key"]
                    self.need(f"runoff:{r['surface']}", "RUNOFF", f"RUNOFF COEFFICIENT OF {r['surface_label']} IS UNRESOLVED", r["runoff"]["how"], k)
            c, a = r["runoff"]["value"], r["area_m2"]
            r["ca_m2"] = None if c is None or a is None else round(c * a, 4)

    # ---- discharge points and routing
    def discharge_points(self) -> list[SiteObject]:
        return [o for o in self.objs if o.type == "discharge_point"]

    def default_discharge(self) -> tuple[str | None, str]:
        dps = self.discharge_points()
        if len(dps) == 1:
            return dps[0].id, ""
        if not dps:
            return None, "NO LEGAL POINT OF DISCHARGE IS PLACED"
        return None, "MORE THAN ONE LEGAL POINT OF DISCHARGE IS PLACED AND THE OBJECT IS NOT LINKED TO ONE"

    def _target(self, link: str | None, allowed: tuple[str, ...]) -> tuple[str | None, str]:
        """(object id, basis text). An explicit link wins; an object with no link goes to the single discharge point (DEFAULT)."""
        if link is not None:
            t = self.by_id.get(link)
            if t is None or t.type not in allowed:
                return None, f"THE LINK {link.upper()} IS NOT A {' OR '.join(a.replace('_', ' ').upper() for a in allowed)} IN THE DESIGN"
            return t.id, "LINKED"
        d, why = self.default_discharge()
        return (d, "DEFAULT: LEGAL POINT OF DISCHARGE (NO LINK SET)") if d else (None, why)

    def next_of_storage(self, o: SiteObject) -> tuple[str | None, str]:
        """Where the outlet or overflow of an OSD, trench or tank goes."""
        return self._target(G.text(o, "drains_to_id", self.rd), ("discharge_point",))

    def route_rows(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Post development rows with their routing. Roofs linked to a tank are split into a tank part and a direct part."""
        out: list[dict[str, Any]] = []
        tanks_by_roof: dict[str, list[SiteObject]] = {}
        for o in self.objs:
            if o.type == "rwt":
                b = G.text(o, "roof_building_id", self.rd)
                if b:
                    tanks_by_roof.setdefault(b, []).append(o)
        for r in rows:
            if "post" not in r["phases"]:
                continue
            o = self.by_id[r["object_id"]]
            if r["object_type"] == "building" and o.id in tanks_by_roof and r["area_m2"] is not None:
                tanks = tanks_by_roof[o.id]
                conn = [(t, G.pos(t, "connected_roof_area_m2", self.rd)) for t in tanks]
                if any(c is None for _, c in conn):
                    for t, c in conn:
                        if c is None:
                            self.need(f"connected:{t.id}", "ROUTING", f"RAINWATER TANK {t.id}: CONNECTED ROOF AREA NOT SET", f"Enter the connected roof area on {t.id} (or connect the whole roof).")
                    out.append({**r, "id": f"{r['id']}:roof_unrouted", "route": {"to": None, "path": [], "basis": "NOT SET", "reason": "THE CONNECTED ROOF AREA OF A LINKED TANK IS NOT SET"}})
                    continue
                total = sum(c for _, c in conn if c)
                if total > r["area_m2"] + 1e-6:
                    self.need(f"connected_over:{o.id}", "ROUTING", f"THE CONNECTED ROOF AREAS ({total:.1f} M2) EXCEED THE ROOF AREA OF {o.id} ({r['area_m2']:.1f} M2)", f"Correct the connected roof area on the tank(s) linked to {o.id}.")
                    out.append({**r, "id": f"{r['id']}:roof_unrouted", "route": {"to": None, "path": [], "basis": "NOT SET", "reason": "THE CONNECTED ROOF AREAS EXCEED THE ROOF"}})
                    continue
                for t, c in conn:
                    ca = None if r["runoff"]["value"] is None else round(r["runoff"]["value"] * c, 4)
                    out.append({**r, "id": f"{r['id']}:rwt:{t.id}", "area_m2": round(c, 3), "ca_m2": ca, "split": f"CONNECTED TO TANK {t.id}",
                                "route": self._tank_route(t)})
                rest = r["area_m2"] - total
                if rest > OVERLAP_TOL_M2:
                    ca = None if r["runoff"]["value"] is None else round(r["runoff"]["value"] * rest, 4)
                    out.append({**r, "id": f"{r['id']}:direct", "area_m2": round(rest, 3), "ca_m2": ca, "split": "NOT CONNECTED TO A TANK", "route": self._direct_route(r)})
                continue
            out.append({**r, "route": self._direct_route(r)})
        return out

    def _direct_route(self, r: dict[str, Any]) -> dict[str, Any]:
        tgt, basis = self._target(r["drains_to_id"], G_DRAIN_TARGETS)
        if tgt is None:
            self.need(f"route:{r['object_id']}", "ROUTING", f"{r['object_id']}: {basis}", f"Place a discharge point (kerb outlet, interallotment drainage or other) and link {r['object_id']} to its destination (drains to).")
            return {"to": None, "path": [], "basis": "NOT SET", "reason": basis}
        return {"to": tgt, "path": self._follow(tgt), "basis": basis, "reason": ""}

    def _overflow_target(self, x: SiteObject) -> tuple[str | None, str]:
        """(target id, why not). The target of an overflow route is its OSD (``osd_id``, an osd or osd_basin) or its trench (``trench_id``, an infiltration_trench); the TYPE of the
        object named is checked, so a link to a building, a pit or an unknown id is not a route."""
        for key, types, label in (("osd_id", ("osd", "osd_basin"), "AN OSD"), ("trench_id", ("infiltration_trench",), "AN INFILTRATION TRENCH")):
            link = G.text(x, key, self.rd)
            if not link:
                continue
            t = self.by_id.get(link)
            if t is None:
                return None, f"{key.upper()} {link.upper()} IS NOT AN OBJECT OF THE DESIGN"
            if t.type not in types:
                return None, f"{key.upper()} {link.upper()} IS A {t.type.replace('_', ' ').upper()}, NOT {label}"
            return t.id, ""
        return None, "THE OVERFLOW ROUTE HAS NO OSD OR TRENCH"

    def _tank_route(self, t: SiteObject) -> dict[str, Any]:
        routes = [x for x in self.objs if x.type == "overflow_route" and G.text(x, "rwt_id", self.rd) == t.id]
        if len(routes) > 1:
            ids = ", ".join(x.id for x in routes)
            self.need(f"overflow_multi:{t.id}", "ROUTING", f"RAINWATER TANK {t.id} HAS {len(routes)} OVERFLOW ROUTES ({ids}). ONE TANK CAN HAVE ONE OVERFLOW ROUTE, SO THE OVERFLOW IS NOT ROUTED",
                      f"Keep one overflow route for {t.id} and delete or re-link the others.")
            return {"to": None, "path": [t.id], "basis": "NOT SET", "reason": f"MULTIPLE OVERFLOW ROUTES ({ids})", "tank": t.id}
        if routes:
            x = routes[0]
            tgt, why = self._overflow_target(x)
            if tgt is None:
                self.need(f"overflow:{x.id}", "ROUTING", f"OVERFLOW ROUTE {x.id}: IT DOES NOT END AT AN OSD OR A TRENCH IN THE DESIGN ({why})", f"Link {x.id} to an OSD or an infiltration trench.")
                return {"to": None, "path": [t.id], "basis": "NOT SET", "reason": f"THE OVERFLOW ROUTE HAS NO VALID TARGET ({why})", "tank": t.id}
            return {"to": tgt, "path": [t.id] + self._follow(tgt), "basis": f"LINKED: OVERFLOW ROUTE {x.id}", "reason": "", "tank": t.id}
        nxt, basis = self.next_of_storage(t)
        if nxt is None:
            self.need(f"route:{t.id}", "ROUTING", f"RAINWATER TANK {t.id}: THE OVERFLOW HAS NO DESTINATION ({basis})", f"Draw an overflow route from {t.id}, or place a discharge point and link the tank to it.")
            return {"to": None, "path": [t.id], "basis": "NOT SET", "reason": basis, "tank": t.id}
        return {"to": nxt, "path": [t.id, nxt], "basis": basis, "reason": "", "tank": t.id}

    def _follow(self, node: str, depth: int = 0) -> list[str]:
        """The nodes from ``node`` to the discharge point: an OSD or trench passes on to its outlet target."""
        o = self.by_id.get(node)
        if o is None or depth > 6:
            return [node]
        if o.type in ("osd", "osd_basin", "infiltration_trench"):
            nxt, _ = self.next_of_storage(o)
            return [node] + (self._follow(nxt, depth + 1) if nxt and nxt != node else [])
        return [node]

    # ---- the two sets
    def totals(self, rows: list[dict[str, Any]], phase: str) -> dict[str, Any]:
        sel = [r for r in rows if phase in r["phases"]]
        by: dict[str, dict[str, Any]] = {}
        for r in sel:
            b = by.setdefault(r["surface"], {"surface": r["surface"], "label": r["surface_label"], "area_m2": 0.0, "ca_m2": 0.0, "area_unknown": 0, "coeff_unknown": 0, "objects": 0})
            b["objects"] += 1
            if r["area_m2"] is None:
                b["area_unknown"] += 1
            else:
                b["area_m2"] += r["area_m2"]
                if r["ca_m2"] is None:
                    b["coeff_unknown"] += 1
                else:
                    b["ca_m2"] += r["ca_m2"]
        for b in by.values():
            b["area_m2"], b["ca_m2"] = round(b["area_m2"], 3), round(b["ca_m2"], 4)
        known = [r for r in sel if r["area_m2"] is not None]
        complete = bool(sel) and all(r["area_m2"] is not None and r["ca_m2"] is not None for r in sel)
        area = round(sum(r["area_m2"] for r in known), 3)
        ca = round(sum(r["ca_m2"] for r in known if r["ca_m2"] is not None), 4)
        return {"phase": phase, "by_surface": list(by.values()), "area_m2": area, "ca_m2": ca, "complete": complete,
                "weighted_c": round(ca / area, 4) if complete and area > 0 else None, "objects": len(sel)}

    def unclassified(self, rows: list[dict[str, Any]], polys: dict[str, BaseGeometry], phase: str) -> dict[str, Any]:
        sel = [polys[r["object_id"]] for r in rows if phase in r["phases"] and r["object_id"] in polys]
        if self.lot is None:
            return {"status": "NOT EVALUATED", "message": "LOT BOUNDARY NOT AVAILABLE IN THE 3D MODEL", "lot_area_m2": None, "covered_m2": None, "unclassified_m2": None}
        x0, y0 = self.lot.bounds[0], self.lot.bounds[1]
        lot = _local(self.lot, x0, y0)
        cov = shapely.union_all([_local(p, x0, y0).intersection(lot) for p in sel]) if sel else Polygon()
        la, ca = float(lot.area), float(cov.area)
        return {"status": "OK", "message": "", "lot_area_m2": round(la, 3), "covered_m2": round(ca, 3), "unclassified_m2": round(max(0.0, la - ca), 3)}

    def overlaps(self, rows: list[dict[str, Any]], polys: dict[str, BaseGeometry], phase: str) -> dict[str, Any]:
        ids = [r["object_id"] for r in rows if phase in r["phases"] and r["object_id"] in polys]
        ids = list(dict.fromkeys(ids))
        gs = [polys[i] for i in ids]
        if len(gs) < 2:
            return {"overlap_m2": 0.0, "pairs": []}
        x0, y0 = min(g.bounds[0] for g in gs), min(g.bounds[1] for g in gs)
        gl = [_local(g, x0, y0) for g in gs]
        tree = STRtree(gl)
        pairs: list[tuple[float, str, str]] = []
        for i, g in enumerate(gl):
            for j in tree.query(g):
                if j <= i:
                    continue
                a = float(g.intersection(gl[j]).area)
                if a > OVERLAP_TOL_M2:
                    pairs.append((a, ids[i], ids[j]))
        pairs.sort(reverse=True)
        total = sum(float(g.area) for g in gl) - float(shapely.union_all(gl).area)
        return {"overlap_m2": round(max(0.0, total), 3), "pairs": [{"a": a, "b": b, "area_m2": round(m, 3)} for m, a, b in pairs[:MAX_OVERLAP_PAIRS]]}


G_DRAIN_TARGETS = ("osd", "osd_basin", "infiltration_trench", "discharge_point")


def build(design: SiteDesign, rules: SiteRules, lot: Polygon | None, inputs: StormwaterInputs) -> dict[str, Any]:
    c = Catchments(design, rules, lot, inputs)
    rows, polys = c.rows()
    c.attach_runoff(rows)
    routed = c.route_rows(rows)
    pre, post = c.totals(rows, "pre"), c.totals(routed, "post")
    pre_set = pre["objects"] > 0
    cmp = {"pre": pre if pre_set else {**pre, "status": "NOT SET"}, "post": post,
           "pre_status": "OK" if pre_set else "NOT SET",
           "pre_message": "" if pre_set else "NO SURFACE IS MARKED EXISTING, SO THE PRE DEVELOPMENT CONDITION IS NOT SET. Mark the existing surfaces (status existing, or to be removed) to set it.",
           "pre_unclassified": c.unclassified(rows, polys, "pre"), "post_unclassified": c.unclassified(routed, polys, "post"),
           "pre_overlaps": c.overlaps(rows, polys, "pre"), "post_overlaps": c.overlaps(rows, polys, "post")}
    if not pre_set:
        c.need("pre_dev", "PRE DEVELOPMENT", "THE PRE DEVELOPMENT SURFACES ARE NOT SET", "Mark the surfaces that exist now by setting their status to existing (or to be removed), so the comparison can be made.")
    un = cmp["post_unclassified"]
    if un.get("status") == "OK" and (un["unclassified_m2"] or 0) > OVERLAP_TOL_M2:
        c.notes.append(f"{un['unclassified_m2']:.1f} M2 OF THE LOT HAS NO SURFACE OBJECT AND IS NOT IN THE CATCHMENT TOTALS")
    if cmp["post_overlaps"]["overlap_m2"] > OVERLAP_TOL_M2:
        c.notes.append(f"THE DRAWN SURFACES OVERLAP BY {cmp['post_overlaps']['overlap_m2']:.1f} M2, SO THE TOTALS MAY COUNT THAT AREA TWICE")
    c.notes.append("A TANK IS TAKEN AS FULL AT THE START OF THE DESIGN STORM, SO THE CONNECTED ROOF IS PASSED TO THE OVERFLOW TARGET (NO REUSE CREDIT)")
    return {"rows": rows, "post_rows": routed, "comparison": cmp, "missing": c.missing, "notes": c.notes, "discharge_points": [
        {"id": o.id, "label": (o.label or o.id).upper(), "kind": G.text(o, "discharge_kind", c.rd), "basis": G.text(o, "discharge_basis", c.rd)} for o in c.discharge_points()],
        "_catchments": c}


def routing_view(post_rows: list[dict[str, Any]], design_objs: dict[str, SiteObject]) -> list[dict[str, Any]]:
    """The routing as a list of destinations with the rows and areas that reach each (a simple diagram: surface to tank to storage to discharge)."""
    dest: dict[str, dict[str, Any]] = {}
    for r in post_rows:
        path = r["route"].get("path") or []
        key = "UNROUTED" if not path else path[-1]
        d = dest.setdefault(key, {"destination": key, "type": design_objs[key].type if key in design_objs else None, "area_m2": 0.0, "ca_m2": 0.0, "ca_unknown": 0, "rows": []})
        a = r["area_m2"] or 0.0
        d["area_m2"] += a
        if r["ca_m2"] is None:
            d["ca_unknown"] += 1
        else:
            d["ca_m2"] += r["ca_m2"]
        d["rows"].append({"id": r["id"], "object_id": r["object_id"], "surface": r["surface_label"], "area_m2": r["area_m2"], "split": r["split"], "path": path, "basis": r["route"]["basis"],
                          "reason": r["route"].get("reason", "")})
    for d in dest.values():
        d["area_m2"], d["ca_m2"] = round(d["area_m2"], 3), round(d["ca_m2"], 4)
    return sorted(dest.values(), key=lambda d: d["destination"])
