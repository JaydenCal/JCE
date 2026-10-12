"""Exclusion buffers = clearance (rule table) + positional tolerance."""
from __future__ import annotations

from shapely import wkt

from .models import Asset, AssetBuffer, ClearanceRule

PH_STAMP = "PLACEHOLDER, NOT A REQUIREMENT"
_PH = PH_STAMP + " - INDICATIVE PLACEHOLDER - replace with the owner-agency requirement (e.g. Sydney Water / Urban Utilities / Ausgrid / Energex)"


def default_clearance_rules() -> list[ClearanceRule]:
    r = lambda s, lo, hi, c: ClearanceRule(service=s, dia_min_mm=lo, dia_max_mm=hi, clearance_m=c, rule_source=_PH)  # noqa: E731
    return [r("sewer", 0, 300, 1.0), r("sewer", 301, None, 2.0), r("water", 0, 300, 1.0), r("water", 301, None, 1.5),
            r("stormwater", 0, 600, 1.0), r("stormwater", 601, None, 1.5), r("electricity", 0, None, 1.0),
            r("gas", 0, None, 1.0), r("telecom", 0, None, 0.5), r("other", 0, None, 1.0), r("*", 0, None, 1.0)]


def find_rule(asset_service: str, dia: int | None, rules: list[ClearanceRule]) -> ClearanceRule | None:
    d = dia or 0
    for pass_service in (asset_service, "*"):
        for r in rules:
            if r.service == pass_service and d >= r.dia_min_mm and (r.dia_max_mm is None or d <= r.dia_max_mm):
                return r
    return None


def clearance_for(asset_service: str, dia: int | None, rules: list[ClearanceRule]) -> ClearanceRule:
    return find_rule(asset_service, dia, rules) or ClearanceRule(service="*", clearance_m=1.0, rule_source=_PH)


def rules_from_requirements(assets: list[Asset], reqs, selectors: dict | None = None, use_placeholders: bool = False,
                            unresolved: list | None = None) -> list[ClearanceRule]:
    """One exact-diameter rule per asset from resolved `util.clearance_m`; unresolved -> reported, never defaulted
    (unless use_placeholders, which stamps the placeholder)."""
    from app.agents.requirements.models import UnresolvedRequirement, to_item
    out, seen = [], set()
    for a in assets:
        k = (a.service, a.diameter_mm)
        if k in seen:
            continue
        seen.add(k)
        lo, hi = (a.diameter_mm, a.diameter_mm) if a.diameter_mm is not None else (0, None)
        try:
            r = reqs.get_requirement("util.clearance_m", service=a.service, dia_mm=a.diameter_mm, **(selectors or {}))
            out.append(ClearanceRule(service=a.service, dia_min_mm=lo, dia_max_mm=hi, clearance_m=float(r.value),
                                     rule_source=r.citation(), placeholder=False))
        except UnresolvedRequirement as e:
            e.selectors = {**e.selectors, "service": a.service, "dia_mm": a.diameter_mm}
            if unresolved is not None:
                unresolved.append(to_item(e))
            if use_placeholders:
                out.append(ClearanceRule(service=a.service, dia_min_mm=lo, dia_max_mm=hi, clearance_m=1.0, rule_source=_PH))
    return out


def build_buffers(assets: list[Asset], rules: list[ClearanceRule] | None = None, strict: bool = False) -> list[AssetBuffer]:
    """strict: assets with no matching rule get NO buffer (their clearance is unresolved), never a default."""
    rules = rules if (rules or strict) else default_clearance_rules()
    out = []
    for a in assets:
        r = find_rule(a.service, a.diameter_mm, rules) if strict else clearance_for(a.service, a.diameter_mm, rules)
        if r is None:
            continue
        total = r.clearance_m + a.position_tolerance_m
        g = wkt.loads(a.geometry_wkt).buffer(total, cap_style="flat", join_style="mitre", mitre_limit=2.0)
        out.append(AssetBuffer(asset_id=a.asset_id, service=a.service, clearance_m=r.clearance_m,
                               tolerance_m=a.position_tolerance_m, total_m=total, rule_source=r.rule_source,
                               placeholder=r.placeholder, geometry_wkt=g.wkt))
    return out
