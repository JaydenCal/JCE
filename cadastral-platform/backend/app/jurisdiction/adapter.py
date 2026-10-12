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
