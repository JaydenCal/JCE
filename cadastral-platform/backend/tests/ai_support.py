"""Shared builders for the stage 10 tests: a synthetic site (a building with exits, terrain, a verified sewer main and water main, fake rules). Every rule value is a FAKE
value written for the tests; none is an engineering value. Local coordinates are metres from the sample lot origin (see site_support): the lot is x 0 to 18 and y 0 to 34."""
from __future__ import annotations

from datetime import date

import site_support as H
from app.agents.requirements.models import Requirement, RequirementSet, Selectors, Source
from app.design.site_design import SiteDesign
from app.design.site_rules import SiteRules
from app.design.terrain_source import terrain_from_bundle

E0, N0 = H.E0, H.N0
TODAY = date(2026, 10, 15)
SLOPE = lambda x, y: 100.0 + 0.05 * y + 0.0 * x           # noqa: E731


def at(x, y):
    return [E0 + x, N0 + y]


def P(v, ref=None):
    return {"value": v, "basis": "user", **({"ref": ref} if ref else {})}


def rq(key: str, value, unit: str, **sel) -> Requirement:
    return Requirement(key=key, applies_to=Selectors(jurisdiction="NSW", lga="Testshire", **sel), value=value, unit=unit, status="resolved", extraction_method="table", confidence=1.0,
                       source=Source(document_title="Test Standard", authority="Testshire Council", page=1, section_ref="1", quote=f"{key} {value}"))


def rules(*rows: Requirement) -> SiteRules:
    return SiteRules(RequirementSet(requirements=list(rows), loaded=[Selectors(jurisdiction="NSW", lga="Testshire")]), "Testshire", "NSW")


def fake_rules() -> SiteRules:
    return rules(rq("rwt.min_boundary_distance_m", 0.9, "m"), rq("sewer.inspection_opening_max_spacing_m", 30.0, "m"), rq("sewer.min_clearance_to_building_m", 1.0, "m"))


def line(id_, type_, pts, **params):
    return {"id": id_, "type": type_, "geometry": {"kind": "polyline", "pts": [at(*p) for p in pts]}, "params": {k: v if isinstance(v, dict) else P(v) for k, v in params.items()}}


def pt(id_, type_, x, y, **params):
    return {"id": id_, "type": type_, "geometry": {"kind": "point", "p": at(x, y)}, "params": {k: v if isinstance(v, dict) else P(v) for k, v in params.items()}}


def bld(id_="house", ring=((5, 10), (13, 10), (13, 20), (5, 20)), sewer=((9, 10),), water=((7, 10),), downpipes=((5, 12), (13, 12), (13, 18)), ffl=101.2):
    o = {"id": id_, "type": "building", "label": "House", "geometry": {"kind": "polygon", "ring": [at(*p) for p in ring]},
         "params": {"building_use": P("house"), **({"ffl_rl": P(ffl)} if ffl is not None else {})}}
    o["building"] = {"levels": [{"name": "GROUND", "elevation_m": 0.0, "rings": [[at(*p) for p in ring]]}], "frame": {"origin": at(0, 0)},
                     "exits": {"sewer": [at(*p) for p in sewer], "water": [at(*p) for p in water], "downpipes": [at(*p) for p in downpipes]}}
    return o


def svc(id_, kind, pts, owner="Hunter Water", verified=True, **params):
    base = {"service_kind": kind, "asset_owner": owner, "diameter_mm": 150, "depth_m": 2.5, "depth_basis": "potholed", "depth_reference": "invert", "position_tolerance_m": 0.3,
            "plan_date": "2026-09-01", "plan_expiry_date": "2026-12-01"}
    base.update(params)
    o = line(id_, "service_existing", pts, **{k: v for k, v in base.items() if v is not None})
    if verified:
        o["verified"], o["verified_on"] = True, "2026-09-05"
        o["params"]["verified_by"] = P("J Citizen")
    return o


def design(*objs) -> SiteDesign:
    return SiteDesign.model_validate({"schema": "site_design.v1", "version": 1, "objects": list(objs)})


def site_objects(**kw):
    """The synthetic site: a house with exits, a verified sewer main and water main in the street side of the lot."""
    return [bld(**kw), svc("sewer_main", "sewer", [(-2, 3), (20, 3)], diameter_mm=225), svc("water_main", "water", [(-2, 5), (20, 5)], diameter_mm=100)]


def terrain():
    return terrain_from_bundle(H.bundle(z=SLOPE, extent=(-10.0, 28.0, -10.0, 44.0)))
