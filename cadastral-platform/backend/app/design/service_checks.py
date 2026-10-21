"""Stage 8 checks: existing services (DBYD), the property sewer drain, the water service, the zone of influence of a sewer main and the clash checks.

The checks are called from ``object_checks.Checker.run``. They follow the rules of that module: EVERY limit is a requirement key resolved by ``SiteRules`` (with the
selectors service, diameter and asset owner where the key has them); a limit that does not resolve makes the check NOT EVALUATED and names the key; a depth, size or
owner that the object does not carry is NOT SET and the check that needs it is NOT EVALUATED. No default depth, clearance, cover or grade exists in this module.

MODEL INTERPRETATIONS (stated, not hidden):

* Depth below ground is measured at the service. ``depth_m`` needs a basis (plan indicated, potholed, surveyed) AND a reference (top of the asset or invert). Top and bottom
  of the asset differ by the nominal diameter (wall thickness is not modelled).
* Zone of influence of a sewer main: the footing of an object at depth F (``footing_depth_m``, entered by the user) is inside the zone when its plan distance to the sewer
  is less than ``offset + (P - F) / tan(angle)`` where P is the depth of the sewer invert, ``angle`` is ``sewer.zone_of_influence.angle_deg`` (measured from horizontal) and
  ``offset`` is ``sewer.zone_of_influence.offset_m``. For F at or below the invert (F >= P) the half width is the offset alone. The positional tolerance of an existing sewer is added.
  This is the common line from the invert out and up at the angle of repose; the asset owner's own guideline governs and is not replaced by this check.
* Two lines CROSS only when they intersect in each other's interiors (the interiors of both lines share a point). Lines that merely touch at an end are not crossings:
  consecutive links of one drain, and a drain end that meets the main it connects to (same service kind, an end within ``ES.CONNECT_TOL_M`` of the other line), are
  connected assets and are not clash candidates. Lines that cross are checked vertically at the crossing; the other pairs are checked horizontally by the shortest plan
  distance. A proposed line that both runs beside and crosses an existing service is judged at the crossing only.
* The zone of influence, the building clearance and the object clash exclude the building a drain leaves (its ``building_id``).

Strings are upper case where they are shown as labels and contain no em or en dash.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable

from shapely.geometry import LineString, Point
from shapely.geometry.base import BaseGeometry

from . import object_geometry as G
from . import service_model as SM
from . import sewer_engine as ES
from .site_design import SiteObject
from .site_rules import Rule

if TYPE_CHECKING:  # pragma: no cover
    from .object_checks import Checker

PASS, FAIL, NOT_EVALUATED, NOT_APPLICABLE, ACTION, INFO = "PASS", "FAIL", "NOT EVALUATED", "NOT APPLICABLE", "ACTION REQUIRED", "INFO"
INSPECTION_KINDS = ("inspection_opening", "inspection_pit")
#: object types a sewer main's zone of influence, the building clearance and the services clash are checked against
ZONE_TYPES = ("building", "retaining_wall", "rwt", "osd", "osd_basin", "pool", "tree")
MAX_CLASH_ENTRIES = 300
MAX_CROSSING_POINTS = 5


def _f(v: float, d: int = 2) -> str:
    return f"{v:.{d}f}"


def _nm(o: SiteObject) -> str:
    return f"{o.type.replace('_', ' ').upper()} {(o.label or o.id).upper()}"


def rule_for(c: "Checker", key: str, **sel: Any) -> Rule:
    c.keys_used.add(key)
    return c.rules.get_for(key, **sel)


# ---------------------------------------------------------------------------------------------------------------------------------- buried assets
@dataclass
class Buried:
    """One buried line or point for the clash and zone checks: where it is and how deep (top and bottom, metres below ground) at a plan position."""
    obj: SiteObject
    role: str                      # "existing" or "proposed"
    kind: str | None
    dia_mm: float | None
    owner: str | None
    geom: BaseGeometry
    svc: "SM.Svc | None"
    depth: Callable[[float, float], tuple[float | None, float | None, str]]

    @property
    def name(self) -> str:
        return self.svc.name if self.svc is not None else _nm(self.obj)


def _terrain_depth(c: "Checker", ln: LineString, up: float | None, down: float | None, dia: float | None):
    def f(x: float, y: float):
        if up is None or down is None:
            return None, None, "INVERT LEVELS ARE NOT SET"
        if dia is None:
            return None, None, "DIAMETER IS NOT SET"
        if c.site.terrain is None:
            return None, None, "TERRAIN DATA NOT AVAILABLE"
        z = c.site.ground(x, y)
        if z is None:
            return None, None, "TERRAIN DATA NOT AVAILABLE AT THE POINT"
        t = ln.project(Point(x, y)) / ln.length
        inv = up + (down - up) * t
        bottom = z - inv
        return bottom - dia / 1000.0, bottom, ""
    return f


def buried_assets(c: "Checker") -> list[Buried]:
    out: list[Buried] = []
    live = c.site.objs
    for s in SM.services_of(live, c.rd):
        if s.geom is None:
            continue
        top, bot = s.top_depth(), s.invert_depth()
        why = s.depth_issue() or ("DIAMETER IS NOT SET" if (top is None or bot is None) else "")
        out.append(Buried(s.obj, "existing", s.kind, s.dia_mm, s.owner, s.geom, s, (lambda x, y, t=top, b=bot, w=why: (t, b, w))))
    for o in live:
        if o.status == "to_be_removed" or o.geometry.kind != "polyline":
            continue
        ln = G.line_of(o)
        if ln is None:
            continue
        dia = G.pos(o, "diameter_mm", c.rd)
        if o.type in ("sewer_drain", "stormwater_pipe"):
            kind = "sewer" if o.type == "sewer_drain" else "stormwater"
            out.append(Buried(o, "proposed", kind, dia, None, ln, None, _terrain_depth(c, ln, G.num(o, "upstream_invert_rl", c.rd), G.num(o, "downstream_invert_rl", c.rd), dia)))
        elif o.type == "water_service":
            cov = G.pos(o, "cover_m", c.rd)
            bottom = None if cov is None or dia is None else cov + dia / 1000.0
            why = "COVER IS NOT SET" if cov is None else "DIAMETER IS NOT SET" if dia is None else ""
            out.append(Buried(o, "proposed", "water", dia, None, ln, None, (lambda x, y, t=cov, b=bottom, w=why: (t, b, w))))
    return out


def interiors_cross(a: BaseGeometry, b: BaseGeometry) -> bool:
    """True when two lines intersect in each other's interiors (a crossing or a shared stretch). A touch at an end of either line is not a crossing."""
    return a.geom_type == "LineString" and b.geom_type == "LineString" and bool(a.relate_pattern(b, "T********"))


