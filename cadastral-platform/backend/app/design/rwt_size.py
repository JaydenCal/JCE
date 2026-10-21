"""The optional "size this tank" action for a rainwater tank object: the SA4 daily mass balance run on the tank's own inputs.

The action runs ONLY when every input resolves: a value entered on the tank (USER) or a registered requirement key (LGA or state rule). It never uses an SA4
placeholder. When any input is UNRESOLVED nothing is sized and the response lists each unresolved input with its key (``status`` UNRESOLVED), including an input the SA4 routine
would only have filled with a stamped placeholder. A value on the tank is read by its basis (``param_basis``): USER, or an LGA RULE whose reference the server verifies; the
true basis of each value used is echoed in ``entered``. A value outside its physical bounds (``sa4_hydro.rwt.INPUT_RANGES``) is refused with a message. The monthly rainfall
has no data source in the platform yet, so the user enters the twelve monthly totals (mm) and the station name; they are echoed back with basis USER.
"""
from __future__ import annotations

import math
from typing import Any

from app.agents.requirements.models import RequirementSet
from app.agents.sa4_hydro.models import RainfallTable, RwtDemand, RwtInput, RwtRegime
from app.agents.sa4_hydro.rwt import range_problem, size_rwt

from . import object_geometry as G
from .param_basis import Reader
from .site_design import SiteObject
from .site_rules import SiteRules

#: (RwtInput path, parameter key on the tank, kind)
_PARAMS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("runoff_coeff",), "runoff_coefficient", "num"), (("first_flush_mm",), "first_flush_mm", "num"), (("tank_height_m",), "tank_height_m", "num"),
    (("demand", "occupants"), "occupants", "int"), (("demand", "toilet_l_pp_day"), "toilet_l_pp_day", "num"), (("demand", "laundry_l_pp_day"), "laundry_l_pp_day", "num"),
    (("demand", "garden_l_m2_day"), "garden_l_m2_day", "num"), (("demand", "garden_area_m2"), "garden_area_m2", "num"),
)
_FLAGS = (("use_toilet", "reuse_toilet"), ("use_laundry", "reuse_laundry"), ("use_garden", "reuse_garden"))


def _rainfall(monthly: list[float] | None, station: str | None) -> tuple[list[float] | None, str | None]:
    if monthly is None or len(monthly) != 12 or not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0 for x in monthly):
        return None, "MONTHLY RAINFALL: ENTER TWELVE NON NEGATIVE TOTALS IN MM (NO RAINFALL DATA SOURCE IS LOADED)"
    if not station or not station.strip():
        return None, "RAINFALL STATION: ENTER THE STATION NAME OR NUMBER THE TOTALS CAME FROM"
    return [float(x) for x in monthly], None


