"""Exclusion buffers = clearance (rule table) + positional tolerance."""
from __future__ import annotations

from shapely import wkt

from .models import Asset, AssetBuffer, ClearanceRule

_PH = "INDICATIVE PLACEHOLDER - replace with the owner-agency requirement (e.g. Sydney Water / Urban Utilities / Ausgrid / Energex)"


def default_clearance_rules() -> list[ClearanceRule]:
    r = lambda s, lo, hi, c: ClearanceRule(service=s, dia_min_mm=lo, dia_max_mm=hi, clearance_m=c, rule_source=_PH)  # noqa: E731
    return [r("sewer", 0, 300, 1.0), r("sewer", 301, None, 2.0), r("water", 0, 300, 1.0), r("water", 301, None, 1.5),
            r("stormwater", 0, 600, 1.0), r("stormwater", 601, None, 1.5), r("electricity", 0, None, 1.0),
            r("gas", 0, None, 1.0), r("telecom", 0, None, 0.5), r("other", 0, None, 1.0), r("*", 0, None, 1.0)]


def clearance_for(asset_service: str, dia: int | None, rules: list[ClearanceRule]) -> ClearanceRule:
    d = dia or 0
    for pass_service in (asset_service, "*"):
        for r in rules:
            if r.service == pass_service and d >= r.dia_min_mm and (r.dia_max_mm is None or d <= r.dia_max_mm):
                return r
    return ClearanceRule(service="*", clearance_m=1.0, rule_source=_PH)


def build_buffers(assets: list[Asset], rules: list[ClearanceRule] | None = None) -> list[AssetBuffer]:
    rules = rules or default_clearance_rules()
    out = []
    for a in assets:
        r = clearance_for(a.service, a.diameter_mm, rules)
        total = r.clearance_m + a.position_tolerance_m
        g = wkt.loads(a.geometry_wkt).buffer(total, cap_style="flat", join_style="mitre", mitre_limit=2.0)
        out.append(AssetBuffer(asset_id=a.asset_id, service=a.service, clearance_m=r.clearance_m,
                               tolerance_m=a.position_tolerance_m, total_m=total, rule_source=r.rule_source,
                               placeholder=r.placeholder, geometry_wkt=g.wkt))
    return out