def connected(a: "Buried", b: "Buried") -> bool:
    """Two lines of the same service kind where an end of one is on the other (within the connection tolerance): consecutive links of a drain, a branch, or a drain end on
    the main it connects to. They are one connected asset, so they are neither crossing nor a clearance clash."""
    if a.kind is None or a.kind != b.kind or a.geom.geom_type != "LineString" or b.geom.geom_type != "LineString":
        return False
    tol = ES.CONNECT_TOL_M
    ends_a = [Point(a.geom.coords[0]), Point(a.geom.coords[-1])]
    ends_b = [Point(b.geom.coords[0]), Point(b.geom.coords[-1])]
    return any(e.distance(b.geom) <= tol for e in ends_a) or any(e.distance(a.geom) <= tol for e in ends_b)


def crossing_points(a: BaseGeometry, b: BaseGeometry) -> list[Point]:
    """Where two lines cross in plan (up to MAX_CROSSING_POINTS); a shared stretch gives the midpoint of the stretch."""
    inter = a.intersection(b)
    if inter.is_empty:
        return []
    pts: list[Point] = []
    for g in (inter.geoms if hasattr(inter, "geoms") else [inter]):
        if g.geom_type == "Point":
            pts.append(g)
        elif g.geom_type == "LineString" and g.length > 0:
            pts.append(g.interpolate(0.5, normalized=True))
        elif g.geom_type == "MultiPoint":
            pts += list(g.geoms)
    return pts[:MAX_CROSSING_POINTS]


# ---------------------------------------------------------------------------------------------------------------------------------- existing service
def svc_existing(c: "Checker", o: SiteObject) -> None:
    s = SM.read_service(o, c.rd)
    nm = s.name
    # verification
    t = "EXISTING SERVICE VERIFIED"
    by = G.text(o, "verified_by", c.rd)
    if o.verified:
        c.add(o, "SVC_VERIFIED", t, PASS, f"VERIFIED BY {(by or '').upper()} ON {SM.show_date(o.verified_on)}")
    else:
        c.add(o, "SVC_VERIFIED", t, ACTION, f"{SM.UNVERIFIED_LABEL}: {nm} IS NOT VERIFIED. TREAT ITS POSITION AND DEPTH AS A GUIDE ONLY UNTIL IT IS CONFIRMED (POTHOLING OR SURVEY)", severity="warning")
    # plan expiry
    t = "DBYD PLAN CURRENT"
    exp, how, vrule = SM.plan_expiry(s, c.rules)
    if vrule is not None:
        c.keys_used.add(vrule.key)
    if exp is None:
        why = "THE PLAN DATE IS NOT SET" if s.plan_date is None and s.expiry_param is None else "NO PLAN EXPIRY DATE IS ENTERED AND THE VALIDITY PERIOD IS UNRESOLVED (dbyd.plan_validity_days)"
        c.add(o, "SVC_PLAN_EXPIRY", t, NOT_EVALUATED, f"NOT EVALUATED: PLAN EXPIRY {SM.NOT_SET}. {why}", rules=[vrule] if vrule is not None else None)
        c.show(o, "plan_expiry", "PLAN EXPIRY", SM.NOT_SET)
    else:
        expired = c.today > exp
        c.show(o, "plan_expiry", "PLAN EXPIRY", SM.show_date(exp))
        if expired:
            c.add(o, "SVC_PLAN_EXPIRY", t, FAIL, f"{SM.PLAN_EXPIRED}: THE PLAN EXPIRED ON {SM.show_date(exp)} (TODAY {SM.show_date(c.today)}). {how}. LODGE A NEW DBYD ENQUIRY BEFORE RELYING ON THIS SERVICE",
                  rules=[vrule] if vrule is not None else None, severity="warning", value=SM.show_date(exp))
        else:
            c.add(o, "SVC_PLAN_EXPIRY", t, PASS, f"THE PLAN IS CURRENT UNTIL {SM.show_date(exp)}. {how}", rules=[vrule] if vrule is not None else None, value=SM.show_date(exp))
    # depth
    t = "SERVICE DEPTH KNOWN"
    issue = s.depth_issue()
    if issue:
        c.add(o, "SVC_DEPTH", t, NOT_EVALUATED, f"NOT EVALUATED: {issue}. VERTICAL CHECKS AGAINST THIS SERVICE ARE NOT EVALUATED")
    else:
        basis = (s.basis or "").replace("_", " ").upper()
        rd_ = c.rd.read(o, "depth_m")                      # the true basis of the entry (USER, or PLAN INDICATED when it was read from a DBYD plan)
        c.show(o, "depth_m", f"DEPTH TO THE {'TOP' if s.reference == 'top' else 'INVERT'} ({basis})", round(s.depth_m, 3), "m", rd_.basis if rd_.ok else "MODEL", rd_.ref if rd_.ok else "")        # type: ignore[arg-type]
        c.add(o, "SVC_DEPTH", t, INFO if s.basis != "plan_indicated" else ACTION,
              f"DEPTH {_f(s.depth_m)} M TO THE {'TOP' if s.reference == 'top' else 'INVERT'}, BASIS {basis}" + ("" if s.basis != "plan_indicated" else ". A PLAN INDICATED DEPTH IS NOT A MEASURED DEPTH"),   # type: ignore[arg-type]
              value=s.depth_m, unit="m", severity="info" if s.basis != "plan_indicated" else "warning")
    # exclusion buffer
    t = "EXCLUSION BUFFER"
    r, total, why = SM.exclusion_buffer(s, c.rules)
    c.keys_used.add(r.key)
    if total is None:
        c.add(o, "SVC_EXCLUSION", t, NOT_EVALUATED, f"NOT EVALUATED: EXCLUSION BUFFER UNRESOLVED ({r.key}). {why}", rules=[r])
    else:
        c.show(o, "exclusion_buffer_m", "EXCLUSION BUFFER (CLEARANCE PLUS TOLERANCE)", round(total, 3), "m", r.basis, r.ref)
        c.add(o, "SVC_EXCLUSION", t, INFO, f"EXCLUSION BUFFER {_f(total)} M: CLEARANCE {_f(r.value)} M PLUS POSITIONAL TOLERANCE {_f(s.tol_m)} M", rules=[r], value=round(total, 3), unit="m")   # type: ignore[arg-type]


# ---------------------------------------------------------------------------------------------------------------------------------- sewer drain
def _surfaces(c: "Checker"):
    drv = [g for g in (G.footprint(o, c.rd) for o in c.site.of("driveway") if o.status != "to_be_removed") if g is not None]
    fp = [g for g in (G.footprint(o, c.rd) for o in c.site.of("footpath") if o.status != "to_be_removed") if g is not None]
    return drv, fp


