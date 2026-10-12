"""Adapter hooks: let run_site / the orchestrator choose SA1 and SA5 behaviour from a JurisdictionProfile."""
from __future__ import annotations

from typing import Callable

from app.agents.sa5_cad_dxf.model import CadRequestSa5

from .display import DisplaySpec
from .parcel import Sa1CustomParcel
from .profile import JurisdictionProfile


def sa1_for_profile(profile: JurisdictionProfile, builtin: Callable[[], object] | None = None):
    """profile.cadastre_source.kind == 'custom' -> Sa1CustomParcel; otherwise the built-in NSW/QLD SA1 factory."""
    if profile.cadastre_source.kind == "custom":
        return Sa1CustomParcel(profile)
    if builtin is None:
        raise ValueError("built-in SA1 factory required for NSW/QLD profiles")
    return builtin()


def cad_request_for_profile(req: CadRequestSa5, profile: JurisdictionProfile) -> CadRequestSa5:
    """Attach profile display (units/locale/paper/standards) to an SA5 request; geometry is untouched."""
    return req.model_copy(update={"display": DisplaySpec.from_profile(profile), "council_name": req.council_name or profile.council_label})


def normalize_sa2_rules(raw, profile: JurisdictionProfile):
    """--rules-json entries may use the profile's units (e.g. {"element": "front", "value_numeric": 25, "unit": "ft"}).
    Length/area units are converted by dimensional analysis to SA2's canonical m / m2; the as-typed entry is kept in the quote."""
    from .units import convert, dimension_of
    items = raw.get("rules", []) if isinstance(raw, dict) else raw
    out = []
    for r in items:
        r = dict(r)
        u = r.get("unit")
        if u and u not in ("m", "percent", "m2", "ratio", "count"):
            dim = dimension_of(u, profile.unit_context())
            canon = {"length": "m", "area": "m2"}.get(dim)
            if canon is None:
                raise ValueError(f"rule {r.get('element')}: unit {u!r} ({dim}) cannot be a setback/envelope value")
            typed = f"{r['value_numeric']:g} {u}"
            r["value_numeric"] = convert(float(r["value_numeric"]), u, canon, profile.unit_context())
            r["unit"] = canon
            r["quote"] = (r.get("quote") or "user_entered") + f" [entered as {typed}]"
        out.append(r)
    return out
