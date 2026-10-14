"""Rainwater tank sizing by daily mass balance (deterministic)."""
from __future__ import annotations

import math

from shapely import wkt
from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.agents.requirements.models import DIMENSIONLESS_UNITS, UnresolvedRequirement, to_item

from .buffers import PH_STAMP
from app.agents.requirements.models import UnresolvedItem

from .models import MonthTrace, PlaceholderUse, RwtInput, RwtRegime, RwtSizing, TankResult, default_regimes

DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def daily_rain(monthly_mm: list[float], wet_fraction: float = 0.3) -> list[tuple[int, float]]:
    """(month_index, mm) for 365 days. Each month's total is spread evenly over evenly spaced wet days."""
    out = []
    for m, (tot, nd) in enumerate(zip(monthly_mm, DAYS)):
        wet = max(1, round(nd * wet_fraction))
        wet_idx = {int((i + 0.5) * nd / wet) for i in range(wet)}
        per = tot / len(wet_idx)
        out += [(m, per if d in wet_idx else 0.0) for d in range(nd)]
    return out


def daily_demand(inp: RwtInput, month: int) -> float:
    d = inp.demand
    v = 0.0
    if d.use_toilet:
        v += d.occupants * d.toilet_l_pp_day
    if d.use_laundry:
        v += d.occupants * d.laundry_l_pp_day
    if d.use_garden:
        v += d.garden_area_m2 * d.garden_l_m2_day * d.garden_monthly_factor[month]
    return v


def simulate(inp: RwtInput, volume_l: float, years: int = 2) -> tuple[TankResult, list[MonthTrace]]:
    """Run `years` repeated years; report the last (warm-started, near steady state)."""
    rain = daily_rain(inp.rainfall.monthly_mm, inp.rainfall.wet_day_fraction)
    s = 0.0
    for y in range(years):
        s0, tin, tout, tov, tdem = s, 0.0, 0.0, 0.0, 0.0
        trace = [[0.0, 0.0, 0.0, 0.0, 0.0] for _ in range(12)]
        for m, mm in rain:
            inflow = max(0.0, mm - inp.first_flush_mm) * inp.roof_area_m2 * inp.runoff_coeff
            dem = daily_demand(inp, m)
            s += inflow
            ov = max(0.0, s - volume_l)
            s -= ov
            sup = min(dem, s)
            s -= sup
            tin += inflow; tout += sup; tov += ov; tdem += dem
            t = trace[m]; t[0] += inflow; t[1] += sup; t[2] += ov; t[3] += dem; t[4] = s
    tr = [MonthTrace(month=i + 1, inflow_l=t[0], supplied_l=t[1], overflow_l=t[2], demand_l=t[3], end_storage_l=t[4])
          for i, t in enumerate(trace)]
    rel = 100.0 * tout / tdem if tdem > 0 else 0.0
    return TankResult(volume_l=int(volume_l), reliability_pct=rel, annual_yield_l=tout, annual_demand_l=tdem,
                      annual_inflow_l=tin, annual_overflow_l=tov, storage_change_l=s - s0), tr


def tank_diameter(volume_l: float, height_m: float) -> float:
    d = math.sqrt(4 * (volume_l / 1000.0) / (math.pi * height_m))
    return math.ceil(d * 20) / 20


def place_tank(diameter_m: float, downpipe: tuple[float, float], lot: BaseGeometry, avoid: list[BaseGeometry],
               boundary_offset_m: float, step: float = 0.5) -> tuple[float, float] | None:
    inner = lot.buffer(-(boundary_offset_m + diameter_m / 2))
    if inner.is_empty:
        return None
    bad = unary_union(avoid) if avoid else None
    minx, miny, maxx, maxy = inner.bounds
    best, bd = None, 1e18
    x = minx
    while x <= maxx:
        y = miny
        while y <= maxy:
            p = Point(x, y)
            if inner.contains(p):
                d = math.dist((x, y), downpipe)
                if d < bd and (bad is None or not p.buffer(diameter_m / 2).intersects(bad)):
                    best, bd = (round(x, 3), round(y, 3)), d
            y += step
        x += step
    return best


