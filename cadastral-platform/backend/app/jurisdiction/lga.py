"""LGA lookup: which local government area (NSW or QLD) a site point lies in.

Order of evidence (docs/14-3d-site-design-tools.md section 7.1, owner decision D3):

1. ``arcgis_point_query``  a live point-in-polygon query against the state's LGA boundary layer (NSW Spatial Services,
   Queensland spatial catalogue). Query: geometryType=esriGeometryPoint, inSR=4326, spatialRel=esriSpatialRelIntersects,
   outFields=*, returnGeometry=false.
2. ``offline_geojson``     point-in-polygon (shapely) over GeoJSON files in ``backend/knowledge/lga_boundaries/*.geojson``
   when present. No boundary data ships in the repository: the files are added by the owner from the state sources.
3. ``lot_attribute``       the LGA name SA1 already read from the lot record (NSW ``lganame``, QLD ``shire_name``).
4. ``not_found``           nothing could be determined. The LGA is then UNRESOLVED; no value is ever invented.

``user_entered`` is a fifth, explicit method: the user typed the LGA (``run_site.py --lga <name>``).

Two separate facts are reported (they were one flag before):

* ``boundary_tested``  a geometry test produced the answer (methods 1 and 2). A lot attribute or a typed name is not a test.
* ``source_verified``  the boundary layer itself is recorded as verified (``LgaLayer.verified``). False for the shipped defaults
  and for any environment override until a confirmed live run is recorded, and False for offline files.

``verified`` is kept as a property: boundary_tested and source_verified. ``ambiguous`` is True when a point query returned
several features with different LGA names (the first is returned and a note says so).

The code (``lga_code``) is "<state>-<slug>", e.g. "nsw-gunnedah"; see ``app.agents.requirements.lgacode`` for the
normalisation rules. The same code keys ``backend/knowledge/<lga_code>/`` and ``planning.requirements.lga_code``.
"""
from __future__ import annotations

import json
import os
import urllib.error
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.agents.requirements.lgacode import STATES, lga_slug, normalise_lga_code, same_lga  # noqa: F401  (re-exported)

KNOWLEDGE_DIR = Path(__file__).resolve().parents[2] / "knowledge"
OFFLINE_DIR = KNOWLEDGE_DIR / "lga_boundaries"

Method = Literal["arcgis_point_query", "offline_geojson", "lot_attribute", "user_entered", "not_found"]


# ----------------------------------------------------------------------------------------------------------------------
# Configuration: ONE block. Defaults are UNVERIFIED placeholders (a research agent is confirming the real endpoints and
# the main session fills them in). Override per run with JCESITE_LGA_URL_NSW / JCESITE_LGA_URL_QLD; an empty value
# disables that state's live query (the offline files and the lot attribute are then used).
# ----------------------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class LgaLayer:
    state: str
    url: str                          # ArcGIS REST layer URL (without /query); "" disables the live query
    name_fields: tuple[str, ...]      # attribute names that may hold the LGA name, tried in order (case-insensitive)
    env_var: str
    verified: bool = False


LGA_LAYER_DEFAULTS: dict[str, LgaLayer] = {
    # Layer metadata (name, polygon geometry, Query capability, name field) confirmed from the layer JSON on 14/10/2026.
    # A live point query has NOT yet been run from the backend host (sandbox egress blocked), so verified stays False
    # until a real run succeeds. NSW: LocalGovernmentArea, display field lganame. QLD: Local government, field lga.
    "NSW": LgaLayer("NSW", "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme/FeatureServer/8",
                    ("lganame", "councilname", "lga_name", "name"), "JCESITE_LGA_URL_NSW"),
    "QLD": LgaLayer("QLD", "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Boundaries/AdministrativeBoundaries/MapServer/1",
                    ("lga", "abbrev_name", "lga_name", "name"), "JCESITE_LGA_URL_QLD"),
}

# Name fields tried in an offline GeoJSON feature (same candidates, plus the common ABS spelling).
OFFLINE_NAME_FIELDS = ("lganame", "lga_name", "lga", "shire_name", "name", "abs_name")