def _touch(c: "Checker", pt: tuple[float, float]) -> list[str]:
    """What a drain end touches (within ES.CONNECT_TOL_M): building sewer exit, node, another drain, an existing service."""
    tol, found = ES.CONNECT_TOL_M, []
    p = Point(pt)
    for b in c.site.of("building"):
        if b.building is not None and any(math.hypot(pt[0] - e[0], pt[1] - e[1]) <= tol for e in b.building.exits.sewer):
            found.append("BUILDING EXIT")
            break
    if any(n.geometry.kind == "point" and G.on_vertex(pt, n, tol) for n in c.site.of("service_node")):
        found.append("NODE")
    for d in c.site.of("sewer_drain"):
        ln = G.line_of(d)
        if ln is not None and ln.distance(p) <= tol:
            found.append("DRAIN")
            break
    if any(a.role == "existing" and a.kind == "sewer" and a.geom.distance(p) <= tol for a in c._buried):
        found.append("EXISTING SEWER")
    return found


def sewer_drain(c: "Checker", o: SiteObject) -> None:
    pts = [(q[0], q[1]) for q in o.geometry.pts]
    ln = LineString(pts)
    L = ln.length
    zero = not L > 0
    up, down = G.num(o, "upstream_invert_rl", c.rd), G.num(o, "downstream_invert_rl", c.rd)
    dia = G.pos(o, "diameter_mm", c.rd)
    # link to the building
    bid = G.text(o, "building_id", c.rd)
    if bid is not None and (bid not in c.site.by_id or c.site.by_id[bid].type != "building"):
        c.add(o, "DRAIN_BUILDING_LINK", "DRAIN BUILDING LINK", FAIL, f"THE LINKED BUILDING {bid.upper()} IS NOT IN THE DESIGN", severity="blocking")
    # grade
    tg = "DRAIN GRADE"
    if zero:
        c.add(o, "DRAIN_GRADE", tg, NOT_EVALUATED, "NOT EVALUATED: DRAIN LENGTH ZERO, SO THE GRADE CANNOT BE COMPUTED")
    elif up is None or down is None:
        c.rule("sewer.min_grade_pct")
        c.add(o, "DRAIN_GRADE", tg, NOT_EVALUATED, "NOT EVALUATED: UPSTREAM OR DOWNSTREAM INVERT NOT SET")
    else:
        grade = (up - down) / L * 100.0
        c.show(o, "grade_pct", "GRADE (FALL OVER PLAN LENGTH)", round(grade, 3), "%")
        rg = rule_for(c, "sewer.min_grade_pct", dia_mm=None if dia is None else int(round(dia)))
        if grade < 0:
            c.add(o, "DRAIN_GRADE", tg, FAIL, f"THE UPSTREAM INVERT {_f(up, 3)} IS BELOW THE DOWNSTREAM INVERT {_f(down, 3)}: THE DRAIN FALLS THE WRONG WAY ({_f(grade)} PERCENT)", rules=[rg], value=round(grade, 3), unit="%")
        elif dia is None:
            c.add(o, "DRAIN_GRADE", tg, NOT_EVALUATED, f"NOT EVALUATED: DIAMETER NOT SET (THE MINIMUM GRADE DEPENDS ON THE DIAMETER). GRADE {_f(grade)} PERCENT", rules=[rg], value=round(grade, 3), unit="%")
        elif not rg.resolved:
            c.unresolved(o, "DRAIN_GRADE", tg, [rg], why=f"GRADE {_f(grade)} PERCENT", value=round(grade, 3), unit="%")
        else:
            ok = grade >= rg.value - 1e-9
            c.add(o, "DRAIN_GRADE", tg, PASS if ok else FAIL, f"GRADE {_f(grade)} PERCENT; THE RULE REQUIRES AT LEAST {_f(rg.value)} PERCENT FOR DN{int(round(dia))}", rules=[rg], value=round(grade, 3), limit=rg.value, unit="%")
    # cover by location class
    tc = "DRAIN COVER AGAINST THE RULE"
    keys = [rule_for(c, f"sewer.min_cover_m.{k}") for k in ES.COVER_CLASSES]
    if zero or up is None or down is None or dia is None:
        c.add(o, "DRAIN_COVER", tc, NOT_EVALUATED, "NOT EVALUATED: " + ("DRAIN LENGTH ZERO" if zero else "DIAMETER NOT SET" if dia is None else "UPSTREAM OR DOWNSTREAM INVERT NOT SET"), rules=keys)
    elif c.site.terrain is None:
        c.add(o, "DRAIN_COVER", tc, NOT_EVALUATED, "NOT EVALUATED: TERRAIN DATA NOT AVAILABLE", rules=keys)
    else:
        drv, fp = _surfaces(c)
        prof = ES.cover_profile(pts, up, down, dia, lambda xs, ys: c.site.ground_many(xs, ys), drv, fp)
        if not prof.finite().any():
            c.add(o, "DRAIN_COVER", tc, NOT_EVALUATED, "NOT EVALUATED: TERRAIN DATA NOT AVAILABLE ALONG THE DRAIN", rules=keys)
        else:
            missing = int((~prof.finite()).sum())
            part = f" TERRAIN DATA NOT AVAILABLE AT {missing} STATION(S)." if missing else ""
            present = [(k, r) for k, r in zip(ES.COVER_CLASSES, keys) if prof.min_cover(k) is not None]
            mc = prof.min_cover()
            c.show(o, "min_cover_m", "MINIMUM COVER TO THE CROWN", round(mc, 3), "m")      # type: ignore[arg-type]
            fails = [(k, r, prof.min_cover(k)) for k, r in present if r.resolved and prof.min_cover(k) < r.value - 1e-9]       # type: ignore[operator]
            unres = [r for _k, r in present if not r.resolved]
            basis = "COVER IS TO THE CROWN FROM THE NOMINAL DIAMETER (WALL THICKNESS IS NOT MODELLED)"
            if fails:
                k, r, m = fails[0]
                c.add(o, "DRAIN_COVER", tc, FAIL, f"COVER {_f(m)} M UNDER {ES.COVER_CLASS_LABEL[k]}; THE RULE REQUIRES AT LEAST {_f(r.value)} M. {basis}.{part}", rules=[r for _k, r in present],
                      value=round(m, 3), limit=r.value, unit="m")
            elif unres:
                c.unresolved(o, "DRAIN_COVER", tc, unres, why=f"MINIMUM COVER {_f(mc)} M. {basis}.{part}".rstrip("."), value=round(mc, 3), unit="m")      # type: ignore[arg-type]
            else:
                k0 = min(present, key=lambda kr: prof.min_cover(kr[0]) - kr[1].value)[0]
                c.add(o, "DRAIN_COVER", tc, PASS, f"MINIMUM COVER {_f(mc)} M; EVERY LOCATION CLASS MEETS ITS RULE ({', '.join(ES.COVER_CLASS_LABEL[k] for k, _r in present)}). {basis}.{part}",      # type: ignore[arg-type]
                      rules=[r for _k, r in present], value=round(mc, 3), unit="m")
    # connection depth (downstream end at a sewer connection node or an existing sewer)
    end = pts[-1]
    touches = _touch(c, end)
    if "EXISTING SEWER" in touches or any(n.geometry.kind == "point" and G.on_vertex(end, n, ES.CONNECT_TOL_M) and G.text(n, "node_kind", c.rd) == "sewer_connection" for n in c.site.of("service_node")):
        t = "DEPTH AT THE CONNECTION"
        rd_ = rule_for(c, "sewer.max_connection_depth_m")
        z = c.site.ground(end[0], end[1])
        if down is None:
            c.add(o, "DRAIN_CONNECTION_DEPTH", t, NOT_EVALUATED, "NOT EVALUATED: DOWNSTREAM INVERT NOT SET", rules=[rd_])
        elif z is None:
            c.add(o, "DRAIN_CONNECTION_DEPTH", t, NOT_EVALUATED, "NOT EVALUATED: TERRAIN DATA NOT AVAILABLE AT THE CONNECTION", rules=[rd_])
        else:
            depth = z - down
            c.show(o, "connection_depth_m", "DEPTH OF THE INVERT AT THE CONNECTION", round(depth, 3), "m")
            if not rd_.resolved:
                c.unresolved(o, "DRAIN_CONNECTION_DEPTH", t, [rd_], why=f"DEPTH AT THE CONNECTION {_f(depth)} M", value=round(depth, 3), unit="m")
            else:
                ok = depth <= rd_.value + 1e-9
                c.add(o, "DRAIN_CONNECTION_DEPTH", t, PASS if ok else FAIL, f"INVERT {_f(depth)} M BELOW GROUND AT THE CONNECTION; THE RULE ALLOWS AT MOST {_f(rd_.value)} M", rules=[rd_], value=round(depth, 3), limit=rd_.value, unit="m")
    # ends connected
    t = "DRAIN ENDS CONNECTED"
    st = _touch(c, pts[0])
    if st and touches:
        c.add(o, "DRAIN_ENDS", t, PASS, f"UPSTREAM END AT {', '.join(st)}; DOWNSTREAM END AT {', '.join(touches)}")
    else:
        which = [n for n, e in (("UPSTREAM", st), ("DOWNSTREAM", touches)) if not e]
        c.add(o, "DRAIN_ENDS", t, FAIL, f"THE {' AND '.join(which)} END OF THE DRAIN IS NOT AT A BUILDING EXIT, A NODE, ANOTHER DRAIN OR AN EXISTING SEWER (WITHIN {ES.CONNECT_TOL_M:g} M)", severity="warning")
    # clearance to buildings
    rb = rule_for(c, "sewer.min_clearance_to_building_m")
    blds = [b for b in c.buildings() if b.id != bid]
    fps = [g for g in (G.footprint(b, c.rd) for b in blds) if g is not None]
    t = "DRAIN CLEARANCE TO BUILDINGS"
    if not fps:
        c.add(o, "DRAIN_BUILDING_CLEARANCE", t, NOT_EVALUATED if blds else NOT_APPLICABLE, "NOT EVALUATED: A BUILDING FOOTPRINT IS NOT KNOWN" if blds else "NOT APPLICABLE: NO OTHER BUILDING IN THE DESIGN (THE BUILDING THE DRAIN LEAVES IS NOT CHECKED)", rules=[rb])
    elif not rb.resolved:
        c.unresolved(o, "DRAIN_BUILDING_CLEARANCE", t, [rb])
    elif not zero:
        d = min(float(ln.distance(g)) for g in fps)
        ok = d >= rb.value - 1e-9
        c.add(o, "DRAIN_BUILDING_CLEARANCE", t, PASS if ok else FAIL, f"{_f(d)} M FROM THE NEAREST OTHER BUILDING; THE RULE REQUIRES AT LEAST {_f(rb.value)} M", rules=[rb], value=round(d, 3), limit=rb.value, unit="m")