# ---- the SA4 placeholder inputs, registered as requirement keys (stage 7) -----------------------------------------------------------------------------
# Each hard-coded default of ``RwtInput`` (and of its demand and rainfall blocks) is a PLACEHOLDER. The registered requirement key that replaces it is named
# here (``app.agents.requirements.models.SITE_OBJECT_KEY_HELP``; no key has a default). ``resolve_inputs`` uses a value the caller set (USER), else the cited
# requirement, else, only on the placeholder path, the old default WITH a stamp. A default is never used without a stamp and ``RwtSizing.placeholders`` lists it.
#   path: where the field is, key: the requirement key (None: a project input that is not a requirement), unit: shown on the stamp, kind: how the value is read
_INPUTS: tuple[tuple[tuple[str, ...], str | None, str, str], ...] = (
    (("runoff_coeff",), "rwt.runoff_coefficient", "", "num"),
    (("first_flush_mm",), "rwt.first_flush_mm", "mm", "num"),
    (("candidate_sizes_l",), "rwt.candidate_sizes_l", "L", "ints"),
    (("tank_height_m",), "rwt.tank_height_m", "m", "num"),
    (("boundary_offset_m",), "rwt.min_boundary_distance_m", "m", "num"),
    (("demand", "occupants"), "rwt.demand.occupants", "", "int"),
    (("demand", "toilet_l_pp_day"), "rwt.demand.toilet_l_pp_day", "L/person/day", "num"),
    (("demand", "laundry_l_pp_day"), "rwt.demand.laundry_l_pp_day", "L/person/day", "num"),
    (("demand", "garden_l_m2_day"), "rwt.demand.garden_l_m2_day", "L/m2/day", "num"),
    (("demand", "garden_monthly_factor"), "rwt.demand.garden_monthly_factor", "", "floats12"),
    (("rainfall", "wet_day_fraction"), "rwt.wet_day_fraction", "", "num"),
    (("demand", "garden_area_m2"), None, "m2", "num"),
    (("demand", "use_toilet"), None, "", "flag"),
    (("demand", "use_laundry"), None, "", "flag"),
    (("demand", "use_garden"), None, "", "flag"),
)


#: physical bounds of the numeric inputs: field path -> (lowest, highest, lowest included, highest included, unit). A value outside them (entered or cited) is refused
#: and the run is blocked; it is never used. These are the limits of what the mass balance can take (a coefficient is a fraction, a depth or a demand is not
#: negative, a height is above zero), not requirement values.
INPUT_RANGES: dict[str, tuple[float | None, float | None, bool, bool, str]] = {
    "runoff_coeff": (0.0, 1.0, True, True, ""), "first_flush_mm": (0.0, None, True, True, "MM"), "tank_height_m": (0.0, None, False, True, "M"),
    "boundary_offset_m": (0.0, None, True, True, "M"), "demand.occupants": (0.0, None, True, True, ""),
    "demand.toilet_l_pp_day": (0.0, None, True, True, "L/PERSON/DAY"), "demand.laundry_l_pp_day": (0.0, None, True, True, "L/PERSON/DAY"),
    "demand.garden_l_m2_day": (0.0, None, True, True, "L/M2/DAY"), "demand.garden_area_m2": (0.0, None, True, True, "M2"),
    "rainfall.wet_day_fraction": (0.0, 1.0, False, True, ""),
}