def configured_layers(env: dict[str, str] | None = None) -> dict[str, LgaLayer]:
    """Layers after applying the JCESITE_LGA_URL_* overrides. An override marks the URL as user-supplied (verified flag
    stays False: only the main session records a layer as verified)."""
    e = os.environ if env is None else env
    out: dict[str, LgaLayer] = {}
    for st, layer in LGA_LAYER_DEFAULTS.items():
        if layer.env_var in e:
            layer = LgaLayer(layer.state, e[layer.env_var].strip(), layer.name_fields, layer.env_var, False)    # an override is never verified
        out[st] = layer
    return out


# ----------------------------------------------------------------------------------------------------------------------
class LgaResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: Literal["NSW", "QLD"] | None = None
    lga_name: str | None = None
    lga_code: str | None = None
    source: str = ""
    method: Method = "not_found"
    boundary_tested: bool = False                          # a geometry test produced the answer
    source_verified: bool = False                          # the layer is recorded as verified (never for defaults, overrides or offline files)
    ambiguous: bool = False                                # the point intersects several LGAs with different names
    notes: list[str] = Field(default_factory=list)       # what was tried and failed (service errors, missing files)

    @property
    def verified(self) -> bool:
        return self.boundary_tested and self.source_verified

    @property
    def found(self) -> bool:
        return self.method != "not_found" and bool(self.lga_name)

    @property
    def verification_text(self) -> str:
        return verification_text(self.boundary_tested, self.source_verified, self.ambiguous)

    def summary(self) -> str:
        if not self.found:
            return "LGA UNRESOLVED (not found by point query, offline boundaries or lot attribute)" + (
                "; " + "; ".join(self.notes) if self.notes else "")
        return (f"{self.lga_name} ({self.state or 'state unknown'}), code {self.lga_code or 'UNRESOLVED'}; "
                f"{self.method.replace('_', ' ')}, {self.verification_text}; "
                f"source {self.source}")


def verification_text(boundary_tested: bool, source_verified: bool, ambiguous: bool = False) -> str:
    txt = ("boundary tested, source verified" if source_verified else "boundary tested, source not yet verified") if boundary_tested \
        else "NOT verified by a boundary test"
    return txt + (", AMBIGUOUS (the point intersects several LGAs)" if ambiguous else "")


class LgaServiceError(Exception):
    pass


class PointQueryClient:
    """Minimal ArcGIS REST query client in the style of sa1_cadastre.clients.ArcGISClient (urllib POST, optional
    injected fetcher for tests). ``get_json(url, params)`` returns the decoded JSON object or raises LgaServiceError."""

    def __init__(self, fetcher: Callable[[str, dict], "tuple[bytes, str | None]"] | None = None, timeout: float = 20.0):
        self.fetcher, self.timeout = fetcher, timeout

    def get_json(self, url: str, params: dict) -> dict:
        from app.agents.sa1_cadastre.clients import default_fetcher
        try:
            body, _ = self.fetcher(url, params) if self.fetcher else default_fetcher(url, params, self.timeout)
            js = json.loads(body)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError) as ex:
            raise LgaServiceError(f"{url}: {ex}") from ex
        if isinstance(js, dict) and "error" in js:
            raise LgaServiceError(f"{url}: {js['error']}")
        if not isinstance(js, dict):
            raise LgaServiceError(f"{url}: unexpected response")
        return js


class _HasGetJson(Protocol):
    def get_json(self, url: str, params: dict) -> dict: ...


def _as_client(client: Any) -> _HasGetJson:
    if client is None:
        return PointQueryClient()
    if hasattr(client, "get_json"):
        return client
    if hasattr(client, "fetcher"):                       # an sa1 ArcGISClient: reuse its fetcher
        return PointQueryClient(client.fetcher)
    raise TypeError("client must provide get_json(url, params) or be an ArcGISClient")


