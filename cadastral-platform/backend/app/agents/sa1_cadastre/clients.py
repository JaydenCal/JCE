"""ArcGIS REST clients. ALL default URLs are UNVERIFIED (endpoint unverified; override via config)."""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from app.agents.base import AgentError
from .models import LotIdentifier, Snapshot

Fetcher = Callable[[str, dict], "tuple[bytes, str | None]"]

NSW_LOT_LAYER = "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9"  # unverified
QLD_PARCEL_LAYER = "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4"  # unverified
NSW_ZONING_LAYER = "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/2"  # unverified
NSW_GEOCODER = "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Property/MapServer"  # verified live 2026-10-12: layers 1-4 carry an `address` field


def default_fetcher(url: str, params: dict, timeout: float = 30.0):
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "sa1-cadastre/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
        return r.read(), r.headers.get("ETag")


@dataclass
class LayerConfig:
    url: str
    provider: str
    layer_name: str
    attribution: str
    jurisdiction: str = "NSW"
    fields: dict = field(default_factory=dict)  # logical -> attribute name
    page_size: int = 1000
    max_pages: int = 20


NSW_FIELDS = {"lotidstring": "lotidstring", "lot": "lotnumber", "section": "sectionnumber",
              "plan": "planlabel", "area": "plan_lot_area", "lga": "lganame", "locality": "suburbname"}
QLD_FIELDS = {"lotplan": "lotplan", "lot": "lot", "plan": "plan", "area": "lot_area",
              "lga": "shire_name", "locality": "locality"}


def nsw_lot_layer() -> LayerConfig:
    return LayerConfig(NSW_LOT_LAYER, "NSW Spatial Services", "NSW_Cadastre/Lot",
                       "Spatial Services, NSW Dept of Customer Service", "NSW", dict(NSW_FIELDS))


def qld_parcel_layer() -> LayerConfig:
    return LayerConfig(QLD_PARCEL_LAYER, "QLD Dept Resources", "Cadastral parcels",
                       "State of Queensland (Dept of Resources)", "QLD", dict(QLD_FIELDS))


def nsw_zoning_layer() -> LayerConfig:
    return LayerConfig(NSW_ZONING_LAYER, "NSW Planning Portal", "EPI Land Zoning",
                       "NSW Dept of Planning and Environment", "NSW",
                       {"code": "SYM_CODE", "name": "LAY_CLASS", "instrument": "EPI_NAME"})


@dataclass
class QueryResult:
    features: list
    snapshot: Snapshot


class ArcGISClient:
    def __init__(self, fetcher: Fetcher | None = None, retries: int = 3, backoff: float = 0.5,
                 sleep: Callable[[float], None] = time.sleep, timeout: float = 30.0):
        self.fetcher = fetcher or (lambda u, p: default_fetcher(u, p, timeout))
        self.retries, self.backoff, self.sleep = retries, backoff, sleep

    def _get(self, url: str, params: dict):
        last = None
        for i in range(self.retries + 1):
            try:
                body, etag = self.fetcher(url, params)
                js = json.loads(body)
                if isinstance(js, dict) and "error" in js:
                    code = (js["error"] or {}).get("code")
                    if code in (500, 502, 503, 504, 429):
                        raise ConnectionError(str(js["error"]))
                    raise AgentError("SA1_UPSTREAM_ERROR", str(js["error"]))
                return body, etag, js
            except AgentError:
                raise
            except urllib.error.HTTPError as e:
                last = e
                if e.code < 500 and e.code != 429:
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError) as e:
                last = e
            if i < self.retries:
                self.sleep(self.backoff * 2 ** i)
        raise AgentError("SA1_UPSTREAM_UNAVAILABLE", f"{url}: {last}")

    def query(self, layer: LayerConfig, where: str = "1=1", geometry: dict | None = None,
              geometry_type: str = "esriGeometryPoint", out_fields: str = "*") -> QueryResult:
        params = {"f": "geojson", "where": where, "outFields": out_fields, "outSR": 7844,
                  "returnGeometry": "true", "spatialRel": "esriSpatialRelIntersects"}
        if geometry is not None:
            params.update(geometry=json.dumps(geometry), geometryType=geometry_type, inSR=7844)
        feats, h, etag = [], hashlib.sha256(), None
        for page in range(layer.max_pages):
            p = dict(params, resultOffset=page * layer.page_size, resultRecordCount=layer.page_size)
            body, e, js = self._get(layer.url + "/query", p)
            h.update(body)
            etag = etag or e
            feats += js.get("features", [])
            if not (js.get("exceededTransferLimit") or js.get("properties", {}).get("exceededTransferLimit")):
                break
        snap = make_snapshot(layer, params, h.digest(), etag)
        return QueryResult(feats, snap)

    def geocode(self, url: str, address: str) -> tuple[float, float]:
        if "NSW_Property" in url:
            return self._geocode_nsw_property(url, address)
        body, _, js = self._get(url.rstrip("/") + "/findAddressCandidates",
                                {"f": "json", "SingleLine": address, "outSR": 7844, "maxLocations": 1})
        c = js.get("candidates") or []
        if not c:
            raise AgentError("SA1_ADDRESS_NOT_FOUND", address)
        loc = c[0]["location"]
        return float(loc["x"]), float(loc["y"])


def _norm_address(address: str) -> tuple[str, str, str]:
    """'756 Quia Road, Gunnedah' -> ('756', 'QUIA ROAD', 'GUNNEDAH')."""
    import re
    parts = [x.strip() for x in address.upper().replace(" NSW", "").split(",") if x.strip()]
    m = re.match(r"^(?:UNIT\s+\S+\s*[/,]?\s*)?(\d+[A-Z]?)\s+(.+)$", parts[0]) if parts else None
    if not m:
        raise AgentError("SA1_ADDRESS_UNPARSEABLE", address)
    suburb = parts[1] if len(parts) > 1 else ""
    return m.group(1), m.group(2), suburb


def _geocode_nsw_property(self, url: str, address: str) -> tuple[float, float]:
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    num, road, suburb = _norm_address(address)
    like = f"{num} {road}" + (f" {suburb}" if suburb else "")
    where = f"housenumber = '{num}' AND UPPER(address) = '" + like.replace("'", "''") + "'"
    for layer in (4, 3, 2, 1):  # urban, semi-rural, rural, large rural
        _, _, js = self._get(url.rstrip("/") + f"/{layer}/query",
                             {"f": "json", "where": where, "outFields": "propid,address",
                              "returnGeometry": "true", "outSR": 7844})
        feats = js.get("features") or []
        if feats:
            rings = [Polygon(r) for r in feats[0]["geometry"]["rings"] if len(r) >= 4]
            pt = unary_union(rings).representative_point()
            return float(pt.x), float(pt.y)
    raise AgentError("SA1_ADDRESS_NOT_FOUND", address)


ArcGISClient._geocode_nsw_property = _geocode_nsw_property


def make_snapshot(layer: LayerConfig, params: dict, digest: bytes, etag: str | None) -> Snapshot:
    return Snapshot(jurisdiction=layer.jurisdiction, provider=layer.provider, service_url=layer.url,
                    layer_name=layer.layer_name, query_params=params, response_sha256=digest.hex(),
                    http_etag=etag, attribution=layer.attribution, fetched_at=datetime.now(timezone.utc))


def identifier_where(ident: LotIdentifier, layer: LayerConfig) -> str:
    f = layer.fields
    if ident.jurisdiction == "NSW":
        return f"{f.get('lotidstring', 'lotidstring')}='{ident.lotplan}'"
    return f"{f.get('lotplan', 'lotplan')}='{ident.lotplan}'"