def range_problem(path: str, value) -> str | None:
    """Why ``value`` is refused for the input at ``path`` (a clear message), or None when it is inside its bounds. A list (the monthly factors) must be all not negative."""
    items = value if isinstance(value, list) else [value]
    if path == "demand.garden_monthly_factor":
        return None if all(isinstance(x, (int, float)) and math.isfinite(x) and x >= 0 for x in items) else f"{path.upper()}: EVERY MONTHLY FACTOR MUST BE A NUMBER NOT BELOW 0"
    r = INPUT_RANGES.get(path)
    if r is None or isinstance(value, (list, bool)):
        return None
    lo, hi, lo_in, hi_in, unit = r
    if isinstance(value, (int, float)) and math.isfinite(value) and (lo is None or (value >= lo if lo_in else value > lo)) and (hi is None or (value <= hi if hi_in else value < hi)):
        return None
    u = f" {unit}" if unit else ""
    need = (f"FROM {lo:g} TO {hi:g}{u}" if lo is not None and hi is not None else f"{'AT LEAST' if lo_in else 'ABOVE'} {lo:g}{u}" if lo is not None else f"{'AT MOST' if hi_in else 'BELOW'} {hi:g}{u}")
    return f"{path.upper()}: {value:g} IS NOT ALLOWED, IT MUST BE {need}"


def _holder(inp: RwtInput, path: tuple[str, ...]):
    return inp if len(path) == 1 else getattr(inp, path[0])


def _placeholder_value(inp: RwtInput, path: tuple[str, ...]):
    return getattr(_holder(inp, path), path[-1])


def _parse(req, kind: str, unit: str):
    """The value of a requirement row for an input, or an error text. The unit is not guessed: a row in another unit is refused."""
    v = req.value
    if isinstance(v, bool) and kind != "flag":
        return None, "THE VALUE IS TRUE OR FALSE, A NUMBER IS NEEDED"
    ru = (req.unit or "").strip()
    if ru and ru != unit and not (unit == "" and ru.lower() in DIMENSIONLESS_UNITS):
        return None, f"THE UNIT {ru!r} IS NOT {unit or 'DIMENSIONLESS'}"
    try:
        if kind == "num":
            return float(v), None
        if kind == "int":
            f = float(v)
            return (int(f), None) if f == int(f) and f >= 0 else (None, "A WHOLE NUMBER IS NEEDED")
        if kind == "flag":
            return (v, None) if isinstance(v, bool) else (None, "TRUE OR FALSE IS NEEDED")
        items = [float(x) for x in ([v] if isinstance(v, (int, float)) else str(v).split(","))]
        if kind == "ints":
            return ([int(x) for x in items], None) if items and all(x > 0 and x == int(x) for x in items) else (None, "A LIST OF WHOLE VOLUMES ABOVE ZERO IS NEEDED")
        return (items, None) if len(items) == 12 else (None, "EXACTLY TWELVE NUMBERS ARE NEEDED")
    except (TypeError, ValueError):
        return None, "THE VALUE COULD NOT BE READ AS A NUMBER"


def _unused(inp: RwtInput, placement: bool) -> set[str]:
    """Inputs the run does not read: the boundary offset without a lot to place the tank in, and the demand of a use the caller switched off."""
    d, off = inp.demand, set()
    if not placement:
        off.add("boundary_offset_m")
    if "use_toilet" in d.model_fields_set and not d.use_toilet:
        off.add("demand.toilet_l_pp_day")
    if "use_laundry" in d.model_fields_set and not d.use_laundry:
        off.add("demand.laundry_l_pp_day")
    if ("use_toilet" in d.model_fields_set and not d.use_toilet) and ("use_laundry" in d.model_fields_set and not d.use_laundry):
        off.add("demand.occupants")
    if "use_garden" in d.model_fields_set and not d.use_garden:
        off.update({"demand.garden_l_m2_day", "demand.garden_monthly_factor", "demand.garden_area_m2"})
    return off