def sewer_runs(c: "Checker") -> list[list[SiteObject]]:
    """Drain links chained end to start (within the connection tolerance); each run is the links in order. A link that branches is the end of its run."""
    links = [o for o in c.site.of("sewer_drain") if o.status != "to_be_removed" and G.line_of(o) is not None]
    tol = ES.CONNECT_TOL_M

    def a(o: SiteObject): return o.geometry.pts[0]
    def b(o: SiteObject): return o.geometry.pts[-1]
    def near(p, q): return math.hypot(p[0] - q[0], p[1] - q[1]) <= tol
    nxt = {o.id: [x for x in links if x.id != o.id and near(b(o), a(x))] for o in links}
    prev = {o.id: [x for x in links if x.id != o.id and near(a(o), b(x))] for o in links}
    seen: set[str] = set()
    runs: list[list[SiteObject]] = []
    for o in links:
        if o.id in seen or len(prev[o.id]) == 1 and len(nxt[prev[o.id][0].id]) == 1:
            continue
        run, cur = [o], o
        seen.add(o.id)
        while len(nxt[cur.id]) == 1 and len(prev[nxt[cur.id][0].id]) == 1 and nxt[cur.id][0].id not in seen:
            cur = nxt[cur.id][0]
            run.append(cur)
            seen.add(cur.id)
        runs.append(run)
    return runs


