"""Build PathwayInput fields from SA9 constraints_report.json (+ lot facts). Only maps what the layers legitimately say."""
from __future__ import annotations

from typing import Any

from .models import DevType, PathwayInput


def _layer(report: dict, key: str) -> dict | None:
    return next((l for l in report.get("layers", []) if l["key"] == key), None)


def _flag(report: dict, key: str) -> bool | None:
    l = _layer(report, key)
    if l is None or l["status"] == "not_checked" or l.get("error"):
        return None
    return True if l["status"] == "affected" else False if l["status"] == "not_affected" else None


def constraints_to_fields(report: dict) -> tuple[dict[str, Any], dict[str, str]]:
    """Returns (fields, provenance). not_checked layers stay None (UNRESOLVED)."""
    f: dict[str, Any] = {}
    prov: dict[str, str] = {}
    def setf(name: str, val: Any, layer: str) -> None:
        if val is not None:
            f[name] = val; prov[name] = f"SA9 {layer} ({report.get('meta', {}).get('date', '')})"
    setf("bushfire_prone", _flag(report, "nsw_bushfire"), "nsw_bushfire")
    setf("heritage_item", _flag(report, "nsw_heritage_item"), "nsw_heritage_item")
    setf("heritage_conservation_area", _flag(report, "nsw_heritage_conservation"), "nsw_heritage_conservation")
    setf("land_reserved_public_purpose", _flag(report, "nsw_land_reservation"), "nsw_land_reservation")
    fl = _flag(report, "nsw_flood")
    setf("flood_affected", fl, "nsw_flood")
    if fl:                      # not_affected is NOT used to assert 'not a flood control lot' (definition not obtained)
        setf("flood_control_lot", True, "nsw_flood")
    a = _layer(report, "nsw_acid_sulfate")
    if a and a["status"] == "not_affected":
        setf("acid_sulfate_class_1_or_2", False, "nsw_acid_sulfate")
    elif a and a["status"] == "affected":
        classes = [str(x.get("Class") or x.get("CLASS") or "") for x in a.get("attributes", [])]
        if classes and all(c for c in classes):
            setf("acid_sulfate_class_1_or_2", any(c.strip()[:1] in ("1", "2") for c in classes), "nsw_acid_sulfate")
    ls = _layer(report, "nsw_lot_size_map")
    if ls and ls["status"] == "affected":
        vals = {(x.get("LOT_SIZE"), x.get("UNITS")) for x in ls["attributes"] if x.get("LOT_SIZE") is not None}
        if len(vals) == 1:
            v, u = next(iter(vals)); m2 = v * 10000 if str(u).lower() == "ha" else v
            setf("lep_min_lot_size_m2", float(m2), "nsw_lot_size_map")
    return f, prov


def make_input(dev_type: str, report: dict | None, *, lga: str | None, zone: str | None, lot_area_m2: float | None, **extra: Any) -> PathwayInput:
    fields, prov = constraints_to_fields(report) if report else ({}, {})
    prov.update(extra.pop("provenance", {}))
    return PathwayInput(dev_type=DevType(dev_type), lga=lga, zone=zone, lot_area_m2=lot_area_m2, provenance=prov, **{**fields, **extra})