def resolve_inputs(inp: RwtInput, requirements, sel: dict, use_placeholders: bool, placement: bool = True) -> tuple[RwtInput, list[PlaceholderUse], list[UnresolvedItem], list[str], bool]:
    """(effective input, placeholders used, unresolved items, citations, blocked).

    A field the caller set explicitly is a USER value and is kept. Otherwise: with no requirement set (the legacy path) or with ``use_placeholders`` the old
    default is used and STAMPED; with a requirement set the cited row is used; a key the set cannot give is reported UNRESOLVED and the run is ``blocked``
    (nothing is sized) unless ``use_placeholders`` is on.
    """
    uses: list[PlaceholderUse] = []
    items: list[UnresolvedItem] = []
    cites: list[str] = []
    blocked = False
    upd: dict = {"demand": {}, "rainfall": {}}
    off = _unused(inp, placement)
    for path, key, unit, kind in _INPUTS:
        if ".".join(path) in off:
            continue                                                                     # not read by this run: not needed, not stamped
        holder = _holder(inp, path)
        if path[-1] in holder.model_fields_set:                                          # entered by the caller: USER (still range checked)
            bad = range_problem(".".join(path), getattr(holder, path[-1]))
            if bad:
                items.append(UnresolvedItem(key=key or ".".join(path), selectors=dict(sel), prompt=bad))
                blocked = True
            continue
        ph = _placeholder_value(inp, path)
        if requirements is not None and key is not None:
            from app.agents.requirements.models import UnresolvedRequirement, to_item
            try:
                req = requirements.get_requirement(key, **sel)
            except UnresolvedRequirement as e:
                items.append(to_item(e))
            else:
                val, why = _parse(req, kind, unit)
                if why is None:
                    why = range_problem(".".join(path), val)
                if why is None:
                    cites.append(f"{key}={val}: {req.citation()}")
                    (upd if len(path) == 1 else upd[path[0]])[path[-1]] = val
                    continue
                items.append(UnresolvedItem(key=key, selectors=dict(sel), prompt=f"{key}: {why}"))
            if not use_placeholders:
                blocked = True
                continue
        uses.append(PlaceholderUse(key=key, field=".".join(path), value=ph if not isinstance(ph, list) else ", ".join(str(x) for x in ph), unit=unit))
    eff = inp.model_copy(update={**{k: v for k, v in upd.items() if k not in ("demand", "rainfall")}})
    if upd["demand"]:
        eff = eff.model_copy(update={"demand": eff.demand.model_copy(update=upd["demand"])})
    if upd["rainfall"]:
        eff = eff.model_copy(update={"rainfall": eff.rainfall.model_copy(update=upd["rainfall"])})
    return eff, uses, items, cites, blocked