def size_tank(tank: SiteObject, building: SiteObject | None, rules: SiteRules, monthly_rainfall_mm: list[float] | None, station: str | None,
              candidate_sizes_l: list[int] | None = None, garden_monthly_factor: list[float] | None = None) -> dict[str, Any]:
    """Run the SA4 sizing for ``tank``. Returns ``status`` SIZED, UNRESOLVED (``missing`` lists what is needed) or NOT EVALUATED."""
    if tank.type != "rwt":
        raise ValueError("a rwt object is needed")
    refusals: dict[str, dict[str, str]] = {}
    rd = Reader(rules, refusals)
    missing: list[dict[str, str]] = []
    note = lambda what, why: missing.append({"input": what, "why": why})   # noqa: E731
    entered: list[dict[str, Any]] = []
    roof = G.pos(tank, "connected_roof_area_m2", rd)
    if roof is None:
        note("connected_roof_area_m2", refusals.get(tank.id, {}).get("connected_roof_area_m2") or "CONNECTED ROOF AREA NOT SET (LINK A BUILDING OR ENTER THE AREA ON THE TANK)")
    elif building is not None:
        plan = G.pos(building, "roof_plan_area_m2", rd)
        if plan is not None and roof > plan + 1e-9:
            note("connected_roof_area_m2", "THE CONNECTED ROOF AREA EXCEEDS THE ROOF AREA OF THE LINKED BUILDING")
    rain, why = _rainfall(monthly_rainfall_mm, station)
    if why:
        note("rainfall", why)
    flags = {}
    for field, param in _FLAGS:
        f = G.flag(tank, param, rd)
        if f is None:
            note(param, refusals.get(tank.id, {}).get(param) or "NOT SET: SAY WHICH USES THE TANK SUPPLIES (TRUE OR FALSE)")
        else:
            flags[field] = f
    demand_kw: dict[str, Any] = dict(flags)
    top_kw: dict[str, Any] = {}
    for path, param, kind in _PARAMS:
        r = rd.read(tank, param)
        if r.why:
            note(param, r.why)                       # a value that was refused is UNRESOLVED; the requirement key is not used in its place
            continue
        v = G.num(tank, param, rd)
        if v is None:
            continue
        if kind == "int":
            if v != int(v) or v < 0:
                note(param, "A WHOLE NUMBER IS NEEDED")
                continue
            v = int(v)
        bad = range_problem(".".join(path[-2:]) if path[0] == "demand" else path[-1], v)
        if bad:
            note(param, bad)
            continue
        entered.append({"input": param, "value": v, "basis": r.basis, "ref": r.ref})
        (demand_kw if path[0] == "demand" else top_kw)[path[-1]] = v
    if candidate_sizes_l is not None:
        if candidate_sizes_l and all(isinstance(x, int) and not isinstance(x, bool) and x > 0 for x in candidate_sizes_l):
            top_kw["candidate_sizes_l"] = sorted(set(candidate_sizes_l))
        else:
            note("candidate_sizes_l", "A LIST OF WHOLE VOLUMES ABOVE ZERO IS NEEDED")
    if garden_monthly_factor is not None:
        if len(garden_monthly_factor) == 12 and all(isinstance(x, (int, float)) and math.isfinite(x) and x >= 0 for x in garden_monthly_factor):
            demand_kw["garden_monthly_factor"] = [float(x) for x in garden_monthly_factor]
        else:
            note("garden_monthly_factor", "EXACTLY TWELVE NON NEGATIVE NUMBERS ARE NEEDED")
    if missing and any(m["input"] in ("connected_roof_area_m2", "rainfall") or m["input"].startswith("reuse_") for m in missing):
        return _unresolved(missing, [], rules)
    wet = G.num(tank, "wet_day_fraction", rd)
    rt: dict[str, Any] = dict(station_id=station.strip(), monthly_mm=rain)    # type: ignore[union-attr]
    if wet is not None:
        if 0 < wet <= 1:
            rt["wet_day_fraction"] = wet
            entered.append({"input": "wet_day_fraction", "value": wet, "basis": rd.read(tank, "wet_day_fraction").basis, "ref": rd.read(tank, "wet_day_fraction").ref})
        else:
            note("wet_day_fraction", "MUST BE ABOVE 0 AND AT MOST 1")
    elif refusals.get(tank.id, {}).get("wet_day_fraction"):
        note("wet_day_fraction", refusals[tank.id]["wet_day_fraction"])
    target = G.num(tank, "water_target_pct", rd)
    if target is not None and not 0 <= target <= 100:
        note("water_target_pct", "WATER_TARGET_PCT: MUST BE FROM 0 TO 100 PERCENT")
        target = None
    elif target is None and refusals.get(tank.id, {}).get("water_target_pct"):
        note("water_target_pct", refusals[tank.id]["water_target_pct"])
    reg = RwtRegime(name="COUNCIL_OVERRIDE", target_reliability_pct=target, note="ENTERED ON THE TANK", verify_against_current_instrument=False) if target is not None else None
    inp = RwtInput(roof_area_m2=roof, rainfall=RainfallTable(**rt), demand=RwtDemand(**demand_kw), regime_override=reg, **top_kw)    # type: ignore[arg-type]
    reqs = rules.requirements if rules.requirements is not None else RequirementSet()
    res = size_rwt(inp, requirements=reqs, selectors=rules.selectors, use_placeholders=False)
    # a requirement that the sizing needs and the set could not give blocks the run; the optional keys (minimum volume, roof connection) do not
    blocking = {"rwt.water_target_pct", *[k for _, k, _, _ in _input_keys()]}
    unres = [{"input": u.key, "why": u.prompt} for u in res.unresolved if u.key in blocking]
    # a placeholder the routine would have used is an input that is still unresolved: list each one (never sized from it)
    ph = [{"input": p.key or p.field, "why": f"NOT ENTERED ON THE TANK AND {'NO REQUIREMENT KEY RESOLVES IT (' + p.key + ')' if p.key else 'IT IS NOT A REQUIREMENT'}: ENTER A VALUE ({p.field})"} for p in res.placeholders]
    if missing or unres or ph or res.chosen is None:
        return _unresolved(missing + unres + [x for x in ph if x["input"] not in {m["input"] for m in unres}], [u.model_dump() for u in res.placeholders], rules, res)
    return {"status": "SIZED", "label": "MASS BALANCE SIZING, NOT A COMPLIANCE ASSESSMENT", "target_reliability_pct": res.target_reliability_pct, "target_met": res.target_met,
            "chosen": res.chosen.model_dump(), "candidates": [c.model_dump() for c in res.candidates], "diameter_m": res.diameter_m,
            "monthly_trace": [m.model_dump() for m in res.monthly_trace], "citations": res.citations, "messages": res.messages,
            "inputs": {"roof_area_m2": roof, "rainfall_station": station, "rainfall_basis": "USER", "rainfall_monthly_mm": rain}, "entered": entered,
            "optional_unresolved": [{"input": u.key, "why": u.prompt} for u in res.unresolved if u.key not in blocking], "placeholders": []}


def _input_keys():
    from app.agents.sa4_hydro.rwt import _INPUTS
    return _INPUTS


def _unresolved(missing: list[dict[str, str]], placeholders: list[dict[str, Any]], rules: SiteRules, res: Any = None) -> dict[str, Any]:
    return {"status": "UNRESOLVED", "label": "NOT SIZED: INPUTS UNRESOLVED", "missing": missing, "placeholders": placeholders,
            "message": "NOT SIZED. ENTER EACH VALUE ON THE TANK OR LOAD THE REQUIREMENT: " + "; ".join(m["input"] for m in missing) if missing else "NOT SIZED"}
