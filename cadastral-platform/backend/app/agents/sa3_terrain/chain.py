"""Terrain provider chain (stage 3, owner decision B, 15/10/2026): first available provider wins, every result carries provenance.

    1. SurveyProvider       user supplied survey or terrain file (existing ``ingest``)          status SURVEY (AS SUPPLIED)
    2. QldLidarProvider     QLD state LiDAR DEM (qld_lidar.py), only where LiDAR project coverage exists
    3. TileLibraryProvider  hosted NSW LiDAR 1 m tile library (tile_library.py)
    4. Nsw5mProvider        NSW 5 m DEM (live_levels.py)                                          status INDICATIVE 5 m DEM, LIDAR PENDING
    5. nothing              TERRAIN DATA NOT AVAILABLE

A provider returns a ``TerrainResult`` or raises ``ProviderSkip`` (not applicable / no coverage: an expected outcome) or any other
exception (a failure).  The chain never hides either: every attempt, with the reason, is stored in ``provenance.attempts`` and the notes
of the provider that finally wins carry the skip notes of the better providers above it (for example LIDAR PENDING).
All network access is behind injectable callables so tests use fakes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol

from app.common.labels import upper_label

from .provenance import (CAPTURE_DATE_NOT_STATED, NOT_STATED, OFFLINE_SOURCE, STATUS_NSW_5M, STATUS_SURVEY, TIER_NSW_5M, TIER_SURVEY,
                         TerrainProvenance, ddmmyyyy, mark_offline, none_provenance)

# Callables injected into providers (tests pass fakes; run_site builds them from its fetcher or from urllib).
QueryFn = Callable[[str, dict], dict]     # (url, params) -> parsed JSON
ExportFn = Callable[[str, dict], bytes]   # (url, params) -> raw bytes of the response


@dataclass
class TerrainRequest:
    boundary_wkt: str                      # lot boundary, MGA metres
    srid: int
    state: str | None = None               # 'NSW' | 'QLD' | None
    buffer_m: float = 30.0                 # levels are wanted this far beyond the lot (road, adjoining lots, aerial margin)
    survey: dict | None = None             # SurveyInput kwargs supplied by the user (params.terrain.survey)
    accuracy_m: float | None = None        # user-entered vertical accuracy for the 5 m DEM (otherwise flagged unknown)


@dataclass
class TerrainResult:
    points: list[tuple[float, float, float]]   # absolute MGA E, N and AHD z (what the 3D scene triangulates)
    provenance: TerrainProvenance
    survey: dict                               # kwargs for SurveyInput (SA3 earthworks)
    warnings: list[str] = field(default_factory=list)


class ProviderSkip(Exception):
    """The provider has nothing for this lot (not applicable, no coverage, not configured). ``note`` explains why."""

    def __init__(self, note: str, notable: bool = True):
        super().__init__(note)
        self.note = note
        self.notable = notable          # False: a plain "does not apply" outcome that is logged in the attempts but not repeated in the provenance notes


class TerrainProvider(Protocol):
    tier: int
    name: str

    def fetch(self, req: TerrainRequest) -> TerrainResult: ...


@dataclass
class ChainOutcome:
    result: TerrainResult | None
    provenance: TerrainProvenance
    attempts: list[dict]


def resolve_terrain(providers: list[TerrainProvider], req: TerrainRequest) -> ChainOutcome:
    attempts: list[dict] = []
    skipped_notes: list[str] = []
    for p in providers:
        try:
            r = p.fetch(req)
        except ProviderSkip as sk:
            attempts.append({"provider": p.name, "tier": p.tier, "outcome": "SKIPPED", "note": sk.note})
            if sk.notable:
                skipped_notes.append(sk.note)
            continue
        except Exception as ex:  # noqa: BLE001 - a failing provider must never stop the chain, but it is always recorded
            note = f"{type(ex).__name__}: {ex}"
            attempts.append({"provider": p.name, "tier": p.tier, "outcome": "ERROR", "note": note})
            skipped_notes.append(f"{p.name} FAILED: {note}")
            continue
        attempts.append({"provider": p.name, "tier": p.tier, "outcome": "USED", "note": r.provenance.status})
        r.provenance.attempts = attempts
        own = [n for n in r.provenance.notes if not any(k != n and k.startswith(n) for k in skipped_notes)]     # drop a plain copy of a longer skip note
        r.provenance.notes = [n for n in skipped_notes if n not in own] + own
        return ChainOutcome(r, r.provenance, attempts)
    prov = none_provenance(attempts)
    prov.notes += skipped_notes
    return ChainOutcome(None, prov, attempts)


# ---- tier 1: user supplied survey ---------------------------------------------------------------------------------------------
class SurveyProvider:
    tier, name = TIER_SURVEY, "User supplied survey"

    def fetch(self, req: TerrainRequest) -> TerrainResult:
        from app.agents.base import AgentError
        from .ingest import ingest
        from .models import SurveyInput
        if not req.survey:
            raise ProviderSkip("no user supplied survey or terrain file", notable=False)
        inp = SurveyInput.model_validate(req.survey)
        try:
            S = ingest(inp, req.srid)
        except AgentError as ex:
            raise RuntimeError(f"USER SUPPLIED SURVEY COULD NOT BE USED ({ex.error_code}: {ex.detail}); a lower tier was used instead") from ex
        pts = [tuple(map(float, r)) for r in S.points]
        for a in S.contours + S.breaklines:
            pts += [tuple(map(float, r)) for r in a]
        stated = "stated_vertical_accuracy_m" in inp.model_fields_set
        prov = TerrainProvenance(
            tier=TIER_SURVEY, status=STATUS_SURVEY, source_name=inp.source or "unspecified", url="", resolution_text=NOT_STATED,
            accuracy_text=(f"{inp.stated_vertical_accuracy_m:g} m (as supplied)" if stated else NOT_STATED),
            accuracy_m=inp.stated_vertical_accuracy_m if stated else None, licence="AS SUPPLIED BY THE USER", datum="AS SUPPLIED (NOT CHECKED)",
            points=len(pts), notes=["Survey levels are used as supplied and have not been checked by the platform."] + list(S.warnings))
        return TerrainResult(pts, prov, req.survey, list(S.warnings))


# ---- tier 4: NSW 5 m DEM ------------------------------------------------------------------------------------------------------
class Nsw5mProvider:
    tier, name = TIER_NSW_5M, "NSW 5 m DEM"

    def __init__(self, export=None, service: str | None = None):
        self.export, self.service = export, service

    def fetch(self, req: TerrainRequest) -> TerrainResult:
        from .live_levels import SERVICE, UNKNOWN_ACCURACY_PLACEHOLDER_M, fetch_levels
        if req.state not in (None, "NSW"):
            raise ProviderSkip(f"NSW 5 m DEM does not cover {req.state} lots", notable=False)
        kw: dict = {}
        if self.export is not None:
            kw["export"] = self.export
        lv = fetch_levels(req.boundary_wkt, req.srid, buffer_m=req.buffer_m, accuracy_m=req.accuracy_m, service=self.service or SERVICE, **kw)
        p = lv.provenance
        stated = req.accuracy_m is not None
        prov = TerrainProvenance(
            tier=TIER_NSW_5M, status=STATUS_NSW_5M, source_name="NSW_5M_Elevation ImageServer (NSW Spatial Services)", url=p["url"],
            resolution_m=5.0, effective_spacing_m=5.0 * max(1, int(p.get("stride") or 1)), resolution_text="5 m (stereo-derived DEM)", capture_date=None,
            accuracy_text=(f"{req.accuracy_m:g} m (user entered)" if stated else NOT_STATED), accuracy_m=req.accuracy_m if stated else None,
            licence=p["copyright"], datum=p["datum"], retrieved=ddmmyyyy(p["retrieved"]), points=p["points"],
            notes=[f"Vertical accuracy {'user entered' if stated else 'not stated by the service; ' + str(UNKNOWN_ACCURACY_PLACEHOLDER_M) + ' m placeholder used only so uncertainty is not understated'}."]
            + list(lv.warnings))
        pts = [tuple(map(float, q)) for q in lv.survey["points"]]
        return TerrainResult(pts, prov, lv.survey, list(lv.warnings))


# ---- label helpers used by the scene builder and run_site ---------------------------------------------------------------------
def mark_offline_outcome(out: ChainOutcome) -> ChainOutcome:
    """Offline fixture runs (run_site --offline): the winning result is labelled OFFLINE FIXTURE, NOT LIVE DATA in place of the live service name and URL."""
    if out.result is not None and out.provenance.tier != TIER_SURVEY:       # a user supplied survey is the user's own data, not the fixture
        mark_offline(out.provenance)
        out.result.survey["source"] = f"{OFFLINE_SOURCE} ({out.provenance.status})"
    return out


def terrain_note(prov: TerrainProvenance) -> str:
    """One line for SceneRequest.terrain_note."""
    return (f"{upper_label(prov.status)}; {prov.source_name or NOT_STATED}; resolution {prov.resolution_text}; capture {prov.capture_date or CAPTURE_DATE_NOT_STATED}; "
            f"vertical accuracy {prov.accuracy_text}")
