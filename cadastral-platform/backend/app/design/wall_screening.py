"""Retaining wall SCREENING for a ``retaining_wall`` site object. SCREENING ONLY, NOT STRUCTURAL DESIGN.

REUSE. The maths is the SA3 routine ``sa3_terrain.walls.screen`` (Coulomb active pressure on a gravity wall of base width ratio times height: sliding and
overturning factors of safety). Nothing is re-implemented.

NO DEFAULTS. ``WallAssumptions`` carries defaults for the SA3 pipeline (soil 28 degrees, 18 kN per cubic metre, factors of safety 1.5 and 2.0, a 1.0 m
certification height). Those are NOT used here. Every value of the assumptions comes from the wall object (a value the user entered) or from a registered
requirement key (``object_keys``), and a wall with any of them UNRESOLVED is NOT EVALUATED and names the missing keys. The certification height and the height
limit of each wall type are rule keys as well: unresolved means NOT EVALUATED, never a built in number.

HEIGHT. The retained height of a segment is the larger of the two end heights, each the top RL minus the bottom RL of a vertex (``vertex_rls``). A wall without
per vertex levels uses its uniform ``height_m`` parameter. A segment with neither is NOT SET and is not screened. Groundwater is not modelled.
"""
from __future__ import annotations

import math
from typing import Any

from shapely.geometry import LineString

from app.agents.sa3_terrain.models import WallAssumptions
from app.agents.sa3_terrain.walls import screen

from .param_basis import MAX_ABS, NO_RULES, Reader
from .site_design import SiteObject
from .site_rules import UNRESOLVED, Rule, SiteRules

SCREENING_LABEL = "SCREENING ONLY, NOT STRUCTURAL DESIGN"
#: (WallAssumptions field, requirement key, parameter key a user may enter on the wall)
ASSUMPTION_KEYS: tuple[tuple[str, str, str], ...] = (
    ("phi_deg", "retaining.soil_friction_angle_deg", "soil_friction_angle_deg"),
    ("unit_weight_kn_m3", "retaining.soil_unit_weight_kn_m3", "soil_unit_weight_kn_m3"),
    ("wall_friction_ratio", "retaining.wall_friction_ratio", "wall_friction_ratio"),
    ("gravity_wall_width_ratio", "retaining.gravity_wall_width_ratio", "gravity_wall_width_ratio"),
    ("wall_unit_weight_kn_m3", "retaining.wall_unit_weight_kn_m3", "wall_unit_weight_kn_m3"),
    ("min_fs_sliding", "retaining.min_fs_sliding", "min_fs_sliding"),
    ("min_fs_overturning", "retaining.min_fs_overturning", "min_fs_overturning"),
    ("surcharge_kpa", "retaining.surcharge_kpa", "surcharge_kpa"),
)
#: physical bounds of each screening input: (lowest, highest, lowest included, highest included, unit). A value outside them is refused with a message, never used.
#: They are the limits of what the Coulomb screening can take (a friction angle of 0 to 60 degrees, a wall friction ratio of 0 to 1, strictly positive weights, base
#: width ratio and factors of safety, a surcharge that is not negative), not requirement values.
RANGES: dict[str, tuple[float | None, float | None, bool, bool, str]] = {
    "soil_friction_angle_deg": (0.0, 60.0, True, True, "DEG"),
    "soil_unit_weight_kn_m3": (0.0, None, False, True, "KN/M3"),
    "wall_friction_ratio": (0.0, 1.0, True, True, ""),
    "gravity_wall_width_ratio": (0.0, None, False, True, ""),
    "wall_unit_weight_kn_m3": (0.0, None, False, True, "KN/M3"),
    "min_fs_sliding": (0.0, None, False, True, ""),
    "min_fs_overturning": (0.0, None, False, True, ""),
    "surcharge_kpa": (0.0, None, True, True, "KPA"),
}
TYPE_MAX_KEYS = {"sleeper": "retaining.type_max_height_m.sleeper", "block": "retaining.type_max_height_m.block", "concrete": "retaining.type_max_height_m.concrete"}
KEY_CERT = "retaining.certification_height_m"


