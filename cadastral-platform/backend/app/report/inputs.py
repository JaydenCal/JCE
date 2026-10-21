"""Inputs to build_site_report. Everything beyond the SA9 results is optional; missing pieces are reported honestly."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.agents.sa9_constraints.intersect import LayerResult
from app.agents.sa9_constraints.triggers import TriggerResult

IMAGERY_FROM_ENV = "env"        # sentinel: resolve with app.imagery.provider_from_env (None disables aerials)


@dataclass
class SiteReportInputs:
    meta: dict                                   # lotplan, lga_name, jurisdiction, development_type, date, [zone_code, project_title,
                                                 #   area_m2, area_registered, mga_srid, flood_ffl_text, flags]
    results: list[LayerResult]
    triggers: list[TriggerResult]
    lot_wkt: str
    footprint_wkt: str | None = None
    srid: int = 7856
    neighbours: list[Any] = field(default_factory=list)        # NeighbourLot-like (label, wkt, is_road)
    segments: list[Any] = field(default_factory=list)          # BoundarySegment-like
    road_names: list[str] = field(default_factory=list)
    acknowledgements: list[str] = field(default_factory=list)
    requirements: list[dict] = field(default_factory=list)     # Requirement.model_dump() rows (cited)
    unresolved_requirements: list[dict] = field(default_factory=list)
    civil: dict | None = None                    # terrain / ffl / earthworks / driveway / services (see build._civil_page)
    pathway: Any = None                          # optional sa11 result (dict/model): headline, pathway, reasons, unresolved
    brand: Any = None                            # app.branding.Brand (default Brand.from_env())
    imagery: Any = IMAGERY_FROM_ENV              # ImageryProvider | None | IMAGERY_FROM_ENV
    generated_at: str | None = None
    zone_map: dict | None = None                 # app.report.maps.zone_map_from_sa1: zone polygons (MGA) and their source, for the land zoning map; None = no zone geometry
