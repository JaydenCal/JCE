"""Shared builders for the stage 6 tests: a real scene bundle (made by the SA6 builder) over a synthetic terrain, and requirement sets."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import numpy as np

from app.agents.requirements.models import Requirement, RequirementSet, Selectors, Source
from app.agents.sa6_site3d import build_scene, dumps
from app.agents.sa6_site3d import sample as S
from app.agents.sa6_site3d.models import TerrainProvenanceIn, TinArrays
from app.design.site_rules import SiteRules

E0, N0 = S.E0, S.N0                      # the sample lot: 18 m wide (x) by 34 m deep (y), front boundary on y = 0 (local), origin at its south west corner
W, D = S.W, S.D
STATUS = "INDICATIVE 5 m DEM, LIDAR PENDING, NOT SURVEY"
PLANAR = lambda x, y: 100.0 + 0.06 * y + 0.01 * x          # noqa: E731  (local metres; rises 6 percent towards the back of the lot, 1 percent to the east)


def tin_over(z: Callable[[np.ndarray, np.ndarray], np.ndarray], x0: float, x1: float, y0: float, y1: float, step: float) -> TinArrays:
    xs, ys = np.arange(x0, x1 + 1e-9, step), np.arange(y0, y1 + 1e-9, step)
    X, Y = np.meshgrid(xs, ys)
    V = np.c_[X.ravel() + E0, Y.ravel() + N0, z(X.ravel(), Y.ravel())]
    nx = X.shape[1]
    F = [t for j in range(X.shape[0] - 1) for i in range(nx - 1)
         for t in ((j * nx + i, j * nx + i + 1, (j + 1) * nx + i), (j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i))]
    return TinArrays(vertices=[tuple(map(float, v)) for v in V], triangles=F)


def request(z=PLANAR, step=2.0, verge=4.0, status=STATUS, extent=(-8.0, W + 8.0, -8.0, D + 8.0), **opts):
    """A SceneRequest over the sample lot with only the existing ground, the lot, the road and the assumed kerb line."""
    r = S.sample_request()
    return r.model_copy(update=dict(
        existing_tin=tin_over(z, *extent, step), design_tin=None, cut_fill=None, walls=[], driveway=None, services=[], pits=[], rwt=None, buildings=[],
        council_overlays=[], items=[], ffl=None, terrain_provenance=TerrainProvenanceIn(status=status) if status else None,
        options=r.options.model_copy(update=dict(verge_depth_m=verge, max_total_triangles=200000, max_triangles_per_mesh=200000, **opts))))


def bundle(**kw) -> dict:
    return json.loads(dumps(build_scene(request(**kw))))


def write_bundle(base: Path, project_id, b: dict) -> Path:
    d = base / str(project_id)
    d.mkdir(parents=True, exist_ok=True)
    p = d / "scene_bundle.json"
    p.write_text(json.dumps(b))
    return p


def req(key: str, value: float, unit: str, lga: str | None = "Testshire", jurisdiction: str = "NSW") -> Requirement:
    return Requirement(key=key, applies_to=Selectors(jurisdiction=jurisdiction, lga=lga), value=value, unit=unit, status="resolved", extraction_method="table", confidence=1.0,
                       source=Source(document_title="Test Engineering Standard", authority="Testshire Council", page=12, section_ref="4.2", quote=f"{key} {value} {unit}"))


def rules(*rows: Requirement, lga: str = "Testshire", jurisdiction: str = "NSW") -> SiteRules:
    return SiteRules(RequirementSet(requirements=list(rows), loaded=[Selectors(jurisdiction=jurisdiction, lga=lga)]), lga, jurisdiction)


def user(v) -> dict:
    return {"value": v, "basis": "user"}


def driveway(pts, **params) -> dict:
    """A driveway site object (as JSON) with the given MGA points (given relative to the sample lot origin) and user parameters."""
    return {"id": "drv1", "type": "driveway", "geometry": {"kind": "polyline", "pts": [[E0 + x, N0 + y] for x, y in pts]},
            "params": {k: (v if isinstance(v, dict) else user(v)) for k, v in params.items()}}