def range_problem(param_key: str, value: float) -> str | None:
    """Why ``value`` is refused for a screening input (a clear message), or None when it is inside its bounds."""
    lo, hi, lo_in, hi_in, unit = RANGES[param_key]
    ok = (lo is None or (value >= lo if lo_in else value > lo)) and (hi is None or (value <= hi if hi_in else value < hi))
    if ok:
        return None
    u = f" {unit}" if unit else ""
    if lo is not None and hi is not None:
        need = f"FROM {lo:g} TO {hi:g}{u}"
    elif lo is not None:
        need = f"{'AT LEAST' if lo_in else 'ABOVE'} {lo:g}{u}"
    else:
        need = f"{'AT MOST' if hi_in else 'BELOW'} {hi:g}{u}"
    return f"{param_key.upper()}: {value:g} IS NOT ALLOWED, IT MUST BE {need}"


def num_param(o: SiteObject, key: str, rd: Reader | None = None) -> float | None:
    """A numeric parameter that is set and whose basis is accepted (``param_basis``), else None."""
    return (rd or NO_RULES).num(o, key)


def resolve_value(o: SiteObject, rules: SiteRules, param_key: str, rule_key: str, rd: Reader | None = None) -> Rule:
    """A value entered on the object (basis USER, or an LGA RULE whose reference the server verifies), else the registered requirement, else UNRESOLVED
    (naming the key). The basis is the TRUE basis. A value that is refused (unverified reference, platform default, out of range) is UNRESOLVED with the reason; the
    requirement key is not used in its place. A requirement row that is out of range is refused the same way."""
    rd = rd or Reader(rules, {})
    unit = rules.get(rule_key).unit
    r = rd.read(o, param_key)
    if r.why:
        return Rule(rule_key, None, unit, UNRESOLVED, r.why)
    if r.ok:
        v = float(r.value) if isinstance(r.value, (int, float)) and not isinstance(r.value, bool) else None
        if v is None:
            return Rule(rule_key, None, unit, UNRESOLVED, f"{param_key.upper()}: A NUMBER IS NEEDED")
        bad = range_problem(param_key, v)
        if bad:
            if rd.refusals is not None:
                rd.refusals.setdefault(o.id, {})[param_key] = bad
            return Rule(rule_key, None, unit, UNRESOLVED, bad)
        return Rule(rule_key, v, unit, r.basis, r.ref, r.stamp)
    rule = rules.get(rule_key)
    if rule.resolved:
        bad = range_problem(param_key, float(rule.value))
        if bad:
            return Rule(rule_key, None, rule.unit, UNRESOLVED, f"THE REQUIREMENT {rule_key} IS REFUSED. {bad}")
    return rule


def resolve_assumptions(o: SiteObject, rules: SiteRules, rd: Reader | None = None) -> tuple[WallAssumptions | None, list[Rule], list[Rule]]:
    """(assumptions or None, rules used, rules unresolved). The assumptions object is built with EVERY field explicit, only when none is unresolved."""
    used: list[Rule] = []
    missing: list[Rule] = []
    vals: dict[str, float] = {}
    for fld, key, pkey in ASSUMPTION_KEYS:
        r = resolve_value(o, rules, pkey, key, rd)
        (used if r.resolved else missing).append(r)
        if r.resolved:
            vals[fld] = float(r.value)
    if missing:
        return None, used, missing
    a = WallAssumptions(**vals, groundwater="NOT MODELLED", note=f"{SCREENING_LABEL}. VALUES ARE FROM THE WALL AND THE REQUIREMENT KEYS LISTED; GROUNDWATER IS NOT MODELLED.")
    return a, used, []


def segment_heights(o: SiteObject, rd: Reader | None = None) -> list[dict[str, Any]]:
    """Per segment: plan length and retained height (None when NOT SET) with where the height came from."""
    pts = o.geometry.pts if o.geometry.kind == "polyline" else []
    rls = o.vertex_rls
    uniform = num_param(o, "height_m", rd)
    out = []
    for i in range(len(pts) - 1):
        L = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        h, src = None, "NOT SET"
        if rls is not None:
            ends = []
            for j in (i, i + 1):
                t, b = rls.top[j], rls.bottom[j]
                ends.append(t - b if t is not None and b is not None else None)
            if ends[0] is not None and ends[1] is not None:
                h, src = max(ends), "VERTEX LEVELS (TOP RL MINUS BOTTOM RL)"
        if h is None and uniform is not None and uniform > 0:
            h, src = uniform, "UNIFORM HEIGHT PARAMETER"
        if h is not None and not 0 < h <= MAX_ABS:
            h, src = None, "NOT SET (TOP RL IS NOT ABOVE BOTTOM RL, OR THE HEIGHT IS OUT OF RANGE)"
        out.append({"index": i, "length_m": L, "height_m": h, "height_source": src})
    return out


