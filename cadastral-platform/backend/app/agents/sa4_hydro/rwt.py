"""Rainwater tank sizing by daily mass balance (deterministic)."""
from __future__ import annotations

import math

from shapely import wkt
from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

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
             outside_envelope: bool = True) -> RwtSizing:
    reg = inp.regime_override or (regimes or default_regimes())[inp.regime]
    msgs = [f"Regime {reg.name}: target {reg.target_reliability_pct}% is a PLACEHOLDER - verify against the current instrument."
            if reg.verify_against_current_instrument else f"Regime {reg.name}"]
    cands = [simulate(inp, v)[0] for v in sorted(inp.candidate_sizes_l)]
    ok = [c for c in cands if c.reliability_pct >= reg.target_reliability_pct]
    met = bool(ok)
    chosen = ok[0] if ok else cands[-1]
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
                     verify_against_current_instrument=reg.verify_against_current_instrument, target_met=met,
                     chosen=chosen, candidates=cands, diameter_m=dia, location_xy=loc, monthly_trace=trace, messages=msgs)
