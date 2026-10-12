"""Rainwater tank sizing by daily mass balance (deterministic)."""
from __future__ import annotations

import math

from shapely import wkt
from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.agents.requirements.models import UnresolvedRequirement, to_item

from .buffers import PH_STAMP
from .models import MonthTrace, RwtInput, RwtRegime, RwtSizing, TankResult, default_regimes

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
    if reg is None:
        msgs.append("Water target UNRESOLVED: no tank selected until the requirement is cited or user-entered.")
    elif placeholder:
        msgs.append(f"{PH_STAMP}: regime {reg.name} target {reg.target_reliability_pct}% is a placeholder.")
    else:
        msgs.append(f"Regime {reg.name}: target {reg.target_reliability_pct}% " + ("(user/override)" if not cites else "(cited)"))
    cands = [simulate(inp, v)[0] for v in sorted(inp.candidate_sizes_l)]
    if reg is None:
        return RwtSizing(regime=inp.regime, target_reliability_pct=None, verify_against_current_instrument=True,
                         target_met=None, chosen=None, candidates=cands, diameter_m=None, location_xy=None,
                         monthly_trace=[], messages=msgs, unresolved=items, citations=cites)
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
                     placeholder=placeholder)