def screen_wall(o: SiteObject, rules: SiteRules, rd: Reader | None = None) -> dict[str, Any]:
    """The screening result of a wall. ``status`` is ``NOT EVALUATED`` (with ``missing``) unless every assumption and at least one segment height is known."""
    if o.type != "retaining_wall":
        raise ValueError("a retaining_wall object is needed")
    rd = rd or Reader(rules, {})
    segs = segment_heights(o, rd)
    a, used, missing = resolve_assumptions(o, rules, rd)
    base: dict[str, Any] = {"label": SCREENING_LABEL, "structural": False, "segments": [], "max_height_m": None, "notes": ["GROUNDWATER IS NOT MODELLED", "A GEOTECHNICAL AND STRUCTURAL ENGINEER MUST DESIGN AND CERTIFY"],
                            "used": [r.public() for r in used], "missing": [r.public() for r in missing]}
    heights = [s["height_m"] for s in segs if s["height_m"] is not None]
    base["max_height_m"] = max(heights) if heights else None
    if a is None:
        refused = "; ".join((rd.refusals or {}).get(o.id, {}).values())
        return {**base, "status": "NOT EVALUATED", "reason": "SCREENING ASSUMPTIONS UNRESOLVED: " + ", ".join(r.key for r in missing) + (f". {refused}" if refused else ""),
                "segments": [{**s, "ka": None, "active_force_kn_per_m": None, "fs_sliding": None, "fs_overturning": None, "screening_ok": None} for s in segs]}
    if not heights:
        return {**base, "status": "NOT EVALUATED", "reason": "RETAINED HEIGHT NOT SET: ENTER THE TOP AND BOTTOM RL OF EACH VERTEX, OR A HEIGHT",
                "segments": [{**s, "ka": None, "active_force_kn_per_m": None, "fs_sliding": None, "fs_overturning": None, "screening_ok": None} for s in segs]}
    out = []
    for s in segs:
        if s["height_m"] is None:
            out.append({**s, "ka": None, "active_force_kn_per_m": None, "fs_sliding": None, "fs_overturning": None, "screening_ok": None})
            continue
        try:
            ka, pa, fss, fso = screen(s["height_m"], a)
        except (ZeroDivisionError, ValueError, OverflowError):
            ka = pa = fss = fso = float("nan")
        if not all(math.isfinite(x) for x in (ka, pa, fss, fso)):
            out.append({**s, "ka": None, "active_force_kn_per_m": None, "fs_sliding": None, "fs_overturning": None, "screening_ok": None,
                        "error": "THE SCREENING COULD NOT BE COMPUTED FOR THIS SEGMENT (THE INPUTS GIVE NO FINITE RESULT)"})
            continue
        out.append({**s, "ka": ka, "active_force_kn_per_m": pa, "fs_sliding": fss, "fs_overturning": fso,
                    "screening_ok": bool(fss >= a.min_fs_sliding and fso >= a.min_fs_overturning)})
    done = [s for s in out if s["screening_ok"] is not None]
    return {**base, "status": "SCREENED", "segments": out, "all_ok": all(s["screening_ok"] for s in done), "unscreened_segments": len(out) - len(done),
            "reason": "", "limits": {"min_fs_sliding": a.min_fs_sliding, "min_fs_overturning": a.min_fs_overturning}}


def wall_length(o: SiteObject) -> float:
    return float(LineString([(p[0], p[1]) for p in o.geometry.pts]).length) if o.geometry.kind == "polyline" else 0.0


def certification(o: SiteObject, rules: SiteRules) -> tuple[Rule, float | None]:
    """(the certification height rule, the greatest retained height of the wall or None)."""
    hs = [s["height_m"] for s in segment_heights(o) if s["height_m"] is not None]
    return rules.get(KEY_CERT), (max(hs) if hs else None)


__all__ = ["SCREENING_LABEL", "screen_wall", "resolve_assumptions", "segment_heights", "certification", "TYPE_MAX_KEYS", "KEY_CERT", "UNRESOLVED"]