def inspection_check(c: "Checker") -> None:
    """Inspection openings or pits only where the rules require: a change of direction beyond the deflection rule, and a spacing beyond the spacing rule."""
    runs = sewer_runs(c)
    if not runs:
        return
    rs = rule_for(c, "sewer.inspection_opening_max_spacing_m")
    rdf = rule_for(c, "sewer.inspection_opening_max_deflection_deg")
    nodes = [n for n in c.site.of("service_node") if n.status != "to_be_removed" and G.text(n, "node_kind", c.rd) in INSPECTION_KINDS and n.geometry.kind == "point"]
    t = "INSPECTION OPENINGS"
    for run in runs:
        pts: list[tuple[float, float]] = []
        for o in run:
            for q in o.geometry.pts:
                p = (q[0], q[1])
                if not pts or math.hypot(p[0] - pts[-1][0], p[1] - pts[-1][1]) > 1e-9:
                    pts.append(p)
        ln = LineString(pts)
        if not ln.length > 0:
            continue
        ops = [0.0, ln.length]
        for n in nodes:
            p = Point(n.geometry.p[0], n.geometry.p[1])
            if ln.distance(p) <= ES.CONNECT_TOL_M:
                ops.append(float(ln.project(p)))
        ops = sorted(ops)
        cum = [0.0]
        for p, q in zip(pts, pts[1:]):
            cum.append(cum[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
        bad_def = []
        if rdf.resolved:
            bad_def = [i for i in range(1, len(pts) - 1) if G.heading_change_deg(pts[i - 1], pts[i], pts[i + 1]) > rdf.value + 1e-9
                       and not any(abs(cum[i] - x) <= ES.CONNECT_TOL_M for x in ops)]
        bad_gap = []
        if rs.resolved:
            bad_gap = [(x0, x1) for x0, x1 in zip(ops, ops[1:]) if x1 - x0 > rs.value + 1e-9]
        first = run[0]
        rules_ = [rs, rdf]
        msg_ctx = f"RUN OF {len(run)} LINK(S), {_f(ln.length)} M, {len(ops) - 2} INSPECTION OPENING(S) BETWEEN ITS ENDS. THE ENDS OF A RUN COUNT AS OPENINGS"
        if bad_def or bad_gap:
            parts = []
            if bad_def:
                parts.append(f"{len(bad_def)} DIRECTION CHANGE(S) OVER {_f(rdf.value)} DEGREES WITHOUT AN OPENING")
            if bad_gap:
                parts.append(f"{len(bad_gap)} STRETCH(ES) LONGER THAN {_f(rs.value)} M BETWEEN OPENINGS (LONGEST {_f(max(b - a for a, b in bad_gap))} M)")
            c.add(first, "DRAIN_INSPECTION", t, FAIL, "; ".join(parts) + ". " + msg_ctx, rules=rules_, value=len(bad_def) + len(bad_gap))
        elif not (rs.resolved and rdf.resolved):
            c.unresolved(first, "DRAIN_INSPECTION", t, [r for r in rules_ if not r.resolved], why=msg_ctx)
        else:
            c.add(first, "DRAIN_INSPECTION", t, PASS, f"EVERY DIRECTION CHANGE AND EVERY STRETCH MEETS THE RULES. {msg_ctx}", rules=rules_)


# ---------------------------------------------------------------------------------------------------------------------------------- nodes and water
def service_node(c: "Checker", o: SiteObject) -> None:
    kind = G.text(o, "node_kind", c.rd)
    mid = G.text(o, "main_id", c.rd)
    p = Point(o.geometry.p[0], o.geometry.p[1])
    if kind in ("sewer_connection", "water_connection"):
        want = "sewer" if kind == "sewer_connection" else "water"
        t = "CONNECTION POINT"
        m = c.site.by_id.get(mid) if mid else None
        if mid is None or m is None or m.type != "service_existing":
            c.add(o, "NODE_CONNECTION", t, ACTION, f"NOT VERIFIED: THIS CONNECTION POINT IS ENTERED BY THE USER AND IS NOT ON A SERVICE IN THE MODEL. CONFIRM IT WITH THE ASSET OWNER", severity="warning")
            return
        s = SM.read_service(m, c.rd)
        d = s.geom.distance(p) if s.geom is not None else math.inf
        if s.kind != want:
            c.add(o, "NODE_CONNECTION", t, FAIL, f"THE LINKED SERVICE {s.name} IS NOT A {want.upper()} SERVICE", severity="warning")
        elif d > ES.CONNECT_TOL_M:
            c.add(o, "NODE_CONNECTION", t, FAIL, f"THE CONNECTION POINT IS {_f(d)} M FROM THE LINKED SERVICE {s.name}; IT MUST LIE ON IT (WITHIN {ES.CONNECT_TOL_M:g} M)", severity="warning")
        elif not m.verified:
            c.add(o, "NODE_CONNECTION", t, ACTION, f"NOT VERIFIED: THE CONNECTION IS ON {s.name}, WHICH IS {SM.UNVERIFIED_LABEL}", severity="warning")
        else:
            c.add(o, "NODE_CONNECTION", t, PASS, f"THE CONNECTION IS ON {s.name}, VERIFIED")


def water_service(c: "Checker", o: SiteObject) -> None:
    ln = G.line_of(o)
    dia = G.pos(o, "diameter_mm", c.rd)
    cov = G.pos(o, "cover_m", c.rd)
    t = "WATER SERVICE COVER"
    r = rule_for(c, "water.min_cover_m", dia_mm=None if dia is None else int(round(dia)))
    if cov is None:
        c.add(o, "WATER_COVER", t, NOT_EVALUATED, "NOT EVALUATED: COVER NOT SET", rules=[r])
    elif not r.resolved:
        c.unresolved(o, "WATER_COVER", t, [r], why=f"COVER {_f(cov)} M", value=cov, unit="m")
    else:
        ok = cov >= r.value - 1e-9
        c.add(o, "WATER_COVER", t, PASS if ok else FAIL, f"COVER {_f(cov)} M; THE RULE REQUIRES AT LEAST {_f(r.value)} M", rules=[r], value=cov, limit=r.value, unit="m")
    if dia is None:
        c.add(o, "WATER_SIZE", "WATER SERVICE SIZE", NOT_EVALUATED, "NOT EVALUATED: SIZE (DIAMETER) NOT SET", severity="info")
    # connection to the main
    t = "WATER SERVICE CONNECTION"
    mid = G.text(o, "main_id", c.rd)
    m = c.site.by_id.get(mid) if mid else None
    if ln is None:
        return
    pts = o.geometry.pts
    if m is None or m.type != "service_existing":
        c.add(o, "WATER_MAIN", t, ACTION, "NOT VERIFIED: THE CONNECTION POINT IS ENTERED BY THE USER AND IS NOT TIED TO A SERVICE IN THE MODEL. CONFIRM IT WITH THE ASSET OWNER", severity="warning")
    else:
        s = SM.read_service(m, c.rd)
        ends = [Point(pts[0][0], pts[0][1]), Point(pts[-1][0], pts[-1][1])]
        d = min(s.geom.distance(e) for e in ends) if s.geom is not None else math.inf
        if s.kind != "water":
            c.add(o, "WATER_MAIN", t, FAIL, f"THE LINKED SERVICE {s.name} IS NOT A WATER SERVICE", severity="warning")
        elif d > ES.CONNECT_TOL_M:
            c.add(o, "WATER_MAIN", t, FAIL, f"NEITHER END IS ON THE LINKED MAIN {s.name} (NEAREST {_f(d)} M, WITHIN {ES.CONNECT_TOL_M:g} M IS REQUIRED)", severity="warning")
        elif not m.verified:
            c.add(o, "WATER_MAIN", t, ACTION, f"NOT VERIFIED: THE CONNECTION IS ON {s.name}, WHICH IS {SM.UNVERIFIED_LABEL}", severity="warning")
        else:
            c.add(o, "WATER_MAIN", t, PASS, f"THE SERVICE CONNECTS TO {s.name}, VERIFIED")
    meters = [n for n in c.site.of("service_node") if G.text(n, "node_kind", c.rd) == "water_meter" and n.geometry.kind == "point" and ln.distance(Point(n.geometry.p[0], n.geometry.p[1])) <= ES.CONNECT_TOL_M]
    c.add(o, "WATER_METER", "WATER METER POSITION", PASS if meters else ACTION, f"METER AT {meters[0].id.upper()}" if meters else "NO WATER METER NODE IS ON THIS SERVICE; PLACE THE METER POSITION", severity="info" if meters else "warning")
    rid = G.text(o, "rwt_id", c.rd)
    if rid is not None:
        r_ = c.site.by_id.get(rid)
        if r_ is None or r_.type != "rwt":
            c.add(o, "WATER_RWT_LINK", "RAINWATER TANK MAINS BACKUP LINK", FAIL, f"THE LINKED TANK {rid.upper()} IS NOT IN THE DESIGN", severity="blocking")
        elif not any(G.flag(r_, k, c.rd) for k in ("reuse_toilet", "reuse_laundry", "reuse_garden")):
            c.add(o, "WATER_RWT_LINK", "RAINWATER TANK MAINS BACKUP LINK", INFO, f"{_nm(r_)} HAS NO REUSE SET, SO A MAINS BACKUP CONNECTION IS NOT NEEDED FOR REUSE", severity="info")
        else:
            c.add(o, "WATER_RWT_LINK", "RAINWATER TANK MAINS BACKUP LINK", PASS, f"THE SERVICE IS LINKED TO {_nm(r_)} FOR MAINS BACKUP OF ITS REUSE", severity="info")


def rwt_backup(c: "Checker") -> None:
    """A tank with reuse set: the rule says whether a mains backup connection is required; if it is, a water service must be linked to the tank."""
    waters = [w for w in c.site.of("water_service") if w.status != "to_be_removed"]
    for r in c.site.of("rwt"):
        if r.status == "to_be_removed" or not any(G.flag(r, k, c.rd) for k in ("reuse_toilet", "reuse_laundry", "reuse_garden")):
            continue
        t = "RAINWATER TANK MAINS BACKUP CONNECTION"
        rule = rule_for(c, "rwt.mains_backup_required")
        linked = [w for w in waters if G.text(w, "rwt_id", c.rd) == r.id]
        if not rule.resolved:
            c.unresolved(r, "RWT_MAINS_BACKUP", t, [rule], why=f"{len(linked)} WATER SERVICE(S) LINKED")
        elif rule.value is True and not linked:
            c.add(r, "RWT_MAINS_BACKUP", t, FAIL, "THE RULE REQUIRES A MAINS BACKUP CONNECTION FOR REUSE BUT NO WATER SERVICE IS LINKED TO THIS TANK (SET rwt_id ON THE WATER SERVICE)", rules=[rule], severity="warning")
        elif rule.value is True:
            c.add(r, "RWT_MAINS_BACKUP", t, PASS, f"MAINS BACKUP CONNECTION REQUIRED AND PROVIDED BY {linked[0].id.upper()}", rules=[rule])
        else:
            c.add(r, "RWT_MAINS_BACKUP", t, PASS, "THE RULE DOES NOT REQUIRE A MAINS BACKUP CONNECTION", rules=[rule])


# ---------------------------------------------------------------------------------------------------------------------------------- zone of influence
def _object_geom(c: "Checker", o: SiteObject) -> BaseGeometry | None:
    if o.type == "tree":
        return Point(o.geometry.p[0], o.geometry.p[1]) if o.geometry.kind == "point" else None
    return G.footprint(o, c.rd)


def zone_half_width(offset: float, angle_deg: float, invert_depth: float, footing_depth: float) -> float:
    """Half width (m) of the zone of influence at the footing level: ``offset + (P - F) / tan(angle)``; the offset alone when the footing is at or below the invert."""
    drop = invert_depth - footing_depth
    return offset if drop <= 0 else offset + drop / math.tan(math.radians(angle_deg))


def zone_check(c: "Checker") -> None:
    sewers = [a for a in c._buried if a.kind == "sewer" and a.role in ("existing", "proposed")]
    objs = [o for o in c.site.objs if o.type in ZONE_TYPES and o.status != "to_be_removed" and _object_geom(c, o) is not None]
    if not sewers or not objs:
        return
    ra, ro = rule_for(c, "sewer.zone_of_influence.angle_deg"), rule_for(c, "sewer.zone_of_influence.offset_m")
    t = "ZONE OF INFLUENCE OF A SEWER"
    if not (ra.resolved and ro.resolved) or not (0 < (ra.value or 0) < 90):
        if ra.resolved and not 0 < ra.value < 90:
            c.add(None, "ZONE_OF_INFLUENCE", t, NOT_EVALUATED, f"NOT EVALUATED: THE ANGLE {ra.value} DEGREES IS OUT OF RANGE (MORE THAN 0 AND LESS THAN 90)", rules=[ra, ro])
        else:
            c.unresolved(None, "ZONE_OF_INFLUENCE", t, [ra, ro], why=f"{len(sewers)} SEWER(S) AND {len(objs)} OBJECT(S) COULD BE AFFECTED")
        return
    n = 0
    for sw in sewers:
        top, inv, why = sw.depth(*_mid(sw.geom))
        p_depth = sw.svc.invert_depth() if sw.svc is not None else inv
        if sw.role == "proposed":
            # a proposed drain: the deepest invert along it governs
            ds = [sw.depth(x, y)[1] for x, y in _samples(sw.geom)]
            ds = [d for d in ds if d is not None]
            p_depth = max(ds) if ds else None
        tol = sw.svc.tol_m if sw.svc is not None else 0.0
        own = G.text(sw.obj, "building_id", c.rd) if sw.obj.type == "sewer_drain" else None
        for o in objs:
            if own is not None and o.id == own:
                continue                                         # the building the drain leaves is not checked against its own drain (as in _object_clash and DRAIN_BUILDING_CLEARANCE)
            g = _object_geom(c, o)
            d = float(sw.geom.distance(g))      # type: ignore[arg-type]
            reach_ground = ro.value + ((p_depth or 0.0) / math.tan(math.radians(ra.value))) + (tol or 0.0)
            if p_depth is not None and d > reach_ground + 1e-9:
                continue                                         # outside the zone even for a footing at the surface
            if n >= MAX_CLASH_ENTRIES:
                c.notes.append(f"ZONE OF INFLUENCE ENTRIES ARE LISTED UP TO {MAX_CLASH_ENTRIES}; THE LIST IS INCOMPLETE")
                return
            n += 1
            suf = ":" + sw.obj.id
            F = G.num(o, "footing_depth_m", c.rd)
            if p_depth is None:
                reason = sw.svc.depth_issue() if sw.svc is not None else why
                c.add(o, "ZONE_OF_INFLUENCE", t, NOT_EVALUATED, f"NOT EVALUATED AGAINST {sw.name}: SEWER DEPTH NOT AVAILABLE ({reason or 'DEPTH DATA NOT AVAILABLE'})", rules=[ra, ro], suffix=suf)
            elif F is None:
                c.add(o, "ZONE_OF_INFLUENCE", t, NOT_EVALUATED, f"NOT EVALUATED AGAINST {sw.name}: THE FOOTING DEPTH OF THE {o.type.replace('_', ' ').upper()} IS NOT SET (ENTER footing_depth_m). IT IS {_f(d)} M FROM THE SEWER, INSIDE THE ZONE AT SURFACE LEVEL",
                      rules=[ra, ro], suffix=suf)
            else:
                w = zone_half_width(ro.value, ra.value, p_depth, F) + (tol or 0.0)
                inside = d < w - 1e-9
                if not inside and sw.role == "existing" and sw.svc is not None and sw.svc.tol_m is None:
                    c.add(o, "ZONE_OF_INFLUENCE", t, NOT_EVALUATED, f"NOT EVALUATED AGAINST {sw.name}: THE POSITIONAL TOLERANCE OF THE SEWER IS NOT SET. {_f(d)} M AWAY, ZONE HALF WIDTH {_f(w)} M WITHOUT TOLERANCE",
                          rules=[ra, ro], suffix=suf, value=round(d, 3), limit=round(w, 3), unit="m")
                else:
                    c.add(o, "ZONE_OF_INFLUENCE", t, FAIL if inside else PASS,
                          f"{_f(d)} M FROM {sw.name}; ZONE HALF WIDTH {_f(w)} M AT FOOTING DEPTH {_f(F)} M (SEWER INVERT {_f(p_depth)} M DEEP)" + (": THE FOOTING IS INSIDE THE ZONE OF INFLUENCE" if inside else ""),
                          rules=[ra, ro], value=round(d, 3), limit=round(w, 3), unit="m", suffix=suf, severity="blocking" if inside else "info")


def _mid(g: BaseGeometry) -> tuple[float, float]:
    p = g.interpolate(0.5, normalized=True) if g.geom_type == "LineString" else g
    return (p.x, p.y)


def _samples(g: BaseGeometry, step: float = ES.STATION_STEP_M) -> list[tuple[float, float]]:
    if g.geom_type != "LineString":
        return [_mid(g)]
    n = max(2, int(g.length / step) + 1)
    out = []
    for i in range(n + 1):
        p = g.interpolate(i / n, normalized=True)
        out.append((p.x, p.y))
    return out


# ---------------------------------------------------------------------------------------------------------------------------------- clash
def _required(c: "Checker", a: Buried, b: Buried) -> tuple[Rule | None, float | None, str]:
    """Horizontal separation required between two buried lines and the rule that gives it: the protected existing service's exclusion buffer; for two proposed lines
    the larger of the two kinds' clearances (no owner selector); when either kind's clearance is UNRESOLVED the separation is unknown (None)."""
    if a.role == "existing" or b.role == "existing":
        ex = a if a.role == "existing" else b
        r, total, why = SM.exclusion_buffer(ex.svc, c.rules)      # type: ignore[arg-type]
        c.keys_used.add(r.key)
        return r, total, why
    rs = [rule_for(c, "util.clearance_m", service=x.kind, dia_mm=None if x.dia_mm is None else int(round(x.dia_mm))) for x in (a, b) if x.kind]
    if not rs or not all(r.resolved for r in rs):          # one unresolved clearance leaves the required separation unknown: never judge on part of it
        bad = next((r for r in rs if not r.resolved), None)
        return (bad if bad is not None else None), None, (bad.ref if bad is not None else "THE SERVICE KIND IS NOT SET")
    r = max(rs, key=lambda r: r.value)
    return r, float(r.value), ""


def _clearance_labels(a: Buried, b: Buried) -> set[str]:
    """The unresolved ``util.clearance_m`` rows (by service kind and diameter) that two proposed lines need."""
    out = set()
    for x in (a, b):
        dn = "" if x.dia_mm is None else f", DN{int(round(x.dia_mm))}"
        out.add(f"util.clearance_m (SERVICE {(x.kind or 'NOT SET').upper()}{dn})")
    return out


def clash_check(c: "Checker") -> None:
    assets = c._buried
    if not assets:
        return
    n = 0
    unresolved_ex: dict[str, str] = {}
    n_pairs = n_crossings = 0
    unresolved_pp: dict[str, dict[str, Any]] = {}
    for i, a in enumerate(assets):
        for b in assets[i + 1:]:
            if a.role == "existing" and b.role == "existing":
                continue                       # two existing services are not the design's to move
            if a.geom.geom_type == "Point" and b.geom.geom_type == "Point":
                continue
            if connected(a, b):
                continue                       # one connected asset (links of a drain, a drain on its main): not a crossing and not a clearance clash
            n_pairs += 1
            r, need, why = _required(c, a, b)
            d = float(a.geom.distance(b.geom))
            if interiors_cross(a.geom, b.geom):
                n_crossings += 1
                _crossing(c, a, b, [r] if r is not None else [])
                n += 1
                continue
            if need is None:
                ex = a if a.role == "existing" else b if b.role == "existing" else None
                if ex is not None:
                    unresolved_ex[ex.obj.id] = why
                else:                          # two proposed lines and no resolved clearance: say so (never skip silently)
                    miss = unresolved_pp.setdefault(a.obj.id, {"n": 0, "what": set()})
                    miss["n"] += 1
                    miss["what"].update(_clearance_labels(a, b))
                continue
            if d < need - 1e-9:
                if n < MAX_CLASH_ENTRIES:
                    n += 1
                    c.add(a.obj, "CLASH_HORIZONTAL", "HORIZONTAL CLEARANCE BETWEEN SERVICES", FAIL, f"{a.name} IS {_f(d)} M FROM {b.name}; THE REQUIRED CLEARANCE IS {_f(need)} M", rules=[r] if r is not None else None,
                          value=round(d, 3), limit=round(need, 3), unit="m", suffix=":" + b.obj.id, severity="blocking")
    for oid, why in unresolved_ex.items():
        o = c.site.by_id[oid]
        c.add(o, "CLASH_HORIZONTAL", "HORIZONTAL CLEARANCE BETWEEN SERVICES", NOT_EVALUATED, f"NOT EVALUATED: THE EXCLUSION BUFFER IS UNRESOLVED ({why}), SO CLEARANCES TO OTHER SERVICES CANNOT BE CHECKED", suffix=":buffer")
    for oid, miss in unresolved_pp.items():
        o = c.site.by_id[oid]
        keys = ", ".join(sorted(miss["what"]))
        c.add(o, "CLASH_HORIZONTAL", "HORIZONTAL CLEARANCE BETWEEN SERVICES", NOT_EVALUATED,
              f"NOT EVALUATED: THE CLEARANCE BETWEEN {_nm(o)} AND {miss['n']} OTHER PROPOSED LINE(S) CANNOT BE CHECKED. UNRESOLVED REQUIREMENT(S): {keys}",
              rules=[Rule("util.clearance_m", None, "m", "UNRESOLVED", keys)], suffix=":clearance")
    _object_clash(c, assets)
    c.notes.append(f"SERVICE CLASH CHECKS COMPARED {n_pairs} SERVICE PAIR(S) AND FOUND {n_crossings} CROSSING(S) IN PLAN")
    if n >= MAX_CLASH_ENTRIES:
        c.notes.append(f"SERVICE CLASH ENTRIES ARE LISTED UP TO {MAX_CLASH_ENTRIES}; THE LIST IS INCOMPLETE")


def _crossing(c: "Checker", a: Buried, b: Buried, base_rules: list[Rule]) -> None:
    t = "VERTICAL CROSSING OF SERVICES"
    ex = a if a.role == "existing" else b if b.role == "existing" else None
    sel = {"service": ex.kind, "authority": ex.owner} if ex is not None else {"service": a.kind}
    rv = rule_for(c, "util.min_vertical_clearance_m", **sel) if (ex is None or (ex.kind and ex.owner)) else Rule("util.min_vertical_clearance_m", None, "m", "UNRESOLVED", "THE SERVICE KIND OR ASSET OWNER IS NOT SET")
    for p in crossing_points(a.geom, b.geom):
        at = f"AT {_f(p.x, 1)}, {_f(p.y, 1)}"
        ta, ba, wa = a.depth(p.x, p.y)
        tb, bb, wb = b.depth(p.x, p.y)
        suf = f":{b.obj.id}"
        if None in (ta, ba, tb, bb):
            miss = [f"{x.name}: {w or 'DEPTH DATA NOT AVAILABLE'}" for x, vals, w in ((a, (ta, ba), wa), (b, (tb, bb), wb)) if None in vals]
            c.add(a.obj, "CLASH_CROSSING", t, NOT_EVALUATED, f"NOT EVALUATED: {a.name} CROSSES {b.name} {at} BUT DEPTH IS NOT AVAILABLE ({'; '.join(miss)})", rules=[rv], suffix=suf)
            continue
        gap = max(tb - ba, ta - bb)                       # type: ignore[operator]
        if gap < 0:
            c.add(a.obj, "CLASH_CROSSING", t, FAIL, f"{a.name} CROSSES {b.name} {at} WITH THE PIPES OVERLAPPING IN DEPTH BY {_f(-gap)} M", rules=[rv], value=round(gap, 3), unit="m", suffix=suf, severity="blocking")
        elif not rv.resolved:
            c.unresolved(a.obj, "CLASH_CROSSING", t, [rv], why=f"{a.name} CROSSES {b.name} {at} WITH {_f(gap)} M BETWEEN THEM", suffix=suf, value=round(gap, 3), unit="m")
        else:
            ok = gap >= rv.value - 1e-9
            c.add(a.obj, "CLASH_CROSSING", t, PASS if ok else FAIL, f"{a.name} CROSSES {b.name} {at} WITH {_f(gap)} M BETWEEN THEM; THE RULE REQUIRES AT LEAST {_f(rv.value)} M",
                  rules=[rv], value=round(gap, 3), limit=rv.value, unit="m", suffix=suf)


def _object_clash(c: "Checker", assets: list[Buried]) -> None:
    objs = [o for o in c.site.objs if o.type in ZONE_TYPES and o.type != "tree" and o.status != "to_be_removed" and G.footprint(o, c.rd) is not None]
    if not objs:
        return
    rb = rule_for(c, "sewer.min_clearance_to_building_m")
    n = 0
    for a in assets:
        if a.kind is None and a.role == "existing":
            continue
        r, total, why = (None, None, "")
        if a.role == "existing":
            r, total, why = SM.exclusion_buffer(a.svc, c.rules)     # type: ignore[arg-type]
            c.keys_used.add(r.key)
        for o in objs:
            if a.role == "proposed" and a.obj.type == "sewer_drain" and o.id == G.text(a.obj, "building_id", c.rd):
                continue
            g = G.footprint(o, c.rd)
            d = float(a.geom.distance(g))      # type: ignore[arg-type]
            if a.role == "existing":
                if total is None:
                    continue
                if d < total - 1e-9 and n < MAX_CLASH_ENTRIES:
                    n += 1
                    built_over = a.geom.intersects(g)       # type: ignore[arg-type]
                    bo = rule_for(c, "util.build_over_allowed", service=a.kind, authority=a.owner) if built_over and a.kind and a.owner else None
                    if built_over and bo is not None and bo.resolved and bo.value is True:
                        c.add(o, "CLASH_OBJECT", "OBJECT CLEARANCE TO EXISTING SERVICES", ACTION, f"{_nm(o)} IS OVER {a.name}. THE RULE ALLOWS BUILDING OVER THIS SERVICE; THE ASSET OWNER'S APPROVAL IS STILL REQUIRED",
                              rules=[bo, r], suffix=":" + a.obj.id, severity="warning")
                    else:
                        c.add(o, "CLASH_OBJECT", "OBJECT CLEARANCE TO EXISTING SERVICES", FAIL, f"{_nm(o)} IS {_f(d)} M FROM {a.name}; THE EXCLUSION BUFFER IS {_f(total)} M" + (" AND THE OBJECT IS OVER THE SERVICE" if built_over else ""),
                              rules=[x for x in (r, bo) if x is not None], value=round(d, 3), limit=round(total, 3), unit="m", suffix=":" + a.obj.id, severity="blocking")
                    if built_over:
                        F = G.num(o, "footing_depth_m", c.rd)
                        td = a.depth(*_mid(a.geom))[0]
                        if F is None or td is None:
                            c.add(o, "CLASH_OBJECT_DEPTH", "OBJECT FOOTING AGAINST SERVICE DEPTH", NOT_EVALUATED, f"NOT EVALUATED: " + ("THE FOOTING DEPTH IS NOT SET" if F is None else f"{a.name}: DEPTH NOT AVAILABLE"), suffix=":" + a.obj.id)
            elif a.kind == "sewer" and o.type == "building":
                continue                       # proposed drains are checked to buildings in DRAIN_BUILDING_CLEARANCE
    if n >= MAX_CLASH_ENTRIES:
        c.notes.append(f"OBJECT CLASH ENTRIES ARE LISTED UP TO {MAX_CLASH_ENTRIES}; THE LIST IS INCOMPLETE")


def design_level(c: "Checker") -> None:
    inspection_check(c)
    rwt_backup(c)
    zone_check(c)
    clash_check(c)