def point_query_params(lon: float, lat: float) -> dict:
    return {"f": "json", "where": "1=1", "outFields": "*", "returnGeometry": "false",
            "geometry": json.dumps({"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}),
            "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects"}


def _pick_name(attrs: dict, fields: tuple[str, ...]) -> str | None:
    low = {str(k).lower(): v for k, v in (attrs or {}).items()}
    for f in fields:
        v = low.get(f.lower())
        if v not in (None, ""):
            return str(v).strip()
    return None


def _result(state: str | None, name: str, source: str, method: Method, tested: bool, notes: list[str], *,
            source_verified: bool = False, ambiguous: bool = False) -> LgaResult:
    return LgaResult(state=state if state in STATES else None, lga_name=name.strip(), lga_code=normalise_lga_code(state, name),
                     source=source, method=method, boundary_tested=tested, source_verified=source_verified and tested,
                     ambiguous=ambiguous, notes=notes)


def _ambiguity_note(names: list[str]) -> list[str]:
    """Distinct LGA names (by normalised slug) among several matches; a one-element list means no ambiguity."""
    seen: dict[str, str] = {}
    for n in names:
        seen.setdefault(lga_slug(n) or n.casefold(), n)
    return list(seen.values()) if len(seen) > 1 else []


# ---- 1. live point query ---------------------------------------------------------------------------------------------
def query_arcgis(lon: float, lat: float, layer: LgaLayer, client: _HasGetJson, notes: list[str]) -> LgaResult | None:
    if not layer.url:
        notes.append(f"{layer.state} LGA service disabled ({layer.env_var} empty)")
        return None
    try:
        js = client.get_json(layer.url.rstrip("/") + "/query", point_query_params(lon, lat))
    except LgaServiceError as ex:
        notes.append(f"{layer.state} LGA service failed: {ex}")
        return None
    names = []
    for f in js.get("features") or []:
        name = _pick_name(f.get("attributes") or f.get("properties") or {}, layer.name_fields)
        if name:
            names.append(name)
    if not names:
        return None
    note = [] if layer.verified else [f"{layer.state} LGA service URL is an UNVERIFIED default or override"]
    several = _ambiguity_note(names)
    if several:
        note.append("AMBIGUOUS: point intersects several LGAs: " + ", ".join(several) + f"; the first ({names[0]}) is returned")
    return _result(layer.state, names[0], layer.url, "arcgis_point_query", True, notes + note,
                   source_verified=layer.verified, ambiguous=bool(several))


# ---- 2. offline GeoJSON ----------------------------------------------------------------------------------------------
class NotWgs84(ValueError):
    """The file's coordinates are outside lon/lat range (a projected CRS); it cannot be tested against a WGS84 point."""


def _first_coord(geom: dict) -> tuple[float, float] | None:
    c: Any = geom.get("coordinates") if geom.get("type") != "GeometryCollection" else (geom.get("geometries") or [{}])[0].get("coordinates")
    while isinstance(c, (list, tuple)) and c and isinstance(c[0], (list, tuple)):
        c = c[0]
    return (float(c[0]), float(c[1])) if isinstance(c, (list, tuple)) and len(c) >= 2 else None


@lru_cache(maxsize=8)
def _load_geojson(path: str, mtime: float) -> tuple[Any, ...]:
    """(state_or_None, name, shapely geometry) per feature. Cached by path and mtime."""
    from shapely.geometry import shape
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    stem = Path(path).stem.lower()
    file_state = "NSW" if stem.startswith("nsw") else "QLD" if stem.startswith("qld") else None
    out = []
    for f in d.get("features", []) if d.get("type") == "FeatureCollection" else [d]:
        props = f.get("properties") or {}
        name = _pick_name(props, OFFLINE_NAME_FIELDS)
        geom = f.get("geometry")
        if not name or not geom:
            continue
        st = str(props.get("state") or props.get("STATE") or file_state or "").upper() or None
        fc = _first_coord(geom)
        if fc is not None and (abs(fc[0]) > 180 or abs(fc[1]) > 90):
            raise NotWgs84(Path(path).name)
        try:
            out.append((st if st in STATES else None, name, shape(geom)))
        except Exception:  # noqa: BLE001 - a malformed feature must not break the lookup
            continue
    return tuple(out)


def default_offline_paths(directory: Path | None = None) -> list[Path]:
    d = directory or OFFLINE_DIR
    return sorted(d.glob("*.geojson")) if d.is_dir() else []


def query_offline(lon: float, lat: float, paths: list[Path], notes: list[str]) -> LgaResult | None:
    from shapely.geometry import Point
    pt = Point(lon, lat)
    hits: list[tuple[str | None, str, str]] = []
    for p in paths:
        try:
            feats = _load_geojson(str(p), p.stat().st_mtime)
        except NotWgs84:
            notes.append(f"OFFLINE FILE NOT IN WGS84, SKIPPED: {p.name}")
            continue
        except (OSError, ValueError) as ex:
            notes.append(f"offline boundary file {p.name} unreadable: {ex}")
            continue
        hits += [(st, name, str(p)) for st, name, geom in feats if geom.covers(pt)]
    if not hits:
        return None
    several = _ambiguity_note([h[1] for h in hits])
    st, name, src = hits[0]
    extra = ["AMBIGUOUS: point intersects several LGAs: " + ", ".join(several) + f"; the first ({name}) is returned"] if several else []
    return _result(st, name, src, "offline_geojson", True, notes + extra, ambiguous=bool(several))


# ---- 3. lot attribute ------------------------------------------------------------------------------------------------
def from_lot_attribute(lga_name: str | None, state: str | None, source: str = "SA1 lot record (lganame / shire_name)",
                       notes: list[str] | None = None) -> LgaResult | None:
    if not lga_name or not str(lga_name).strip():
        return None
    st = str(state).upper() if state else None
    return _result(st, str(lga_name), source, "lot_attribute", False, list(notes or []))


def from_user_entry(lga_name: str, state: str | None) -> LgaResult:
    st = str(state).upper() if state else None
    return _result(st, lga_name, "user entry (--lga)", "user_entered", False, [])


# ---- the lookup ------------------------------------------------------------------------------------------------------
def lookup_lga(lon: float, lat: float, *, client: Any = None, offline_paths: list[Path] | list[str] | None = None,
               lot_lga_name: str | None = None, state_hint: str | None = None, network: bool = True,
               env: dict[str, str] | None = None) -> LgaResult:
    """Find the LGA for a point (lon, lat in GDA2020/WGS84 degrees).

    ``client``        object with ``get_json(url, params)`` (or an sa1 ArcGISClient); None builds the default urllib client.
    ``offline_paths`` GeoJSON files to test; None uses backend/knowledge/lga_boundaries/*.geojson when present.
    ``lot_lga_name``  the LGA name SA1 read from the lot record, used last (``state_hint`` is the lot's state).
    ``network``       False skips the live query (offline runs).
    """
    notes: list[str] = []
    layers = configured_layers(env)
    order = [state_hint.upper()] if state_hint and state_hint.upper() in layers else []
    order += [s for s in layers if s not in order]
    if network:
        cl = _as_client(client)
        for st in order:
            r = query_arcgis(lon, lat, layers[st], cl, notes)
            if r:
                return r
    paths = [Path(p) for p in offline_paths] if offline_paths is not None else default_offline_paths()
    if paths:
        r = query_offline(lon, lat, paths, notes)
        if r:
            return r
    else:
        notes.append("no offline LGA boundary files present")
    r = from_lot_attribute(lot_lga_name, state_hint, notes=notes)
    if r:
        return r
    return LgaResult(method="not_found", notes=notes)


def centroid_lonlat(boundary_wkt: str, srid: int) -> tuple[float, float]:
    """Representative point of a lot boundary (WKT in the projected CRS ``srid``) as (lon, lat) degrees."""
    from pyproj import Transformer
    from shapely import wkt
    pt = wkt.loads(boundary_wkt).representative_point()
    lon, lat = Transformer.from_crs(srid, 4326, always_xy=True).transform(pt.x, pt.y)
    return float(lon), float(lat)