def size_rwt(inp: RwtInput, *, regimes: dict[str, RwtRegime] | None = None, lot_wkt: str | None = None,
             envelope_wkt: str | None = None, slab_wkt: str | None = None, avoid_wkts: list[str] = (),
             outside_envelope: bool = True, requirements=None, use_placeholders: bool = False,
             selectors: dict | None = None) -> RwtSizing:
    """requirements=None => legacy placeholder regimes (stamped). With a RequirementSet the target/min volume come from
    cited requirements; unresolved ones are reported in `unresolved` and never defaulted (unless use_placeholders)."""
    sel, items, cites, msgs, placeholder = selectors or {}, [], [], [], False
    reg = inp.regime_override
    if reg is None and requirements is None:
        reg, placeholder = (regimes or default_regimes())[inp.regime], True
    elif reg is None:
        try:
            r = requirements.get_requirement("rwt.water_target_pct", **sel)
            reg = RwtRegime(name=inp.regime, target_reliability_pct=float(r.value), note=r.citation(),
                            verify_against_current_instrument=False)
            cites.append(f"rwt.water_target_pct={r.value}: {r.citation()}")
        except UnresolvedRequirement as e:
            items.append(to_item(e))
            if use_placeholders:
                reg, placeholder = (regimes or default_regimes())[inp.regime], True
    min_vol = None
    if requirements is not None:
        for k in ("rwt.min_tank_volume_l", "rwt.roof_connection_pct", "rwt.demand_connections"):
            try:
                r = requirements.get_requirement(k, **sel)
                cites.append(f"{k}={r.value}: {r.citation()}")
                if k == "rwt.min_tank_volume_l":
                    min_vol = float(r.value)
            except UnresolvedRequirement as e:
                items.append(to_item(e))
    # the other hard-coded inputs (runoff coefficient, first flush, demands, candidate sizes, tank height, wet day fraction, boundary offset): a value the
    # caller set, else the cited requirement, else a STAMPED placeholder. Nothing is used silently.
    inp, uses, in_items, in_cites, blocked = resolve_inputs(inp, requirements, sel, use_placeholders, placement=bool(lot_wkt))
    items += in_items
    cites += in_cites
    target_placeholder = placeholder
    placeholder = placeholder or bool(uses)
    if reg is None:
        msgs.append("Water target UNRESOLVED: no tank selected until the requirement is cited or user-entered.")
    elif target_placeholder:
        msgs.append(f"{PH_STAMP}: regime {reg.name} target {reg.target_reliability_pct}% is a placeholder.")
    else:
        msgs.append(f"Regime {reg.name}: target {reg.target_reliability_pct}% " + ("(user/override)" if not cites else "(cited)"))
    msgs.extend(u.text() for u in uses)
    if blocked:
        uses = []                                       # nothing is sized, so no placeholder was used
        placeholder = target_placeholder
        msgs = [m for m in msgs if not m.startswith(PH_STAMP + ": ") or "regime" in m]
        msgs.append("Inputs UNRESOLVED: nothing is sized until each is entered or cited.")
        return RwtSizing(regime=inp.regime, target_reliability_pct=reg.target_reliability_pct if reg else None, verify_against_current_instrument=True,
                         target_met=None, chosen=None, candidates=[], diameter_m=None, location_xy=None, monthly_trace=[], messages=msgs,
                         unresolved=items, citations=cites, placeholder=placeholder, placeholders=uses)
    cands = [simulate(inp, v)[0] for v in sorted(inp.candidate_sizes_l)]
    if reg is None:
        return RwtSizing(regime=inp.regime, target_reliability_pct=None, verify_against_current_instrument=True,
                         target_met=None, chosen=None, candidates=cands, diameter_m=None, location_xy=None,
                         monthly_trace=[], messages=msgs, unresolved=items, citations=cites, placeholders=uses, placeholder=placeholder)
    pool = [c for c in cands if min_vol is None or c.volume_l >= min_vol] or cands[-1:]
    ok = [c for c in pool if c.reliability_pct >= reg.target_reliability_pct]
    met = bool(ok)
    chosen = ok[0] if ok else pool[-1]
    if not met:
        msgs.append("No candidate tank reaches the target; largest candidate reported.")
    if inp.roof_area_m2 <= 0:
        msgs.append("Zero connected roof area: no yield.")
    _, trace = simulate(inp, chosen.volume_l)
    dia = tank_diameter(chosen.volume_l, inp.tank_height_m)
    loc = None
    if lot_wkt:
        lot = wkt.loads(lot_wkt)
        base = [wkt.loads(w).buffer(0.3) for w in ([slab_wkt] if slab_wkt else []) + list(avoid_wkts)]
        dp = inp.downpipe_xy or ((wkt.loads(slab_wkt).centroid.coords[0]) if slab_wkt else lot.centroid.coords[0])
        env = [wkt.loads(envelope_wkt)] if (envelope_wkt and outside_envelope) else []
        loc = place_tank(dia, dp, lot, base + env, inp.boundary_offset_m)
        if loc is None and env:
            loc = place_tank(dia, dp, lot, base, inp.boundary_offset_m)
            msgs.append("No tank position outside the building envelope; placed inside it - check planning controls.")
        if loc is None:
            msgs.append("No clear tank position found; place manually.")
    return RwtSizing(regime=reg.name, target_reliability_pct=reg.target_reliability_pct,
                     verify_against_current_instrument=reg.verify_against_current_instrument or placeholder, target_met=met,
                     chosen=chosen, candidates=cands, diameter_m=dia, location_xy=loc, monthly_trace=trace, messages=msgs, unresolved=items, citations=cites,
                     placeholder=placeholder, placeholders=uses)
