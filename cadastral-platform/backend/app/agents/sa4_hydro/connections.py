"""Proposed sewer / water connections with crossing & clearance checks (indicative, unverified)."""
from __future__ import annotations

import math

from shapely import wkt
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from .buffers import clearance_for, default_clearance_rules
from .models import Asset, Check, ClearanceRule, ProposedConnection

SEWER_GRADE_NOTE = ("Minimum grade default 1.65% (1:60) for DN100 property drain per AS/NZS 3500.2 as indicative - "
                    "verify with the water authority and current code.")


def check_line(line: LineString, assets: list[Asset], rules: list[ClearanceRule] | None, target_id: str | None,
               cover_m: float | None, vertical_clearance_m: float = 0.3) -> list[Check]:
    rules = rules or default_clearance_rules()
    out: list[Check] = []
    for a in assets:
        if a.asset_id == target_id:
            continue
        g = wkt.loads(a.geometry_wkt)
        rule = clearance_for(a.service, a.diameter_mm, rules)
        if line.intersects(g):
            ang = _crossing_angle(line, g)
            msg = f"Proposed line crosses {a.service} {a.label or a.asset_id}"
            sev = "info"
            if ang is not None and ang < 45:
                msg += f" at a shallow {ang:.0f} deg (prefer near 90)"
                sev = "warning"
            if a.depth_m is None:
                msg += "; asset depth unknown - pothole before design"
                sev = "warning"
            elif cover_m is not None and abs(a.depth_m - cover_m) < vertical_clearance_m:
                msg += f"; vertical separation < {vertical_clearance_m} m (asset depth {a.depth_m} m vs proposed cover {cover_m} m)"
                sev = "warning"
            out.append(Check(asset_id=a.asset_id, service=a.service, kind="crossing", severity=sev, message=msg + "."))
        else:
            d = line.distance(g)
            if d < rule.clearance_m:
                out.append(Check(asset_id=a.asset_id, service=a.service, kind="clearance", severity="warning",
                                 message=f"Proposed line is {d:.2f} m from {a.service} {a.label or a.asset_id}, "
                                         f"below the {rule.clearance_m} m clearance ({'placeholder' if rule.placeholder else 'rule'})."))
            elif d < rule.clearance_m + a.position_tolerance_m:
                out.append(Check(asset_id=a.asset_id, service=a.service, kind="clearance", severity="info",
                                 message=f"Clearance to {a.service} {a.label or a.asset_id} is within its positional tolerance."))
    return out


def _crossing_angle(a: LineString, b) -> float | None:
    p = a.intersection(b)
    if p.is_empty or p.geom_type != "Point":
        return None
    def dirn(l: LineString) -> tuple[float, float]:
        d = l.project(p)
        q0, q1 = l.interpolate(max(0, d - 0.01)), l.interpolate(min(l.length, d + 0.01))
        return q1.x - q0.x, q1.y - q0.y
    bl = b if b.geom_type == "LineString" else None
    if bl is None:
        return None
    (ax, ay), (bx, by) = dirn(a), dirn(bl)
    n = math.hypot(ax, ay) * math.hypot(bx, by)
    if n == 0:
        return None
    ang = math.degrees(math.acos(max(-1, min(1, abs(ax * bx + ay * by) / n))))
    return ang


def _nearest(assets: list[Asset], service: str, pt: Point):
    best = None
    for a in assets:
        if a.service != service:
            continue
        g = wkt.loads(a.geometry_wkt)
        d = g.distance(pt)
        if best is None or d < best[0]:
            best = (d, a, nearest_points(g, pt)[0])
    return best


def propose_sewer(outlet: tuple[float, float], assets: list[Asset], *, junction: tuple[float, float] | None = None,
                  outlet_invert_m: float | None = None, main_invert_m: float | None = None, min_grade_pct: float = 1.65,
                  rules: list[ClearanceRule] | None = None, dia_mm: int = 100) -> ProposedConnection | None:
    o = Point(outlet)
    notes = [SEWER_GRADE_NOTE]
    target_id = None
    if junction is not None:
        t = Point(junction)
        notes.append("Connection to the supplied boundary junction point.")
    else:
        n = _nearest(assets, "sewer", o)
        if n is None:
            return None
        _, a, t = n
        target_id = a.asset_id
        notes.append(f"Connection to nearest sewer main {a.label or a.asset_id}; confirm junction/tapping point with the authority.")
    line = LineString([outlet, (t.x, t.y)])
    L = line.length
    grade = ok = fall = None
    if outlet_invert_m is not None and main_invert_m is not None and L > 0:
        grade = (outlet_invert_m - main_invert_m) / L * 100
        ok = grade >= min_grade_pct
    else:
        notes.append("Invert levels unknown: report required fall only.")
    fall = min_grade_pct * L / 100
    checks = check_line(line, assets, rules, target_id, None)
    if ok is False:
        checks.append(Check(asset_id=target_id or "", service="sewer", kind="grade", severity="blocking",
                            message=f"Available grade {grade:.2f}% < required {min_grade_pct}%."))
    return ProposedConnection(kind="sewer", geometry_wkt=line.wkt, start_xy=outlet, end_xy=(t.x, t.y), target_asset_id=target_id,
                              length_m=L, diameter_mm=dia_mm, grade_pct=grade, required_min_grade_pct=min_grade_pct,
                              required_fall_m=fall, grade_ok=ok, checks=checks, notes=notes)


def default_meter(lot_wkt: str, segments, inset_m: float = 0.5) -> tuple[float, float] | None:
    fronts = [s for s in segments if s.is_front]
    if not fronts:
        return None
    s = fronts[0]
    mx, my = (s.start_xy[0] + s.end_xy[0]) / 2, (s.start_xy[1] + s.end_xy[1]) / 2
    lot = wkt.loads(lot_wkt)
    # move toward the lot interior
    for sign in (1, -1):
        dx, dy = s.end_xy[0] - s.start_xy[0], s.end_xy[1] - s.start_xy[1]
        n = math.hypot(dx, dy) or 1
        p = (mx + sign * -dy / n * inset_m, my + sign * dx / n * inset_m)
        if lot.contains(Point(p)):
            return p
    return (mx, my)


def propose_water(meter: tuple[float, float], assets: list[Asset], *, dia_mm: int = 20, cover_m: float = 0.6,
                  rules: list[ClearanceRule] | None = None) -> ProposedConnection | None:
    n = _nearest(assets, "water", Point(meter))
    if n is None:
        return None
    _, a, t = n
    line = LineString([(t.x, t.y), meter])
    notes = [f"Cover {cover_m} m is an assumed placeholder - verify minimum cover with the water authority.",
             f"Service tapped from nearest water main {a.label or a.asset_id}; authority approval required."]
    return ProposedConnection(kind="water", geometry_wkt=line.wkt, start_xy=(t.x, t.y), end_xy=meter, target_asset_id=a.asset_id,
                              length_m=line.length, diameter_mm=dia_mm, cover_m=cover_m,
                              checks=check_line(line, assets, rules, a.asset_id, cover_m), notes=notes)
